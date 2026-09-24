/** @vitest-environment jsdom */
//
// Soát chéo money#1 — NÚT Ý KIẾN KHÁCH SAU KHI ĐÃ XUẤT HOÁ ĐƠN.
//
// Đã có số HĐ thì editor chỉ đọc (daXuatHoaDon, khớp canEdit ở máy chủ), nhưng cặp nút
// "✓ Khách duyệt / ✗ Không duyệt / Gỡ đánh dấu" vẫn hiện chỉ theo quyền quote:send. Bấm nó thì doanh
// thu chốt bị tính lại SAU mốc khoá, và (trước bản vá bộ lọc) dòng hoá đơn đã phát hành biến khỏi
// trang Hóa đơn. Máy chủ nay trả 409; giao diện không được mời người dùng bấm một nút chắc chắn lỗi.
// Cùng khuôn createRoot + act với QuoteEditor.chotChuaLuu.test.tsx (không @testing-library).
import { describe, it, expect, vi, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const MAU = [{ id: 1, code: "gn", name: "GN", companyId: 7, layout: { hasDays: false } }];
const CTY = [{ id: 7, name: "Gia Nguyễn" }];

const h = vi.hoisted(() => ({ soHD: null as string | null }));

const baoGia = () => ({
  id: 12, quoteNumber: "GN26012", title: "Sự kiện", status: "converted", companyId: 7, createdById: 1,
  toCompany: "Khách", vatPercent: 0, discount: 0, showTotals: true, quoteDate: "2026-09-20",
  updatedAt: "2026-09-20T00:00:00.000Z", hnStatus: null, hnTables: [], members: [],
  sheets: [{
    id: 121, templateId: 1, name: "Trang 1", groupSubtotal: false, invoiceNo: h.soHD, custStatus: "approved",
    items: [{ kind: "item", name: "Backdrop", unit: "cái", quantity: 1, unitPrice: 1000 }], extraTables: [],
  }],
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
vi.mock("../lib/ui", async (goc) => ({ ...(await goc<typeof import("../lib/ui")>()), toast: vi.fn() }));
vi.mock("../lib/venueCatalog", async (goc) => ({ ...(await goc<typeof import("../lib/venueCatalog")>()), loadCatalog: () => Promise.resolve({ entries: [], venues: [] }) }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { QuoteEditorPage } from "./QuoteEditor";

const ME = { id: 1, username: "a", displayName: "A", role: "admin", permissions: ["quote:send", "quote:update:all", "quote:read:all"] };

let root: Root | null = null;
let hop: HTMLDivElement | null = null;
const cho = async (ms = 0) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };

async function moEditor() {
  hop = document.createElement("div");
  document.body.appendChild(hop);
  root = createRoot(hop);
  await act(async () => { root!.render(<QuoteEditorPage me={ME} quoteId={12} isNew={false} />); });
  await cho(10);
}
const cacNutYKien = () => [...hop!.querySelectorAll(".cust-decide button")].map((b) => b.textContent?.trim());

afterEach(async () => {
  await cho(1300);   // hẹn giờ ghi bản nháp 1,2s — cho nổ trong act rồi mới tháo cây
  if (root) act(() => root!.unmount());
  root = null; hop?.remove(); hop = null; document.body.innerHTML = "";
  localStorage.clear();
});

describe("soát chéo money#1 — nút ý kiến khách khi đã xuất hoá đơn", () => {
  it("CHƯA có số HĐ → có nút ghi ý kiến khách (đối chứng)", async () => {
    h.soHD = null;
    await moEditor();
    expect(cacNutYKien()).toEqual(["✗ Không duyệt", "Gỡ đánh dấu"]);
  });

  it("ĐÃ có số HĐ → không còn nút nào (máy chủ trả 409), vẫn thấy ý kiến đã ghi", async () => {
    h.soHD = "HD0001";
    await moEditor();
    expect(cacNutYKien()).toEqual([]);
    expect(hop!.querySelector(".cust-decide .cust-chip")?.textContent).toBeTruthy();
  });
});
