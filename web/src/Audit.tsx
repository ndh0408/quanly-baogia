import { Fragment, useEffect, useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { api, ApiError, type AuditEntry } from "./api";

// Port "Nhật ký hoạt động" (renderAuditLog) — bê ĐẦY ĐỦ: lọc theo Hoạt động/Đối tượng/Khoảng
// ngày (Từ–Đến) + Xóa lọc + phân trang + nhãn tiếng Việt + skeleton/empty/error. Read-only.
// Bảo mật: gate audit:view (Shell nav + /api/audit server).
// ĐẦY ĐỦ mọi mã action thực tế (quét từ src/ — gồm cả HR/quote-HN/gdpr/login mà util.js SPA còn thiếu).
const ACTION_LABEL: Record<string, string> = {
  // Báo giá
  "quote.create": "Tạo báo giá", "quote.update": "Sửa báo giá", "quote.delete": "Xóa báo giá",
  "quote.convert": "Chốt báo giá (thắng)", "quote.lost": "Đánh dấu không chốt", "quote.duplicate": "Nhân bản báo giá",
  "quote.reopened": "Mở lại để sửa", "quote.export": "Xuất Excel báo giá", "quote.export.pdf": "Xuất PDF báo giá",
  "quote.invoice": "Cập nhật hóa đơn / thanh toán", "quote.members.update": "Cập nhật thành viên phụ trách",
  "quote.hn.assign": "Giao phần Hà Nội", "quote.hn.submit": "Gửi duyệt phần Hà Nội", "quote.hn.review": "Duyệt / trả phần Hà Nội",
  // Khách hàng
  "customer.create": "Thêm khách hàng", "customer.update": "Sửa khách hàng", "customer.delete": "Xóa khách hàng",
  "customer.note.add": "Thêm ghi chú khách hàng",
  // Nhân viên (tài khoản)
  "user.create": "Thêm nhân viên", "user.update": "Cập nhật nhân viên", "user.delete": "Xóa nhân viên",
  "user.invite": "Mời nhân viên", "user.invite.resend": "Gửi lại lời mời", "user.invite.accept": "Kích hoạt tài khoản (lời mời)",
  "user.profile.update": "Cập nhật hồ sơ cá nhân", "user.memberships.cleared": "Xóa phân công thành viên",
  // Nhân sự (hồ sơ) + Danh bạ
  "personnel.create": "Thêm hồ sơ nhân sự", "personnel.update": "Sửa hồ sơ nhân sự", "personnel.delete": "Xóa hồ sơ nhân sự",
  "employee.create": "Thêm danh bạ nhân sự", "employee.update": "Sửa danh bạ nhân sự", "employee.delete": "Xóa danh bạ nhân sự",
  // Đăng nhập / bảo mật
  "login.success": "Đăng nhập", "login.token": "Đăng nhập (ứng dụng)", "login.failed": "Đăng nhập thất bại",
  "login.locked": "Tài khoản bị khóa (đăng nhập)", "login.mfa.failed": "Nhập sai mã MFA", "logout": "Đăng xuất",
  "password.change.success": "Đổi mật khẩu", "password.change.failed": "Đổi mật khẩu thất bại",
  "password.forgot": "Yêu cầu quên mật khẩu", "password.reset.by_admin": "Đặt lại mật khẩu (admin)",
  "mfa.enable": "Bật bảo mật 2 lớp", "mfa.disable": "Tắt bảo mật 2 lớp", "token.revoke-all": "Đăng xuất mọi thiết bị",
  // Tệp / tích hợp / hệ thống / GDPR
  "file.upload": "Tải tệp lên", "file.delete": "Xóa tệp",
  "webhook.create": "Thêm tích hợp", "webhook.update": "Sửa tích hợp", "webhook.delete": "Xóa tích hợp",
  "settings.update": "Cập nhật cấu hình", "settings.delete": "Xóa cấu hình",
  "role.permissions.update": "Cập nhật quyền vai trò", "role.permissions.reset": "Đặt lại quyền vai trò",
  "admin.backup": "Sao lưu dữ liệu", "admin.purge": "Dọn dữ liệu",
  "gdpr.export": "Xuất dữ liệu cá nhân", "gdpr.export.by_admin": "Xuất dữ liệu cá nhân (admin)",
  "gdpr.delete.self": "Tự xóa dữ liệu cá nhân", "gdpr.delete.by_admin": "Xóa dữ liệu cá nhân (admin)",
};
const RESOURCE_LABEL: Record<string, string> = {
  quote: "Báo giá", customer: "Khách hàng", user: "Nhân viên", personnel: "Hồ sơ nhân sự",
  employee: "Danh bạ nhân sự", file: "Tệp", webhook: "Webhook", setting: "Cấu hình", system: "Hệ thống",
  token: "Phiên đăng nhập", role: "Vai trò",
};
const actionLabel = (a: string) => ACTION_LABEL[a] ?? a;
const resourceLabel = (r: string) => RESOURCE_LABEL[r] ?? r;
const fmtDateTime = (v: string) => {
  const d = new Date(v);
  if (isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
// "Đối tượng" đọc-được: "Báo giá: GN26043 — …" / "Nhân sự: Nguyễn Văn A". Fallback khi không có tên:
// id số → "#225" (báo giá/hồ sơ đã xóa-cứng); id chữ → ": manager" (vd vai trò) cho gọn, không "#manager".
const targetText = (e: AuditEntry) =>
  e.targetLabel ? `${resourceLabel(e.resource)}: ${e.targetLabel}`
  : e.resource ? `${resourceLabel(e.resource)}${e.resourceId ? (/^\d+$/.test(e.resourceId) ? " #" + e.resourceId : ": " + e.resourceId) : ""}` : "—";

// CHI TIẾT thay đổi (trước → sau) — nhãn field tiếng Việt; bỏ id kỹ thuật.
const FIELD_LABEL: Record<string, string> = {
  // Tài chính / thanh toán / chứng từ
  paidAt: "Thanh toán", confirmedAt: "Xác nhận đã ký", invoiceNo: "Số hóa đơn", hnInvoiceNo: "Số HĐ (Hà Nội)",
  poNumber: "Số PO", invoiceLink: "Link hóa đơn", docSentAt: "Gửi chứng từ", docReturnedAt: "Nhận lại chứng từ",
  hasProof: "Có ảnh chứng từ", salary: "Lương",
  // Ghi chú / phân quyền / báo giá
  teamNote: "Team ghi chú", accountingNote: "Kế toán ghi chú", note: "Ghi chú",
  permissions: "Quyền", title: "Tiêu đề", status: "Trạng thái", role: "Vai trò",
  // Tài khoản / hồ sơ nhân sự / danh bạ (hay gặp ở user.*, personnel.*, employee.*)
  fullName: "Họ tên", displayName: "Tên hiển thị", username: "Tên đăng nhập", email: "Email", phone: "Điện thoại",
  active: "Kích hoạt", company: "Công ty", projectName: "Tên dự án", projectCode: "Mã dự án",
  taxCode: "Mã số thuế", idCard: "CCCD", bankName: "Ngân hàng", bankAccount: "Số tài khoản",
  laborContractNo: "Số HĐ lao động", position: "Chức vụ", department: "Phòng ban",
};
const fmtVal = (v: unknown): string => {
  if (v == null || v === "") return "(trống)";
  if (typeof v === "boolean") return v ? "Có" : "Không";
  if (Array.isArray(v)) return v.length ? v.join(", ") : "(trống)";
  if (typeof v === "object") return JSON.stringify(v);   // object lồng → nội dung thật, KHÔNG "[object Object]"
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) { const d = new Date(s); if (!isNaN(d.getTime())) return fmtDateTime(s); }
  return s;
};
// "" ≡ null ≡ undefined → KHÔNG coi là thay đổi (tránh dòng "(trống) → (trống)" vô nghĩa).
const normNullish = (x: unknown) => (x == null || x === "" ? null : x);
function diffRows(before?: Record<string, unknown> | null, after?: Record<string, unknown> | null) {
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  const out: { label: string; from: string; to: string }[] = [];
  for (const k of keys) {
    if (k.endsWith("ById") || k === "id") continue;   // bỏ id kỹ thuật (đã có cột Đối tượng tên thật)
    const b = (before || {})[k], a = (after || {})[k];
    if (JSON.stringify(normNullish(b)) === JSON.stringify(normNullish(a))) continue;
    out.push({ label: FIELD_LABEL[k] || k, from: fmtVal(b), to: fmtVal(a) });
  }
  return out;
}

// Dropdown options = mọi nhãn (như SPA build từ ACTION_LABEL/RESOURCE_LABEL).
const ACTION_OPTS = Object.entries(ACTION_LABEL);
const RESOURCE_OPTS = Object.entries(RESOURCE_LABEL);
const PAGE_SIZE = 50;

export function AuditPage() {
  const [action, setAction] = useState("");
  const [resource, setResource] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);   // dòng đang mở "Chi tiết"
  const isMobile = useIsMobile();

  useEffect(() => { setPage(1); setOpenId(null); }, [action, resource, from, to]);
  const { data, isPending, error, refetch } = useQuery({
    queryKey: ["audit", { action, resource, from, to, page }],
    queryFn: () => api.listAudit({ action, resource, from, to, page, size: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });
  const rows = data?.data ?? [];
  const meta = data?.meta ?? { total: 0, page: 1, pageCount: 1 };
  const loading = isPending;
  const err = error ? (error instanceof ApiError ? error.message : "Lỗi tải dữ liệu") : "";

  const hasFilter = !!(action || resource || from || to);
  const clear = () => { setAction(""); setResource(""); setFrom(""); setTo(""); };

  return (
    <div>
      <h1>Nhật ký hoạt động</h1>
      <p className="muted" style={{ margin: "-8px 0 16px" }}>Lịch sử ai đã làm gì trong hệ thống.</p>
      <div className="toolbar">
        <select aria-label="Lọc theo hoạt động" value={action} onChange={(e) => setAction(e.target.value)}>
          <option value="">Tất cả hoạt động</option>
          {ACTION_OPTS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select aria-label="Lọc theo đối tượng" value={resource} onChange={(e) => setResource(e.target.value)}>
          <option value="">Tất cả đối tượng</option>
          {RESOURCE_OPTS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <label className="inline-field">Từ <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="inline-field">Đến <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <button className="btn btn-sm btn-ghost" type="button" onClick={clear}>Xóa lọc</button>
      </div>

      {err && <div className="err">⚠ {err} <button className="btn btn-sm" onClick={() => refetch()}>Thử lại</button></div>}

      {loading ? (
        <div className="skeleton-wrap">{Array.from({ length: 6 }).map((_, i) => <div className="skeleton-row" key={i} />)}</div>
      ) : rows.length === 0 ? (
        <div className="empty">{hasFilter ? "Không có hoạt động khớp bộ lọc." : "Chưa có hoạt động nào."}</div>
      ) : isMobile ? (
        /* MOBILE: thẻ — ai · làm gì · đối tượng (tên) · chi tiết mở-rộng. */
        <div className="au-cards">
          {rows.map((e) => {
            const changes = diffRows(e.before, e.after);
            const open = openId === e.id;
            return (
              <div className="au-card" key={e.id}>
                <div className="au-card-top"><strong>{actionLabel(e.action)}</strong><span className="muted">{fmtDateTime(e.createdAt)}</span></div>
                <div className="au-card-meta"><span>👤 {e.actor?.displayName || e.actor?.username || "Hệ thống"}</span><span>🎯 {targetText(e)}</span></div>
                {changes.length > 0 && (<>
                  <button className="btn btn-sm btn-ghost au-more" onClick={() => setOpenId(open ? null : e.id)}>{open ? "▾ Ẩn chi tiết" : "▸ Xem chi tiết"}</button>
                  {open && <div className="au-changes">{changes.map((c, i) => <div className="au-change" key={i}><span className="au-cl">{c.label}</span><span className="au-from">{c.from}</span><span className="au-arrow">→</span><span className="au-to">{c.to}</span></div>)}</div>}
                </>)}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="list-wrap">
          <table className="list-table audit-table">
            <thead><tr><th>Thời gian</th><th>Người thực hiện</th><th>Hoạt động</th><th>Đối tượng</th><th aria-label="Chi tiết" /></tr></thead>
            <tbody>
              {rows.map((e) => {
                const changes = diffRows(e.before, e.after);
                const canOpen = changes.length > 0;
                const open = openId === e.id;
                return (
                  <Fragment key={e.id}>
                    <tr className={canOpen ? "au-clickable" : undefined} style={canOpen ? { cursor: "pointer" } : undefined}
                      role={canOpen ? "button" : undefined} tabIndex={canOpen ? 0 : undefined} aria-expanded={canOpen ? open : undefined}
                      onClick={() => canOpen && setOpenId(open ? null : e.id)}
                      onKeyDown={canOpen ? (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); setOpenId(open ? null : e.id); } } : undefined}>
                      <td>{fmtDateTime(e.createdAt)}</td>
                      <td>{e.actor?.displayName || e.actor?.username || "Hệ thống"}</td>
                      <td>{actionLabel(e.action)}</td>
                      <td>{targetText(e)}</td>
                      {/* Dòng có thay đổi → link mở/đóng; dòng không có chi tiết → "—" muted cho cột đều, không trống lỗ chỗ. */}
                      <td className="au-toggle">{canOpen ? (open ? "▾ Ẩn" : "▸ Chi tiết") : <span className="muted">—</span>}</td>
                    </tr>
                    {open && canOpen && (
                      <tr className="au-detail"><td colSpan={5}>
                        <div className="au-changes">
                          {changes.map((c, i) => <div className="au-change" key={i}><span className="au-cl">{c.label}</span><span className="au-from">{c.from}</span><span className="au-arrow">→</span><span className="au-to">{c.to}</span></div>)}
                        </div>
                      </td></tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {rows.length > 0 && (
        <div className="list-foot">
          <span className="muted">Hiển thị {(meta.page - 1) * PAGE_SIZE + 1}–{(meta.page - 1) * PAGE_SIZE + rows.length} / {meta.total}</span>
          {(meta.pageCount || 1) > 1 && (
            <div className="pager">
              <button className="btn btn-sm" disabled={page <= 1} onClick={() => { setOpenId(null); setPage((p) => p - 1); }}>← Trước</button>
              <span className="muted">Trang {meta.page}/{meta.pageCount || 1}</span>
              <button className="btn btn-sm" disabled={page >= (meta.pageCount || 1)} onClick={() => { setOpenId(null); setPage((p) => p + 1); }}>Sau →</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Màn hình hẹp (≤ 820px) → đổi sang dạng THẺ.
function useIsMobile() {
  const [m, setM] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 820px)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 820px)");
    const on = () => setM(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return m;
}
