import { useState } from "react";
import * as M from "./quoteMath";
import { type ItemK, nextK } from "./gridShared";
import { GridTable } from "./GridTable";
import type { EditorTemplate } from "./api";

// Port "Bảng nội bộ" (public/js/editor.js drawExtraTables). Mỗi LOẠI (HCM · HN · Phí KH) tách RIÊNG;
// mỗi loại có N sheet (lưới ĐẦY ĐỦ như báo giá: template/công thức/nhóm/copy-paste/undo — qua GridTable)
// nhưng KHÔNG xuất Excel. Tổng từng loại đổ riêng sang "Quản lý dự án" (HCM/Phí-KH chỉ cộng hàng ĐÃ DUYỆT).

const EXTRA_CATS: [string, string][] = [["hcm", "Chi Phí HCM"], ["hanoi", "Báo Giá Hà Nội"], ["khach", "Phí Khách Hàng"]];
const extraCatLabel = (c: string) => ({ hcm: "Chi Phí HCM", hanoi: "Báo Giá Hà Nội", khach: "Phí Khách Hàng" } as Record<string, string>)[c] || c;

export type ExtraTable = { category: string; templateId?: number; name?: string; groupSubtotal?: boolean; items: ItemK[]; _k?: number };
type Sheet = { extraTables?: ExtraTable[]; _activeExtra?: number; templateId?: number };

// Tổng 1 bảng nội bộ — KHỚP src/quoteUtils.js extraTableSum (số đổ sang Quản lý dự án): bỏ
// section/subsection/info; HCM/Phí-KH chỉ cộng hàng đã DUYỆT; qty×(days nếu>0)×price làm tròn từng dòng.
export function extraTableSum(t: ExtraTable): number {
  const approvedOnly = t && (t.category === "hcm" || t.category === "khach");
  return (t?.items || []).reduce((acc, it) => {
    if (it.kind === "section" || it.kind === "subsection" || it.kind === "info") return acc;
    if (approvedOnly && !it.approved) return acc;
    const qty = M.trunc2(it.quantity || 0), price = Number(it.unitPrice) || 0;
    const days = it.days != null ? Number(it.days) : null;
    return acc + Math.round(days && days > 0 ? qty * days * price : qty * price);
  }, 0);
}

export function ExtraTables({ sheet, templates, companyId, editable, canApprove, onMarkDirty }: {
  sheet: Sheet; templates: EditorTemplate[]; companyId?: number; editable: boolean; canApprove: boolean; onMarkDirty: () => void;
}) {
  const [, setTick] = useState(0);
  const redraw = () => setTick((t) => t + 1);
  const onChange = () => { onMarkDirty(); redraw(); };

  if (!Array.isArray(sheet.extraTables)) sheet.extraTables = [];
  const tables = sheet.extraTables;
  tables.forEach((x) => { if (x._k == null) x._k = nextK(); (x.items || []).forEach((it) => { if (it._k == null) it._k = nextK(); }); });

  const tplList0 = templates.filter((t) => t.companyId === companyId);
  const tplList = tplList0.length ? tplList0 : templates;
  const defTplId = tplList[0]?.id || sheet.templateId;
  const tplOf = (t: ExtraTable) => templates.find((x) => x.id === (t.templateId || defTplId)) || tplList[0];
  // Dọn 'days' cũ cho bảng có template KHÔNG có Số Ngày (giống drawExtraTables SPA) → tổng không phồng.
  if (editable) {
    let cleaned = false;
    tables.forEach((x) => { if (!tplOf(x)?.layout?.hasDays) (x.items || []).forEach((it) => { if (it.days != null) { it.days = null; cleaned = true; } }); });
    if (cleaned) onMarkDirty();
  }
  const catTotal = (cat: string) => tables.reduce((a, x) => a + (x?.category === cat ? extraTableSum(x) : 0), 0);

  let active = Number.isInteger(sheet._activeExtra) ? (sheet._activeExtra as number) : 0;
  if (active >= tables.length) active = tables.length - 1;
  if (active < 0) active = 0;
  sheet._activeExtra = active;
  const t = tables[active] || null;
  const tpl = t ? tplOf(t) : null;
  const showDetail = !!tpl?.layout?.hasDetail, usesDays = !!tpl?.layout?.hasDays, numberSubs = !!tpl?.layout?.numberSubsections;

  const addTable = (cat: string) => {
    const it = M.blankItem(false) as ItemK; it._k = nextK();
    tables.push({ category: cat, templateId: defTplId, name: "", groupSubtotal: true, items: [it], _k: nextK() });
    sheet._activeExtra = tables.length - 1; onChange();
  };
  const removeTable = (i: number) => {
    tables.splice(i, 1);
    let a = sheet._activeExtra || 0; if (a > i) a--; if (a >= tables.length) a = tables.length - 1; if (a < 0) a = 0;
    sheet._activeExtra = a; onChange();
  };

  return (
    <details className="extra-collapse">
      <summary className="extra-collapse-sum"><strong>Bảng nội bộ</strong> <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>— HCM {M.fmtMoney(catTotal("hcm"))} · HN {M.fmtMoney(catTotal("hanoi"))} · KH {M.fmtMoney(catTotal("khach"))} · {tables.length} sheet (bấm để mở)</span></summary>
      <div className="extra-tables-wrap">
        <div className="extra-head"><div><strong>Bảng nội bộ</strong> <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>— mỗi LOẠI (HCM · HN · Phí KH) tách RIÊNG; Tổng từng loại đổ riêng sang Quản lý dự án. Sheet đầy đủ như báo giá (template · công thức · nhóm · copy/paste) nhưng KHÔNG xuất Excel.</span></div></div>

        <div className="extra-cat-groups">
          {EXTRA_CATS.map(([cat, label]) => {
            const idxs: number[] = []; tables.forEach((x, i) => { if (x?.category === cat) idxs.push(i); });
            return (
              <div key={cat} className="extra-cat-group">
                <div className="extra-cat-grouphead">
                  <span className={`extra-cat-badge cat-${cat}`}>{label}</span>
                  <span className="extra-cat-total" data-cat={cat}>Tổng: <strong>{M.fmtMoney(catTotal(cat))}</strong> <span className="muted">→ Quản lý dự án</span></span>
                  {editable && <button type="button" className="btn btn-sm extra-add-in" data-cat={cat} onClick={() => addTable(cat)}>+ Thêm sheet</button>}
                  <span className="muted" style={{ fontSize: 11.5 }}>{idxs.length} sheet</span>
                </div>
                <div className="sheet-tabs extra-sheet-tabs">
                  {idxs.length ? idxs.map((i) => (
                    <div key={tables[i]._k ?? i} className={`sheet-tab ${i === active ? "active" : ""}`} title={label} onClick={() => { sheet._activeExtra = i; redraw(); }}>
                      <span>{tables[i].name || ("Bảng " + (i + 1))}</span>
                      {editable && <span className="rm-tab" title="Xoá sheet nội bộ này" onClick={(e) => { e.stopPropagation(); removeTable(i); }}>✕</span>}
                    </div>
                  )) : <span className="muted" style={{ fontSize: 12, padding: "3px 2px" }}>(chưa có — bấm “+ Thêm sheet”)</span>}
                </div>
              </div>
            );
          })}
        </div>

        {t ? (
          <div className="extra-table">
            <div className="extra-table-head" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", margin: "8px 0" }}>
              <span className={`extra-cat-badge cat-${t.category}`}>{extraCatLabel(t.category)}</span>
              {editable && <label className="muted" style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 5 }}>Loại: <select value={t.category} className="extra-cat-sel extra-add-cat" onChange={(e) => { t.category = e.target.value; onChange(); }}>{EXTRA_CATS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>}
              <input className="extra-name" defaultValue={t.name || ""} placeholder="Tên sheet (tuỳ chọn)" disabled={!editable} onInput={(e) => { t.name = (e.target as HTMLInputElement).value; onChange(); }} style={{ minWidth: 180 }} />
              {editable && <label className="muted" style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 5 }}>Mẫu: <select value={t.templateId || defTplId} className="extra-tpl extra-add-cat" onChange={(e) => { t.templateId = Number(e.target.value); onChange(); }}>{tplList.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>}
            </div>
            <GridTable key={`extra-${active}-${t.templateId}-${t._k}`} items={t.items}
              usesDays={usesDays} showDetail={showDetail} numberSubs={numberSubs} editable={editable} internalNote={false}
              approveCol={t.category === "hcm" || t.category === "khach"} canApprove={canApprove}
              groupSubtotal={!!t.groupSubtotal} onGroupSubtotal={(v) => { t.groupSubtotal = v; onChange(); }} onChange={onChange} />
          </div>
        ) : <div className="muted" style={{ padding: "6px 0 2px" }}>Chưa có sheet nội bộ — bấm “+ Thêm sheet” ở loại tương ứng phía trên.</div>}
      </div>
    </details>
  );
}
