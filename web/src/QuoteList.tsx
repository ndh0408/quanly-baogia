import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, type Me, type QuoteRow } from "./api";
import { toast, confirmModal } from "./ui";

// Port "Danh sách báo giá" (renderList) — bê ĐẦY ĐỦ: tìm (debounce) + lọc trạng thái + SORT cột
// + phân trang + LƯU filter vào URL (#/list?q=&status=&sort=&page=) + thao tác (mở→editor ·
// Excel · Nhân bản · Bản mới · Xóa) + cột theo vai trò (admin: Người tạo; account_hn: rút gọn HN)
// + empty/error. "Tạo báo giá" → wizard (#/new iframe); mở/nhân-bản → editor (#/quotes/:id iframe).
const STATUS_LABEL: Record<string, string> = { draft: "Nháp", pending: "Chờ duyệt", approved: "Đã duyệt", rejected: "Bị từ chối", sent: "Đã gửi", converted: "Đã chốt", lost: "Không chốt" };
const statusLabel = (s: string) => STATUS_LABEL[s] || s || "—";
const HN_LIST_STATUS: Record<string, { label: string; cls: string }> = { assigned: { label: "Đang làm", cls: "sent" }, submitted: { label: "Chờ duyệt", cls: "pending" }, approved: { label: "Đã duyệt", cls: "approved" }, rejected: { label: "Bị trả", cls: "rejected" } };
const hnBadge = (st?: string | null) => HN_LIST_STATUS[st || ""] || { label: "Chưa giao", cls: "draft" };
const fmtMoney = (v?: number) => (v == null ? "" : Number(v).toLocaleString("vi-VN"));
const fmtDate = (v: string) => { const d = new Date(v); if (isNaN(d.getTime())) return ""; const p = (n: number) => String(n).padStart(2, "0"); return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`; };
const codeLabel = (q: QuoteRow) => { const c = q.projectCode || q.quoteNumber || ""; return q.projectVersion && q.projectVersion > 1 ? `${c}_v${q.projectVersion}` : c; };
const shortTitle = (t: string) => { const s = String(t || ""); return s.replace(/^\s*bảng\s+báo\s+giá\s*[-–—:|·]*\s*/i, "").trim() || s; };
const QUOTE_SORTS = ["createdAt", "quoteDate", "total", "quoteNumber"];
const PAGE_SIZE = 20;

export function QuoteListPage({ me }: { me: Me }) {
  const can = useCallback((perm: string) => me.permissions.includes(perm) || (perm.endsWith(":own") && me.permissions.includes(perm.replace(/:own$/, ":all"))), [me]);
  const isAdmin = me.role === "admin";
  const isAccountHn = me.role === "account_hn";
  // KHỚP server (quotes.routes.js): 'converted' là TERMINAL → KHÔNG ai xóa; delete:all xóa mọi trạng thái khác;
  // delete:own chỉ xóa báo giá CỦA MÌNH ở draft/rejected. (Trước đây short-circuit delete:all hiện nhầm nút trên 'Đã chốt'.)
  const canDelete = (q: QuoteRow) => q.status !== "converted" && (can("quote:delete:all") || (can("quote:delete:own") && q.createdById === me.id && (q.status === "draft" || q.status === "rejected")));

  const sp0 = new URLSearchParams((location.hash.split("?")[1]) || "");
  const [q, setQ] = useState(sp0.get("q") || "");
  const [status, setStatus] = useState(sp0.get("status") || "");
  const [sort, setSort] = useState(QUOTE_SORTS.includes(sp0.get("sort") || "") ? sp0.get("sort")! : "createdAt");
  const [order, setOrder] = useState<"asc" | "desc">(sp0.get("order") === "asc" ? "asc" : "desc");
  const [page, setPage] = useState(Math.max(1, parseInt(sp0.get("page") || "1", 10) || 1));
  const [rows, setRows] = useState<QuoteRow[]>([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, pageCount: 1 });
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const busy = useRef(false);

  // Ghi filter lên URL bằng replaceState (không bắn hashchange → React shell không re-route).
  useEffect(() => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (status) p.set("status", status);
    if (sort !== "createdAt") p.set("sort", sort);
    if (order !== "desc") p.set("order", order);
    if (page > 1) p.set("page", String(page));
    const qs = p.toString();
    try { history.replaceState(null, "", "#/list" + (qs ? "?" + qs : "")); } catch { /* ignore */ }
  }, [q, status, sort, order, page]);

  const load = useCallback(async () => {
    setLoading(true); setErr("");
    try { const r = await api.listQuotes({ q, status, sort, order, page, size: PAGE_SIZE }); setRows(r.data); setMeta({ total: r.meta.total, page: r.meta.page, pageCount: r.meta.pageCount }); }
    catch (ex) { setErr(ex instanceof ApiError ? ex.message : "Lỗi tải dữ liệu"); }
    finally { setLoading(false); }
  }, [q, status, sort, order, page]);
  useEffect(() => { const t = setTimeout(load, q ? 300 : 0); return () => clearTimeout(t); }, [load, q]);
  useEffect(() => { setPage(1); }, [q, status, sort, order]);

  const toggleSort = (f: string) => {
    if (sort === f) setOrder((o) => (o === "asc" ? "desc" : "asc"));
    else { setSort(f); setOrder(f === "quoteDate" || f === "total" ? "desc" : "asc"); }
  };
  const open = (id: number) => { location.hash = "#/quotes/" + id; };
  const act = async (a: string, qr: QuoteRow, e?: { stopPropagation: () => void }) => {
    e?.stopPropagation();
    if (busy.current) return; busy.current = true;
    try {
      if (a === "excel") window.open(`/api/export/${qr.id}.xlsx?t=${Date.now()}`, "_blank");
      else if (a === "dup") { const nq = await api.duplicateQuote(qr.id); toast("Đã nhân bản. Bạn đang sửa bản mới.", "success"); open(nq.id); }
      else if (a === "revise") { const nq = await api.duplicateQuote(qr.id, true); toast(`Đã tạo bản mới cùng mã dự án (${codeLabel(nq)}).`, "success"); open(nq.id); }
      else if (a === "del") {
        if (!(await confirmModal("Xóa báo giá", `Xóa báo giá ${qr.projectCode || qr.quoteNumber}? Hành động không thể hoàn tác.`, { danger: true, confirmText: "Xóa" }))) return;
        await api.deleteQuote(qr.id); toast("Đã xóa", "success"); load();
      }
    } catch (ex) { toast(ex instanceof ApiError ? ex.message : "Lỗi", "error"); }
    finally { busy.current = false; }
  };

  const arrow = (f: string) => sort === f ? (order === "asc" ? " ▲" : " ▼") : "";
  const aria = (f: string): "ascending" | "descending" | "none" => sort === f ? (order === "asc" ? "ascending" : "descending") : "none";
  const SortTh = ({ f, label, right }: { f: string; label: string; right?: boolean }) => (
    <th className="sortable" aria-sort={aria(f)} title="Bấm để sắp xếp" style={right ? { textAlign: "right" } : undefined} onClick={() => toggleSort(f)}>{label}{arrow(f)}</th>
  );

  return (
    <div>
      <h1>Danh sách báo giá</h1>
      <div className="toolbar">
        <input className="grow" placeholder="Tìm theo số, tiêu đề, khách…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Tìm báo giá" />
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Lọc theo trạng thái">
          <option value="">— Tất cả trạng thái —</option>
          <option value="draft">Nháp</option><option value="converted">Đã chốt</option><option value="lost">Không chốt</option>
        </select>
        <button className="btn" onClick={load}>Tải lại</button>
        {can("quote:create") && <button className="btn btn-primary" onClick={() => { location.hash = "#/new"; }}>+ Tạo báo giá</button>}
      </div>

      {err && <div className="err">⚠ {err} <button className="btn btn-sm" onClick={load}>Thử lại</button></div>}

      {loading ? (
        <div className="skeleton-wrap">{Array.from({ length: 6 }).map((_, i) => <div className="skeleton-row" key={i} />)}</div>
      ) : rows.length === 0 ? (
        <div className="empty">{q || status ? "Không tìm thấy báo giá phù hợp." : "Chưa có báo giá nào."}</div>
      ) : (
        <div className="list-wrap">
          <table className="list-table cards-sm">
            <thead>
              <tr>
                <SortTh f="quoteNumber" label="Mã dự án" />
                {isAdmin && <th>Người tạo</th>}{isAccountHn && <th>Người giao</th>}
                <th>Tiêu đề</th>
                <SortTh f="quoteDate" label="Ngày" />
                <th>Sheet</th>
                {!isAccountHn && <SortTh f="total" label="Tổng (VNĐ)" right />}
                <th>Công ty</th>
                {isAccountHn ? <th style={{ textAlign: "right" }}>Tổng HN</th> : <><th>Khách</th><th>Mã KH</th></>}
                <th>Trạng thái</th>
                {!isAccountHn && <th>Thao tác</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="qrow" title="Bấm để mở báo giá" style={{ cursor: "pointer" }}
                    onClick={(e) => { if ((e.target as HTMLElement).closest("button,a")) return; open(r.id); }}>
                  <td data-label="Mã dự án"><strong>{codeLabel(r)}</strong></td>
                  {isAdmin && <td data-label="Người tạo">{r.createdBy?.displayName || ""}</td>}{isAccountHn && <td data-label="Người giao">{r.createdBy?.displayName || "—"}</td>}
                  <td data-label="Tiêu đề" title={r.title}>{shortTitle(r.title)}</td>
                  <td data-label="Ngày">{fmtDate(r.quoteDate)}</td>
                  <td data-label="Sheet" style={{ textAlign: "center" }}>{isAccountHn ? (r.hnSheetCount ?? 0) : (r.sheetCount ?? 0)}</td>
                  {!isAccountHn && <td data-label="Tổng (VNĐ)" style={{ textAlign: "right" }}>{fmtMoney(r.total)}</td>}
                  <td data-label="Công ty">{r.company?.shortName || r.company?.name || ""}</td>
                  {isAccountHn ? <td data-label="Tổng HN" style={{ textAlign: "right" }}>{fmtMoney(r.hnTotal)}</td> : <><td data-label="Khách">{r.toCompany}</td><td data-label="Mã KH">{r.customerCode ? <strong>{r.customerCode}</strong> : "—"}</td></>}
                  <td data-label="Trạng thái">{isAccountHn ? <span className={`status ${hnBadge(r.hnStatus).cls}`}>{hnBadge(r.hnStatus).label}</span> : <span className={`status ${r.status}`}>{statusLabel(r.status)}</span>}</td>
                  {!isAccountHn && (
                    <td className="row-actions" data-label="Thao tác" style={{ whiteSpace: "nowrap" }}>
                      <button className="btn btn-sm" title="Tải file Excel" onClick={(e) => act("excel", r, e)}>📥 Excel</button>
                      <button className="btn btn-sm" title="Nhân bản thành báo giá mới" onClick={(e) => act("dup", r, e)}>📋 Nhân bản</button>
                      <button className="btn btn-sm" title="Tạo bản mới CÙNG mã dự án (v2, v3…)" onClick={(e) => act("revise", r, e)}>➕ Bản mới</button>
                      {canDelete(r) && <button className="btn btn-sm btn-danger" title="Xóa báo giá" onClick={(e) => act("del", r, e)}>🗑 Xóa</button>}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rows.length > 0 && (
        <div className="list-foot">
          <span className="muted">Hiển thị {(meta.page - 1) * PAGE_SIZE + 1}–{(meta.page - 1) * PAGE_SIZE + rows.length} / {meta.total} báo giá</span>
          <div className="pager">
            <button className="btn btn-sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>← Trước</button>
            <span className="muted">Trang {meta.page}/{meta.pageCount || 1}</span>
            <button className="btn btn-sm" disabled={page >= (meta.pageCount || 1)} onClick={() => setPage((p) => p + 1)}>Sau →</button>
          </div>
        </div>
      )}
    </div>
  );
}
