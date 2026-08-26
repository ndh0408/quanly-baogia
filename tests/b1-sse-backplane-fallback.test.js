// Cụm SSE/quan trắc — backplane Redis hỏng vẫn "âm thầm", và còn giết luôn realtime CỤC BỘ.
//
// ── LỖI (sse-backplane-silent-degradation, phần chưa đóng) ──────────────────
// Bản vá trước thêm gauge `sse_backplane_up` + counter lỗi và bỏ `catch(() => {})`. Nhưng:
//
//  (a) `pub` KHÔNG BAO GIỜ được đặt lại về null khi Redis chết, nên `publish()`/`broadcast()` vẫn
//      đi đường Redis và KHÔNG rơi về `localPublish`. Hệ quả nặng hơn mô tả gốc: mất realtime CẢ
//      với client đang nối vào CHÍNH instance đó, không chỉ mất đồng bộ giữa các instance.
//  (b) Không có handler `on("ready")` nào đặt gauge về 1 — một lỗi thoáng qua ghim `sse_backplane_up`
//      ở 0 VĨNH VIỄN dù Redis đã sống lại. Cảnh báo dựa trên số này thành vô dụng sau lần rung đầu.
//  (c) Gauge chỉ được `.set(1)` bên trong `if (config.REDIS_URL)`. Bản triển khai KHÔNG dùng Redis
//      (hoàn toàn hợp lệ — sse.ts:5 nói rõ) báo `sse_backplane_up 0` ngay từ lúc cài: báo động giả
//      vĩnh viễn. Xem tests/b1-sse-no-redis.test.js cho nhánh này.
import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({ instances: [], publishOk: true }));

vi.mock("ioredis", () => {
  class FakeRedis {
    constructor(url, opts) { this.opts = opts; this.handlers = {}; h.instances.push(this); }
    on(ev, fn) { (this.handlers[ev] ||= []).push(fn); return this; }
    phat(ev, ...a) { for (const f of this.handlers[ev] || []) f(...a); }
    async subscribe() { return 1; }
    publish() { return h.publishOk ? Promise.resolve(1) : Promise.reject(new Error("Redis down")); }
  }
  return { default: FakeRedis };
});
vi.mock("../src/config.js", () => ({ config: { REDIS_URL: "redis://b1-fake:6379", NODE_ENV: "test" } }));

const sse = await import("../src/sse.js");
const { registry } = await import("../src/observability.js");
await new Promise((r) => setTimeout(r, 20)); // để IIFE khởi tạo backplane chạy xong

const pubClient = () => h.instances[0];
const gauge = async () => (await registry.getSingleMetric("sse_backplane_up").get()).values[0].value;
const demLoi = async () => {
  const v = (await registry.getSingleMetric("sse_backplane_errors_total").get()).values;
  return v.reduce((n, x) => n + x.value, 0);
};

/** res giả tối thiểu cho attach. */
function gia() {
  const hs = {};
  const res = {
    daGhi: [], writableLength: 0,
    setHeader() {}, flushHeaders() {}, status() { return this; }, json() { return this; },
    write(s) { this.daGhi.push(s); return true; }, end() {}, destroy() { hs.close?.(); },
  };
  return { req: { on(ev, fn) { hs[ev] = fn; } }, res, dong: () => hs.close?.() };
}

beforeEach(() => { h.publishOk = true; });

describe("SSE backplane — hỏng thì phải NÓI và phải vẫn phát được cục bộ", () => {
  it("khởi tạo xong thì sse_backplane_up = 1", async () => {
    expect(await gauge()).toBe(1);
  });

  it("PUBLISH lỗi → sự kiện VẪN tới client đang nối vào chính tiến trình này", async () => {
    const uid = 920001;
    const c = gia();
    sse.attach(c.req, c.res, uid);
    h.publishOk = false;
    const truoc = await demLoi();

    sse.publish(uid, "thu", { a: 1 });
    await new Promise((r) => setTimeout(r, 10)); // .catch() chạy ở microtask kế

    expect(c.res.daGhi.some((s) => s.includes("event: thu")), "mất realtime cả với client cùng tiến trình").toBe(true);
    expect(await gauge()).toBe(0);
    expect(await demLoi()).toBeGreaterThan(truoc);
    c.dong();
  });

  it("BROADCAST lỗi cũng rơi về phát cục bộ", async () => {
    const c = gia();
    sse.attach(c.req, c.res, 920002);
    h.publishOk = false;
    sse.broadcast("changed", { entity: "quote", action: "update" });
    await new Promise((r) => setTimeout(r, 10));
    expect(c.res.daGhi.some((s) => s.includes("event: changed"))).toBe(true);
    c.dong();
  });

  it("Redis sống lại → gauge trở về 1, không ghim ở 0 vĩnh viễn", async () => {
    pubClient().phat("error", new Error("ECONNRESET"));
    expect(await gauge()).toBe(0);
    pubClient().phat("ready");
    expect(await gauge(), "không có handler ready → cảnh báo kẹt ở 0 sau lần rung đầu tiên").toBe(1);
  });
});
