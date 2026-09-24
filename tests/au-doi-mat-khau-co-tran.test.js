/**
 * AUTH-03 — POST /api/auth/change-password KHÔNG ĐƯỢC LÀ MÁY DÒ MẬT KHẨU CŨ KHÔNG TRẦN.
 *
 * Trước bản vá: route chỉ có requireAuth + validate. Sai `oldPassword` trả 401, không tăng bộ đếm
 * nào, không limiter riêng — chỉ vướng apiLimiter 120/phút/IP. Một phiên bị bỏ quên là đủ để dò
 * mật khẩu cũ rồi chiếm tài khoản lâu dài.
 *
 * Bài này thay `createLimiter` bằng express-rate-limit THẬT với ĐÚNG options mà route khai (trong
 * môi trường test createLimiter là no-op), nên nó đo chính cấu hình production: trần, khoá, và
 * luật "chỉ lần sai mới tính".
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import express from "express";
import request from "supertest";
import realRateLimit from "express-rate-limit";

vi.mock("../src/rateLimit.js", () => ({
  createLimiter: (prefix, options = {}) =>
    realRateLimit({
      windowMs: 60_000, max: 1000, standardHeaders: false, legacyHeaders: false, ...options,
      handler: (_req, res) => res.status(429).json({ limiter: prefix }),
    }),
}));

const DUNG = "MatKhauCu123x";
vi.mock("../src/services/authService.js", async (goc) => {
  const that = await goc();
  const { httpError } = await import("../src/httpError.js");
  return {
    ...that,
    changePassword: async (req) => {
      if (req.body.oldPassword !== DUNG) throw httpError(401, "Mật khẩu cũ không đúng");
      return { ok: true };
    },
  };
});

describe("AUTH-03 — trần thử mật khẩu cũ theo tài khoản", () => {
  let app;
  beforeAll(async () => {
    const { default: authRoutes } = await import("../src/routes/auth.routes.js");
    app = express();
    app.use(express.json());
    // Phiên giả: userId lấy từ header để hai "tài khoản" có bộ đếm riêng.
    app.use((req, _res, next) => { req.session = { userId: Number(req.headers["x-uid"] || 0) || undefined }; next(); });
    app.use("/api/auth", authRoutes);
    app.use((err, _req, res, _next) => res.status(err?.status || 500).json({ error: String(err?.message || err) }));
  });

  const doi = (uid, oldPassword) =>
    request(app).post("/api/auth/change-password").set("x-uid", String(uid)).send({ oldPassword, newPassword: "MatKhauMoi456y" });

  it("5 lần sai → lần thứ 6 bị 429 KỂ CẢ khi đúng", async () => {
    for (let i = 0; i < 5; i++) expect((await doi(101, `Sai${i}abcdef`)).status).toBe(401);
    const r = await doi(101, DUNG);
    expect(r.status, "không có trần theo tài khoản — dò mật khẩu cũ không giới hạn").toBe(429);
    expect(r.body.limiter).toBe("change-pw");
  });

  it("đổi THÀNH CÔNG không tiêu quota; bộ đếm tách theo tài khoản", async () => {
    for (let i = 0; i < 8; i++) expect((await doi(202, DUNG)).status).toBe(200);
    for (let i = 0; i < 4; i++) expect((await doi(202, `Sai${i}abcdef`)).status).toBe(401);
    expect((await doi(202, DUNG)).status).toBe(200);
    // Tài khoản 101 bị chặn ở bài trên không kéo theo tài khoản khác.
    expect((await doi(303, DUNG)).status).toBe(200);
  });

  it("mật khẩu MỚI bị chính sách từ chối (400) không tính là lần dò", async () => {
    for (let i = 0; i < 7; i++) {
      const r = await request(app).post("/api/auth/change-password").set("x-uid", "404").send({ oldPassword: DUNG, newPassword: "ngan" });
      expect(r.status).toBe(400);
    }
    expect((await doi(404, DUNG)).status).toBe(200);
  });
});
