/** @vitest-environment jsdom */
//
// CHIA HÓA ĐƠN Ở MÀN BÁO GIÁ (chủ repo 2026-10-07: "không nó phải nằm ở chỗ duyệt cơ", "ở trong phần báo giá luôn á",
// "account chủ báo giá là người làm cái đó, chọn xuất hóa đơn chia như nào").
//   1. Hộp "✓ Khách chốt cả báo giá" nhận báo giá dạng lib/hoaDonChia (để hiện ô chọn + xem trước); phép chia hộp trả về đi
//      CÙNG lệnh chốt (api.markConverted(id, chia)) — máy chủ áp trong một transaction. Không đổi gì → chốt y như cũ.
//   2. Sau khi chốt: nút "Chia hóa đơn" CHỈ cho chủ báo giá / admin (quote:send) — account phụ, kế toán không thấy.
// ĐỎ trên 643b491: hộp chốt không nhận báo giá, markConverted không mang phép chia, không có nút "Chia hóa đơn".
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const MAU = [{ id: 1, code: "gn", name: "GN", companyId: 7, layout: { hasDays: false } }];
const CTY = [{ id: 7, name: "Gia Nguyễn" }];
const trang = (id: number, codeNo: number, name: string, gia: number, extra: Record<string, unknown> = {}) =>
  ({ id, codeNo, templateId: 1, name, groupSubtotal: false, subtotal: gia, custStatus: "approved", items: [{ kind: "item", name: "HM", unit: "cái", quantity: 1, unitPrice: gia }], extraTables: [], ...extra });

const h = vi.hoisted(() => ({ baoGia: {} as Record<string, unknown>, chot: [] as unknown }));
const baoGia = (over: Record<string, unknown> = {}) => ({
  id: 11, quoteNumber: "GN26011", projectCode: "FP_11", title: "Sự kiện", status: "sent", companyId: 7, createdById: 1,
  toCompany: "Khách", vatPercent: 8, discount: 0, showTotals: true, quoteDate: "2026-09-20",
  updatedAt: "2026-09-20T00:00:00.000Z", hnTables: [], members: [],
  sheets: [trang(101, 1, "Sân khấu", 1000), trang(102, 2, "Âm thanh", 2000), trang(103, 3, "Ánh sáng", 4000)],
  ...over,
});

vi.mock("../lib/api", async (goc) => {
  const that = await goc<typeof import("../lib/api")>();
  const fns: Record<string, ReturnType<typeof vi.fn>> = {
    metaCompanies: vi.fn(async () => CTY),
    metaTemplates: vi.fn(async () => MAU),
    getQuote: vi.fn(async () => h.baoGia),
    presence: vi.fn(async () => ({ editing: [] })),
    hnAccounts: vi.fn(async () => ({ data: [] })),
    markConverted: vi.fn(async () => ({ ...h.baoGia, status: "converted", updatedAt: "2026-09-22T00:00:00.000Z" })),
    sheetCustomerDecision: vi.fn(async () => ({ custStatus: "approved" })),
  };
  const api = new Proxy(fns, { get: (t, k: string) => t[k] ?? (t[k] = vi.fn(async () => ({}))) });
  return { ...that, api };
});
vi.mock("../lib/ui", async (goc) => ({
  ...(await goc<typeof import("../lib/ui")>()),
  toast: vi.fn(),
  confirmModal: vi.fn(async () => true),
  modalChotBaoGia: vi.fn(async () => h.chot),
}));
vi.mock("../lib/venueCatalog", async (goc) => ({ ...(await goc<typeof import("../lib/venueCatalog")>()), loadCatalog: () => Promise.resolve({ entries: [], venues: [] }) }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { QuoteEditorPage } from "./QuoteEditor";
import { api } from "../lib/api";
import * as ui from "../lib/ui";

const ADMIN = { id: 1, username: "a", displayName: "A", role: "admin", permissions: ["quote:send", "quote:update:all", "quote:read:all"] };
const CHU = { id: 1, username: "lan", displayName: "Lan", role: "manager", permissions: ["quote:send", "quote:update:own", "quote:read:own", "quote:create"] };

let root: Root | null = null;
let hop: HTMLDivElement | null = null;
const cho = async (ms = 0) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
async function moEditor(me: typeof ADMIN) {
  hop = document.createElement("div");
  document.body.appendChild(hop);
  root = createRoot(hop);
  await act(async () => { root!.render(<QuoteEditorPage me={me} quoteId={11} isNew={false} />); });
  await cho(10);
}
const timNut = (chu: string) => [...hop!.querySelectorAll("button")].find((x) => x.textContent?.trim() === chu) as HTMLButtonElement | undefined;
const bam = async (b: HTMLButtonElement) => { await act(async () => { b.click(); }); await cho(10); };

beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); h.baoGia = baoGia(); h.chot = []; });
afterEach(async () => {
  await cho(1300);
  if (root) act(() => root!.unmount());
  root = null; hop?.remove(); hop = null; document.body.innerHTML = "";
});

describe("chia hóa đơn lúc khách chốt", () => {
  it("hộp chốt nhận báo giá (đủ sheet, mã dự án); phép chia hộp trả về đi CÙNG lệnh chốt", async () => {
    const chia = [{ sheetId: 101, group: 1, hold: null }, { sheetId: 102, group: 1, hold: null }, { sheetId: 103, group: null, hold: "later" }];
    h.chot = Object.assign([], { chiaHoaDon: chia });
    await moEditor(ADMIN);
    await bam(timNut("✓ Khách chốt cả báo giá")!);
    const goi = vi.mocked(ui.modalChotBaoGia).mock.calls[0];
    const vao = goi[3] as { quote: { projectCode: string; sheets: { id: number; codeNo: number; subtotal: number }[] } };
    expect(vao.quote.projectCode).toBe("FP_11");
    expect(vao.quote.sheets.map((s) => [s.id, s.codeNo])).toEqual([[101, 1], [102, 2], [103, 3]]);
    expect(api.markConverted).toHaveBeenCalledWith(11, chia);
  });

  it("không đổi phép chia → chốt y như cũ (markConverted chỉ với id)", async () => {
    await moEditor(ADMIN);
    await bam(timNut("✓ Khách chốt cả báo giá")!);
    expect(vi.mocked(api.markConverted).mock.calls[0]).toEqual([11]);
  });
});

describe("nút 'Chia hóa đơn' sau khi chốt — chỉ chủ báo giá / admin", () => {
  it("chủ báo giá (account tạo) thấy nút; bấm mở hộp Chia hóa đơn", async () => {
    h.baoGia = baoGia({ status: "converted" });
    await moEditor(CHU);
    const nut = timNut("Chia hóa đơn");
    expect(nut, "chủ báo giá phải thấy nút").toBeTruthy();
    await bam(nut!);
    expect(document.querySelector('[role="dialog"][aria-label^="Chia hóa đơn"]')).not.toBeNull();
  });

  it("admin thấy nút trên báo giá của người khác", async () => {
    h.baoGia = baoGia({ status: "converted", createdById: 9 });
    await moEditor(ADMIN);
    expect(timNut("Chia hóa đơn")).toBeTruthy();
  });

  it("account PHỤ (được thêm vào, đủ 4 vùng) KHÔNG thấy; kế toán KHÔNG thấy; báo giá chưa chốt KHÔNG có", async () => {
    h.baoGia = baoGia({ status: "converted", createdById: 9, members: [{ id: 1, username: "lan", displayName: "Lan", scopes: ["main", "hcm", "hanoi", "khach"] }] });
    await moEditor(CHU);
    expect(timNut("Chia hóa đơn")).toBeUndefined();
    act(() => root!.unmount()); root = null; hop?.remove();

    h.baoGia = baoGia({ status: "converted", createdById: 9 });
    await moEditor({ id: 1, username: "kt", displayName: "KT", role: "accountant", permissions: ["invoice:page", "invoice:edit", "invoice:pay", "quote:read:all"] });
    expect(timNut("Chia hóa đơn")).toBeUndefined();
    act(() => root!.unmount()); root = null; hop?.remove();

    h.baoGia = baoGia({ status: "sent" });
    await moEditor(CHU);
    expect(timNut("Chia hóa đơn")).toBeUndefined();
  });
});
