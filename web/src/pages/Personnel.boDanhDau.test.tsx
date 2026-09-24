/** @vitest-environment jsdom */
/**
 * FILE-01 — "Bỏ đánh dấu" thanh toán phải hỏi lại trước khi gọi API.
 *
 * Nút đỏ "Bỏ đánh dấu" nằm ngay trong hộp thoại Thanh toán và trước đây gọi thẳng
 * `api.markPayment(id, false)`. Phía máy chủ khi đó xoá VĨNH VIỄN ảnh chứng từ khỏi kho object (bản
 * duy nhất). Máy chủ nay không xoá nữa (tests/fp-chung-tu-khong-xoa-anh.test.js), nhưng một cú bấm
 * lỡ tay vẫn đưa hồ sơ về "Chưa thanh toán" và tách ảnh khỏi hồ sơ — giao diện không còn đường mở
 * lại ảnh đó. Nên phải có bước xác nhận, và huỷ thì KHÔNG được gọi API.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

const markPayment = vi.fn(async () => ({}));
vi.mock("../lib/api", () => {
  class ApiError extends Error {}
  return {
    ApiError,
    api: {
      markPayment: (...a: unknown[]) => (markPayment as (...x: unknown[]) => Promise<unknown>)(...a),
      getPaymentProof: async () => ({ paymentProof: "" }),
    },
  };
});

let dongY = true;
const confirmModal = vi.fn(async () => dongY);
vi.mock("../lib/ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/ui")>()),
  toast: () => {},
  confirmModal: () => confirmModal(),
  fieldErrorsFrom: () => ({}),
  useEscClose: () => {},
}));

import { PaymentDialog } from "./Personnel";

let thung: HTMLDivElement;
let goc: Root;
beforeEach(() => {
  markPayment.mockClear(); confirmModal.mockClear(); dongY = true;
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  thung = document.createElement("div");
  document.body.appendChild(thung);
  goc = createRoot(thung);
});
afterEach(() => { act(() => goc.unmount()); thung.remove(); });

const HO_SO = { id: 42, fullName: "Nguyễn Văn A", paidAt: "2026-09-01T00:00:00.000Z", hasPaymentProof: false } as never;

async function dung() {
  await act(async () => { goc.render(<PaymentDialog rec={HO_SO} onClose={() => {}} onDone={() => {}} />); });
  const nut = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Bỏ đánh dấu");
  if (!nut) throw new Error('không thấy nút "Bỏ đánh dấu"');
  return nut;
}

describe("Thanh toán nhân sự — Bỏ đánh dấu", () => {
  it("bấm → hỏi xác nhận → đồng ý mới gọi markPayment(id, false)", async () => {
    const nut = await dung();
    await act(async () => { nut.click(); });
    expect(confirmModal, "gọi thẳng API mà không hỏi").toHaveBeenCalledTimes(1);
    expect(markPayment).toHaveBeenCalledTimes(1);
    expect(markPayment.mock.calls[0]).toEqual([42, false, undefined]);
  });

  it("huỷ xác nhận thì KHÔNG gọi API", async () => {
    dongY = false;
    const nut = await dung();
    await act(async () => { nut.click(); });
    expect(confirmModal).toHaveBeenCalledTimes(1);
    expect(markPayment).not.toHaveBeenCalled();
  });
});
