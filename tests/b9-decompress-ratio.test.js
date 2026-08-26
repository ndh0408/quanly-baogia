/**
 * ============================================================================
 * TRẦN TỈ LỆ NÉN cho thân request — phần còn hở của `decompressbody-before-auth`.
 *
 * ── LỖI ─────────────────────────────────────────────────────────────────────
 * `decompressBody` chạy TRƯỚC xác thực và TRƯỚC bộ giới hạn tần suất: src/app.ts:270-271 gắn nó,
 * còn `bearerAuth` mãi tới :384. Người CHƯA đăng nhập chạm được vào đây.
 *
 * Trần TUYỆT ĐỐI (2MB chung / 16MB cho /api/quotes) chặn "phình thành GB" nhưng KHÔNG chặn phần
 * KHUẾCH ĐẠI: một gói gzip vài chục KB nở đúng tới trần rồi mới bị cắt, và trước lúc bị cắt thì
 * ngần ấy byte đã nằm trong mảng `manh`. Vài chục request song song = vài trăm MB, không cần
 * tài khoản nào.
 *
 * ── BẢN VÁ ──────────────────────────────────────────────────────────────────
 * Thêm trần TỈ LỆ (ra/vào), mặc định 100, có sàn 1MB trước khi bắt đầu kiểm.
 * JSON báo giá thật nén được ~10 lần → cách trần 10 lần. Bom nén thì 1000 lần trở lên.
 *
 * ── ĐIỀU KHÔNG ĐƯỢC PHÁ ─────────────────────────────────────────────────────
 * Báo giá thật PHẢI đi qua. Bài cuối trong file này gửi một payload giống hệt dữ liệu thật
 * (chuỗi tiếng Việt lặp lại có cấu trúc) và đòi nó vào được.
 * ============================================================================
 */
import { describe, it, expect } from "vitest";
import express from "express";
import http from "node:http";
import zlib from "node:zlib";
import { decompressBody } from "../src/decompressBody.js";

const dungApp = (tran) => {
  const app = express();
  app.use(decompressBody(tran));
  app.use(express.json({ limit: "32mb" }));
  app.post("/echo", (req, res) => res.json({ n: JSON.stringify(req.body || "").length }));
  return app;
};

const gui = (app, than, headers = {}) =>
  new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const { port } = server.address();
      const req = http.request(
        { port, host: "127.0.0.1", method: "POST", path: "/echo", headers: { "Content-Length": Buffer.byteLength(than), ...headers } },
        (res) => {
          let chu = "";
          res.on("data", (c) => (chu += c));
          res.on("end", () => { server.close(); resolve({ status: res.statusCode, body: chu ? JSON.parse(chu) : null }); });
        },
      );
      req.on("error", (e) => { server.close(); reject(e); });
      req.end(than);
    });
  });

const H = { "Content-Type": "application/json", "Content-Encoding": "gzip" };

describe("trần TỈ LỆ nén — chặn khuếch đại dưới trần tuyệt đối", () => {
  it("bom nén NẰM DƯỚI trần tuyệt đối vẫn bị chặn 413", async () => {
    // 8MB toàn ký tự 'a' → gzip còn vài KB (tỉ lệ ~1000×). Trần tuyệt đối để 16MB nên KHÔNG chạm;
    // chỉ có trần tỉ lệ mới bắt được. Đây chính là ca mà bản trước cho đi lọt.
    const to = JSON.stringify({ x: "a".repeat(8 * 1024 * 1024) });
    const nen = zlib.gzipSync(Buffer.from(to));
    expect(to.length / nen.length, "mẫu thử phải thật sự là bom nén").toBeGreaterThan(500);
    expect(nen.length, "gói nén phải nhỏ hơn hẳn trần tuyệt đối").toBeLessThan(1024 * 1024);
    const r = await gui(dungApp(16 * 1024 * 1024), nen, H);
    expect(r.status).toBe(413);
    expect(r.body.error).toMatch(/Tỉ lệ nén bất thường/);
  });

  it("KHÔNG đánh nhầm báo giá THẬT — dữ liệu có cấu trúc, tiếng Việt, ~3MB", async () => {
    // Dựng giống payload thật: nhiều hạng mục, tên tiếng Việt khác nhau, số khác nhau.
    // Loại dữ liệu này nén được ~10 lần, cách trần 100 rất xa.
    const ten = ["Thi công sân khấu", "Thuê màn hình LED", "Nhân công lắp đặt", "Vận chuyển thiết bị", "Backdrop in bạt"];
    const items = Array.from({ length: 20000 }, (_, i) => ({
      name: `${ten[i % 5]} hạng mục ${i}`, quantity: (i % 37) + 1, unitPrice: 100000 + i * 137,
      notes: `Ghi chú ${i}: bàn giao trước ${(i % 28) + 1}/${(i % 12) + 1}`,
    }));
    const to = JSON.stringify({ sheets: [{ name: "Trang 1", items }] });
    const nen = zlib.gzipSync(Buffer.from(to));
    const tiLe = to.length / nen.length;
    expect(to.length, "mẫu phải vượt sàn 1MB thì phép kiểm tỉ lệ mới thật sự chạy").toBeGreaterThan(1024 * 1024);
    const r = await gui(dungApp(16 * 1024 * 1024), nen, H);
    expect(r.status, `báo giá thật bị chặn nhầm — tỉ lệ nén đo được ${tiLe.toFixed(1)}×`).toBe(200);
  });

  it("gói NHỎ dưới sàn 1MB không bị phép kiểm tỉ lệ đụng tới", async () => {
    // Dưới sàn, zlib có thể nhả nhiều hơn số byte vừa nhận (bộ đệm nội bộ) nên tỉ lệ vô nghĩa.
    // 500KB toàn 'a' có tỉ lệ ~500× nhưng phải ĐI QUA: lượng bộ nhớ không đáng để chặn.
    const to = JSON.stringify({ x: "a".repeat(500 * 1024) });
    const r = await gui(dungApp(16 * 1024 * 1024), zlib.gzipSync(Buffer.from(to)), H);
    expect(r.status).toBe(200);
  });

  it("trần TUYỆT ĐỐI vẫn hoạt động — không hồi quy lớp chặn cũ", async () => {
    const to = JSON.stringify({ x: "a".repeat(8 * 1024 * 1024) });
    const r = await gui(dungApp(1024 * 1024), zlib.gzipSync(Buffer.from(to)), H);
    expect(r.status).toBe(413);
    expect(r.body.error).toMatch(/quá lớn/);
  });

  it("deflate cũng bị chặn, không chỉ gzip", async () => {
    const to = JSON.stringify({ x: "a".repeat(8 * 1024 * 1024) });
    const r = await gui(dungApp(16 * 1024 * 1024), zlib.deflateSync(Buffer.from(to)), { ...H, "Content-Encoding": "deflate" });
    expect(r.status).toBe(413);
    expect(r.body.error).toMatch(/Tỉ lệ nén bất thường/);
  });
});
