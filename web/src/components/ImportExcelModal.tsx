import { useMemo, useRef, useState } from "react";
import { api, ApiError, type EditorTemplate, type ImportResult, type ImportedSheet } from "../lib/api";
import { confirmModal, toast, useEscClose } from "../lib/ui";
import * as M from "../lib/quoteMath";
import { addrFields, autoTargetIndexes, letterOfField, NEW_IMPORT_SHEET, toGridItems, diffItems, diffCounts, kindLabel, type DiffRow } from "../lib/importApply";

// Modal "Nhập từ Excel": chọn file khách gửi lại → app đọc file (server) → cho XEM app hiểu gì
// (cột nào là gì, nhóm/nhóm con, công thức) → đối chiếu TRƯỚC/SAU với sheet đang có → nạp vào lưới.
// Không ghi DB: nạp xong người dùng vẫn phải bấm Lưu (đi đúng đường lưu cũ + lưu phiên bản).

/** Trần dòng/sheet khi lưu — khớp sheetSchema (src/validators.ts) + MAX_ITEMS_PER_SHEET. */
// Trần LƯU của server (validators.ts: items.max(500)). Trước đây modal cho qua tới 2000 dòng, người
// dùng nạp xong mới ăn lỗi 400 lúc bấm Lưu — mất công đối chiếu cả file. Chặn sớm, nói rõ con số.
const MAX_ROWS_PER_SHEET = 500;

type TargetMode = "replace" | "append" | "skip";
/** targetIndex = NEW_SHEET → tạo THÊM sheet mới trong báo giá (file nhiều sheet hơn báo giá). */
export const NEW_SHEET = NEW_IMPORT_SHEET;
type SheetPlan = { targetIndex: number; mode: TargetMode };

export type ImportApplyPayload = {
  /** Theo thứ tự sheet trong FILE — sheet nào bỏ qua thì không có mặt. */
  plans: { file: ImportedSheet; targetIndex: number; mode: TargetMode; templateId?: number; items: M.Item[] }[];
  /** Sheet đang có nhưng không xuất hiện trong file và người dùng chọn xóa. */
  removeTargetIndexes?: number[];
  totals?: { vatPercent?: number | null; discount?: number | null };
};

export function ImportExcelModal({
  quoteId, sheets, templates, usesDaysOf, addrDetailOf, newSheetTemplateId, onApply, onClose,
}: {
  quoteId?: number;
  /** Các sheet ĐANG CÓ trong báo giá (để chọn nạp vào đâu + đối chiếu trước/sau). */
  sheets: { name?: string | null; templateId?: number; groupSubtotal?: boolean; items: M.Item[] }[];
  templates: EditorTemplate[];
  usesDaysOf: (templateId?: number) => boolean;
  addrDetailOf: (templateId?: number) => boolean;
  /** Mẫu sẽ dùng cho SHEET MỚI, suy từ mẫu app đoán được của file (không đoán ra thì lấy mẫu sheet đang mở). */
  newSheetTemplateId: (fileTemplateCode?: string | null) => number | undefined;
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
  const [showSame, setShowSame] = useState(false);
  const [removeTargets, setRemoveTargets] = useState<number[]>([]);
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
      // Ghép theo đúng template của từng sheet trong file. Không ghép mù theo vị trí vì file có thể
      // xếp [Banner, Banner, Booth] còn báo giá đang xếp [Backdrop, Banner, Banner].
      const targets = autoTargetIndexes(ok, sheets, templates);
      setPlans(ok.map((_s, i) => ({ targetIndex: targets[i], mode: "replace" as TargetMode })));
      setRes(r); setFileName(file.name); setActive(0); setShowSame(false); setRemoveTargets([]);
    } catch (ex) {
      setErr(ex instanceof ApiError ? ex.message : "Không đọc được file");
    } finally { setBusy(false); }
  };

  // ── Dữ liệu xem trước cho sheet đang chọn ──
  const view = useMemo(() => {
    const fs = usable[active];
    const plan = plans[active];
    if (!fs || !plan) return null;
    const isNew = plan.targetIndex === NEW_SHEET;
    const tplId = isNew ? newSheetTemplateId(fs.templateCode) : sheets[plan.targetIndex]?.templateId;
    const target = isNew ? null : sheets[plan.targetIndex];
    const targetTemplate = templates.find((t) => t.id === tplId);
    const usesDays = usesDaysOf(tplId);
    const addrDetail = addrDetailOf(tplId);
    const gridFields = addrFields({ usesDays, addrDetail });
    const columnMoves = Object.entries(fs.columns || {}).map(([role, source]) => ({
      role, source, target: letterOfField(gridFields, role),
    })).filter((x) => x.target && x.role !== "detail");
    const before = target?.items || [];
    const baseRow = plan.mode === "append" ? before.length : 0;
    const conv = toGridItems(fs.items, { usesDays, addrDetail, baseRow });
    const after = plan.mode === "append" ? [...before, ...conv.items] : conv.items;
    const beforeTotal = M.sheetSubtotalGrouped(before, usesDays, !!target?.groupSubtotal);
    const effectiveGroupSubtotal = plan.mode === "append" ? !!target?.groupSubtotal : !!fs.groupSubtotal;
    const afterTotal = M.sheetSubtotalGrouped(after, usesDays, effectiveGroupSubtotal);
    const importedTotal = M.sheetSubtotalGrouped(conv.items, usesDays, !!fs.groupSubtotal);
    const fileTotal = fs.totals?.subtotal ?? null;
    const moneyDelta = fileTotal == null ? null : importedTotal - fileTotal;
    const moneyMismatch = moneyDelta != null && Math.abs(moneyDelta) > Math.max(2, Math.abs(fileTotal || 0) * 0.005);
    const formulaDropped = fs.stats.formulasDropped + conv.droppedFormulas;
    const rowWarnings = fs.items.reduce((n, it) => n + (it.warn?.length || 0), 0);
    const warnOf = (i: number) => {
      const k = plan.mode === "append" ? i - before.length : i;
      return k >= 0 ? fs.items[k]?.warn : undefined;
    };
    const rows = diffItems(before, after, usesDays, warnOf);
    const templateMismatch = !!fs.templateCode && !!targetTemplate?.code && fs.templateCode !== targetTemplate.code;
    return {
      fs, plan, target, targetTemplate, templateMismatch, isNew, usesDays, addrDetail, columnMoves,
      before, after, beforeTotal, afterTotal, importedTotal, fileTotal, moneyDelta, moneyMismatch,
      formulaDropped, rowWarnings, rows, counts: diffCounts(rows), dropped: conv.droppedFormulas,
    };
  }, [usable, plans, active, sheets, templates, usesDaysOf, addrDetailOf, newSheetTemplateId]);

  const previewRows = view ? (showSame ? view.rows : view.rows.filter((r) => r.kind !== "same")) : [];

  const setPlan = (i: number, patch: Partial<SheetPlan>) =>
    setPlans((p) => p.map((x, k) => (k === i ? { ...x, ...patch } : x)));

  // Hai sheet của file cùng trỏ vào MỘT sheet đích: sheet nạp sau sẽ đè sheet trước (chế độ Thay)
  // hoặc làm lệch dòng tham chiếu (chế độ Nối) → chặn ngay ở đây, không để nạp rồi mới phát hiện.
  const dupTargets = useMemo(() => {
    const seen = new Map<number, number>();
    const dup = new Set<number>();
    plans.forEach((p, i) => {
      if (!p || p.mode === "skip" || p.targetIndex === NEW_SHEET) return;
      if (seen.has(p.targetIndex)) { dup.add(seen.get(p.targetIndex)!); dup.add(i); }
      else seen.set(p.targetIndex, i);
    });
    return dup;
  }, [plans]);

  const matchedTargets = useMemo(() => new Set(plans
    .filter((p) => p && p.mode !== "skip" && p.targetIndex !== NEW_SHEET)
    .map((p) => p.targetIndex)), [plans]);
  const unmatchedTargets = useMemo(() => sheets.map((_s, i) => i).filter((i) => !matchedTargets.has(i)), [sheets, matchedTargets]);

  const apply = async () => {
    if (dupTargets.size) { toast("Hai sheet của file đang nạp vào cùng một sheet — hãy chọn sheet đích khác nhau", "error"); return; }
    const effectiveRemovals = removeTargets.filter((i) => unmatchedTargets.includes(i));
    const out: ImportApplyPayload["plans"] = [];
    let totals: ImportApplyPayload["totals"];
    let moneyRisk = 0, formulaRisk = 0, templateRisk = 0, rowRisk = 0, sheetRisk = 0;
    usable.forEach((fs, i) => {
      const plan = plans[i];
      if (!plan || plan.mode === "skip") return;
      const isNew = plan.targetIndex === NEW_SHEET;
      const tplId = isNew ? newSheetTemplateId(fs.templateCode) : sheets[plan.targetIndex]?.templateId;
      const target = isNew ? null : sheets[plan.targetIndex];
      const usesDays = usesDaysOf(tplId);
      const addrDetail = addrDetailOf(tplId);
      const baseRow = !isNew && plan.mode === "append" ? (target?.items || []).length : 0;
      const conv = toGridItems(fs.items, { usesDays, addrDetail, baseRow });
      out.push({ file: fs, targetIndex: plan.targetIndex, mode: plan.mode, templateId: tplId, items: conv.items });
      const targetTemplate = templates.find((t) => t.id === tplId);
      if (fs.templateCode && targetTemplate?.code && fs.templateCode !== targetTemplate.code) templateRisk++;
      formulaRisk += fs.stats.formulasDropped + conv.droppedFormulas;
      rowRisk += fs.items.reduce((n, it) => n + (it.warn?.length || 0), 0);
      sheetRisk += fs.warnings.length;
      if (fs.totals?.subtotal != null) {
        const importedTotal = M.sheetSubtotalGrouped(conv.items, usesDays, !!fs.groupSubtotal);
        const delta = importedTotal - fs.totals.subtotal;
        if (Math.abs(delta) > Math.max(2, Math.abs(fs.totals.subtotal) * 0.005)) moneyRisk++;
      }
      // VAT/giảm giá lấy theo sheet ĐANG NẠP đầu tiên (không phải sheet đầu file — có thể bị bỏ qua).
      if (!totals && applyTotals && fs.totals) totals = { vatPercent: fs.totals.vatPercent ?? null, discount: fs.totals.discount ?? null };
    });
    if (!out.length) { toast("Chưa chọn sheet nào để nạp", "info"); return; }
    // Trần lưu của app (khớp sheetSchema server) — báo TRƯỚC khi nạp thay vì để lỗi lúc bấm Lưu.
    const over = out.find((p) => ((p.mode === "append" && p.targetIndex !== NEW_SHEET ? (sheets[p.targetIndex]?.items.length || 0) : 0) + p.items.length) > MAX_ROWS_PER_SHEET);
    if (over) { toast(`Sheet “${over.file.name}” vượt ${MAX_ROWS_PER_SHEET} dòng/sheet (giới hạn lưu của hệ thống) — hãy tách bớt sang sheet khác rồi nạp lại`, "error"); return; }
    const risks = [
      moneyRisk ? `${moneyRisk} sheet có tổng sau nạp khác tổng trong Excel` : "",
      formulaRisk ? `${formulaRisk} công thức chỉ giữ được con số` : "",
      templateRisk ? `${templateRisk} sheet đang chọn khác mẫu của file` : "",
      rowRisk ? `${rowRisk} cảnh báo ở các dòng` : "",
      sheetRisk ? `${sheetRisk} cảnh báo chung của sheet` : "",
      effectiveRemovals.length ? `${effectiveRemovals.length} sheet hiện có sẽ bị xóa` : "",
    ].filter(Boolean);
    if (risks.length && !(await confirmModal(
      "Nạp khi vẫn còn điểm cần kiểm tra?",
      `${risks.join("; ")}. Dữ liệu mới chỉ vào màn hình và chưa lưu vào hệ thống. Bạn nên xem kỹ các dòng màu vàng trước khi tiếp tục.`,
      { danger: true, confirmText: "Vẫn nạp để kiểm tra" },
    ))) return;
    if (sheets.length - effectiveRemovals.length + out.filter((p) => p.targetIndex === NEW_SHEET).length <= 0) {
      toast("Báo giá phải còn ít nhất một sheet", "error"); return;
    }
    onApply({ plans: out, removeTargetIndexes: effectiveRemovals, totals });
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal modal-wide import-modal" role="dialog" aria-modal="true" aria-label="Nhập báo giá từ file Excel">
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
              <div className="import-plan-wrap">
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
                        <div className="muted import-tpl" style={{ fontSize: 12 }} title={s.templateWhy ? `Vì: ${s.templateWhy}` : undefined}>
                          Dạng file: {s.templateName || "chưa xác định"}
                        </div>
                      </td>
                      <td>
                        {s.stats.items + s.stats.subs} hạng mục · {s.stats.sections} nhóm chính · {s.stats.subsections} nhóm phụ
                        {s.stats.formulas > 0 && <> · giữ {s.stats.formulas} công thức</>}
                      </td>
                      <td>
                        <select value={plans[i]?.targetIndex ?? 0} disabled={plans[i]?.mode === "skip"}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => {
                            const targetIndex = Number(e.target.value);
                            setPlan(i, { targetIndex, ...(targetIndex === NEW_SHEET ? { mode: "replace" as TargetMode } : {}) });
                          }}>
                          {sheets.map((sh, k) => {
                            const t = templates.find((x) => x.id === sh.templateId);
                            return <option key={k} value={k}>{sh.name || `Sheet ${k + 1}`}{t?.name ? ` · ${t.name}` : ""}</option>;
                          })}
                          <option value={NEW_SHEET}>＋ Thêm sheet mới</option>
                        </select>
                      </td>
                      <td>
                        <select value={plans[i]?.mode ?? "replace"} onClick={(e) => e.stopPropagation()}
                          onChange={(e) => setPlan(i, { mode: e.target.value as TargetMode })}>
                          {plans[i]?.targetIndex === NEW_SHEET
                            ? <option value="replace">Tạo sheet mới</option>
                            : <><option value="replace">Thay toàn bộ</option><option value="append">Nối vào cuối</option></>}
                          <option value="skip">Bỏ qua</option>
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
              {res.sheets.some((s) => s.skipped) && (
                <p className="muted" style={{ fontSize: 12.5, margin: "6px 0 0" }}>
                  Bỏ qua: {res.sheets.filter((s) => s.skipped).map((s) => `${s.name} (${s.skipped})`).join(" · ")}
                </p>
              )}
              {unmatchedTargets.length > 0 && <div className="import-unmatched">
                <h4>Sheet đang có nhưng không thấy trong file</h4>
                <p className="muted">App mặc định giữ lại để tránh mất dữ liệu. Chỉ chọn xóa khi bạn muốn báo giá khớp hoàn toàn với danh sách sheet trong Excel.</p>
                {unmatchedTargets.map((i) => {
                  const sh = sheets[i]; const tpl = templates.find((t) => t.id === sh.templateId);
                  const remove = removeTargets.includes(i);
                  return <div className="import-unmatched-row" key={i}>
                    <span><strong>{sh.name || `Sheet ${i + 1}`}</strong>{tpl?.name && <small>{tpl.name}</small>}</span>
                    <select value={remove ? "remove" : "keep"} onChange={(e) => setRemoveTargets((cur) => e.target.value === "remove" ? [...new Set([...cur, i])] : cur.filter((x) => x !== i))}>
                      <option value="keep">Giữ lại trong báo giá</option>
                      <option value="remove">Xóa khi nạp</option>
                    </select>
                  </div>;
                })}
              </div>}

              {view && (
                <>
                  <h4 style={{ margin: "18px 0 8px" }}>2. Kiểm tra app đã hiểu đúng chưa — “{view.fs.name}”</h4>
                  <div className="import-check-grid">
                    <div className="import-check-card">
                      <span>Cấu trúc dòng</span>
                      <strong>{view.fs.stats.sections} nhóm chính · {view.fs.stats.subsections} nhóm phụ · {view.fs.stats.items + view.fs.stats.subs} hạng mục</strong>
                      <small>{view.fs.groupSubtotal ? "Có tính tổng và hệ số theo nhóm" : "Cộng trực tiếp từng hạng mục"}</small>
                    </div>
                    <div className={`import-check-card ${view.formulaDropped ? "warn" : "ok"}`}>
                      <span>Công thức Excel</span>
                      <strong>{view.formulaDropped
                        ? `Giữ ${view.fs.stats.formulas} · ${view.formulaDropped} chỉ giữ số`
                        : view.fs.stats.formulas ? `Giữ đủ ${view.fs.stats.formulas} công thức` : "File không có công thức"}</strong>
                      <small>{view.formulaDropped ? "Không tạo công thức sai; xem cảnh báo từng dòng" : view.fs.stats.formulas ? "Đã đổi sang đúng cột của web" : "Các ô số sẽ được nạp như giá trị thường"}</small>
                    </div>
                    <div className={`import-check-card ${view.moneyMismatch ? "danger" : view.fileTotal != null ? "ok" : ""}`}>
                      <span>Đối chiếu tiền</span>
                      <strong>{view.fileTotal == null
                        ? `Sau nạp: ${M.fmtMoney(view.importedTotal)}`
                        : view.moneyMismatch
                          ? `Lệch ${view.moneyDelta! > 0 ? "+" : ""}${M.fmtMoney(view.moneyDelta)}`
                          : `Khớp ${M.fmtMoney(view.fileTotal)}`}</strong>
                      <small>{view.fileTotal == null ? "Không tìm thấy dòng Tổng cộng trong file" : `Excel ${M.fmtMoney(view.fileTotal)} · sau nạp ${M.fmtMoney(view.importedTotal)}`}</small>
                    </div>
                  </div>
                  {(view.fs.warnings.length > 0 || view.dropped > 0 || view.templateMismatch || view.moneyMismatch || view.rowWarnings > 0) && (
                    <ul className="import-warn">
                      {view.templateMismatch && <li>
                        Bạn đang đưa file dạng <strong>{view.fs.templateName || view.fs.templateCode}</strong> vào sheet dùng <strong>{view.targetTemplate?.name}</strong>. Hãy chọn đúng sheet đích để nhóm và số thứ tự không đổi kiểu.
                      </li>}
                      {view.moneyMismatch && <li><strong>Tổng tiền chưa khớp:</strong> Excel là {M.fmtMoney(view.fileTotal)}, sau nạp là {M.fmtMoney(view.importedTotal)}. Xem các dòng màu vàng trước khi nạp.</li>}
                      {view.rowWarnings > 0 && <li>{view.rowWarnings} điểm cần kiểm tra nằm ngay tại từng dòng bên dưới.</li>}
                      {view.fs.warnings.map((w, i) => <li key={i}>{w}</li>)}
                      {view.dropped > 0 && <li>{view.dropped} công thức dùng cột không có trong sheet đích. App giữ nguyên con số đang thấy, không tạo công thức sai.</li>}
                    </ul>
                  )}

                  <details className="import-tech-details">
                    <summary>Xem cách app ghép cột và đổi công thức</summary>
                    <div className="import-cols" style={{ marginTop: 8 }}>
                      {view.columnMoves.map(({ role, source, target }) => (
                        <span className="import-col-chip" key={role}>
                          <b>{source} → {target}</b> · {COL_VN[role] || role}
                        </span>
                      ))}
                    </div>
                    <p className="muted" style={{ fontSize: 12.5, margin: "7px 0 0" }}>
                      Excel dùng dòng {view.fs.headerRow} làm tiêu đề, dữ liệu từ dòng {view.fs.firstRow} đến {view.fs.lastRow}. Công thức được đổi theo tên cột và dòng hạng mục, không chép nguyên chữ cột Excel.
                    </p>
                  </details>

                  <h4 style={{ margin: "18px 0 8px" }}>
                    3. Những gì sẽ thay đổi trong {view.isNew ? <>sheet mới “{view.fs.name}”</> : <>“{view.target?.name || `Sheet ${(view.plan.targetIndex ?? 0) + 1}`}”</>}
                  </h4>
                  {view.plan.mode === "skip" && <div className="import-empty-change" style={{ marginBottom: 8 }}>
                    Sheet này đang chọn <strong>Bỏ qua</strong>, nên các dòng bên dưới chỉ để xem và sẽ không được nạp.
                  </div>}
                  <div className="import-summary">
                    <span className="import-badge changed">{view.counts.changed} dòng sẽ sửa</span>
                    <span className="import-badge added">{view.counts.added} dòng sẽ thêm</span>
                    <span className="import-badge removed">{view.counts.removed} dòng sẽ xóa</span>
                    <span className="muted" style={{ marginLeft: "auto", fontSize: 13 }}>
                      Tổng hiện tại: {M.fmtMoney(view.beforeTotal)} → <strong>{M.fmtMoney(view.afterTotal)}</strong>
                    </span>
                  </div>
                  {view.counts.same > 0 && <label className="import-show-same">
                    <input type="checkbox" checked={showSame} onChange={(e) => setShowSame(e.target.checked)} />
                    Hiện thêm {view.counts.same} dòng không thay đổi
                  </label>}
                  {previewRows.length > 0 ? <div className="import-diff-wrap">
                    <table className="list-table import-diff">
                      <thead><tr>
                        <th scope="col" style={{ width: 102 }}>Sẽ làm gì</th>
                        <th scope="col" style={{ width: 96 }}>App hiểu là</th>
                        <th scope="col">Tên dòng trong Excel</th>
                        <th scope="col">Số liệu và thay đổi</th>
                      </tr></thead>
                      <tbody>{previewRows.map((r, i) => <DiffRowView key={`${r.kind}-${r.beforeNo}-${r.afterNo}-${i}`} row={r} />)}</tbody>
                    </table>
                  </div> : <div className="import-empty-change">Không có dòng nào thay đổi. Bật “Hiện dòng không thay đổi” nếu muốn đối chiếu toàn bộ.</div>}

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
          {res && usable.length > 0 && <button className="btn btn-primary" onClick={apply}>Nạp các thay đổi này</button>}
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
const CHANGE_VN: Record<string, string> = { same: "Không đổi", changed: "Sẽ sửa", added: "Sẽ thêm", removed: "Sẽ xóa" };

function fmtVal(field: string, v: unknown, exact = false) {
  if (v == null || v === "") return "—";
  if (field === "quantityExact") return v ? "Giữ số chính xác theo Excel" : "Làm tròn 1 số lẻ";
  if (field === "quantity" || field === "days") return M.fmtNumCell(Number(v), field === "quantity" && exact);
  if (field === "unitPrice") return M.fmtMoney(Number(v));
  return String(v);
}

function ItemPreview({ item }: { item?: M.Item }) {
  if (!item) return null;
  const parts: string[] = [];
  if (item.unit) parts.push(`ĐVT ${item.unit}`);
  if (Number(item.quantity)) parts.push(`SL ${M.fmtNumCell(item.quantity, !!item.quantityExact)}`);
  if (item.days != null && Number(item.days) !== 1) parts.push(`${M.fmtNumCell(item.days)} ngày`);
  if (Number(item.unitPrice) && item.kind !== "section" && item.kind !== "subsection") parts.push(`Đơn giá ${M.fmtMoney(item.unitPrice)}`);
  const formulas = Object.entries(item.formulas || {});
  return <>
    {parts.length > 0 && <div className="import-row-values">{parts.join(" · ")}</div>}
    {formulas.length > 0 && <details className="import-row-formulas">
      <summary>Giữ {formulas.length} công thức</summary>
      {formulas.map(([field, fx]) => <div key={field}>{COL_VN[field] || field}: <code>{fx}</code></div>)}
    </details>}
  </>;
}

function DiffRowView({ row }: { row: DiffRow }) {
  return (
    <tr className={`import-row ${row.kind}`}>
      <td className="nowrap"><span className={`import-badge ${row.kind}`}>{CHANGE_VN[row.kind]}</span></td>
      <td className="nowrap muted">{kindLabel(row.itemKind)}</td>
      <td>{row.name || <span className="muted">(dòng phụ của hạng mục trên)</span>}</td>
      <td>
        <ItemPreview item={row.item} />
        {row.fields.map((f) => (
          <div key={f.field} style={{ fontSize: 13 }}>
            {f.label}: <span className="txt-danger">{fmtVal(f.field, f.before, !!row.item?.quantityExact)}</span>
            {" → "}
            <span className="txt-ok"><strong>{fmtVal(f.field, f.after, !!row.item?.quantityExact)}</strong></span>
          </div>
        ))}
        {row.warn?.map((w, i) => <div key={i} className="import-rowwarn">⚠ {w}</div>)}
      </td>
    </tr>
  );
}
