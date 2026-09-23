// RT-01 — Redis còn "ready" nhưng LỆNH lỗi không được làm mọi /api trả 500.
//
// ── LỖI ─────────────────────────────────────────────────────────────────────
// src/rateLimit.ts chỉ rơi về limiter bộ nhớ khi `isRateLimitRedisReady()` là false (kết nối rớt
// hẳn). Khi kết nối còn "ready" mà lệnh bị từ chối — `OOM command not allowed when used memory >
// 'maxmemory'` (noeviction), LOADING, READONLY, hay commandTimeout khi Redis treo — RedisStore ném,
// express-rate-limit (passOnStoreError mặc định false) gọi next(err) → errorHandler 500. apiLimiter
// đứng trước mọi route kể cả /api/auth/login, nên cả ứng dụng không dùng được.
// tests/mwobs-ratelimit-fallback.test.js chỉ phủ "Redis chết" và "Redis khoẻ", không phủ ca này.
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("../src/config.js", async (importOriginal) => {
  const that = await importOriginal();
  return { ...that, config: { ...that.config, NODE_ENV: "development", REDIS_URL: "redis://gia-lap:6379" }, isProd: false };
});

// Kết nối LUÔN "ready"; lệnh EVALSHA (đếm) bị Redis từ chối khi `loiLenh` bật.
const trangThai = { loiLenh: true };
vi.mock("../src/queue.js", () => ({
  isQueueEnabled: () => true,
  isRateLimitRedisReady: () => true,
  rateLimitRedisSanSang: () => Promise.resolve(),
  getRateLimitRedis: () => ({
    call: async (...args) => {
      if (args[0] === "SCRIPT") return "sha-gia-lap";
      if (trangThai.loiLenh) throw new Error("OOM command not allowed when used memory > 'maxmemory'.");
      return [1, 60_000];
    },
  }),
}));

const { createLimiter } = await import("../src/rateLimit.js");

function dungApp(max) {
  const app = express();
  app.use("/api/", createLimiter("rt01", { windowMs: 60_000, max, message: { error: "quá nhiều" } }));
  app.post("/api/auth/login", (_req, res) => res.json({ ok: true }));
  // Giống errorHandler thật: lỗi lọt xuống đây là 500.
  app.use((_err, _req, res, _next) => res.status(500).json({ error: "Lỗi server" }));
  return app;
}

describe("createLimiter — Redis ready nhưng lệnh lỗi", () => {
  beforeEach(() => { trangThai.loiLenh = true; });

  it("đăng nhập KHÔNG bị 500 — đi qua limiter bộ nhớ", async () => {
    const app = dungApp(5);
    const res = await request(app).post("/api/auth/login").send({});
    expect(res.status, "Redis từ chối lệnh làm /api/auth/login trả 500").toBe(200);
  });

  it("limiter bộ nhớ vẫn CHẶN khi vượt trần (không phải bỏ hẳn giới hạn)", async () => {
    const app = dungApp(2);
    const ma = [];
    for (let i = 0; i < 4; i++) ma.push((await request(app).post("/api/auth/login").send({})).status);
    expect(ma).toEqual([200, 200, 429, 429]);
  });

  it("Redis hết lỗi thì vẫn dùng kho Redis như cũ", async () => {
    trangThai.loiLenh = false;
    const app = dungApp(5);
    const res = await request(app).post("/api/auth/login").send({});
    expect(res.status).toBe(200);
  });
});
