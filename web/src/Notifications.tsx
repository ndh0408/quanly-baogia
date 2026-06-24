import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type Notif } from "./api";
import { toast } from "./ui";

// Port "Thông báo" (renderNotifications) — bê ĐẦY ĐỦ: danh sách thẻ thông báo (đã/chưa đọc) +
// "Đánh dấu đã đọc tất cả" + bấm 1 thông báo → đánh dấu đã đọc + deep-link sang báo giá
// (#/quotes/:id → editor) + giờ + empty/skeleton/error. Báo Shell refresh badge sau khi đọc.
const fmtDateTime = (v: string) => {
  const d = new Date(v);
  if (isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export function NotificationsPage({ onBadge }: { onBadge?: () => void }) {
  const [rows, setRows] = useState<Notif[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setErr("");
    try { const r = await api.listNotifications(); setRows(r.data); }
    catch (ex) { setErr(ex instanceof ApiError ? ex.message : "Lỗi tải dữ liệu"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  // Cập nhật LIVE khi có thông báo mới (SSE qua Shell) hoặc quay lại tab.
  useEffect(() => {
    const on = () => load();
    window.addEventListener("realtime:notification", on);
    window.addEventListener("focus", on);
    return () => { window.removeEventListener("realtime:notification", on); window.removeEventListener("focus", on); };
  }, [load]);

  const markAll = async () => {
    try { await api.markAllNotifsRead(); toast("Đã đánh dấu tất cả là đã đọc", "success"); onBadge?.(); load(); }
    catch (ex) { toast(ex instanceof ApiError ? ex.message : "Lỗi", "error"); }
  };
  const onClick = async (n: Notif) => {
    if (!n.readAt) {
      try { await api.markNotifRead(n.id); } catch { /* ignore */ }
      setRows((rs) => rs.map((x) => x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x));
      onBadge?.();
    }
    if (n.resource === "quote" && n.resourceId) location.hash = "#/quotes/" + n.resourceId;
  };

  return (
    <div>
      <h1>Thông báo</h1>
      <div className="toolbar"><button className="btn" onClick={markAll}>Đánh dấu đã đọc tất cả</button></div>
      {err && <div className="err">⚠ {err} <button className="btn btn-sm" onClick={load}>Thử lại</button></div>}
      {loading ? (
        <div className="skeleton-wrap">{Array.from({ length: 4 }).map((_, i) => <div className="skeleton-row" key={i} />)}</div>
      ) : rows.length === 0 ? (
        <div className="empty">Không có thông báo nào.</div>
      ) : (
        rows.map((n) => (
          <div key={n.id} className={`notif ${n.readAt ? "" : "unread"}`} role="button" tabIndex={0}
               onClick={() => onClick(n)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(n); } }}>
            <div className="notif-title">{n.title}</div>
            <div className="notif-body">{n.body}</div>
            <div className="notif-meta">{fmtDateTime(n.createdAt)} {n.resource || ""}</div>
          </div>
        ))
      )}
    </div>
  );
}
