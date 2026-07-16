import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { api, type Me, type QuoteRow } from "../lib/api";
import { useDebouncedValue } from "../lib/query";
import { toast, confirmModal, useEscClose } from "../lib/ui";
import { statusLabel, fmtMoney, fmtDate, codeLabel, shortTitle, errMsg, dash } from "../lib/format";

// Port "Danh sách báo giá" (renderList) — bê ĐẦY ĐỦ: tìm (debounce) + lọc trạng thái + SORT cột
// + phân trang + LƯU filter vào URL (#/list?q=&status=&sort=&page=) + thao tác (mở→editor ·
// Excel · Nhân bản · Bản mới · Xóa) + cột theo vai trò (admin: Người tạo; account_hn: rút gọn HN)
// + empty/error. "Tạo báo giá" → wizard (#/new iframe); mở/nhân-bản → editor (#/quotes/:id iframe).
// Định dạng chung (tiền/ngày/mã/tiêu đề/trạng thái) dùng ../lib/format — KHÔNG tự chế lại ở đây.
const HN_LIST_STATUS: Record<string, { label: string; cls: string }> = { assigned: { label: "Đang làm", cls: "sent" }, submitted: { label: "Chờ duyệt", cls: "pending" }, approved: { label: "Đã duyệt", cls: "approved" }, rejected: { label: "Bị trả", cls: "rejected" } };
const hnBadge = (st?: string | null) => HN_LIST_STATUS[st || ""] || { label: "Chưa giao", cls: "draft" };
const QUOTE_SORTS = ["createdAt", "quoteDate", "total", "quoteNumber"];
const PAGE_SIZE = 20;

export function QuoteListPage({ me }: { me: Me }) {
  const qc = useQueryClient();
  const can = useCallback((perm: string) => me.permissions.includes(perm) || (perm.endsWith(":own") && me.permissions.includes(perm.replace(/:own$/, ":all"))), [me]);
  // Theo QUYỀN (không theo role cứng): thấy mọi báo giá → hiện cột "Người tạo"; người điền HN → bản lược HN.
  const isAdmin = me.permissions.includes("quote:read:all");
  const isAccountHn = me.permissions.includes("quote:hn:fill");
  const isInternalViewer = !isAccountHn && me.permissions.includes("quote:internal:view"); // chi phí: chỉ thấy nội bộ
  const stripped = isAccountHn || isInternalViewer; // ẩn giá/khách/nút (bản lược)
  const payProg = (r: { internalPaidRows?: number; internalRows?: number }) => r.internalRows ? `${r.internalPaidRows ?? 0}/${r.internalRows}` : "—";
  const isMobile = useIsMobile();
  // KHỚP server (quotes.routes.js): 'converted' là TERMINAL → KHÔNG ai xóa; delete:all xóa mọi trạng thái khác;
  // delete:own chỉ xóa báo giá CỦA MÌNH ở draft/rejected. (Trước đây short-circuit delete:all hiện nhầm nút trên 'Đã chốt'.)
  const canDelete = (q: QuoteRow) => q.status !== "converted" && (can("quote:delete:all") || (can("quote:delete:own") && q.createdById === me.id && (q.status === "draft" || q.status === "rejected")));

  const sp0 = new URLSearchParams((location.hash.split("?")[1]) || "");
  const [q, setQ] = useState(sp0.get("q") || "");
  const [status, setStatus] = useState(sp0.get("status") || "");
  const [sort, setSort] = useState(QUOTE_SORTS.includes(sp0.get("sort") || "") ? sp0.get("sort")! : "createdAt");
  const [order, setOrder] = useState<"asc" | "desc">(sp0.get("order") === "asc" ? "asc" : "desc");
  const [page, setPage] = useState(Math.max(1, parseInt(sp0.get("page") || "1", 10) || 1));
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

  // Tải qua TanStack Query. Ô tìm debounce 300ms như cũ (chỉ debounce theo q).
  const debouncedQ = useDebouncedValue(q, q ? 300 : 0);
  useEffect(() => { setPage(1); }, [debouncedQ, status, sort, order]);
  const { data, isPending, error, refetch } = useQuery({
    queryKey: ["quotes", { q: debouncedQ, status, sort, order, page }],
    queryFn: () => api.listQuotes({ q: debouncedQ, status, sort, order, page, size: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });
  const rows = data?.data ?? [];
  const meta = data?.meta ?? { total: 0, page: 1, pageCount: 1 };
  const loading = isPending;
  const err = error ? errMsg(error) : "";
  const reload = () => { qc.invalidateQueries({ queryKey: ["quotes"] }); };

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
        await api.deleteQuote(qr.id); toast("Đã xóa", "success"); reload();
      }
    } catch (ex) { toast(errMsg(ex, "Lỗi"), "error"); }
    finally { busy.current = false; }
  };

  const arrow = (f: string) => sort === f ? (order === "asc" ? " ▲" : " ▼") : "";
  const aria = (f: string): "ascending" | "descending" | "none" => sort === f ? (order === "asc" ? "ascending" : "descending") : "none";
  const SortTh = ({ f, label, right }: { f: string; label: string; right?: boolean }) => (
    <th scope="col" className={`sortable${right ? " num" : ""}`} aria-sort={aria(f)} title="Bấm để sắp xếp" tabIndex={0}
        onClick={() => toggleSort(f)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleSort(f); } }}>{label}{arrow(f)}</th>
  );

  return (
    <div>
      <h1>Danh sách báo giá</h1>
      <p className="muted page-sub">Tìm, lọc và mở báo giá — báo giá Đã chốt sẽ chuyển sang Quản lý dự án.</p>
      <div className="toolbar">
        <input type="search" className="grow" placeholder="Tìm theo số, tiêu đề, khách…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Tìm báo giá" />
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Lọc theo trạng thái">
          <option value="">— Tất cả trạng thái —</option>
          <option value="draft">Nháp</option><option value="converted">Đã chốt</option><option value="lost">Không chốt</option>
          {/* Deep-link từ Pipeline Dashboard (#/list?status=pending…): trạng thái ngoài bộ chuẩn vẫn phải
              hiện trong select — không thì ô trống, user không biết đang lọc gì. */}
          {status && !["draft", "converted", "lost"].includes(status) && <option value={status}>{statusLabel(status)}</option>}
        </select>
        <button className="btn btn-sm btn-ghost" type="button" onClick={() => { setQ(""); setStatus(""); }} disabled={!q && !status}>Xóa lọc</button>
        {can("quote:create") && <button className="btn btn-primary" onClick={() => { location.hash = "#/new"; }}>+ Tạo báo giá</button>}
      </div>

      {err && <div className="err">⚠ {err} <button className="btn btn-sm" onClick={() => refetch()}>Thử lại</button></div>}

      {loading ? (
        <div className="skeleton-wrap">{Array.from({ length: 6 }).map((_, i) => <div className="skeleton-row" key={i} />)}</div>
      ) : rows.length === 0 ? (
        <div className="empty">
          {q || status ? "Không tìm thấy báo giá phù hợp." : "Chưa có báo giá nào."}
          {!q && !status && can("quote:create") && <div style={{ marginTop: 12 }}><button className="btn btn-primary" onClick={() => { location.hash = "#/new"; }}>+ Tạo báo giá</button></div>}
        </div>
      ) : isMobile ? (
        /* MOBILE: thẻ React (không cuộn bảng rộng) — giữ nguyên cột/nút theo ROLE. */
        <div className="ql-cards">
          {rows.map((r) => (
            <div className="ql-card" key={r.id} onClick={(e) => { if ((e.target as HTMLElement).closest("button,a")) return; open(r.id); }}>
              <div className="ql-card-head">
                <strong>{codeLabel(r)}</strong>
                {isAccountHn ? <span className={`status ${hnBadge(r.hnStatus).cls}`}>{hnBadge(r.hnStatus).label}</span> : <span className={`status ${r.status}`}>{statusLabel(r.status)}</span>}
              </div>
              {r.title && <div className="ql-card-title">{shortTitle(r.title)}</div>}
              <dl className="ql-card-body">
                {(isAdmin || isInternalViewer) && <div className="ql-crow"><dt>Người tạo</dt><dd>{r.createdBy?.displayName || dash}</dd></div>}
                {isAccountHn && <div className="ql-crow"><dt>Người giao</dt><dd>{r.createdBy?.displayName || dash}</dd></div>}
                <div className="ql-crow"><dt>Ngày</dt><dd>{fmtDate(r.quoteDate) || dash}</dd></div>
                <div className="ql-crow"><dt>Sheet</dt><dd>{isAccountHn ? (r.hnSheetCount ?? 0) : (r.sheetCount ?? 0)}</dd></div>
                {isAccountHn
                  ? <div className="ql-crow"><dt>Tổng HN</dt><dd>{r.hnTotal == null ? dash : <b>{fmtMoney(r.hnTotal)}</b>}</dd></div>
                  : isInternalViewer
                  ? <div className="ql-crow"><dt>Đã thanh toán</dt><dd><b>{payProg(r)} hàng</b></dd></div>
                  : <div className="ql-crow"><dt>Tổng (VNĐ)</dt><dd>{r.total == null ? dash : <b>{fmtMoney(r.total)}</b>}</dd></div>}
                <div className="ql-crow"><dt>Công ty</dt><dd>{r.company?.shortName || r.company?.name || dash}</dd></div>
                {!stripped && <div className="ql-crow"><dt>Khách</dt><dd>{r.toCompany || dash}{r.customerCode ? ` · ${r.customerCode}` : ""}</dd></div>}
              </dl>
              {!stripped && (
                <div className="ql-card-actions">
                  <button className="qa-btn" title="Tải file Excel" onClick={(e) => act("excel", r, e)}><span className="qa-ico">📥</span><span className="qa-label">Excel</span></button>
                  <button className="qa-btn" title="Nhân bản" onClick={(e) => act("dup", r, e)}><span className="qa-ico">📋</span><span className="qa-label">Nhân bản</span></button>
                  <button className="qa-btn" title="Bản mới cùng mã dự án" onClick={(e) => act("revise", r, e)}><span className="qa-ico">➕</span><span className="qa-label">Bản mới</span></button>
                  {canDelete(r) && <button className="qa-btn qa-danger" title="Xóa" onClick={(e) => act("del", r, e)}><span className="qa-ico">🗑</span><span className="qa-label">Xóa</span></button>}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="list-wrap">
          <table className="list-table">
            <thead>
              <tr>
                <SortTh f="quoteNumber" label="Mã dự án" />
                {(isAdmin || isInternalViewer) && <th scope="col">Người tạo</th>}{isAccountHn && <th scope="col">Người giao</th>}
                <th scope="col">Tiêu đề</th>
                <SortTh f="quoteDate" label="Ngày" />
                <th scope="col" className="num">Sheet</th>
                {!stripped && <SortTh f="total" label="Tổng (VNĐ)" right />}
                <th scope="col">Công ty</th>
                {isAccountHn ? <th scope="col" className="num">Tổng HN</th> : isInternalViewer ? <th scope="col" className="num">Đã TT</th> : <><th scope="col">Khách</th><th scope="col">Mã KH</th></>}
                <th scope="col">Trạng thái</th>
                {!stripped && <th scope="col" className="actions" aria-label="Thao tác" />}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="qrow" title="Bấm để mở báo giá"
                    onClick={(e) => { if ((e.target as HTMLElement).closest("button,a")) return; open(r.id); }}>
                  <td><a href={`#/quotes/${r.id}`}><strong>{codeLabel(r)}</strong></a></td>
                  {(isAdmin || isInternalViewer) && <td>{r.createdBy?.displayName || dash}</td>}{isAccountHn && <td>{r.createdBy?.displayName || dash}</td>}
                  <td title={r.title}>{shortTitle(r.title)}</td>
                  <td>{fmtDate(r.quoteDate) || dash}</td>
                  <td className="num">{isAccountHn ? (r.hnSheetCount ?? 0) : (r.sheetCount ?? 0)}</td>
                  {!stripped && <td className="num">{r.total == null ? dash : fmtMoney(r.total)}</td>}
                  <td>{r.company?.shortName || r.company?.name || dash}</td>
                  {isAccountHn ? <td className="num">{r.hnTotal == null ? dash : fmtMoney(r.hnTotal)}</td> : isInternalViewer ? <td className="num">{payProg(r)} hàng</td> : <><td>{r.toCompany || dash}</td><td>{r.customerCode ? <strong>{r.customerCode}</strong> : dash}</td></>}
                  <td>{isAccountHn ? <span className={`status ${hnBadge(r.hnStatus).cls}`}>{hnBadge(r.hnStatus).label}</span> : <span className={`status ${r.status}`}>{statusLabel(r.status)}</span>}</td>
                  {!stripped && (
                    <td className="row-actions qa-cell">
                      <RowMenu r={r} act={act} canDelete={canDelete(r)} />
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
          {(meta.pageCount || 1) > 1 && (
            <div className="pager">
              <button className="btn btn-sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>← Trước</button>
              <span className="muted">Trang {meta.page}/{meta.pageCount || 1}</span>
              <button className="btn btn-sm" disabled={page >= (meta.pageCount || 1)} onClick={() => setPage((p) => p + 1)}>Sau →</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Thao tác 1 dòng (desktop): giữ Excel hiện sẵn (hay dùng), gộp Nhân bản/Bản mới/Xóa vào menu "⋯".
// Menu render qua portal + position:fixed → KHÔNG bị .list-table overflow:hidden cắt mất.
function RowMenu({ r, act, canDelete }: { r: QuoteRow; act: (a: string, qr: QuoteRow, e?: { stopPropagation: () => void }) => void; canDelete: boolean }) {
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const open = pos != null;
  // Escape → đóng menu + TRẢ FOCUS về nút "⋯" (a11y — role=menu chuẩn).
  useEscClose(() => { setPos(null); btnRef.current?.focus(); }, open);
  useEffect(() => {
    if (!open) return;
    const close = () => setPos(null);
    document.addEventListener("mousedown", close);
    document.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("scroll", close, true); window.removeEventListener("resize", close); };
  }, [open]);
  const toggle = (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    if (open || !btnRef.current) { setPos(null); return; }
    const rc = btnRef.current.getBoundingClientRect();
    setPos({ top: rc.bottom + 3, right: Math.max(8, window.innerWidth - rc.right) });
  };
  const run = (a: string) => (e: { stopPropagation: () => void }) => { e.stopPropagation(); setPos(null); act(a, r, e); };
  return (
    <>
      <button className="qa-btn" title="Tải file Excel" aria-label="Tải Excel" onClick={(e) => act("excel", r, e)}><span className="qa-ico">📥</span><span className="qa-label">Excel</span></button>
      <button ref={btnRef} className="qa-btn" title="Thao tác khác" aria-label="Thao tác khác" aria-haspopup="menu" aria-expanded={open} onClick={toggle}><span className="qa-ico" aria-hidden="true">⋯</span></button>
      {open && pos && createPortal(
        <div className="qa-menu" role="menu" style={{ top: pos.top, right: pos.right }}
             onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
          <button role="menuitem" onClick={run("dup")}>📋 Nhân bản</button>
          <button role="menuitem" onClick={run("revise")}>➕ Bản mới cùng mã dự án</button>
          {canDelete && <button role="menuitem" className="qa-menu-danger" onClick={run("del")}>🗑 Xóa</button>}
        </div>, document.body)}
    </>
  );
}

// Màn hình hẹp (≤ 820px) → đổi sang dạng THẺ React (responsive, không cuộn bảng rộng).
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
