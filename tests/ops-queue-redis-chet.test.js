/**
 * OPS · OBS-12 — đo độ sâu hàng đợi KHÔNG được gửi lệnh khi Redis chưa sẵn sàng.
 *
 * LỖI (c450a46): capNhatDoSauHangDoi() gọi `getJobCounts` trên hàng đợi BullMQ (kết nối
 * maxRetriesPerRequest: null + offline queue). Redis chết → lệnh nằm lại trong hàng đợi ngoại tuyến
 * VÔ HẠN (Promise.race chỉ bỏ mặc, lệnh vẫn còn), mỗi lượt scrape × 2 tiến trình × 5 hàng đợi, rồi xả
 * dồn khi Redis sống lại — đúng thứ `doRedis` (src/observability.ts) cố ý tránh cho PING.
 *
 * TÁI HIỆN: REDIS_URL trỏ vào cổng không ai nghe → kết nối không bao giờ "ready". Mã cũ gọi
 * getJobCounts cho cả 5 hàng đợi; mã mới trả false ngay và không gọi lần nào.
 */
import { describe, it, expect, vi, afterAll } from "vitest";
import { Queue } from "bullmq";

vi.hoisted(() => {
  process.env.REDIS_URL = "redis://127.0.0.1:1/0";
  process.env.QUEUE_DEPTH_TIMEOUT_MS = "300";
});

const q = await import("../src/queue.js");

afterAll(() => {
  try { q.getRedis()?.disconnect(); } catch { /* bỏ qua */ }
});

describe("OBS-12 — Redis chưa sẵn sàng thì không gửi getJobCounts", () => {
  it("trả false và KHÔNG gọi getJobCounts lần nào", async () => {
    const goi = vi.spyOn(Queue.prototype, "getJobCounts");
    const ok = await q.capNhatDoSauHangDoi();
    expect(ok).toBe(false);
    expect(goi, "getJobCounts gửi lúc Redis chết → nằm lại trong offline queue vô hạn").not.toHaveBeenCalled();
  });
});
