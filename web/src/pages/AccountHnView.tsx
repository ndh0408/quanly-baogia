import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, type EditorTemplate, type QuoteFull } from "../lib/api";
import { toast, confirmModal } from "../lib/ui";
import * as M from "../lib/quoteMath";
import { type ItemK, nextK } from "../lib/gridShared";
import { GridTable } from "../components/GridTable";
import { extraTableSum, type ExtraTable } from "../components/ExtraTables";

// Port "renderAccountHnView" — vai trò account_hn CHỈ điền giá Hà Nội (số nội bộ, không thấy báo giá khách).
// Mỗi sheet báo giá → 1 khối; trong khối là các bảng HN dạng tab (tái dùng GridTable, category=hanoi).
// Lưu (PUT /hn) + Gửi duyệt (POST /hn/submit). Sửa được khi status assigned/rejected.

let _templates: EditorTemplate[] | null = null;
type WinDirty = Window & { __editorDirty?: boolean };
type HnTable = ExtraTable;
type HnSheet = { sheetId?: number | null; sheetName?: string | null; hnTables: HnTable[]; _activeHn?: number };
const blankHnItem = (): ItemK => ({ kind: "item", name: "", detail: "", unit: "", quantity: 0, unitPrice: 0, days: null, notes: "", _k: nextK() });
const STATUS: Record<string, string> = { assigned: "Đang làm", submitted: "Đã gửi — chờ quản lý duyệt", approved: "✓ Đã duyệt", rejected: "↩ Bị trả lại" };

export function AccountHnView({ quoteId }: { quoteId: number }) {
  const qRef = useRef<QuoteFull | null>(null);
  const [, setTick] = useState(0);
  const redraw = useCallback(() => setTick((t) => t + 1), []);
  const dirtyRef = useRef(false);
  const mark = () => { dirtyRef.current = true; (window as WinDirty).__editorDirty = true; };
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  // Cảnh báo CHƯA LƯU: chặn F5/đóng tab (beforeunload) theo dirtyRef; cờ global __editorDirty để Shell
  // chặn điều hướng menu (guardLeave) — giống QuoteEditor. Dọn cờ khi rời trang.
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (dirtyRef.current) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", h);
    return () => { window.removeEventListener("beforeunload", h); (window as WinDirty).__editorDirty = false; };
  }, []);

  const load = useCallback(async () => {
    try {
      if (!_templates) _templates = await api.metaTemplates();
      const q = await api.getQuote(quoteId) as QuoteFull & { hnSheets?: HnSheet[] };
      if (!Array.isArray(q.hnSheets) || !q.hnSheets.length) q.hnSheets = [{ sheetId: null, sheetName: null, hnTables: [] }];
      qRef.current = q; dirtyRef.current = false; (window as WinDirty).__editorDirty = false; setReady(true); redraw();
    } catch (ex) { setErr(ex instanceof ApiError ? ex.message : "Lỗi tải"); }
  }, [quoteId, redraw]);
  useEffect(() => { load(); }, [load]);

  if (err) return <div className="err" style={{ margin: 24 }}>⚠ {err} <button type="button" className="btn btn-sm" onClick={() => { setErr(""); load(); }}>Thử lại</button> <a className="btn btn-sm" href="#/list">Về danh sách</a></div>;
  if (!ready || !qRef.current) return <div className="skeleton-wrap" style={{ padding: 24 }}>{Array.from({ length: 5 }).map((_, i) => <div className="skeleton-row" key={i} />)}</div>;

  const templates = _templates || [];
  const q = qRef.current as QuoteFull & { hnSheets: HnSheet[]; hnStatus?: string; hnRejectNote?: string; companyName?: string };
  const hnStatus = q.hnStatus || "assigned";
  const editable = !q.hnStatus || ["assigned", "rejected"].includes(q.hnStatus);
  const tplList0 = templates.filter((x) => x.companyId === q.companyId);
  const tplList = tplList0.length ? tplList0 : templates;
  const defTplId = tplList[0]?.id;
  const tplOf = (t: HnTable) => templates.find((x) => x.id === (t.templateId || defTplId)) || tplList[0];
  const newHnTable = (tplId?: number): HnTable => ({ category: "hanoi", name: "", templateId: tplId || defTplId, groupSubtotal: true, items: [blankHnItem()], _k: nextK() });

  // Xoá 1 bảng HN trong sheet — hỏi xác nhận khi bảng đã có dữ liệu điền (không hoàn tác được).
  const removeTable = async (hs: HnSheet, ti: number) => {
    const tbl = hs.hnTables[ti];
    const hasData = (tbl?.items || []).some((it) => (it.name || "").trim() || (it.detail || "").trim() || it.quantity || it.unitPrice);
    if (hasData && !(await confirmModal("Xoá bảng Hà Nội?", `Bảng "${tbl?.name || `Bảng ${ti + 1}`}" đã có dòng điền — xoá sẽ mất dữ liệu, không hoàn tác được. Tiếp tục?`, { danger: true, confirmText: "Xoá bảng" }))) return;
    hs.hnTables.splice(ti, 1);
    let a = hs._activeHn || 0; if (a > ti) a--; if (a >= hs.hnTables.length) a = hs.hnTables.length - 1; if (a < 0) a = 0; hs._activeHn = a;
    mark(); redraw();
  };

  // dọn days cũ cho bảng mẫu không có Số Ngày → Tổng HN không phồng
  if (editable) { let cl = false; q.hnSheets.forEach((hs) => (hs.hnTables || []).forEach((t) => { if (!tplOf(t)?.layout?.hasDays) (t.items || []).forEach((it) => { if (it.days != null) { it.days = null; cl = true; } }); })); if (cl) mark(); }

  const grandTotal = () => q.hnSheets.reduce((a, hs) => a + (hs.hnTables || []).reduce((b, t) => b + extraTableSum(t), 0), 0);
  const totalSheets = () => q.hnSheets.reduce((a, hs) => a + (hs.hnTables || []).length, 0);

  const save = async (thenSubmit: boolean) => {
    setSaving(true);
    try {
      await api.saveHn(q.id, q.hnSheets.map((hs) => ({ sheetId: hs.sheetId, hnTables: hs.hnTables || [] })));
      dirtyRef.current = false; (window as WinDirty).__editorDirty = false;
      if (thenSubmit) { await api.submitHn(q.id); toast("Đã gửi duyệt phần Hà Nội", "success"); }
      else toast("Đã lưu phần Hà Nội", "success");
      await load();
    } catch (ex) { toast(ex instanceof ApiError ? ex.message : "Lỗi lưu phần HN", "error"); }
    finally { setSaving(false); }
  };
  const submit = async () => { if (await confirmModal("Gửi duyệt phần Hà Nội", "Sau khi gửi sẽ KHÔNG sửa được cho tới khi quản lý duyệt / trả lại. Tiếp tục?", { confirmText: "Gửi duyệt" })) save(true); };

  return (
    <div className="account-hn-view ahn-card">
      <div className="ahn-head">
        <div className="ahn-head-titles"><h1 className="ahn-title">Phần Giá Hà Nội</h1>
          <div className="muted ahn-sub">{q.projectCode || q.quoteNumber || ""}{q.title ? " · " + q.title : ""}{q.companyName ? " · " + q.companyName : ""}</div></div>
        <span className={`ahn-status ahn-${hnStatus}`}>{STATUS[hnStatus] || "Đang làm"}</span>
      </div>
      {q.hnStatus === "rejected" && q.hnRejectNote && <div className="ahn-reject">↩ <strong>Quản lý trả lại:</strong> {q.hnRejectNote}</div>}
      <div className="muted" style={{ margin: "8px 0 4px" }}>Bạn chỉ điền <strong>giá Hà Nội</strong> (số nội bộ — KHÔNG xuất cho khách, không thấy phần báo giá khác).</div>

      {q.hnSheets.map((hs, si) => {
        if (!Array.isArray(hs.hnTables) || !hs.hnTables.length) hs.hnTables = [newHnTable()];
        hs.hnTables.forEach((t) => { if (t._k == null) t._k = nextK(); (t.items || []).forEach((it) => { if (it._k == null) it._k = nextK(); }); });
        let active = Number.isInteger(hs._activeHn) ? (hs._activeHn as number) : 0;
        if (active >= hs.hnTables.length) active = hs.hnTables.length - 1; if (active < 0) active = 0;
        hs._activeHn = active;
        const t = hs.hnTables[active];
        if (!t.templateId) t.templateId = defTplId;
        const tpl = tplOf(t);
        const usesDays = !!tpl?.layout?.hasDays, showDetail = !!tpl?.layout?.hasDetail, numberSubs = !!tpl?.layout?.numberSubsections;
        return (
          <div key={hs.sheetId ?? si} className="extra-cat-group" style={{ marginTop: 10 }}>
            <div className="extra-cat-grouphead">
              <span className="extra-cat-badge cat-hanoi">Báo Giá Hà Nội</span>
              {q.hnSheets.length > 1 && <span className="muted" style={{ fontSize: 12 }}>{hs.sheetName || `Sheet #${si + 1}`}</span>}
              {editable && <button type="button" className="btn btn-sm" onClick={() => { const cur = hs.hnTables[hs._activeHn || 0]; hs.hnTables.push(newHnTable(cur?.templateId)); hs._activeHn = hs.hnTables.length - 1; mark(); redraw(); }}>+ Thêm bảng</button>}
              <span className="muted" style={{ fontSize: 11.5 }}>{hs.hnTables.length} bảng</span>
            </div>
            <div className="sheet-tabs extra-sheet-tabs" role="tablist" aria-label="Các bảng giá Hà Nội">
              {hs.hnTables.map((tt, ti) => (
                <div key={tt._k ?? ti} className={`sheet-tab ${ti === active ? "active" : ""}`} role="tab" aria-selected={ti === active} tabIndex={0}
                  onClick={() => { hs._activeHn = ti; redraw(); }}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); hs._activeHn = ti; redraw(); } }}>
                  <span>{tt.name || `Bảng ${ti + 1}`}</span>
                  {editable && hs.hnTables.length > 1 && <span className="rm-tab" role="button" tabIndex={0} aria-label="Xoá bảng này" title="Xoá bảng này"
                    onClick={(e) => { e.stopPropagation(); void removeTable(hs, ti); }}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); void removeTable(hs, ti); } }}>✕</span>}
                </div>
              ))}
            </div>
            <div className="extra-table">
              <div className="extra-table-head" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", margin: "8px 0" }}>
                <input className="extra-name" value={t.name || ""} placeholder="Tên bảng (tuỳ chọn)" aria-label="Tên bảng Hà Nội" disabled={!editable} style={{ minWidth: 180 }} onChange={(e) => { t.name = e.target.value; mark(); redraw(); }} />
                {editable && <label className="muted" style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 5 }}>Mẫu: <select value={t.templateId || defTplId} onChange={(e) => { t.templateId = Number(e.target.value); mark(); redraw(); }}>{tplList.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>}
              </div>
              <GridTable key={`hn-${si}-${active}-${t.templateId}-${t._k}`} items={t.items} usesDays={usesDays} showDetail={showDetail} numberSubs={numberSubs}
                editable={editable} internalNote={false} groupSubtotal={!!t.groupSubtotal} onGroupSubtotal={(v) => { t.groupSubtotal = v; mark(); redraw(); }} onChange={() => { mark(); redraw(); }} />
              <div style={{ textAlign: "right", fontWeight: 600, margin: "6px 2px", fontSize: 13.5 }}>Tổng HN: <span style={{ color: "var(--danger)" }}>{M.fmtMoney(extraTableSum(t))}</span></div>
            </div>
          </div>
        );
      })}

      {totalSheets() > 1 && (
        <div className="ahn-grand-card"><span className="ahn-grand-label">Tổng tất cả {totalSheets()} sheet Hà Nội</span><span className="ahn-grand-val">{M.fmtMoney(grandTotal())}</span></div>
      )}

      <div className="ahn-actions" style={{ marginTop: 14 }}>
        {editable ? <>
          <button className="btn btn-sm" onClick={() => save(false)} disabled={saving}>💾 Lưu</button>
          <button className="btn btn-sm btn-primary" onClick={submit} disabled={saving}>✓ Gửi duyệt</button>
        </> : <span className="muted">{hnStatus === "submitted" ? "Đã gửi, chờ quản lý duyệt — không sửa được lúc này." : hnStatus === "approved" ? "Phần Hà Nội đã được duyệt." : ""}</span>}
      </div>
    </div>
  );
}
