import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Notif } from "../lib/api";
import { errMsg, fmtDateTime } from "../lib/format";
import { toast } from "../lib/ui";

// Port "Thông báo" (renderNotifications) — bê ĐẦY ĐỦ: danh sách thẻ thông báo (đã/chưa đọc) +
// lọc Tất cả/Chưa đọc + "Đánh dấu đã đọc tất cả" + bấm 1 thông báo → đánh dấu đã đọc + deep-link
// sang báo giá (#/quotes/:id → editor) + giờ + empty/skeleton/error. Báo Shell refresh badge sau khi đọc.
// Nhãn thân thiện thay token thô ("quote"…) ở cuối mỗi dòng. Loại không map → ẩn (không hiện token thô).
const RESOURCE_LABEL: Record<string, string> = {
  quote: "Báo giá", customer: "Khách hàng", personnel: "Nhân sự", employee: "Danh bạ nhân sự", user: "Tài khoản",
};
// Khử TRÙNG LẶP: cùng resource+resourceId+title+body → chỉ giữ bản mới nhất (list đã sắp mới→cũ).
// Chặn tận gốc ở backend (notify() bỏ qua bản giống chưa đọc <5'), đây là lưới an toàn cho bản cũ đã lỡ tạo.
function dedupNotifs(list: Notif[]): Notif[] {
  const seen = new Set<string>();
  const out: Notif[] = [];
  for (const n of list) {
    const key = `${n.resource ?? ""}|${n.resourceId ?? ""}|${n.title}|${n.body}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(n);
  }
  return out;
}

export function NotificationsPage({ onBadge }: { onBadge?: () => void }) {
  const qc = useQueryClient();
  const [filter, setFilter] = useState(""); // "" = tất cả · "unread" = chưa đọc (lọc client-side)
  const { data, isPending, error, refetch } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api.listNotifications(),
  });
  const rows = dedupNotifs(data?.data ?? []);
  const unread = rows.filter((n) => !n.readAt).length;
  const shown = filter === "unread" ? rows.filter((n) => !n.readAt) : rows;
  const loading = isPending;
  const err = error ? errMsg(error) : "";

  // Cập nhật LIVE khi có thông báo mới (SSE qua Shell) hoặc quay lại tab.
  useEffect(() => {
    const on = () => { qc.invalidateQueries({ queryKey: ["notifications"] }); };
    window.addEventListener("realtime:notification", on);
    window.addEventListener("focus", on);
    return () => { window.removeEventListener("realtime:notification", on); window.removeEventListener("focus", on); };
  }, [qc]);

  const markAll = async () => {
    try { await api.markAllNotifsRead(); toast("Đã đánh dấu tất cả là đã đọc", "success"); onBadge?.(); qc.invalidateQueries({ queryKey: ["notifications"] }); }
    catch (ex) { toast(errMsg(ex, "Lỗi"), "error"); }
  };
  const onClick = async (n: Notif) => {
    if (!n.readAt) {
      try { await api.markNotifRead(n.id); } catch { /* ignore */ }
      qc.setQueryData<{ data: Notif[] }>(["notifications"], (old) =>
        old ? { ...old, data: old.data.map((x) => x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x) } : old);
      onBadge?.();
    }
    if (n.resource === "quote" && n.resourceId) location.hash = "#/quotes/" + n.resourceId;
  };

  return (
    <div>
      <h1>Thông báo</h1>
      <p className="page-sub">Bấm 1 thông báo để đánh dấu đã đọc — thông báo về báo giá sẽ mở thẳng báo giá đó.</p>
      <div className="toolbar">
        <select aria-label="Lọc thông báo" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">Tất cả</option>
          <option value="unread">Chưa đọc</option>
        </select>
        {!loading && rows.length > 0 && (
          <span className="muted">{unread > 0 ? `${unread} chưa đọc / ${rows.length} thông báo` : `${rows.length} thông báo — đã đọc hết`}</span>
        )}
        <span className="spacer" />
        <button className="btn" onClick={markAll} disabled={loading || unread === 0}>Đánh dấu đã đọc tất cả</button>
      </div>
      {err && <div className="err">⚠ {err} <button className="btn btn-sm" onClick={() => refetch()}>Thử lại</button></div>}
      {loading ? (
        <div className="skeleton-wrap">{Array.from({ length: 4 }).map((_, i) => <div className="skeleton-row" key={i} />)}</div>
      ) : shown.length === 0 ? (
        // Khi query LỖI: chỉ hiện banner .err ở trên, KHÔNG hiện "Không có thông báo nào" gây hiểu nhầm.
        err ? null : <div className="empty">{filter === "unread" && rows.length > 0 ? "Không có thông báo chưa đọc." : "Không có thông báo nào."}</div>
      ) : (
        <>
          {shown.map((n) => {
            const openQuote = n.resource === "quote" && !!n.resourceId;
            return (
              <div key={n.id} className={`notif ${n.readAt ? "" : "unread"}`} role="button" tabIndex={0}
                   aria-label={`${n.title}${!n.readAt ? " — chưa đọc" : ""}`}
                   title={openQuote ? "Mở báo giá" : (!n.readAt ? "Đánh dấu đã đọc" : undefined)}
                   onClick={() => onClick(n)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(n); } }}>
                <div className="notif-title">{n.title}</div>
                {/* Chuẩn đơn vị tiền toàn app là "đ" — backend cũ ghi " VND" trong body, thay khi render. */}
                <div className="notif-body">{(n.body || "").replace(/\bVND\b/g, "đ")}</div>
                <div className="notif-meta">
                  <span>{fmtDateTime(n.createdAt)}</span>
                  {n.resource && RESOURCE_LABEL[n.resource] && <span className="notif-tag">{RESOURCE_LABEL[n.resource]}</span>}
                  {openQuote && <span className="muted">Mở báo giá →</span>}
                </div>
              </div>
            );
          })}
          {/* Backend cắt 50 bản mới nhất (chưa có phân trang) — nói rõ để user biết danh sách bị giới hạn. */}
          <div className="list-foot">
            <span className="muted">
              {filter === "unread"
                ? `Hiển thị ${shown.length} chưa đọc / ${rows.length} thông báo gần nhất`
                : `Hiển thị ${rows.length} thông báo gần nhất`}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
