import { useEffect, useRef, useState } from "react";
import { toast } from "../lib/ui";
import * as M from "../lib/quoteMath";
import { evalFormula, type FormulaRefs } from "../lib/formula";
import { type ItemK, nextK, autoGrow } from "../lib/gridShared";
import { parseClipboardTSV, cellsToTSV, cellsToHTML, parseLooseNumber, reconstructExportRows, looksLikeExportPaste, isHeaderRow, headerToRoles, retargetPastedFormulas } from "../lib/clipboard";
import { loadCatalog, searchEntries, dimLabel, fillItemFromEntry, type VenueEntry } from "../lib/venueCatalog";
import { VenuePicker } from "./VenuePicker";

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
  /** Mẫu TỪNG có cột Chi Tiết (nay ẩn) → sơ đồ địa chỉ ô A1 vẫn chừa 1 cột cho nó, để công thức
   *  đã lưu của báo giá cũ (=F3*E3…) không bị dịch cột. Mặc định = showDetail. */
  addrDetail?: boolean;
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
  showImages?: boolean;            // BẬT cột "Hình ảnh" (ảnh mỗi hạng mục, xuất Excel)
  onShowImages?: (v: boolean) => void;
  onChange: () => void;
  fxBar?: boolean;                 // chỉ lưới chính bật thanh công thức
  clfTheme?: boolean;              // lưới của Colorfull → giữ MÀU CŨ (web theo công ty, khớp Excel)
};

type Sel = { anchor: { row: number; field: string }; focus: { row: number; field: string } };
type Addr = { row: number; field: string; L: string };
const MULTILINE = new Set(["name", "detail", "notes", "internalNote"]);
const FN_LIST = ["SUM", "PRODUCT", "AVERAGE", "AVG", "MIN", "MAX", "ROUND", "ROUNDUP", "ROUNDDOWN", "INT", "ABS", "CEILING", "FLOOR"];
const REF_COLORS = ["#1f7a3d", "#15803d", "#2e7d32", "#4d7c0f", "#0b7a4b", "#3d8b37"];

export function GridTable(props: GridTableProps) {
  const { items, usesDays, showDetail, addrDetail, numberSubs, editable, internalNote, approveCol, canApprove, payCol, canPay, onPayRow, groupSubtotal, onGroupSubtotal, showImages, onShowImages, onChange, fxBar, clfTheme } = props;
  const keepDetailSlot = addrDetail ?? showDetail;   // chừa chỗ trong sơ đồ địa chỉ ô (xem prop)
  const undoRef = useRef<string[]>([]);
  const redoRef = useRef<string[]>([]);
  const focusRef = useRef<{ i: number; f: string } | null>(null);
  const focusPend = useRef<{ i: number; f: string } | null>(null);
  const tableRef = useRef<HTMLTableElement | null>(null);
  const selRef = useRef<Sel | null>(null);
  const clearOutsideRef = useRef<() => void>(() => {});
  const navigatingRef = useRef(false);
  const pickingRef = useRef(false);
  // CHẾ ĐỘ Ô — đủ 3 chế độ như Excel thật:
  //   READY (editing=false): ô được CHỌN, khóa readOnly — mũi tên đi ô khác, Ctrl+C copy cả ô,
  //     GÕ LÀ ĐÈ (type-to-replace: nội dung cũ thay bằng ký tự vừa gõ — đúng nếp Excel).
  //   ENTER (editing=true, mode="enter"): đang gõ đè — mũi tên CHỐT nội dung + đi ô kế.
  //   EDIT  (editing=true, mode="edit", vào bằng nhấp đúp/F2): sửa trong chữ — mũi tên chạy
  //     trong chữ, KHÔNG rời ô; F2 bấm lại luân phiên EDIT ↔ ENTER (như Excel).
  const editingRef = useRef(false);
  const editModeRef = useRef<"enter" | "edit" | null>(null);   // null khi READY
  // CẮT kiểu Excel: Ctrl+X chỉ ĐÁNH DẤU vùng nguồn (viền nét đứt) — dữ liệu chỉ bị xoá khi DÁN
  // xong (di chuyển), Esc thì huỷ. Không như cut của trình soạn thảo (xoá ngay).
  const cutPendingRef = useRef<{ token: number; r0: number; c0: number; r1: number; c1: number } | null>(null);
  // Point-mode BÀN PHÍM: đang gõ công thức, ký tự trước con trỏ là toán tử → mũi tên CHỌN Ô THAM
  // CHIẾU (=  ↑ → "=H3", Shift+mũi tên kéo thành vùng "=H3:H5") — đúng thao tác gõ công thức Excel.
  const kbRefRef = useRef<{ el: HTMLInputElement | HTMLTextAreaElement; base: string; after: string; start: { row: number; col: number }; cur: { row: number; col: number }; fresh: boolean } | null>(null);
  // Ô đang trong MỘT phiên gõ (đã ghi mốc undo). Gõ 10 ký tự vào cùng ô chỉ sinh 1 mốc → Ctrl+Z
  // lùi cả ô như Excel, không phải bấm 10 lần. Xoá khi rời ô (onGridBlur) để lần vào sau ghi mốc mới.
  const editUndoRef = useRef<{ i: number; f: string } | null>(null);
  // Thiết bị cảm ứng: giữ hành vi gõ trực tiếp (không ép chọn-cả-ô) để bàn phím ảo hoạt động bình thường.
  const coarsePointer = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  // Nhãn phím lệnh theo máy: macOS ⌘ · Windows/Linux Ctrl (mọi phím tắt nhận CẢ HAI).
  const modKey = typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent) ? "⌘" : "Ctrl";
  const copyBufRef = useRef<{ tsv: string; token: number; kinds?: string[]; c0?: number } | null>(null);
  const copyTokenRef = useRef(0);
  const autoRef = useRef<{ input: HTMLInputElement | HTMLTextAreaElement; items: string[]; idx: number } | null>(null);
  const fxAddrRef = useRef<HTMLSpanElement | null>(null);
  const fxInputRef = useRef<HTMLInputElement | null>(null);
  const statRef = useRef<HTMLDivElement | null>(null);
  const [, setImgVer] = useState(0);   // ép vẽ lại khi thêm/xoá ảnh (input không kiểm soát vẫn giữ nguyên)
  // Gợi ý kích thước theo rạp: dropdown dưới ô Hạng Mục + modal "Chèn từ rạp".
  type Sug = { i: number; el: HTMLTextAreaElement; items: VenueEntry[]; idx: number; rect: { left: number; top: number; width: number } };
  const [sug, setSug] = useState<Sug | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const FIELDS = (["name", showDetail ? "detail" : null, "unit", "quantity", usesDays ? "days" : null, "unitPrice", "notes", internalNote ? "internalNote" : null].filter(Boolean)) as string[];
  const NUMERIC = new Set(["quantity", "unitPrice", "days"]);
  const snap = () => JSON.stringify(items);
  const pushUndo = () => { undoRef.current.push(snap()); if (undoRef.current.length > 100) undoRef.current.shift(); redoRef.current.length = 0; };
  // Ghi mốc undo cho ô đang gõ — CHỈ ở ký tự đầu của phiên, và PHẢI gọi TRƯỚC khi ghi giá trị mới
  // vào items (onNumInput ghi thẳng vào model mỗi lần gõ, chụp sau là dính luôn số mới).
  const markEditUndo = (i: number, f: string) => {
    const m = editUndoRef.current;
    if (m && m.i === i && m.f === f) return;
    pushUndo(); editUndoRef.current = { i, f };
  };
  const focusCell = (i: number, f: string, preserveSelection = false) => {
    if (!preserveSelection) selRef.current = { anchor: { row: i, field: f }, focus: { row: i, field: f } };
    editingRef.current = false;
    editModeRef.current = null;
    focusPend.current = { i, f };
  };

  // ── A1 addressing + công thức ───────────────────────────────────────────────
  const ADDR: { f: string; ro?: boolean; L: string }[] = [
    { f: "_stt", ro: true, L: "" }, { f: "name", L: "" },
    // Cột Chi Tiết dù ĐÃ ẨN vẫn giữ chỗ trong sơ đồ địa chỉ (keepDetailSlot) → công thức cũ
    // "=F3*E3" của báo giá đã lưu vẫn trỏ đúng Đơn giá × Số lượng.
    ...(keepDetailSlot ? [{ f: "detail", L: "" }] : []),
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
    // Người dùng đã sửa ô → bỏ cờ "công thức Excel chưa dịch được" (ô đỏ) của ô này.
    const fw = it._fxWarn as Record<string, boolean> | undefined;
    if (fw && fw[f]) { delete fw[f]; if (!Object.keys(fw).length) delete it._fxWarn; }
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
    const inp = tr.querySelector(`[data-f="${field}"]`);
    if (inp) return inp.closest("td") as HTMLElement;
    // Hàng NHÓM/NHÓM CON: ĐƠN GIÁ (và vài cột) là ô TÍNH — không có input data-f → dò theo CLASS cột
    // để công thức nhóm cha =SUM(F2,F5) vẫn SÁNG được ô đơn giá các nhóm con.
    const cls = ({ unitPrice: ".col-price", quantity: ".col-qty", days: ".col-qty", name: ".col-hangmuc", detail: ".col-detail", unit: ".col-dvt", notes: ".col-notes" } as Record<string, string>)[field];
    return cls ? (tr.querySelector(cls) as HTMLElement | null) : null;
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
    tb.querySelectorAll("td.cell-selected, td.cell-anchor, td.cell-cut").forEach((td) => td.classList.remove("cell-selected", "cell-anchor", "cell-cut"));
    tb.querySelectorAll(".fill-handle").forEach((h) => h.remove());
    // Vùng đang CẮT chờ dán → viền nét đứt (kiểu "marching ants" của Excel).
    const cp = cutPendingRef.current;
    if (cp) for (let r = cp.r0; r <= cp.r1; r++) for (let c = cp.c0; c <= cp.c1; c++) tdOf(r, FIELDS[c])?.classList.add("cell-cut");
    const sel = selRef.current; const rc = rectOf(sel);
    if (rc && sel) {
      // tdOf (không phải cellEl): hàng NHÓM/NHÓM CON có ô tính (không có input) vẫn được tô →
      // vùng chọn hiện liền mạch khi kéo qua nhóm, như Excel.
      for (let r = rc.r0; r <= rc.r1; r++) for (let c = rc.c0; c <= rc.c1; c++) tdOf(r, FIELDS[c])?.classList.add("cell-selected");
      (cellEl(sel.anchor.row, sel.anchor.field)?.closest("td") || tdOf(sel.anchor.row, sel.anchor.field))?.classList.add("cell-anchor");
      if (editable) {
        const td = cellEl(rc.r1, FIELDS[rc.c1])?.closest("td");
        if (td) {
          const h = document.createElement("div"); h.className = "fill-handle";
          h.title = "Kéo để chép xuống · nhấp đúp để chép tới hàng cuối";
          h.addEventListener("mousedown", onFillHandleDown);
          // Nhấp đúp ô vuông fill → chép tới HÀNG CUỐI bảng (như Excel).
          h.addEventListener("dblclick", (ev) => {
            ev.preventDefault(); ev.stopPropagation();
            const s = selRef.current; if (!s || items.length < 2) return;
            selRef.current = { anchor: s.anchor, focus: { row: items.length - 1, field: s.focus.field } };
            paintSel(); fillDown();
          });
          td.appendChild(h);
        }
      }
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
  // MỞ ô để SỬA. mode="edit" (nhấp đúp/F2): mũi tên chạy trong chữ; mode="enter" (gõ đè):
  // mũi tên chốt + đi ô kế. caretEnd=true → nháy cuối chữ; mặc định giữ con trỏ tại chỗ bấm.
  const enterEdit = (el: HTMLInputElement | HTMLTextAreaElement | null, opt: { caretEnd?: boolean } = {}, mode: "enter" | "edit" = "edit") => {
    editingRef.current = true;
    editModeRef.current = mode;
    if (!el) return;
    el.readOnly = false; el.classList.remove("cell-lock");
    if (opt.caretEnd) { const n = (el.value || "").length; try { el.setSelectionRange(n, n); } catch { /* */ } }
  };
  // GÕ LÀ ĐÈ (Excel READY → ENTER): xoá nội dung cũ, mở khóa, KHÔNG preventDefault — trình duyệt
  // tự chèn ký tự sắp gõ (hoặc cụm IME tiếng Việt) vào ô rỗng. Mốc undo đặt TRƯỚC khi xoá.
  const typeToReplace = (el: HTMLInputElement | HTMLTextAreaElement | null, i: number, f: string) => {
    if (!editable || !el) return;
    markEditUndo(i, f);
    enterEdit(el, {}, "enter");
    el.value = "";
    if (el.tagName === "TEXTAREA") autoGrow(el as HTMLTextAreaElement);
  };
  // CHỌN ô (READY): khóa readOnly — bấm nhầm chuột không đặt con trỏ lung tung, nhưng GÕ vẫn
  // ăn ngay theo kiểu đè (typeToReplace ở onGridKeyDown). .cell-lock giữ ô nhìn bình thường.
  const lockCell = (el: HTMLInputElement | HTMLTextAreaElement | null) => {
    editingRef.current = false;
    editModeRef.current = null;
    if (kbRefRef.current) { kbRefRef.current = null; clearRefPick(); }
    if (!el || !editable || !el.getAttribute?.("data-f")) return;
    el.readOnly = true; el.classList.add("cell-lock");
    try { el.setSelectionRange(0, 0); } catch { /* */ }
  };
  // Point-mode BÀN PHÍM (Excel): đang gõ công thức (chế độ ENTER) mà ký tự trước con trỏ là
  // "="/toán tử/"("/","… → mũi tên CHÈN THAM CHIẾU Ô rồi di chuyển nó ("=" ↑ → "=H3");
  // Shift+mũi tên kéo thành VÙNG ("=SUM(" ↑ Shift+↑ → "=SUM(H3:H2"). Gõ ký tự thường tiếp theo
  // thì tham chiếu đông cứng (kbRefRef reset ở onGridKeyDown) — đúng thao tác gõ công thức Excel.
  const tryKbRef = (el: HTMLInputElement | HTMLTextAreaElement, i: number, f: string, e: { key: string; shiftKey: boolean }): boolean => {
    const dy = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
    const dx = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    let st = kbRefRef.current;
    if (!st || st.el !== el) {
      const val = el.value || ""; const caret = el.selectionStart ?? val.length;
      const left = val.slice(0, caret);
      if (!/[=+\-*/(,;:^<>&]\s*$/.test(left)) return false;   // sau chữ/số thường → không phải chỗ chèn ref
      const col0 = idxOfL(letterOf(f));
      if (col0 < 0) return false;
      st = { el, base: left, after: val.slice(caret), start: { row: i, col: col0 }, cur: { row: i, col: col0 }, fresh: true };
    }
    const cR = (r: number) => Math.max(0, Math.min(items.length - 1, r));
    const cC = (c: number) => Math.max(0, Math.min(ADDR.length - 1, c));
    const moved = { row: cR(st.cur.row + dy), col: cC(st.cur.col + dx) };
    if (st.fresh || !e.shiftKey) { st.start = { ...moved }; st.cur = moved; st.fresh = false; }
    else st.cur = moved;   // Shift giữ đầu neo, kéo thành vùng
    kbRefRef.current = st;
    const mk = (p: { row: number; col: number }): Addr => ({ row: p.row, field: ADDR[p.col].f, L: ADDR[p.col].L });
    const a = mk(st.start), b = mk(st.cur);
    const ref = rangeAddr(a, b);
    el.value = st.base + ref + st.after;
    const pos = (st.base + ref).length;
    try { el.setSelectionRange(pos, pos); } catch { /* */ }
    paintRefPick(a, b);
    el.dispatchEvent(new Event("input", { bubbles: true }));   // đường onInput sẵn có: ghi model live + eval + sáng ref
    return true;
  };
  const moveTo = (row: number, field: string, extend: boolean, prefer: -1 | 0 | 1 = 0) => {
    row = Math.max(0, Math.min(items.length - 1, row));
    const ci = Math.max(0, Math.min(FIELDS.length - 1, fieldIdx(field)));
    let f2 = FIELDS[ci];
    if (!cellEl(row, f2)) {
      let found: string | null = null;
      for (let d = 1; d < FIELDS.length && !found; d++) {
        const order = prefer > 0 ? [ci + d, ci - d] : prefer < 0 ? [ci - d, ci + d] : [ci - d, ci + d];
        for (const idx of order) if (idx >= 0 && idx < FIELDS.length && cellEl(row, FIELDS[idx])) { found = FIELDS[idx]; break; }
      }
      f2 = found || "name";
    }
    const sel = selRef.current;
    if (extend && sel) selRef.current = { anchor: sel.anchor, focus: { row, field: f2 } };
    else selRef.current = { anchor: { row, field: f2 }, focus: { row, field: f2 } };
    navigatingRef.current = true;
    editingRef.current = false;
    const el = cellEl(row, f2);
    if (el) {
      el.focus();
      // Ô đến luôn ở trạng thái CHỌN (READY) — đúng Excel: Enter/Tab/mũi tên không mở ô kế,
      // nhưng gõ là ĐÈ ngay (typeToReplace) nên nhập liên tục vẫn không phải nhấp đúp.
      lockCell(el);
    }
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
  clearOutsideRef.current = () => { clearSel(); clearActiveRefs(); };
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
    const apply = (info2: Addr) => { curInfo = info2; const ref = rangeAddr(startInfo, info2); fxInput.value = baseLeft + ref + after; const pos = (baseLeft + ref).length; try { fxInput.setSelectionRange(pos, pos); } catch { /* */ } paintRefPick(startInfo, info2); highlightActiveFormulaRefs(fxInput.value);
      // Gương chữ đang gõ dở sang thanh fx. KHÔNG dùng syncFxBar() ở đây: nó đọc formulas[] trong
      // model, mà tham chiếu đang kéo chưa commit vào model → thanh fx sẽ kẹt ở "=SUM(" như cũ.
      if (fxBar && fxInputRef.current && fxInputRef.current !== fxInput) fxInputRef.current.value = fxInput.value; };
    pickingRef.current = true; document.body.classList.add("fx-picking"); apply(startInfo);
    const onMove = (mv: MouseEvent) => { const info2 = cellAddrFromEvent(mv.target as HTMLElement); if (info2) apply(info2); };
    const onUp = () => { document.removeEventListener("mousemove", onMove, true); document.removeEventListener("mouseup", onUp, true); pickingRef.current = false; document.body.classList.remove("fx-picking"); clearRefPick(); fxInput.focus(); const pos = (baseLeft + rangeAddr(startInfo, curInfo)).length; try { fxInput.setSelectionRange(pos, pos); } catch { /* */ } };
    document.addEventListener("mousemove", onMove, true); document.addEventListener("mouseup", onUp, true);
  };
  const onPointMouseDown = (e: { button: number; target: EventTarget | null; preventDefault(): void; stopPropagation(): void }) => {
    if (e.button !== 0) return;
    // CHỈ chèn tham chiếu khi đang THỰC SỰ SỬA công thức (Excel). Ô có sẵn công thức mà chỉ đang
    // được CHỌN thì bấm sang ô khác = chọn ô đó, KHÔNG phải chèn ref (trước đây bị nuốt cú bấm).
    if (!editingRef.current) return;
    const ae = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
    if (!ae || ae.getAttribute?.("data-f") == null) return;
    if (!(ae.value || "").trim().startsWith("=")) return;
    const start = cellAddrFromEvent(e.target as HTMLElement); if (!start) return;
    const aeTr = ae.closest?.("tr[data-row]"); const aeRow = aeTr ? parseInt(aeTr.getAttribute("data-row") || "-1", 10) : -1;
    if (start.row === aeRow && start.field === ae.getAttribute("data-f")) return;   // ô của chính nó → caret thường
    e.preventDefault(); e.stopPropagation();
    startPointDrag(ae, start);
  };
  // Chuột trong lưới (khi KHÔNG ở point-mode) — hành vi Excel:
  //   · bấm ô          → CHỌN ô (READY — gõ là đè, nhấp đúp/F2 mới sửa trong chữ) + kéo chọn vùng
  //   · Shift+bấm      → MỞ RỘNG vùng chọn từ ô neo (không dời neo)
  //   · nhấp đúp       → chế độ SỬA (EDIT), con trỏ ở cuối nội dung
  const onSelDragStart = (e: { button: number; target: EventTarget | null; shiftKey?: boolean; preventDefault(): void }) => {
    if (e.button !== 0 || pickingRef.current) return;
    const info = cellAddrFromEvent(e.target as HTMLElement);
    if (!info || !FIELDS.includes(info.field)) {
      // Ô nhập KHÔNG nằm trong lưới điều hướng (vd nhãn nhóm A/B ở cột STT): bấm lần đầu = chọn
      // (khóa), bấm LẦN NỮA = mở sửa tại chỗ — trước đây bấm lại không mở nên nhãn kẹt readOnly.
      const inp = (e.target as HTMLElement)?.closest?.("[data-f]") as HTMLInputElement | HTMLTextAreaElement | null;
      if (inp && !inp.disabled && !coarsePointer) {
        if (document.activeElement !== inp) {
          e.preventDefault();
          navigatingRef.current = true; inp.focus(); navigatingRef.current = false;
          lockCell(inp);
        } else if (inp.readOnly) enterEdit(inp, { caretEnd: true }, "edit");
      }
      return;
    }
    const el = cellEl(info.row, info.field);

    if (e.shiftKey && selRef.current) {   // mở rộng vùng, giữ nguyên ô neo
      e.preventDefault();
      selRef.current = { anchor: selRef.current.anchor, focus: { row: info.row, field: info.field } };
      lockCell(document.activeElement as HTMLInputElement | HTMLTextAreaElement | null);   // thoát sửa + khóa
      paintSel();
      return;
    }
    if (!coarsePointer && el) {
      // Bấm 1 lần (kể cả bấm lại ô đang chọn) = CHỌN + KHÓA ô. Muốn sửa: nhấp đúp hoặc F2.
      e.preventDefault();
      if (document.activeElement !== el) { navigatingRef.current = true; el.focus(); navigatingRef.current = false; }
      lockCell(el);
    } else editingRef.current = false;
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
  // Dựng bằng DOM node + textContent (KHÔNG innerHTML nội suy) — hôm nay items là FN_LIST cố định,
  // nhưng nếu mai này autocomplete gợi ý từ dữ liệu người dùng thì vẫn miễn nhiễm XSS.
  const renderAuto = () => { const a = autoRef.current; if (!a) return; const el = ensureAutoEl(); el.textContent = ""; a.items.forEach((n, k) => { const d = document.createElement("div"); d.className = `fx-auto-item${k === a.idx ? " active" : ""}`; d.dataset.k = String(k); d.appendChild(document.createTextNode(n)); const s = document.createElement("span"); s.textContent = "( )"; d.appendChild(s); d.addEventListener("mousedown", (ev) => { ev.preventDefault(); if (autoRef.current) { autoRef.current.idx = k; acceptAuto(); } }); el.appendChild(d); }); };
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
    // ĐANG SỬA trong 1 ô → để trình duyệt copy đúng đoạn chữ bôi đen (như Excel ở chế độ sửa).
    // Đang CHỌN ô (kể cả khi nội dung đang bôi đen sẵn) → copy GIÁ TRỊ THÔ của ô/vùng.
    if (editingRef.current && rc.r0 === rc.r1 && rc.c0 === rc.c1) return;
    e.preventDefault();
    const matrix: string[][] = []; const kinds: string[] = [];
    for (let r = rc.r0; r <= rc.r1; r++) { const row: string[] = []; for (let c = rc.c0; c <= rc.c1; c++) row.push(cellRawForCopy(r, FIELDS[c])); matrix.push(row); kinds.push(items[r].kind || "item"); }
    const tsv = cellsToTSV(matrix);   // RFC-4180: ô nhiều dòng được bọc "…" đúng chuẩn
    e.clipboardData.setData("text/plain", tsv);
    e.clipboardData.setData("text/html", cellsToHTML(matrix));   // dán sang Word/Sheets giữ bảng
    const token = ++copyTokenRef.current;
    try { e.clipboardData.setData("application/x-quanly-grid", JSON.stringify({ token, kinds, cols: rc.c1 - rc.c0 + 1, c0: rc.c0 })); } catch { /* */ }
    copyBufRef.current = { tsv, token, kinds, c0: rc.c0 };
    // CẮT kiểu Excel: chưa xoá gì — chỉ đánh dấu vùng nguồn (viền nét đứt). Dán xong mới xoá
    // nguồn (= DI CHUYỂN); Esc huỷ cắt. Copy thường thì bỏ dấu cắt cũ (nếu có).
    if (cut && editable) cutPendingRef.current = { token, ...rc };
    else cutPendingRef.current = null;
    paintSel();
  };
  const cancelCut = () => { if (cutPendingRef.current) { cutPendingRef.current = null; paintSel(); } };
  // Dán xong khối CẮT nội bộ → xoá vùng nguồn (trừ các ô đã bị chính khối dán đè lên) = DI CHUYỂN.
  const finishCutMove = (dest: { r0: number; c0: number; r1: number; c1: number }) => {
    const cp = cutPendingRef.current; if (!cp) return;
    cutPendingRef.current = null;
    for (let r = cp.r0; r <= cp.r1; r++) {
      const it = items[r] as Record<string, unknown> | undefined; if (!it) continue;
      for (let c = cp.c0; c <= cp.c1; c++) {
        if (r >= dest.r0 && r <= dest.r1 && c >= dest.c0 && c <= dest.c1) continue;   // ô nguồn nằm trong vùng dán
        const f = FIELDS[c];
        it[f] = NUMERIC.has(f) ? 0 : "";
        const fx = it.formulas as Record<string, string> | undefined;
        if (fx) { delete fx[f]; if (!Object.keys(fx).length) delete it.formulas; }
      }
    }
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
  // Ctrl/⌘+R — chép ô TRÁI NHẤT của vùng sang các cột còn lại (Excel: Fill Right).
  const fillRight = () => {
    const rc = rectOf(selRef.current); if (!rc || rc.c1 <= rc.c0) return;
    pushUndo();
    for (let r = rc.r0; r <= rc.r1; r++) {
      if (items[r]?.kind === "info") continue;
      const it = items[r] as Record<string, unknown>; const src = FIELDS[rc.c0];
      for (let c = rc.c0 + 1; c <= rc.c1; c++) {
        const f = FIELDS[c];
        it[f] = NUMERIC.has(f) === NUMERIC.has(src) ? it[src] : (NUMERIC.has(f) ? (Number(it[src]) || 0) : String(it[src] ?? ""));
        const fx = it.formulas as Record<string, string> | undefined;
        if (fx && fx[src]) { if (!it.formulas) it.formulas = {}; (it.formulas as Record<string, string>)[f] = fx[src]; }
        else if (fx) delete fx[f];
      }
    }
    autoEnableGroupSub(rc.r0, rc.r1);
    recomputeAll(); onChange();
  };
  // Delete/Backspace khi đang CHỌN ô (không sửa) → xoá sạch nội dung vùng chọn, như Excel.
  const clearRange = () => {
    const rc = rectOf(selRef.current); if (!rc) return;
    pushUndo();
    for (let r = rc.r0; r <= rc.r1; r++) {
      const it = items[r] as Record<string, unknown> | undefined; if (!it) continue;
      for (let c = rc.c0; c <= rc.c1; c++) {
        const f = FIELDS[c];
        it[f] = NUMERIC.has(f) ? 0 : "";
        const fx = it.formulas as Record<string, string> | undefined;
        if (fx) { delete fx[f]; if (!Object.keys(fx).length) delete it.formulas; }
      }
    }
    recomputeAll(); onChange();
    // Ô đang focus bị effect đồng-bộ BỎ QUA → tự dọn giá trị hiển thị + mốc ESC.
    const ae = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
    if (ae?.getAttribute?.("data-f")) { ae.value = ""; if (ae.dataset) ae.dataset.escVal = ""; }
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

  // ── gợi ý kích thước theo rạp (danh mục từ /api/venues/catalog) ───────────────
  const closeSug = () => setSug(null);
  // Gõ ≥2 ký tự vào ô Hạng Mục → tra danh mục (không dấu) và mở dropdown ngay dưới ô.
  const nameSuggest = (i: number, el: HTMLTextAreaElement) => {
    const q = (el.value || "").trim();
    if (!editable || q.length < 2 || q.startsWith("=")) { closeSug(); return; }
    loadCatalog().then((cat) => {
      if (document.activeElement !== el) return;                   // đã rời ô trong lúc chờ tải
      const cur = (el.value || "").trim();
      if (cur.length < 2) { closeSug(); return; }
      const found = searchEntries(cat, cur, 8);
      if (!found.length) { closeSug(); return; }
      const r = el.getBoundingClientRect();
      setSug({ i, el, items: found, idx: -1, rect: { left: r.left, top: r.bottom + 2, width: r.width } });
    }).catch(() => closeSug());   // chưa có file danh mục → im lặng, lưới chạy như thường
  };
  // Chọn 1 gợi ý → điền tên + KT + ĐVT + SL(m²) rồi nhảy tới ô Đơn giá.
  const applySug = (s: Sug, k: number) => {
    const en = s.items[k]; if (!en) return;
    pushUndo();
    fillItemFromEntry(items[s.i] as Record<string, unknown>, en);
    // Ô Hạng Mục đang focus nên effect đồng-bộ-ô sẽ BỎ QUA nó → tự set giá trị hiển thị ngay.
    s.el.value = (items[s.i].name as string) || ""; autoGrow(s.el);
    closeSug(); onChange(); focusCell(s.i, "unitPrice");
  };
  // Chèn hàng loạt từ modal "Chèn từ rạp" — mỗi hạng mục 1 dòng, đã điền sẵn kích thước.
  const insertCatalogRows = (list: VenueEntry[]) => {
    if (!list.length) return;
    pushUndo();
    let at = insertIndex();
    for (const en of list) {
      const it = M.blankItem(usesDays) as ItemK; it._k = nextK();
      fillItemFromEntry(it as unknown as Record<string, unknown>, en);
      items.splice(at, 0, it); at++;
    }
    onChange();
    toast(`Đã chèn ${list.length} hạng mục kèm kích thước — điền nốt Đơn giá là xong`, "success");
  };

  // ── undo/redo + dán Excel khối ─────────────────────────────────────────────────
  // Ô ĐANG focus bị effect đồng-bộ-ô BỎ QUA (để không cướp chữ người dùng đang gõ) → sau undo/redo
  // nó vẫn hiện chữ cũ trong khi cả bảng đã lùi. Tự vẽ lại đúng một ô đó cho khớp model.
  const syncActiveCell = () => {
    const el = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
    const f = el?.getAttribute?.("data-f"); const tr = el?.closest?.("tr[data-row]");
    if (!f || !tr || !el) return;
    const rec = items[parseInt(tr.getAttribute("data-row") || "-1", 10)] as Record<string, unknown> | undefined;
    if (!rec) return;
    const fx = (rec.formulas as Record<string, string> | undefined)?.[f];
    const want = fx ?? (NUMERIC.has(f) ? M.fmtNumCell(rec[f] as number) : ((rec[f] as string) ?? ""));
    if (el.value !== want) { el.value = want; if (el.tagName === "TEXTAREA") autoGrow(el as HTMLTextAreaElement); }
    el.dataset.escVal = el.value;      // mốc ESC phải theo giá trị SAU khi lùi
    editUndoRef.current = null;        // phiên gõ cũ đã bị lùi → gõ tiếp phải ghi mốc MỚI
  };
  const restore = (json: string) => { const arr = JSON.parse(json) as ItemK[]; arr.forEach((it) => { if (it._k == null) it._k = nextK(); }); items.splice(0, items.length, ...arr); recomputeAll(); onChange(); syncActiveCell(); };
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
    // Nếu user copy LUÔN hàng tiêu đề ("STT|Hạng Mục|…") → đọc nó để MAP cột theo file nguồn (dán
    // đúng dù sheet đích khác template, vd nguồn KHÔNG ngày dán vào sheet CÓ ngày), rồi bỏ hàng đó.
    let hdrRoles: string[] | null = null;
    if (rows.length > 1 && isHeaderRow(rows[0])) { hdrRoles = headerToRoles(rows[0]); rows.splice(0, 1); }
    const isGrid = rows.length > 1 || (rows[0] && rows[0].length > 1);

    // 1 giá trị đơn lẻ.
    if (!isGrid) {
      const val = rows[0][0];
      const rc = rectOf(sel);
      // Đang có khối CẮT nội bộ trùng token → dán = DI CHUYỂN (xoá nguồn sau khi ghi đích).
      const movingCut = !!(sameBlock && cutPendingRef.current && internal && internal.token === cutPendingRef.current.token);
      if (rc && (rc.r0 !== rc.r1 || rc.c0 !== rc.c1)) {   // có vùng chọn → fill ra TOÀN vùng (Excel)
        e.preventDefault(); pushUndo();
        for (let r = rc.r0; r <= rc.r1; r++) for (let c = rc.c0; c <= rc.c1; c++) pasteCellVal(r, FIELDS[c], val);
        if (movingCut) finishCutMove(rc);
        autoEnableGroupSub(rc.r0, rc.r1);   // fill SL>1 ra hàng nhóm → tự bật (chống lệch tiền)
        recomputeAll(); onChange(); paintSel();
        return;
      }
      // 1 ô SỐ → parseLooseNumber (US/VN an toàn), KHÔNG để trình duyệt+onNumInput đọc sai (1,000,000→1.0).
      if (f0 && NUMERIC.has(f0)) {
        e.preventDefault(); pushUndo();
        const i0 = rc ? rc.r0 : (focusRef.current?.i ?? 0);
        pasteCellVal(i0, f0, val);
        if (movingCut) finishCutMove({ r0: i0, r1: i0, c0: FIELDS.indexOf(f0), c1: FIELDS.indexOf(f0) });
        recomputeAll(); onChange(); paintSel();
        const el = cellEl(i0, f0); if (el && !items[i0].formulas?.[f0]) el.value = M.fmtNumCell((items[i0] as Record<string, unknown>)[f0] as number);
        return;
      }
      // 1 ô CHỮ: đang SỬA → để trình duyệt chèn tại con trỏ; đang CHỌN (ô khóa) → ghi đè cả ô.
      if (!editingRef.current) {
        e.preventDefault(); pushUndo();
        const i0 = rc ? rc.r0 : (focusRef.current?.i ?? 0);
        const fld = f0 || FIELDS[rc ? rc.c0 : 0];
        pasteCellVal(i0, fld, val);
        if (movingCut) finishCutMove({ r0: i0, r1: i0, c0: FIELDS.indexOf(fld), c1: FIELDS.indexOf(fld) });
        recomputeAll(); onChange(); paintSel();
        const el = cellEl(i0, fld); if (el) el.value = String((items[i0] as Record<string, unknown>)[fld] ?? "");
      }
      return;
    }
    e.preventDefault(); pushUndo();

    // DÁN NGUYÊN báo giá app xuất ra (có cột STT) → dựng lại nhóm/nhóm-con/hàng-con/info.
    if (!internal && (hdrRoles || looksLikeExportPaste(rows, startCol, FIELDS.length))) {
      const roles = hdrRoles || ADDR.map((c) => c.f);
      const rebuilt = reconstructExportRows(rows, roles, NUMERIC, numberSubs);
      // Công thức trong khối mang địa chỉ Ô THEO FILE EXCEL → TỰ DỊCH sang toạ độ web (verify bằng
      // Thành Tiền của khối); ca không chắc → giữ công thức gốc + cờ _fxWarn (ô ĐỎ để sửa tay).
      retargetPastedFormulas(rebuilt, rows, roles, { webLetter: (role) => letterOf(role) || null, baseRow: startRow });
      const built = rebuilt.map((b) => ({ ...M.blankItem(usesDays), ...b, _k: nextK() } as ItemK));
      items.splice(startRow, rows.length, ...built);
      if (!items.length) { const nit = M.blankItem(usesDays) as ItemK; nit._k = nextK(); items.push(nit); }
      autoEnableGroupSub(startRow, startRow + built.length - 1);
      recomputeAll(); onChange();
      selRef.current = { anchor: { row: startRow, field: FIELDS[0] }, focus: { row: startRow + built.length - 1, field: FIELDS[FIELDS.length - 1] } };
      focusCell(startRow, FIELDS[0], true);
      const nGrp = built.filter((b) => b.kind === "section").length, nSub = built.filter((b) => b.kind === "subsection").length;
      const nWarn = built.reduce((acc, b) => acc + Object.keys((b as Record<string, unknown>)._fxWarn || {}).length, 0);
      toast(`Đã dán & dựng lại ${built.length} dòng (${nGrp} nhóm, ${nSub} nhóm con)`, "success");
      if (nWarn) toast(`⚠️ ${nWarn} ô công thức KHÔNG tự dịch được từ Excel — ô viền ĐỎ, bấm vào kiểm tra/sửa tay`, "error");
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
    // Khối này là khối vừa CẮT → xoá vùng nguồn (di chuyển xong).
    if (sameBlock && cutPendingRef.current && internal && internal.token === cutPendingRef.current.token) {
      finishCutMove({ r0: startRow, r1: startRow + rows.length - 1, c0: startCol, c1: Math.min(FIELDS.length - 1, startCol + rows[0].length - 1) });
    }
    autoEnableGroupSub(startRow, startRow + rows.length - 1);
    recomputeAll(); onChange();
    selRef.current = { anchor: { row: startRow, field: FIELDS[startCol] }, focus: { row: startRow + rows.length - 1, field: FIELDS[Math.min(FIELDS.length - 1, startCol + rows[0].length - 1)] } };
    focusCell(startRow, FIELDS[startCol], true);
    toast(`Đã dán ${rows.length} dòng × ${rows[0].length} cột`, "success");
  };

  // ── bàn phím trong ô (Enter/Tab/Arrow/Esc/Ctrl) ────────────────────────────────
  const onGridKeyDown = (e: { key: string; keyCode: number; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; target: EventTarget | null; nativeEvent: KeyboardEvent; preventDefault(): void; stopPropagation(): void }) => {
    const ae = e.target as HTMLInputElement | HTMLTextAreaElement | null;
    const f = ae?.getAttribute?.("data-f"); const tr = ae?.closest?.("tr[data-row]");
    if (!f || !tr || !FIELDS.includes(f)) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const i = parseInt(tr.getAttribute("data-row") || "0", 10);
    const ci = FIELDS.indexOf(f);
    const isMultiline = MULTILINE.has(f);
    if (!ctrl && (e.nativeEvent?.isComposing || e.keyCode === 229 || e.key === "Process")) {
      // IME (gõ tiếng Việt trên macOS, Trung/Nhật/Hàn…): phím đầu tiên rơi vào ô đang KHÓA →
      // mở khóa + xoá NGAY TRONG keydown (trước khi composition bắt đầu) để cụm chữ đè nội dung
      // cũ — cùng nếp "gõ là đè" với ký tự thường. Đang sửa rồi thì để IME tự chạy.
      if (!editingRef.current && editable) typeToReplace(ae, i, f);
      return;
    }
    // Rời chuỗi mũi-tên-chèn-tham-chiếu (gõ ký tự khác / Enter / Esc…) → ref vừa chèn đông cứng.
    if (kbRefRef.current && e.key !== "Shift" && !e.key.startsWith("Arrow")) { kbRefRef.current = null; clearRefPick(); }
    // Dropdown gợi ý rạp đang mở → ↑↓ chọn, Tab/Enter điền, Esc đóng. Enter CHỈ bị "ăn" khi đã
    // bấm ↑↓ chọn dòng — gõ tên tự do rồi Enter vẫn xuống hàng như cũ.
    if (sug && f === "name" && sug.i === i) {
      if (e.key === "ArrowDown") { e.preventDefault(); e.stopPropagation(); setSug({ ...sug, idx: (sug.idx + 1) % sug.items.length }); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); e.stopPropagation(); setSug({ ...sug, idx: (sug.idx - 1 + sug.items.length) % sug.items.length }); return; }
      if (e.key === "Tab") { e.preventDefault(); e.stopPropagation(); applySug(sug, sug.idx < 0 ? 0 : sug.idx); return; }
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeSug(); return; }
      if (e.key === "Enter") { if (sug.idx >= 0) { e.preventDefault(); e.stopPropagation(); applySug(sug, sug.idx); return; } closeSug(); }
    }
    if (autoRef.current) {
      if (e.key === "ArrowDown") { e.preventDefault(); e.stopPropagation(); moveAuto(1); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); e.stopPropagation(); moveAuto(-1); return; }
      if (e.key === "Tab") { e.preventDefault(); e.stopPropagation(); acceptAuto(); return; }
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeAuto(); return; }
      if (e.key === "Enter") closeAuto();
    }
    // ── PHÍM TẮT KIỂU EXCEL (Windows: Ctrl · macOS: ⌘ — `ctrl` đã gộp cả metaKey) ──
    const editing = editingRef.current;
    const lastRow = items.length - 1, lastCol = FIELDS.length - 1;
    const selectRect = (r0: number, c0: number, r1: number, c1: number) => {
      selRef.current = { anchor: { row: r0, field: FIELDS[c0] }, focus: { row: r1, field: FIELDS[c1] } };
      lockCell(ae);   // chọn vùng = thoát chế độ sửa → khóa lại ô đang focus (đồng bộ readOnly)
      paintSel();
    };
    // F2: chọn → SỬA (con trỏ cuối chữ); đang sửa → luân phiên EDIT ↔ ENTER (đổi cách mũi tên
    // hoạt động: trong chữ ↔ chốt-và-đi) — đúng hành vi F2 của Excel, không thoát ô.
    if (e.key === "F2") {
      e.preventDefault(); e.stopPropagation();
      if (!editing) enterEdit(ae, { caretEnd: true }, "edit");
      else editModeRef.current = editModeRef.current === "edit" ? "enter" : "edit";
      return;
    }
    // AutoSum như Excel — Windows: Alt+"=" (Option+"=" trên Mac ra "≠") · Mac Excel: ⌘+Shift+T.
    // Chèn =SUM(dải số của các hàng liền kề phía trên, cùng cột) — Enter là chốt.
    if (editable && ((e.nativeEvent?.altKey && !ctrl && (e.key === "=" || e.key === "+" || e.key === "≠")) || (ctrl && e.shiftKey && (e.key === "t" || e.key === "T")))) {
      e.preventDefault(); e.stopPropagation();
      const L = letterOf(f);
      let a = i;
      while (a - 1 >= 0 && (items[a - 1].kind === "item" || items[a - 1].kind === "sub")) a--;
      markEditUndo(i, f);
      enterEdit(ae, {}, "enter");
      const formula = a < i ? `=SUM(${L}${a + 1}:${L}${i})` : "=SUM(";
      ae!.value = formula;
      try { ae!.setSelectionRange(formula.length, formula.length); } catch { /* */ }
      ae!.dispatchEvent(new Event("input", { bubbles: true }));
      return;
    }
    // Ctrl/⌘+A: đang SỬA → để trình duyệt bôi đen CHỮ trong ô (như Excel/thanh công thức);
    // đang chọn ô → chọn cả bảng.
    if (ctrl && !editing && (e.key === "a" || e.key === "A")) { e.preventDefault(); e.stopPropagation(); selectRect(0, 0, lastRow, lastCol); return; }
    if (ctrl && (e.key === "r" || e.key === "R")) { e.preventDefault(); e.stopPropagation(); if (editable) fillRight(); return; }
    if (e.key === " " && (e.shiftKey || ctrl) && !editing) {   // Shift+Space: cả HÀNG · Ctrl+Space: cả CỘT
      e.preventDefault(); e.stopPropagation();
      const rc = rectOf(selRef.current) || { r0: i, r1: i, c0: ci, c1: ci };
      if (e.shiftKey) selectRect(rc.r0, 0, rc.r1, lastCol); else selectRect(0, rc.c0, lastRow, rc.c1);
      return;
    }
    if (!editing && (e.key === "Delete" || e.key === "Backspace")) {
      e.preventDefault(); e.stopPropagation();
      if (!editable) return;
      // Excel: Delete xoá nội dung CẢ VÙNG đang chọn; Backspace xoá Ô ĐANG NHẬP rồi vào luôn
      // chế độ gõ (ô rỗng, con trỏ nháy) — không đụng các ô còn lại của vùng.
      if (e.key === "Delete") clearRange();
      else typeToReplace(ae, i, f);
      return;
    }
    if (e.key === "Home" || e.key === "End") {
      if (editing && !ctrl) return;   // đang sửa: Home/End chạy trong chữ như thường
      e.preventDefault(); e.stopPropagation();
      const toCol = e.key === "Home" ? 0 : lastCol;
      moveTo(ctrl ? (e.key === "Home" ? 0 : lastRow) : i, FIELDS[toCol], e.shiftKey, e.key === "End" ? -1 : 1);
      return;
    }
    if (e.key === "PageUp" || e.key === "PageDown") {
      e.preventDefault(); e.stopPropagation();
      moveTo(i + (e.key === "PageDown" ? 10 : -10), f, e.shiftKey);
      return;
    }
    // Alt+Enter = xuống dòng TRONG ô (ô nhiều dòng: Hạng Mục / Ghi Chú) — như Excel.
    if (e.key === "Enter" && e.nativeEvent?.altKey && isMultiline && ae) {
      e.preventDefault(); e.stopPropagation();
      const s = ae.selectionStart ?? ae.value.length, t = ae.selectionEnd ?? s;
      ae.value = ae.value.slice(0, s) + "\n" + ae.value.slice(t);
      try { ae.setSelectionRange(s + 1, s + 1); } catch { /* */ }
      ae.dispatchEvent(new Event("input", { bubbles: true }));
      enterEdit(ae);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault(); e.stopPropagation();
      commitCell(i, f, ae!.value); recomputeAll();
      // Ctrl/⌘+Enter (Excel): đang gõ + chọn VÙNG → điền nội dung vào TOÀN vùng; còn lại →
      // CHỐT nội dung nhưng Ở LẠI ô (tiện nhìn kết quả).
      if (ctrl) {
        const rcFill = rectOf(selRef.current);
        if (editing && rcFill && (rcFill.r0 !== rcFill.r1 || rcFill.c0 !== rcFill.c1)) {
          const raw = ae!.value;
          const m = editUndoRef.current;
          if (!(m && m.i === i && m.f === f)) pushUndo();   // phiên gõ đã có mốc thì snapshot cũ phủ đủ
          for (let r = rcFill.r0; r <= rcFill.r1; r++) { if (items[r]?.kind === "info") continue; for (let c = rcFill.c0; c <= rcFill.c1; c++) commitCell(r, FIELDS[c], raw); }
          recomputeAll(); onChange(); lockCell(ae); paintSel();   // giữ nguyên vùng chọn như Excel
          return;
        }
        onChange(); lockCell(ae); selRef.current = { anchor: { row: i, field: f }, focus: { row: i, field: f } }; paintSel(); return;
      }
      // Đang chọn VÙNG nhiều ô → Enter chạy VÒNG TRONG vùng (xuống, hết cột thì sang cột kế;
      // Shift+Enter đi ngược lại) — Excel.
      const rcSel = rectOf(selRef.current);
      if (rcSel && (rcSel.r0 !== rcSel.r1 || rcSel.c0 !== rcSel.c1)) {
        onChange();
        const keep = { ...selRef.current! };
        let nr = i + (e.shiftKey ? -1 : 1), nc = ci;
        if (nr > rcSel.r1) { nr = rcSel.r0; nc = ci + 1 > rcSel.c1 ? rcSel.c0 : ci + 1; }
        if (nr < rcSel.r0) { nr = rcSel.r1; nc = ci - 1 < rcSel.c0 ? rcSel.c1 : ci - 1; }
        moveTo(nr, FIELDS[nc], false);
        selRef.current = keep; paintSel();   // giữ nguyên vùng chọn, chỉ dời ô đang nhập
        return;
      }
      // Shift+Enter = đi LÊN (Excel). Xuống dòng trong ô nhiều dòng = Alt+Enter (xử lý ở trên).
      if (e.shiftKey) { onChange(); moveTo(i - 1, f, false); return; }
      if (i >= items.length - 1) { pushUndo(); const nit = M.blankItem(usesDays) as ItemK; nit._k = nextK(); items.push(nit); focusCell(i + 1, f); onChange(); }
      else { onChange(); moveTo(i + 1, f, false); }
      return;
    }
    // Ctrl/⌘+Shift+"+" = chèn hàng dưới · Ctrl/⌘+"-" = xóa hàng đang chọn (Excel).
    if (ctrl && editable && (e.key === "+" || e.key === "=" || e.key === "-")) {
      e.preventDefault(); e.stopPropagation();
      if (e.key === "-") { const rc = rectOf(selRef.current); const from = rc ? rc.r0 : i, n = rc ? rc.r1 - rc.r0 + 1 : 1; pushUndo(); items.splice(from, n); if (!items.length) { const nit = M.blankItem(usesDays) as ItemK; nit._k = nextK(); items.push(nit); } selRef.current = { anchor: { row: Math.min(from, items.length - 1), field: f }, focus: { row: Math.min(from, items.length - 1), field: f } }; onChange(); toast(`Đã xóa ${n} hàng — Ctrl+Z để hoàn tác`, "info"); }
      else { pushUndo(); const nit = M.blankItem(usesDays) as ItemK; nit._k = nextK(); items.splice(i + 1, 0, nit); focusCell(i + 1, "name"); onChange(); }
      return;
    }
    if (ctrl && !e.shiftKey && (e.key === "z" || e.key === "Z")) { e.preventDefault(); e.stopPropagation(); if (editable) doUndo(); return; }
    if (ctrl && ((e.key === "y" || e.key === "Y") || (e.shiftKey && (e.key === "z" || e.key === "Z")))) { e.preventDefault(); e.stopPropagation(); if (editable) doRedo(); return; }
    if (ctrl && (e.key === "d" || e.key === "D")) { e.preventDefault(); e.stopPropagation(); if (editable) fillDown(); return; }
    if (e.key === "Escape") {
      e.stopPropagation();
      const esc = e.target as (HTMLInputElement | HTMLTextAreaElement) | null;
      // 1) Đang SỬA → HỦY nội dung đang gõ (về giá trị lúc vào ô, lưu ở dataset.escVal) và thoát
      //    chế độ sửa NHƯNG GIỮ ô đang chọn — đúng Excel (Esc lần 1).
      if (editing) {
        e.preventDefault();
        if (esc && esc.dataset && esc.dataset.escVal != null) {
          esc.value = esc.dataset.escVal;
          // Trả cả MODEL về giá trị lúc vào ô rồi tính lại NGAY. onNumInput đã ghi live vào items
          // mỗi lần gõ, nên nếu chỉ trả esc.value thì Thành Tiền/tổng nhóm/Tổng sheet vẫn treo số
          // đang gõ dở cho tới khi rời ô — người dùng thấy tổng sai ngay sau khi bấm Esc.
          commitCell(i, f, esc.dataset.escVal);
          recomputeAll();
          // Phiên sửa đã bị huỷ → bỏ luôn mốc undo của nó, nếu không Ctrl+Z kế tiếp chỉ "nuốt"
          // một nhịp rỗng thay vì lùi thao tác thật trước đó.
          const m = editUndoRef.current;
          if (m && m.i === i && m.f === f) { undoRef.current.pop(); editUndoRef.current = null; }
          onChange();
        }
        lockCell(esc);
        selRef.current = { anchor: { row: i, field: f }, focus: { row: i, field: f } };
        paintSel();
        return;
      }
      // 2) Có vùng CẮT chờ dán → Esc huỷ cắt (như Excel bỏ marching ants).
      if (cutPendingRef.current) { e.preventDefault(); cancelCut(); return; }
      // 3) Đang chọn VÙNG nhiều ô → bỏ chọn vùng.
      const sel = selRef.current;
      if (sel && (sel.anchor.row !== sel.focus.row || sel.anchor.field !== sel.focus.field)) { clearSel(); return; }
      // 3) Chọn 1 ô → THOÁT hẳn khỏi ô (Esc lần 2).
      e.preventDefault();
      clearSel();
      if (esc && typeof esc.blur === "function") esc.blur();
      return;
    }
    if (e.key === "Tab") {
      // Đang chọn VÙNG → Tab chạy vòng TRONG vùng (phải, hết hàng thì xuống hàng kế) — Excel.
      const rcSel = rectOf(selRef.current);
      if (rcSel && (rcSel.r0 !== rcSel.r1 || rcSel.c0 !== rcSel.c1)) {
        e.preventDefault(); e.stopPropagation();
        const keep = { ...selRef.current! };
        let nc = ci + (e.shiftKey ? -1 : 1), nr = i;
        if (nc > rcSel.c1) { nc = rcSel.c0; nr = i + 1 > rcSel.r1 ? rcSel.r0 : i + 1; }
        if (nc < rcSel.c0) { nc = rcSel.c1; nr = i - 1 < rcSel.r0 ? rcSel.r1 : i - 1; }
        moveTo(nr, FIELDS[nc], false, e.shiftKey ? -1 : 1);
        selRef.current = keep; paintSel();
        return;
      }
      if (!e.shiftKey && (ci < FIELDS.length - 1 || i < items.length - 1)) { e.preventDefault(); e.stopPropagation(); if (ci < FIELDS.length - 1) moveTo(i, FIELDS[ci + 1], false, 1); else moveTo(i + 1, FIELDS[0], false, 1); }
      else if (e.shiftKey && (ci > 0 || i > 0)) { e.preventDefault(); e.stopPropagation(); if (ci > 0) moveTo(i, FIELDS[ci - 1], false, -1); else moveTo(i - 1, FIELDS[FIELDS.length - 1], false, -1); }
      return;
    }
    // Alt+↓ — mở danh sách gợi ý của ô (như Excel mở dropdown trong ô): ô Hạng Mục → gợi ý theo rạp.
    if (e.nativeEvent?.altKey && e.key === "ArrowDown" && f === "name" && fxBar && editable) {
      e.preventDefault(); e.stopPropagation();
      if (!editing) enterEdit(ae, { caretEnd: true }, "enter");
      nameSuggest(i, ae as HTMLTextAreaElement);
      return;
    }
    if (e.key.indexOf("Arrow") === 0) {
      const up = e.key === "ArrowUp", down = e.key === "ArrowDown", left = e.key === "ArrowLeft", right = e.key === "ArrowRight";
      if (editing) {
        // EDIT (nhấp đúp/F2): mũi tên CHỈ chạy trong chữ — không rời ô, Ctrl+mũi tên nhảy theo
        // từ (trình duyệt xử lý). Muốn mũi tên chốt-và-đi thì bấm F2 lần nữa (sang ENTER) — Excel.
        if (editModeRef.current === "edit") return;
        // ENTER + đang gõ CÔNG THỨC: mũi tên chèn/di chuyển THAM CHIẾU Ô (point-mode bàn phím).
        if (!ctrl && (ae!.value || "").trim().startsWith("=") && tryKbRef(ae!, i, f, e)) { e.preventDefault(); e.stopPropagation(); return; }
        // ENTER thường: mũi tên CHỐT nội dung + đi ô kế (commit chạy ở blur khi moveTo đổi focus).
      }
      // Ctrl/⌘ + mũi tên → nhảy tới BIÊN bảng (thêm Shift = kéo vùng chọn tới biên), như Excel.
      if (ctrl) {
        e.preventDefault(); e.stopPropagation();
        moveTo(up ? 0 : down ? lastRow : i, FIELDS[left ? 0 : right ? lastCol : ci], e.shiftKey, right ? 1 : left ? -1 : 0);
        return;
      }
      e.preventDefault(); e.stopPropagation();
      moveTo(i + (down ? 1 : 0) - (up ? 1 : 0), FIELDS[ci + (right ? 1 : 0) - (left ? 1 : 0)] || f, e.shiftKey, right ? 1 : left ? -1 : 0);
      return;
    }
    // GÕ LÀ ĐÈ (type-to-replace — READY → ENTER, đúng nếp Excel): ô đang CHỌN, gõ ký tự thường/
    // số/"=" → nội dung cũ được thay bằng ký tự vừa gõ, vào thẳng chế độ gõ. KHÔNG preventDefault
    // để trình duyệt tự chèn ký tự vào ô (đã xoá rỗng + mở khóa).
    if (!ctrl && !e.nativeEvent?.altKey && e.key.length === 1 && !editing && editable) {
      typeToReplace(ae, i, f);
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
    if (el) el.dataset.escVal = el.value;   // lưu giá trị lúc VÀO ô — ESC hủy về giá trị này (như Excel)
    highlightActiveFormulaRefs(el?.value || ""); syncFxBar();
  };
  const onGridBlur = (e: { target: EventTarget | null; relatedTarget?: EventTarget | null }) => {
    if (pickingRef.current) return;   // đang point-pick → giữ focus, chưa commit
    editUndoRef.current = null;       // hết phiên gõ — vào lại chính ô này lần sau phải ghi mốc MỚI
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
    setTimeout(closeSug, 150);   // chờ cú click chọn gợi ý kịp "đáp đất" rồi mới đóng
    // RỜI HẲN khỏi lưới (bấm ra ngoài bảng) → BỎ tô vùng chọn, ô về màu bình thường.
    // Vẫn GIỮ khi qua thanh công thức fx (đang sửa ô đó) hoặc sang ô khác trong cùng lưới.
    const to = e.relatedTarget as HTMLElement | null;
    const stayInGrid = !!to && (!!to.closest?.(".excel-table") || !!to.closest?.(".fx-bar") || !!to.closest?.(".vs-auto") || !!to.closest?.(".fx-auto"));
    if (!stayInGrid) {
      setTimeout(() => {
        const ae = document.activeElement as HTMLElement | null;
        if (ae && (ae.closest?.(".excel-table") || ae.closest?.(".fx-bar"))) return;   // đã quay lại lưới
        clearSel();
      }, 60);
    }
  };

  // Safari/macOS không phải lúc nào cũng blur input khi bấm vùng không nhận focus. Dọn selection
  // ngay từ pointerdown ngoài lưới để màu/target không bị treo khác nhau giữa các trình duyệt.
  useEffect(() => {
    const onOutsidePointer = (ev: PointerEvent) => {
      const tb = tableRef.current, target = ev.target as HTMLElement | null;
      if (!tb || !target || tb.contains(target)) return;
      if (target.closest(".tbl-scroll, .fx-bar, .vs-auto, .fx-auto")) return;
      const active = document.activeElement as HTMLElement | null;
      if (active && tb.contains(active)) active.blur();
      clearOutsideRef.current();
    };
    document.addEventListener("pointerdown", onOutsidePointer, true);
    return () => document.removeEventListener("pointerdown", onOutsidePointer, true);
  }, []);

  // ── ô SỐ (công thức + gom nghìn live + autocomplete) / text / textarea ─────────
  const onNumInput = (i: number, f: string, el: HTMLInputElement) => {
    editingRef.current = true;   // có gõ = đang SỬA (kể cả gõ tiếng Việt qua IME — keydown không bắt được)
    markEditUndo(i, f);          // Ctrl+Z lùi được cả ô (trước đây gõ tay KHÔNG hề ghi undo)
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
      onInput={(e) => { editingRef.current = true; markEditUndo(i, f); const el = e.target as HTMLInputElement; if (el.value.trim().startsWith("=")) { fxAutocomplete(el); highlightActiveFormulaRefs(el.value); } else { (items[i] as Record<string, unknown>)[f] = el.value; closeAuto(); clearActiveRefs(); } syncFxBar(); onChange(); }} />
  );
  const taInput = (i: number, f: string, ph?: string) => (
    <textarea data-f={f} rows={1} defaultValue={(items[i][f as keyof M.Item] as string) || ""} placeholder={ph} disabled={!editable}
      ref={autoGrow} onInput={(e) => { editingRef.current = true; markEditUndo(i, f); const el = e.target as HTMLTextAreaElement; (items[i] as Record<string, unknown>)[f] = el.value; autoGrow(el); onChange(); }} />
  );
  const fcls = (i: number, f: string, base: string) => base + (items[i].formulas?.[f] ? " has-formula" : "") + ((items[i] as Record<string, unknown> & { _fxWarn?: Record<string, boolean> })._fxWarn?.[f] ? " cell-fx-error" : "");
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
        navigatingRef.current = true; el.focus(); navigatingRef.current = false;
        lockCell(el);
      }
    }
    paintSel();
  });

  // ── derived ───────────────────────────────────────────────────────────────────
  const rk = M.computeRowKinds(items);
  // Tổng theo nhóm. Nhóm con = Σ mục con. Bản BANNER (numberSubs): nhóm CHA = Σ TẤT CẢ mục con (cuộn
  // qua các nhóm con) → "đơn giá hàng cha = tổng hàng con". Mẫu khác giữ cũ (nhóm con tổng riêng).
  const sectionSum: Record<number, number> = {};
  { let curSection = -1, curSub = -1;
    for (let i = 0; i < items.length; i++) {
      if (rk[i] === "section") {
        if (items[i].kind === "subsection") { curSub = i; sectionSum[i] = 0; }
        else { curSection = i; curSub = -1; sectionSum[i] = 0; }
      } else if (rk[i] === "head" || rk[i] === "sub") {
        const amt = M.lineAmount(items[i], usesDays);
        const parent = curSub >= 0 ? curSub : curSection;
        if (parent >= 0) sectionSum[parent] += amt;
        if (numberSubs && curSub >= 0 && curSection >= 0) sectionSum[curSection] += amt;   // banner: dồn lên nhóm cha
      }
    }
  }
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
    const it = items[i];
    // Banner nhóm CHA (section chứa nhóm con, không có mục trực tiếp): Đơn giá = SUM(đơn giá các NHÓM CON).
    if (numberSubs && it && it.kind === "section") {
      const cells: string[] = [];
      for (let j = i + 1; j < items.length; j++) { const k = items[j].kind; if (k === "section") break; if (k === "subsection") cells.push(`${Lp}${j + 1}`); }
      if (cells.length) { toggleCellFormula(td, `${Lp}${i + 1}`, `=SUM(${cells.join(",")})`); return; }
    }
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
  // ── Cột "Hình ảnh": chèn NHIỀU ảnh/ô, tự NÉN nhỏ (canvas → JPEG ~0.82, cạnh tối đa 1400px) trước
  //    khi lưu để đỡ nặng DB; nền trắng để PNG trong suốt không bị đen. Tối đa 10 ảnh/ô. ──
  const IMG_MAX_DIM = 1400, IMG_MAX = 10;
  const fileToImg = (file: File): Promise<string | null> => new Promise((resolve) => {
    if (!file.type.startsWith("image/")) return resolve(null);
    const r = new FileReader();
    r.onerror = () => resolve(null);
    r.onload = () => {
      const im = new Image();
      im.onerror = () => resolve(null);
      im.onload = () => {
        let w = im.width, h = im.height;
        if (Math.max(w, h) > IMG_MAX_DIM) { const s = IMG_MAX_DIM / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s); }
        const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
        const ctx = cv.getContext("2d"); if (!ctx) return resolve(String(r.result));
        ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h); ctx.drawImage(im, 0, 0, w, h);
        try { resolve(cv.toDataURL("image/jpeg", 0.82)); } catch { resolve(String(r.result)); }
      };
      im.src = String(r.result);
    };
    r.readAsDataURL(file);
  });
  const addImages = async (i: number, files: FileList | null) => {
    if (!editable || !files || !files.length) return;
    const cur = (items[i].images || []) as string[];
    const room = IMG_MAX - cur.length;
    if (room <= 0) { toast(`Tối đa ${IMG_MAX} ảnh mỗi ô`, "info"); return; }
    const out: string[] = [];
    for (const f of Array.from(files).slice(0, room)) { const d = await fileToImg(f); if (d) out.push(d); }
    if (out.length) { pushUndo(); (items[i] as Record<string, unknown>).images = [...cur, ...out]; onChange(); setImgVer((v) => v + 1); }
  };
  const removeImage = (i: number, k: number) => {
    if (!editable) return;
    const cur = (items[i].images || []) as string[];
    pushUndo(); (items[i] as Record<string, unknown>).images = cur.filter((_, idx) => idx !== k); onChange(); setImgVer((v) => v + 1);
  };
  const imagesCell = (i: number) => {
    const imgs = (items[i].images || []) as string[];
    return (
      <div className="cell-images">
        {imgs.map((src, k) => (
          <span className="cell-img" key={k}>
            <img src={src} alt="" loading="lazy" title="Bấm để xem lớn" onClick={() => window.open(src, "_blank")} />
            {editable && <button type="button" className="img-rm" title="Xoá ảnh" onClick={() => removeImage(i, k)}>✕</button>}
          </span>
        ))}
        {editable && imgs.length < IMG_MAX && (
          <label className="img-add" title="Thêm ảnh (chọn 1 hoặc nhiều)">＋
            <input type="file" accept="image/*" multiple style={{ display: "none" }} onChange={(e) => { addImages(i, e.target.files); (e.target as HTMLInputElement).value = ""; }} />
          </label>
        )}
      </div>
    );
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
      {showImages && <td className="col-images">{imagesCell(i)}</td>}
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
        <table className={`excel-table${clfTheme ? " clf-theme" : ""}`} ref={tableRef} onPaste={onPaste} onKeyDown={onGridKeyDown} onFocus={onGridFocus} onBlur={onGridBlur}
          onMouseDownCapture={onPointMouseDown} onMouseDown={onSelDragStart}
          onDoubleClick={(e) => {
            // Nhấp đúp ô = vào chế độ SỬA (EDIT), đặt con trỏ cuối nội dung để gõ nối tiếp.
            // Nhận MỌI ô nhập có data-f (kể cả nhãn nhóm A/B ngoài lưới điều hướng).
            const el = (e.target as HTMLElement)?.closest?.("[data-f]") as HTMLInputElement | HTMLTextAreaElement | null;
            if (!el || el.disabled) return;
            enterEdit(el, { caretEnd: true }, "edit");
          }}
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
              {showImages && <th scope="col" style={{ width: 150 }} className="th-images">HÌNH ẢNH<br /><span style={{ fontWeight: 400, fontSize: 10, opacity: 0.75 }}>(có xuất Excel)</span></th>}
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
                    {showImages && <td className="col-images">{imagesCell(i)}</td>}
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
                    {showImages && <td className="col-images">{imagesCell(i)}</td>}
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
                  <td className="col-hangmuc" rowSpan={span}><textarea data-f="name" rows={1} defaultValue={it.name || ""} disabled={!editable} ref={autoGrow} onInput={(e) => { editingRef.current = true; const el = e.target as HTMLTextAreaElement; (items[i] as Record<string, unknown>).name = el.value; autoGrow(el); onChange(); nameSuggest(i, el); }} /></td>
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
          <button className="btn btn-sm gf-venue-pick" title="Chèn hạng mục + kích thước có sẵn của rạp (quầy vé, quầy bắp, cover màn hình, bục soát vé…)" onClick={() => setPickerOpen(true)}>📐 Chèn từ rạp</button>
          <span className="spacer" />
          <details className="grid-keys">
            <summary title="Bảng chạy như Excel — xem danh sách phím tắt">⌨️ Phím tắt kiểu Excel</summary>
            <div className="grid-keys-body">
              <p><b>Chọn / sửa ô (như Excel):</b> bấm = chọn ô · <b>gõ là ĐÈ nội dung luôn</b> (không cần nhấp đúp) · <b>nhấp đúp</b>/<kbd>F2</kbd> = sửa trong chữ (mũi tên chạy trong chữ; bấm <kbd>F2</kbd> lần nữa để mũi tên chốt-và-đi) · <kbd>Esc</kbd> hủy sửa · <kbd>Delete</kbd> xóa vùng chọn · <kbd>Backspace</kbd> xóa ô rồi gõ luôn.</p>
              <p><b>Di chuyển:</b> mũi tên · <kbd>Tab</kbd>/<kbd>Shift+Tab</kbd> · <kbd>Enter</kbd> xuống · <kbd>Shift+Enter</kbd> lên · <kbd>{modKey}+Enter</kbd> chốt tại chỗ (chọn vùng thì điền cả vùng) · <kbd>Home</kbd>/<kbd>End</kbd> · <kbd>PgUp</kbd>/<kbd>PgDn</kbd> · <kbd>{modKey}</kbd>+mũi tên nhảy tới biên.</p>
              <p><b>Chọn vùng:</b> kéo chuột · <kbd>Shift</kbd>+bấm · <kbd>Shift</kbd>+mũi tên · <kbd>Shift+Space</kbd> cả hàng · <kbd>{modKey}+Space</kbd> cả cột · <kbd>{modKey}+A</kbd> cả bảng.</p>
              <p><b>Dữ liệu:</b> <kbd>{modKey}+C/V</kbd> copy–dán (qua lại Excel được) · <kbd>{modKey}+X</kbd> cắt kiểu Excel (viền nét đứt, <b>dán mới chuyển đi</b>, <kbd>Esc</kbd> huỷ) · <kbd>{modKey}+D</kbd> chép xuống · <kbd>{modKey}+R</kbd> chép phải · kéo (hoặc nhấp đúp) ô vuông góc dưới-phải · <kbd>{modKey}+Z</kbd>/<kbd>{modKey}+Y</kbd> hoàn tác–làm lại.</p>
              <p><b>Hàng:</b> <kbd>{modKey}+Shift++</kbd> chèn hàng dưới · <kbd>{modKey}+-</kbd> xóa hàng đang chọn · <kbd>Alt+Enter</kbd> xuống dòng trong ô · <kbd>Alt+↓</kbd> mở gợi ý hạng mục theo rạp.</p>
              <p className="muted">Công thức: gõ <b>=</b> thẳng vào ô · <b>mũi tên chọn ô tham chiếu</b> (Shift+mũi tên kéo thành vùng) hoặc bấm/kéo chuột · <kbd>Alt+=</kbd> tự chèn =SUM(dải phía trên) · ví dụ <b>=G3*E3</b>, <b>=SUM(H3:H8)</b>.</p>
            </div>
          </details>
        </div>
      )}
      {pickerOpen && <VenuePicker onInsert={insertCatalogRows} onClose={() => setPickerOpen(false)} />}
      {sug && (
        <div className="vs-auto" style={{ left: sug.rect.left, top: sug.rect.top, minWidth: Math.max(280, sug.rect.width) }}>
          {sug.items.map((e, k) => (
            // mousedown (không phải click) để thắng blur của ô đang gõ — như dropdown hàm ƒ
            <div className={`vs-item${k === sug.idx ? " active" : ""}`} key={k}
              onMouseDown={(ev) => { ev.preventDefault(); applySug(sug, k); }}>
              <div className="vs-line1">{e.name} <span className="vs-venue">· {e.venue}</span></div>
              <div className="vs-line2">{dimLabel(e)}{e.cat && <span className="vs-cat"> — {e.cat}</span>}</div>
            </div>
          ))}
          <div className="vs-hint">↑↓ chọn · Tab điền · Esc đóng — hoặc bấm chuột</div>
        </div>
      )}
      {editable && onGroupSubtotal && (
        <label className="toggle-totals gf-group-sub" style={{ display: "inline-flex", alignItems: "center", gap: 8, margin: "2px 0 8px", fontSize: 13, cursor: "pointer" }}>
          <input type="checkbox" checked={groupSubtotal} onChange={(e) => onGroupSubtotal(e.target.checked)} />
          <span>Hiện <strong>Thành Tiền nhóm</strong> (Số Lượng nhóm × tổng các mục trong nhóm)</span>
        </label>
      )}
      {editable && onShowImages && (
        <label className="toggle-totals gf-show-images" style={{ display: "inline-flex", alignItems: "center", gap: 8, margin: "2px 0 8px 16px", fontSize: 13, cursor: "pointer" }}>
          <input type="checkbox" checked={!!showImages} onChange={(e) => onShowImages(e.target.checked)} />
          <span>Hiện cột <strong>Hình ảnh</strong> (chèn ảnh mỗi hạng mục · CÓ xuất Excel)</span>
        </label>
      )}
    </>
  );
}
