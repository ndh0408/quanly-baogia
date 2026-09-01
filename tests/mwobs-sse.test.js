// Cụm middleware-obs — ba lỗi trong src/sse.ts.
//
// ── LỖI 1: ghi SSE không hề nhìn áp lực ngược, và không có trần số kết nối ───
// `try { res.write(payload); } catch {}` bỏ qua giá trị TRẢ VỀ của `res.write` (false = bộ đệm
// kernel/Node đã đầy). Một client đọc chậm — hoặc một socket chết mà không gửi FIN (rất thường
// gặp qua tunnel/NAT) — làm mọi sự kiện tiếp theo dồn vào bộ đệm trong tiến trình, không giới
// hạn. `attach` cũng không hề kiểm `set.size`, nên một tài khoản mở bao nhiêu EventSource cũng được.
// TÁI HIỆN: dựng một kết nối có `writableLength` vượt trần rồi phát sự kiện → trước khi vá,
// kết nối đó vẫn nằm trong danh sách và tiếp tục nhận thêm dữ liệu.
// HẬU QUẢ: bộ nhớ tiến trình web phình theo số sự kiện, không có chốt nào chặn.
//
// ── LỖI 2: backplane Redis dùng CHUNG options với BullMQ ─────────────────────
// `const opts = { maxRetriesPerRequest: null, enableReadyCheck: false }` dùng cho CẢ publisher lẫn
// subscriber. `maxRetriesPerRequest: null` + hàng đợi offline mặc định nghĩa là: Redis chết thì mọi
// lệnh PUBLISH xếp hàng VÔ HẠN trong bộ nhớ. Đây đúng thứ mà src/queue.ts (khối chú thích trên `maxRetriesPerRequest`) đã viết hẳn một
// đoạn dài để tránh cho đường xử lý request. Publish SSE là bắn-và-quên: thà mất còn hơn xếp hàng.
// HẬU QUẢ: Redis chết → hàng đợi offline của ioredis phình, và không một số liệu nào cho biết.
//
// ── LỖI 3: `emitChange` phát id thật cho MỌI phiên đang mở ───────────────────
// `broadcast("changed", { entity, action, id })` đi tới mọi subscriber, không lọc quyền. Chỗ gọi là
// src/db.ts sau mỗi lần ghi Quote/Customer/User, tức id báo giá thật được phát cho cả những tài
// khoản không có quyền đọc báo giá đó. Client React (web/src/components/Shell.tsx:336) KHÔNG đọc
// payload — nó chỉ kích hoạt re-fetch qua API đã gác quyền — nên id trong payload không phục vụ ai
// ngoài người nghe lén.
// HẬU QUẢ: dựng được nhịp làm việc + khoảng id báo giá theo thời gian thực chỉ bằng cách nghe SSE.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { attach, publish, broadcast, emitChange, backplaneOptions, SSE_MAX_PER_USER, SSE_MAX_BUFFER } from "../src/sse.js";

/** Giả lập cặp req/res đủ cho `attach`, có `writableLength` để mô phỏng bộ đệm đầy. */
function gia() {
  const handlers = {};
  const res = {
    headers: {},
    daGhi: [],
    writableLength: 0,
    daHuy: false,
    trangThai: 0,
    than: null,
    setHeader(k, v) { this.headers[k] = v; },
    flushHeaders() {},
    status(c) { this.trangThai = c; return this; },
    json(o) { this.than = o; return this; },
    write(s) { if (this.daHuy) throw new Error("ghi sau khi huỷ"); this.daGhi.push(s); return true; },
    end() { this.daHuy = true; },
    destroy() { this.daHuy = true; handlers.close?.(); }, // socket thật huỷ → req phát "close"
  };
  const req = { on(ev, fn) { handlers[ev] = fn; } };
  return { req, res, dongSocket: () => handlers.close?.() };
}

/**
 * userId RIÊNG CHO TỪNG TIẾN TRÌNH — đừng gán số cố định.
 *
 * Khi CÓ Redis, mọi tiến trình test nói chuyện qua CÙNG MỘT kênh `sse:events` trên CÙNG MỘT Redis.
 * Hai lượt `npx vitest run` chạy song song (hai người cùng chạy test, hoặc một người chạy lại khi
 * lượt trước chưa xong) sẽ dùng CHUNG uid 910004 — và sự kiện của tiến trình kia rơi vào đúng danh
 * sách kết nối của tiến trình này. Bài "không nhồi thêm vào bộ đệm đã đầy" đếm số lần ghi, nên một
 * sự kiện lạ là đủ làm nó đỏ.
 *
 * ĐO ĐƯỢC (2026-08-27): chạy hai tiến trình cùng lúc trên cùng Redis → một trong hai đỏ ở bài
 * "kết nối có bộ đệm vượt trần bị huỷ".
 *
 * Trộn PID vào uid làm hai tiến trình không đụng nhau. Giữ trong khoảng an toàn của số nguyên.
 */
const RIENG = (process.pid % 9000) * 100;
const uidRieng = (n) => 910000 + RIENG + n;

/**
 * CHỜ TỚI KHI ĐIỀU KIỆN ĐÚNG — ĐỪNG ĐỔI VỀ KHẲNG ĐỊNH ĐỒNG BỘ.
 *
 * `publish`/`broadcast` (src/sse.ts:218/231) có HAI đường chạy, và chỉ một trong hai là đồng bộ:
 *   · KHÔNG có REDIS_URL → `localPublish` chạy ngay trong lời gọi → ghi xong trước khi hàm trả về.
 *   · CÓ REDIS_URL       → `pub.publish(CHANNEL, …)` rồi TRẢ VỀ NGAY; việc ghi ra từng kết nối chỉ
 *                          xảy ra khi subscriber nhận lại gói từ Redis, tức MỘT VÒNG MẠNG sau đó.
 *
 * Bản test cũ khẳng định đồng bộ nên nó chỉ đúng ở cấu hình KHÔNG Redis. ĐO ĐƯỢC 2026-08-27:
 * cùng file, `REQUIRE_DB_TESTS=1 npx vitest run` → 7/7 xanh khi không đặt REDIS_URL, 4/7 ĐỎ khi có.
 * Mà production LUÔN có Redis, còn `npm run verify` cũng đặt REDIS_URL — nên bản cũ vừa đỏ thất
 * thường (vòng loopback đôi khi kịp về trước dòng expect) vừa kiểm nhầm cấu hình.
 *
 * Chờ như thế này đúng cho CẢ HAI đường: không Redis thì vòng lặp thoát ngay lượt đầu.
 */
async function choToi(dieuKien, moTa, hanMs = 3000) {
  const het = Date.now() + hanMs;
  for (;;) {
    if (dieuKien()) return;
    if (Date.now() > het) throw new Error(`quá ${hanMs}ms mà chưa: ${moTa}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("SSE — trần số kết nối trên mỗi tài khoản", () => {
  it("vượt trần thì trả 429 và KHÔNG thêm vào danh sách phát", async () => {
    const uid = uidRieng(1);
    const oks = [];
    for (let i = 0; i < SSE_MAX_PER_USER; i++) {
      const c = gia();
      attach(c.req, c.res, uid);
      oks.push(c);
    }
    const thua = gia();
    attach(thua.req, thua.res, uid);
    expect(thua.res.trangThai).toBe(429);
    expect(thua.res.daGhi).toEqual([]); // không được mở stream

    publish(uid, "thu", { a: 1 });
    await choToi(() => oks.every((c) => c.res.daGhi.some((s) => s.includes("event: thu"))),
      "mọi kết nối trong trần nhận được sự kiện");
    expect(thua.res.daGhi, "kết nối bị 429 vẫn nhận sự kiện ⇒ nó chưa bị gỡ khỏi danh sách phát").toEqual([]);

    for (const c of oks) c.dongSocket();
  });

  it("trần tính RIÊNG từng tài khoản — người khác không bị ảnh hưởng", () => {
    const a = [], uidA = uidRieng(2), uidB = uidRieng(3);
    for (let i = 0; i < SSE_MAX_PER_USER; i++) { const c = gia(); attach(c.req, c.res, uidA); a.push(c); }
    const b = gia();
    attach(b.req, b.res, uidB);
    expect(b.res.trangThai).toBe(0);
    expect(b.res.daGhi.length).toBeGreaterThan(0);
    for (const c of a) c.dongSocket();
    b.dongSocket();
  });
});

describe("SSE — áp lực ngược", () => {
  it("kết nối có bộ đệm vượt trần bị huỷ và gỡ khỏi danh sách", async () => {
    const uid = uidRieng(4);
    const cham = gia(), nhanh = gia();
    attach(cham.req, cham.res, uid);
    attach(nhanh.req, nhanh.res, uid);
    const truocCham = cham.res.daGhi.length;

    cham.res.writableLength = SSE_MAX_BUFFER + 1; // client đọc chậm / socket chết không FIN
    publish(uid, "thu", { a: 1 });

    await choToi(() => cham.res.daHuy, "kết nối bộ đệm đầy bị huỷ");
    expect(cham.res.daGhi.length, "vẫn nhồi thêm vào bộ đệm đã đầy").toBe(truocCham);
    await choToi(() => nhanh.res.daGhi.some((s) => s.includes("event: thu")),
      "kết nối đọc nhanh nhận được sự kiện");

    // Đã bị gỡ → lần phát sau không đụng tới nó nữa (nếu còn, write sẽ ném vì đã huỷ).
    expect(() => publish(uid, "thu2", { a: 2 })).not.toThrow();
    await choToi(() => nhanh.res.daGhi.some((s) => s.includes("event: thu2")),
      "sự kiện thứ hai vẫn tới được kết nối còn sống");
    nhanh.dongSocket();
  });

  it("broadcast cũng áp cùng trần, không chỉ publish", async () => {
    const uid = uidRieng(5);
    const cham = gia();
    attach(cham.req, cham.res, uid);
    cham.res.writableLength = SSE_MAX_BUFFER + 1;
    broadcast("thu", { a: 1 });
    await choToi(() => cham.res.daHuy, "broadcast cũng huỷ kết nối có bộ đệm vượt trần");
  });
});

describe("SSE — emitChange không phát id ra toàn hệ thống", () => {
  it("payload chỉ còn entity + action", async () => {
    const uid = uidRieng(6);
    const c = gia();
    attach(c.req, c.res, uid);
    emitChange("quote", "update", 4271);
    await choToi(() => c.res.daGhi.some((s) => s.includes("event: changed")),
      "nhận được sự kiện changed");
    const su = c.res.daGhi.find((s) => s.includes("event: changed"));
    const data = JSON.parse(su.split("data: ")[1].trim());
    expect(data).toEqual({ entity: "quote", action: "update" });
    expect(JSON.stringify(data)).not.toContain("4271");
    c.dongSocket();
  });
});

describe("SSE — options của backplane Redis", () => {
  it("publisher TRƯỢT NHANH: không xếp hàng offline, không thử lại vô hạn", () => {
    const o = backplaneOptions("pub");
    expect(o.enableOfflineQueue).toBe(false);
    expect(o.maxRetriesPerRequest).not.toBeNull();
    expect(typeof o.commandTimeout).toBe("number");
  });

  it("subscriber vẫn được phép chờ mãi (kết nối dài, phải tự nối lại)", () => {
    const o = backplaneOptions("sub");
    expect(o.maxRetriesPerRequest).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LỖI 4 (tìm ra khi phản biện chính bản vá "chờ giao hàng" ở commit 417d579):
// MẤT SỰ KIỆN LÚC KHỞI ĐỘNG — và đây là lỗi PRODUCTION, không phải chuyện của bộ test.
//
// `pub` là CÔNG TẮC: `publish()`/`broadcast()` thấy nó khác null là đi đường Redis rồi TRẢ VỀ NGAY,
// KHÔNG phát cục bộ (đúng thiết kế — subscriber mới là nơi phát, nếu không mỗi sự kiện tới hai lần).
//
// Bản trước gán `pub = pubClient` NGAY SAU khi dựng publisher, tức TRƯỚC `await sub.subscribe()`.
// Redis pub/sub KHÔNG có bộ đệm: mọi sự kiện phát trong cửa sổ đó vào Redis mà KHÔNG AI NGHE và
// MẤT HẲN — im lặng, gauge vẫn báo khoẻ.
//
// Hậu quả thật: mỗi lần một instance khởi động lại, mọi `emitChange` trong cửa sổ ấy (báo giá vừa
// tạo/sửa/xoá) không tới màn hình của ai. Đúng lúc người ta cần nhất — vừa deploy xong.
//
// ĐO ĐƯỢC: trước bản vá, file test này đỏ 2/3 lượt chạy MỘT MÌNH (bài "kết nối có bộ đệm vượt trần
// bị huỷ" hết hạn chờ 3 giây vì gói phát ra không bao giờ quay về). Sau bản vá: 0/8 lượt một mình,
// 0/6 lượt chạy ba tiến trình song song.
//
// ĐÂY LÀ NƠI CỬA SỔ ĐUA ĐƯỢC KHOÁ. Đo được: quay lại đúng lỗi cũ thì file này ĐỎ 4/4 lượt,
// 2 bài mỗi lượt — gồm cả bài HÀNH VI ở trên ("kết nối có bộ đệm vượt trần bị huỷ") lẫn các bài
// khoá thứ tự dưới đây.
//
// KHÔNG kiểm được cửa sổ này từ một bài test viết BÊN NGOÀI module: ioredis có hàng đợi ngoại
// tuyến, nên lệnh PUBLISH gọi lúc chưa nối được xếp lại và chỉ bay đi khi kết nối lên — mà lúc
// đó subscriber cũng vừa subscribe xong. tests/x3-sse-cua-so-khoi-dong.test.js đã thử và KHÔNG
// bắt được (ghi rõ ở đầu file đó). Vì vậy ba bài khoá THỨ TỰ dưới đây là thứ giữ bất biến.
// ─────────────────────────────────────────────────────────────────────────────
describe("SSE — backplane không được nuốt sự kiện lúc khởi động", () => {
  const nguon = readFileSync(new URL("../src/sse.ts", import.meta.url), "utf8");
  // Bỏ chú thích: khối văn bản giải thích lỗi có chứa đúng những chuỗi đang tìm.
  const ma = nguon.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

  const viTri = (chuoi) => {
    const i = ma.indexOf(chuoi);
    expect(i, `không tìm thấy trong src/sse.ts (đã đổi cách viết?): ${chuoi}`).toBeGreaterThan(-1);
    return i;
  };

  it("`pub` chỉ được gán SAU khi subscriber đã subscribe xong", () => {
    expect(viTri("pub = pubClient;"),
      "gán `pub` trước `await sub.subscribe` → mọi sự kiện phát trong cửa sổ khởi động đi vào Redis " +
      "mà không ai nghe và MẤT HẲN. Đây là lỗi production, không phải chuyện của test.")
      .toBeGreaterThan(viTri("await sub.subscribe(CHANNEL)"));
  });

  it("handler `message` gắn TRƯỚC subscribe, không phải sau", () => {
    expect(viTri('sub.on("message"'),
      "gắn handler sau `subscribe` → gói tới trong khoảng giữa bị ioredis bỏ vì không ai nghe")
      .toBeLessThan(viTri("await sub.subscribe(CHANNEL)"));
  });

  it("chỉ có ĐÚNG MỘT chỗ gán `pub` khác null — công tắc không được bật ở nơi khác", () => {
    // KHÔNG dùng `(?!null)` ở đây: `\s*` lùi bước được, nên lookahead soi vào dấu cách thay vì vào
    // chữ "null" và luôn đúng. (Bản đầu của chính bài này dính đúng bẫy đó — đếm ra 2 thay vì 1.)
    // Bắt lấy TÊN được gán rồi lọc, không đoán bằng lookahead.
    const gan = [...ma.matchAll(/\bpub\s*=\s*([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);
    const bat = gan.filter((g) => g !== "null");
    expect(bat, "thêm một chỗ bật công tắc `pub` là mở lại đúng cửa sổ đua vừa đóng").toEqual(["pubClient"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FILE NÀY PHẢI BIẾT NÓ VỪA KIỂM ĐƯỜNG NÀO.
//
// Cả bộ bài trên được viết lại (commit 417d579) với lý lẽ "production LUÔN có Redis, nên phải kiểm
// ở cấu hình đó". Nhưng đo lại thì file này XANH 10/10 CẢ KHI Redis chết — đặt
// `REDIS_URL=redis://127.0.0.1:6399` (không có gì lắng nghe) vẫn xanh trọn. Nó không phân biệt nổi
// đường Redis với đường rơi cục bộ, nên "kiểm đúng cấu hình production" mới chỉ là lời tự nhận.
//
// Một bộ test không biết mình chạy nhánh nào thì mọi kết luận về nhánh đó đều vô căn cứ.
// ─────────────────────────────────────────────────────────────────────────────
describe("bộ test phải biết mình vừa kiểm đường nào", () => {
  it("có REDIS_URL thì backplane PHẢI lên — nếu không, mọi bài trên chỉ kiểm đường cục bộ", async () => {
    if (!process.env.REDIS_URL) return;   // không đặt Redis = cố ý kiểm đường cục bộ, hợp lệ

    const { backplaneDangDung } = await import("../src/sse.js");
    // Khởi tạo backplane là bất đồng bộ (nạp ioredis + bắt tay TCP). Chờ có giới hạn.
    const het = Date.now() + 8000;
    while (!backplaneDangDung() && Date.now() < het) await new Promise((r) => setTimeout(r, 50));

    expect(backplaneDangDung(),
      `REDIS_URL=${process.env.REDIS_URL} nhưng backplane không lên sau 8 giây. Mọi bài trong file ` +
      `này vừa chạy trên ĐƯỜNG RƠI CỤC BỘ, không phải đường của production — chúng xanh mà không ` +
      `nói lên điều gì về cấu hình thật. Kiểm Redis có sống không, và có đúng địa chỉ không.`)
      .toBe(true);
  }, 30_000);
});
