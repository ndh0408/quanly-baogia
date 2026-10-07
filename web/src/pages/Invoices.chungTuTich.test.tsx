/** @vitest-environment jsdom */
//
// CHỨNG TỪ GỬI ĐI / TRẢ VỀ LÀ Ô TÍCH (chủ repo 2026-10-07: "chứng từ gửi đi và trả về là dấu checkbox nha").
//   · Ô tích có name + aria-label; dữ liệu cũ có ngày = đã tích, title hiện ngày.
//   · Tích → gửi docSent: true (MÁY CHỦ đóng dấu giờ, trả lại); bỏ tích → false. Một lần cho cả mã hóa đơn: gửi qua sheet
//     đầu của mã, máy chủ ghi đồng loạt.
//   · Bấm ô tích KHÔNG mở báo giá. Người không có invoice:edit chỉ thấy ✓ / —. Bộ lọc "Thiếu CT gửi đi" vẫn đúng.
// ĐỎ trên 6ddc604: hai cột là ô ngày nhấp đúp, không có ô tích.
import { describe, it, expect, vi, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ProjectQuote } from "../lib/api";

const sh = (id: number, codeNo: number, name: string, extra: Record<string, unknown> = {}) =>
  ({ id, codeNo, name, subtotal: 1_000_000, invoiceNo: null, invoiceDate: null, docSentAt: null, docReturnedAt: null, invoiceGroup: null, invoiceHold: null, ...extra });
// Báo giá 7: hai sheet gom Hóa đơn 1 (mã FP_7 — một hóa đơn gom mọi sheet nên không hậu tố) — chứng từ ĐÃ gửi đi (dữ liệu cũ có ngày), chưa trả về.
// Báo giá 8: một sheet, chưa gửi gì.
const DU_AN = [
  { id: 7, title: "Sự kiện", status: "converted", vatPercent: 8, projectCode: "FP_7", customerName: "Khách 7",
    sheets: [sh(71, 1, "A", { invoiceGroup: 1, docSentAt: "2026-10-03T02:00:00.000Z" }), sh(72, 2, "B", { invoiceGroup: 1, docSentAt: "2026-10-03T02:00:00.000Z" })] },
  { id: 8, title: "Hội nghị", status: "converted", vatPercent: 8, projectCode: "FP_8", customerName: "Khách 8", sheets: [sh(81, 1, "X")] },
] as ProjectQuote[];

vi.mock("../lib/api", async (goc) => {
  const that = await goc<typeof import("../lib/api")>();
  return { ...that, api: { ...that.api, quoteProjects: vi.fn(async () => ({ data: DU_AN })),
    tichChungTu: vi.fn(async (_id: number, o: string, on: boolean) => ({ docSentAt: o === "docSent" && on ? "2026-10-07T03:00:00.000Z" : null, docReturnedAt: o === "docReturned" && on ? "2026-10-07T03:00:00.000Z" : null })) } };
});
vi.mock("../lib/ui", async (goc) => ({ ...(await goc<typeof import("../lib/ui")>()), toast: vi.fn() }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { InvoicesPage } from "./Invoices";
import { api } from "../lib/api";

let root: Root | null = null;
const cho = async (ms = 0) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
afterEach(() => { if (root) act(() => root!.unmount()); root = null; document.body.innerHTML = ""; vi.clearAllMocks(); location.hash = ""; });

async function moTrang(permissions = ["invoice:edit", "invoice:pay", "invoice:page"]) {
  const hop = document.createElement("div"); document.body.appendChild(hop);
  root = createRoot(hop);
  const me = { id: 1, username: "kt", displayName: "KT", role: "accountant", permissions };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => { root!.render(<QueryClientProvider client={qc}><InvoicesPage me={me} /></QueryClientProvider>); });
  await cho(20);
  return hop;
}
const oTich = (hop: HTMLElement, nhan: string) => hop.querySelector(`input[type="checkbox"][aria-label="${nhan}"], input[type="checkbox"][aria-label^="${nhan} — "]`) as HTMLInputElement;

describe("chứng từ gửi đi / trả về — ô tích", () => {
  it("dữ liệu cũ có ngày = đã tích (title hiện ngày); chưa có = chưa tích; ô có name", async () => {
    const hop = await moTrang();
    const gui7 = oTich(hop, "Chứng từ gửi đi — FP_7");
    expect(gui7, "ô tích gửi đi của mã FP_7").not.toBeNull();
    expect(gui7.checked).toBe(true);
    expect(gui7.name).toMatch(/^docSent-/);
    expect(gui7.closest("td")!.title).toContain("03/10/2026");
    expect(oTich(hop, "Chứng từ trả về — FP_7").checked).toBe(false);
    expect(oTich(hop, "Chứng từ gửi đi — FP_8").checked).toBe(false);
    expect(hop.querySelector('input[type="date"][name="docSentAt"]')).toBeNull();
  });

  it("tích → gửi docReturned: true qua sheet đầu của mã; ô hiện đã tích theo dấu máy chủ; KHÔNG mở báo giá", async () => {
    const hop = await moTrang();
    const o = oTich(hop, "Chứng từ trả về — FP_7");
    await act(async () => { o.click(); });
    await cho(10);
    expect(api.tichChungTu).toHaveBeenCalledWith(71, "docReturned", true);
    expect(oTich(hop, "Chứng từ trả về — FP_7").checked).toBe(true);
    expect(oTich(hop, "Chứng từ trả về — FP_7").closest("td")!.title).toContain("07/10/2026");
    expect(location.hash).not.toMatch(/#\/quotes\//);
  });

  it("bỏ tích → gửi false, ô về chưa tích", async () => {
    const hop = await moTrang();
    await act(async () => { oTich(hop, "Chứng từ gửi đi — FP_7").click(); });
    await cho(10);
    expect(api.tichChungTu).toHaveBeenCalledWith(71, "docSent", false);
    expect(oTich(hop, "Chứng từ gửi đi — FP_7").checked).toBe(false);
  });

  it("không có invoice:edit → không có ô tích, chỉ ✓ / —", async () => {
    const hop = await moTrang(["invoice:page"]);
    expect(hop.querySelector('.inv-table input[type="checkbox"]')).toBeNull();
    expect(hop.querySelector(".inv-table td.inv-tich")!.textContent).toBe("✓");
  });

  it("bộ lọc 'Thiếu CT gửi đi' chỉ còn mã chưa tích", async () => {
    const hop = await moTrang();
    const loc = hop.querySelector('select[name="missing"]') as HTMLSelectElement;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(loc, "docSentAt");
      loc.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const bang = hop.querySelector(".inv-table")!.textContent!;
    expect(bang).toContain("FP_8");
    expect(bang).not.toContain("FP_7");
  });
});
