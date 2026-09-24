// Định dạng dùng CHUNG mọi trang (gom từ code lặp ở Invoices/Projects/QuoteList/Dashboard…).
// Quy ước toàn app: tiền vi-VN không lẻ, ngày dd/mm/yyyy, ô trống hiện "—" mờ.
import type { ReactElement } from "react";
import { ApiError } from "./api";

export const fmtMoney = (v?: number | null) => Number(v || 0).toLocaleString("vi-VN");

export const fmtDate = (v?: string | null) => {
  if (!v) return "";
  const d = new Date(v);
  if (isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
};

export const toInputDate = (v?: string | null) => {
  if (!v) return "";
  const d = new Date(v);
  if (isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/* Ngày sinh dạng text tự do ("16/08/1993" | "1995"): đủ ngày/tháng/năm → yyyy-mm-dd cho input
   type=date; chỉ có năm / không parse được → "" (input trống nhưng KHÔNG ghi đè giá trị cũ). */
export const fullDateToInput = (s?: string | null): string => {
  const m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/.exec((s || "").trim());
  if (!m) return "";
  const d = +m[1], mo = +m[2];
  if (d < 1 || d > 31 || mo < 1 || mo > 12) return "";
  return `${m[3]}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
};
/* yyyy-mm-dd (giá trị input date) → "dd/mm/yyyy" để lưu vào trường text. */
export const inputToDdmm = (v: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
};

/* Bỏ tiền tố "Bảng báo giá –" cho gọn tiêu đề khi hiện trong bảng. */
/** Tiêu đề để HIỂN THỊ: ưu tiên tiêu đề rút gọn người dùng tự đặt, không có thì lùi về tiêu đề
 *  chính (đã cắt tiền tố "BẢNG BÁO GIÁ - "). Một chỗ quyết định cho mọi bảng. */
export const tieuDeHienThi = (q: { shortTitle?: string | null; title?: string | null }) =>
  String(q?.shortTitle ?? "").trim() || shortTitle(q?.title || "");

export const shortTitle = (t: string) => {
  const s = String(t || "");
  return s.replace(/^\s*bảng\s+báo\s+giá\s*[-–—:|·]*\s*/i, "").trim() || s;
};

/* Mã dự án hiển thị + mã theo từng sheet — RE-EXPORT từ nguồn dùng chung, KHÔNG chép lại.
   Bản chép tay ở đây trước kia là bản sao thứ hai của cùng một quy tắc; hai bản trôi khỏi nhau
   là hai trang hiện hai mã khác nhau cho cùng một sheet. */
export { codeLabel, sheetCode, soMa } from "./quoteMath";

export const fmtDateTime = (v?: string | null) => {
  if (!v) return "";
  const d = new Date(v);
  if (isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

/* Phần trăm theo locale VN: 42,86% (không phải 42.86%). */
export const fmtPct = (v: number, digits = 2) =>
  `${Number(v || 0).toLocaleString("vi-VN", { maximumFractionDigits: digits })}%`;

export const STATUS_LABEL: Record<string, string> = {
  draft: "Nháp", pending: "Chờ duyệt", approved: "Đã duyệt", rejected: "Bị từ chối",
  sent: "Đã gửi", converted: "Đã chốt", lost: "Không chốt", expired: "Hết hạn",
};
export const statusLabel = (s: string) => STATUS_LABEL[s] || s || "—";

/* Nhãn vai trò — trước đây copy-paste ở Shell/Users/Profile/NewQuoteWizard. */
export const ROLE_LABEL: Record<string, string> = {
  admin: "Quản trị", manager: "Account", account_hn: "Account HN", hr: "Nhân sự", accountant: "Kế toán",
};
export const roleLabel = (r?: string | null) => ROLE_LABEL[r || ""] || r || "—";

/* Thông điệp lỗi từ ApiError — thay chuỗi `error instanceof ApiError ? …` lặp mọi trang. */
/**
 * FE-09: trang khách KHÔNG duyệt của một báo giá ĐÃ CHỐT không phải việc cần xuất hoá đơn / thu tiền.
 * `convertedTotal` (doanh thu ghi nhận, quoteService.markConverted) đã trừ nó; Hóa đơn / Quản lý dự án /
 * "Cần xử lý" mà vẫn cộng thì công nợ phải thu phồng và kế toán có thể đòi tiền hạng mục khách đã từ chối.
 * Báo giá CHƯA chốt thì giữ nguyên — trang bị từ chối lúc đó vẫn có thể được đồng ý lại.
 *
 * TRANG ĐÃ CÓ CHỨNG TỪ THÌ KHÔNG ẨN (soát chéo money#1): số HĐ hoặc ngày thu nghĩa là hoá đơn đã phát
 * hành thật và công nợ còn đó, dù cờ ý kiến khách nói gì (cờ cũ trước khi có bộ lọc này, hoặc bấm nhầm).
 * Ẩn đi thì dòng biến khỏi trang Hóa đơn — nơi DUY NHẤT sửa được số HĐ / ngày thu — và "Chưa thu" hụt.
 * Số HĐ toàn khoảng trắng coi như chưa có, cùng luật `daXuatHoaDon` ở máy chủ.
 * `listProjects` ở máy chủ chọn dòng gánh tổng Hà Nội theo ĐÚNG điều kiện này — đổi ở đây thì đổi cả ở đó.
 */
export const trangKhachTuChoi = (
  q: { status?: string },
  sh: { custStatus?: string | null; invoiceNo?: string | null; paidAt?: string | null },
) => q.status === "converted" && sh.custStatus === "rejected" && !String(sh.invoiceNo ?? "").trim() && !sh.paidAt;

export const errMsg = (e: unknown, fallback = "Lỗi tải dữ liệu") => (e instanceof ApiError ? e.message : fallback);

/* Ô trống — dùng thống nhất thay vì mỗi trang tự chế. */
export const dash: ReactElement = <span className="muted">—</span>;

/* Thẻ thống kê đầu trang — pattern chung (class .stat-card trong styles.css). */
export function Stat({ label, value, tone, onClick, active, title }: {
  label: string; value: string; tone?: "ok" | "danger"; onClick?: () => void; active?: boolean; title?: string;
}) {
  const className = `stat-card${tone ? ` stat-${tone}` : ""}${onClick ? " stat-clickable" : ""}${active ? " active" : ""}`;
  const content = <><div className="stat-label">{label}</div><div className="stat-value">{value}</div></>;
  return onClick
    ? <button type="button" className={className} onClick={onClick} aria-pressed={!!active} title={title}>{content}</button>
    : <div className={className}>{content}</div>;
}
