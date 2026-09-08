// processors[NOTIFY].telegram PHẢI NÉM khi gửi Telegram hỏng — chốt hồi quy (ultracode audit
// 2026-09-09, finding M-NOTIFY).
//
// ── LỖI ──────────────────────────────────────────────────────────────────────
// Cùng lớp bug đã vá cho EMAIL một ngày trước (xem tests/x1-xuat-nen-nguoi-dung-khong-ket.test.js)
// nhưng bỏ sót ở nhánh Telegram liền kề: `sendTelegram` CỐ Ý không ném (trả `{error}`) để chỗ gọi
// đồng bộ tự quyết. Nhưng ở HÀNG ĐỢI, "resolve" nghĩa là BullMQ đánh dấu job THÀNH CÔNG và KHÔNG
// BAO GIỜ thử lại — thông báo mất mà sổ việc vẫn xanh (chat bị chặn, chat_id sai, rate-limit,
// timeout mạng).
//
// Bài dưới gọi THẲNG `processors[QUEUES.NOTIFY].telegram` (đúng hàm BullMQ thật sự chạy khi xử lý
// job) với `sendTelegram` bị mock trả `{error}` — không cần Redis/mạng thật.
import { describe, it, expect, vi } from "vitest";

vi.mock("../src/telegram.js", () => ({ sendTelegram: vi.fn() }));

const { sendTelegram } = await import("../src/telegram.js");
const { processors } = await import("../src/worker.js");
const { QUEUES } = await import("../src/queue.js");

describe("processors[NOTIFY].telegram — phải ném khi gửi hỏng", () => {
  it("sendTelegram trả {error} → processor NÉM (không resolve êm)", async () => {
    sendTelegram.mockResolvedValueOnce({ error: "chat bị chặn" });
    await expect(processors[QUEUES.NOTIFY].telegram({ data: { chatId: "1", text: "x" } }))
      .rejects.toThrow(/chat bị chặn/);
  });

  it("sendTelegram gửi THÀNH CÔNG (không có error) → processor resolve bình thường", async () => {
    sendTelegram.mockResolvedValueOnce({ ok: true });
    await expect(processors[QUEUES.NOTIFY].telegram({ data: { chatId: "1", text: "x" } }))
      .resolves.toEqual({ ok: true });
  });
});
