/** @vitest-environment jsdom */
//
// MÃ DỰ ÁN CẤP LÚC KHÁCH CHỐT (chủ repo 2026-11-25) — mọi trang đọc mã phải chịu được projectCode = null:
//   · Danh sách báo giá: báo giá chưa chốt hiện "NHÁP <số BG>"; đã chốt mà không mã (người tạo không có tiền tố) hiện số
//     BG như trước; không bao giờ "null".
//   · Hóa đơn đầu ra / Quản lý dự án / Dashboard "Cần xử lý": chỉ liệt kê báo giá đã chốt nên vốn có mã — vẫn phải chịu
//     được null: mã sản xuất ra "<số BG>_01", không "null_01", không "_01" trơ trọi.
// ĐỎ trên 7a6ce18: danh sách hiện "GN26045" cho báo giá chưa chốt không mã (không có chữ NHÁP).
import { describe, it, expect, vi, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ProjectQuote } from "../lib/api";

const sh = (id: number, codeNo: number, name: string, subtotal: number) =>
  ({ id, codeNo, name, subtotal, invoiceNo: null, invoiceDate: null, paidAt: null, invoiceGroup: null, invoiceHold: null, signedAt: "2026-10-01" });
// Đã chốt, KHÔNG mã (người tạo không có tiền tố), hai sheet.
const BG = {
  id: 46, title: "Hội nghị", status: "converted", vatPercent: 8, projectCode: null, projectVersion: 1, quoteNumber: "GN26046", customerName: "Khách 46",
  sheets: [sh(461, 1, "Sân khấu", 1_000_000), sh(462, 2, "Âm thanh", 2_000_000)],
} as unknown as ProjectQuote;
const dong = (id: number, over: Record<string, unknown>) => ({ id, quoteNumber: `GN260${id}`, projectCode: null, projectVersion: 1, title: `Báo giá ${id}`, status: "draft", createdById: 1, sheetCount: 1, total: 1000, quoteDate: "2026-11-20", ...over });
const HANG = [
  dong(45, {}),
  dong(47, { status: "lost" }),
  dong(46, { status: "converted" }),
  dong(48, { status: "converted", projectCode: "FP_A26_002" }),
];

vi.mock("../lib/api", async (goc) => {
  const that = await goc<typeof import("../lib/api")>();
  const fns: Record<string, unknown> = {
    quoteProjects: vi.fn(async () => ({ data: [BG] })),
    listQuotes: vi.fn(async () => ({ data: JSON.parse(JSON.stringify(HANG)), meta: { total: HANG.length, page: 1, size: 20, pageCount: 1 } })),
  };
  return { ...that, api: new Proxy(fns, { get: (t, k: string) => t[k] ?? (t[k] = vi.fn(async () => ({}))) }) };
});
vi.mock("../lib/ui", async (goc) => ({ ...(await goc<typeof import("../lib/ui")>()), toast: vi.fn(), confirmModal: vi.fn(async () => true) }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { QuoteListPage } from "./QuoteList";
import { InvoicesPage } from "./Invoices";
import { ProjectsPage } from "./Projects";
import { buildActionItems } from "./Dashboard";

let root: Root | null = null;
const cho = async (ms = 0) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
afterEach(() => { if (root) act(() => root!.unmount()); root = null; document.body.innerHTML = ""; location.hash = ""; });
async function mo(el: React.ReactElement) {
  const hop = document.createElement("div"); document.body.appendChild(hop);
  root = createRoot(hop);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => { root!.render(<QueryClientProvider client={qc}>{el}</QueryClientProvider>); });
  await cho(20);
  return hop;
}
const ME = (role: string, permissions: string[]) => ({ id: 1, username: "u", displayName: "U", role, permissions });

describe("Danh sách báo giá — NHÁP cho báo giá chưa chốt", () => {
  it("chưa chốt / không chốt → 'NHÁP <số BG>'; đã chốt không mã → số BG; có mã → mã; không 'null'", async () => {
    window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
    location.hash = "#/list";
    const hop = await mo(<QuoteListPage me={ME("manager", ["quote:read:own", "quote:update:own", "quote:create"])} />);
    const ma = [...hop.querySelectorAll("tbody tr.qrow td:first-child strong")].map((x) => x.textContent);
    expect(ma).toEqual(["NHÁP GN26045", "NHÁP GN26047", "GN26046", "FP_A26_002"]);
    expect(hop.querySelector("tbody")!.textContent).not.toContain("null");
  });
});

describe("trang chỉ liệt kê báo giá đã chốt — chịu được projectCode null", () => {
  const khongHong = (s: string) => {
    expect(s).not.toMatch(/null/);
    expect(s).not.toMatch(/(^|[^\w])_0\d/);   // không "_01" trơ trọi
  };
  it("Hóa đơn đầu ra: mã hóa đơn '<số BG>_01' / '_02'", async () => {
    const hop = await mo(<InvoicesPage me={ME("accountant", ["invoice:page"])} />);
    expect(hop.textContent).toContain("GN26046_01");
    expect(hop.textContent).toContain("GN26046_02");
    khongHong([...hop.querySelectorAll("tbody")].map((t) => t.textContent).join(" "));   // phần chữ hướng dẫn có "(_01, _02…" cố ý
  });
  it("Quản lý dự án: mã sản xuất '<số BG>_01' / '_02'", async () => {
    const hop = await mo(<ProjectsPage me={ME("accountant", ["invoice:read", "user:manage"])} />);
    expect(hop.textContent).toContain("GN26046_01");
    khongHong([...hop.querySelectorAll("tbody")].map((t) => t.textContent).join(" "));
  });
  it("Dashboard 'Cần xử lý': mã '<số BG>_01'", () => {
    const ma = buildActionItems([BG]).flatMap((c) => c.items.map((x) => x.code));
    expect(ma.length).toBeGreaterThan(0);
    for (const m of ma) { expect(m).toMatch(/^GN26046_0[12]$/); khongHong(m); }
  });
});
