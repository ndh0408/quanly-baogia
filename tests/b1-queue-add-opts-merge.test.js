// Cụm hàng đợi — tuỳ chọn của CHỖ GỌI ghi đè NÔNG lên defaultJobOptions, xoá mất jitter.
//
// ── LỖI (uniform-job-options-across-queues, phần chưa đóng) ─────────────────
// src/queue.ts đặt `backoff: { type: "exponential", delay: 2000, jitter: 0.5 }` cho ba hàng đợi
// gọi dịch vụ NGOÀI. Nhưng BullMQ trộn NÔNG: node_modules/bullmq/dist/cjs/classes/queue.js:192
// `Object.assign(Object.assign({}, this.jobsOpts), opts)` — cả ĐỐI TƯỢNG `backoff` bị thay thế,
// không phải hợp nhất. Mà đường dispatch webhook DUY NHẤT (src/webhooks.ts:186) truyền
// `{ attempts: 5, backoff: { type: "exponential", delay: 5_000 } }` — không có jitter.
// Hệ quả: MỌI job webhook thật chạy KHÔNG jitter, tức đúng cái "thundering herd khi dịch vụ ngoài
// sống lại" mà bản vá trước tuyên bố đã đóng. tests/qs-queue-job-options.test.js không bắt được
// vì nó chỉ kiểm `jobOptionsFor()` và constructor `new Queue`, không đi qua điểm `add`.
//
// TÁI HIỆN: gọi runOrQueue đúng như webhooks.ts rồi soi đối số THẬT tới `queue.add`.
import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({ addArgs: [] }));

vi.mock("bullmq", () => ({
  Queue: class {
    constructor(name, opts) { this.name = name; this.jobsOpts = opts?.defaultJobOptions; }
    add(jobName, data, opts) { h.addArgs.push({ queue: this.name, jobName, data, opts }); return { id: "1" }; }
  },
  Worker: class { constructor() {} on() { return this; } },
}));
vi.mock("ioredis", () => ({ default: class { on() { return this; } } }));
vi.mock("../src/config.js", () => ({ config: { REDIS_URL: "redis://b1-fake:6379", NODE_ENV: "test" } }));

const { runOrQueue, QUEUES, jobOptionsFor } = await import("../src/queue.js");

beforeEach(() => { h.addArgs = []; });

describe("runOrQueue — tuỳ chọn của chỗ gọi KHÔNG được xoá jitter của hàng đợi", () => {
  it("webhook: giữ NGUYÊN attempts/delay do chỗ gọi đặt, nhưng jitter vẫn tới nơi", async () => {
    // Đúng lời gọi thật ở src/webhooks.ts (emit → runOrQueue).
    await runOrQueue(QUEUES.WEBHOOK, "deliver", { webhookId: 1, event: "quote.created", payload: {} },
      { attempts: 5, backoff: { type: "exponential", delay: 5_000 } });
    expect(h.addArgs.length).toBe(1);
    const o = h.addArgs[0].opts;
    // Hành vi nghiệp vụ KHÔNG đổi: webhook vẫn thử 5 lần, vẫn giãn từ 5s.
    expect(o.attempts).toBe(5);
    expect(o.backoff.delay).toBe(5_000);
    expect(o.backoff.type).toBe("exponential");
    // Và phần bị mất trước đây:
    expect(o.backoff.jitter, "jitter của hàng đợi webhook bị ghi đè mất").toBe(
      jobOptionsFor(QUEUES.WEBHOOK).backoff.jitter
    );
  });

  it("chỗ gọi tự đặt jitter thì TÔN TRỌNG, không ghi đè ngược", async () => {
    await runOrQueue(QUEUES.WEBHOOK, "deliver", {}, { backoff: { type: "fixed", delay: 100, jitter: 0.1 } });
    expect(h.addArgs[0].opts.backoff).toEqual({ type: "fixed", delay: 100, jitter: 0.1 });
  });

  it("hàng đợi KHÔNG có jitter mặc định (export/maintenance) thì không tự sinh ra jitter", async () => {
    await runOrQueue(QUEUES.EXPORT, "xlsx", { quoteId: 1 }, { backoff: { type: "exponential", delay: 1_000 } });
    expect(h.addArgs[0].opts.backoff.jitter).toBeUndefined();
  });

  it("không truyền opts thì không thêm gì — defaultJobOptions của Queue lo phần còn lại", async () => {
    await runOrQueue(QUEUES.EMAIL, "send", { to: "a@b.c" });
    expect(h.addArgs[0].opts).toEqual({});
  });
});
