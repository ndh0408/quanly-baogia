// Cụm queue-storage — tuỳ chọn job/worker của BullMQ (src/queue.ts).
//
// LỖI 1 — MỘT bộ defaultJobOptions cho CẢ 5 hàng đợi (uniform-job-options-across-queues).
//   Tái hiện: `getQueue()` cũ luôn dựng Queue với `{ removeOnComplete: 1000, removeOnFail: 5000 }`
//   — trần thuần theo SỐ LƯỢNG, không có trần theo TUỔI. Hàng đợi ít việc (maintenance chạy 1
//   lần/ngày) giữ bản ghi job tới hàng năm trong Redis; và backoff exponential KHÔNG có jitter
//   nên khi dịch vụ ngoài (SMTP/webhook) sập rồi sống lại, mọi job hỏng cùng lúc thức dậy CÙNG
//   một mốc và đấm dịch vụ vừa hồi phục thêm lần nữa.
//
// LỖI 2 — worker KHÔNG có lockDuration riêng cho hàng đợi xuất file
//   (bullmq-export-blocks-worker-loop-stalls). `createWorker()` cũ chỉ truyền
//   `{ connection, concurrency }` → BullMQ dùng lockDuration 30s mặc định, gia hạn bằng TIMER mỗi
//   15s; processor xuất file chẹn vòng lặp lâu hơn thế → khoá hết hạn → job bị coi là "stalled",
//   đánh hỏng rồi dựng lại DÙ FILE ĐÃ SINH XONG.
//
// LỖI 3 — `jobOptionsFor` trả về CHÍNH đối tượng module-level theo THAM CHIẾU: một chỗ gọi vô ý
//   ghi đè `attempts`/`backoff` là đổi cấu hình của MỌI hàng đợi dựng sau đó.
//
// VÌ SAO TEST NÀY GIẢ LẬP `bullmq`: bảng hằng số tự nó không chứng minh được gì — điều phải chứng
// minh là DÂY NỐI, tức giá trị ấy thật sự tới constructor `Queue`/`Worker`. Gỡ
// `defaultJobOptions` ở getQueue hay `...workerOptionsFor(...)` ở createWorker thì test này ĐỎ.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const h = vi.hoisted(() => ({ queueArgs: [], workerArgs: [] }));

vi.mock("bullmq", () => ({
  Queue: class {
    constructor(name, opts) { h.queueArgs.push({ name, opts }); this.name = name; }
  },
  Worker: class {
    constructor(name, handler, opts) { h.workerArgs.push({ name, handler, opts }); this.name = name; }
    on() { return this; }
  },
}));

// Redis thật không cần thiết (và không được phép) cho phép kiểm dây nối.
vi.mock("ioredis", () => ({ default: class { on() { return this; } } }));
vi.mock("../src/config.js", () => ({ config: { REDIS_URL: "redis://qs-test-fake:6379", NODE_ENV: "test" } }));

const { jobOptionsFor, workerOptionsFor, getQueue, createWorker, QUEUES } = await import("../src/queue.js");
const queueMod = await import("../src/queue.js");

beforeEach(() => {
  h.queueArgs = [];
  h.workerArgs = [];
});

describe("jobOptionsFor — trần theo TUỔI, không chỉ theo số lượng", () => {
  it("mọi hàng đợi đều có trần tuổi cho job đã xong và job hỏng", () => {
    for (const name of Object.values(QUEUES)) {
      const o = jobOptionsFor(name);
      expect(typeof o.removeOnComplete, `${name}.removeOnComplete`).toBe("object");
      expect(o.removeOnComplete.age, `${name}.removeOnComplete.age`).toBeGreaterThan(0);
      expect(o.removeOnComplete.count, `${name}.removeOnComplete.count`).toBeGreaterThan(0);
      expect(o.removeOnFail.age, `${name}.removeOnFail.age`).toBeGreaterThan(0);
      expect(o.removeOnFail.count, `${name}.removeOnFail.count`).toBeGreaterThan(0);
    }
  });

  it("file xuất ra hết hạn tải sau 24h nên KHÔNG giữ job xuất lâu bằng job email", () => {
    expect(jobOptionsFor(QUEUES.EXPORT).removeOnComplete.age)
      .toBeLessThan(jobOptionsFor(QUEUES.EMAIL).removeOnComplete.age);
  });

  it("hàng đợi gọi dịch vụ NGOÀI (email/webhook/notify) có jitter để tránh thundering herd", () => {
    for (const name of [QUEUES.EMAIL, QUEUES.WEBHOOK, QUEUES.NOTIFY]) {
      expect(jobOptionsFor(name).backoff.jitter, `${name}.backoff.jitter`).toBeGreaterThan(0);
    }
  });

  it("giữ nguyên số lần thử lại đang chạy production (3) — không đổi hành vi nghiệp vụ", () => {
    for (const name of Object.values(QUEUES)) expect(jobOptionsFor(name).attempts, name).toBe(3);
  });

  it("hàng đợi lạ (không có trong bảng) vẫn nhận được bộ mặc định hợp lệ", () => {
    const o = jobOptionsFor("qs-khong-co-that");
    expect(o.attempts).toBe(3);
    expect(o.removeOnComplete.age).toBeGreaterThan(0);
  });

  it("trả BẢN SAO — sửa kết quả của một chỗ gọi KHÔNG được rò sang hàng đợi khác", () => {
    // Đối tượng module-level trả theo tham chiếu là cái bẫy im lặng: `jobOptionsFor(x).attempts = 5`
    // ở một nơi nào đó đổi số lần thử lại của MỌI hàng đợi dựng sau đó, không lỗi, không log.
    const a = jobOptionsFor(QUEUES.EMAIL);
    a.attempts = 99;
    a.backoff.delay = 999_999;
    a.removeOnComplete.count = 1;
    expect(jobOptionsFor(QUEUES.EMAIL).attempts).toBe(3);
    expect(jobOptionsFor(QUEUES.EMAIL).backoff.delay).toBe(2000);
    expect(jobOptionsFor(QUEUES.WEBHOOK).attempts).toBe(3);
    // Hàng đợi khác nhau phải là những đối tượng KHÁC NHAU, không dùng chung một thể hiện.
    expect(jobOptionsFor(QUEUES.EMAIL)).not.toBe(jobOptionsFor(QUEUES.WEBHOOK));
    // Bộ mặc định (nguồn của mọi nhánh) cũng không được nhiễm.
    const d = jobOptionsFor("qs-khong-co-that");
    expect(d.attempts).toBe(3);
    expect(d.backoff.delay).toBe(2000);
    expect(d.removeOnComplete.count).toBeGreaterThan(1);
  });
});

describe("DÂY NỐI — tuỳ chọn phải tới đúng constructor của BullMQ", () => {
  it("getQueue truyền defaultJobOptions RIÊNG của hàng đợi vào `new Queue`", () => {
    getQueue(QUEUES.EXPORT);
    const call = h.queueArgs.find((c) => c.name === QUEUES.EXPORT);
    expect(call, "không có lượt `new Queue` nào cho hàng đợi export").toBeTruthy();
    expect(call.opts.defaultJobOptions).toBeTruthy();
    expect(call.opts.defaultJobOptions.removeOnComplete.age)
      .toBe(jobOptionsFor(QUEUES.EXPORT).removeOnComplete.age);
    expect(call.opts.defaultJobOptions.removeOnFail.age).toBeGreaterThan(0);
    expect(call.opts.connection).toBeTruthy();
  });

  it("getQueue dùng bộ tuỳ chọn ĐÚNG cho hàng đợi ngoài (jitter tới được BullMQ)", () => {
    getQueue(QUEUES.WEBHOOK);
    const call = h.queueArgs.find((c) => c.name === QUEUES.WEBHOOK);
    expect(call.opts.defaultJobOptions.backoff.jitter).toBeGreaterThan(0);
  });

  it("createWorker truyền lockDuration/stalledInterval/concurrency THẬT vào `new Worker` (export)", () => {
    createWorker(QUEUES.EXPORT, async () => {}, 4);
    const call = h.workerArgs.find((c) => c.name === QUEUES.EXPORT);
    expect(call, "không có lượt `new Worker` nào cho hàng đợi export").toBeTruthy();
    // Sinh file Excel/PDF chẹn vòng lặp sự kiện; 30s mặc định của BullMQ là quá ngắn.
    expect(call.opts.lockDuration).toBeGreaterThanOrEqual(120_000);
    expect(call.opts.stalledInterval).toBeGreaterThanOrEqual(60_000);
    // Việc nặng CPU: không chạy 4 job cùng lúc trong một tiến trình worker.
    expect(call.opts.concurrency).toBeLessThanOrEqual(2);
    expect(call.opts.concurrency).toBeGreaterThanOrEqual(1);
  });

  it("createWorker GIỮ NGUYÊN hành vi cũ cho hàng đợi nhẹ: chỉ concurrency + connection", () => {
    createWorker(QUEUES.EMAIL, async () => {}, 4);
    const call = h.workerArgs.find((c) => c.name === QUEUES.EMAIL);
    expect(call.opts.concurrency).toBe(4);
    expect(call.opts.lockDuration).toBeUndefined();
    expect(call.opts.stalledInterval).toBeUndefined();
  });
});

describe("workerOptionsFor — bảng tuỳ chọn", () => {
  it("các hàng đợi nhẹ giữ NGUYÊN hành vi cũ: chỉ concurrency, dùng mặc định của BullMQ", () => {
    for (const name of [QUEUES.EMAIL, QUEUES.WEBHOOK, QUEUES.NOTIFY, QUEUES.MAINTENANCE]) {
      expect(workerOptionsFor(name, 4), name).toEqual({ concurrency: 4 });
    }
  });
});

describe("mã chết", () => {
  it("createQueueEvents đã được gỡ và KHÔNG còn chỗ nào trong src/ nhắc tới", () => {
    expect(queueMod.createQueueEvents).toBeUndefined();
    const root = fileURLToPath(new URL("../src", import.meta.url));
    const walk = (dir) => readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
    const hits = walk(root).filter((p) => /\.(ts|js)$/.test(p) && readFileSync(p, "utf8").includes("createQueueEvents"));
    expect(hits).toEqual([]);
  });
});
