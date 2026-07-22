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
export const shortTitle = (t: string) => {
  const s = String(t || "");
  return s.replace(/^\s*bảng\s+báo\s+giá\s*[-–—:|·]*\s*/i, "").trim() || s;
};

/* Mã dự án hiển thị: projectCode (fallback quoteNumber) + _v2… khi có phiên bản. */
export const codeLabel = (q: { projectCode?: string | null; quoteNumber?: string; projectVersion?: number | null }) => {
  const c = q.projectCode || q.quoteNumber || "";
  return q.projectVersion && q.projectVersion > 1 ? `${c}_v${q.projectVersion}` : c;
};

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
