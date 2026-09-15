import { useState } from "react";
import * as M from "../lib/quoteMath";
import { type ItemK, nextK } from "../lib/gridShared";
import { GridTable } from "./GridTable";
import { type EditorTemplate } from "../lib/api";
import { confirmModal, toast } from "../lib/ui";
import { extraTableSum, removeTableFromList, ExtraPayDialog, type ExtraTable } from "./ExtraTables";

// KHÔNG GIAN LÀM VIỆC "BÁO GIÁ HÀ NỘI" — cấp BÁO GIÁ, không thuộc trang nào.
//
// Trước 2026-09-15 bảng HN nằm trong `QuoteSheet.extraTables` của từng trang, nên account Hà Nội
// phải làm việc bên trong cấu trúc trang của chủ báo giá: màn của họ lặp theo trang và in cả TÊN
// TRANG (lộ cấu trúc báo giá), lưu thì ghép theo `sheetId` mà mỗi lần chủ bấm Lưu là id đổi hết
// (lưu = xoá trang rồi tạo lại) → 409 "hãy tải lại trang", và chủ xoá một trang là bảng HN trên
// trang đó chết theo. Nay là `Quote.hnTables`: một danh sách phẳng của riêng họ.
//
// DÙNG CHUNG cho HAI màn — AccountHnView (người điền) và QuoteEditor (chủ báo giá xem/sửa) — cố ý:
// hai bên phải thấy ĐÚNG một thứ, và luật hiển thị/tính tổng không được có hai bản.
//
// Lưới là GridTable ĐẦY ĐỦ như lưới báo giá chính, kèm `fxBar` (thanh công thức). Trước đây chỉ
// lưới chính mới bật fxBar; phần HN là nơi người ta gõ giá nên cần đúng bộ Excel đó: công thức,
// copy/cắt/dán nhiều ô, fill-down, Ctrl+Z/Y, gõ tiếng Việt bằng IME.
export type HnTable = Omit<ExtraTable, "category"> & { category?: string };

export function HnTables({ tables, templates, companyId, editable, canApprove, canPay, quoteId, onMarkDirty, onQuoteTouched }: {
  /** Mảng bảng HN — MUTATE TẠI CHỖ, đúng quy ước state của editor (qRef giữ object, không copy). */
  tables: HnTable[];
  templates: EditorTemplate[];
  companyId?: number;
  editable: boolean;
  canApprove?: boolean;
  canPay?: boolean;
  quoteId?: number;
  onMarkDirty: () => void;
  /** Mốc `updatedAt` MỚI sau khi route /pay bump — màn gọi phải nhận để khỏi tự đâm 409 giả. */
  onQuoteTouched?: (updatedAt: string) => void;
}) {
  const [, setTick] = useState(0);
  const redraw = () => setTick((t) => t + 1);
  const onChange = () => { onMarkDirty(); redraw(); };
  const [payRow, setPayRow] = useState<ItemK | null>(null);
  const [active, setActive0] = useState(0);
  const setActive = (i: number) => { setActive0(i); redraw(); };

  tables.forEach((x) => { if (x._k == null) x._k = nextK(); (x.items || []).forEach((it) => { if (it._k == null) it._k = nextK(); }); });

  const tplList0 = templates.filter((t) => t.companyId === companyId);
  const tplList = tplList0.length ? tplList0 : templates;
  const defTplId = tplList[0]?.id;
  const tplOf = (t: HnTable) => templates.find((x) => x.id === (t.templateId || defTplId)) || tplList[0];

  // Dọn `days` cũ cho bảng dùng mẫu KHÔNG có cột Số Ngày — nếu không, tổng phồng lên vì
  // extraTableSum nhân thêm số ngày của dữ liệu cũ (đối xứng với ExtraTables).
  if (editable) {
    let cleaned = false;
    tables.forEach((x) => { if (!tplOf(x)?.layout?.hasDays) (x.items || []).forEach((it) => { if (it.days != null) { it.days = null; cleaned = true; } }); });
    if (cleaned) onMarkDirty();
  }

  let ai = active;
  if (ai >= tables.length) ai = tables.length - 1;
  if (ai < 0) ai = 0;
  const t = tables[ai] || null;
  const tpl = t ? tplOf(t) : null;
  const usesDays = !!tpl?.layout?.hasDays, showDetail = !!tpl?.layout?.hasDetail, numberSubs = !!tpl?.layout?.numberSubsections;
  const addrDetail = !!(tpl?.layout?.reserveDetail ?? tpl?.layout?.hasDetail);
  const tong = tables.reduce((a, x) => a + extraTableSum(x as ExtraTable), 0);

  const themBang = () => {
    const it = M.blankItem(false) as ItemK; it._k = nextK();
    tables.push({ templateId: t?.templateId || defTplId, name: "", groupSubtotal: true, items: [it], _k: nextK() });
    setActive(tables.length - 1);
    onChange();
  };
  const xoaBang = async (i: number) => {
    const r = await removeTableFromList(tables as ExtraTable[], i, ai, (tbl) => confirmModal(
      "Xoá sheet Hà Nội?",
      `Sheet "${tbl.name || `Bảng ${i + 1}`}" đã có dòng điền — xoá là mất luôn ngăn hoàn tác của lưới, Ctrl+Z không lấy lại được. Tiếp tục?`,
      { danger: true, confirmText: "Xoá" },
    ));
    if (!r.removed) return;
    setActive(r.active);
    onChange();
  };

  return (
    <div className="extra-cat-group" style={{ marginTop: 10 }}>
      <div className="extra-cat-grouphead">
        <span className="extra-cat-badge cat-hanoi">Báo Giá Hà Nội</span>
        <span className="extra-cat-total" data-cat="hanoi">Tổng: <strong>{M.fmtMoney(tong)}</strong> <span className="muted">→ Quản lý dự án</span></span>
        {editable && <button type="button" className="btn btn-sm extra-add-in" data-cat="hanoi" onClick={themBang}>+ Thêm sheet</button>}
        <span className="muted" style={{ fontSize: 11.5 }}>{tables.length} sheet</span>
      </div>

      {tables.length > 0 && (
        <div className="sheet-tabs extra-sheet-tabs" role="tablist" aria-label="Các sheet Hà Nội">
          {tables.map((tt, i) => (
            // Bàn phím: <div> trần không nhận tiêu điểm → người dùng bàn phím không đổi được sheet.
            // Dùng lại đúng khuôn của QuoteEditor: role + tabIndex + Enter/Space.
            <div key={tt._k ?? i} role="tab" tabIndex={0} aria-selected={i === ai}
              className={`sheet-tab ${i === ai ? "active" : ""}`}
              onClick={() => setActive(i)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setActive(i); } }}>
              <span>{tt.name || `Bảng ${i + 1}`}</span>
              {editable && tables.length > 1 && (
                <button type="button" className="rm-tab" title="Xoá sheet này" aria-label={`Xoá sheet Hà Nội ${i + 1}`}
                  onClick={(e) => { e.stopPropagation(); void xoaBang(i); }}
                  onKeyDown={(e) => e.stopPropagation()}>✕</button>
              )}
            </div>
          ))}
        </div>
      )}

      {t ? (
        <div className="extra-table extra-table-inline">
          <div className="extra-table-head" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", margin: "8px 0" }}>
            <input className="extra-name" defaultValue={t.name || ""} placeholder="Tên sheet (tuỳ chọn)" aria-label="Tên sheet Hà Nội" disabled={!editable}
              style={{ minWidth: 180 }} onInput={(e) => { t.name = (e.target as HTMLInputElement).value; onMarkDirty(); }} />
            {editable && (
              <label className="muted" style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 5 }}>Mẫu:
                <select value={t.templateId || defTplId} className="extra-tpl extra-add-cat" onChange={(e) => { t.templateId = Number(e.target.value); onChange(); }}>
                  {tplList.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
              </label>
            )}
          </div>
          <GridTable key={`hn-${ai}-${t.templateId}-${t._k}`} items={t.items} fxBar
            usesDays={usesDays} showDetail={showDetail} addrDetail={addrDetail} numberSubs={numberSubs}
            editable={editable} internalNote={false}
            approveCol={false} canApprove={!!canApprove}
            payCol canPay={!!canPay && !!quoteId}
            onPayRow={(it) => { if (!(it as Record<string, unknown>).rid) { toast("Lưu phần Hà Nội trước khi đánh dấu thanh toán", "error"); return; } setPayRow(it); }}
            groupSubtotal={!!t.groupSubtotal} onGroupSubtotal={(v) => { t.groupSubtotal = v; onChange(); }} onChange={onChange} />
          <div style={{ textAlign: "right", fontWeight: 600, margin: "6px 2px", fontSize: 13.5 }}>
            Tổng sheet này: <span style={{ color: "var(--danger)" }}>{M.fmtMoney(extraTableSum(t as ExtraTable))}</span>
          </div>
        </div>
      ) : (
        <div className="muted" style={{ padding: "6px 0 2px" }}>Chưa có sheet Hà Nội — bấm “+ Thêm sheet” phía trên.</div>
      )}

      {payRow && quoteId && (
        <ExtraPayDialog quoteId={quoteId} hn item={payRow} onClose={() => setPayRow(null)} onQuoteTouched={onQuoteTouched}
          onSaved={(paid, hasProof) => {
            const r = payRow as Record<string, unknown>;
            r.paid = paid; r.hasPaidProof = hasProof;
            if (!paid) { r.paidAt = null; r.paidById = null; }
            setPayRow(null); onChange();
          }} />
      )}
    </div>
  );
}
