/** @vitest-environment jsdom */
//
// FE-07: trang Hóa đơn chỉ sửa được bằng NHẤP ĐÚP chuột. Ô không nhận tiêu điểm, không có phím nào
// mở ô nhập — kế toán dùng bàn phím (Tab/Enter như Excel) không nhập được hoá đơn.
import { describe, it, expect, vi, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const DU_AN = [{
  id: 5, title: "Sự kiện", status: "converted", vatPercent: 0, quoteNumber: "GN26005", customerName: "Khách A",
  sheets: [{ id: 51, subtotal: 1000000, invoiceNo: null, invoiceDate: null }],
}];
vi.mock("../lib/api", async (goc) => {
  const that = await goc<typeof import("../lib/api")>();
  return { ...that, api: { ...that.api, quoteProjects: vi.fn(async () => ({ data: DU_AN })), updateSheetInvoice: vi.fn(async () => ({})) } };
});
vi.mock("../lib/ui", async (goc) => ({ ...(await goc<typeof import("../lib/ui")>()), toast: vi.fn() }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { InvoicesPage } from "./Invoices";
import { api } from "../lib/api";

let root: Root | null = null;
const cho = async (ms = 0) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
afterEach(() => { if (root) act(() => root!.unmount()); root = null; document.body.innerHTML = ""; });

const phim = (el: Element, key: string) => act(() => { el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })); });

describe("FE-07 — nhập hoá đơn bằng bàn phím", () => {
  it("ô Số HĐơn nhận tiêu điểm; Enter mở ô nhập có aria-label; Enter lần nữa lưu", async () => {
    const hop = document.createElement("div"); document.body.appendChild(hop);
    root = createRoot(hop);
    const me = { id: 1, username: "kt", displayName: "KT", role: "accountant", permissions: ["invoice:edit", "invoice:pay", "invoice:page"] };
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => { root!.render(<QueryClientProvider client={qc}><InvoicesPage me={me} /></QueryClientProvider>); });
    await cho(20);
    const o = hop.querySelector('td[aria-label^="Sửa Số HĐơn"]') as HTMLElement;
    expect(o, "ô Số HĐơn phải có nhãn cho trình đọc màn hình").not.toBeNull();
    expect(o.tabIndex).toBe(0);
    act(() => o.focus());
    phim(o, "Enter");
    const input = hop.querySelector('input[aria-label^="Số HĐơn"]') as HTMLInputElement;
    expect(input, "Enter phải mở ô nhập").not.toBeNull();
    expect(location.hash).not.toMatch(/#\/quotes\//);   // Enter ở ô KHÔNG được mở báo giá
    act(() => { input.value = "0001234"; });
    await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); input.blur(); });
    await cho(10);
    expect(api.updateSheetInvoice).toHaveBeenCalledWith(51, "invoiceNo", "0001234");
  });
});
