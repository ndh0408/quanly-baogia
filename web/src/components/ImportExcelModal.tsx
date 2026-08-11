import { useMemo, useRef, useState } from "react";
import { api, ApiError, type ImportResult, type ImportedSheet } from "../lib/api";
import { toast, useEscClose } from "../lib/ui";
import * as M from "../lib/quoteMath";
import { toGridItems, diffItems, diffCounts, kindLabel, type DiffRow } from "../lib/importApply";

// Modal "Nhập từ Excel": chọn file khách gửi lại → app đọc file (server) → cho XEM app hiểu gì
// (cột nào là gì, nhóm/nhóm con, công thức) → đối chiếu TRƯỚC/SAU với sheet đang có → nạp vào lưới.
// Không ghi DB: nạp xong người dùng vẫn phải bấm Lưu (đi đúng đường lưu cũ + lưu phiên bản).

/** Trần dòng/sheet khi lưu — khớp sheetSchema (src/validators.ts) + MAX_ITEMS_PER_SHEET. */
const MAX_ROWS_PER_SHEET = 2000;

type TargetMode = "replace" | "append" | "skip";
type SheetPlan = { targetIndex: number; mode: TargetMode };

export type ImportApplyPayload = {
  /** Theo thứ tự sheet trong FILE — sheet nào bỏ qua thì không có mặt. */
  plans: { file: ImportedSheet; targetIndex: number; mode: TargetMode; items: M.Item[] }[];
  totals?: { vatPercent?: number | null; discount?: number | null };
};

export function ImportExcelModal({
  quoteId, sheets, usesDaysOf, addrDetailOf, onApply, onClose,
}: {
  quoteId?: number;
  /** Các sheet ĐANG CÓ trong báo giá (để chọn nạp vào đâu + đối chiếu trước/sau). */
  sheets: { name?: string | null; templateId?: number; items: M.Item[] }[];
  usesDaysOf: (templateId?: number) => boolean;
  addrDetailOf: (templateId?: number) => boolean;
  onApply: (payload: ImportApplyPayload) => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [res, setRes] = useState<ImportResult | null>(null);
  const [fileName, setFileName] = useState("");
  const [plans, setPlans] = useState<SheetPlan[]>([]);
  const [active, setActive] = useState(0);
  const [applyTotals, setApplyTotals] = useState(true);
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEscClose(onClose);

  // Memo hoá: `view` bên dưới chạy LCS so trước/sau — mảng mới mỗi lần render sẽ bắt tính lại vô ích.
  const usable = useMemo(() => (res?.sheets || []).filter((s) => !s.skipped), [res]);

  const pick = async (file: File | null | undefined) => {
    if (!file) return;
    if (!/\.xlsx?$/i.test(file.name)) { toast("Chỉ nhận file Excel .xlsx", "error"); return; }
    setBusy(true); setErr(""); setRes(null);
    try {
      const r = await api.importExcel(file, quoteId);
      const ok = r.sheets.filter((s) => !s.skipped);
      if (!ok.length) {
        setErr(r.warnings[0] || "Không tìm thấy bảng báo giá nào trong file này.");
        setRes(r); setFileName(file.name);
        return;
      }
      // Mặc định: sheet thứ n của file → sheet thứ n của báo giá, THAY toàn bộ hạng mục.
      setPlans(ok.map((_s, i) => ({ targetIndex: Math.min(i, sheets.length - 1), mode: "replace" as TargetMode })));
      setRes(r); setFileName(file.name); setActive(0);
    } catch (ex) {
      setErr(ex instanceof ApiError ? ex.message : "Không đọc được file");
    } finally { setBusy(false); }
  };

  // ── Dữ liệu xem trước cho sheet đang chọn ──
  const view = useMemo(() => {
    const fs = usable[active];
    const plan = plans[active];
    if (!fs || !plan) return null;
    const target = sheets[plan.targetIndex];
    const usesDays = usesDaysOf(target?.templateId);
    const addrDetail = addrDetailOf(target?.templateId);
    const before = target?.items || [];
    const baseRow = plan.mode === "append" ? before.length : 0;
    const conv = toGridItems(fs.items, { usesDays, addrDetail, baseRow });
    const after = plan.mode === "append" ? [...before, ...conv.items] : conv.items;
    const warnOf = (i: number) => {
      const k = plan.mode === "append" ? i - before.length : i;
      return k >= 0 ? fs.items[k]?.warn : undefined;
    };
    const rows = diffItems(before, after, usesDays, warnOf);
    return { fs, plan, target, usesDays, addrDetail, before, after, rows, counts: diffCounts(rows), dropped: conv.droppedFormulas };
  }, [usable, plans, active, sheets, usesDaysOf, addrDetailOf]);

  const setPlan = (i: number, patch: Partial<SheetPlan>) =>
    setPlans((p) => p.map((x, k) => (k === i ? { ...x, ...patch } : x)));

  // Hai sheet của file cùng trỏ vào MỘT sheet đích: sheet nạp sau sẽ đè sheet trước (chế độ Thay)
  // hoặc làm lệch dòng tham chiếu (chế độ Nối) → chặn ngay ở đây, không để nạp rồi mới phát hiện.
  const dupTargets = useMemo(() => {
    const seen = new Map<number, number>();
    const dup = new Set<number>();
    plans.forEach((p, i) => {
      if (!p || p.mode === "skip") return;
      if (seen.has(p.targetIndex)) { dup.add(seen.get(p.targetIndex)!); dup.add(i); }
      else seen.set(p.targetIndex, i);
    });
    return dup;
  }, [plans]);

  const apply = () => {
    if (dupTargets.size) { toast("Hai sheet của file đang nạp vào cùng một sheet — hãy chọn sheet đích khác nhau", "error"); return; }
    const out: ImportApplyPayload["plans"] = [];
    let totals: ImportApplyPayload["totals"];
    usable.forEach((fs, i) => {
      const plan = plans[i];
      if (!plan || plan.mode === "skip") return;
      const target = sheets[plan.targetIndex];
      const usesDays = usesDaysOf(target?.templateId);
      const addrDetail = addrDetailOf(target?.templateId);
      const baseRow = plan.mode === "append" ? (target?.items || []).length : 0;
      const conv = toGridItems(fs.items, { usesDays, addrDetail, baseRow });
      out.push({ file: fs, targetIndex: plan.targetIndex, mode: plan.mode, items: conv.items });
      // VAT/giảm giá lấy theo sheet ĐANG NẠP đầu tiên (không phải sheet đầu file — có thể bị bỏ qua).
      if (!totals && applyTotals && fs.totals) totals = { vatPercent: fs.totals.vatPercent ?? null, discount: fs.totals.discount ?? null };
    });
    if (!out.length) { toast("Chưa chọn sheet nào để nạp", "info"); return; }
    // Trần lưu của app (khớp sheetSchema server) — báo TRƯỚC khi nạp thay vì để lỗi lúc bấm Lưu.
    const over = out.find((p) => ((p.mode === "append" ? (sheets[p.targetIndex]?.items.length || 0) : 0) + p.items.length) > MAX_ROWS_PER_SHEET);
    if (over) { toast(`Sheet “${over.file.name}” vượt ${MAX_ROWS_PER_SHEET} dòng/sheet — hãy tách bớt sang sheet khác rồi nạp lại`, "error"); return; }
    onApply({ plans: out, totals });
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal modal-wide" role="dialog" aria-modal="true" aria-label="Nhập báo giá từ file Excel">
        <div className="modal-head">
          <h3>Nhập từ Excel {fileName && <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>· {fileName}</span>}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Đóng">✕</button>
        </div>

        <div className="modal-body">
          {!res && (
            <>
              <p className="muted" style={{ marginTop: 0 }}>
                Chọn file Excel khách gửi lại (bản bạn đã xuất rồi khách sửa, hoặc file báo giá bên ngoài).
                App tự hiểu <strong>cột nào là gì</strong>, <strong>nhóm / nhóm con / hàng con</strong> và <strong>công thức tham chiếu ô</strong> — không phải gõ lại hay copy-paste.
              </p>
              <div
                className={`import-drop${drag ? " drag" : ""}`}
                onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
                onDragLeave={() => setDrag(false)}
                onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files?.[0]); }}
                onClick={() => inputRef.current?.click()}
                role="button" tabIndex={0}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); inputRef.current?.click(); } }}
              >
                <div style={{ fontSize: 30, lineHeight: 1 }} aria-hidden>⬆</div>
                <div><strong>Kéo file .xlsx vào đây</strong> hoặc bấm để chọn</div>
                <div className="muted" style={{ fontSize: 12.5 }}>Tối đa 10 MB · chỉ định dạng .xlsx (file .xls cũ hãy mở Excel rồi “Lưu thành” .xlsx)</div>
              </div>
              <input ref={inputRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                style={{ display: "none" }} onChange={(e) => pick(e.target.files?.[0])} />
              {busy && <div className="skeleton-wrap" style={{ marginTop: 14 }}>{Array.from({ length: 4 }).map((_, i) => <div className="skeleton-row" key={i} />)}</div>}
            </>
          )}

          {err && <div className="err" style={{ marginTop: 12 }}>⚠ {err}</div>}

          {res && usable.length > 0 && (
            <>
              {/* 1. Sheet trong file → nạp vào đâu */}
              <h4 style={{ margin: "4px 0 8px" }}>1. Sheet trong file → nạp vào sheet nào</h4>
              <table className="list-table import-plan">
                <thead>
                  <tr>
                    <th scope="col">Sheet trong file</th>
                    <th scope="col">App đọc được</th>
                    <th scope="col">Nạp vào</th>
                    <th scope="col">Cách nạp</th>
                  </tr>
                </thead>
                <tbody>
                  {usable.map((s, i) => (
                    <tr key={s.index} className={i === active ? "qrow active" : "qrow"} onClick={() => setActive(i)}>
                      <td>
                        <strong>{s.name}</strong>
                        <div className="muted" style={{ fontSize: 12 }}>
                          Mẫu đoán: {s.templateName || "—"}{s.templateWhy ? ` (${s.templateWhy})` : ""}
                        </div>
                      </td>
                      <td className="nowrap">
                        {s.stats.items + s.stats.subs} hạng mục · {s.stats.sections} nhóm · {s.stats.subsections} nhóm con
                        {s.stats.formulas > 0 && <> · {s.stats.formulas} công thức</>}
                      </td>
                      <td>
                        <select value={plans[i]?.targetIndex ?? 0} disabled={plans[i]?.mode === "skip"}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => setPlan(i, { targetIndex: Number(e.target.value) })}>
                          {sheets.map((sh, k) => <option key={k} value={k}>{sh.name || `Sheet ${k + 1}`}</option>)}
                        </select>
                      </td>
                      <td>
                        <select value={plans[i]?.mode ?? "replace"} onClick={(e) => e.stopPropagation()}
                          onChange={(e) => setPlan(i, { mode: e.target.value as TargetMode })}>
                          <option value="replace">Thay toàn bộ hạng mục</option>
                          <option value="append">Nối vào cuối</option>
                          <option value="skip">Bỏ qua sheet này</option>
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {res.sheets.some((s) => s.skipped) && (
                <p className="muted" style={{ fontSize: 12.5, margin: "6px 0 0" }}>
                  Bỏ qua: {res.sheets.filter((s) => s.skipped).map((s) => `${s.name} (${s.skipped})`).join(" · ")}
                </p>
              )}

              {view && (
                <>
                  {/* 2. App hiểu cột nào là gì */}
                  <h4 style={{ margin: "18px 0 8px" }}>2. App hiểu file thế nào — sheet “{view.fs.name}”</h4>
                  <div className="import-cols">
                    {Object.entries(view.fs.columns || {}).map(([role, col]) => (
                      <span className="import-col-chip" key={role}>
                        <b>{col}</b> → {COL_VN[role] || role}
                      </span>
                    ))}
                    <span className="muted" style={{ fontSize: 12.5, alignSelf: "center" }}>
                      (hàng tiêu đề: dòng {view.fs.headerRow} · bảng: dòng {view.fs.firstRow}–{view.fs.lastRow})
                    </span>
                  </div>
                  {view.fs.totals && (
                    <p className="muted" style={{ fontSize: 12.5, margin: "8px 0 0" }}>
                      Khối tổng trong file: Tổng cộng {M.fmtMoney(view.fs.totals.subtotal)}
                      {view.fs.totals.vatPercent != null && <> · VAT {view.fs.totals.vatPercent}%</>}
                      {!!view.fs.totals.discount && <> · Giảm giá {M.fmtMoney(view.fs.totals.discount)}</>}
                      {view.fs.totals.total != null && <> · Thành tiền {M.fmtMoney(view.fs.totals.total)}</>}
                    </p>
                  )}
                  {(view.fs.warnings.length > 0 || view.dropped > 0) && (
                    <ul className="import-warn">
                      {view.fs.warnings.map((w, i) => <li key={i}>{w}</li>)}
                      {view.dropped > 0 && <li>{view.dropped} công thức không hợp với mẫu của sheet đích (thiếu cột) — đã giữ con số.</li>}
                    </ul>
                  )}

                  {/* 3. Trước / sau */}
                  <h4 style={{ margin: "18px 0 8px" }}>
                    3. Trước / sau khi nạp vào “{view.target?.name || `Sheet ${(view.plan.targetIndex ?? 0) + 1}`}”
                  </h4>
                  <div className="import-summary">
                    <span className="import-badge same">{view.counts.same} giữ nguyên</span>
                    <span className="import-badge changed">{view.counts.changed} đổi</span>
                    <span className="import-badge added">{view.counts.added} thêm</span>
                    <span className="import-badge removed">{view.counts.removed} mất</span>
                    <span className="muted" style={{ marginLeft: "auto", fontSize: 13 }}>
                      Tổng sheet: {M.fmtMoney(M.sheetSubtotalGrouped(view.before, view.usesDays, !!view.fs.groupSubtotal))}
                      {" → "}
                      <strong>{M.fmtMoney(M.sheetSubtotalGrouped(view.after, view.usesDays, !!view.fs.groupSubtotal))}</strong>
                    </span>
                  </div>
                  <div className="import-diff-wrap">
                    <table className="list-table import-diff">
                      <thead>
                        <tr>
                          <th scope="col" style={{ width: 92 }}>Thay đổi</th>
                          <th scope="col" style={{ width: 84 }}>Loại</th>
                          <th scope="col">Hạng mục</th>
                          <th scope="col">Chi tiết thay đổi</th>
                        </tr>
                      </thead>
                      <tbody>
                        {view.rows.map((r, i) => <DiffRowView key={i} row={r} />)}
                      </tbody>
                    </table>
                  </div>

                  {view.fs.totals && (view.fs.totals.vatPercent != null || view.fs.totals.discount != null) && (
                    <label className="toggle-totals" style={{ display: "inline-flex", alignItems: "center", gap: 8, marginTop: 10, fontSize: 13.5, cursor: "pointer" }}>
                      <input type="checkbox" checked={applyTotals} onChange={(e) => setApplyTotals(e.target.checked)} />
                      <span>
                        Lấy luôn <strong>VAT {view.fs.totals.vatPercent ?? "—"}%</strong>
                        {!!view.fs.totals.discount && <> và <strong>giảm giá {M.fmtMoney(view.fs.totals.discount)}</strong></>} theo file
                      </span>
                    </label>
                  )}
                </>
              )}
            </>
          )}
        </div>

        <div className="modal-foot">
          {res && usable.length > 0 && (
            <span className="muted" style={{ marginRight: "auto", fontSize: 12.5 }}>
              Nạp xong nhớ bấm <strong>Lưu</strong> — trước khi lưu vẫn hoàn tác được (Ctrl+Z).
            </span>
          )}
          <button className="btn" onClick={onClose}>Hủy</button>
          {res && usable.length > 0 && <button className="btn btn-primary" onClick={apply}>Nạp vào báo giá</button>}
          {res && !usable.length && <button className="btn" onClick={() => { setRes(null); setErr(""); }}>Chọn file khác</button>}
        </div>
      </div>
    </div>
  );
}

const COL_VN: Record<string, string> = {
  _stt: "STT", name: "Hạng mục", detail: "Chi tiết", unit: "ĐVT", quantity: "Số lượng",
  days: "Số ngày", unitPrice: "Đơn giá", _amount: "Thành tiền", notes: "Ghi chú",
  internalNote: "Ghi chú nội bộ", _images: "Hình ảnh",
};
const CHANGE_VN: Record<string, string> = { same: "Giữ nguyên", changed: "Đổi", added: "Thêm mới", removed: "Bị bỏ" };

function fmtVal(field: string, v: unknown) {
  if (v == null || v === "") return "—";
  if (field === "quantity" || field === "days") return M.fmtNumCell(Number(v));
  if (field === "unitPrice") return M.fmtMoney(Number(v));
  return String(v);
}

function DiffRowView({ row }: { row: DiffRow }) {
  return (
    <tr className={`import-row ${row.kind}`}>
      <td className="nowrap"><span className={`import-badge ${row.kind}`}>{CHANGE_VN[row.kind]}</span></td>
      <td className="nowrap muted">{kindLabel(row.itemKind)}</td>
      <td>{row.name || <span className="muted">(hàng con)</span>}</td>
      <td>
        {row.fields.length === 0 && row.kind === "same" && <span className="muted">—</span>}
        {row.fields.map((f) => (
          <div key={f.field} style={{ fontSize: 13 }}>
            {f.label}: <span className="txt-danger">{fmtVal(f.field, f.before)}</span>
            {" → "}
            <span className="txt-ok"><strong>{fmtVal(f.field, f.after)}</strong></span>
          </div>
        ))}
        {row.warn?.map((w, i) => <div key={i} className="import-rowwarn">⚠ {w}</div>)}
      </td>
    </tr>
  );
}
