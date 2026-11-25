/** @vitest-environment jsdom */
//
// MẪU CINETOUR ở màn soạn (chủ repo 2026-11-25): sheet dùng mẫu có cột SỐ CA hiện cột đó, tổng tính theo Số Ca; đổi
// sheet sang mẫu KHÔNG có cột Số Ca mà còn hàng Số Ca ≠ 1 thì HỎI trước (đó là đổi tiền — không mất dữ liệu im lặng);
// đồng ý thì Thành tiền thôi nhân Số Ca, Số Ca vẫn giữ trong phiên (chọn lại mẫu CINETOUR là lấy lại), Lưu với mẫu
// thường gửi shifts = null (máy chủ cũng ép — quoteUtils.chuanHoaSoCaTheoCoCa). ĐỎ trên 7a6ce18.
// Cùng khuôn createRoot + act với QuoteEditor.ngayVN.test.tsx.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const MAU = [
  { id: 1, code: "marico_decor", name: "GN (không ngày)", companyId: 7, layout: { hasDays: false, hasShifts: false, hasDetail: false, reserveDetail: true } },
  { id: 9, code: "gn_cinetour", name: "GN CINETOUR (không ngày)", companyId: 7, layout: { hasDays: false, hasShifts: true, hasDetail: false, reserveDetail: false } },
];
const CTY = [{ id: 7, name: "Gia Nguyễn" }];
const baoGia = (over: Record<string, unknown> = {}) => ({
  id: 11, quoteNumber: "GN26011", title: "Cinetour", status: "draft", companyId: 7, createdById: 1,
  toCompany: "CGV", vatPercent: 8, discount: 0, showTotals: true, city: "TP. Hồ Chí Minh",
  quoteDate: "2026-11-25T00:00:00.000Z", updatedAt: "2026-11-25T00:00:00.000Z", hnTables: [], members: [],
  sheets: [{ id: 101, templateId: 9, name: "Rạp", groupSubtotal: false, items: [
    { kind: "item", name: "Bảo vệ", unit: "người", quantity: 2, unitPrice: 100_000, days: null, shifts: 3 },
    { kind: "item", name: "Lễ tân", unit: "người", quantity: 1, unitPrice: 50_000, days: null, shifts: null },
  ], extraTables: [] }],
  ...over,
});

const h = vi.hoisted(() => ({ updateQuote: null as unknown as ReturnType<typeof vi.fn>, confirm: null as unknown as ReturnType<typeof vi.fn> }));
vi.mock("../lib/api", async (goc) => {
  const that = await goc<typeof import("../lib/api")>();
  const fns: Record<string, ReturnType<typeof vi.fn>> = {
    metaCompanies: vi.fn(async () => CTY),
    metaTemplates: vi.fn(async () => MAU),
    getQuote: vi.fn(async () => baoGia()),
    presence: vi.fn(async () => ({ editing: [] })),
    hnAccounts: vi.fn(async () => ({ data: [] })),
    updateQuote: vi.fn(async (_id: number, p: Record<string, unknown>) => baoGia({ ...p, updatedAt: "2026-11-25T01:00:00.000Z" })),
  };
  h.updateQuote = fns.updateQuote;
  const api = new Proxy(fns, { get: (t, k: string) => t[k] ?? (t[k] = vi.fn(async () => ({}))) });
  return { ...that, api };
});
vi.mock("../lib/ui", async (goc) => {
  const confirm = vi.fn(async () => true);
  h.confirm = confirm;
  return { ...(await goc<typeof import("../lib/ui")>()), toast: vi.fn(), confirmModal: confirm };
});
vi.mock("../lib/venueCatalog", async (goc) => ({ ...(await goc<typeof import("../lib/venueCatalog")>()), loadCatalog: () => Promise.resolve({ entries: [], venues: [] }) }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { QuoteEditorPage } from "./QuoteEditor";

const ME = { id: 1, username: "a", displayName: "A", role: "admin", permissions: ["quote:send", "quote:update:all", "quote:read:all"] };
let root: Root | null = null;
let hop: HTMLDivElement | null = null;
const cho = async (ms = 0) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };

beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); });
afterEach(async () => {
  await cho(1300);   // hẹn giờ ghi bản nháp 1,2s — cho nổ trong act rồi mới tháo cây
  if (root) act(() => root!.unmount());
  root = null; hop?.remove(); hop = null; document.body.innerHTML = "";
});

async function moEditor() {
  hop = document.createElement("div");
  document.body.appendChild(hop);
  root = createRoot(hop);
  await act(async () => { root!.render(<QuoteEditorPage me={ME} quoteId={11} isNew={false} />); });
  await cho(10);
}
const luoi = () => hop!.querySelector("[data-luoi-chinh] table.excel-table") as HTMLTableElement;
const tieuDe = () => [...luoi().querySelectorAll("thead th")].map((th) => (th.textContent || "").trim());
const thanhTien = (row: number) => (luoi().querySelector(`tr[data-row="${row}"] td.col-amount`)?.textContent || "").trim();
const oMau = () => hop!.querySelector('select[name="templateId"]') as HTMLSelectElement;
async function chonMau(id: number) {
  await act(async () => { const s = oMau(); s.value = String(id); s.dispatchEvent(new Event("change", { bubbles: true })); });
  await cho(5);
}
async function luu() {
  const nut = [...hop!.querySelectorAll("button.btn-primary")].find((b) => b.textContent?.trim() === "Lưu") as HTMLButtonElement;
  expect(nut, "không thấy nút Lưu").toBeTruthy();
  await act(async () => { nut.click(); }); await cho(10);
  return h.updateQuote.mock.calls.at(-1)?.[1] as { sheets: { templateId: number; items: { shifts?: number | null }[] }[] };
}

describe("màn soạn — sheet mẫu CINETOUR", () => {
  it("hiện cột SỐ CA và Thành tiền nhân Số Ca (trống = ×1)", async () => {
    await moEditor();
    expect(tieuDe()).toContain("SỐ CA");
    expect(thanhTien(0)).toBe("600.000");
    expect(thanhTien(1)).toBe("50.000");
  });

  it("đổi sang mẫu KHÔNG có Số Ca: hỏi trước; KHÔNG đồng ý thì giữ nguyên mẫu và tiền", async () => {
    await moEditor();
    h.confirm.mockResolvedValueOnce(false);
    await chonMau(1);
    expect(h.confirm).toHaveBeenCalledTimes(1);
    expect(String(h.confirm.mock.calls[0][1])).toContain("1 hạng mục");
    expect(oMau().value).toBe("9");
    expect(tieuDe()).toContain("SỐ CA");
    expect(thanhTien(0)).toBe("600.000");
  });

  it("đồng ý: Thành tiền thôi nhân Số Ca; chọn lại mẫu CINETOUR trước khi Lưu là lấy lại Số Ca", async () => {
    await moEditor();
    await chonMau(1);
    expect(h.confirm).toHaveBeenCalledTimes(1);
    expect(tieuDe()).not.toContain("SỐ CA");
    expect(thanhTien(0)).toBe("200.000");
    await chonMau(9);
    expect(tieuDe()).toContain("SỐ CA");
    expect(thanhTien(0), "Số Ca bị mất khi đổi mẫu qua lại").toBe("600.000");
  });

  it("Lưu với mẫu thường gửi shifts = null; Lưu với mẫu CINETOUR gửi nguyên Số Ca", async () => {
    await moEditor();
    const el = luoi().querySelector('tr[data-row="1"] [data-f="shifts"]') as HTMLInputElement;
    act(() => { el.focus(); }); act(() => { el.value = "2"; el.dispatchEvent(new Event("input", { bubbles: true })); }); act(() => { el.blur(); });
    let p = await luu();
    expect(p.sheets[0].items.map((x) => x.shifts)).toEqual([3, 2]);
    await chonMau(1);
    p = await luu();
    expect(p.sheets[0].templateId).toBe(1);
    expect(p.sheets[0].items.map((x) => x.shifts ?? null)).toEqual([null, null]);
  });
});
