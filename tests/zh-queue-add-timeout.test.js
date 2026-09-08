// XẾP VIỆC VÀO HÀNG ĐỢI PHẢI CÓ TRẦN THỜI GIAN — chốt hồi quy (src/queue.ts xepViecCoHan).
//
// ── LỖI (ultracode audit vòng 2, 2026-09-08) ────────────────────────────────
// Kết nối BullMQ đặt `maxRetriesPerRequest: null` (BullMQ yêu cầu) → lệnh xếp hàng VÔ HẠN khi Redis
// "chạy nhưng chết" (TCP còn nhận, lệnh không hồi đáp — chú thích ở src/queue.ts ghi rõ là đã đo
// trên dev: container vẫn `running`, /readyz vẫn xanh). Mà `runOrQueue` chạy NGAY TRÊN ĐƯỜNG
// REQUEST: thông báo (src/notifications.ts) và webhook (src/webhooks.ts) bắn trong lúc LƯU BÁO GIÁ.
// Không có trần thì một Redis hấp hối làm lượt bấm Lưu treo tới khi Cloudflare trả 524 — người dùng
// mất phần đang gõ vì một việc PHỤ. File queue.ts đã áp đúng cách chữa này cho /metrics
// (QUEUE_DEPTH_TIMEOUT_MS + Promise.race) và viết hẳn lý lẽ; chỉ thiếu ở đường xếp việc.
//
// ⚠️ BÀI NÀY CỐ Ý KIỂM `xepViecCoHan` TRỰC TIẾP, KHÔNG ĐI QUA `runOrQueue`.
// Bản đầu đi qua runOrQueue và XANH VÌ LÝ DO SAI: `getQueue` dựng kết nối Redis thật, máy không có
// Redis nên `add` lỗi ECONNREFUSED ngay — nghĩa là bài xanh cả khi gỡ sạch cái trần đang muốn kiểm.
import { describe, it, expect } from "vitest";
import { xepViecCoHan } from "../src/queue.js";

const CTX = { queueName: "email", jobName: "send" };

describe("xepViecCoHan — Redis chạy-nhưng-chết không được treo request", () => {
  it("lượt xếp việc TREO MÃI → trả null quanh mốc trần, không treo vô hạn", async () => {
    const t0 = Date.now();
    const ra = await xepViecCoHan(() => new Promise(() => {}), CTX, 120);
    const ms = Date.now() - t0;
    expect(ra, "quá hạn thì BỎ việc phụ, không ném ra ngoài để khỏi làm hỏng lượt Lưu").toBeNull();
    expect(ms, `phải trả về quanh 120ms, đo được ${ms}ms`).toBeGreaterThanOrEqual(100);
    expect(ms).toBeLessThan(2000);
  });

  it("KHÔNG ném lỗi ra ngoài — nghiệp vụ chính (lưu báo giá) phải đi tiếp", async () => {
    await expect(xepViecCoHan(() => Promise.reject(new Error("redis toang")), CTX, 100)).resolves.toBeNull();
  });

  it("hàng đợi KHOẺ → trả về đúng job, không đụng gì (không phá đường đang chạy)", async () => {
    await expect(xepViecCoHan(async () => ({ id: "job-1" }), CTX, 500)).resolves.toEqual({ id: "job-1" });
  });

  it("việc xong NGAY dù trần rất ngắn → vẫn lấy được kết quả", async () => {
    await expect(xepViecCoHan(async () => "xong", CTX, 1)).resolves.toBe("xong");
  });

  it("không rò timer: xong sớm thì tiến trình không bị giữ lại bởi setTimeout", async () => {
    const truoc = process._getActiveHandles?.().length ?? 0;
    await xepViecCoHan(async () => 1, CTX, 30_000);
    const sau = process._getActiveHandles?.().length ?? 0;
    expect(sau, "clearTimeout trong finally phải dọn timer 30 giây").toBeLessThanOrEqual(truoc);
  });
});
