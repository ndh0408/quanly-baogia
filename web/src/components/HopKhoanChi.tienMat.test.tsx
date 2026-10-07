/** @vitest-environment jsdom */
// HÌNH THỨC THANH TOÁN của khoản chi (chủ repo 2026-10-07: "cái thanh toán hóa đơn đầu vào có khi là tiền mặt ấy nhen").
//
//   · Hộp Khoản chi: tích "Đã chi" → chọn Chuyển khoản / Tiền mặt (hàng chứng từ TM gợi ý Tiền mặt); đổi được sau đó (Lưu chỉ
//     gửi `paidMethod`); bỏ tích không kèm hình thức. Tiền mặt: ô ảnh thành "Ảnh phiếu chi (không bắt buộc)".
//   · Ô Kế toán ở trang Hóa đơn đầu vào: "✓ Đã chi · tiền mặt · <ngày>", KHÔNG "⚠ chưa có ảnh"; chuyển khoản + khoản cũ như trước.
//   · Cột Thanh toán chỉ-xem của bảng nội bộ: "✓ Đã TT tiền mặt <ngày>" (VAT: "… · chưa VAT"); khoản cũ như trước.
//   · Bộ lọc "Đã TT · tiền mặt / chuyển khoản", tìm "tiền mặt"; Nhật ký đọc "Hình thức chi: Chuyển khoản → Tiền mặt".
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({ ghi: vi.fn(), anh: vi.fn(), resp: null as unknown }));
vi.mock("../lib/ui", async (goc) => ({ ...(await goc<typeof import("../lib/ui")>()), toast: () => {}, confirmModal: async () => true }));
vi.mock("../lib/api", async (goc) => {
  const that = await goc<typeof import("../lib/api")>();
  return { ...that, isPreviewMode: () => false, api: { ...that.api,
    inputInvoices: vi.fn(async () => h.resp),
    ghiKhoanChi: h.ghi,
    anhKhoanChi: h.anh,
  } };
});
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { HopKhoanChi } from "./HopKhoanChi";
import { OThanhToan } from "./OThanhToan";
import { InvoicesInPage, locHang, BO_LOC_RONG } from "../pages/InvoicesIn";
import { diffRows } from "../pages/Audit";
import { hinhThucCua, hinhThucGoiY, thanKhoanChi, thieuAnhChungTu, xungDotKhoanChi, giaTriTruong } from "../lib/khoanChi";
import type { InputInvoiceRow } from "../lib/api";

const NGAY = "2026-10-06T03:00:00.000Z";
const dong = (o: Partial<InputInvoiceRow> = {}): InputInvoiceRow => ({
  key: "9:sheet:r1", quoteId: 9, quoteCode: "GN26009", title: "Sự kiện", status: "converted",
  customerCode: null, customerName: "Khách", companyName: "GN", createdByName: null,
  sheetId: 1, sheetName: "Trang 1", sheetCode: "GN26009", side: "sheet", category: "hcm", tableName: null,
  rid: "r1", name: "Nước uống", detail: null, unit: null, quantity: 1, unitPrice: 100, days: null, amount: 100,
  ns: null, chungTu: null, luuKho: false, approvedAt: null, approvedByName: null, trangThaiHang: "binh-thuong",
  coTheGhi: true, lyDoKhoa: null, version: 2, paid: false, paidAt: null, paidByName: null, hasPaidProof: false,
  hasVatProof: false, vatProofAt: null, vatProofByName: null, proofs: [], paidAmount: null, tienDoi: false,
  invoiceDate: null, accountingNote: null, keToanCapNhatLuc: null, keToanCapNhatBoi: null, nguon: "bang", ...o,
});
const DU_QUYEN = { canPay: true, canEdit: true };

let thung: HTMLDivElement, goc: Root;
beforeEach(() => {
  thung = document.createElement("div"); document.body.appendChild(thung); goc = createRoot(thung);
  h.ghi.mockReset(); h.anh.mockReset();
  h.ghi.mockResolvedValue({ row: { key: "9:sheet:r1" } });
});
afterEach(() => { act(() => goc.unmount()); thung.remove(); document.body.innerHTML = ""; });
const cho = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });
const ve = (el: React.ReactElement) => act(() => { goc.render(el); });

describe("luật thuần — hình thức chi", () => {
  it("hinhThucCua: chưa chi → null; vắng / null / lạ → chuyển khoản (khoản cũ hiện y như cũ); tiền mặt giữ", () => {
    expect(hinhThucCua({ paid: false, paidMethod: "tien-mat" })).toBeNull();
    expect(hinhThucCua({ paid: true })).toBe("chuyen-khoan");
    expect(hinhThucCua({ paid: true, paidMethod: null })).toBe("chuyen-khoan");
    expect(hinhThucCua({ paid: true, paidMethod: "la" as never })).toBe("chuyen-khoan");
    expect(hinhThucCua({ paid: true, paidMethod: "tien-mat" })).toBe("tien-mat");
  });

  it("hinhThucGoiY: chứng từ TM → tiền mặt; VAT / HĐNS / chưa chọn → chuyển khoản", () => {
    expect(hinhThucGoiY("TM")).toBe("tien-mat");
    for (const ct of ["VAT", "HDNS", null, undefined]) expect(hinhThucGoiY(ct)).toBe("chuyen-khoan");
  });

  it("thieuAnhChungTu: chỉ CHUYỂN KHOẢN đã chi mà thiếu ảnh; tiền mặt thiếu ảnh không phải thiếu", () => {
    expect(thieuAnhChungTu({ paid: true, hasPaidProof: false })).toBe(true);
    expect(thieuAnhChungTu({ paid: true, hasPaidProof: false, paidMethod: "chuyen-khoan" })).toBe(true);
    expect(thieuAnhChungTu({ paid: true, hasPaidProof: false, paidMethod: "tien-mat" })).toBe(false);
    expect(thieuAnhChungTu({ paid: true, hasPaidProof: true })).toBe(false);
    expect(thieuAnhChungTu({ paid: false, hasPaidProof: false })).toBe(false);
  });

  it("thanKhoanChi: tích mới luôn kèm hình thức; đổi hình thức khoản đã chi gửi MỘT trường; không đổi → null; bỏ tích không kèm hình thức", () => {
    expect(thanKhoanChi(dong(), { paid: true }, DU_QUYEN)).toEqual({ baseVersion: 2, paid: true, paidMethod: "chuyen-khoan" });
    expect(thanKhoanChi(dong(), { paid: true, paidMethod: "tien-mat" }, DU_QUYEN)).toEqual({ baseVersion: 2, paid: true, paidMethod: "tien-mat" });
    const daChi = dong({ paid: true, paidAt: NGAY });
    expect(thanKhoanChi(daChi, { paidMethod: "tien-mat" }, DU_QUYEN)).toEqual({ baseVersion: 2, paidMethod: "tien-mat" });
    expect(thanKhoanChi(daChi, { paidMethod: "chuyen-khoan" }, DU_QUYEN), "khoản cũ (vắng) = chuyển khoản: chọn lại chuyển khoản không đổi gì").toBeNull();
    expect(thanKhoanChi(dong({ paid: true, paidMethod: "tien-mat" }), { paid: false }, DU_QUYEN)).toEqual({ baseVersion: 2, paid: false });
    expect(thanKhoanChi(daChi, { paidMethod: "tien-mat" }, { canPay: false, canEdit: true }), "thiếu invoice:input:pay").toBeNull();
  });

  it("xung đột: người khác vừa đổi hình thức đúng lúc mình đổi → hỏi trước khi ghi đè", () => {
    const luc = dong({ paid: true, paidAt: NGAY });
    const goc0 = { hinhThuc: giaTriTruong(luc, "hinhThuc") };
    const moi = { ...luc, paidMethod: "tien-mat" as const };
    expect(xungDotKhoanChi(goc0, moi, { baseVersion: 3, paidMethod: "chuyen-khoan" })).toEqual(["hinhThuc"]);
    expect(xungDotKhoanChi(goc0, luc, { baseVersion: 2, paidMethod: "tien-mat" })).toEqual([]);
  });
});

const hopKt = (row: InputInvoiceRow, canPay = true) =>
  ve(<HopKhoanChi row={row} canPay={canPay} canEdit onDong={() => {}} onDaLuu={() => {}} onNapLai={() => {}} />);
const nutHop = (chu: string) => [...document.querySelectorAll<HTMLButtonElement>(".inv-in-hop button")].find((b) => b.textContent === chu);
const chon = (v: string) => document.querySelector<HTMLInputElement>(`input[name="paidMethod"][value="${v}"]`)!;
const tich = () => document.querySelector<HTMLInputElement>('input[name="paid"]')!;
const nhanAnh = () => [...document.querySelectorAll(".inv-in-hop .inv-in-hop-nhan")].map((x) => x.textContent).find((t) => /^Ảnh/.test(t ?? ""));

describe("Hộp Khoản chi — hình thức thanh toán", () => {
  it("chưa tích: KHÔNG có ô hình thức; tích hàng chứng từ TM → gợi ý Tiền mặt, ô ảnh 'Ảnh phiếu chi (không bắt buộc)'; Lưu gửi paidMethod tien-mat", async () => {
    hopKt(dong({ chungTu: "TM" }));
    expect(document.querySelector('input[name="paidMethod"]')).toBeNull();
    await act(async () => { tich().click(); });
    expect(chon("tien-mat").checked).toBe(true);
    expect(chon("chuyen-khoan").checked).toBe(false);
    expect(nhanAnh()).toBe("Ảnh phiếu chi (không bắt buộc)");
    expect(document.querySelector(".inv-in-hop")!.textContent).toMatch(/Chưa có ảnh phiếu chi — tiền mặt không bắt buộc/);
    expect(document.querySelector(".inv-in-hop")!.textContent).toMatch(/Gợi ý theo chứng từ TM/);
    await act(async () => { nutHop("Lưu")!.click(); });
    expect(h.ghi).toHaveBeenCalledWith(9, "sheet", "r1", { baseVersion: 2, paid: true, paidMethod: "tien-mat" });
  });

  it("tích hàng VAT → mặc định Chuyển khoản, nhãn ảnh như cũ; đổi sang Tiền mặt trước khi Lưu → gửi tien-mat", async () => {
    hopKt(dong({ chungTu: "VAT" }));
    await act(async () => { tich().click(); });
    expect(chon("chuyen-khoan").checked).toBe(true);
    expect(nhanAnh()).toBe("Ảnh chứng từ (ủy nhiệm chi)");
    expect(document.querySelector(".inv-in-hop")!.textContent).toMatch(/Chưa có ảnh chứng từ\./);
    await act(async () => { chon("tien-mat").click(); });
    expect(nhanAnh()).toBe("Ảnh phiếu chi (không bắt buộc)");
    await act(async () => { nutHop("Lưu")!.click(); });
    expect(h.ghi).toHaveBeenCalledWith(9, "sheet", "r1", { baseVersion: 2, paid: true, paidMethod: "tien-mat" });
  });

  it("khoản ĐÃ chi cũ (không có hình thức) = Chuyển khoản; đổi sang Tiền mặt → Lưu gửi ĐÚNG { baseVersion, paidMethod }", async () => {
    hopKt(dong({ paid: true, paidAt: NGAY, hasPaidProof: true, chungTu: "TM" }));
    expect(chon("chuyen-khoan").checked, "khoản cũ không bị gợi ý đè: chứng từ TM nhưng đã lưu là chuyển khoản").toBe(true);
    expect(nutHop("Lưu")!.disabled).toBe(true);
    await act(async () => { chon("tien-mat").click(); });
    await act(async () => { nutHop("Lưu")!.click(); });
    expect(h.ghi).toHaveBeenCalledWith(9, "sheet", "r1", { baseVersion: 2, paidMethod: "tien-mat" });
  });

  it("bỏ tích khoản tiền mặt → { paid: false } (không kèm hình thức); tích lại trong hộp giữ hình thức đã lưu", async () => {
    hopKt(dong({ paid: true, paidAt: NGAY, paidMethod: "tien-mat" }));
    expect(chon("tien-mat").checked).toBe(true);
    await act(async () => { tich().click(); });
    await cho();
    expect(document.querySelector('input[name="paidMethod"]'), "bỏ tích → ô hình thức ẩn").toBeNull();
    await act(async () => { tich().click(); });
    expect(chon("tien-mat").checked).toBe(true);
    expect(nutHop("Lưu")!.disabled, "tích lại đúng như cũ = không có gì để lưu").toBe(true);
    await act(async () => { tich().click(); });
    await cho();
    await act(async () => { nutHop("Lưu")!.click(); });
    expect(h.ghi).toHaveBeenCalledWith(9, "sheet", "r1", { baseVersion: 2, paid: false });
  });

  it("thiếu quyền tích: ô hình thức chỉ xem (khoá), vẫn đúng hình thức của khoản", () => {
    hopKt(dong({ paid: true, paidAt: NGAY, paidMethod: "tien-mat" }), false);
    expect(chon("tien-mat").checked).toBe(true);
    expect(chon("tien-mat").disabled && chon("chuyen-khoan").disabled).toBe(true);
  });
});

describe("Ô Kế toán — trang Hóa đơn đầu vào", () => {
  it("'✓ Đã chi · tiền mặt · ngày', KHÔNG '⚠ chưa có ảnh'; chuyển khoản và khoản cũ thiếu ảnh vẫn nhắc như trước", async () => {
    const rows = [
      dong({ key: "a", rid: "a", name: "A", paid: true, paidAt: NGAY, paidMethod: "tien-mat" }),
      dong({ key: "b", rid: "b", name: "B", paid: true, paidAt: NGAY, paidMethod: "chuyen-khoan" }),
      dong({ key: "c", rid: "c", name: "C", paid: true, paidAt: NGAY }),
      dong({ key: "d", rid: "d", name: "D", paid: true, paidAt: NGAY, paidMethod: "tien-mat", hasPaidProof: true }),
    ];
    h.resp = { data: rows, meta: { quotes: 1, truncated: false } };
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const me = { id: 1, username: "kt", displayName: "KT", role: "accountant", permissions: ["invoice:page", "invoice:edit", "invoice:input:pay"] };
    await act(async () => { goc.render(<QueryClientProvider client={qc}><InvoicesInPage me={me as never} /></QueryClientProvider>); });
    await cho();
    const o = (i: number) => thung.querySelectorAll("tbody tr")[i].querySelector("td.inv-in-kt .inv-in-kt-d1")!.textContent;
    expect(o(0)).toBe("✓ Đã chi · tiền mặt · 06/10/2026");
    expect(o(1)).toBe("✓ Đã chi · 06/10/2026 ⚠ chưa có ảnh");
    expect(o(2), "khoản cũ = chuyển khoản: y như trước").toBe("✓ Đã chi · 06/10/2026 ⚠ chưa có ảnh");
    expect(o(3)).toBe("✓ Đã chi · tiền mặt · 06/10/2026 📎");
    expect(thung.querySelector('tbody tr td.inv-in-kt [aria-label="Có ảnh phiếu chi"]')).not.toBeNull();
  });

  it("bộ lọc 'Đã TT · tiền mặt / chuyển khoản' + tìm 'tien mat'", () => {
    const rows = [
      dong({ key: "a", name: "A", paid: true, paidMethod: "tien-mat" }),
      dong({ key: "b", name: "B", paid: true, paidMethod: "chuyen-khoan" }),
      dong({ key: "c", name: "C", paid: true }),
      dong({ key: "d", name: "D", paid: false, chungTu: "TM" }),
    ];
    const ten = (b: Partial<typeof BO_LOC_RONG>) => locHang(rows, { ...BO_LOC_RONG, ...b }).map((r) => r.name);
    expect(ten({ thanhToan: "paid-tm" })).toEqual(["A"]);
    expect(ten({ thanhToan: "paid-ck" })).toEqual(["B", "C"]);
    expect(ten({ thanhToan: "paid" })).toEqual(["A", "B", "C"]);
    expect(ten({ q: "tien mat" }), "hàng CHƯA chi chứng từ TM không phải 'đã chi tiền mặt'").toEqual(["A"]);
  });
});

describe("Cột Thanh toán chỉ-xem (bảng nội bộ)", () => {
  const DA = { paidAt: NGAY, paidByName: "Kế toán Lan", coAnh: false, coHdVat: false, hdVatLuc: null, paid: true };
  it("tiền mặt: '✓ Đã TT tiền mặt <ngày>'; VAT chưa HĐ: '… · chưa VAT'; 📎 là ảnh phiếu chi; khoản cũ y như trước", () => {
    ve(<div>
      <p id="a"><OThanhToan h={{ rid: "a", ...DA, paidMethod: "tien-mat" }} chungTu="TM" /></p>
      <p id="b"><OThanhToan h={{ rid: "b", ...DA, paidMethod: "tien-mat" }} chungTu="VAT" /></p>
      <p id="c"><OThanhToan h={{ rid: "c", ...DA, coAnh: true, paidMethod: "tien-mat" }} chungTu="HDNS" /></p>
      <p id="d"><OThanhToan h={{ rid: "d", ...DA, coAnh: true }} chungTu="HDNS" /></p>
    </div>);
    const t = (id: string) => thung.querySelector(`#${id}`)!.textContent;
    expect(t("a")).toBe("✓ Đã TT tiền mặt 06/10/2026Kế toán Lan");
    expect(t("b")).toBe("✓ Đã TT tiền mặt 06/10/2026 · chưa VATKế toán Lan");
    expect(thung.querySelector("#a .pay-da")!.getAttribute("title")).toMatch(/TIỀN MẶT/);
    expect(thung.querySelector('#c [aria-label="Có ảnh phiếu chi"]')).not.toBeNull();
    expect(t("d")).toBe("✓ Đã TT 06/10/2026 📎Kế toán Lan");
    expect(thung.querySelector('#d [aria-label="Có ảnh ủy nhiệm chi"]')).not.toBeNull();
  });
});

describe("Nhật ký — đổi hình thức đọc được", () => {
  it("diffRows: paidMethod mã → chữ", () => {
    expect(diffRows({ paidMethod: "chuyen-khoan" }, { paidMethod: "tien-mat" })).toEqual([{ label: "Hình thức chi", from: "Chuyển khoản", to: "Tiền mặt" }]);
    expect(diffRows({ paidMethod: "tien-mat" }, { paidMethod: null })).toEqual([{ label: "Hình thức chi", from: "Tiền mặt", to: "(trống)" }]);
  });
});
