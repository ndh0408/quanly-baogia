// Soát chéo http#12 — HTTP-07 (keep-alive 95s) × HTTP-08 (hạn tắt 70s).
//
// `http.Server.close()` chỉ gọi `closeIdleConnections()` MỘT lần, ngay lúc gọi. Socket đang có
// request dở thì bị bỏ qua; request đó trả xong vẫn mang `Connection: keep-alive` + `Keep-Alive:
// timeout=95` và socket được giữ tới keepAliveTimeout — 95s, dài hơn hạn cưỡng bức 70s. Nên chỉ
// cần MỘT request đang chạy lúc SIGTERM là callback của close() không chạy trước hạn: tiến trình
// treo 70s (Cloudflare trả 502 cho kết nối mới, container mới chưa được dựng), rồi `exit(1)` cắt
// ngang request đang bay trên socket bị giữ, bỏ qua `$disconnect`/flush Sentry. Trước HTTP-07,
// keep-alive 5s nên callback chạy sau ~5-7s; tests/ht8-an-han-tat-app.test.js chỉ đọc tĩnh các con
// số nên không thấy tương tác này.
//
// Bài này chạy THẬT: http.Server với keepAliveTimeout 95s như src/server.ts + http.Agent keepAlive,
// gọi tắt máy lúc đang có request dở, đòi callback chạy ngay sau khi request đó xong.
import { describe, it, expect, afterEach } from "vitest";
import http from "node:http";
import { readFileSync } from "node:fs";
import { ganTatMayEm } from "../src/tatMayHttp.js";

const cho = (ms) => new Promise((r) => setTimeout(r, ms));
async function doiToi(dk, hanMs) {
  const bd = Date.now();
  while (!dk() && Date.now() - bd < hanMs) await cho(20);
  return dk();
}

const donDep = [];
afterEach(() => { while (donDep.length) donDep.pop()(); });

async function dungMay() {
  const srv = http.createServer((req, res) => {
    if (req.url === "/cham") {
      // Request dở TRƯỚC lúc tắt, header CHƯA gửi (lượt Lưu báo giá lớn): trả sau 600ms.
      setTimeout(() => res.end("xong"), 600);
    } else if (req.url === "/luong") {
      // Request dở mà header ĐÃ gửi trước lúc tắt (tải file dạng luồng): không còn đường báo
      // `Connection: close` — chỉ có vét socket rỗi mới đóng được nó.
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.write("a");
      setTimeout(() => res.end("b"), 600);
    } else {
      res.end("ok");
    }
  });
  srv.keepAliveTimeout = 95_000;   // đúng như src/server.ts (HTTP-07)
  srv.headersTimeout = 96_000;
  const tat = ganTatMayEm(srv);
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
  donDep.push(() => { agent.destroy(); srv.closeAllConnections(); srv.close(() => {}); });
  const goi = (duong, { khiCoHeader } = {}) => new Promise((resolve, reject) => {
    const rq = http.get({ host: "127.0.0.1", port: srv.address().port, path: duong, agent }, (res) => {
      khiCoHeader?.();
      let than = "";
      res.on("data", (c) => { than += c; });
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, than, xongLuc: Date.now() }));
    });
    rq.on("error", reject);
  });
  return { srv, tat, goi };
}

describe("tắt máy êm khi keep-alive dài hơn hạn tắt (soát chéo http#12)", () => {
  it("request đang chạy lúc tắt (header chưa gửi) → trả `Connection: close`, callback chạy ngay sau khi nó xong", async () => {
    const { tat, goi } = await dungMay();
    // Socket keep-alive đã dùng một lần — y như pool kết nối của cloudflared tới app.
    expect((await goi("/")).status).toBe(200);
    const cham = goi("/cham");
    await cho(100);
    let xongLuc = null;
    tat.tat(() => { xongLuc = Date.now(); });
    const r = await cham;
    expect(r.status).toBe(200);
    expect(r.than).toBe("xong");
    expect(r.headers.connection, "phản hồi của request dở vẫn mời proxy dùng lại socket").toBe("close");
    expect(await doiToi(() => xongLuc !== null, 3000), "callback close() không chạy — sẽ treo tới hạn cưỡng bức").toBe(true);
    expect(xongLuc - r.xongLuc).toBeLessThan(1000);
  }, 10_000);

  it("request dạng luồng đã gửi header TRƯỚC lúc tắt → socket bị vét khi rỗi, callback vẫn chạy ngay", async () => {
    const { tat, goi } = await dungMay();
    let coHeader = false;
    const luong = goi("/luong", { khiCoHeader: () => { coHeader = true; } });
    expect(await doiToi(() => coHeader, 2000)).toBe(true);
    let xongLuc = null;
    tat.tat(() => { xongLuc = Date.now(); });
    const r = await luong;
    expect(r.than).toBe("ab");
    expect(await doiToi(() => xongLuc !== null, 3000), "socket keep-alive giữ tới 95s sau khi luồng xong").toBe(true);
    expect(xongLuc - r.xongLuc).toBeLessThan(1000);
  }, 10_000);

  it("không có request nào đang chạy → callback chạy gần như tức thì (socket rỗi bị đóng)", async () => {
    const { tat, goi } = await dungMay();
    expect((await goi("/")).status).toBe(200);
    const bd = Date.now();
    let xongLuc = null;
    tat.tat(() => { xongLuc = Date.now(); });
    expect(await doiToi(() => xongLuc !== null, 3000)).toBe(true);
    expect(xongLuc - bd).toBeLessThan(1000);
  }, 10_000);
});

describe("src/server.ts dùng đường tắt máy êm (không gọi server.close() trần)", () => {
  // Bỏ dòng chú thích: chú thích được phép (và nên) nhắc tới `server.close()` để giải thích vì sao.
  const src = readFileSync(new URL("../src/server.ts", import.meta.url), "utf8")
    .split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  it("gắn ganTatMayEm lên server và tắt qua nó", () => {
    expect(src).toMatch(/ganTatMayEm\(server\)/);
    expect(src).toMatch(/\.tat\(/);
    expect(src, "server.close() trần chỉ đóng socket rỗi MỘT lần — xem đầu tệp").not.toMatch(/server\.close\(/);
  });
});
