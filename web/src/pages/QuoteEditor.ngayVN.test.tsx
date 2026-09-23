/** @vitest-environment jsdom */
//
// Soát chéo excel#10 — XLSX-11 cho Excel/PDF đọc quoteDate theo lịch VN (+7), nhưng màn soạn vẫn cắt
// 10 ký tự ISO (ngày UTC). Báo giá cũ nhân bản lúc 03:00 sáng 14/06 giờ VN có quoteDate =
// 2026-06-13T20:00:00Z: Excel/PDF in "ngày 14", ô "Ngày báo giá" và dòng "TP. Hồ Chí Minh, ngày …"
// hiện 13. Sửa một ô giá rồi bấm Lưu (không đụng ngày) → web gửi lại "2026-06-13", máy chủ lưu 00:00Z
// và lần xuất sau tệp gửi khách quay về "ngày 13". Ngày chứng từ đổi theo một lần Lưu không liên quan.
// Cùng khuôn createRoot + act với QuoteEditor.chotChuaLuu.test.tsx.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const MAU = [{ id: 1, code: "gn", name: "GN", companyId: 7, layout: { hasDays: false } }];
const CTY = [{ id: 7, name: "Gia Nguyễn" }];
const baoGia = (over: Record<string, unknown> = {}) => ({
  id: 11, quoteNumber: "GN26011", title: "Sự kiện", status: "draft", companyId: 7, createdById: 1,
  toCompany: "Khách cũ", vatPercent: 0, discount: 0, showTotals: true, city: "TP. Hồ Chí Minh",
  quoteDate: "2026-06-13T20:00:00.000Z",   // dữ liệu CŨ: thời điểm đầy đủ, 03:00 sáng 14/06 giờ VN
  updatedAt: "2026-06-13T20:00:00.000Z", hnTables: [], members: [],
  sheets: [{ id: 101, templateId: 1, name: "Trang 1", groupSubtotal: false, items: [{ kind: "item", name: "Backdrop", unit: "cái", quantity: 1, unitPrice: 1000 }], extraTables: [] }],
  ...over,
});

const h = vi.hoisted(() => ({ updateQuote: null as unknown as ReturnType<typeof vi.fn> }));
vi.mock("../lib/api", async (goc) => {
  const that = await goc<typeof import("../lib/api")>();
  const fns: Record<string, ReturnType<typeof vi.fn>> = {
    metaCompanies: vi.fn(async () => CTY),
    metaTemplates: vi.fn(async () => MAU),
    getQuote: vi.fn(async () => baoGia()),
    presence: vi.fn(async () => ({ editing: [] })),
    hnAccounts: vi.fn(async () => ({ data: [] })),
    updateQuote: vi.fn(async (_id: number, p: Record<string, unknown>) => baoGia({ ...p, updatedAt: "2026-06-14T01:00:00.000Z" })),
  };
  h.updateQuote = fns.updateQuote;
  const api = new Proxy(fns, { get: (t, k: string) => t[k] ?? (t[k] = vi.fn(async () => ({}))) });
  return { ...that, api };
});
vi.mock("../lib/ui", async (goc) => ({
  ...(await goc<typeof import("../lib/ui")>()),
  toast: vi.fn(),
  confirmModal: vi.fn(async () => true),
}));
vi.mock("../lib/venueCatalog", async (goc) => ({ ...(await goc<typeof import("../lib/venueCatalog")>()), loadCatalog: () => Promise.resolve({ entries: [], venues: [] }) }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { QuoteEditorPage } from "./QuoteEditor";
import { api } from "../lib/api";

const ME = { id: 1, username: "a", displayName: "A", role: "admin", permissions: ["quote:send", "quote:update:all", "quote:read:all"] };
// tsconfig web chỉ nạp kiểu vite/client (không có @types/node) — đọc process qua globalThis.
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
const tzGoc = env.TZ;

let root: Root | null = null;
let hop: HTMLDivElement | null = null;
const cho = async (ms = 0) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };

beforeEach(() => { env.TZ = "Asia/Ho_Chi_Minh"; vi.clearAllMocks(); localStorage.clear(); });
afterEach(async () => {
  await cho(1300);   // hẹn giờ ghi bản nháp 1,2s — cho nổ trong act rồi mới tháo cây
  if (root) act(() => root!.unmount());
  root = null; hop?.remove(); hop = null; document.body.innerHTML = "";
  if (tzGoc === undefined) delete env.TZ; else env.TZ = tzGoc;
});

async function moEditor() {
  hop = document.createElement("div");
  document.body.appendChild(hop);
  root = createRoot(hop);
  await act(async () => { root!.render(<QuoteEditorPage me={ME} quoteId={11} isNew={false} />); });
  await cho(10);
}

describe("excel#10 — màn soạn đọc ngày CÙNG quy tắc với Excel/PDF", () => {
  it("quoteDate cũ 2026-06-13T20:00Z → ô Ngày 14/06, dòng thành phố 'ngày 14', Lưu (không đụng ngày) gửi 2026-06-14", async () => {
    await moEditor();
    const oNgay = [...hop!.querySelectorAll("label")].find((l) => l.textContent?.startsWith("Ngày báo giá"))!.querySelector("input") as HTMLInputElement;
    expect(oNgay.value, "ô Ngày lệch ngày Excel/PDF in ra").toBe("2026-06-14");
    expect(hop!.querySelector(".center-line")?.textContent).toBe("TP. Hồ Chí Minh, ngày 14 tháng 06 năm 2026");

    // Sửa một thứ KHÔNG liên quan tới ngày rồi Lưu.
    act(() => {
      const el = hop!.querySelector('input[placeholder="Tên công ty khách"]') as HTMLInputElement;
      el.value = "Khách MỚI"; el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const luu = [...hop!.querySelectorAll("button")].find((b) => b.textContent?.includes("Lưu")) as HTMLButtonElement;
    await act(async () => { luu.click(); }); await cho(10);
    expect(h.updateQuote).toHaveBeenCalled();
    const p = h.updateQuote.mock.calls[0][1] as Record<string, unknown>;
    expect(p.toCompany).toBe("Khách MỚI");
    expect(p.quoteDate, "lần Lưu không liên quan kéo ngày chứng từ về 13").toBe("2026-06-14");
  });

  it("quoteDate nửa đêm UTC (mọi bản ghi mới) → giữ nguyên ngày", async () => {
    (api.getQuote as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => baoGia({ quoteDate: "2026-06-13T00:00:00.000Z" }));
    await moEditor();
    const oNgay = [...hop!.querySelectorAll("label")].find((l) => l.textContent?.startsWith("Ngày báo giá"))!.querySelector("input") as HTMLInputElement;
    expect(oNgay.value).toBe("2026-06-13");
    expect(hop!.querySelector(".center-line")?.textContent).toBe("TP. Hồ Chí Minh, ngày 13 tháng 06 năm 2026");
  });
});
