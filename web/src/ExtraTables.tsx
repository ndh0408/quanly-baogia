import { useEffect, useState } from "react";
import * as M from "./quoteMath";
import { type ItemK, nextK } from "./gridShared";
import { GridTable } from "./GridTable";
import { api, ApiError, type EditorTemplate } from "./api";
import { toast } from "./ui";

// Port "Bảng nội bộ" (public/js/editor.js drawExtraTables). Mỗi LOẠI (HCM · HN · Phí KH) tách RIÊNG;
// mỗi loại có N sheet (lưới ĐẦY ĐỦ như báo giá: template/công thức/nhóm/copy-paste/undo — qua GridTable)
// nhưng KHÔNG xuất Excel. Tổng từng loại đổ riêng sang "Quản lý dự án" (HCM/Phí-KH chỉ cộng hàng ĐÃ DUYỆT).

const EXTRA_CATS: [string, string][] = [["hcm", "Chi Phí HCM"], ["hanoi", "Báo Giá Hà Nội"], ["khach", "Phí Khách Hàng"]];
const extraCatLabel = (c: string) => ({ hcm: "Chi Phí HCM", hanoi: "Báo Giá Hà Nội", khach: "Phí Khách Hàng" } as Record<string, string>)[c] || c;

export type ExtraTable = { category: string; templateId?: number; name?: string; groupSubtotal?: boolean; items: ItemK[]; _k?: number };
type Sheet = { id?: number; extraTables?: ExtraTable[]; _activeExtra?: number; templateId?: number };

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

export function ExtraTables({ sheet, templates, companyId, editable, canApprove, canPay, quoteId, onMarkDirty }: {
  sheet: Sheet; templates: EditorTemplate[]; companyId?: number; editable: boolean; canApprove: boolean;
  canPay?: boolean; quoteId?: number; onMarkDirty: () => void;
}) {
  const [, setTick] = useState(0);
  const redraw = () => setTick((t) => t + 1);
  const onChange = () => { onMarkDirty(); redraw(); };
  const [payRow, setPayRow] = useState<ItemK | null>(null); // hàng đang mở dialog thanh toán

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
              payCol canPay={!!canPay && !!quoteId}
              onPayRow={(it) => { if (!(it as Record<string, unknown>).rid) { toast("Lưu báo giá trước khi đánh dấu thanh toán", "error"); return; } setPayRow(it); }}
              groupSubtotal={!!t.groupSubtotal} onGroupSubtotal={(v) => { t.groupSubtotal = v; onChange(); }} onChange={onChange} />
          </div>
        ) : <div className="muted" style={{ padding: "6px 0 2px" }}>Chưa có sheet nội bộ — bấm “+ Thêm sheet” ở loại tương ứng phía trên.</div>}
      </div>
      {payRow && quoteId && sheet.id != null && (
        <ExtraPayDialog quoteId={quoteId} sheetId={sheet.id} item={payRow}
          onClose={() => setPayRow(null)}
          onSaved={(paid, hasProof) => { (payRow as Record<string, unknown>).paid = paid; (payRow as Record<string, unknown>).paidAt = paid ? new Date().toISOString() : null; (payRow as Record<string, unknown>).hasPaidProof = hasProof; setPayRow(null); redraw(); }} />
      )}
    </details>
  );
}

// Dialog tích "đã thanh toán" + up ẢNH chứng từ cho 1 HÀNG nội bộ (gọi API /pay — không lưu cả báo giá).
export function ExtraPayDialog({ quoteId, sheetId, item, onClose, onSaved }: {
  quoteId: number; sheetId: number; item: ItemK; onClose: () => void; onSaved: (paid: boolean, hasProof: boolean) => void;
}) {
  const it = item as Record<string, unknown>;
  const [paid, setPaid] = useState(!!it.paid);
  const [proof, setProof] = useState<string | null>(null);      // ảnh MỚI chọn
  const [existing, setExisting] = useState<string | null>(null); // ảnh đã có (fetch on-demand)
  const [saving, setSaving] = useState(false);
  const rid = String(it.rid);
  useEffect(() => { if (it.hasPaidProof) api.getExtraProof(quoteId, sheetId, rid).then((r) => setExisting(r.paidProof)).catch(() => {}); }, [quoteId, sheetId, rid, it.hasPaidProof]);
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (!/^image\/(png|jpe?g|webp)$/.test(f.type)) { toast("Chỉ nhận ảnh PNG/JPG/WEBP", "error"); return; }
    try { setProof(await compressImage(f)); } catch { toast("Không đọc được ảnh", "error"); }
  };
  const save = async () => {
    setSaving(true);
    try {
      await api.markExtraPay(quoteId, sheetId, rid, paid, paid && proof ? proof : (paid ? undefined : ""));
      toast("Đã lưu thanh toán", "success");
      onSaved(paid, paid ? (!!proof || !!existing) : false);
    } catch (ex) { toast(ex instanceof ApiError ? ex.message : "Lỗi", "error"); setSaving(false); }
  };
  const img = proof || existing;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-sm" role="dialog" aria-modal="true" aria-label="Thanh toán dòng nội bộ" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h3>Thanh toán: {String(it.name || "(dòng nội bộ)").slice(0, 60)}</h3><button className="x" onClick={onClose} aria-label="Đóng">✕</button></div>
        <div className="modal-body">
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
            <input type="checkbox" checked={paid} onChange={(e) => setPaid(e.target.checked)} />
            <span><strong>Đã thanh toán</strong> dòng này</span>
          </label>
          {paid && <div style={{ marginTop: 12 }}>
            <label className="muted" style={{ fontSize: 13 }}>Ảnh chứng từ (tuỳ chọn):</label>
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => onFile(e.target.files?.[0])} style={{ display: "block", marginTop: 5 }} />
            {img && <img src={img} alt="chứng từ" style={{ maxWidth: "100%", maxHeight: 240, marginTop: 8, borderRadius: 8, border: "1px solid var(--line)" }} />}
          </div>}
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>Hủy</button>
          <button className="btn btn-primary" disabled={saving} onClick={save}>{saving ? "Đang lưu…" : "Lưu"}</button>
        </div>
      </div>
    </div>
  );
}

// Nén ảnh client (≤1280px, JPEG 0.7) → base64 data URL (giống PaymentDialog nhân sự).
function compressImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const im = new Image();
      im.onload = () => {
        const max = 1280; let { width: w, height: h } = im;
        if (w > max || h > max) { const s = max / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s); }
        const c = document.createElement("canvas"); c.width = w; c.height = h;
        const ctx = c.getContext("2d"); if (!ctx) return reject(new Error("no ctx"));
        ctx.drawImage(im, 0, 0, w, h);
        resolve(c.toDataURL("image/jpeg", 0.7));
      };
      im.onerror = reject; im.src = String(r.result);
    };
    r.onerror = reject; r.readAsDataURL(file);
  });
}
