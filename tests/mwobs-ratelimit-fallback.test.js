// Cụm middleware-obs — Redis chết là TẮT SẠCH mọi rate limiter.
//
// ── LỖI ─────────────────────────────────────────────────────────────────────
// src/rateLimit.ts đặt `opts.skip = () => !isRateLimitRedisReady();` bên trong `createLimiter`,
// nên nó áp cho MỌI limiter chứ không riêng đăng nhập. Phần chú thích biện minh chỉ đúng cho đăng
// nhập: khoá tài khoản khi sai mật khẩu nằm ở CSDL nên không mất. Nhưng các limiter còn lại KHÔNG
// có lớp CSDL dự phòng nào — /auth/forgot-password (không cần đăng nhập, 5 lần/15 phút), backup của
// admin, GDPR self-export, export, và apiLimiter chung.
//
// ── TÁI HIỆN ────────────────────────────────────────────────────────────────
// Dựng một limiter max=2 với Redis ở trạng thái KHÔNG sẵn sàng rồi gọi 3 lần: trước khi vá cả 3
// đều 200 (limiter bị bỏ qua hoàn toàn).
//
// ── HẬU QUẢ ─────────────────────────────────────────────────────────────────
// Trong lúc Redis chết, /forgot-password trở thành máy bơm email không giới hạn cho bất kỳ ai trên
// Internet, và một phiên admin bị chiếm có thể kéo dump không hạn chế. Đúng lúc hệ thống đang yếu
// nhất thì mọi trần bảo vệ biến mất.
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const redisSanSang = { value: false };

// NODE_ENV thật là "test", mà createLimiter cố ý trả no-op ở test → phải giả lập môi trường
// development để chạy đúng nhánh production của hàm.
vi.mock("../src/config.js", async (importOriginal) => {
  const that = await importOriginal();
  return { ...that, config: { ...that.config, NODE_ENV: "development", REDIS_URL: "redis://gia-lap:6379" }, isProd: false };
});

const goiRedis = vi.fn();
vi.mock("../src/queue.js", () => ({
  isQueueEnabled: () => true,
  isRateLimitRedisReady: () => redisSanSang.value,
  getRateLimitRedis: () => ({
    call: async (...args) => {
      goiRedis(...args);
      // SCRIPT LOAD → sha; EVALSHA → [totalHits, timeToExpire]
      return args[0] === "SCRIPT" ? "sha-gia-lap" : [1, 60_000];
    },
  }),
}));

const { createLimiter } = await import("../src/rateLimit.js");

function dungApp(max) {
  const app = express();
  app.use("/thu", createLimiter("mwobs", { windowMs: 60_000, max, message: { error: "quá nhiều" } }));
  app.get("/thu", (_req, res) => res.json({ ok: true }));
  return app;
}

describe("createLimiter khi Redis KHÔNG sẵn sàng", () => {
  beforeEach(() => { redisSanSang.value = false; goiRedis.mockClear(); });

  it("vẫn phải chặn — không được bỏ qua limiter hoàn toàn", async () => {
    const app = dungApp(2);
    const ma = [];
    for (let i = 0; i < 4; i++) ma.push((await request(app).get("/thu").set("X-Forwarded-For", "203.0.113.9")).status);
    expect(ma.slice(0, 2)).toEqual([200, 200]);
    expect(ma.slice(2)).toEqual([429, 429]);
  });

  it("không gọi Redis khi Redis đang chết (không treo request chờ lệnh trượt)", async () => {
    const app = dungApp(2);
    goiRedis.mockClear(); // bỏ qua SCRIPT LOAD lúc dựng kho — chỉ quan tâm lệnh trên đường request
    await request(app).get("/thu");
    expect(goiRedis).not.toHaveBeenCalled();
  });

  it("bộ đếm dự phòng tính RIÊNG từng limiter (prefix khác nhau không dùng chung quota)", async () => {
    const app = express();
    app.use("/a", createLimiter("mwobs-a", { windowMs: 60_000, max: 1 }));
    app.get("/a", (_req, res) => res.json({ ok: true }));
    app.use("/b", createLimiter("mwobs-b", { windowMs: 60_000, max: 1 }));
    app.get("/b", (_req, res) => res.json({ ok: true }));
    expect((await request(app).get("/a")).status).toBe(200);
    expect((await request(app).get("/b")).status).toBe(200); // limiter khác → chưa cạn
    expect((await request(app).get("/a")).status).toBe(429);
  });
});

describe("createLimiter khi Redis SẴN SÀNG", () => {
  beforeEach(() => { redisSanSang.value = true; goiRedis.mockClear(); });

  it("vẫn dùng kho Redis (bộ đếm dùng chung giữa các instance), không rơi về bộ nhớ", async () => {
    const app = dungApp(2);
    const r = await request(app).get("/thu");
    expect(r.status).toBe(200);
    expect(goiRedis).toHaveBeenCalled();
  });
});
