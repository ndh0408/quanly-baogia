// KHOẢN CHI của trang Hóa đơn đầu vào — phần THUẦN phía trình duyệt: dựng THÂN lệnh ghi, định dạng ngày thuần, nhãn
// trạng thái hàng. Không React, không gọi máy chủ — test riêng ở web/src/lib/khoanChi.test.ts.
//
// Máy chủ là nguồn sự thật (src/khoanChi.ts · src/services/inputInvoiceService.ts · KhoanChiSchema ở src/validators.ts).
// Trang (pages/InvoicesIn.tsx) và hộp "Khoản chi" (components/HopKhoanChi.tsx) đọc CÙNG các hàm ở đây, để hai nơi không
// tự suy luận khác nhau về "đã đổi gì", "tích được không", "hàng này đang ở trạng thái nào".
import { TEN_PHAM_VI, type InputInvoiceRow, type PhiaKhoanChi, type ThanKhoanChi, type TrangThaiHangDauVao } from "./api";
import { fmtMoney } from "./format";

/** Nhãn loại bảng nội bộ — cùng chữ với bộ lọc "Loại bảng" và huy hiệu ở cột Hạng mục. */
export const LOAI_BANG: Record<string, string> = { hcm: "Chi phí HCM", hanoi: "Báo giá Hà Nội", khach: "Phí khách hàng" };

/** Phía của khoản: bảng Hà Nội thuộc CẢ báo giá (`Quote.hnTables`), Chi phí HCM + Phí KH nằm trong từng trang. */
export const phiaCuaLoai = (category: string): PhiaKhoanChi => (category === "hanoi" ? "hn" : "sheet");

/** Số lượng / số ngày: tối đa 4 chữ số lẻ, dấu thập phân kiểu Việt. */
export const fmtSoLuong = (n: number): string => Number(n).toLocaleString("vi-VN", { maximumFractionDigits: 4 });

/**
 * Tên bảng chỉ đáng hiện khi KHÁC tên mặc định của loại: "Chi phí HCM" ngay sau huy hiệu "Chi phí HCM" là thừa, ăn chỗ
 * của cột Hạng mục ở laptop 1280px. So không phân biệt hoa thường với tên mặc định lúc tạo bảng (TEN_PHAM_VI) và nhãn
 * loại ("Báo giá Hà Nội" — tên bảng HN cũ).
 */
export function tenBangRieng(category: string, tableName: string | null | undefined): string | null {
  const ten = (tableName ?? "").trim();
  if (!ten) return null;
  const chuan = (s: string) => s.trim().toLocaleLowerCase("vi");
  const macDinh = [(TEN_PHAM_VI as Record<string, string>)[category], LOAI_BANG[category]].filter(Boolean).map(chuan);
  return macDinh.includes(chuan(ten)) ? null : ten;
}

// ── NGÀY THUẦN 'YYYY-MM-DD' (Ngày hóa đơn) ────────────────────────────────────────────────────────────────────────
// Ngày hóa đơn là ngày LỊCH, không giờ, không múi giờ (cột @db.Date). KHÔNG đi qua `new Date("2026-10-05")`: chuỗi đó là
// nửa đêm UTC, đổi ra giờ máy ở múi âm là lùi một ngày. Chỉ tách chuỗi.
const RE_NGAY = /^(\d{4})-(\d{2})-(\d{2})$/;
/** Chuỗi 'YYYY-MM-DD' là một ngày CÓ THẬT trên lịch (30/02 thì không). */
export function laNgayThuan(s: unknown): s is string {
  const m = typeof s === "string" ? RE_NGAY.exec(s) : null;
  if (!m) return false;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1) return false;
  const nhuan = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  return d <= [31, nhuan ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1];
}
/** 'YYYY-MM-DD' → 'dd/mm/yyyy' (quy ước ngày của cả app); không phải ngày thuần hợp lệ → "". */
export const fmtNgayThuan = (s: string | null | undefined): string =>
  laNgayThuan(s) ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : "";
/**
 * Ngày hóa đơn GHI ĐƯỢC: ngày thuần có thật trong 2000–2100 (= laNgayLich ở src/vnTime.ts, máy chủ 400 ngoài khoảng).
 * `min`/`max` của ô ngày KHÔNG chặn gõ tay — "0026-10-05" (gõ thiếu một số năm) vẫn vào value, nên phải tự soát.
 */
export const laNgayHoaDon = (s: unknown): s is string => laNgayThuan(s) && Number(s.slice(0, 4)) >= 2000 && Number(s.slice(0, 4)) <= 2100;

// ── TRẠNG THÁI HÀNG (danh sách là HỢP ba nhóm — src/inputInvoices.ts) ─────────────────────────────────────────────
export const NHAN_TRANG_THAI_HANG: Record<TrangThaiHangDauVao, string> = {
  "binh-thuong": "Đã duyệt",
  "chua-duyet": "Hàng chưa duyệt / đã bị bỏ duyệt",
  "hn-chua-duyet": "Hàng Hà Nội chưa duyệt",
  "khong-con-hang": "Không còn trong báo giá",
  "bao-gia-da-xoa": "Báo giá đã xoá",
};
export const nhanTrangThaiHang = (t: string): string => NHAN_TRANG_THAI_HANG[t as TrangThaiHangDauVao] ?? t;

/**
 * Vì sao chưa TÍCH MỚI "Đã chi" được — `null` = tích được. Chỉ TÍCH MỚI mới đòi hàng đã duyệt và còn trong báo giá; khoản
 * ĐÃ chi thì vẫn bỏ tích được ở mọi trạng thái (máy chủ chặn đúng như vậy: 409 hang-chua-duyet / hang-khong-con).
 */
export function lyDoKhongTich(r: Pick<InputInvoiceRow, "paid" | "trangThaiHang">): string | null {
  if (r.paid || r.trangThaiHang === "binh-thuong") return null;
  switch (r.trangThaiHang) {
    case "chua-duyet": return "Dòng này chưa được duyệt (hoặc vừa bị bỏ duyệt) — chưa đánh dấu đã chi được.";
    case "hn-chua-duyet": return "Dòng Hà Nội này chưa được duyệt (hoặc vừa bị bỏ duyệt / trả lại) — chưa đánh dấu đã chi được.";
    case "khong-con-hang": return "Dòng này không còn trong báo giá — không đánh dấu đã chi được nữa.";
    default: return "Báo giá đã xoá — chỉ xem.";
  }
}

/** Lý do gắn huy hiệu ⚠ ở ô "Kế toán" — rỗng = không gắn. */
export function canhBaoKhoan(r: Pick<InputInvoiceRow, "trangThaiHang" | "tienDoi" | "paidAmount" | "amount">): string[] {
  const ds: string[] = [];
  if (r.trangThaiHang !== "binh-thuong") ds.push(nhanTrangThaiHang(r.trangThaiHang));
  if (r.tienDoi) ds.push(`Số tiền đã đổi sau khi chi: đã chi ${fmtMoney(r.paidAmount)} — hiện ${fmtMoney(r.amount)}`);
  return ds;
}

/** Lý do một ảnh rời khỏi khoản (ảnh KHÔNG bao giờ bị xoá — chỉ rút vào lịch sử). */
export const NHAN_LY_DO_RUT: Record<string, string> = { thay: "đã thay bằng ảnh mới", "go-anh": "đã gỡ", "bo-danh-dau": "rút khi bỏ đánh dấu" };

/**
 * Ảnh chứng từ chỉ được là data-URL ảnh base64 khớp TOÀN CHUỖI (cùng luật PAYMENT_PROOF_DATA_URL_RE ở máy chủ) — lọc lại
 * trước khi đưa vào `src`. Bản sao của safeImgSrc trong components/GridTable.tsx — CỐ Ý, như pages/Personnel.tsx: GridTable
 * nằm ở chunk tải-trễ của màn soạn, còn trang này ở bundle chính; kéo cả engine lưới vào chỉ vì một regex là phình.
 */
const RE_ANH = /^data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/i;
export const anhHienDuoc = (s: string | null | undefined): string => (typeof s === "string" && RE_ANH.test(s) ? s : "");
/** Hóa đơn VAT dạng PDF (data-URL khớp TOÀN CHUỖI) — không vẽ được bằng <img>; mở bằng blob + tải về. */
const RE_PDF = /^data:application\/pdf;base64,[A-Za-z0-9+/]+={0,2}$/i;
export const laPdfDataUrl = (s: string | null | undefined): boolean => typeof s === "string" && RE_PDF.test(s);

// ── HÓA ĐƠN VAT (chủ repo 2026-10-06: "nếu có VAT mà chỉ mới thanh toán thôi thì bên nội bộ báo là đã thanh toán chưa VAT") ──
/**
 * Trạng thái VAT của một hàng — CHỈ khi chứng từ HIỆN TẠI là VAT; HĐNS / TM / chưa chọn → null (hiện như cũ). Bản sao CỐ Ý của
 * src/khoanChi.ts trangThaiVat (máy chủ) — cùng ba ca:
 *   "chua-vat"    đã chi, chưa có HĐ VAT  → "Đã TT · chưa VAT" (màu cảnh báo)
 *   "da-vat"      đã chi + có HĐ VAT      → "Đã TT · đã có VAT"
 *   "vat-chua-tt" chưa chi, đã có HĐ VAT  → "Có HĐ VAT · chưa TT"
 */
export type TrangThaiVat = "chua-vat" | "da-vat" | "vat-chua-tt";
export function trangThaiVat(chungTu: unknown, paid: boolean, coHdVat: boolean): TrangThaiVat | null {
  if (chungTu !== "VAT") return null;
  if (paid) return coHdVat ? "da-vat" : "chua-vat";
  return coHdVat ? "vat-chua-tt" : null;
}
export const NHAN_TRANG_THAI_VAT: Record<TrangThaiVat, string> = { "chua-vat": "chưa VAT", "da-vat": "đã có VAT", "vat-chua-tt": "Có HĐ VAT · chưa TT" };

// ── HỘP "KHOẢN CHI": PHẦN NGƯỜI DÙNG ĐÃ SỬA → THÂN LỆNH GHI ────────────────────────────────────────────────────────
/**
 * Phần người dùng ĐÃ SỬA trong hộp. Trường VẮNG = chưa đụng: ô hiện và so theo DÒNG HIỆN TẠI — dòng nạp lại sau 409 /
 * realtime thì ô chưa đụng tự lấy giá trị mới, lần Lưu sau không ghi đè ngược phần kế toán khác vừa sửa.
 */
export type NhapKhoanChi = {
  paid?: boolean;
  /** data-URL ảnh MỚI đã nén (lib/anhChungTu.ts) — chuỗi rỗng coi như không có. */
  anhMoi?: string;
  /** Gỡ ảnh hiện tại (máy chủ rút vào lịch sử, không xoá). */
  goAnh?: boolean;
  /** data-URL hóa đơn VAT MỚI (ảnh đã nén hoặc PDF) — chuỗi rỗng coi như không có. */
  vatMoi?: string;
  /** Gỡ HĐ VAT hiện tại (rút vào lịch sử, không xoá). */
  goVat?: boolean;
  /** "Xác nhận số tiền hiện tại" khi số tiền đổi sau lúc chi — gửi lại `paid: true`. */
  xacNhanTien?: boolean;
  /** Giá trị ô ngày ('YYYY-MM-DD' | "" = xoá). */
  invoiceDate?: string;
  accountingNote?: string;
};
/** Quyền theo TRƯỜNG (máy chủ kiểm y hệt): tích + ảnh ← invoice:input:pay; ngày HĐ + ghi chú ← invoice:edit. */
export type QuyenKhoanChi = { canPay: boolean; canEdit: boolean };
export type DongKhoanChi = Pick<InputInvoiceRow, "version" | "paid" | "hasPaidProof" | "hasVatProof" | "tienDoi" | "invoiceDate" | "accountingNote">;

/**
 * THÂN lệnh PUT khoản chi: CHỈ trường thật sự đổi so với dòng hiện tại + `baseVersion`; `null` = không có gì để gửi.
 *   · BỎ tích → đúng `{ paid: false }`: máy chủ tự rút ảnh hiện tại (lý do 'bo-danh-dau'); kèm ảnh là 400.
 *   · KHÔNG BAO GIỜ `paidProof: ""` (chuỗi rỗng không phải cách gỡ ảnh — máy chủ 400): gỡ ảnh là `null`, ảnh mới là data-URL.
 *   · Ngày / ghi chú xoá trắng → `null`; ghi chú so SAU khi cắt khoảng trắng hai đầu (máy chủ cũng trim).
 *   · Trường thiếu quyền không bao giờ vào thân — ô đó khoá ở giao diện, máy chủ 403 cả lệnh nếu lọt.
 */
export function thanKhoanChi(r: DongKhoanChi, n: NhapKhoanChi, q: QuyenKhoanChi): ThanKhoanChi | null {
  const than: ThanKhoanChi = { baseVersion: r.version };
  if (q.canPay) {
    const paid = n.paid ?? r.paid;
    const anh = typeof n.anhMoi === "string" && n.anhMoi ? n.anhMoi : null;
    if (paid !== r.paid) {
      than.paid = paid;
      if (paid && anh) than.paidProof = anh;   // tích + ảnh trong MỘT lệnh
    } else if (paid) {
      if (n.xacNhanTien && r.tienDoi) than.paid = true;
      if (anh) than.paidProof = anh;
      else if (n.goAnh && r.hasPaidProof) than.paidProof = null;
    }
    // HĐ VAT ĐỘC LẬP với đã chi: đưa / thay / gỡ ở mọi trạng thái tích.
    if (typeof n.vatMoi === "string" && n.vatMoi) than.vatProof = n.vatMoi;
    else if (n.goVat && r.hasVatProof) than.vatProof = null;
  }
  if (q.canEdit) {
    if (n.invoiceDate !== undefined) {
      const d = n.invoiceDate.trim();
      if (d !== (r.invoiceDate ?? "")) than.invoiceDate = d || null;
    }
    if (n.accountingNote !== undefined) {
      const g = n.accountingNote.trim();
      if (g !== (r.accountingNote ?? "").trim()) than.accountingNote = g || null;
    }
  }
  return Object.keys(than).length > 1 ? than : null;
}

// ── XUNG ĐỘT: NGƯỜI KHÁC VỪA SỬA ĐÚNG Ô MÌNH ĐANG SỬA ────────────────────────────────────────────────────────────────
// Realtime nạp lại dòng trong lúc hộp đang mở: ô CHƯA đụng tự lấy giá trị mới (NhapKhoanChi), `baseVersion` theo dòng mới —
// nên lần Lưu sau KHÔNG nhận 409 và ghi đè im lặng phần người kia vừa ghi vào ĐÚNG ô mình đang sửa. Hộp chụp giá trị của
// mỗi ô lúc BẮT ĐẦU sửa ô đó; lúc Lưu, ô nào sắp ghi mà dòng hiện tại đã khác bản chụp → hỏi trước khi ghi đè.
export type TruongKhoanChi = "paid" | "anh" | "vat" | "invoiceDate" | "accountingNote";
export type GocKhoanChi = Partial<Record<TruongKhoanChi, string>>;
type DongXungDot = Pick<InputInvoiceRow, "paid" | "hasPaidProof" | "hasVatProof" | "invoiceDate" | "accountingNote" | "proofs">;
export const NHAN_TRUONG_KHOAN: Record<TruongKhoanChi, string> = { paid: "Đã chi", anh: "Ảnh chứng từ", vat: "Hóa đơn VAT", invoiceDate: "Ngày hóa đơn", accountingNote: "Ghi chú kế toán" };

/** Giá trị SO SÁNH ĐƯỢC của một ô trên dòng (ảnh: id ảnh hiện tại — thay ảnh là đổi). */
export function giaTriTruong(r: DongXungDot, t: TruongKhoanChi): string {
  switch (t) {
    case "paid": return r.paid ? "1" : "0";
    case "anh": return String(r.proofs?.find((p) => p.hienTai && p.loai !== "vat")?.id ?? (r.hasPaidProof ? "json-cu" : ""));
    case "vat": return String(r.proofs?.find((p) => p.hienTai && p.loai === "vat")?.id ?? (r.hasVatProof ? "co" : ""));
    case "invoiceDate": return r.invoiceDate ?? "";
    case "accountingNote": return (r.accountingNote ?? "").trim();
  }
}

/** Ô mà `than` sắp ghi VÀ người khác đã đổi kể từ lúc mình bắt đầu sửa ô đó — rỗng = không xung đột. */
export function xungDotKhoanChi(goc: GocKhoanChi, r: DongXungDot, than: ThanKhoanChi): TruongKhoanChi[] {
  const ghi: TruongKhoanChi[] = [];
  if ("paid" in than) ghi.push("paid");
  if ("paidProof" in than) ghi.push("anh");
  if ("vatProof" in than) ghi.push("vat");
  if ("invoiceDate" in than) ghi.push("invoiceDate");
  if ("accountingNote" in than) ghi.push("accountingNote");
  return ghi.filter((t) => goc[t] !== undefined && goc[t] !== giaTriTruong(r, t));
}

/** "Ghi chú kế toán → “…”" cho hộp hỏi ghi đè: người dùng thấy người kia vừa ghi GÌ trước khi quyết định. */
export function moTaXungDot(r: DongXungDot, t: TruongKhoanChi): string {
  const gt = t === "paid" ? (r.paid ? "Đã chi" : "Chưa chi")
    : t === "anh" ? (r.hasPaidProof ? "ảnh khác" : "đã gỡ ảnh")
    : t === "vat" ? (r.hasVatProof ? "hóa đơn khác" : "đã gỡ hóa đơn")
    : t === "invoiceDate" ? fmtNgayThuan(r.invoiceDate) || "(trống)"
    : (r.accountingNote ?? "").trim() ? `“${(r.accountingNote ?? "").trim().slice(0, 80)}${(r.accountingNote ?? "").trim().length > 80 ? "…" : ""}”` : "(trống)";
  return `${NHAN_TRUONG_KHOAN[t]} → ${gt}`;
}
