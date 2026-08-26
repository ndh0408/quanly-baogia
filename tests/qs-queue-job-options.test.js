// Cụm queue-storage — tuỳ chọn job/worker của BullMQ (src/queue.ts).
//
// LỖI 1 — MỘT bộ defaultJobOptions cho CẢ 5 hàng đợi (uniform-job-options-across-queues).
//   Tái hiện: `getQueue()` cũ luôn dựng Queue với `{ removeOnComplete: 1000, removeOnFail: 5000 }`
//   — trần thuần theo SỐ LƯỢNG, không có trần theo TUỔI. Hàng đợi ít việc (maintenance chạy 1
//   lần/ngày) giữ bản ghi job tới hàng năm trong Redis; và backoff exponential KHÔNG có jitter
//   nên khi dịch vụ ngoài (SMTP/webhook) sập rồi sống lại, mọi job hỏng cùng lúc thức dậy CÙNG
//   một mốc và đấm dịch vụ vừa hồi phục thêm lần nữa.
//   Hậu quả: rác tồn đọng trong Redis 256MB `noeviction` (Redis từ chối ghi = cả hệ hàng đợi
//   đứng) và thundering-herd mỗi lần dịch vụ ngoài chập chờn.
//
// LỖI 2 — worker KHÔNG có lockDuration riêng cho hàng đợi xuất file
//   (bullmq-export-blocks-worker-loop-stalls).
//   Tái hiện: `createWorker()` cũ chỉ truyền `{ connection, concurrency }`; BullMQ dùng mặc định
//   lockDuration 30s, gia hạn khoá bằng TIMER mỗi 15s. Nhưng processor xuất file gọi thẳng
//   `buildQuoteBuffer`/`renderQuotePdf` trên vòng lặp sự kiện của tiến trình worker — báo giá
//   lớn chẹn vòng lặp lâu hơn 30s thì timer gia hạn KHÔNG chạy được, khoá hết hạn.
//   Hậu quả: BullMQ coi job là "stalled", đánh hỏng rồi dựng lại DÙ FILE ĐÃ SINH XONG — client
//   thấy failed, bấm lại, và CPU bị đốt gấp đôi cho cùng một báo giá.
//
// LỖI 3 — mã chết (queue-dead-code-and-readyz-blind): `createQueueEvents` không có nơi nào gọi.
import { describe, it, expect } from "vitest";
import * as queue from "../src/queue.js";
import { jobOptionsFor, workerOptionsFor, QUEUES } from "../src/queue.js";

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
});

describe("workerOptionsFor — khoá job xuất file phải sống lâu hơn một lượt sinh file", () => {
  it("hàng đợi export nới lockDuration và giãn nhịp dò stalled", () => {
    const o = workerOptionsFor(QUEUES.EXPORT, 4);
    // Sinh file Excel/PDF chẹn vòng lặp sự kiện; 30s mặc định của BullMQ là quá ngắn.
    expect(o.lockDuration).toBeGreaterThanOrEqual(120_000);
    expect(o.stalledInterval).toBeGreaterThanOrEqual(60_000);
    // Việc nặng CPU: không chạy 4 job cùng lúc trong một tiến trình worker.
    expect(o.concurrency).toBeLessThanOrEqual(2);
  });

  it("các hàng đợi nhẹ giữ NGUYÊN hành vi cũ: chỉ concurrency, dùng mặc định của BullMQ", () => {
    for (const name of [QUEUES.EMAIL, QUEUES.WEBHOOK, QUEUES.NOTIFY, QUEUES.MAINTENANCE]) {
      expect(workerOptionsFor(name, 4), name).toEqual({ concurrency: 4 });
    }
  });
});

describe("mã chết", () => {
  it("createQueueEvents đã được gỡ (không nơi nào trong src/ hay web/src gọi tới)", () => {
    expect(queue.createQueueEvents).toBeUndefined();
  });
});
