import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type AuditEntry } from "./api";

// Port "Nhật ký hoạt động" (renderAuditLog) — bê ĐẦY ĐỦ: lọc theo Hoạt động/Đối tượng/Khoảng
// ngày (Từ–Đến) + Xóa lọc + phân trang + nhãn tiếng Việt + skeleton/empty/error. Read-only.
// Bảo mật: gate audit:view (Shell nav + /api/audit server).
const ACTION_LABEL: Record<string, string> = {
  "quote.create": "Tạo báo giá", "quote.update": "Sửa báo giá", "quote.submit": "Trình duyệt báo giá",
  "quote.approve": "Duyệt báo giá", "quote.reject": "Từ chối báo giá", "quote.send": "Gửi báo giá cho khách",
  "quote.convert": "Chốt báo giá (thắng)", "quote.lost": "Đánh dấu không chốt", "quote.delete": "Xóa báo giá",
  "quote.duplicate": "Nhân bản báo giá", "quote.reopened": "Mở lại để sửa",
  "customer.create": "Thêm khách hàng", "customer.update": "Sửa khách hàng", "customer.delete": "Xóa khách hàng",
  "customer.note.add": "Thêm ghi chú khách hàng",
  "user.create": "Thêm nhân viên", "user.update": "Cập nhật nhân viên", "user.invite": "Mời nhân viên",
  "user.invite.resend": "Gửi lại lời mời", "user.delete": "Xóa nhân viên",
  "login.token": "Đăng nhập (ứng dụng)", "password.change.success": "Đổi mật khẩu",
  "password.change.failed": "Đổi mật khẩu thất bại", "mfa.enable": "Bật bảo mật 2 lớp",
  "mfa.disable": "Tắt bảo mật 2 lớp", "token.revoke-all": "Đăng xuất mọi thiết bị",
  "webhook.create": "Thêm tích hợp", "webhook.update": "Sửa tích hợp", "webhook.delete": "Xóa tích hợp",
};
const RESOURCE_LABEL: Record<string, string> = { quote: "Báo giá", customer: "Khách hàng", product: "Sản phẩm", user: "Nhân viên", webhook: "Webhook", token: "Phiên đăng nhập" };
const actionLabel = (a: string) => ACTION_LABEL[a] ?? a;
const resourceLabel = (r: string) => RESOURCE_LABEL[r] ?? r;
const fmtDateTime = (v: string) => {
  const d = new Date(v);
  if (isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
// Dropdown options = mọi nhãn (như SPA build từ ACTION_LABEL/RESOURCE_LABEL).
const ACTION_OPTS = Object.entries(ACTION_LABEL);
const RESOURCE_OPTS = Object.entries(RESOURCE_LABEL);
const PAGE_SIZE = 50;

export function AuditPage() {
  const [rows, setRows] = useState<AuditEntry[]>([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, pageCount: 1 });
  const [action, setAction] = useState("");
  const [resource, setResource] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setErr("");
    try {
      const r = await api.listAudit({ action, resource, from, to, page, size: PAGE_SIZE });
      setRows(r.data);
      setMeta({ total: r.meta.total, page: r.meta.page, pageCount: r.meta.pageCount });
    } catch (ex) { setErr(ex instanceof ApiError ? ex.message : "Lỗi tải dữ liệu"); }
    finally { setLoading(false); }
  }, [action, resource, from, to, page]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [action, resource, from, to]);

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

      {err && <div className="err">⚠ {err} <button className="btn btn-sm" onClick={load}>Thử lại</button></div>}

      {loading ? (
        <div className="skeleton-wrap">{Array.from({ length: 6 }).map((_, i) => <div className="skeleton-row" key={i} />)}</div>
      ) : rows.length === 0 ? (
        <div className="empty">{hasFilter ? "Không có hoạt động khớp bộ lọc." : "Chưa có hoạt động nào."}</div>
      ) : (
        <div className="list-wrap">
          <table className="list-table">
            <thead><tr><th>Thời gian</th><th>Người thực hiện</th><th>Hoạt động</th><th>Đối tượng</th></tr></thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id}>
                  <td>{fmtDateTime(e.createdAt)}</td>
                  <td>{e.actor?.displayName || e.actor?.username || "Hệ thống"}</td>
                  <td>{actionLabel(e.action)}</td>
                  <td>{resourceLabel(e.resource)}{e.resourceId ? ` #${e.resourceId}` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rows.length > 0 && (
        <div className="list-foot">
          <span className="muted">Hiển thị {(meta.page - 1) * PAGE_SIZE + 1}–{(meta.page - 1) * PAGE_SIZE + rows.length} / {meta.total}</span>
          <div className="pager">
            <button className="btn btn-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>← Trước</button>
            <span className="muted">Trang {meta.page}/{meta.pageCount || 1}</span>
            <button className="btn btn-sm" disabled={page >= (meta.pageCount || 1)} onClick={() => setPage((p) => p + 1)}>Sau →</button>
          </div>
        </div>
      )}
    </div>
  );
}
