/** @vitest-environment jsdom */
/**
 * Soát chéo files#1 + files#2 (hồi quy do FILE-12). Máy chủ nay trả hàng Nhân sự có bản mã PII hỏng
 * với lương/CCCD/STK = null + cờ `piiLoi`, và tổng lương cộng hàng đó như 0. Trước FILE-12 cả trang trả
 * 500 nên người dùng biết có lỗi; sau FILE-12 trang Nhân sự không đọc `piiLoi` ở đâu cả:
 *   · Σ Lương / Σ Thuế TNCN / Σ Thu nhập chịu thuế thiếu tiền mà trông như số thật (files#1);
 *   · ô Lương/CCCD/STK trống y như hồ sơ chưa nhập, form Sửa vẫn mở để gửi ba ô trống lên (files#1);
 *   · thao tác tại chỗ lỗi thì không nạp lại danh sách, dù máy chủ có thể đã ghi (files#2).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

type Hang = Record<string, unknown>;
let traVe: { data: Hang[]; meta: { total: number; page: number; size: number; pageCount: number }; summary: Record<string, number> };
const { listPersonnel, markConfirm, markPayment } = vi.hoisted(() => ({
  listPersonnel: vi.fn(async () => traVe),
  markConfirm: vi.fn(async (..._a: unknown[]) => ({})),
  markPayment: vi.fn(async (..._a: unknown[]) => ({})),
}));
vi.mock("../lib/api", () => {
  class ApiError extends Error {}
  const goi = (f: unknown) => (...a: unknown[]) => (f as (...x: unknown[]) => Promise<unknown>)(...a);
  return {
    ApiError,
    api: {
      listPersonnel: goi(listPersonnel),
      markConfirm: goi(markConfirm),
      markPayment: goi(markPayment),
      getPaymentProof: async () => ({ paymentProof: "" }),
      listProjects: async () => ({ data: [] }),
      listEmployees: async () => ({ data: [] }),
    },
  };
});
vi.mock("../lib/ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/ui")>()),
  toast: () => {},
  confirmModal: async () => true,
  fieldErrorsFrom: () => ({}),
  useEscClose: () => {},
}));

import { PersonnelPage, PaymentDialog } from "./Personnel";

const ME = { id: 1, username: "ad", displayName: "Admin", role: "admin", permissions: ["personnel:edit:all", "personnel:confirm", "personnel:pay"] };
const TOT = { id: 11, createdById: 1, fullName: "Hồ Sơ Tốt", salary: 3_000_000, idCard: "079123456789", bankAccount: "0123456789" };
const HONG = { id: 12, createdById: 1, fullName: "Hồ Sơ Hỏng", salary: null, idCard: null, bankAccount: null, piiLoi: true };

let thung: HTMLDivElement;
let goc: Root;
beforeEach(() => {
  listPersonnel.mockClear(); markConfirm.mockReset(); markConfirm.mockImplementation(async () => ({})); markPayment.mockReset();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom không có matchMedia; trang dùng nó để chọn bảng (desktop) hay thẻ (mobile).
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {} })) as unknown as typeof window.matchMedia;
  thung = document.createElement("div");
  document.body.appendChild(thung);
  goc = createRoot(thung);
});
afterEach(() => { act(() => goc.unmount()); thung.remove(); });

const cho = () => new Promise((r) => setTimeout(r, 0));
async function dungTrang(rows: Hang[], piiLoi: number | undefined) {
  traVe = { data: rows, meta: { total: rows.length, page: 1, size: 50, pageCount: 1 }, summary: { salary: 3_000_000, pit: 333_333, taxableIncome: 3_333_333, ...(piiLoi === undefined ? {} : { piiLoi }) } };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => { goc.render(<QueryClientProvider client={qc}><PersonnelPage me={ME as never} query="" /></QueryClientProvider>); });
  for (let i = 0; i < 5 && !document.querySelector("tbody tr"); i++) await act(cho);
}
const hangCua = (ten: string) => [...document.querySelectorAll("tbody tr")].find((tr) => tr.textContent?.includes(ten)) as HTMLTableRowElement;
const nutTrongHang = (tr: HTMLElement, chu: RegExp) => [...tr.querySelectorAll("button")].find((b) => chu.test(b.textContent || ""));

describe("files#1 — tổng thiếu hồ sơ không giải mã được phải được nói ra", () => {
  it("summary.piiLoi > 0 → cảnh báo cạnh tổng, nêu số hồ sơ bị loại", async () => {
    await dungTrang([TOT, HONG], 1);
    const cb = document.querySelector('[data-testid="pii-loi-tong"]');
    expect(cb, "tổng thiếu tiền mà không có cảnh báo nào").not.toBeNull();
    expect(cb!.textContent).toMatch(/1 hồ sơ/);
    expect(document.querySelector("tfoot")?.textContent, "dòng tổng trong bảng cũng phải nói thiếu").toMatch(/thiếu 1 hồ sơ/);
  });

  it("summary.piiLoi = 0 (hoặc máy chủ cũ không gửi) → không cảnh báo", async () => {
    await dungTrang([TOT], 0);
    expect(document.querySelector('[data-testid="pii-loi-tong"]')).toBeNull();
    act(() => goc.unmount()); goc = createRoot(thung);
    await dungTrang([TOT], undefined);
    expect(document.querySelector('[data-testid="pii-loi-tong"]')).toBeNull();
  });

  it("hàng piiLoi: ô Lương/CCCD/STK hiện nhãn lỗi thay cho ô trống; nút là 'Xem' chứ không phải 'Sửa'", async () => {
    await dungTrang([TOT, HONG], 1);
    const hong = hangCua("Hồ Sơ Hỏng");
    expect(hong.querySelectorAll('[data-testid="pii-loi-o"]').length, "ô PII trống như hồ sơ chưa nhập").toBe(3);
    expect(nutTrongHang(hong, /^Sửa$/), "còn nút Sửa trên hàng hỏng").toBeUndefined();
    expect(nutTrongHang(hong, /^Xem$/)).toBeDefined();
    const tot = hangCua("Hồ Sơ Tốt");
    expect(tot.querySelectorAll('[data-testid="pii-loi-o"]').length).toBe(0);
    expect(nutTrongHang(tot, /^Sửa$/)).toBeDefined();
  });

  it("mở hồ sơ piiLoi → form CHỈ XEM kèm cảnh báo, không có nút Lưu", async () => {
    await dungTrang([TOT, HONG], 1);
    await act(async () => { nutTrongHang(hangCua("Hồ Sơ Hỏng"), /^Xem$/)!.click(); });
    const modal = document.querySelector('[role="dialog"]') as HTMLElement;
    expect(modal.querySelector('[data-testid="pii-loi"]'), "form không nói vì sao chỉ xem").not.toBeNull();
    expect([...modal.querySelectorAll("button")].find((b) => /^Lưu$/.test(b.textContent || "")), "còn nút Lưu").toBeUndefined();
    const o = [...modal.querySelectorAll<HTMLInputElement>(".modal-body input:not([type=search]), .modal-body textarea")];
    expect(o.length).toBeGreaterThan(0);
    expect(o.every((x) => x.disabled), "còn ô sửa được").toBe(true);
  });
});

describe("files#2 — thao tác tại chỗ lỗi vẫn phải nạp lại danh sách", () => {
  it("xác nhận đã ký lỗi → nạp lại danh sách (máy chủ có thể đã ghi trước khi lỗi)", async () => {
    await dungTrang([TOT, HONG], 1);
    markConfirm.mockImplementation(async () => { throw new Error("Lỗi server"); });
    const truoc = listPersonnel.mock.calls.length;
    await act(async () => { nutTrongHang(hangCua("Hồ Sơ Hỏng"), /Xác nhận đã ký/)!.click(); });
    for (let i = 0; i < 5 && listPersonnel.mock.calls.length === truoc; i++) await act(cho);
    expect(markConfirm).toHaveBeenCalledWith(12, true);
    expect(listPersonnel.mock.calls.length, "lỗi xong không nạp lại → ô vẫn hiện trạng thái cũ").toBeGreaterThan(truoc);
  });

  it("hàng piiLoi vẫn bấm được Thanh toán / Xác nhận (các thao tác này không đụng PII)", async () => {
    await dungTrang([TOT, HONG], 1);
    const hong = hangCua("Hồ Sơ Hỏng");
    expect(nutTrongHang(hong, /Chưa thanh toán/)).toBeDefined();
    expect(nutTrongHang(hong, /Xác nhận đã ký/)).toBeDefined();
  });

  it("PaymentDialog: đánh dấu lỗi → gọi onLoi để trang nạp lại, hộp thoại vẫn mở", async () => {
    markPayment.mockImplementation(async () => { throw new Error("Lỗi server"); });
    const onLoi = vi.fn(); const onDone = vi.fn();
    await act(async () => { goc.render(<PaymentDialog rec={{ id: 12, createdById: 1, fullName: "Hồ Sơ Hỏng", paidAt: null } as never} onClose={() => {}} onDone={onDone} onLoi={onLoi} />); });
    await act(async () => { [...document.querySelectorAll("button")].find((b) => /Đánh dấu đã thanh toán/.test(b.textContent || ""))!.click(); });
    expect(markPayment).toHaveBeenCalled();
    expect(onLoi).toHaveBeenCalledTimes(1);
    expect(onDone).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });
});
