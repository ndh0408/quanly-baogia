// ┌─────────────────────────────────────────────────────────────────────────────┐
// │ CHIA SHEET THÀNH HÓA ĐƠN — luật thuần (không Prisma), dùng chung cho đường   │
// │ ghi phép chia (setInvoiceSplit) và đường ghi trường hóa đơn (updateSheetInvoice).│
// │ ⚠️ Giao diện (web/src/pages/Invoices.tsx — nhomHoaDon) dựng hóa đơn theo ĐÚNG │
// │ luật này; đổi một bên phải đổi bên kia.                                       │
// └─────────────────────────────────────────────────────────────────────────────┘
//
// Chủ repo 2026-10-06: "khi duyệt cho chọn từng sheet chia ra kiểu thêm _ đằng sau 01 hay 02, cho chọn gom lại — vì bên
// khách có khi bắt chia sheet ra để xuất hóa đơn — cho chức năng chọn sheet nào là hóa đơn 1, sheet nào hóa đơn 2, và có
// thể bỏ cái nào chưa muốn xuất để xuất sau hay là không làm". Đặt ở trang Hóa đơn đầu ra cho kế toán.
//
// HAI CHẾ ĐỘ của một báo giá:
//   · CHƯA CHIA (mọi sheet: invoiceGroup = NULL và invoiceHold = NULL — toàn bộ dữ liệu cũ): mỗi sheet là MỘT hóa đơn,
//     mã = mã sản xuất của sheet (sheetCode theo codeNo). Y hệt trước khi có tính năng.
//   · ĐÃ CHIA: sheet mang invoiceGroup = n → thuộc "Hóa đơn n"; invoiceHold = "later" → Để sau (chưa xuất, xuất lượt
//     sau); "skip" → Không xuất. Sheet không có gì (vd sale thêm sheet SAU khi kế toán chia) → coi như Để sau, để kế
//     toán thấy còn việc.
//
// DỮ LIỆU HÓA ĐƠN của một hóa đơn gom nhiều sheet nằm ở CHÍNH các cột cũ của QuoteSheet, GHI ĐỒNG LOẠT lên mọi sheet
// của hóa đơn đó. Nhờ vậy mọi chỗ đang đọc theo sheet (trang Quản lý dự án, Dashboard, khoá sửa daXuatHoaDon, khoá đổi
// ý kiến khách, tổng "Đã thu") tiếp tục đúng mà không phải sửa: tổng tiền các sheet của một hóa đơn = tiền hóa đơn.

export const INVOICE_HOLDS = ["later", "skip"] as const;
export type InvoiceHold = (typeof INVOICE_HOLDS)[number];

/** Trường hóa đơn ĐI THEO HÓA ĐƠN (chép đồng loạt lên mọi sheet cùng hóa đơn). KHÔNG gồm hnInvoiceNo (số HĐ Hà Nội —
 *  chi phí, theo sheet) và chữ ký chứng từ (ký theo sheet ở trang Quản lý dự án). */
export const INVOICE_SHARED_FIELDS = [
  "invoiceNo", "paidAt", "poNumber", "invoiceLink", "docSentAt", "docReturnedAt",
  "invoiceDate", "paymentMethod", "orderClosedAt", "invoiceYear", "invoiceCompany", "invoiceDesc", "invoiceNote",
] as const;

export type SplitSheet = {
  id: number; order?: number | null; codeNo?: number | null;
  invoiceGroup?: number | null; invoiceHold?: string | null;
  invoiceNo?: string | null; paidAt?: Date | string | null;
};

const coGiaTri = (v: unknown) => v != null && String(v).trim() !== "";

/** Báo giá đã được kế toán chia chưa — chỉ cần MỘT sheet mang số hóa đơn hoặc cờ giữ lại. */
export const daChiaHoaDon = (sheets: SplitSheet[]): boolean =>
  sheets.some((s) => s.invoiceGroup != null || s.invoiceHold != null);

/**
 * Khoá hóa đơn của một sheet: "s:<id>" (chưa chia — mỗi sheet một hóa đơn) | "g:<n>" (Hóa đơn n) | "later" | "skip".
 * Hai sheet cùng khoá "g:…"/"s:…" thuộc CÙNG một hóa đơn.
 */
export function khoaHoaDon(s: SplitSheet, chia: boolean): string {
  if (!chia) return `s:${s.id}`;
  if (s.invoiceHold === "skip") return "skip";
  if (s.invoiceHold === "later" || s.invoiceGroup == null) return "later";
  return `g:${s.invoiceGroup}`;
}

/** Số thứ tự hóa đơn (hậu tố _NN của mã): chưa chia = số mã đóng băng của sheet (codeNo, dữ liệu cũ lùi về vị trí+1);
 *  đã chia = invoiceGroup. null = Để sau / Không xuất (không phải hóa đơn). */
export function soHoaDon(s: SplitSheet, chia: boolean, viTri: number): number | null {
  if (!chia) return s.codeNo != null && s.codeNo > 0 ? s.codeNo : viTri + 1;
  const k = khoaHoaDon(s, chia);
  return k.startsWith("g:") ? Number(k.slice(2)) : null;
}

/** Sheet ĐÃ ĐI RA NGOÀI ở phía hóa đơn: có số hóa đơn hoặc đã thu tiền. */
export const sheetDaXuat = (s: SplitSheet): boolean => coGiaTri(s.invoiceNo) || s.paidAt != null;

/** Sheet thuộc một hóa đơn ĐÃ CÓ SỐ HĐ — mốc khoá phép chia (và khoá sửa báo giá, daXuatHoaDon). "Làm lại hóa đơn"
 *  gỡ số HĐ là sheet hết khoá; ngày thu tiền (paidAt) KHÔNG phải mốc này — xem luật thu tiền ở invoiceSplitService. */
export const sheetCoSoHD = (s: SplitSheet): boolean => coGiaTri(s.invoiceNo);

/** Mốc thu tiền so sánh được (cùng ngày giờ = cùng lần thu). null = chưa thu. */
export const mocThu = (s: SplitSheet): number | null => (s.paidAt == null ? null : new Date(s.paidAt).getTime());

/** Gom id sheet theo khoá hóa đơn. `sheets` phải theo thứ tự hiển thị (order). */
export function nhomTheoKhoa(sheets: SplitSheet[], chia: boolean): Map<string, number[]> {
  const m = new Map<string, number[]>();
  for (const s of sheets) {
    const k = khoaHoaDon(s, chia);
    const ds = m.get(k);
    if (ds) ds.push(s.id); else m.set(k, [s.id]);
  }
  return m;
}
