import { useEffect, useRef } from "react";
import { toast } from "./ui";
import * as M from "./quoteMath";
import { evalFormula, type FormulaRefs } from "./formula";
import { type ItemK, nextK, autoGrow } from "./gridShared";
import { parseClipboardTSV, cellsToTSV, cellsToHTML, parseLooseNumber, reconstructExportRows, looksLikeExportPaste } from "./clipboard";

// Lưới Excel DÙNG CHUNG (lưới chính + bảng nội bộ). Bê ĐẦY ĐỦ drawItems + UX công thức Excel:
// head/sub/section/subsection/info + rowspan · công thức =… (badge ƒ) · gom-nghìn-live · CHỌN VÙNG
// (kéo chuột + Shift+Arrow) · THANH CÔNG THỨC fx-bar (đồng bộ 2 chiều, Enter áp) · CHÈN-REF bằng
// bấm/kéo ô khi đang gõ công thức · highlight ô tham chiếu (xanh) · AUTOCOMPLETE hàm (=SU→SUM) ·
// COPY/CUT vùng · Ctrl+D fill · Tab/Arrow/Enter nav · dán Excel khối · undo/redo (Ctrl+Z/Y theo lưới
// đang focus). Mutate items TẠI CHỖ + onChange() (cha vẽ lại tổng). Mỗi instance có undo/sel riêng.

export type GridTableProps = {
  items: ItemK[];
  usesDays: boolean;
  showDetail: boolean;
  numberSubs: boolean;
  editable: boolean;
  internalNote: boolean;
  approveCol?: boolean;
  canApprove?: boolean;
  payCol?: boolean;                // cột THANH TOÁN nội bộ per-hàng (bảng nội bộ)
  canPay?: boolean;                // có quyền quote:internal:pay → bấm được
  onPayRow?: (item: ItemK) => void; // mở dialog tích thanh toán + ảnh cho 1 hàng
  groupSubtotal: boolean;
  onGroupSubtotal?: (v: boolean) => void;
  onChange: () => void;
  fxBar?: boolean;                 // chỉ lưới chính bật thanh công thức
};

type Sel = { anchor: { row: number; field: string }; focus: { row: number; field: string } };
type Addr = { row: number; field: string; L: string };
const MULTILINE = new Set(["name", "detail", "notes", "internalNote"]);
const FN_LIST = ["SUM", "PRODUCT", "AVERAGE", "AVG", "MIN", "MAX", "ROUND", "ROUNDUP", "ROUNDDOWN", "INT", "ABS", "CEILING", "FLOOR"];
const REF_COLORS = ["#1f7a3d", "#15803d", "#2e7d32", "#4d7c0f", "#0b7a4b", "#3d8b37"];

export function GridTable(props: GridTableProps) {
  const { items, usesDays, showDetail, numberSubs, editable, internalNote, approveCol, canApprove, payCol, canPay, onPayRow, groupSubtotal, onGroupSubtotal, onChange, fxBar } = props;
  const undoRef = useRef<string[]>([]);
  const redoRef = useRef<string[]>([]);
  const focusRef = useRef<{ i: number; f: string } | null>(null);
  const focusPend = useRef<{ i: number; f: string } | null>(null);
  const tableRef = useRef<HTMLTableElement | null>(null);
  const selRef = useRef<Sel | null>(null);
  const navigatingRef = useRef(false);
  const pickingRef = useRef(false);
  const copyBufRef = useRef<{ tsv: string; token: number; kinds?: string[]; c0?: number } | null>(null);
  const copyTokenRef = useRef(0);
  const autoRef = useRef<{ input: HTMLInputElement | HTMLTextAreaElement; items: string[]; idx: number } | null>(null);
  const fxAddrRef = useRef<HTMLSpanElement | null>(null);
  const fxInputRef = useRef<HTMLInputElement | null>(null);
  const statRef = useRef<HTMLDivElement | null>(null);

  const FIELDS = (["name", showDetail ? "detail" : null, "unit", "quantity", usesDays ? "days" : null, "unitPrice", "notes", internalNote ? "internalNote" : null].filter(Boolean)) as string[];
  const NUMERIC = new Set(["quantity", "unitPrice", "days"]);
  const snap = () => JSON.stringify(items);
  const pushUndo = () => { undoRef.current.push(snap()); if (undoRef.current.length > 100) undoRef.current.shift(); redoRef.current.length = 0; };
  const focusCell = (i: number, f: string) => { focusPend.current = { i, f }; };

  // ── A1 addressing + công thức ───────────────────────────────────────────────
  const ADDR: { f: string; ro?: boolean; L: string }[] = [
    { f: "_stt", ro: true, L: "" }, { f: "name", L: "" },
    ...(showDetail ? [{ f: "detail", L: "" }] : []),
    { f: "unit", L: "" }, { f: "quantity", L: "" },
    ...(usesDays ? [{ f: "days", L: "" }] : []),
    { f: "unitPrice", L: "" }, { f: "_amount", ro: true, L: "" }, { f: "notes", L: "" },
    ...(internalNote ? [{ f: "internalNote", L: "" }] : []),
  ];
  ADDR.forEach((c, i) => { c.L = M.groupLetter(i); });
  const colByL: Record<string, { f: string }> = {}; ADDR.forEach((c) => { colByL[c.L] = c; });
  const idxOfL = (L: string) => ADDR.findIndex((c) => c.L === L);
  const letterOf = (f: string) => ADDR.find((c) => c.f === f)?.L || "";
  const addrOf = (row: number, field: string) => { const L = letterOf(field); return L ? L + (row + 1) : ""; };
  const parseAddr = (a: string) => { const m = /^([A-Za-z]+)(\d+)$/.exec(a.trim()); if (!m) return null; const L = m[1].toUpperCase(); const col = colByL[L]; if (!col) return null; const row = parseInt(m[2], 10) - 1; if (row < 0 || row >= items.length) return null; return { row, f: col.f, L }; };
  const cellNum = (a: string): number => { const p = parseAddr(a); if (!p) return 0; const it = items[p.row] as Record<string, unknown>; if (!it) return 0; if (p.f === "_amount") return (items[p.row].kind === "section" || items[p.row].kind === "subsection" || items[p.row].kind === "info") ? 0 : M.lineAmount(items[p.row], usesDays); if (p.f === "_stt") return 0; if (NUMERIC.has(p.f)) return Number(it[p.f]) || 0; return M.parseVN((it[p.f] as string) || ""); };
  const refs: FormulaRefs = { cell: cellNum, range: (a, b) => { const pa = parseAddr(a), pb = parseAddr(b); if (!pa || !pb) return null; const ca = idxOfL(pa.L), cb = idxOfL(pb.L); const c0 = Math.min(ca, cb), c1 = Math.max(ca, cb), r0 = Math.min(pa.row, pb.row), r1 = Math.max(pa.row, pb.row); const out: number[] = []; for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) out.push(cellNum(ADDR[c].L + (r + 1))); return out; } };
  const recomputeAll = () => {
    if (!items.some((it) => it.formulas && Object.keys(it.formulas).length)) return;
    for (let pass = 0; pass < 8; pass++) {
      let ch = false;
      for (const it of items) { if (!it.formulas) continue; const rec = it as Record<string, unknown>; for (const f in it.formulas) { const v = evalFormula(it.formulas[f], refs); if (v === null) continue; if (NUMERIC.has(f)) { if (rec[f] !== v) { rec[f] = v; ch = true; } } else { const sv = M.fmtNumCell(v); if (rec[f] !== sv) { rec[f] = sv; ch = true; } } } }
      if (!ch) break;
    }
  };
  const peekFx = (fx: string, val: string) => toast(`Công thức: ${fx}  =  ${val}`, "info");

  // commitCell: áp "=" → công thức cho MỌI cột; số/chữ thường ngược lại. Tự bật toggle nhóm khi SL nhóm>1.
  const commitCell = (i: number, f: string, raw: string) => {
    const it = items[i] as Record<string, unknown>; raw = String(raw);
    if (raw.trim().startsWith("=")) {
      if (!it.formulas) it.formulas = {};
      (it.formulas as Record<string, string>)[f] = raw.trim();
      const v = evalFormula(raw.trim(), refs);
      it[f] = NUMERIC.has(f) ? (v ?? 0) : (v != null ? M.fmtNumCell(v) : raw.trim());
    } else {
      if (it.formulas) { delete (it.formulas as Record<string, string>)[f]; if (!Object.keys(it.formulas).length) delete it.formulas; }
      it[f] = NUMERIC.has(f) ? (raw.trim() === "" ? 0 : M.parseVN(raw)) : (MULTILINE.has(f) ? raw : raw.trim().replace(/\s+/g, " "));
    }
    if ((items[i].kind === "section" || items[i].kind === "subsection") && f === "quantity" && (Number(it[f]) || 0) > 1 && !groupSubtotal) onGroupSubtotal?.(true);
  };

  // ── selection rectangle (sống qua redraw: tô lại từ selRef ở effect mỗi render) ─
  const fieldIdx = (f: string) => FIELDS.indexOf(f);
  const cellEl = (row: number, field: string) => tableRef.current?.querySelector(`tr[data-row="${row}"] [data-f="${field}"]`) as HTMLInputElement | HTMLTextAreaElement | null;
  const tdOf = (row: number, field: string): HTMLElement | null => {
    const tr = tableRef.current?.querySelector(`tr[data-row="${row}"]`); if (!tr) return null;
    if (field === "_amount") return tr.querySelector(".col-amount");
    if (field === "_stt") return tr.querySelector(".col-stt");
    const inp = tr.querySelector(`[data-f="${field}"]`); return inp ? (inp.closest("td") as HTMLElement) : null;
  };
  const rectOf = (sel: Sel | null) => { if (!sel) return null; const a = fieldIdx(sel.anchor.field), b = fieldIdx(sel.focus.field); if (a < 0 || b < 0) return null; return { r0: Math.min(sel.anchor.row, sel.focus.row), r1: Math.max(sel.anchor.row, sel.focus.row), c0: Math.min(a, b), c1: Math.max(a, b) }; };
  const onFillHandleDown = (e: MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    const start = rectOf(selRef.current); if (!start) return;
    const onMove = (mv: MouseEvent) => { const cellTd = (mv.target as HTMLElement).closest?.("[data-row]"); if (!cellTd) return; const sel = selRef.current; if (sel) { sel.focus = { row: parseInt(cellTd.getAttribute("data-row") || "0", 10), field: FIELDS[start.c1] }; paintSel(); } };
    const onUp = () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); fillDown(); };
    document.addEventListener("mousemove", onMove); document.addEventListener("mouseup", onUp);
  };
  const paintSel = () => {
    const tb = tableRef.current; if (!tb) return;
    tb.querySelectorAll("td.cell-selected, td.cell-anchor").forEach((td) => td.classList.remove("cell-selected", "cell-anchor"));
    tb.querySelectorAll(".fill-handle").forEach((h) => h.remove());
    const sel = selRef.current; const rc = rectOf(sel);
    if (rc && sel) {
      for (let r = rc.r0; r <= rc.r1; r++) for (let c = rc.c0; c <= rc.c1; c++) { const el = cellEl(r, FIELDS[c]); el?.closest("td")?.classList.add("cell-selected"); }
      cellEl(sel.anchor.row, sel.anchor.field)?.closest("td")?.classList.add("cell-anchor");
      if (editable) { const td = cellEl(rc.r1, FIELDS[rc.c1])?.closest("td"); if (td) { const h = document.createElement("div"); h.className = "fill-handle"; h.addEventListener("mousedown", onFillHandleDown); td.appendChild(h); } }
    }
    // thanh thống kê Đếm / TB / Tổng (ô số)
    if (statRef.current) {
      let sum = 0, cnt = 0;
      if (rc) for (let r = rc.r0; r <= rc.r1; r++) for (let c = rc.c0; c <= rc.c1; c++) { const f = FIELDS[c]; if (!NUMERIC.has(f)) continue; const v = Number((items[r] as Record<string, unknown>)?.[f]); if (v) { sum += v; cnt++; } }
      if (cnt >= 1) { statRef.current.classList.remove("hidden"); statRef.current.innerHTML = `Đếm: <b>${cnt}</b> · TB: <b>${M.fmtNumCell(Math.round(sum / cnt))}</b> · Tổng: <b>${M.fmtNumCell(sum)}</b>`; }
      else { statRef.current.classList.add("hidden"); statRef.current.textContent = ""; }
    }
    syncFxBar();
  };
  const clearSel = () => { selRef.current = null; paintSel(); };
  const moveTo = (row: number, field: string, extend: boolean) => {
    row = Math.max(0, Math.min(items.length - 1, row));
    const ci = Math.max(0, Math.min(FIELDS.length - 1, fieldIdx(field)));
    let f2 = FIELDS[ci];
    if (!cellEl(row, f2)) { let found: string | null = null; for (let d = 1; d < FIELDS.length; d++) { if (cellEl(row, FIELDS[ci - d])) { found = FIELDS[ci - d]; break; } if (cellEl(row, FIELDS[ci + d])) { found = FIELDS[ci + d]; break; } } f2 = found || "name"; }
    const sel = selRef.current;
    if (extend && sel) selRef.current = { anchor: sel.anchor, focus: { row, field: f2 } };
    else selRef.current = { anchor: { row, field: f2 }, focus: { row, field: f2 } };
    navigatingRef.current = true;
    const el = cellEl(row, f2); if (el) { el.focus(); if (!extend) { try { el.select(); } catch { /* */ } } }
    navigatingRef.current = false;
    paintSel();
  };

  // ── thanh công thức fx-bar (chỉ lưới chính) ─────────────────────────────────
  const syncFxBar = () => {
    if (!fxBar) return;
    const addrEl = fxAddrRef.current, inEl = fxInputRef.current; if (!addrEl || !inEl) return;
    const sel = selRef.current;
    if (!sel) { addrEl.textContent = "—"; if (document.activeElement !== inEl) inEl.value = ""; return; }
    const { row, field } = sel.anchor;
    addrEl.textContent = addrOf(row, field) || "—";
    if (document.activeElement === inEl) return;
    const it = items[row]; const fx = it?.formulas?.[field];
    inEl.value = fx ? fx : (!it ? "" : (field === "_amount" || field === "_stt") ? "" : NUMERIC.has(field) ? M.fmtNumCell(it[field as keyof M.Item] as number) : ((it[field as keyof M.Item] as string) || ""));
    inEl.readOnly = !editable || field === "_amount" || field === "_stt";
  };
  const applyFxBar = (move: boolean) => {
    const inEl = fxInputRef.current; const sel = selRef.current; if (!inEl || !sel) return;
    const { row, field } = sel.anchor;
    if (!editable || field === "_amount" || field === "_stt") return;
    commitCell(row, field, inEl.value); recomputeAll(); clearActiveRefs(); onChange();
    if (move) moveTo(row + 1, field, false);
  };

  // ── chèn tham chiếu bằng chuột (point mode) + highlight ref ───────────────────
  const cellAddrFromEvent = (target: HTMLElement): Addr | null => {
    const td = target.closest("td"); const tr = target.closest("tr[data-row]");
    if (!td || !tr) return null;
    const row = parseInt(tr.getAttribute("data-row") || "0", 10);
    const inp = td.querySelector("[data-f]"); let field = inp?.getAttribute("data-f") || null;
    if (!field) { if (td.classList.contains("col-amount")) field = "_amount"; else if (td.classList.contains("col-stt")) field = "_stt"; else return null; }
    const L = letterOf(field); if (!L) return null;
    return { row, field, L };
  };
  const rangeAddr = (a: Addr, b: Addr) => { const ca = idxOfL(a.L), cb = idxOfL(b.L); const c0 = Math.min(ca, cb), c1 = Math.max(ca, cb), r0 = Math.min(a.row, b.row), r1 = Math.max(a.row, b.row); const tl = ADDR[c0].L + (r0 + 1), br = ADDR[c1].L + (r1 + 1); return tl === br ? tl : tl + ":" + br; };
  const clearRefPick = () => tableRef.current?.querySelectorAll("td.cell-ref-pick").forEach((t) => t.classList.remove("cell-ref-pick"));
  const paintRefPick = (a: Addr, b: Addr) => { clearRefPick(); const ca = idxOfL(a.L), cb = idxOfL(b.L); const c0 = Math.min(ca, cb), c1 = Math.max(ca, cb), r0 = Math.min(a.row, b.row), r1 = Math.max(a.row, b.row); for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) tdOf(r, ADDR[c].f)?.classList.add("cell-ref-pick"); };
  const clearActiveRefs = () => tableRef.current?.querySelectorAll("td.cell-ref-active").forEach((t) => { t.classList.remove("cell-ref-active"); (t as HTMLElement).style.removeProperty("--ref-color"); });
  const highlightActiveFormulaRefs = (text: string) => {
    clearActiveRefs();
    if (!text || !String(text).trim().startsWith("=")) return;
    const body = String(text).replace(/^=/, ""); let ci = 0;
    const paint = (td: HTMLElement | null) => { if (td) { td.classList.add("cell-ref-active"); td.style.setProperty("--ref-color", REF_COLORS[ci % REF_COLORS.length]); } };
    const rangeRe = /([A-Za-z]+\d+)\s*:\s*([A-Za-z]+\d+)/g; let m: RegExpExecArray | null;
    while ((m = rangeRe.exec(body))) { const a = parseAddr(m[1]), b = parseAddr(m[2]); if (!a || !b) continue; const c0 = Math.min(idxOfL(a.L), idxOfL(b.L)), c1 = Math.max(idxOfL(a.L), idxOfL(b.L)); const r0 = Math.min(a.row, b.row), r1 = Math.max(a.row, b.row); for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) paint(tdOf(r, ADDR[c].f)); ci++; }
    const noRanges = body.replace(rangeRe, (mm) => " ".repeat(mm.length));
    const singleRe = /(?<![A-Za-z0-9_.])([A-Za-z]+\d+)/g;
    while ((m = singleRe.exec(noRanges))) { const p = parseAddr(m[1]); if (p) { paint(tdOf(p.row, p.f)); ci++; } }
  };
  const startPointDrag = (fxInput: HTMLInputElement | HTMLTextAreaElement, startInfo: Addr) => {
    const caret = fxInput.selectionStart ?? fxInput.value.length;
    const after = fxInput.value.slice(caret);
    const baseLeft = fxInput.value.slice(0, caret).replace(/[A-Za-z]+\d+(?::[A-Za-z]+\d+)?$/, "");
    let curInfo = startInfo;
    const apply = (info2: Addr) => { curInfo = info2; const ref = rangeAddr(startInfo, info2); fxInput.value = baseLeft + ref + after; const pos = (baseLeft + ref).length; try { fxInput.setSelectionRange(pos, pos); } catch { /* */ } paintRefPick(startInfo, info2); highlightActiveFormulaRefs(fxInput.value); };
    pickingRef.current = true; document.body.classList.add("fx-picking"); apply(startInfo);
    const onMove = (mv: MouseEvent) => { const info2 = cellAddrFromEvent(mv.target as HTMLElement); if (info2) apply(info2); };
    const onUp = () => { document.removeEventListener("mousemove", onMove, true); document.removeEventListener("mouseup", onUp, true); pickingRef.current = false; document.body.classList.remove("fx-picking"); clearRefPick(); fxInput.focus(); const pos = (baseLeft + rangeAddr(startInfo, curInfo)).length; try { fxInput.setSelectionRange(pos, pos); } catch { /* */ } };
    document.addEventListener("mousemove", onMove, true); document.addEventListener("mouseup", onUp, true);
  };
  const onPointMouseDown = (e: { button: number; target: EventTarget | null; preventDefault(): void; stopPropagation(): void }) => {
    if (e.button !== 0) return;
    const ae = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
    if (!ae || ae.getAttribute?.("data-f") == null) return;
    if (!(ae.value || "").trim().startsWith("=")) return;
    const start = cellAddrFromEvent(e.target as HTMLElement); if (!start) return;
    const aeTr = ae.closest?.("tr[data-row]"); const aeRow = aeTr ? parseInt(aeTr.getAttribute("data-row") || "-1", 10) : -1;
    if (start.row === aeRow && start.field === ae.getAttribute("data-f")) return;   // ô của chính nó → caret thường
    e.preventDefault(); e.stopPropagation();
    startPointDrag(ae, start);
  };
  // kéo chuột chọn vùng (khi KHÔNG ở point-mode)
  const onSelDragStart = (e: { button: number; target: EventTarget | null }) => {
    if (e.button !== 0 || pickingRef.current) return;
    const info = cellAddrFromEvent(e.target as HTMLElement); if (!info || !FIELDS.includes(info.field)) return;
    selRef.current = { anchor: { row: info.row, field: info.field }, focus: { row: info.row, field: info.field } };
    paintSel();
    const tb = tableRef.current;
    const onOver = (ov: MouseEvent) => { const i2 = cellAddrFromEvent(ov.target as HTMLElement); if (!i2 || !FIELDS.includes(i2.field)) return; const sel = selRef.current; if (sel && (sel.focus.row !== i2.row || sel.focus.field !== i2.field)) { sel.focus = { row: i2.row, field: i2.field }; paintSel(); } };
    const onUp = () => { tb?.removeEventListener("mouseover", onOver); document.removeEventListener("mouseup", onUp); };
    tb?.addEventListener("mouseover", onOver); document.addEventListener("mouseup", onUp);
  };

  // ── autocomplete tên hàm ─────────────────────────────────────────────────────
  const ensureAutoEl = () => { let d = document.querySelector(".fx-auto") as HTMLElement | null; if (!d) { d = document.createElement("div"); d.className = "fx-auto hidden"; document.body.appendChild(d); } return d; };
  const closeAuto = () => { autoRef.current = null; const d = document.querySelector(".fx-auto"); if (d) d.classList.add("hidden"); };
  const acceptAuto = () => { const a = autoRef.current; if (!a) return; const name = a.items[a.idx], input = a.input, val = input.value; const caret = input.selectionStart ?? val.length; const newLeft = val.slice(0, caret).replace(/([A-Za-z]+)$/, name + "("); input.value = newLeft + val.slice(caret); const pos = newLeft.length; try { input.setSelectionRange(pos, pos); } catch { /* */ } closeAuto(); input.focus(); input.dispatchEvent(new Event("input", { bubbles: true })); };
  const renderAuto = () => { const a = autoRef.current; if (!a) return; const el = ensureAutoEl(); el.innerHTML = a.items.map((n, k) => `<div class="fx-auto-item${k === a.idx ? " active" : ""}" data-k="${k}">${n}<span>( )</span></div>`).join(""); el.querySelectorAll(".fx-auto-item").forEach((node) => node.addEventListener("mousedown", (ev) => { ev.preventDefault(); if (autoRef.current) { autoRef.current.idx = parseInt((node as HTMLElement).dataset.k || "0", 10); acceptAuto(); } })); };
  const moveAuto = (delta: number) => { const a = autoRef.current; if (!a) return; a.idx = (a.idx + delta + a.items.length) % a.items.length; renderAuto(); };
  const fxAutocomplete = (input: HTMLInputElement | HTMLTextAreaElement) => {
    const val = input.value || ""; const caret = input.selectionStart ?? val.length; const left = val.slice(0, caret);
    if (!left.trim().startsWith("=")) { closeAuto(); return; }
    const m = /([A-Za-z]+)$/.exec(left); if (!m) { closeAuto(); return; }
    const tok = m[1].toUpperCase(); const matches = FN_LIST.filter((n) => n.startsWith(tok) && n !== tok);
    if (!matches.length) { closeAuto(); return; }
    autoRef.current = { input, items: matches, idx: 0 };
    const el = ensureAutoEl(); renderAuto(); const r = input.getBoundingClientRect();
    el.style.left = r.left + "px"; el.style.top = (r.bottom + 2) + "px"; el.style.minWidth = Math.max(120, r.width) + "px"; el.classList.remove("hidden");
  };
  useEffect(() => () => closeAuto(), []);   // dọn dropdown khi gỡ lưới

  // ── copy / cut / fill ──────────────────────────────────────────────────────────
  // ô số copy giá trị THÔ (US, không gom nghìn) để Excel nhận; công thức copy nguyên "=…".
  const cellRawForCopy = (i: number, f: string) => { const it = items[i] as Record<string, unknown>; const fx = (it.formulas as Record<string, string> | undefined)?.[f]; if (fx) return fx; if (NUMERIC.has(f)) { const v = it[f]; return v ? String(v) : ""; } return (it[f] as string) || ""; };
  const onCopyCut = (e: { clipboardData: DataTransfer; preventDefault(): void }, cut: boolean) => {
    const sel = selRef.current; const rc = rectOf(sel); if (!rc) return;
    const ae = document.activeElement as HTMLInputElement | null;
    if (rc.r0 === rc.r1 && rc.c0 === rc.c1 && ae && ae.selectionStart !== ae.selectionEnd) return;   // bôi-đen 1 phần chữ → mặc định
    e.preventDefault();
    const matrix: string[][] = []; const kinds: string[] = [];
    for (let r = rc.r0; r <= rc.r1; r++) { const row: string[] = []; for (let c = rc.c0; c <= rc.c1; c++) row.push(cellRawForCopy(r, FIELDS[c])); matrix.push(row); kinds.push(items[r].kind || "item"); }
    const tsv = cellsToTSV(matrix);   // RFC-4180: ô nhiều dòng được bọc "…" đúng chuẩn
    e.clipboardData.setData("text/plain", tsv);
    e.clipboardData.setData("text/html", cellsToHTML(matrix));   // dán sang Word/Sheets giữ bảng
    const token = ++copyTokenRef.current;
    try { e.clipboardData.setData("application/x-quanly-grid", JSON.stringify({ token, kinds, cols: rc.c1 - rc.c0 + 1, c0: rc.c0 })); } catch { /* */ }
    copyBufRef.current = { tsv, token, kinds, c0: rc.c0 };
    if (cut && editable) { pushUndo(); for (let r = rc.r0; r <= rc.r1; r++) for (let c = rc.c0; c <= rc.c1; c++) { const f = FIELDS[c]; const it = items[r] as Record<string, unknown>; it[f] = NUMERIC.has(f) ? 0 : ""; if (it.formulas) delete (it.formulas as Record<string, string>)[f]; } recomputeAll(); onChange(); }
  };
  // Tự BẬT "Hiện Thành Tiền nhóm" khi vùng [lo..hi] có nhóm (section/subsection) SL>1 — nếu không,
  // sheetSubtotalGrouped ép mult=1 → MẤT hệ số ×N → tổng ÂM THẦM SAI (như SPA autoEnableGroupSub).
  const autoEnableGroupSub = (lo: number, hi: number) => {
    if (groupSubtotal) return;
    for (let i = Math.max(0, lo); i <= hi && i < items.length; i++) {
      const it = items[i];
      if ((it.kind === "section" || it.kind === "subsection") && (Number(it.quantity) || 0) > 1) { onGroupSubtotal?.(true); return; }
    }
  };
  const fillDown = () => {
    const rc = rectOf(selRef.current); if (!rc || rc.r1 <= rc.r0) return;
    pushUndo();
    for (let c = rc.c0; c <= rc.c1; c++) { const f = FIELDS[c]; const top = items[rc.r0] as Record<string, unknown>; for (let r = rc.r0 + 1; r <= rc.r1; r++) { if (items[r].kind === "info") continue; const it = items[r] as Record<string, unknown>; it[f] = top[f]; const tfx = top.formulas as Record<string, string> | undefined; if (tfx && tfx[f]) { if (!it.formulas) it.formulas = {}; (it.formulas as Record<string, string>)[f] = tfx[f]; } else if (it.formulas) delete (it.formulas as Record<string, string>)[f]; } }
    autoEnableGroupSub(rc.r0, rc.r1);
    recomputeAll(); onChange();
  };

  // ── row ops (CHÈN ngay dưới ô đang chọn — như Excel/SPA, không đẩy xuống cuối) ──
  const insertIndex = () => { const sel = selRef.current; return sel ? Math.max(sel.anchor.row, sel.focus.row) + 1 : items.length; };
  const pushItem = (it: ItemK) => { pushUndo(); it._k = nextK(); const at = insertIndex(); items.splice(at, 0, it); onChange(); focusCell(at, "name"); };
  const addItem = () => pushItem(M.blankItem(usesDays));
  const addSection = () => pushItem(M.blankSection());
  const addSubSection = () => pushItem(M.blankSubSection());
  const addInfo = () => pushItem(M.blankInfo());
  const addSubAfter = (i: number) => { pushUndo(); const it = M.blankSub(usesDays) as ItemK; it._k = nextK(); items.splice(i + 1, 0, it); onChange(); focusCell(i + 1, showDetail ? "detail" : "unit"); };
  const removeRow = (i: number) => { pushUndo(); items.splice(i, 1); const sel = selRef.current; if (sel) { const max = items.length - 1; if (max < 0) selRef.current = null; else { sel.anchor.row = Math.min(sel.anchor.row, max); sel.focus.row = Math.min(sel.focus.row, max); } } onChange(); toast("Đã xóa dòng — nhấn Ctrl+Z để hoàn tác", "info"); };

  // ── undo/redo + dán Excel khối ─────────────────────────────────────────────────
  const restore = (json: string) => { const arr = JSON.parse(json) as ItemK[]; arr.forEach((it) => { if (it._k == null) it._k = nextK(); }); items.splice(0, items.length, ...arr); recomputeAll(); onChange(); };
  const doUndo = () => { if (!undoRef.current.length) return; redoRef.current.push(snap()); restore(undoRef.current.pop() as string); };
  const doRedo = () => { if (!redoRef.current.length) return; undoRef.current.push(snap()); restore(redoRef.current.pop() as string); };
  // đặt 1 ô khi dán: công thức "=…" giữ nguyên; số dùng parseLooseNumber (VN/US an toàn); text gọn dòng.
  const pasteCellVal = (i: number, f: string, val: string) => {
    const it = items[i] as Record<string, unknown>;
    if (val.trim().startsWith("=")) { if (!it.formulas) it.formulas = {}; (it.formulas as Record<string, string>)[f] = val.trim(); it[f] = NUMERIC.has(f) ? 0 : val.trim(); return; }
    if (it.formulas && (it.formulas as Record<string, string>)[f]) delete (it.formulas as Record<string, string>)[f];
    it[f] = NUMERIC.has(f) ? (val.trim() === "" ? 0 : parseLooseNumber(val)) : (MULTILINE.has(f) ? val : val.trim().replace(/\s+/g, " "));
  };
  const onPaste = (e: { clipboardData: DataTransfer; target: EventTarget | null; preventDefault(): void }) => {
    if (!editable) return;
    const ae = document.activeElement as HTMLElement | null;
    const f0 = (e.target as HTMLElement)?.getAttribute?.("data-f") || ae?.getAttribute?.("data-f");
    const sel = selRef.current;
    let startRow = sel ? rectOf(sel)!.r0 : (focusRef.current?.i ?? 0);
    let startCol = f0 && FIELDS.includes(f0) ? FIELDS.indexOf(f0) : (sel ? rectOf(sel)!.c0 : 0);
    let internal: { token: number; kinds?: string[]; cols?: number; c0?: number } | null = null;
    try { const raw = e.clipboardData.getData("application/x-quanly-grid"); if (raw) internal = JSON.parse(raw); } catch { /* */ }
    const text = e.clipboardData.getData("text/plain") || e.clipboardData.getData("text") || "";
    if (!text && !internal) return;
    const sameBlock = !!(internal && copyBufRef.current && internal.token === copyBufRef.current.token);
    const rows = parseClipboardTSV(sameBlock ? copyBufRef.current!.tsv : text);
    const isGrid = rows.length > 1 || (rows[0] && rows[0].length > 1);

    // 1 giá trị đơn lẻ.
    if (!isGrid) {
      const val = rows[0][0];
      const rc = rectOf(sel);
      if (rc && (rc.r0 !== rc.r1 || rc.c0 !== rc.c1)) {   // có vùng chọn → fill ra TOÀN vùng (Excel)
        e.preventDefault(); pushUndo();
        for (let r = rc.r0; r <= rc.r1; r++) for (let c = rc.c0; c <= rc.c1; c++) pasteCellVal(r, FIELDS[c], val);
        autoEnableGroupSub(rc.r0, rc.r1);   // fill SL>1 ra hàng nhóm → tự bật (chống lệch tiền)
        recomputeAll(); onChange(); paintSel();
        return;
      }
      // 1 ô SỐ → parseLooseNumber (US/VN an toàn), KHÔNG để trình duyệt+onNumInput đọc sai (1,000,000→1.0).
      if (f0 && NUMERIC.has(f0)) {
        e.preventDefault(); pushUndo();
        const i0 = rc ? rc.r0 : (focusRef.current?.i ?? 0);
        pasteCellVal(i0, f0, val); recomputeAll(); onChange();
        const el = cellEl(i0, f0); if (el && !items[i0].formulas?.[f0]) el.value = M.fmtNumCell((items[i0] as Record<string, unknown>)[f0] as number);
        return;
      }
      return;   // 1 ô CHỮ → để trình duyệt chèn tại con trỏ (dán vào giữa đoạn text)
    }
    e.preventDefault(); pushUndo();

    // DÁN NGUYÊN báo giá app xuất ra (có cột STT) → dựng lại nhóm/nhóm-con/hàng-con/info.
    if (!internal && looksLikeExportPaste(rows, startCol, FIELDS.length)) {
      const roles = ADDR.map((c) => c.f);
      const built = reconstructExportRows(rows, roles, NUMERIC).map((b) => ({ ...M.blankItem(usesDays), ...b, _k: nextK() } as ItemK));
      items.splice(startRow, rows.length, ...built);
      if (!items.length) { const nit = M.blankItem(usesDays) as ItemK; nit._k = nextK(); items.push(nit); }
      autoEnableGroupSub(startRow, startRow + built.length - 1);
      recomputeAll(); onChange();
      selRef.current = { anchor: { row: startRow, field: FIELDS[0] }, focus: { row: startRow + built.length - 1, field: FIELDS[FIELDS.length - 1] } };
      focusCell(startRow, FIELDS[0]);
      const nGrp = built.filter((b) => b.kind === "section").length, nSub = built.filter((b) => b.kind === "subsection").length;
      toast(`Đã dán & dựng lại ${built.length} dòng (${nGrp} nhóm, ${nSub} nhóm con)`, "success");
      return;
    }

    // Khối nhiều ô. Dán vào hàng NHÓM → chèn hàng mới phía dưới (không đè nhóm).
    const startKind = items[startRow]?.kind;
    if (startKind === "section" || startKind === "subsection") {
      rows.forEach(() => { const nit = M.blankItem(usesDays) as ItemK; nit._k = nextK(); items.splice(startRow + 1, 0, nit); });
      startRow += 1; startCol = 0;
    }
    const kinds = sameBlock && !(startKind === "section" || startKind === "subsection") ? copyBufRef.current!.kinds : null;
    rows.forEach((cells, r) => {
      const ri = startRow + r;
      if (ri >= items.length) { const nit = M.blankItem(usesDays) as ItemK; nit._k = nextK(); items.push(nit); }
      const it = items[ri] as Record<string, unknown>;
      if (kinds && kinds[r]) it.kind = kinds[r];
      cells.forEach((val, c) => { const f = FIELDS[startCol + c]; if (f) pasteCellVal(ri, f, val); });
    });
    autoEnableGroupSub(startRow, startRow + rows.length - 1);
    recomputeAll(); onChange();
    selRef.current = { anchor: { row: startRow, field: FIELDS[startCol] }, focus: { row: startRow + rows.length - 1, field: FIELDS[Math.min(FIELDS.length - 1, startCol + rows[0].length - 1)] } };
    focusCell(startRow, FIELDS[startCol]);
    toast(`Đã dán ${rows.length} dòng × ${rows[0].length} cột`, "success");
  };

  // ── bàn phím trong ô (Enter/Tab/Arrow/Esc/Ctrl) ────────────────────────────────
  const onGridKeyDown = (e: { key: string; keyCode: number; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; target: EventTarget | null; nativeEvent: KeyboardEvent; preventDefault(): void; stopPropagation(): void }) => {
    const ae = e.target as HTMLInputElement | HTMLTextAreaElement | null;
    const f = ae?.getAttribute?.("data-f"); const tr = ae?.closest?.("tr[data-row]");
    if (!f || !tr || !FIELDS.includes(f)) return;
    const ctrl = e.ctrlKey || e.metaKey;
    if (!ctrl && (e.nativeEvent?.isComposing || e.keyCode === 229 || e.key === "Process")) return;   // IME
    const i = parseInt(tr.getAttribute("data-row") || "0", 10);
    const ci = FIELDS.indexOf(f);
    const isMultiline = MULTILINE.has(f);
    if (autoRef.current) {
      if (e.key === "ArrowDown") { e.preventDefault(); e.stopPropagation(); moveAuto(1); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); e.stopPropagation(); moveAuto(-1); return; }
      if (e.key === "Tab") { e.preventDefault(); e.stopPropagation(); acceptAuto(); return; }
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeAuto(); return; }
      if (e.key === "Enter") closeAuto();
    }
    if (e.key === "Enter" && !(isMultiline && e.shiftKey)) {
      e.preventDefault(); e.stopPropagation();
      commitCell(i, f, ae!.value); recomputeAll();
      if (i >= items.length - 1) { pushUndo(); const nit = M.blankItem(usesDays) as ItemK; nit._k = nextK(); items.push(nit); selRef.current = { anchor: { row: i + 1, field: f }, focus: { row: i + 1, field: f } }; focusCell(i + 1, f); onChange(); }
      else { onChange(); moveTo(i + 1, f, false); }
      return;
    }
    if (ctrl && !e.shiftKey && (e.key === "z" || e.key === "Z")) { e.preventDefault(); e.stopPropagation(); if (editable) doUndo(); return; }
    if (ctrl && ((e.key === "y" || e.key === "Y") || (e.shiftKey && (e.key === "z" || e.key === "Z")))) { e.preventDefault(); e.stopPropagation(); if (editable) doRedo(); return; }
    if (ctrl && (e.key === "d" || e.key === "D")) { e.preventDefault(); e.stopPropagation(); if (editable) fillDown(); return; }
    if (e.key === "Escape" && selRef.current) { e.stopPropagation(); clearSel(); return; }
    if (e.key === "Tab") {
      if (!e.shiftKey && (ci < FIELDS.length - 1 || i < items.length - 1)) { e.preventDefault(); e.stopPropagation(); if (ci < FIELDS.length - 1) moveTo(i, FIELDS[ci + 1], false); else moveTo(i + 1, FIELDS[0], false); }
      else if (e.shiftKey && (ci > 0 || i > 0)) { e.preventDefault(); e.stopPropagation(); if (ci > 0) moveTo(i, FIELDS[ci - 1], false); else moveTo(i - 1, FIELDS[FIELDS.length - 1], false); }
      return;
    }
    if (e.key.indexOf("Arrow") === 0) {
      const up = e.key === "ArrowUp", down = e.key === "ArrowDown", left = e.key === "ArrowLeft", right = e.key === "ArrowRight";
      const v = ae!.value || "";
      const atStart = ae!.selectionStart === 0 && ae!.selectionEnd === 0;
      const atEnd = ae!.selectionStart === v.length && ae!.selectionEnd === v.length;
      const whole = v.length > 0 && ae!.selectionStart === 0 && ae!.selectionEnd === v.length;
      if (isMultiline) { if ((up || left) && !atStart && !whole) return; if ((down || right) && !atEnd && !whole) return; }
      else { if (left && !atStart && !whole) return; if (right && !atEnd && !whole) return; }
      e.preventDefault(); e.stopPropagation();
      moveTo(i + (down ? 1 : 0) - (up ? 1 : 0), FIELDS[ci + (right ? 1 : 0) - (left ? 1 : 0)] || f, e.shiftKey);
      return;
    }
  };
  const onGridFocus = (e: { target: EventTarget | null }) => {
    const el = e.target as HTMLInputElement | HTMLTextAreaElement | null; const f = el?.getAttribute?.("data-f"); const tr = el?.closest?.("tr[data-row]");
    if (!f || !tr) return;
    const i = parseInt(tr.getAttribute("data-row") || "0", 10);
    focusRef.current = { i, f };
    if (!navigatingRef.current) { const sel = selRef.current; if (!sel || sel.anchor.row !== i || sel.anchor.field !== f) { selRef.current = { anchor: { row: i, field: f }, focus: { row: i, field: f } }; paintSel(); } }
    const fx = items[i]?.formulas?.[f]; if (fx && el) el.value = fx;   // ô có công thức → hiện =… để sửa
    highlightActiveFormulaRefs(el?.value || ""); syncFxBar();
  };
  const onGridBlur = (e: { target: EventTarget | null }) => {
    if (pickingRef.current) return;   // đang point-pick → giữ focus, chưa commit
    const el = e.target as HTMLInputElement | HTMLTextAreaElement | null; const f = el?.getAttribute?.("data-f"); const tr = el?.closest?.("tr[data-row]");
    if (f && tr && el) {
      const i = parseInt(tr.getAttribute("data-row") || "0", 10);
      const before = JSON.stringify(items[i].formulas || null) + "|" + String((items[i] as Record<string, unknown>)[f]);
      commitCell(i, f, el.value);
      const after = JSON.stringify(items[i].formulas || null) + "|" + String((items[i] as Record<string, unknown>)[f]);
      if (before !== after) { recomputeAll(); onChange(); }
      // RỜI focus → vẽ ô về GIÁ TRỊ HIỂN THỊ (kết quả nếu là công thức, hoặc số gom nghìn) — vì onGridFocus
      // đã set =… lúc focus; nếu dữ liệu không đổi sẽ không re-render nên phải tự set lại el.value ở đây.
      const rec = items[i] as Record<string, unknown>;
      const want = NUMERIC.has(f) ? M.fmtNumCell(rec[f] as number) : ((rec[f] as string) ?? "");
      if (el.value !== want) el.value = want;
    }
    clearActiveRefs(); setTimeout(closeAuto, 150);
  };

  // ── ô SỐ (công thức + gom nghìn live + autocomplete) / text / textarea ─────────
  const onNumInput = (i: number, f: string, el: HTMLInputElement) => {
    const raw = el.value; const it = items[i] as Record<string, unknown>;
    if (raw.trim().startsWith("=")) {
      // Đang GÕ công thức: LƯU LIVE vào model + eval ngay (như SPA), KHÔNG xóa formula khi đang gõ.
      if (!it.formulas) it.formulas = {};
      (it.formulas as Record<string, string>)[f] = raw.trim();
      const live = evalFormula(raw.trim(), refs);
      if (live !== null) it[f] = NUMERIC.has(f) ? live : M.fmtNumCell(live);
      fxAutocomplete(el); highlightActiveFormulaRefs(raw); syncFxBar();
      recomputeAll(); onChange();   // re-eval ô tham chiếu chéo → lưu/hiển thị đúng
      return;
    }
    const before = el.selectionStart ?? raw.length;
    const digitsBefore = raw.slice(0, before).replace(/\D/g, "").length;
    const formatted = M.liveFormat(raw);
    el.value = formatted;
    let pos = 0, seen = 0; while (pos < formatted.length && seen < digitsBefore) { if (/\d/.test(formatted[pos])) seen++; pos++; }
    try { el.setSelectionRange(pos, pos); } catch { /* */ }
    const n = M.parseVN(formatted); it[f] = n;
    if (it.formulas) delete (it.formulas as Record<string, string>)[f];
    if ((items[i].kind === "section" || items[i].kind === "subsection") && f === "quantity" && n > 1 && !groupSubtotal) onGroupSubtotal?.(true);
    closeAuto(); clearActiveRefs();
    recomputeAll(); onChange();   // FIX: sửa 1 ô → ô CÔNG THỨC tham chiếu nó phải eval lại trước khi lưu/hiển thị
  };
  const numInput = (i: number, f: "quantity" | "unitPrice" | "days") => {
    const it = items[i]; const fx = it.formulas?.[f]; const val = M.fmtNumCell(it[f] as number);
    // KEY CỐ ĐỊNH (chỉ _k+field): KHÔNG để công thức/giá-trị lật key gây REMOUNT (mất focus khi gõ đè).
    // Hiển thị (kết quả công thức / giá trị sau dán-undo) đồng bộ qua paintCells ở effect (như SPA).
    return (<>
      <input key={`${it._k}-${f}`} data-f={f} inputMode="decimal" defaultValue={val} disabled={!editable}
        title="Số hoặc công thức Excel: =G3*E3, =SUM(H3:H8), 8% — bấm/kéo ô để chèn tham chiếu"
        onInput={(e) => onNumInput(i, f, e.target as HTMLInputElement)} />
      {fx && <button type="button" className="fx-peek-badge" title={"Công thức: " + fx} onClick={() => peekFx(fx, val)}>ƒ</button>}
    </>);
  };
  const txtInput = (i: number, f: string, ph?: string) => (
    <input data-f={f} defaultValue={(items[i][f as keyof M.Item] as string) || ""} placeholder={ph} disabled={!editable}
      onInput={(e) => { const el = e.target as HTMLInputElement; if (el.value.trim().startsWith("=")) { fxAutocomplete(el); highlightActiveFormulaRefs(el.value); } else { (items[i] as Record<string, unknown>)[f] = el.value; closeAuto(); clearActiveRefs(); } syncFxBar(); onChange(); }} />
  );
  const taInput = (i: number, f: string, ph?: string) => (
    <textarea data-f={f} rows={1} defaultValue={(items[i][f as keyof M.Item] as string) || ""} placeholder={ph} disabled={!editable}
      ref={autoGrow} onInput={(e) => { const el = e.target as HTMLTextAreaElement; (items[i] as Record<string, unknown>)[f] = el.value; autoGrow(el); onChange(); }} />
  );
  const fcls = (i: number, f: string, base: string) => base + (items[i].formulas?.[f] ? " has-formula" : "");
  const toggleApprove = (i: number, checked: boolean) => { const it = items[i] as Record<string, unknown>; it.approved = checked; it.approvedAt = checked ? new Date().toISOString() : null; onChange(); };

  // Sau mỗi render: (1) ĐỒNG BỘ mọi ô KHÔNG-focus về model (như SPA redraw — dán/undo/recompute hiển
  // thị đúng mà KHÔNG remount → không mất focus); (2) focus ô đích (paste/nav/undo); (3) tô lại vùng chọn.
  useEffect(() => {
    const tb = tableRef.current;
    if (tb) {
      tb.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("[data-f]").forEach((el) => {
        if (document.activeElement === el) return;   // ô đang gõ → để yên
        const tr = el.closest("tr[data-row]"); if (!tr) return;
        const i = parseInt(tr.getAttribute("data-row") || "-1", 10); if (i < 0 || i >= items.length) return;
        const f = el.getAttribute("data-f") as string; const rec = items[i] as Record<string, unknown>;
        const want = NUMERIC.has(f) ? M.fmtNumCell(rec[f] as number) : ((rec[f] as string) ?? "");
        if (el.value !== want) { el.value = want; if (el.tagName === "TEXTAREA") autoGrow(el as HTMLTextAreaElement); }
      });
    }
    if (focusPend.current && tableRef.current) {
      const { i, f } = focusPend.current; focusPend.current = null;
      const el = tableRef.current.querySelector(`tr[data-row="${i}"] [data-f="${f}"]`) as HTMLInputElement | HTMLTextAreaElement | null;
      if (el) {
        // Ô đích (paste/nav) có thể vừa là activeElement → paintCells đã SKIP nên còn giá trị CŨ.
        // Đồng bộ về model trước khi focus (ô công thức để onGridFocus hiện =… lúc focus).
        const rec = items[i] as Record<string, unknown>;
        const fx = (rec.formulas as Record<string, string> | undefined)?.[f];
        if (!fx) { const want = NUMERIC.has(f) ? M.fmtNumCell(rec[f] as number) : ((rec[f] as string) ?? ""); if (el.value !== want) { el.value = want; if (el.tagName === "TEXTAREA") autoGrow(el as HTMLTextAreaElement); } }
        navigatingRef.current = true; el.focus(); try { el.select(); } catch { /* */ } navigatingRef.current = false;
      }
    }
    paintSel();
  });

  // ── derived ───────────────────────────────────────────────────────────────────
  const rk = M.computeRowKinds(items);
  const sectionSum: Record<number, number> = {};
  { let cur = -1; for (let i = 0; i < items.length; i++) { if (rk[i] === "section") { cur = i; sectionSum[i] = 0; } else if ((rk[i] === "head" || rk[i] === "sub") && cur >= 0) sectionSum[cur] += M.lineAmount(items[i], usesDays); } }
  const extraCols = (internalNote ? 1 : 0) + (approveCol ? 1 : 0) + (payCol ? 1 : 0);
  const infoColspan = 6 + (showDetail ? 1 : 0) + (usesDays ? 1 : 0) + extraCols;
  let sttNo = 0, sectionIdx = -1, subNo = 0;

  // ── XEM CÔNG THỨC ô KHÓA (như Excel) ────────────────────────────────────────
  // Double-click ô khóa (Thành Tiền / Đơn giá nhóm / Thành tiền nhóm / Tổng sheet) → hiện công
  // thức (chỉ đọc) ở thanh fx + sáng ô tham chiếu. Chỉ minh bạch cách tính, không sửa được.
  const Lq = letterOf("quantity"), Lp = letterOf("unitPrice"), Ld = letterOf("days"), La = letterOf("_amount");
  const childAmountRange = (si: number): [number, number] | null => {
    let first: number | null = null, last = 0;
    for (let j = si + 1; j < items.length; j++) {
      const k = items[j].kind;
      if (k === "section" || k === "subsection") break;
      if (k === "info") continue;
      if (first == null) first = j; last = j;
    }
    return first == null ? null : [first + 1, last + 1];
  };
  const setFxBar = (addr: string | null, formula: string | null) => {
    if (!fxBar) return;
    if (fxAddrRef.current) fxAddrRef.current.textContent = addr || "—";
    if (fxInputRef.current) { fxInputRef.current.value = formula || ""; fxInputRef.current.readOnly = true; }
    highlightActiveFormulaRefs(formula || "");
  };
  // Toggle: bấm đúp → hiện CÔNG THỨC ngay TRONG ô (chữ xanh, mono); bấm đúp lần nữa → về số.
  const toggleCellFormula = (td: HTMLElement, addr: string, formula: string) => {
    if (td.dataset.fxShown) {
      td.textContent = td.dataset.fxVal || "";
      td.style.color = ""; td.style.fontFamily = ""; td.style.fontWeight = ""; td.style.fontSize = ""; td.style.whiteSpace = "";
      delete td.dataset.fxShown; delete td.dataset.fxVal; td.removeAttribute("title");
      setFxBar(null, null);
    } else {
      td.dataset.fxVal = td.textContent || ""; td.dataset.fxShown = "1";
      td.textContent = formula; td.title = formula;
      td.style.color = "#15803d"; td.style.fontFamily = "ui-monospace, SFMono-Regular, Menlo, monospace"; td.style.fontWeight = "600"; td.style.fontSize = "11.5px"; td.style.whiteSpace = "nowrap";
      setFxBar(addr, formula);
    }
  };
  const revealAmount = (i: number, td: HTMLElement) => {
    const it = items[i]; if (!it) return;
    let addr: string | null = null, formula: string | null = null;
    if (it.kind === "section" || it.kind === "subsection") {
      if (!groupSubtotal) return;
      const rng = childAmountRange(i); if (!rng) return;
      addr = `${La}${i + 1}`; formula = `=SUM(${La}${rng[0]}:${La}${rng[1]})*${Lq}${i + 1}`;   // Thành tiền nhóm = (Σ con) × SL nhóm
    } else if (it.kind === "item" || it.kind === "sub") {
      addr = `${La}${i + 1}`; formula = usesDays ? `=${Lq}${i + 1}*${Ld}${i + 1}*${Lp}${i + 1}` : `=${Lq}${i + 1}*${Lp}${i + 1}`;  // SL × ĐG (× Ngày)
    }
    if (formula) toggleCellFormula(td, addr as string, formula);
  };
  const revealSectionPrice = (i: number, td: HTMLElement) => {
    const rng = childAmountRange(i); if (!rng) return;
    toggleCellFormula(td, `${Lp}${i + 1}`, `=SUM(${La}${rng[0]}:${La}${rng[1]})`);   // Đơn giá nhóm = Σ Thành Tiền mục con
  };
  const revealSheetTotal = (td: HTMLElement) => {
    const rows: number[] = [];
    if (groupSubtotal) {
      let inGroup = false;
      for (let i = 0; i < items.length; i++) { const k = items[i].kind; if (k === "section" || k === "subsection") { rows.push(i); inGroup = true; } else if ((k === "item" || k === "sub") && !inGroup) rows.push(i); }
    } else {
      for (let i = 0; i < items.length; i++) { const k = items[i].kind; if (k === "item" || k === "sub") rows.push(i); }
    }
    if (rows.length) toggleCellFormula(td, "Tổng", "=" + rows.map((r) => `${La}${r + 1}`).join("+"));
  };
  const fxTitle = fxBar ? "Bấm đúp để xem công thức (như Excel)" : undefined;
  // Như Excel: bấm sang chỗ khác → ô đang hiện công thức TỰ về số. Gắn 1 lần toàn cục.
  useEffect(() => {
    if (document.body.dataset.fxRevertBound) return;
    document.body.dataset.fxRevertBound = "1";
    const onDown = (ev: MouseEvent) => {
      const shown = document.querySelectorAll<HTMLElement>("[data-fx-shown]");
      if (!shown.length) return;
      const target = ev.target as Node;
      shown.forEach((td) => {
        if (td === target || td.contains(target)) return;   // bấm trong chính ô đó → giữ
        td.textContent = td.getAttribute("data-fx-val") || "";
        td.style.color = ""; td.style.fontFamily = ""; td.style.fontWeight = ""; td.style.fontSize = ""; td.style.whiteSpace = "";
        td.removeAttribute("data-fx-shown"); td.removeAttribute("data-fx-val"); td.removeAttribute("title");
      });
      if (!document.querySelector("[data-fx-shown]")) {
        const inEl = document.getElementById("fx-input") as HTMLInputElement | null; if (inEl && inEl.readOnly) inEl.value = "";
        const addrEl = document.getElementById("fx-addr"); if (addrEl) addrEl.textContent = "—";
        document.querySelectorAll<HTMLElement>("td.cell-ref-active").forEach((t) => { t.classList.remove("cell-ref-active"); t.style.removeProperty("--ref-color"); });
      }
    };
    document.addEventListener("mousedown", onDown, true);
  }, []);

  const dataCells = (i: number) => (
    <>
      {showDetail && <td className="col-detail">{taInput(i, "detail")}</td>}
      <td className="col-dvt">{txtInput(i, "unit")}</td>
      <td className={fcls(i, "quantity", "col-qty")} style={{ position: "relative" }}>{numInput(i, "quantity")}</td>
      {usesDays && <td className={fcls(i, "days", "col-qty")} style={{ position: "relative" }}>{numInput(i, "days")}</td>}
      <td className={fcls(i, "unitPrice", "col-price")} style={{ position: "relative" }}>{numInput(i, "unitPrice")}</td>
      <td className="col-amount" title={fxTitle} onDoubleClick={(e) => revealAmount(i, e.currentTarget)}>{M.fmtNumCell(M.lineAmount(items[i], usesDays))}</td>
      <td className="col-notes">{taInput(i, "notes")}</td>
      {internalNote && <td className="col-internal-note">{taInput(i, "internalNote", "(không xuất Excel)")}</td>}
      {approveCol && <td className="col-approve">{editable ? <label className="ap-wrap"><input type="checkbox" defaultChecked={!!items[i].approved} disabled={!canApprove} onChange={(e) => toggleApprove(i, e.target.checked)} /> Duyệt</label> : (items[i].approved ? "✓" : "")}{items[i].approved && items[i].approvedAt ? <span className="ap-date"> ✓ {M.fmtDate(items[i].approvedAt)}</span> : null}</td>}
      {payCol && <td className="col-pay">{canPay
        ? <button type="button" className={`btn btn-xs ${(items[i] as Record<string, unknown>).paid ? "btn-success" : ""}`} onClick={() => onPayRow?.(items[i])}>{(items[i] as Record<string, unknown>).paid ? "✓ Đã TT" : "Thanh toán"}</button>
        : ((items[i] as Record<string, unknown>).paid ? <span className="ap-date">✓ Đã TT</span> : "")}
        {(items[i] as Record<string, unknown>).paid && (items[i] as Record<string, unknown>).paidAt ? <span className="ap-date"> {M.fmtDate(String((items[i] as Record<string, unknown>).paidAt))}</span> : null}
        {(items[i] as Record<string, unknown>).hasPaidProof ? <span title="Có ảnh chứng từ"> 📎</span> : null}</td>}
      {editable && <td className="col-action"><button className="add-sub" title="Thêm hàng con" onClick={() => addSubAfter(i)}>↳</button><button className="rm-row" title="Xóa hàng" onClick={() => removeRow(i)}>✕</button></td>}
    </>
  );

  return (
    <>
      {fxBar && (
        <div className="fx-bar" id="fx-bar">
          <span className="fx-addr" id="fx-addr" ref={fxAddrRef} title="Ô đang chọn">—</span>
          <span className="fx-fx" title="Công thức">fx</span>
          <input type="text" id="fx-input" className="fx-input" ref={fxInputRef} autoComplete="off" spellCheck={false} disabled={!editable}
            placeholder="Công thức… vd =SUM(H3:H8) · =G3*E3 — bấm/kéo ô để chèn tham chiếu"
            onKeyDown={(e) => {
              if (autoRef.current) { if (e.key === "ArrowDown") { e.preventDefault(); moveAuto(1); return; } if (e.key === "ArrowUp") { e.preventDefault(); moveAuto(-1); return; } if (e.key === "Tab") { e.preventDefault(); acceptAuto(); return; } if (e.key === "Escape") { e.preventDefault(); closeAuto(); return; } if (e.key === "Enter") closeAuto(); }
              if (e.key === "Enter") { e.preventDefault(); applyFxBar(true); } else if (e.key === "Escape") { e.preventDefault(); syncFxBar(); (e.target as HTMLInputElement).blur(); }
            }}
            onInput={(e) => { const el = e.target as HTMLInputElement; fxAutocomplete(el); highlightActiveFormulaRefs(el.value); }} />
        </div>
      )}
      <div className="tbl-scroll">
        <table className="excel-table" ref={tableRef} onPaste={onPaste} onKeyDown={onGridKeyDown} onFocus={onGridFocus} onBlur={onGridBlur}
          onMouseDownCapture={onPointMouseDown} onMouseDown={onSelDragStart}
          onCopy={(e) => onCopyCut(e, false)} onCut={(e) => onCopyCut(e, true)}>
          <thead>
            <tr>
              <th scope="col" style={{ width: 50 }}>STT</th>
              <th scope="col">Hạng Mục</th>
              {showDetail && <th scope="col">Chi Tiết</th>}
              <th scope="col" style={{ width: 80 }}>ĐVT</th>
              <th scope="col" style={{ width: 90 }}>SỐ LƯỢNG</th>
              {usesDays && <th scope="col" style={{ width: 80 }}>SỐ NGÀY</th>}
              <th scope="col" style={{ width: 130 }}>ĐƠN GIÁ</th>
              <th scope="col" style={{ width: 140 }}>THÀNH TIỀN</th>
              <th scope="col" style={{ width: 150 }}>GHI CHÚ</th>
              {internalNote && <th scope="col" style={{ width: 150 }} className="th-internal-note" title="Chỉ xem/quản lý nội bộ — KHÔNG xuất ra Excel/PDF">GHI CHÚ NỘI BỘ<br /><span style={{ fontWeight: 400, fontSize: 10, opacity: 0.75 }}>(không xuất Excel)</span></th>}
              {approveCol && <th scope="col" style={{ width: 120 }}>DUYỆT</th>}
              {payCol && <th scope="col" style={{ width: 140 }}>THANH TOÁN</th>}
              {editable && <th scope="col" style={{ width: 36 }} />}
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => {
              if (rk[i] === "section") {
                const isSub = it.kind === "subsection";
                let letter = "";
                if (!isSub) { sectionIdx++; letter = M.groupLetter(sectionIdx); subNo = 0; }
                else if (numberSubs) { letter = String(++subNo); }
                sttNo = 0;
                const subAmt = sectionSum[i] || 0;
                return (
                  <tr key={it._k ?? i} data-row={i} className={`section-row${isSub ? " subgroup-row" : ""}`}>
                    <td className="col-stt"><input data-f="label" defaultValue={it.label || ""} placeholder={letter} disabled={!editable} style={{ width: 34, textAlign: "center" }} onInput={(e) => { (items[i] as Record<string, unknown>).label = (e.target as HTMLInputElement).value; onChange(); }} /></td>
                    <td className="col-hangmuc"><textarea data-f="name" rows={1} defaultValue={it.name || ""} placeholder={isSub ? "Tên nhóm con" : "Tên nhóm (vd: Wallsticker)"} disabled={!editable} ref={autoGrow} onInput={(e) => { (items[i] as Record<string, unknown>).name = (e.target as HTMLTextAreaElement).value; autoGrow(e.target as HTMLTextAreaElement); onChange(); }} /></td>
                    {showDetail && <td className="col-detail" />}
                    <td className="col-dvt">{txtInput(i, "unit")}</td>
                    <td className={fcls(i, "quantity", "col-qty")} style={{ position: "relative" }}>{numInput(i, "quantity")}</td>
                    {usesDays && <td className="col-qty" />}
                    <td className="col-price" title={fxTitle} onDoubleClick={(e) => revealSectionPrice(i, e.currentTarget)}>{M.fmtNumCell(subAmt)}</td>
                    <td className="col-amount" title={fxTitle} onDoubleClick={(e) => revealAmount(i, e.currentTarget)}>{groupSubtotal ? M.fmtNumCell(subAmt * Math.max(1, Number(it.quantity) || 1)) : ""}</td>
                    <td className="col-notes">{taInput(i, "notes", "Ghi chú nhóm")}</td>
                    {internalNote && <td className="col-internal-note">{taInput(i, "internalNote", "(không xuất Excel)")}</td>}
                    {approveCol && <td className="col-approve" />}
                    {payCol && <td className="col-pay" />}
                    {editable && <td className="col-action"><button className="rm-row" title={isSub ? "Xóa nhóm con" : "Xóa nhóm"} onClick={() => removeRow(i)}>✕</button></td>}
                  </tr>
                );
              }
              if (rk[i] === "info") {
                return (
                  <tr key={it._k ?? i} data-row={i} className="info-row">
                    <td className="col-stt" />
                    <td className="col-info" colSpan={infoColspan}><textarea data-f="name" rows={1} defaultValue={it.name || ""} placeholder="Dòng thông tin chương trình (không tính tiền)" disabled={!editable} ref={autoGrow} onInput={(e) => { (items[i] as Record<string, unknown>).name = (e.target as HTMLTextAreaElement).value; autoGrow(e.target as HTMLTextAreaElement); onChange(); }} /></td>
                    {editable && <td className="col-action"><button className="rm-row" title="Xóa" onClick={() => removeRow(i)}>✕</button></td>}
                  </tr>
                );
              }
              if (rk[i] === "sub") return <tr key={it._k ?? i} data-row={i} className="sub-row">{dataCells(i)}</tr>;
              sttNo++;
              const span = M.rowspanOf(rk, i);
              return (
                <tr key={it._k ?? i} data-row={i} className={`grp-head${span > 1 ? " has-subs" : ""}`}>
                  <td className="col-stt" rowSpan={span}>{numberSubs ? "" : sttNo}</td>
                  <td className="col-hangmuc" rowSpan={span}><textarea data-f="name" rows={1} defaultValue={it.name || ""} disabled={!editable} ref={autoGrow} onInput={(e) => { (items[i] as Record<string, unknown>).name = (e.target as HTMLTextAreaElement).value; autoGrow(e.target as HTMLTextAreaElement); onChange(); }} /></td>
                  {dataCells(i)}
                </tr>
              );
            })}
            {items.length === 0 && <tr><td colSpan={12} className="muted" style={{ textAlign: "center", padding: 18 }}>Chưa có hàng nào — bấm “+ Thêm hàng” bên dưới.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="grid-stat hidden" ref={statRef} />
      {fxBar && (
        <div style={{ textAlign: "right", fontWeight: 600, margin: "6px 2px", fontSize: 13.5 }}>
          Tổng sheet: <span style={{ color: "var(--danger)", cursor: "pointer" }} title={fxTitle} onDoubleClick={(e) => revealSheetTotal(e.currentTarget)}>{M.fmtMoney(M.sheetSubtotalGrouped(items, usesDays, groupSubtotal))}</span>
        </div>
      )}

      {editable && (
        <div className="grid-add-bar" style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "10px 0" }}>
          <button className="btn btn-sm" onClick={addItem}>+ Thêm hàng</button>
          <button className="btn btn-sm" onClick={addSection}>+ Thêm nhóm</button>
          <button className="btn btn-sm" onClick={addSubSection}>+ Nhóm con</button>
          <button className="btn btn-sm" onClick={addInfo}>+ Dòng thông tin</button>
        </div>
      )}
      {editable && onGroupSubtotal && (
        <label className="toggle-totals gf-group-sub" style={{ display: "inline-flex", alignItems: "center", gap: 8, margin: "2px 0 8px", fontSize: 13, cursor: "pointer" }}>
          <input type="checkbox" checked={groupSubtotal} onChange={(e) => onGroupSubtotal(e.target.checked)} />
          <span>Hiện <strong>Thành Tiền nhóm</strong> (Số Lượng nhóm × tổng các mục trong nhóm)</span>
        </label>
      )}
    </>
  );
}
