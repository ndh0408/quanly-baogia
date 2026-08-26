// Cụm queue-storage — cổng giới hạn đồng thời khi XUẤT FILE (src/exportQueue.ts).
//
// LỖI 1 — người xếp hàng KHÔNG BAO GIỜ bỏ được chỗ (export-gate-no-abort-no-deadline).
//   Tái hiện: `acquire()` cũ là `new Promise((resolve) => waiters.push(resolve))` — chỉ có
//   `resolve`, không nhận AbortSignal, không có đường gỡ khỏi mảng `waiters`. Khách bấm xuất
//   file rồi ĐÓNG TAB: request chết, nhưng resolver vẫn nằm trong hàng đợi, vẫn được cấp chỗ,
//   và hệ thống vẫn nghiến CPU sinh ra một file KHÔNG AI NHẬN.
//   Hậu quả: mỗi lượt huỷ vẫn ăn trọn một suất trong `maxActive` (mặc định 3) và một suất
//   trong `maxPending` (mặc định 20) — người còn ở lại chờ lâu hơn, hoặc bị 503 oan, trong khi
//   máy đang bận sinh file cho người đã bỏ đi.
//
// LỖI 2 — từ chối vì QUÁ TẢI không được đếm (gate-rejection-not-counted).
//   Tái hiện: nhánh `waiters.length >= maxPending` ném lỗi 503 `export_capacity` mà không chạm
//   biến đếm nào. Chỗ duy nhất tăng `export_rejected_total` là nhánh nội tuyến
//   (`reason: "inline_queue_full"`), mà nhánh nội tuyến chỉ tới được khi worker thread hỏng.
//   Hậu quả: trong vận hành bình thường MỌI lượt từ chối vì quá tải đều vô hình trên /metrics —
//   người dùng nhận 503 còn biểu đồ vẫn phẳng, không ai biết cần nâng công suất.
import { describe, it, expect, vi } from "vitest";
import { createConcurrencyGate } from "../src/exportQueue.js";

describe("createConcurrencyGate — huỷ chỗ đang chờ (AbortSignal)", () => {
  it("huỷ khi đang xếp hàng thì BỊ LOẠI khỏi hàng đợi và KHÔNG bao giờ được cấp chỗ", async () => {
    const gate = createConcurrencyGate({ maxActive: 1, maxPending: 5 });
    await gate.acquire(); // chiếm suất duy nhất

    const ac = new AbortController();
    const waiting = gate.acquire(ac.signal);
    // Lỗi bị nuốt cho tới lúc assert — tránh unhandledRejection làm đỏ cả file test.
    const settled = waiting.then(() => "resolved", (e) => e);
    expect(gate.pending()).toBe(1);

    ac.abort();
    const err = await settled;
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("export_aborted");
    // Đã rời hàng đợi: chỗ trả ra phải về cho người CÒN chờ, không phải cho kẻ đã bỏ đi.
    expect(gate.pending()).toBe(0);

    const next = gate.acquire();
    gate.release();
    await expect(next).resolves.toBeUndefined();
    expect(gate.active()).toBe(1);
  });

  it("signal đã abort TỪ TRƯỚC thì trượt ngay, không chiếm suất active", async () => {
    const gate = createConcurrencyGate({ maxActive: 2, maxPending: 5 });
    await expect(gate.acquire(AbortSignal.abort())).rejects.toMatchObject({ code: "export_aborted" });
    expect(gate.active()).toBe(0);
    expect(gate.pending()).toBe(0);
  });

  it("huỷ SAU khi đã được cấp chỗ không làm hỏng bộ đếm (chỗ vẫn do người gọi trả)", async () => {
    const gate = createConcurrencyGate({ maxActive: 1, maxPending: 5 });
    const ac = new AbortController();
    await gate.acquire(ac.signal);
    expect(gate.active()).toBe(1);
    ac.abort(); // muộn — đã cầm chỗ rồi
    expect(gate.active()).toBe(1);
    gate.release();
    expect(gate.active()).toBe(0);
  });
});

describe("createConcurrencyGate — đếm lượt từ chối vì hết công suất", () => {
  it("gọi onReject mỗi lần trả 503 export_capacity", async () => {
    const onReject = vi.fn();
    const gate = createConcurrencyGate({ maxActive: 1, maxPending: 1, onReject });
    await gate.acquire();                 // active = 1
    const queued = gate.acquire();        // pending = 1 (chạm trần chờ)
    queued.catch(() => {});

    await expect(gate.acquire()).rejects.toMatchObject({ status: 503, code: "export_capacity" });
    expect(onReject).toHaveBeenCalledTimes(1);

    await expect(gate.acquire()).rejects.toMatchObject({ code: "export_capacity" });
    expect(onReject).toHaveBeenCalledTimes(2);

    gate.release();
    await queued;
  });

  it("không có onReject thì vẫn chạy bình thường (cổng độc lập với observability)", async () => {
    const gate = createConcurrencyGate({ maxActive: 1, maxPending: 0 });
    await gate.acquire();
    await expect(gate.acquire()).rejects.toMatchObject({ code: "export_capacity" });
  });
});
