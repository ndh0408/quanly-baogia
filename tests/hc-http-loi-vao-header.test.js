// HTTP-01 / HTTP-02 / HTTP-03 — lớp HTTP ngoài cùng (không cần CSDL).
//
// HTTP-01: decompressBody + express.json/urlencoded mount KHÔNG kèm path → mọi request ngoài /api
//   (POST /bat-ky, /readyz, /metrics) được giải nén + JSON.parse, trong khi apiLimiter chỉ ở /api/.
//   Quan sát được từ ngoài: thân JSON hỏng gửi tới đường ngoài /api nhận 400 (parser đã chạy) thay
//   vì 404 (không ai đọc thân).
// HTTP-02: CSP img-src 'self' data: chặn blob: → trang Nhân sự (compressImage dùng
//   URL.createObjectURL) không đính được ảnh chứng từ.
// HTTP-03: Referrer-Policy no-referrer (mặc định helmet) → Firefox/Safari có thể gửi Origin: null
//   cho POST cùng origin → csrfGuard 403 mọi thao tác ghi.
import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import zlib from "node:zlib";

let app;
beforeAll(async () => {
  const { createApp } = await import("../src/app.js");
  app = createApp();
});

describe("HTTP-01 — thân request chỉ được đọc dưới /api", () => {
  it("POST ngoài /api với JSON hỏng → không parse (404), không phải 400", async () => {
    const res = await request(app).post("/bat-ky-duong-nao").set("Content-Type", "application/json").send("{hỏng");
    expect(res.status).toBe(404);
  });

  it("POST ngoài /api với gzip rác → không giải nén (404), không phải 400", async () => {
    const res = await request(app).post("/khong-phai-api").set("Content-Type", "application/json").set("Content-Encoding", "gzip").send(Buffer.from("khong phai gzip"));
    expect(res.status).toBe(404);
  });

  it("POST /readyz với gzip JSON lớn → không giải nén", async () => {
    const goi = zlib.gzipSync(Buffer.from(JSON.stringify({ a: "x".repeat(500_000) })));
    const res = await request(app).post("/readyz").set("Content-Type", "application/json").set("Content-Encoding", "gzip").send(goi);
    // /readyz chỉ có GET → 404. 400/413 nghĩa là parser đã chạy trên thân.
    expect([400, 413, 415]).not.toContain(res.status);
  });

  it("dưới /api thân vẫn được parse như cũ (JSON hỏng → 400)", async () => {
    const res = await request(app).post("/api/auth/login").set("Content-Type", "application/json").send("{hỏng");
    expect(res.status).toBe(400);
  });

  it("dưới /api gzip vẫn được giải nén (gzip rác → 400)", async () => {
    const res = await request(app).post("/api/auth/login").set("Content-Type", "application/json").set("Content-Encoding", "gzip").send(Buffer.from("khong phai gzip"));
    expect(res.status).toBe(400);
  });
});

describe("HTTP-02/03 — header bảo mật của tài liệu", () => {
  it("CSP img-src cho phép blob: (nén ảnh chứng từ ở trang Nhân sự)", async () => {
    const res = await request(app).get("/livez");
    const imgSrc = (res.headers["content-security-policy"] || "").split(";").map((s) => s.trim()).find((d) => d.startsWith("img-src"));
    expect(imgSrc).toBeTruthy();
    expect(imgSrc.split(/\s+/)).toContain("blob:");
    expect(imgSrc.split(/\s+/)).toContain("data:");
    // Không nới sang mọi nguồn.
    expect(imgSrc).not.toMatch(/\*|https?:/);
  });

  it("Referrer-Policy là same-origin (không phải no-referrer)", async () => {
    const res = await request(app).get("/livez");
    expect(res.headers["referrer-policy"]).toBe("same-origin");
  });
});
