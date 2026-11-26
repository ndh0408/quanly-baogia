/** @vitest-environment jsdom */
//
// BỘ CHỌN NĂM ở Quản lý dự án + Hóa đơn đầu ra (2026-11-26, chủ repo chuyển lời: "sau 1 năm thì data mình có cách nào gom
// vô 1 thư mục để dễ kiểm soát … click vô năm 2026 thì chỉ thể hiện 2026 thôi", "cả danh sách báo giá hay gì tất cả luôn").
// Năm dự án = năm KHÁCH CHỐT (máy chủ trả `projectYear`). Hóa đơn đầu ra: năm kế toán ghi / năm Ngày HĐơn, CHƯA XUẤT thì năm
// dự án — trước đây ô lọc Năm bỏ rơi hóa đơn chưa xuất (chọn một năm là việc còn phải làm biến mất).
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ProjectQuote } from "../lib/api";

const sh = (id: number, codeNo: number, name: string, subtotal: number, extra: Record<string, unknown> = {}) =>
  ({ id, codeNo, name, subtotal, invoiceNo: null, invoiceDate: null, paidAt: null, invoiceGroup: null, invoiceHold: null, signedAt: null, ...extra });
// Dự án chốt 2026, đã xuất HĐ năm 2026.
const MOI = { id: 1, title: "Dự án mới", status: "converted", vatPercent: 8, projectCode: "FP_B26_001", projectYear: 2026, customerName: "Khách Mới",
  sheets: [sh(11, 1, "Sân khấu", 1_000_000, { invoiceGroup: 1, invoiceNo: "HD-26", invoiceDate: "2026-03-02" })] } as ProjectQuote;
// Dự án chốt 2025, CHƯA xuất hóa đơn.
const CU = { id: 2, title: "Dự án cũ", status: "converted", vatPercent: 8, projectCode: "FP_B25_009", projectYear: 2025, customerName: "Khách Cũ",
  sheets: [sh(21, 1, "Backdrop", 2_000_000)] } as ProjectQuote;

vi.mock("../lib/api", async (goc) => {
  const that = await goc<typeof import("../lib/api")>();
  return { ...that, api: { ...that.api, quoteProjects: vi.fn(async () => ({ data: [MOI, CU] })) } };
});
vi.mock("../lib/ui", async (goc) => ({ ...(await goc<typeof import("../lib/ui")>()), toast: vi.fn() }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { ProjectsPage } from "./Projects";
import { InvoicesPage } from "./Invoices";

let root: Root | null = null;
const cho = async (ms = 20) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
beforeEach(() => { try { localStorage.clear(); } catch { /* jsdom luôn có */ } });
afterEach(() => { if (root) act(() => root!.unmount()); root = null; document.body.innerHTML = ""; vi.clearAllMocks(); });

async function mo(el: React.ReactElement) {
  const hop = document.createElement("div"); document.body.appendChild(hop);
  root = createRoot(hop);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => { root!.render(<QueryClientProvider client={qc}>{el}</QueryClientProvider>); });
  await cho();
  return hop;
}
const nutNam = (hop: HTMLElement) => [...hop.querySelectorAll('[aria-label="Chọn năm"] button')] as HTMLButtonElement[];
const bam = async (b: HTMLElement) => { await act(async () => { b.click(); }); await cho(); };
const chuBang = (hop: HTMLElement) => [...hop.querySelectorAll("table.proj-table tbody tr, table.inv-table tbody tr")].map((r) => r.textContent || "");

describe("Quản lý dự án — bộ chọn năm", () => {
  const ME = { id: 1, username: "a", displayName: "A", role: "admin", permissions: ["user:manage"] };
  it("Tất cả · 2026 · 2025 kèm số dòng; bấm 2025 chỉ còn dự án chốt năm 2025; nhớ cho lần mở sau", async () => {
    let hop = await mo(<ProjectsPage me={ME} />);
    expect(nutNam(hop).map((b) => b.textContent)).toEqual(["Tất cả2", "20261", "20251"]);
    expect(chuBang(hop)).toHaveLength(2);
    await bam(nutNam(hop)[2]);
    const dong = chuBang(hop);
    expect(dong).toHaveLength(1);
    expect(dong[0]).toContain("Dự án cũ");
    expect(hop.querySelector(".list-foot")!.textContent).toContain("năm 2025");
    act(() => root!.unmount()); root = null; document.body.innerHTML = "";
    hop = await mo(<ProjectsPage me={ME} />);
    expect(chuBang(hop)).toHaveLength(1);
    expect(nutNam(hop)[2].getAttribute("aria-pressed")).toBe("true");
  });
  it("'Xóa lọc' KHÔNG bỏ năm (năm là thư mục đang xem, không phải bộ lọc tạm)", async () => {
    const hop = await mo(<ProjectsPage me={ME} />);
    await bam(nutNam(hop)[1]);
    const o = hop.querySelector('input[name="q"]') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    act(() => { setter.call(o, "zzz"); o.dispatchEvent(new Event("input", { bubbles: true })); });
    await bam([...hop.querySelectorAll("button")].find((b) => b.textContent === "Xóa lọc")!);
    expect(chuBang(hop)).toHaveLength(1);
    expect(chuBang(hop)[0]).toContain("Dự án mới");
  });
});

describe("Hóa đơn đầu ra — bộ chọn năm", () => {
  const ME = { id: 1, username: "kt", displayName: "KT", role: "accountant", permissions: ["invoice:page", "invoice:edit"] };
  it("hóa đơn CHƯA XUẤT nằm trong năm dự án của nó; ô chọn Năm cũ đã thay bằng hàng nút", async () => {
    const hop = await mo(<InvoicesPage me={ME} />);
    expect(hop.querySelector('select[name="year"]')).toBeNull();
    expect(nutNam(hop).map((b) => b.textContent)).toEqual(["Tất cả2", "20261", "20251"]);
    await bam(nutNam(hop)[2]);
    const dong = chuBang(hop).join(" | ");
    expect(dong).toContain("Khách Cũ");
    expect(dong).not.toContain("Khách Mới");
    await bam(nutNam(hop)[1]);
    const dong26 = chuBang(hop).join(" | ");
    expect(dong26).toContain("Khách Mới");
    expect(dong26).not.toContain("Khách Cũ");
    expect(localStorage.getItem("quanly.hoaDonRa.nam")).toBe("2026");
  });
});
