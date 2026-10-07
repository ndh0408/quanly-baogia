/** @vitest-environment jsdom */
//
// Chủ repo 2026-10-06, trả lời hai điểm của tính năng chia sheet thành hóa đơn:
//   1) "back lại cho họ tự chọn lại để làm lại hóa đơn" → nút "Làm lại HĐ" trên dòng hóa đơn đã có số HĐ (kế toán):
//      hộp xác nhận nêu mã + số HĐ sẽ gỡ và "đã thu X — giữ nguyên", rồi gọi POST /quotes/:id/invoice-redo.
//   2) "có bỏ ra" → Chưa thu / Chưa thanh toán / việc "chưa xuất HĐ" BỎ sheet Không xuất; sheet Để sau vẫn tính.
// ĐỎ trên mã cũ: không có nút / API làm lại, các tổng vẫn cộng sheet Không xuất, trang Hóa đơn chưa cộng Để sau.
import { describe, it, expect, vi, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ProjectQuote } from "../lib/api";
import { fmtMoney } from "../lib/format";

const sh = (id: number, codeNo: number, name: string, subtotal: number, extra: Record<string, unknown> = {}) =>
  ({ id, codeNo, name, subtotal, invoiceNo: null, invoiceDate: null, paidAt: null, invoiceGroup: null, invoiceHold: null, signedAt: "2026-10-01", ...extra });
// Báo giá 7 (VAT 8%): Hóa đơn 1 = Sân khấu + Âm thanh, ĐÃ có số HĐ, đã thu; Ánh sáng Để sau; LED Không xuất.
const BG7 = {
  id: 7, title: "Sự kiện", status: "converted", vatPercent: 8, projectCode: "FP_7", customerName: "Khách 7",
  sheets: [
    sh(71, 1, "Sân khấu", 1_000_000, { invoiceGroup: 1, invoiceNo: "HD-7", invoiceDate: "2026-10-02", paidAt: "2026-10-05" }),
    sh(72, 2, "Âm thanh", 2_000_000, { invoiceGroup: 1, invoiceNo: "HD-7", invoiceDate: "2026-10-02", paidAt: "2026-10-05" }),
    sh(73, 3, "Ánh sáng", 4_000_000, { invoiceHold: "later" }),
    sh(74, 4, "LED", 500_000, { invoiceHold: "skip" }),
  ],
} as ProjectQuote;

vi.mock("../lib/api", async (goc) => {
  const that = await goc<typeof import("../lib/api")>();
  return { ...that, api: { ...that.api, quoteProjects: vi.fn(async () => ({ data: [BG7] })), lamLaiHoaDon: vi.fn(async () => ({ sheetIds: [71, 72], invoiceNo: ["HD-7"] })) } };
});
const xacNhan = vi.fn(async (..._a: unknown[]) => true);
vi.mock("../lib/ui", async (goc) => ({ ...(await goc<typeof import("../lib/ui")>()), toast: vi.fn(), confirmModal: (...a: unknown[]) => xacNhan(...a) }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { InvoicesPage } from "./Invoices";
import { ProjectsPage } from "./Projects";
import { buildActionItems } from "./Dashboard";
import { api } from "../lib/api";

let root: Root | null = null;
const cho = async (ms = 0) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
afterEach(() => { if (root) act(() => root!.unmount()); root = null; document.body.innerHTML = ""; vi.clearAllMocks(); });

async function mo(el: React.ReactElement) {
  const hop = document.createElement("div"); document.body.appendChild(hop);
  root = createRoot(hop);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => { root!.render(<QueryClientProvider client={qc}>{el}</QueryClientProvider>); });
  await cho(20);
  return hop;
}
const giaTriStat = (hop: HTMLElement, nhan: string) =>
  [...hop.querySelectorAll(".stat-card")].find((c) => c.querySelector(".stat-label")?.textContent === nhan)?.querySelector(".stat-value")?.textContent;
const ME = (permissions: string[]) => ({ id: 1, username: "kt", displayName: "KT", role: "accountant", permissions });

const VAT = (x: number) => x + Math.round(x * 0.08);

describe("Làm lại hóa đơn — trang Hóa đơn đầu ra", () => {
  it("dòng có số HĐ: xác nhận nêu mã + số HĐ + 'đã thu … giữ nguyên', rồi gọi API với một sheet của hóa đơn", async () => {
    const hop = await mo(<InvoicesPage me={ME(["invoice:edit", "invoice:pay", "invoice:page"])} />);
    const nut = hop.querySelector('button[aria-label="Làm lại hóa đơn — FP_7_01"]') as HTMLButtonElement;
    expect(nut, "kế toán thấy nút Làm lại HĐ").not.toBeNull();
    await act(async () => { nut.click(); });
    await cho(10);
    expect(xacNhan).toHaveBeenCalledTimes(1);
    const [tieuDe, loi] = xacNhan.mock.calls[0] as [string, string];
    expect(tieuDe).toContain("FP_7_01");
    expect(loi).toContain("HD-7");
    expect(loi).toContain("Sân khấu, Âm thanh");
    expect(loi).toMatch(/Đã thu .* GIỮ NGUYÊN/);
    expect(api.lamLaiHoaDon).toHaveBeenCalledWith(7, 71);
  });

  it("hủy xác nhận → không gọi API; không có invoice:edit → không có nút", async () => {
    xacNhan.mockResolvedValueOnce(false);
    let hop = await mo(<InvoicesPage me={ME(["invoice:edit", "invoice:page"])} />);
    await act(async () => { (hop.querySelector('button[aria-label="Làm lại hóa đơn — FP_7_01"]') as HTMLButtonElement).click(); });
    await cho(10);
    expect(api.lamLaiHoaDon).not.toHaveBeenCalled();
    act(() => root!.unmount()); root = null; document.body.innerHTML = "";
    hop = await mo(<InvoicesPage me={ME(["invoice:page"])} />);
    expect(hop.querySelector('button[aria-label^="Làm lại hóa đơn"]')).toBeNull();
  });
});

describe("Chưa thu bỏ sheet Không xuất, giữ sheet Để sau", () => {
  it("Hóa đơn đầu ra: Tổng + Chưa thu cộng Để sau (Ánh sáng), KHÔNG cộng Không xuất (LED)", async () => {
    const hop = await mo(<InvoicesPage me={ME(["invoice:page"])} />);
    expect(giaTriStat(hop, "Tổng số tiền (VAT)")).toBe(fmtMoney(VAT(3_000_000) + VAT(4_000_000)));
    expect(giaTriStat(hop, "Đã thu")).toBe(fmtMoney(VAT(3_000_000)));
    expect(giaTriStat(hop, "Chưa thu")).toBe(fmtMoney(VAT(4_000_000)));
  });

  it("Quản lý dự án: Chưa thanh toán bỏ LED (Không xuất), giữ Ánh sáng (Để sau); dòng LED gắn nhãn", async () => {
    const hop = await mo(<ProjectsPage me={ME(["invoice:read", "user:manage"])} />);
    expect(giaTriStat(hop, "Chưa thanh toán")).toBe(fmtMoney(VAT(4_000_000)));
    expect(hop.textContent).toContain("Không xuất HĐ");
  });

  it("Dashboard 'Cần xử lý': 'Đã ký · chưa xuất hóa đơn' có Để sau, không có Không xuất", () => {
    const inv = buildActionItems([BG7]).find((c) => c.key === "inv")!;
    expect(inv.items.map((x) => x.hangMuc)).toEqual(["Ánh sáng"]);
    // Báo giá CHƯA chia (cột null hết) thì "skip" không tồn tại — hành vi cũ.
    const chuaChia = { ...BG7, sheets: BG7.sheets!.map((s) => ({ ...s, invoiceGroup: null, invoiceHold: null, invoiceNo: null })) } as ProjectQuote;
    expect(buildActionItems([chuaChia]).find((c) => c.key === "inv")!.items).toHaveLength(4);
  });
});
