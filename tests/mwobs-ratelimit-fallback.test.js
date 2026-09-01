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
// ⚠️ MOCK NÀY PHẢI THEO KỊP src/queue.js. `createLimiter` bọc toàn bộ nhánh Redis trong try/catch và
// khi bắt được thì RƠI ÊM về MemoryStore. Nên một export thiếu ở đây KHÔNG ném ra ngoài — nó biến
// limiter Redis thành limiter bộ nhớ mà không ai thấy. Đúng chuyện vừa xảy ra: thêm
// `rateLimitRedisSanSang` vào src/queue.js mà quên mock → bài "vẫn dùng kho Redis" ở cuối file đỏ,
// và ĐÓ là bài duy nhất bắt được.
vi.mock("../src/queue.js", () => ({
  isQueueEnabled: () => true,
  isRateLimitRedisReady: () => redisSanSang.value,
  // Chờ kết nối lên MỘT lượt trước `SCRIPT LOAD` (xem chú thích trong src/rateLimit.ts).
  // Ở đây kết nối là giả nên sẵn sàng ngay.
  rateLimitRedisSanSang: () => Promise.resolve(),
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
    await request(app).get("/thu");
    // LỌC THEO NỘI DUNG LỆNH, KHÔNG THEO THỜI ĐIỂM.
    // Bản trước gọi `goiRedis.mockClear()` ngay sau `dungApp()` để bỏ hai lệnh `SCRIPT LOAD` của
    // `store.init()`. Cách đó ngầm giả định init chạy ĐỒNG BỘ — đúng cho tới khi src/rateLimit.ts
    // cho lượt lệnh đầu chờ kết nối lên (một microtask), lúc đó hai SCRIPT LOAD rơi SAU mockClear
    // và bài này đỏ dù hành vi không đổi.
    // Điều bài này thật sự muốn nói: ĐƯỜNG XỬ LÝ REQUEST không chạm Redis. `SCRIPT LOAD` là việc
    // của lúc dựng kho, không phải của request — nên loại nó ra theo TÊN LỆNH.
    const tren_request = goiRedis.mock.calls.filter((c) => c[0] !== "SCRIPT");
    expect(
      tren_request,
      `Redis chết mà request vẫn bắn lệnh: ${JSON.stringify(tren_request)}`,
    ).toEqual([]);
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
