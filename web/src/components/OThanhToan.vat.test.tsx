/** @vitest-environment jsdom */
// HÓA ĐƠN VAT + XEM CHỨNG TỪ TỪ BẢNG NỘI BỘ (chủ repo 2026-10-06: "có để kế toán cho hình và hiển thị bên nội bộ chứ, và cũng
// như là nếu có VAT thì cho thêm ô bỏ VAT vào, nếu có VAT mà chỉ mới thanh toán thôi thì bên nội bộ báo là đã thanh toán chưa
// VAT và cho kế toán update vào nhé").
//
//   · Cột Thanh toán (lưới màn soạn / Account HN + màn chỉ-xem nội bộ): ba trạng thái VAT theo chứng từ HIỆN TẠI; hàng HĐNS / TM
//     như cũ; 📎 / 🧾 bấm mở hộp xem chứng từ (GET /quotes/:id/khoan-chi/:side/:rid/anh) — chỉ xem, không ô nhập nào.
//   · Hộp Khoản chi (trang Hóa đơn đầu vào): phần "Hóa đơn VAT" chỉ khi chứng từ = VAT (hoặc khoản đã có HĐ); đưa ảnh / PDF
//     gửi `vatProof`, gỡ gửi `vatProof: null`; không cần tích Đã chi.
//   · Bộ lọc "Đã TT · chưa VAT" của trang Hóa đơn đầu vào.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const PDF = `data:application/pdf;base64,${btoa("%PDF-1.4\n%%EOF\n")}`;
const ANH = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const h = vi.hoisted(() => ({
  daChi: null as unknown, quote: null as unknown,
  xem: vi.fn(), ghi: vi.fn(), anh: vi.fn(),
}));
vi.mock("../lib/venueCatalog", async (goc) => ({ ...(await goc<typeof import("../lib/venueCatalog")>()), loadCatalog: () => Promise.resolve({ entries: [], venues: [] }) }));
vi.mock("../lib/ui", async (goc) => ({ ...(await goc<typeof import("../lib/ui")>()), toast: () => {}, confirmModal: async () => true }));
vi.mock("../lib/anhChungTu", async (goc) => ({ ...(await goc<typeof import("../lib/anhChungTu")>()), compressImage: async () => ANH, docTepPdf: async () => PDF }));
vi.mock("../lib/api", async (goc) => {
  const that = await goc<typeof import("../lib/api")>();
  return { ...that, isPreviewMode: () => false, api: { ...that.api,
    quoteDaChi: vi.fn(async () => h.daChi),
    getQuote: vi.fn(async () => h.quote),
    metaTemplates: vi.fn(async () => MAU),
    chungTuNoiBo: h.xem,
    ghiKhoanChi: h.ghi,
    anhKhoanChi: h.anh,
  } };
});
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { OThanhToan } from "./OThanhToan";
import { ExtraTables, type ExtraTable } from "./ExtraTables";
import { HopKhoanChi } from "./HopKhoanChi";
import { InternalQuoteView } from "../pages/InternalQuoteView";
import { locHang, BO_LOC_RONG } from "../pages/InvoicesIn";
import { dungMap } from "../lib/daChiHang";
import type { EditorTemplate, InputInvoiceRow } from "../lib/api";

const MAU: EditorTemplate[] = [{ id: 1, code: "gn", name: "GN (không ngày)", companyId: 1, layout: { hasDetail: false, reserveDetail: false, hasDays: false, numberSubsections: false } } as EditorTemplate];
const hang = (o: Record<string, unknown> = {}) => ({ kind: "item", name: "Backdrop", unit: "m2", quantity: 1, unitPrice: 250000, notes: "", approved: true, ...o });
const DA = { paidAt: "2026-10-06T03:00:00.000Z", paidByName: "Kế toán Lan", coAnh: true, coHdVat: false, hdVatLuc: null };

let thung: HTMLDivElement, goc: Root;
beforeEach(() => {
  thung = document.createElement("div"); document.body.appendChild(thung); goc = createRoot(thung);
  h.xem.mockReset(); h.ghi.mockReset(); h.anh.mockReset();
});
afterEach(() => { act(() => goc.unmount()); thung.remove(); document.body.innerHTML = ""; });
const cho = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });
const ve = (el: React.ReactElement) => act(() => { goc.render(el); });

describe("OThanhToan — ba trạng thái VAT theo chứng từ hiện tại", () => {
  it("VAT: đã chi chưa HĐ → '· chưa VAT' (cảnh báo); đã chi có HĐ → '· đã có VAT' + 🧾; chưa chi có HĐ → 'Có HĐ VAT · chưa TT'", () => {
    ve(<div>
      <p id="a"><OThanhToan h={{ rid: "a", ...DA, paid: true }} chungTu="VAT" /></p>
      <p id="b"><OThanhToan h={{ rid: "b", ...DA, paid: true, coHdVat: true }} chungTu="VAT" /></p>
      <p id="c"><OThanhToan h={{ rid: "c", paidAt: null, paidByName: null, coAnh: false, coHdVat: true, paid: false }} chungTu="VAT" /></p>
    </div>);
    const t = (id: string) => thung.querySelector(`#${id}`)!.textContent;
    expect(t("a")).toBe("✓ Đã TT 06/10/2026 · chưa VAT 📎Kế toán Lan");
    expect(thung.querySelector("#a .pay-da")!.classList.contains("pay-chua-vat")).toBe(true);
    expect(t("b")).toBe("✓ Đã TT 06/10/2026 · đã có VAT 📎 🧾Kế toán Lan");
    expect(t("c")).toBe("Có HĐ VAT · chưa TT 🧾");
    expect(thung.querySelector("#c .pay-da")!.getAttribute("data-vat")).toBe("vat-chua-tt");
  });

  it("HĐNS / TM: như cũ — không nhắc VAT; chưa chi mà có HĐ VAT cũ (chứng từ đã đổi khỏi VAT) → '—'", () => {
    ve(<div>
      <p id="a"><OThanhToan h={{ rid: "a", ...DA, paid: true }} chungTu="HDNS" /></p>
      <p id="b"><OThanhToan h={{ rid: "b", paidAt: null, paidByName: null, coAnh: false, coHdVat: true, paid: false }} chungTu="TM" /></p>
      <p id="c"><OThanhToan h={{ rid: "c", ...DA, paid: true, coHdVat: true }} chungTu="TM" /></p>
    </div>);
    expect(thung.querySelector("#a")!.textContent).toBe("✓ Đã TT 06/10/2026 📎Kế toán Lan");
    expect(thung.querySelector("#b")!.textContent).toBe("—");
    expect(thung.querySelector("#c")!.textContent, "HĐ VAT không hiện khi chứng từ không còn là VAT").toBe("✓ Đã TT 06/10/2026 📎Kế toán Lan");
  });

  it("dungMap: hàng chưa chi có HĐ VAT (vatChuaChi) vào map với paid=false; gắn nguồn báo giá + phía", () => {
    const m = dungMap(7, "sheet", { sheet: [{ rid: "a", ...DA }], hn: [], vatChuaChi: { sheet: [{ rid: "b", paidAt: null, paidByName: null, coAnh: false, coHdVat: true }], hn: [] } });
    expect(m.get("a")?.paid).toBe(true);
    expect(m.get("b")?.paid).toBe(false);
    expect(m.nguon).toEqual({ quoteId: 7, side: "sheet" });
  });
});

describe("Lưới bảng nội bộ: bấm 🧾 / 📎 mở hộp xem chứng từ (chỉ xem)", () => {
  it("🧾 → GET chứng từ loai=vat của đúng báo giá / phía / rid; PDF hiện chữ 'Hóa đơn dạng PDF', không ô nhập; Esc đóng", async () => {
    h.xem.mockResolvedValue({ dataUrl: PDF, mime: "application/pdf", loai: "vat", uploadedAt: "2026-10-06T04:00:00.000Z", uploadedByName: "Kế toán Lan" });
    const s = { id: 1, templateId: 1, extraTables: [{ category: "hcm", templateId: 1, name: "B", items: [hang({ rid: "r1", name: "Thuê xe", chungTu: "VAT" })] }] as unknown as ExtraTable[], _activeExtra: 0 };
    const daChi = dungMap(42, "sheet", { sheet: [{ rid: "r1", ...DA, coHdVat: true }], hn: [] });
    ve(<ExtraTables sheet={s} templates={MAU} companyId={1} editable canApprove onMarkDirty={() => {}} daChi={daChi} />);
    act(() => { (thung.querySelectorAll(".khoi-sheet-nut")[0] as HTMLButtonElement).click(); });
    const nut = thung.querySelector<HTMLButtonElement>('td.col-pay button[data-loai="vat"]')!;
    expect(nut).not.toBeNull();
    await act(async () => { nut.click(); });
    await cho();
    expect(h.xem).toHaveBeenCalledWith(42, "sheet", "r1", "vat");
    const hop = document.querySelector('[role="dialog"].xem-ct')!;
    expect(hop.textContent).toMatch(/Hóa đơn VAT/);
    expect(hop.textContent).toMatch(/Hóa đơn dạng PDF/);
    expect(hop.querySelectorAll("input, select, textarea"), "chỉ xem").toHaveLength(0);
    act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(document.querySelector(".xem-ct")).toBeNull();
  });

  it("màn chỉ-xem nội bộ: 📎 → ảnh ủy nhiệm chi hiện tại (img); lỗi máy chủ → câu lỗi + Thử lại", async () => {
    h.daChi = { quoteId: 21, sheet: [{ rid: "r1", ...DA }], hn: [], vatChuaChi: { sheet: [], hn: [] } };
    h.quote = { id: 21, quoteNumber: "GN26021", companyId: 1, _internalView: true,
      internalSheets: [{ sheetId: 201, sheetName: "Trang 1", order: 1, tables: [{ category: "hcm", templateId: 1, name: "HCM", items: [hang({ rid: "r1", chungTu: "VAT" })] }] }], hnTables: [] };
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => { goc.render(<QueryClientProvider client={qc}><InternalQuoteView quoteId={21} me={{ id: 1 } as never} /></QueryClientProvider>); });
    await cho();
    expect(thung.querySelector("td.col-pay")!.textContent).toBe("✓ Đã TT 06/10/2026 · chưa VAT 📎Kế toán Lan");
    const { ApiError } = await import("../lib/api");
    h.xem.mockRejectedValueOnce(new ApiError("Bạn không có quyền xem báo giá này", 403, null)).mockResolvedValueOnce({ dataUrl: ANH, mime: "image/png", loai: "chi", uploadedAt: null, uploadedByName: null });
    await act(async () => { thung.querySelector<HTMLButtonElement>('td.col-pay button[data-loai="chi"]')!.click(); });
    await cho();
    expect(h.xem).toHaveBeenCalledWith(21, "sheet", "r1", "chi");
    expect(document.querySelector('.xem-ct [role="alert"]')!.textContent).toMatch(/không có quyền/);
    await act(async () => { [...document.querySelectorAll<HTMLButtonElement>(".xem-ct button")].find((b) => b.textContent === "Thử lại")!.click(); });
    await cho();
    expect(document.querySelector<HTMLImageElement>(".xem-ct img")!.getAttribute("src")).toBe(ANH);
  });
});

const dong = (o: Partial<InputInvoiceRow> = {}): InputInvoiceRow => ({
  key: "9:sheet:r1", quoteId: 9, quoteCode: "GN26009", title: "Sự kiện", status: "converted",
  customerCode: null, customerName: "Khách", companyName: "GN", createdByName: null,
  sheetId: 1, sheetName: "Trang 1", sheetCode: "GN26009", side: "sheet", category: "hcm", tableName: null,
  rid: "r1", name: "Thuê xe", detail: null, unit: null, quantity: 1, unitPrice: 100, days: null, amount: 100,
  ns: null, chungTu: "VAT", luuKho: false, approvedAt: null, approvedByName: null, trangThaiHang: "binh-thuong",
  coTheGhi: true, lyDoKhoa: null, version: 2, paid: false, paidAt: null, paidByName: null, hasPaidProof: false,
  hasVatProof: false, vatProofAt: null, vatProofByName: null, proofs: [], paidAmount: null, tienDoi: false,
  invoiceDate: null, accountingNote: null, keToanCapNhatLuc: null, keToanCapNhatBoi: null, nguon: "bang", ...o,
});
const hopKt = (row: InputInvoiceRow, canPay = true) =>
  ve(<HopKhoanChi row={row} canPay={canPay} canEdit onDong={() => {}} onDaLuu={() => {}} onNapLai={() => {}} />);
const nutHop = (chu: string) => [...document.querySelectorAll<HTMLButtonElement>(".inv-in-hop button")].find((b) => b.textContent === chu);

describe("Hộp Khoản chi — phần Hóa đơn VAT", () => {
  it("chỉ hiện khi chứng từ = VAT (HĐNS / TM không có), ô tệp có name + nhận PDF", () => {
    hopKt(dong({ chungTu: "TM" }));
    expect(document.querySelector("[data-phan-vat]")).toBeNull();
    act(() => goc.unmount()); goc = createRoot(thung);
    hopKt(dong());
    const phan = document.querySelector("[data-phan-vat]")!;
    expect(phan.textContent).toMatch(/Chưa có hóa đơn VAT/);
    const tep = phan.querySelector<HTMLInputElement>('input[type="file"]')!;
    expect(tep.getAttribute("name")).toBe("hoaDonVat");
    expect(tep.getAttribute("accept")).toMatch(/application\/pdf/);
  });

  it("CHƯA tích Đã chi vẫn đưa được PDF: Lưu gửi đúng { baseVersion, vatProof } (không kèm paid)", async () => {
    h.ghi.mockResolvedValue({ row: { key: "9:sheet:r1" } });
    hopKt(dong());
    const tep = document.querySelector<HTMLInputElement>('input[name="hoaDonVat"]')!;
    const f = new File(["%PDF-1.4"], "hd.pdf", { type: "application/pdf" });
    Object.defineProperty(tep, "files", { value: [f], configurable: true });
    await act(async () => { tep.dispatchEvent(new Event("change", { bubbles: true })); });
    await cho();
    expect(document.querySelector("[data-phan-vat]")!.textContent).toMatch(/Hóa đơn PDF vừa chọn/);
    await act(async () => { nutHop("Lưu")!.click(); });
    expect(h.ghi).toHaveBeenCalledWith(9, "sheet", "r1", { baseVersion: 2, vatProof: PDF });
  });

  it("đã có HĐ VAT: 'Xem hóa đơn' tải loai=vat; 'Gỡ hóa đơn' → vatProof: null; đã chi chưa HĐ → câu cảnh báo", async () => {
    h.anh.mockResolvedValue({ paidProof: ANH, proofId: 12, retiredAt: null, nguon: "bang", loai: "vat", mime: "image/png" });
    h.ghi.mockResolvedValue({ row: { key: "9:sheet:r1" } });
    hopKt(dong({ hasVatProof: true, vatProofAt: "2026-10-06T04:00:00.000Z", vatProofByName: "Lan",
      proofs: [{ id: 12, uploadedAt: "2026-10-06T04:00:00.000Z", uploadedByName: "Lan", retiredAt: null, retiredReason: null, source: "upload", hienTai: true, loai: "vat", mime: "image/png" }] }));
    expect(document.querySelector("[data-phan-vat]")!.textContent).toMatch(/Đã có hóa đơn VAT/);
    await act(async () => { nutHop("Xem hóa đơn")!.click(); });
    await cho();
    expect(h.anh).toHaveBeenCalledWith(9, "sheet", "r1", undefined, "vat");
    expect(document.querySelector<HTMLImageElement>("[data-phan-vat] .pay-proof img")!.getAttribute("src")).toBe(ANH);
    await act(async () => { nutHop("Gỡ hóa đơn")!.click(); });
    await act(async () => { nutHop("Lưu")!.click(); });
    expect(h.ghi).toHaveBeenCalledWith(9, "sheet", "r1", { baseVersion: 2, vatProof: null });
    act(() => goc.unmount()); goc = createRoot(thung);
    hopKt(dong({ paid: true, paidAt: "2026-10-06T03:00:00.000Z" }));
    expect(document.querySelector("[data-phan-vat]")!.textContent).toMatch(/Đã chi nhưng chưa có hóa đơn VAT/);
  });
});

describe("Trang Hóa đơn đầu vào — bộ lọc HĐ VAT", () => {
  it("'Đã TT · chưa VAT' chỉ giữ hàng VAT đã chi chưa có HĐ; hai trạng thái còn lại lọc đúng; hàng TM không bao giờ khớp", () => {
    const rows = [
      dong({ key: "a", name: "A", paid: true }),
      dong({ key: "b", name: "B", paid: true, hasVatProof: true }),
      dong({ key: "c", name: "C", paid: false, hasVatProof: true }),
      dong({ key: "d", name: "D", paid: true, chungTu: "TM" }),
      dong({ key: "e", name: "E", paid: false }),
    ];
    const ten = (vat: string) => locHang(rows, { ...BO_LOC_RONG, vat }).map((r) => r.name);
    expect(ten("chua-vat")).toEqual(["A"]);
    expect(ten("da-vat")).toEqual(["B"]);
    expect(ten("vat-chua-tt")).toEqual(["C"]);
    expect(ten("")).toHaveLength(5);
    expect(locHang(rows, { ...BO_LOC_RONG, q: "chua thanh toan" }).map((r) => r.name), "tìm 'chưa thanh toán' không khớp hàng ĐÃ chi thiếu HĐ").toEqual(["C", "E"]);
  });
});
