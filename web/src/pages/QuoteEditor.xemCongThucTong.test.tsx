/** @vitest-environment jsdom */
//
// BẤM VÀO SỐ TỔNG → HIỆN CÔNG THỨC + TÔ Ô GÓP VÀO, như bấm ô công thức của lưới. Chủ repo 2026-10-07: "tôi nhấn vào tổng
// sheet nó chưa hiện các ô lên xem cộng như nào công thức ra sao, cả thành tiền nữa" — bản cũ (SummaryFormula) chỉ bật
// toast "=SUM(Thành Tiền các hàng) = …", không ô nào sáng, không có tham chiếu ô.
// Dựng QuoteEditor thật (giàn createRoot + act như QuoteEditor.soatToanDien.test.tsx), bấm từng ô của khối tổng sheet và
// bảng "Tổng báo giá", rồi soi: chữ trong ô, tập ô mang `cell-ref-active` (đúng lớp tô của lưới), Esc / bấm ra ngoài /
// bấm lại thì tắt, và không đánh dấu báo giá đã sửa.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const MAU = [{ id: 1, code: "gn", name: "GN (không ngày)", companyId: 7, layout: { hasDays: false } }];
const CTY = [{ id: 7, name: "Gia Nguyễn" }];
const hang = (kind: string, quantity: number, unitPrice: number, name: string) => ({ kind, name, unit: "cái", quantity, unitPrice });

// Sheet 1 — bật "Hiện Thành Tiền nhóm", Discount 30.000. Địa chỉ (mẫu không ngày, có cột ghi chú nội bộ):
// A STT · B Hạng mục · C ĐVT · D SL · E Đơn giá · F Thành tiền.
//   F1 Backdrop 1.000.000 · F2 Nhóm A = (600.000 + 100.000 + 50.000) × 2 · F7 Nhóm con B = 10.000 × 3 · nhóm rỗng F9 bỏ.
const SHEET1 = [
  hang("item", 1, 1_000_000, "Backdrop"),
  hang("section", 2, 0, "Nhóm A"),
  hang("item", 2, 300_000, "Standee"),
  hang("sub", 1, 100_000, "Chân đế"),
  hang("info", 0, 0, "Ghi chú nhóm A"),
  hang("item", 1, 50_000, "Phụ kiện"),
  hang("subsection", 3, 0, "Nhóm con B"),
  hang("item", 1, 10_000, "Tem"),
  hang("section", 1, 0, "Nhóm rỗng"),
];
// Sheet 2 — KHÔNG bật nhóm, khách không duyệt: cộng thẳng từng mục, hàng nhóm cắt dải, dòng thông tin không cắt.
const SHEET2 = [
  hang("item", 1, 1_000_000, "Màn LED"),
  hang("item", 1, 200_000, "Dây"),
  hang("section", 1, 0, "Nhóm X"),
  hang("item", 1, 300_000, "Âm thanh"),
  hang("info", 0, 0, "ghi chú"),
  hang("item", 1, 400_000, "Ánh sáng"),
];
const baoGia = () => ({
  id: 11, quoteNumber: "GN26011", title: "Sự kiện", status: "sent", companyId: 7, createdById: 1,
  toCompany: "Khách", vatPercent: 8, discount: 30_000, showTotals: true, quoteDate: "2026-10-07", notes: "",
  updatedAt: "2026-10-07T00:00:00.000Z", hnStatus: "draft", hnTables: [], members: [],
  sheets: [
    { id: 101, templateId: 1, name: "Sảnh", groupSubtotal: true, discount: 30_000, extraTables: [], items: SHEET1 },
    { id: 102, templateId: 1, name: "Phòng 1", groupSubtotal: false, discount: 0, extraTables: [], items: SHEET2, custStatus: "rejected" },
  ],
});

vi.mock("../lib/api", async (goc) => {
  const that = await goc<typeof import("../lib/api")>();
  const fns: Record<string, ReturnType<typeof vi.fn>> = {
    metaCompanies: vi.fn(async () => CTY),
    metaTemplates: vi.fn(async () => MAU),
    getQuote: vi.fn(async () => baoGia()),
    presence: vi.fn(async () => ({ editing: [] })),
    hnAccounts: vi.fn(async () => ({ data: [] })),
    quoteDaChi: vi.fn(async (id: number) => ({ quoteId: id, sheet: [], hn: [] })),
  };
  const api = new Proxy(fns, { get: (t, k: string) => t[k] ?? (t[k] = vi.fn(async () => ({}))) });
  return { ...that, api };
});
vi.mock("../lib/ui", async (goc) => ({ ...(await goc<typeof import("../lib/ui")>()), toast: vi.fn(), confirmModal: vi.fn(async () => true) }));
vi.mock("../lib/venueCatalog", async (goc) => ({ ...(await goc<typeof import("../lib/venueCatalog")>()), loadCatalog: () => Promise.resolve({ entries: [], venues: [] }) }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { QuoteEditorPage } from "./QuoteEditor";
import * as ui from "../lib/ui";

const ME = { id: 1, username: "a", displayName: "A", role: "admin", permissions: ["quote:send", "quote:update:all", "quote:read:all"] };
let root: Root | null = null;
let hop: HTMLDivElement | null = null;
const cho = async (ms = 0) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };

beforeEach(async () => {
  vi.clearAllMocks();
  localStorage.clear();
  location.hash = "";
  (window as Window & { __editorDirty?: boolean }).__editorDirty = false;
  hop = document.createElement("div");
  document.body.appendChild(hop);
  root = createRoot(hop);
  await act(async () => { root!.render(<QuoteEditorPage me={ME} quoteId={11} isNew={false} />); });
  await cho(10);
});
afterEach(async () => {
  await cho(1300);
  if (root) act(() => root!.unmount());
  root = null; hop?.remove(); hop = null; document.body.innerHTML = "";
});

/** Ô số của khối tổng sheet theo nhãn dòng ("Cộng", "VAT (8%)", …) — span bấm được nằm ở ô cuối của dòng. */
const oKhoi = (nhan: string) => {
  const tr = [...hop!.querySelectorAll(".sheet-total-box tr")].find((r) => r.querySelector("td")?.textContent?.trim().startsWith(nhan));
  if (!tr) throw new Error("không thấy dòng " + nhan);
  return tr.querySelector(".summary-formula-value") as HTMLElement;
};
const oBang = (nhan: string) => {
  const tr = [...hop!.querySelectorAll(".summary-table tr")].find((r) => r.querySelector("td")?.textContent?.trim().startsWith(nhan));
  if (!tr) throw new Error("không thấy dòng " + nhan);
  return tr.querySelector(".summary-formula-value") as HTMLElement;
};
/** Bấm như chuột thật: mousedown (bộ "bấm ra ngoài" nghe ở đây) rồi click. */
const bam = (el: Element) => act(() => {
  el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  el.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
});
const congThuc = (o: HTMLElement) => o.querySelector("code.o-tong-cong-thuc")?.textContent ?? null;
const oDangTo = () => [...document.querySelectorAll<HTMLElement>(".cell-ref-active")];
/** Chỉ số hàng lưới của các ô Thành tiền đang sáng. */
const hangLuoiDangTo = () => oDangTo().map((td) => {
  expect(td.classList.contains("col-amount"), "ô lưới sáng phải là ô Thành tiền").toBe(true);
  expect(td.closest("[data-luoi-chinh]"), "chỉ tô trong lưới CHÍNH").not.toBeNull();
  return Number(td.closest("tr")!.getAttribute("data-row"));
}).sort((a, b) => a - b);
const tdCua = (o: HTMLElement) => o.closest("td") as HTMLElement;

describe("Khối tổng của sheet — bấm số hiện công thức tham chiếu ô + tô ô góp vào", () => {
  it("Cộng (Tổng sheet) có nhóm: =F1+F2+F7, tô đúng ba ô Thành tiền đó (không tô nhóm rỗng, không tô từng mục trong nhóm)", async () => {
    const o = oKhoi("Cộng");
    expect(o.textContent).toContain("2.530.000");
    await bam(o);
    expect(congThuc(o)).toBe("=F1+F2+F7");
    expect(hangLuoiDangTo()).toEqual([0, 1, 6]);
    // Ô nhóm đang hiện ĐÚNG con số được cộng.
    const tr = (r: number) => hop!.querySelector(`[data-luoi-chinh] tr[data-row="${r}"] td.col-amount`)!.textContent;
    expect([tr(0), tr(1), tr(6)]).toEqual(["1.000.000", "1.500.000", "30.000"]);
    expect(o.getAttribute("title")).toContain("= 1.000.000 + 1.500.000 + 30.000 = 2.530.000");
    expect(ui.toast).not.toHaveBeenCalled();
    // Esc → về số, hết tô.
    await act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(congThuc(o)).toBeNull();
    expect(o.textContent).toContain("2.530.000");
    expect(oDangTo()).toEqual([]);
    expect((window as Window & { __editorDirty?: boolean }).__editorDirty, "xem công thức không phải là sửa báo giá").toBe(false);
  });

  it("nút ƒ bật/tắt; bấm lại tắt; bấm ra ngoài tắt", async () => {
    const o = oKhoi("Cộng");
    const nut = o.querySelector("button.summary-fx-btn") as HTMLButtonElement;
    await bam(nut);
    expect(congThuc(o)).toBe("=F1+F2+F7");
    expect(nut.getAttribute("aria-pressed")).toBe("true");
    await bam(nut);
    expect(congThuc(o)).toBeNull();
    expect(oDangTo()).toEqual([]);
    await bam(o);
    expect(oDangTo().length).toBe(3);
    await act(() => { document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); });
    expect(congThuc(o)).toBeNull();
    expect(oDangTo()).toEqual([]);
  });

  it("VAT: =ROUND((Cộng-Discount)*8%;0), tô ô Cộng + Discount", async () => {
    const o = oKhoi("VAT");
    expect(o.textContent).toContain("200.000");
    await bam(o);
    expect(congThuc(o)).toBe("=ROUND((Cộng-Discount)*8%;0)");
    expect(oDangTo()).toEqual([tdCua(oKhoi("Cộng")), tdCua(oKhoi("Discount"))]);
    expect(o.getAttribute("title")).toContain("= (2.530.000 − 30.000) × 8% = 200.000");
  });

  it("Thành tiền có Discount: =Cộng-Discount+VAT, tô Cộng + Discount + VAT; bấm sang ô khác thì ô cũ tắt", async () => {
    await bam(oKhoi("VAT"));
    const o = oKhoi("Thành tiền");
    await bam(o);
    expect(congThuc(oKhoi("VAT")), "mở ô mới phải tắt ô cũ").toBeNull();
    expect(congThuc(o)).toBe("=Cộng-Discount+VAT");
    expect(oDangTo()).toEqual([tdCua(oKhoi("Cộng")), tdCua(oKhoi("Discount")), tdCua(oKhoi("VAT"))]);
    expect(o.getAttribute("title")).toContain("= 2.530.000 − 30.000 + 200.000 = 2.700.000");
  });

  it("sheet KHÔNG bật nhóm: =SUM(F1:F2)+SUM(F4:F6) — tô từng mục, bỏ hàng nhóm; dòng thông tin không có ô Thành tiền", async () => {
    await act(async () => { (hop!.querySelector('.sheet-tabs [data-sheet-tab="1"]') as HTMLElement).click(); });
    await cho(10);
    const o = oKhoi("Tổng sheet");
    expect(o.textContent).toContain("1.900.000");
    await bam(o);
    expect(congThuc(o)).toBe("=SUM(F1:F2)+SUM(F4:F6)");
    expect(hangLuoiDangTo()).toEqual([0, 1, 3, 5]);
    await bam(oKhoi("VAT"));
    expect(congThuc(oKhoi("VAT"))).toBe("=ROUND(Tổng sheet*8%;0)");
    expect(oDangTo()).toEqual([tdCua(oKhoi("Tổng sheet"))]);
  });
});

describe("Bảng Tổng báo giá (nhiều sheet)", () => {
  it("Tổng cộng: =SUM(D2:D3), tô ô tổng từng sheet; nói rõ sheet khách không duyệt VẪN được cộng", async () => {
    const o = oBang("Tổng cộng");
    expect(o.textContent).toContain("4.400.000");
    await bam(o);
    expect(congThuc(o)).toBe("=SUM(D2:D3)");
    const cotTong = [...hop!.querySelectorAll(".summary-table tbody tr")].map((tr) => tr.querySelectorAll("td")[3]);
    expect(oDangTo()).toEqual(cotTong);
    expect(o.getAttribute("title")).toContain("= 2.500.000 + 1.900.000 = 4.400.000");
    expect(o.getAttribute("title")).toMatch(/kể cả sheet khách KHÔNG duyệt: 2\. “Phòng 1”/);
  });

  it("VAT =ROUND(D4*8%;0) tô ô Tổng cộng; Thành tiền =D4+D5 tô Tổng cộng + VAT", async () => {
    await bam(oBang("VAT"));
    expect(congThuc(oBang("VAT"))).toBe("=ROUND(D4*8%;0)");
    expect(oDangTo()).toEqual([tdCua(oBang("Tổng cộng"))]);
    await bam(oBang("Thành tiền"));
    expect(congThuc(oBang("Thành tiền"))).toBe("=D4+D5");
    expect(oDangTo()).toEqual([tdCua(oBang("Tổng cộng")), tdCua(oBang("VAT"))]);
    expect(oBang("Thành tiền").getAttribute("title")).toContain("= 4.400.000 + 352.000 = 4.752.000");
  });

  it("ô tổng của sheet ĐANG MỞ trỏ về ô Tổng cộng trong khối tổng của sheet đó", async () => {
    const o = [...hop!.querySelectorAll(".summary-table tbody tr")][0].querySelector(".summary-formula-value") as HTMLElement;
    await bam(o);
    expect(congThuc(o)).toBe("='Sảnh'!Cộng-'Sảnh'!Discount");
    expect(oDangTo()).toEqual([tdCua(oKhoi("Tổng cộng"))]);
  });
});
