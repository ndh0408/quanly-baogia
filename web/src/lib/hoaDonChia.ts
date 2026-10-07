// CHIA SHEET THÀNH HÓA ĐƠN — dựng hóa đơn của MỘT báo giá: trang Hóa đơn đầu ra (hiển thị), hộp "Khách chốt" và hộp
// "Chia hóa đơn" của màn báo giá (xem trước mã + tiền). MỘT bộ luật cho cả ba chỗ — không có bản thứ hai.
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
import { sheetCode, soMa, trangKhachTuChoi, tieuDeHienThi } from "./format";

export type SheetTrongHoaDon = { sh: ProjectSheet; i: number; code: string };
export type HoaDonDung = { so: number; code: string; sheets: SheetTrongHoaDon[]; subtotal: number; amount: number };
export type KetQuaChia = { chia: boolean; hoaDon: HoaDonDung[]; deSau: SheetTrongHoaDon[]; khongXuat: SheetTrongHoaDon[] };

export const daChia = (sheets: ProjectSheet[]) => sheets.some((s) => s.invoiceGroup != null || s.invoiceHold != null);
/** Sheet kế toán để "Không xuất" — KHÔNG tính vào Chưa thu / công nợ ở mọi trang (chủ repo 2026-10-06: "có bỏ ra").
 *  "Để sau" thì VẪN tính: chưa xuất nhưng vẫn phải thu. Chỉ có nghĩa khi báo giá đã chia (cột cũ null hết = chưa chia). */
export const laKhongXuat = (q: ProjectQuote, sh: ProjectSheet) => sh.invoiceHold === "skip" && daChia(q.sheets || []);
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

/** HẠNG MỤC tự sinh của một sheet trên trang Hóa đơn đầu ra (chủ repo 2026-10-07: "hạng mục là tên rút gọn_tên sheet,
 *  nếu không có tên rút gọn thì lấy theo tên chính"). Tiêu đề lấy qua tieuDeHienThi — CÙNG một chỗ quyết định "tiêu đề
 *  rút gọn, không có thì tiêu đề chính" cho mọi bảng. Thiếu cả hai thì chỉ còn tên sheet. */
export function nhanHangMuc(q: { shortTitle?: string | null; title?: string | null }, sh: { name?: string | null }, i: number): string {
  const tieu = tieuDeHienThi(q);
  const ten = String(sh.name ?? "").trim() || `Sheet ${i + 1}`;
  return tieu ? `${tieu}_${ten}` : ten;
}

/** Lựa chọn BAN ĐẦU của hộp chia: đã chia → đúng phép chia đang lưu; chưa chia → mỗi sheet một hóa đơn theo số mã cũ,
 *  sheet khách không duyệt → Không xuất (nó đã không vào hóa đơn nào). */
export function luaChonBanDau(q: ProjectQuote): Record<number, string> {
  const sheets = q.sheets || [];
  const chia = daChia(sheets);
  const o: Record<number, string> = {};
  sheets.forEach((sh, i) => {
    if (sh.id == null) return;
    o[sh.id] = !chia && trangKhachTuChoi({ status: "converted" }, sh) ? "skip" : luaChonCua(sh, i, chia);
  });
  return o;
}

export type GanSheet = { sheetId: number; group: number | null; hold: "later" | "skip" | null };

/**
 * Thân gửi máy chủ (PUT /quotes/:id/invoice-split, hoặc `invoiceSplit` của mark-converted) từ lựa chọn trên hộp.
 * Trùng mặc định ("mỗi sheet một hóa đơn như cũ") → mọi sheet null = BỎ CHIA. Báo giá CHƯA chia mà người dùng không
 * đổi gì → `null`: không gửi gì, "chưa chia" giữ nguyên nghĩa cũ.
 */
export function thanhPhepChia(sheets: ProjectSheet[], chon: Record<number, string>): GanSheet[] | null {
  const macDinh = laMacDinh(sheets, chon);
  if (macDinh && !daChia(sheets)) return null;
  return sheets.filter((sh) => sh.id != null).map((sh) => {
    const v = chon[sh.id!] ?? "later";
    if (macDinh) return { sheetId: sh.id!, group: null, hold: null };
    const giu = v === "later" || v === "skip";
    return { sheetId: sh.id!, group: giu ? null : Number(v), hold: giu ? (v as "later" | "skip") : null };
  });
}

/** Số hóa đơn chọn được trên hộp: 1…max(số sheet, số mã đã cấp, số đang dùng) — đủ để mỗi sheet một hóa đơn và để hóa
 *  đơn đã xuất giữ số cũ của nó. */
export function soHoaDonToiDa(sheets: ProjectSheet[], chon: Record<number, string>): number {
  return Math.max(1, sheets.length, ...sheets.map((sh, i) => soMa(sh, i)), ...Object.values(chon).map((v) => Number(v) || 0));
}

/**
 * Báo giá ĐANG SOẠN (QuoteFull của màn báo giá) → dạng ProjectQuote mà các hàm trên đọc. `status` đặt "converted" vì
 * hộp chia xem trước đúng như trang Hóa đơn sẽ hiện SAU khi chốt (sheet khách không duyệt bị loại — trangKhachTuChoi).
 * `ghiDe` (theo id sheet) cho hộp chốt đè thành tiền đang hiện + ý kiến khách vừa chọn trong hộp.
 */
// (Không dùng `satisfies`: semgrep 1.97 của cổng quét bảo mật không đọc được toán tử này — xem 664631c.)
export function baoGiaChoHoaDon(
  q: { id: number; title?: string; shortTitle?: string | null; vatPercent?: number; quoteNumber?: string; projectCode?: string | null; projectVersion?: number | null; sheets?: unknown[] },
  ghiDe?: Map<number, { subtotal?: number; custStatus?: string | null }>,
): ProjectQuote {
  const sheets = ((q.sheets || []) as Record<string, unknown>[]).map((s) => {
    const id = Number(s.id) || undefined;
    const d = id != null ? ghiDe?.get(id) : undefined;
    const chuoi = (v: unknown) => (v == null ? null : String(v));
    const sh: ProjectSheet = {
      id, name: chuoi(s.name), codeNo: s.codeNo == null ? null : Number(s.codeNo),
      subtotal: d?.subtotal ?? (Number(s.subtotal) || 0),
      custStatus: d && "custStatus" in d ? d.custStatus ?? null : chuoi(s.custStatus),
      invoiceNo: chuoi(s.invoiceNo), invoiceDate: chuoi(s.invoiceDate), invoiceLink: chuoi(s.invoiceLink), paidAt: chuoi(s.paidAt),
      invoiceGroup: s.invoiceGroup == null ? null : Number(s.invoiceGroup), invoiceHold: chuoi(s.invoiceHold),
    };
    return sh;
  });
  return {
    id: q.id, title: q.title || "", shortTitle: q.shortTitle ?? null, status: "converted", vatPercent: Number(q.vatPercent) || 0,
    quoteNumber: q.quoteNumber, projectCode: q.projectCode ?? null, projectVersion: q.projectVersion ?? null, sheets,
  };
}
