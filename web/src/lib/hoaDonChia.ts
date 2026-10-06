// CHIA SHEET THÀNH HÓA ĐƠN — dựng hóa đơn của MỘT báo giá đã chốt cho trang Hóa đơn đầu ra.
// ⚠️ Cùng luật với máy chủ src/invoiceSplit.ts (khoaHoaDon / soHoaDon) — đổi một bên phải đổi bên kia.
//
// · CHƯA CHIA (mọi sheet invoiceGroup = invoiceHold = null — toàn bộ dữ liệu cũ): mỗi sheet một hóa đơn, mã = mã sản
//   xuất của sheet (mã báo giá + "_01"/"_02" theo codeNo đóng băng; báo giá một sheet không hậu tố). Y hệt trước.
// · ĐÃ CHIA: Hóa đơn n gom các sheet invoiceGroup = n, mã = mã báo giá + "_0n". HẬU TỐ: thêm khi báo giá có từ 2 hóa
//   đơn trở lên, HOẶC số hóa đơn > 1, HOẶC còn sheet Để sau (sẽ thành hóa đơn sau) — một hóa đơn duy nhất gom mọi sheet
//   thì không hậu tố, đúng luật "báo giá một sheet không hậu tố" của mã sản xuất. Sheet không có gì → Để sau.
// · Tiền hóa đơn = tổng thành tiền các sheet + VAT tính trên tổng đó (cách trang tính cho một sheet, áp cho cả hóa đơn).
// · Sheet khách KHÔNG duyệt (trangKhachTuChoi) bị loại như trước — không vào hóa đơn, không vào Để sau.
import type { ProjectQuote, ProjectSheet } from "./api";
import { sheetCode, soMa, trangKhachTuChoi } from "./format";

export type SheetTrongHoaDon = { sh: ProjectSheet; i: number; code: string };
export type HoaDonDung = { so: number; code: string; sheets: SheetTrongHoaDon[]; subtotal: number; amount: number };
export type KetQuaChia = { chia: boolean; hoaDon: HoaDonDung[]; deSau: SheetTrongHoaDon[]; khongXuat: SheetTrongHoaDon[] };

export const daChia = (sheets: ProjectSheet[]) => sheets.some((s) => s.invoiceGroup != null || s.invoiceHold != null);
export const tienCoVat = (subtotal: number, vatPercent: unknown) => subtotal + Math.round((subtotal * (Number(vatPercent) || 0)) / 100);

/** Lựa chọn của một sheet trên hộp chia: "1".."99" | "later" | "skip". */
export function luaChonCua(sh: ProjectSheet, i: number, chia: boolean): string {
  if (!chia) return String(soMa(sh, i));
  if (sh.invoiceHold === "skip") return "skip";
  if (sh.invoiceHold === "later" || sh.invoiceGroup == null) return "later";
  return String(sh.invoiceGroup);
}

/** Dựng hóa đơn từ (sheet, lựa chọn). `chon` = undefined → đọc phép chia đang lưu. */
export function nhomHoaDon(q: ProjectQuote, chon?: Record<number, string>): KetQuaChia {
  const sheets = q.sheets || [];
  const chia = chon ? !laMacDinh(sheets, chon) : daChia(sheets);
  const hoaDon = new Map<number, SheetTrongHoaDon[]>();
  const deSau: SheetTrongHoaDon[] = [], khongXuat: SheetTrongHoaDon[] = [];
  sheets.forEach((sh, i) => {
    if (trangKhachTuChoi(q, sh)) return;
    const item = { sh, i, code: sheetCode(q, soMa(sh, i), sheets.length) };
    const v = chon && sh.id != null ? (chon[sh.id] ?? "later") : luaChonCua(sh, i, chia);
    if (v === "skip") { khongXuat.push(item); return; }
    if (v === "later") { deSau.push(item); return; }
    const so = Number(v);
    const ds = hoaDon.get(so);
    if (ds) ds.push(item); else hoaDon.set(so, [item]);
  });
  const soHd = [...hoaDon.keys()].sort((a, b) => a - b);
  const hauTo = !chia || soHd.length > 1 || soHd.some((n) => n > 1) || deSau.length > 0;
  return {
    chia,
    hoaDon: soHd.map((so) => {
      const ds = hoaDon.get(so)!;
      const subtotal = ds.reduce((s, x) => s + (Number(x.sh.subtotal) || 0), 0);
      // Chưa chia: mã giữ ĐÚNG mã sản xuất của sheet (luật cũ: báo giá một sheet không hậu tố).
      const code = !chia ? ds[0].code : sheetCode(q, so, hauTo ? 2 : 1);
      return { so, code, sheets: ds, subtotal, amount: tienCoVat(subtotal, q.vatPercent) };
    }),
    deSau, khongXuat,
  };
}

/** Lựa chọn trên hộp có trùng "mặc định chưa chia" không (mỗi sheet một hóa đơn đúng số codeNo, không giữ lại sheet nào). */
export function laMacDinh(sheets: ProjectSheet[], chon: Record<number, string>): boolean {
  return sheets.every((sh, i) => sh.id == null || chon[sh.id] === String(soMa(sh, i)) || (trangKhachTuChoi({ status: "converted" }, sh) && chon[sh.id] === "skip"));
}
