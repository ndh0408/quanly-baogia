/** @vitest-environment jsdom */
//
// SOÁT TOÀN DIỆN (nhóm soạn báo giá) — các lỗi của trình soạn KHÔNG thuộc chuyện xoá sheet
// (xoá sheet ở QuoteEditor.xoaSheet.test.tsx, chế độ xem thử quyền ở QuoteEditor.xemThu.test.tsx):
//   L56 — Discount / Ghi chú / Hiện tổng còn sửa được trong lúc PUT đang bay → mất im lặng.
//   L61 — hộp lý do "Khách không chốt" / "↩ Trả lại" / "Khách không duyệt" còn treo sau khi rời báo giá.
//   L62 — Lưu báo giá MỚI rồi rời trang trước khi máy chủ trả lời: instance đã gỡ kéo hash, tắt cờ.
//   L64 — đổi mẫu có ngày → không ngày → có ngày làm mất số Ngày.
//   X2  — hộp thanh toán nhận mốc updatedAt mới mà không kiểm người khác đã lưu chen vào.
// Cùng giàn dựng createRoot + act với QuoteEditor.soatCheo.test.tsx.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const MAU = [
  { id: 1, code: "gn", name: "GN (không ngày)", companyId: 7, layout: { hasDays: false } },
  { id: 2, code: "gnd", name: "GN (có ngày)", companyId: 7, layout: { hasDays: true } },
];
const CTY = [{ id: 7, name: "Gia Nguyễn" }];
const MOC_CU = "2026-09-20T00:00:00.000Z";

const trang = (id: number, over: Record<string, unknown> = {}) => ({
  id, templateId: 1, name: `Trang ${id}`, groupSubtotal: false, extraTables: [], discount: 0,
  items: [{ kind: "item", name: "Backdrop", unit: "cái", quantity: 1, unitPrice: 10_000_000 }], ...over,
});
const baoGia = (over: Record<string, unknown> = {}) => ({
  id: 11, quoteNumber: "GN26011", title: "Sự kiện", status: "sent", companyId: 7, createdById: 1,
  toCompany: "Khách cũ", vatPercent: 0, discount: 0, showTotals: true, quoteDate: "2026-09-20", notes: "",
  updatedAt: MOC_CU, hnStatus: "submitted", hnTables: [], members: [],
  sheets: [trang(101)],
  ...over,
});

const h = vi.hoisted(() => ({
  updateQuote: null as unknown as ReturnType<typeof vi.fn>,
  createQuote: null as unknown as ReturnType<typeof vi.fn>,
  getQuote: null as unknown as ReturnType<typeof vi.fn>,
}));

vi.mock("../lib/api", async (goc) => {
  const that = await goc<typeof import("../lib/api")>();
  const fns: Record<string, ReturnType<typeof vi.fn>> = {
    metaCompanies: vi.fn(async () => CTY),
    metaTemplates: vi.fn(async () => MAU),
    getQuote: vi.fn(async () => baoGia()),
    presence: vi.fn(async () => ({ editing: [] })),
    hnAccounts: vi.fn(async () => ({ data: [] })),
    updateQuote: vi.fn(async (_id: number, p: Record<string, unknown>) => ({ ...baoGia(), ...JSON.parse(JSON.stringify(p)), updatedAt: "2026-09-21T00:00:00.000Z" })),
    createQuote: vi.fn(async () => ({ id: 99 })),
    markLost: vi.fn(async () => baoGia({ status: "lost" })),
    hnReview: vi.fn(async () => ({})),
    sheetCustomerDecision: vi.fn(async () => ({ custStatus: "rejected" })),
  };
  h.updateQuote = fns.updateQuote;
  h.createQuote = fns.createQuote;
  h.getQuote = fns.getQuote;
  const api = new Proxy(fns, { get: (t, k: string) => t[k] ?? (t[k] = vi.fn(async () => ({}))) });
  return { ...that, api };
});
vi.mock("../lib/ui", async (goc) => ({
  ...(await goc<typeof import("../lib/ui")>()),
  toast: vi.fn(),
  confirmModal: vi.fn(async () => true),
  promptModal: vi.fn(async () => "lý do"),
  modalChotBaoGia: vi.fn(async () => []),
}));
vi.mock("../lib/venueCatalog", async (goc) => ({ ...(await goc<typeof import("../lib/venueCatalog")>()), loadCatalog: () => Promise.resolve({ entries: [], venues: [] }) }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { QuoteEditorPage } from "./QuoteEditor";
import { api } from "../lib/api";
import * as ui from "../lib/ui";

const ME = { id: 1, username: "a", displayName: "A", role: "admin", permissions: ["quote:send", "quote:update:all", "quote:hn:manage", "quote:read:all", "quote:internal:pay"] };
type WinDirty = Window & { __editorDirty?: boolean };

let root: Root | null = null;
let hop: HTMLDivElement | null = null;
const cho = async (ms = 0) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };

async function moEditor(quoteId: number | undefined = 11, isNew = false) {
  hop = document.createElement("div");
  document.body.appendChild(hop);
  root = createRoot(hop);
  await act(async () => { root!.render(<QuoteEditorPage me={ME} quoteId={quoteId} isNew={isNew} />); });
  await cho(10);
}
function dongEditor() { act(() => root!.unmount()); root = null; hop?.remove(); hop = null; }
const nut = (chu: string) => {
  const b = [...hop!.querySelectorAll("button")].find((x) => x.textContent?.includes(chu));
  if (!b) throw new Error("không thấy nút " + chu);
  return b as HTMLButtonElement;
};
const oTenKhach = () => hop!.querySelector('input[placeholder="Tên công ty khách"]') as HTMLInputElement;
function go(el: HTMLInputElement | HTMLTextAreaElement, chu: string) {
  act(() => { el.value = chu; el.dispatchEvent(new Event("input", { bubbles: true })); });
}
const bam = async (b: HTMLElement) => { await act(async () => { b.click(); }); await cho(10); };
const hopCheckbox = (chu: string) => [...hop!.querySelectorAll("label.toggle-totals")].find((l) => l.textContent?.includes(chu))!.querySelector("input") as HTMLInputElement;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  (window as WinDirty).__editorDirty = false;
  location.hash = "";
});
afterEach(async () => {
  await cho(1300);
  if (root) act(() => root!.unmount());
  root = null; hop?.remove(); hop = null; document.body.innerHTML = "";
});

// L56: GRID-07 + app#15 đã khoá ô meta, lưới, thêm/xoá sheet, Nhập Excel theo `saving`, nhưng còn sót
// ô Discount, hai checkbox Hiện tổng / Ghi chú, ô Ghi chú (và nút ý kiến khách theo sheet). Sửa chúng
// lúc PUT đang bay → qRef bị thay bằng bản máy chủ, cờ bẩn tắt, ô vẫn hiện số mới → lần Lưu sau gửi 0.
describe("L56 — khoá Discount / Ghi chú / Hiện tổng trong lúc đang Lưu", () => {
  it("updateQuote treo: ô Discount, checkbox Hiện tổng + Ghi chú, ô Ghi chú, nút ý kiến khách đều bị khoá", async () => {
    h.getQuote.mockImplementationOnce(async () => baoGia({ notes: "Ghi chú cũ" }));
    await moEditor();
    go(oTenKhach(), "Khách MỚI");
    let xong!: () => void;
    h.updateQuote.mockImplementationOnce((_id: number, p: Record<string, unknown>) => new Promise((r) => { xong = () => r({ ...baoGia(), ...JSON.parse(JSON.stringify(p)), updatedAt: "2026-09-21T00:00:00.000Z" }); }));
    await bam(nut("Lưu"));
    const disc = hop!.querySelector(".sheet-discount-input") as HTMLInputElement;
    const ghiChu = hop!.querySelector('textarea[placeholder^="VD: Tất cả"]') as HTMLTextAreaElement;
    const trangThai = {
      discount: disc.disabled,
      hienTong: hopCheckbox("Hiển thị bảng").disabled,
      coGhiChu: hopCheckbox("Ghi chú").disabled,
      oGhiChu: ghiChu.disabled,
      khachDuyet: nut("✓ Khách duyệt").disabled,
    };
    expect(trangThai).toEqual({ discount: true, hienTong: true, coGhiChu: true, oGhiChu: true, khachDuyet: true });
    await act(async () => { xong(); });
    await cho(10);
    expect(disc.disabled).toBe(false);
    expect(hopCheckbox("Hiển thị bảng").disabled).toBe(false);
  });
});
