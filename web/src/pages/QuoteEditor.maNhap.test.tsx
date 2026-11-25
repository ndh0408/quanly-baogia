/** @vitest-environment jsdom */
//
// Màn soạn × mã dự án cấp lúc KHÁCH CHỐT (chủ repo 2026-11-25: "tạo mới chưa duyệt thì không có mã nào, duyệt khách chốt
// thì mới tạo mã dự án"). Báo giá chưa chốt có projectCode = null → tiêu đề "Báo giá NHÁP <số BG>" kèm dòng nhắc mã cấp
// khi chốt; không "null", không lùi im về số BG như thể đó là mã dự án. Đã chốt → mã dự án như cũ, không dòng nhắc.
// Cùng khuôn giàn dựng với QuoteEditor.phienBan.test.tsx.
// ĐỎ trên 7a6ce18: tiêu đề "Báo giá GN26011" (lùi về số BG), không có chữ NHÁP.
import { describe, it, expect, vi, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const MAU = [{ id: 1, code: "gn", name: "GN", companyId: 7, layout: { hasDays: false } }];
const CTY = [{ id: 7, name: "Gia Nguyễn" }];
const h = vi.hoisted(() => ({ over: {} as Record<string, unknown> }));
const baoGia = () => ({
  id: 11, quoteNumber: "GN26011", projectCode: null, projectVersion: 1, title: "Sự kiện", status: "draft", companyId: 7, createdById: 1,
  toCompany: "Khách cũ", vatPercent: 0, discount: 0, showTotals: true, quoteDate: "2026-09-20",
  updatedAt: "2026-09-20T00:00:00.000Z", hnTables: [], members: [],
  sheets: [{ id: 101, templateId: 1, name: "Trang 1", groupSubtotal: false, items: [{ kind: "item", name: "Backdrop", unit: "cái", quantity: 1, unitPrice: 1000 }], extraTables: [] }],
  ...h.over,
});

vi.mock("../lib/api", async (goc) => {
  const that = await goc<typeof import("../lib/api")>();
  const fns: Record<string, ReturnType<typeof vi.fn>> = {
    metaCompanies: vi.fn(async () => CTY),
    metaTemplates: vi.fn(async () => MAU),
    getQuote: vi.fn(async () => baoGia()),
    presence: vi.fn(async () => ({ editing: [] })),
    hnAccounts: vi.fn(async () => ({ data: [] })),
  };
  const api = new Proxy(fns, { get: (t, k: string) => t[k] ?? (t[k] = vi.fn(async () => ({}))) });
  return { ...that, api };
});
vi.mock("../lib/ui", async (goc) => ({ ...(await goc<typeof import("../lib/ui")>()), toast: vi.fn(), confirmModal: vi.fn(async () => true) }));
vi.mock("../lib/venueCatalog", async (goc) => ({ ...(await goc<typeof import("../lib/venueCatalog")>()), loadCatalog: () => Promise.resolve({ entries: [], venues: [] }) }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { QuoteEditorPage } from "./QuoteEditor";

const ME = { id: 1, username: "a", displayName: "A", role: "admin", permissions: ["quote:send", "quote:update:all", "quote:read:all", "quote:create"] };

let root: Root | null = null;
let hop: HTMLDivElement | null = null;
const cho = async (ms = 0) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
async function mo() {
  hop = document.createElement("div");
  document.body.appendChild(hop);
  root = createRoot(hop);
  await act(async () => { root!.render(<QuoteEditorPage me={ME} quoteId={11} isNew={false} />); });
  await cho(20);
  return hop.querySelector("h1")!.textContent || "";
}
afterEach(() => { if (root) act(() => root!.unmount()); root = null; hop?.remove(); hop = null; h.over = {}; localStorage.clear(); });

describe("màn soạn — mã dự án / NHÁP", () => {
  it("chưa chốt, chưa có mã → 'Báo giá NHÁP GN26011' + nhắc mã cấp khi khách chốt", async () => {
    const t = await mo();
    expect(t).toContain("Báo giá NHÁP GN26011");
    expect(t).toContain("mã dự án cấp khi khách chốt");
    expect(t).not.toContain("null");
  });
  it("đã chốt → mã dự án như cũ, không nhắc", async () => {
    h.over = { status: "converted", projectCode: "FP_A26_003", projectVersion: 2 };
    const t = await mo();
    expect(t).toContain("Báo giá FP_A26_003_v2");
    expect(t).not.toContain("NHÁP");
    expect(t).not.toContain("cấp khi khách chốt");
  });
});
