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

// ─── ĐI QUA CỔNG THẬT (module-level gate trong src/exportQueue.ts) ──────────────────────────────
//
// Vì sao phải có khối này: các test trên dựng gate RIÊNG bằng `createConcurrencyGate({...})`, nên
// chúng KHÔNG phủ hai mảnh dây nối quan trọng nhất của bản vá:
//   · `onReject: () => exportRejectedTotal.inc({ reason: "gate_full" })` tiêm vào gate module-level —
//     gỡ dòng đó thì lỗi "từ chối vì quá tải không được đếm" quay lại 100% mà test gate riêng vẫn xanh.
//   · nhánh `if (isAbortedError(e)) throw e;` trong runExportJob — gỡ nó thì request đã huỷ rơi về
//     `runExport(inlineFn)` và chẹn event loop luồng chính ĐÚNG LÚC hệ thống đang quá tải.
//
// Cả hai test dưới đều gọi `runExportJob` thật, đọc bộ đếm thật từ registry thật.
describe("runExportJob — huỷ và quá tải đi qua cổng THẬT", () => {
  it("huỷ trong lúc chờ: reject export_aborted, KHÔNG rơi về đường nội tuyến, và 503 được ĐẾM", async () => {
    // Ép cổng module-level về đúng 1 suất chạy, 0 suất chờ → request thứ hai chắc chắn ăn 503.
    const prev = { a: process.env.EXPORT_MAX_ACTIVE, p: process.env.EXPORT_MAX_PENDING };
    process.env.EXPORT_MAX_ACTIVE = "1";
    process.env.EXPORT_MAX_PENDING = "0";
    vi.resetModules();
    // Nạp CÙNG một lượt reset để exportQueue và test dùng CHUNG một registry đo đạc.
    const obs = await import("../src/observability.js");
    const eq = await import("../src/exportQueue.js");

    // prom-client trả Promise ở .get() — đọc bộ đếm THẬT trong registry, không phải hằng số trong test.
    const gateFull = async () =>
      ((await obs.exportRejectedTotal.get()).values.find((v) => v.labels.reason === "gate_full") || { value: 0 }).value;
    const before = await gateFull();

    const inline1 = vi.fn(() => Buffer.alloc(0));
    const inline2 = vi.fn(() => Buffer.alloc(0));

    // BA THAO TÁC DƯỚI ĐÂY PHẢI NẰM TRONG CÙNG MỘT KHỐI ĐỒNG BỘ. `runExportJob` chạy tới
    // `await gate.acquire(...)` là đồng bộ, nên chỗ được chiếm/từ chối NGAY tại lời gọi; phần thân
    // (kiểm signal rồi sinh file) mới nằm ở microtask kế. Chen một `await` vào giữa là p1 kịp chạy
    // qua chốt kiểm huỷ và bài test không còn kiểm cái nó định kiểm nữa.
    const ac = new AbortController();
    const p1 = eq.runExportJob("xlsx", {}, inline1, { signal: ac.signal }); // chiếm suất active duy nhất
    ac.abort();                                                            // khách đóng tab NGAY lúc này
    const p2 = eq.runExportJob("xlsx", {}, inline2);                       // hết suất, hàng chờ trần 0
    const r1 = p1.then(() => "resolved", (e) => e); // nuốt sớm, tránh unhandledRejection

    // Suất chạy hết, hàng chờ trần 0 → phải là 503 export_capacity, và phải được ĐẾM.
    await expect(p2).rejects.toMatchObject({ status: 503, code: "export_capacity" });
    expect(inline2, "503 KHÔNG được nuốt rồi chạy nội tuyến — trần hàng đợi sẽ thành vô nghĩa").not.toHaveBeenCalled();
    const after = await gateFull();
    expect(after, "export_rejected_total{reason=gate_full} phải tăng").toBe(before + 1);

    const err = await r1;
    expect(err).toBeInstanceOf(Error);
    expect(err.code, "huỷ phải ném ra ngoài, không được rơi về nội tuyến").toBe("export_aborted");
    expect(inline1, "người gọi đã bỏ đi — chạy lại trên luồng chính chỉ tổ chẹn event loop").not.toHaveBeenCalled();
    // Chỗ đã được trả lại: cổng không rò rỉ suất khi người xin chỗ bỏ đi.
    expect(eq.exportGateStats().active).toBe(0);

    if (prev.a === undefined) delete process.env.EXPORT_MAX_ACTIVE; else process.env.EXPORT_MAX_ACTIVE = prev.a;
    if (prev.p === undefined) delete process.env.EXPORT_MAX_PENDING; else process.env.EXPORT_MAX_PENDING = prev.p;
  });

  it("signal đã huỷ TỪ TRƯỚC: trượt ngay, không chiếm suất nào, không đụng đường nội tuyến", async () => {
    vi.resetModules();
    const eq = await import("../src/exportQueue.js");
    const inline = vi.fn(() => Buffer.alloc(0));
    await expect(eq.runExportJob("pdf", {}, inline, { signal: AbortSignal.abort() }))
      .rejects.toMatchObject({ code: "export_aborted", status: 499 });
    expect(inline).not.toHaveBeenCalled();
    expect(eq.exportGateStats().active).toBe(0);
    expect(eq.exportGateStats().pending).toBe(0);
  });
});
