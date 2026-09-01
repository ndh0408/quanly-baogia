/**
 * CỤM auth-phien — nhóm endpoint TOKEN/INVITE không có limiter riêng (src/routes/auth.routes.ts).
 *
 * TÁI HIỆN: `loginLimiter` chỉ gắn ở /login và /token; `acceptInviteLimiter` chỉ ở /accept-invite.
 * `GET /invite/:token`, `POST /token/refresh`, `POST /token/revoke` KHÔNG có limiter nào của riêng
 * chúng — trần duy nhất là apiLimiter 120 req/phút cho TOÀN BỘ API.
 *
 * ĐÂY KHÔNG PHẢI VÁ MỘT LỖ HỔNG, và chú thích không được nói quá: token mời/đặt-lại là 48 ký tự hex,
 * không dò cạn được, còn refresh token là 64 ký tự hex. Giá trị thật của limiter ở đây là (a) sinh ra
 * tín hiệu 429 để phát hiện có người đang quét, (b) chặn chi phí truy vấn CSDL của một vòng lặp
 * request không cần đăng nhập.
 *
 * BÀI TEST ĐI QUA ĐÚNG LỚP CÓ LỖI — lớp GẮN middleware vào route: mount CHÍNH router thật rồi bắn
 * request qua HTTP. `createLimiter` bị thay bằng bản đếm thật (express-rate-limit, max 2) vì bản
 * trong src/rateLimit.ts CỐ Ý là no-op khi NODE_ENV=test (bộ đếm Redis dùng chung giữa các process
 * vitest song song sẽ gây 429 GIẢ) — nên KHÔNG thể khẳng định 429 thật của production từ đây.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import express from "express";
import request from "supertest";
import realRateLimit from "express-rate-limit";

// Thay createLimiter bằng limiter ĐẾM THẬT, trần 2, và 429 tự khai tên limiter đã chặn —
// nhờ đó test khẳng định được ĐÚNG limiter nào đang đứng trước từng route.
vi.mock("../src/rateLimit.js", () => ({
  createLimiter: (prefix) =>
    realRateLimit({
      windowMs: 60_000,
      max: 2,
      standardHeaders: false,
      legacyHeaders: false,
      handler: (_req, res) => res.status(429).json({ limiter: prefix }),
    }),
}));

const HEX48 = "a".repeat(48);
const REFRESH_GIA = "b".repeat(64);

describe("endpoint token/invite phải nằm sau một limiter riêng", () => {
  let app;

  beforeAll(async () => {
    const { default: authRoutes } = await import("../src/routes/auth.routes.js");
    app = express();
    app.use(express.json());
    app.use("/api/auth", authRoutes);
    // errorHandler tối giản: chỉ để lỗi CSDL không thành throw chưa bắt làm nhiễu.
    app.use((err, _req, res, _next) => res.status(err?.status || 500).json({ error: String(err?.message || err) }));
  });

  it("/token/refresh, /token/revoke và /invite/:token dùng CHUNG limiter 'auth-token'", async () => {
    // Hai request đầu tiêu hết quota của limiter dùng chung.
    await request(app).post("/api/auth/token/refresh").send({ refreshToken: REFRESH_GIA });
    await request(app).post("/api/auth/token/refresh").send({ refreshToken: REFRESH_GIA });

    const r1 = await request(app).post("/api/auth/token/refresh").send({ refreshToken: REFRESH_GIA });
    expect(r1.status).toBe(429);
    expect(r1.body.limiter).toBe("auth-token");

    // Cùng một bộ đếm → hai route còn lại cũng đã bị chặn, chứng minh chúng nằm sau CÙNG limiter.
    const r2 = await request(app).post("/api/auth/token/revoke").send({ refreshToken: REFRESH_GIA });
    expect(r2.status).toBe(429);
    expect(r2.body.limiter).toBe("auth-token");

    const r3 = await request(app).get(`/api/auth/invite/${HEX48}`);
    expect(r3.status).toBe(429);
    expect(r3.body.limiter).toBe("auth-token");
  });

  it("limiter của login KHÔNG dùng chung bộ đếm với nhóm token (mỗi limiter một kho riêng)", async () => {
    const r = await request(app).post("/api/auth/login").send({ username: "khong-ton-tai", password: "sai" });
    expect(r.status).not.toBe(429);
  });
});
