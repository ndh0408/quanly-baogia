// Thân request NÉN: client tự nén gói lớn khi lưu báo giá (báo giá 50 trang nặng vài MB, JSON nén
// được ~10 lần). Server phải mở đúng, và phải chặn được "bom nén" — gói vài KB phình ra hàng GB.
import { describe, it, expect } from "vitest";
import express from "express";
import http from "node:http";
import zlib from "node:zlib";
import { decompressBody } from "../src/decompressBody.js";

const dungApp = (tran) => {
  const app = express();
  app.use(decompressBody(tran));
  app.use(express.json({ limit: "16mb" }));
  app.post("/echo", (req, res) => res.json({ nhanDuoc: req.body }));
  return app;
};

// Gửi BYTE THÔ qua HTTP thật. Không dùng supertest ở đây: nó tự chuyển Buffer thành JSON khi
// Content-Type là application/json, nên gói nén tới nơi không còn là gzip nữa — test sẽ đo nhầm.
// Client thật (fetch trong web/src/lib/api.ts) gửi đúng byte thô kèm Content-Type: application/json.
const guiTai = (app, path, than, headers = {}) =>
  new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const { port } = server.address();
      const req = http.request(
        { port, host: "127.0.0.1", method: "POST", path, headers: { "Content-Length": Buffer.byteLength(than), ...headers } },
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

describe("decompressBody — mở gói nén gửi lên", () => {
  it("gzip: đọc đúng nội dung", async () => {
    const data = { sheets: [{ name: "Banner", items: [{ name: "Hạng mục 1", quantity: 19.89 }] }] };
    const nen = zlib.gzipSync(Buffer.from(JSON.stringify(data)));
    const res = await gui(dungApp(), nen, { "Content-Type": "application/json", "Content-Encoding": "gzip" });
    expect(res.status).toBe(200);
    expect(res.body.nhanDuoc).toEqual(data);
  });

  it("deflate: đọc đúng nội dung", async () => {
    const data = { a: "xin chào", b: [1, 2, 3] };
    const nen = zlib.deflateSync(Buffer.from(JSON.stringify(data)));
    const res = await gui(dungApp(), nen, { "Content-Type": "application/json", "Content-Encoding": "deflate" });
    expect(res.status).toBe(200);
    expect(res.body.nhanDuoc).toEqual(data);
  });

  it("không nén thì đi qua như thường", async () => {
    const res = await gui(dungApp(), JSON.stringify({ x: 1 }), { "Content-Type": "application/json" });
    expect(res.status).toBe(200);
    expect(res.body.nhanDuoc).toEqual({ x: 1 });
  });

  it("giữ nguyên dấu tiếng Việt (UTF-8 nhiều byte)", async () => {
    const data = { name: "Băng rôn 11m7W x 1m7H — Hiflex xuyên đèn · nhóm A/B" };
    const nen = zlib.gzipSync(Buffer.from(JSON.stringify(data)));
    const res = await gui(dungApp(), nen, { "Content-Type": "application/json", "Content-Encoding": "gzip" });
    expect(res.body.nhanDuoc.name).toBe(data.name);
  });

  it("BOM NÉN: gói nhỏ phình ra khổng lồ → chặn 413, không nuốt hết RAM", async () => {
    // 8MB số 0 nén lại chỉ còn vài KB. Trần đặt 1MB → phải bị chặn.
    const phinh = zlib.gzipSync(Buffer.alloc(8 * 1024 * 1024, 0x30));
    expect(phinh.length).toBeLessThan(200 * 1024);
    const res = await gui(dungApp(1024 * 1024), phinh, { "Content-Type": "application/json", "Content-Encoding": "gzip" });
    expect(res.status).toBe(413);
  });

  it("kiểu nén lạ → 415, không đoán mò", async () => {
    const res = await gui(dungApp(), Buffer.from("abc"), { "Content-Type": "application/json", "Content-Encoding": "br" });
    expect(res.status).toBe(415);
  });

  it("dữ liệu hỏng (nói là gzip nhưng không phải) → 400, không treo", async () => {
    const res = await gui(dungApp(), Buffer.from("đây không phải gzip"), { "Content-Type": "application/json", "Content-Encoding": "gzip" });
    expect(res.status).toBe(400);
  });

  it("JSON hỏng bên trong gói nén → 400", async () => {
    const nen = zlib.gzipSync(Buffer.from("{ thiếu ngoặc"));
    const res = await gui(dungApp(), nen, { "Content-Type": "application/json", "Content-Encoding": "gzip" });
    expect(res.status).toBe(400);
  });

  it("gói lớn cỡ báo giá 50 trang vẫn qua được", async () => {
    const items = Array.from({ length: 200 }, (_, i) => ({
      kind: "item", name: `Banner ${i}: 11m7W x 1m7H\n. Hiflex xuyên đèn`, unit: "m2", quantity: 19.89, unitPrice: 65000,
    }));
    const data = { sheets: Array.from({ length: 50 }, (_, k) => ({ order: k, name: `Trang ${k + 1}`, items })) };
    const chu = JSON.stringify(data);
    const nen = zlib.gzipSync(Buffer.from(chu));
    expect(chu.length).toBeGreaterThan(1_000_000);     // gói thật > 1MB
    expect(nen.length).toBeLessThan(chu.length / 5);   // nén ăn ít nhất 5 lần
    const res = await gui(dungApp(), nen, { "Content-Type": "application/json", "Content-Encoding": "gzip" });
    expect(res.status).toBe(200);
    expect(res.body.nhanDuoc.sheets).toHaveLength(50);
    expect(res.body.nhanDuoc.sheets[49].items).toHaveLength(200);
  });
});


// Trần giải nén ĂN THEO ROUTE — đúng như cách mount trong src/app.ts. Middleware này chạy TRƯỚC
// auth/rate-limit, nên nếu dùng trần chung 16MB thì người CHƯA đăng nhập bơm được 16MB vào bất kỳ
// endpoint nào. Chỉ nhóm báo giá (gói vốn lớn) được 16MB; phần còn lại giữ 2MB như express.json.
describe("trần giải nén hai tầng theo route (khớp cách mount trong app.ts)", () => {
  const dungAppHaiTang = () => {
    const app = express();
    app.use(["/api/quotes", "/api/quotes/*"], decompressBody(16 * 1024 * 1024));
    app.use(decompressBody(2 * 1024 * 1024));
    app.use(express.json({ limit: "16mb" }));
    app.post("/api/quotes/1", (req, res) => res.json({ ok: true, soSheet: req.body?.sheets?.length ?? 0 }));
    app.post("/api/settings", (req, res) => res.json({ ok: true }));
    return app;
  };
  // gói giải nén ra >2MB nhưng <16MB — ĐO THẬT chứ không ước lượng (lần đầu ước 12000 dòng "ra 3MB"
  // hoá ra chỉ 1,28MB, test xanh nhầm phía ngược lại)
  const goi3MB = () => {
    const chu = JSON.stringify({ sheets: [{ items: Array.from({ length: 30000 }, (_, i) => ({ name: "Hạng mục dài dài dài số " + i, quantity: 19.89, unitPrice: 65000, notes: "ghi chú thêm cho đủ dài" })) }] });
    if (Buffer.byteLength(chu) <= 2 * 1024 * 1024) throw new Error("dữ liệu test phải >2MB, đang " + Buffer.byteLength(chu));
    return zlib.gzipSync(Buffer.from(chu));
  };

  it("route báo giá: gói 3MB qua được (trần 16MB)", async () => {
    const res = await guiTai(dungAppHaiTang(), "/api/quotes/1", goi3MB(), { "Content-Type": "application/json", "Content-Encoding": "gzip" });
    expect(res.status).toBe(200);
    expect(res.body.soSheet).toBe(1);
  });

  it("route thường: cùng gói 3MB bị chặn 413 (trần 2MB)", async () => {
    const res = await guiTai(dungAppHaiTang(), "/api/settings", goi3MB(), { "Content-Type": "application/json", "Content-Encoding": "gzip" });
    expect(res.status).toBe(413);
  });

  it("route thường: gói nhỏ vẫn qua bình thường", async () => {
    const nen = zlib.gzipSync(Buffer.from(JSON.stringify({ a: 1 })));
    const res = await guiTai(dungAppHaiTang(), "/api/settings", nen, { "Content-Type": "application/json", "Content-Encoding": "gzip" });
    expect(res.status).toBe(200);
  });
});
