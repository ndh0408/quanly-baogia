import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, type Me, type QuoteFull, type EditorCompany, type EditorTemplate, type QuoteVersion, type AssignableUser } from "./api";
import { toast, confirmModal, promptModal } from "./ui";
import * as M from "./quoteMath";
import { evalFormula, type FormulaRefs } from "./formula";

// ───────────────────────────────────────────────────────────────────────────────
// Port "Editor báo giá" (public/js/editor.js renderEditor + drawItems) sang React.
// STAGE 1: form (KH/người gửi/meta) + lưới Excel (head/sub/section/info + rowspan + tính
// Thành Tiền/nhóm/tổng) + multi-sheet (thêm/xóa/đổi template) + thêm/xóa hàng·nhóm·hàng-con +
// summary + Lưu/Khách chốt/Không chốt + Excel/PDF/Phiên bản/Thành viên. (Công thức =…, copy/paste
// vùng, undo/redo, bảng nội bộ, luồng HN = stage sau.) Ô nhập UNCONTROLLED + key theo _k để giữ
// focus/con-trỏ khi gõ (mutate qRef + tick để vẽ lại Thành Tiền/Tổng — giống SPA, không reset ô).
// ───────────────────────────────────────────────────────────────────────────────

let _kSeq = 1;
const stampKeys = (q: QuoteFull) => {
  (q.sheets as Sheet[] | undefined)?.forEach((s) => (s.items || []).forEach((it) => { (it as ItemK)._k = _kSeq++; }));
};
type Sheet = M.Sheet & { _k?: number };
type ItemK = M.Item & { _k?: number };
const autoGrow = (el: HTMLTextAreaElement | null) => { if (!el) return; el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; };

let _companies: EditorCompany[] | null = null;
let _templates: EditorTemplate[] | null = null;

// Lấy thông báo lỗi CỤ THỂ (vd "Vui lòng nhập tên khách hàng") từ details[] thay vì "Dữ liệu không hợp lệ".
const errText = (ex: unknown): string => {
  if (ex instanceof ApiError) {
    const d = (ex.body as { details?: { message?: string }[] } | undefined)?.details;
    if (Array.isArray(d) && d[0]?.message) return d[0].message;
    return ex.message;
  }
  return "Có lỗi xảy ra";
};

export function QuoteEditorPage({ me, quoteId, isNew }: { me: Me; quoteId?: number; isNew: boolean }) {
  const qRef = useRef<QuoteFull | null>(null);
  const [, setTick] = useState(0);
  const redraw = useCallback(() => setTick((t) => t + 1), []);
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const dirtyRef = useRef(false);
  const mark = useCallback(() => { dirtyRef.current = true; }, []);
  const [versions, setVersions] = useState<QuoteVersion[] | null>(null);
  const [membersOpen, setMembersOpen] = useState(false);
  // Stage 3: undo/redo (snapshot items) + ô đang focus + ô cần focus sau redraw.
  const undoRef = useRef<string[]>([]);
  const redoRef = useRef<string[]>([]);
  const focusRef = useRef<{ i: number; f: string } | null>(null);
  const focusPend = useRef<{ i: number; f: string } | null>(null);
  const kbdRef = useRef<(e: KeyboardEvent) => void>(() => {});

  // Ctrl+Z/Y toàn editor (gọi handler mới nhất qua ref) + focus ô sau redraw (paste/nav/undo).
  useEffect(() => { const h = (e: KeyboardEvent) => kbdRef.current(e); window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h); }, []);
  useEffect(() => {
    if (!focusPend.current) return;
    const { i, f } = focusPend.current; focusPend.current = null;
    const el = document.querySelector(`.excel-table tr[data-row="${i}"] [data-f="${f}"]`) as HTMLInputElement | HTMLTextAreaElement | null;
    if (el) { el.focus(); try { const n = el.value.length; el.setSelectionRange(n, n); } catch { /* ignore */ } }
  });

  const templates = _templates || [];
  const companies = _companies || [];

  // ── load catalogs + quote ──────────────────────────────────────────────────
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (!_companies || !_templates) {
          const [cs, ts] = await Promise.all([api.metaCompanies(), api.metaTemplates()]);
          _companies = cs; _templates = ts;
        }
        let q: QuoteFull;
        if (isNew) {
          const firstTpl = _templates![0];
          q = {
            id: 0, _new: true, status: "draft", title: "", quoteNumber: "", companyId: firstTpl?.companyId,
            city: "TP. Hồ Chí Minh", quoteDate: new Date().toISOString().slice(0, 10), vatPercent: 0, discount: 0, showTotals: true,
            greeting: "Chân thành cảm ơn Quí khách hàng đã quan tâm đến dịch vụ của chúng tôi, chúng tôi xin gởi bảng báo giá theo yêu cầu như sau:",
            sheets: [{ templateId: firstTpl?.id, groupSubtotal: true, items: [], extraTables: [] }],
          };
        } else {
          q = await api.getQuote(quoteId!);
        }
        if (q.quoteDate && q.quoteDate.length > 10) q.quoteDate = q.quoteDate.slice(0, 10);
        if (q.executionDate && q.executionDate.length > 10) q.executionDate = q.executionDate.slice(0, 10);
        if (!q.sheets || !(q.sheets as Sheet[]).length) q.sheets = [{ templateId: _templates![0]?.id, groupSubtotal: true, items: [], extraTables: [] }];
        (q.sheets as Sheet[]).forEach((s) => { if (!Array.isArray(s.extraTables)) s.extraTables = []; });
        (q as QuoteFull & { _activeSheet: number })._activeSheet = 0;
        stampKeys(q);
        qRef.current = q;
        if (alive) { dirtyRef.current = false; setReady(true); }
      } catch (ex) {
        if (alive) setErr(ex instanceof ApiError ? ex.message : "Lỗi tải báo giá");
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quoteId, isNew]);

  if (err) return <div className="err" style={{ margin: 24 }}>⚠ {err} <a href="#/list" className="btn btn-sm">Về danh sách</a></div>;
  if (!ready || !qRef.current) return <div className="skeleton-wrap" style={{ padding: 24 }}>{Array.from({ length: 6 }).map((_, i) => <div className="skeleton-row" key={i} />)}</div>;

  const q = qRef.current as QuoteFull & { _activeSheet: number };
  const sheets = q.sheets as Sheet[];
  const ai = q._activeSheet;
  const activeSheet = sheets[ai];
  const tpl = templates.find((t) => t.id === activeSheet.templateId);
  const usesDays = !!tpl?.layout?.hasDays;
  const showDetail = !!tpl?.layout?.hasDetail;
  const numberSubs = !!tpl?.layout?.numberSubsections;

  // editable (mirror server + renderEditor): admin sửa tất; manager/member sửa khi chưa chốt/mất.
  const isMember = (q.members || []).some((m) => m.id === me.id);
  const canUpdate = me.role === "admin" || q.createdById === me.id || isMember || isNew;
  const editable = isNew || (canUpdate && (me.role === "admin" || me.role === "manager" || q.status === "draft" || q.status === "rejected"));
  const hasPerm = (p: string) => me.permissions.includes(p) || me.permissions.includes(p.replace(/:own$/, ":all"));
  const senderCo = companies.find((c) => c.id === q.companyId);
  if (senderCo?.address) q.fromAddress = senderCo.address;

  const back = async () => {
    if (dirtyRef.current && !(await confirmModal("Rời khỏi mà chưa lưu?", "Bạn có thay đổi chưa lưu. Rời đi sẽ mất các thay đổi này.", { danger: true, confirmText: "Rời, bỏ thay đổi" }))) return;
    location.hash = "#/list";
  };

  // ── field setters ──────────────────────────────────────────────────────────
  const setQ = (k: string, v: unknown) => { (q as Record<string, unknown>)[k] = v; mark(); };
  const setItem = (i: number, f: string, v: unknown) => { (activeSheet.items[i] as Record<string, unknown>)[f] = v; mark(); };

  // ── undo/redo (snapshot items) + focus điều hướng (Stage 3) ──────────────────
  const FIELDS = (["name", showDetail ? "detail" : null, "unit", "quantity", usesDays ? "days" : null, "unitPrice", "notes", "internalNote"].filter(Boolean)) as string[];
  const snap = () => JSON.stringify(activeSheet.items);
  const pushUndo = () => { undoRef.current.push(snap()); if (undoRef.current.length > 100) undoRef.current.shift(); redoRef.current.length = 0; };
  const focusCell = (i: number, f: string) => { focusPend.current = { i, f }; };

  // ── sheet ops ──────────────────────────────────────────────────────────────
  const switchSheet = (i: number) => { q._activeSheet = i; redraw(); };
  const addSheet = () => {
    const t = templates.filter((x) => x.companyId === q.companyId)[0] || templates[0];
    sheets.push({ templateId: t?.id, name: "", groupSubtotal: true, items: [], extraTables: [] });
    q._activeSheet = sheets.length - 1; mark(); redraw();
  };
  const removeSheet = async (i: number) => {
    if (sheets.length <= 1) return;
    if (!(await confirmModal("Xóa sheet", `Xóa sheet "${sheets[i].name || "Sheet " + (i + 1)}"?`, { danger: true, confirmText: "Xóa" }))) return;
    sheets.splice(i, 1);
    if (q._activeSheet >= sheets.length) q._activeSheet = sheets.length - 1;
    mark(); redraw();
  };

  // ── row ops (đều pushUndo để Ctrl+Z hoàn tác) ────────────────────────────────
  const pushItem = (it: ItemK) => { pushUndo(); it._k = _kSeq++; activeSheet.items.push(it); mark(); redraw(); focusCell(activeSheet.items.length - 1, "name"); };
  const addItem = () => pushItem(M.blankItem(usesDays));
  const addSection = () => pushItem(M.blankSection());
  const addSubSection = () => pushItem(M.blankSubSection());
  const addInfo = () => pushItem(M.blankInfo());
  const addSubAfter = (i: number) => { pushUndo(); const it = M.blankSub(usesDays) as ItemK; it._k = _kSeq++; activeSheet.items.splice(i + 1, 0, it); mark(); redraw(); focusCell(i + 1, showDetail ? "detail" : "unit"); };
  const removeRow = (i: number) => { pushUndo(); activeSheet.items.splice(i, 1); mark(); redraw(); };

  // ── save ───────────────────────────────────────────────────────────────────
  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        ...q,
        sheets: sheets.map((s, i) => {
          const stpl = templates.find((t) => t.id === s.templateId);
          const sUsesDays = !!stpl?.layout?.hasDays;
          return {
            templateId: s.templateId, name: s.name, order: i + 1, groupSubtotal: !!s.groupSubtotal,
            items: (s.items || []).map((it, j) => { const o = { ...it, order: j + 1, days: sUsesDays ? it.days : null }; delete (o as ItemK)._k; return o; }),
            extraTables: Array.isArray(s.extraTables) ? s.extraTables : [],
          };
        }),
      };
      delete payload._new; delete payload._activeSheet;
      if (isNew) delete payload.quoteNumber;
      const saved = isNew ? await api.createQuote(payload) : await api.updateQuote(q.id, payload);
      dirtyRef.current = false;
      toast("Đã lưu", "success");
      // chuyển sang chế độ sửa bản đã lưu (hash → #/redit/:id) — F5/back resolve đúng.
      if (isNew) location.hash = "#/redit/" + saved.id;
      else { qRef.current = { ...saved, _activeSheet: ai } as QuoteFull; stampKeys(qRef.current); redraw(); }
    } catch (ex) {
      toast(errText(ex), "error");
    } finally { setSaving(false); }
  };
  const convert = async () => {
    if (!(await confirmModal("Khách chốt", "Khách đã đồng ý — đánh dấu báo giá này ĐÃ CHỐT?", { confirmText: "Đã chốt" }))) return;
    try { const u = await api.markConverted(q.id); qRef.current = { ...u, _activeSheet: ai } as QuoteFull; stampKeys(qRef.current); toast("Đã chốt báo giá", "success"); redraw(); }
    catch (ex) { toast(ex instanceof ApiError ? ex.message : "Lỗi", "error"); }
  };
  const lost = async () => {
    const reason = await promptModal("Không chốt được đơn này", "Lý do (không bắt buộc):", { placeholder: "VD: Khách chọn nhà cung cấp khác, giá cao…" });
    if (reason === null) return;
    try { const u = await api.markLost(q.id, reason); qRef.current = { ...u, _activeSheet: ai } as QuoteFull; stampKeys(qRef.current); toast("Đã đánh dấu không chốt", "success"); redraw(); }
    catch (ex) { toast(ex instanceof ApiError ? ex.message : "Lỗi", "error"); }
  };
  const exportFile = async (ext: "xlsx" | "pdf") => {
    if (dirtyRef.current && !(await confirmModal("Có thay đổi chưa lưu", "File tải về là BẢN ĐÃ LƯU gần nhất — KHÔNG gồm thay đổi vừa sửa. Hãy Lưu trước rồi tải lại.", { confirmText: "Vẫn tải bản cũ" }))) return;
    window.open(`/api/export/${q.id}.${ext}?t=${Date.now()}`, "_blank");
  };

  // ── derived: row kinds + section sums + summary ──────────────────────────────
  const items = activeSheet.items as ItemK[];
  const rk = M.computeRowKinds(items);
  const sectionSum: Record<number, number> = {};
  { let cur = -1; for (let i = 0; i < items.length; i++) { if (rk[i] === "section") { cur = i; sectionSum[i] = 0; } else if ((rk[i] === "head" || rk[i] === "sub") && cur >= 0) sectionSum[cur] += M.lineAmount(items[i], usesDays); } }

  // ── A1 addressing + công thức Excel (Stage 2) ───────────────────────────────
  const ADDR: { f: string; ro?: boolean; L: string }[] = [
    { f: "_stt", ro: true, L: "" }, { f: "name", L: "" },
    ...(showDetail ? [{ f: "detail", L: "" }] : []),
    { f: "unit", L: "" }, { f: "quantity", L: "" },
    ...(usesDays ? [{ f: "days", L: "" }] : []),
    { f: "unitPrice", L: "" }, { f: "_amount", ro: true, L: "" }, { f: "notes", L: "" }, { f: "internalNote", L: "" },
  ];
  ADDR.forEach((c, i) => { c.L = M.groupLetter(i); });
  const NUMERIC = new Set(["quantity", "unitPrice", "days"]);
  const colByL: Record<string, { f: string }> = {}; ADDR.forEach((c) => { colByL[c.L] = c; });
  const idxOfL = (L: string) => ADDR.findIndex((c) => c.L === L);
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

  // ── undo/redo + dán Excel + Enter-nav (Stage 3) ──────────────────────────────
  const restore = (json: string) => { const arr = JSON.parse(json) as ItemK[]; arr.forEach((it) => { if (it._k == null) it._k = _kSeq++; }); activeSheet.items = arr; mark(); recomputeAll(); redraw(); };
  const doUndo = () => { if (!undoRef.current.length) return; redoRef.current.push(snap()); restore(undoRef.current.pop() as string); };
  const doRedo = () => { if (!redoRef.current.length) return; undoRef.current.push(snap()); restore(redoRef.current.pop() as string); };
  kbdRef.current = (e: KeyboardEvent) => {
    if (!editable) return;
    const z = e.key.toLowerCase() === "z", y = e.key.toLowerCase() === "y";
    if ((e.ctrlKey || e.metaKey) && z && !e.shiftKey) { e.preventDefault(); doUndo(); }
    else if ((e.ctrlKey || e.metaKey) && (y || (z && e.shiftKey))) { e.preventDefault(); doRedo(); }
  };
  const parseTSV = (text: string) => text.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n").map((ln) => ln.split("\t"));
  const onPaste = (e: { clipboardData: DataTransfer; target: EventTarget | null; preventDefault(): void }) => {
    if (!editable) return;
    const f0 = (e.target as HTMLElement)?.getAttribute?.("data-f"); if (!f0 || !FIELDS.includes(f0)) return;
    const text = e.clipboardData.getData("text/plain"); if (!text) return;
    const rows = parseTSV(text);
    if (rows.length <= 1 && (!rows[0] || rows[0].length <= 1)) return;   // 1 ô đơn → để trình duyệt dán
    e.preventDefault(); pushUndo();
    const i0 = focusRef.current?.i ?? 0;
    const c0 = Math.max(0, FIELDS.indexOf(f0));
    rows.forEach((cells, r) => {
      const ri = i0 + r;
      if (ri >= activeSheet.items.length) { const nit = M.blankItem(usesDays) as ItemK; nit._k = _kSeq++; activeSheet.items.push(nit); }
      const it = activeSheet.items[ri] as Record<string, unknown>;
      cells.forEach((val, c) => {
        const f = FIELDS[c0 + c]; if (!f) return;
        if (NUMERIC.has(f)) it[f] = val.trim() === "" ? 0 : M.parseVN(val);
        else it[f] = (f === "name" || f === "detail" || f === "notes" || f === "internalNote") ? val : val.trim().replace(/\s+/g, " ");
        if (it.formulas) delete (it.formulas as Record<string, string>)[f];
      });
    });
    recomputeAll(); mark(); redraw(); focusCell(i0, f0);
    toast(`Đã dán ${rows.length} dòng × ${rows[0].length} cột`, "success");
  };
  const onGridKeyDown = (e: { key: string; shiftKey: boolean; target: EventTarget | null; preventDefault(): void }) => {
    if (e.key !== "Enter" || e.shiftKey) return;   // Shift+Enter = xuống dòng trong ô nhiều dòng
    const fc = focusRef.current; if (!fc || !FIELDS.includes(fc.f)) return;
    e.preventDefault();
    if (fc.i + 1 >= activeSheet.items.length) { pushUndo(); const nit = M.blankItem(usesDays) as ItemK; nit._k = _kSeq++; activeSheet.items.push(nit); }
    focusCell(fc.i + 1, fc.f);
    redraw();   // luôn vẽ lại để effect focus ô đích chạy (kể cả khi không tạo hàng mới)
  };
  const onGridFocus = (e: { target: EventTarget | null }) => {
    const el = e.target as HTMLElement | null; const f = el?.getAttribute?.("data-f"); const tr = el?.closest?.("tr[data-row]");
    if (f && tr) focusRef.current = { i: parseInt(tr.getAttribute("data-row") || "0", 10), f };
  };

  // Ô SỐ: hỗ trợ công thức (=…) + gom nghìn LIVE (giữ con trỏ theo số chữ số) + ƒ badge xem công thức.
  const onNumInput = (i: number, f: string, el: HTMLInputElement) => {
    const raw = el.value; const it = items[i] as Record<string, unknown>;
    if (raw.trim().startsWith("=")) { mark(); return; }   // đang gõ công thức → để nguyên, xử lý ở blur
    const before = el.selectionStart ?? raw.length;
    const digitsBefore = raw.slice(0, before).replace(/\D/g, "").length;
    const formatted = M.liveFormat(raw);
    el.value = formatted;
    let pos = 0, seen = 0; while (pos < formatted.length && seen < digitsBefore) { if (/\d/.test(formatted[pos])) seen++; pos++; }
    try { el.setSelectionRange(pos, pos); } catch { /* ignore */ }
    const n = M.parseVN(formatted); it[f] = n;
    if (it.formulas) delete (it.formulas as Record<string, string>)[f];
    if (items[i].kind === "section" && f === "quantity" && n > 1 && !activeSheet.groupSubtotal) activeSheet.groupSubtotal = true;
    mark(); redraw();
  };
  const onNumBlur = (i: number, f: string, el: HTMLInputElement) => {
    const raw = el.value.trim(); const it = items[i] as Record<string, unknown>;
    if (raw.startsWith("=")) { if (!it.formulas) it.formulas = {}; (it.formulas as Record<string, string>)[f] = raw; const v = evalFormula(raw, refs); it[f] = v ?? 0; }
    else { if (it.formulas) delete (it.formulas as Record<string, string>)[f]; it[f] = M.parseVN(raw); }
    mark(); recomputeAll(); redraw();
  };
  const numInput = (i: number, f: "quantity" | "unitPrice" | "days") => {
    const it = items[i]; const fx = it.formulas?.[f]; const val = M.fmtNumCell(it[f] as number);
    return (<>
      <input key={fx ? `f-${it._k}-${f}-${val}` : `${it._k}-${f}`} data-f={f} inputMode="decimal" defaultValue={val} disabled={!editable}
        title="Số hoặc công thức Excel: =G3*E3, =SUM(H3:H8), 8% — tự tính kết quả"
        onInput={(e) => onNumInput(i, f, e.target as HTMLInputElement)} onBlur={(e) => onNumBlur(i, f, e.target as HTMLInputElement)} />
      {fx && <button type="button" className="fx-peek-badge" title={"Công thức: " + fx} onClick={() => peekFx(fx, val)}>ƒ</button>}
    </>);
  };
  const txtInput = (i: number, f: string, ph?: string) => (
    <input data-f={f} defaultValue={(items[i][f as keyof M.Item] as string) || ""} placeholder={ph} disabled={!editable} onInput={(e) => setItem(i, f, (e.target as HTMLInputElement).value)} />
  );
  const taInput = (i: number, f: string, ph?: string) => (
    <textarea data-f={f} rows={1} defaultValue={(items[i][f as keyof M.Item] as string) || ""} placeholder={ph} disabled={!editable}
      ref={autoGrow} onInput={(e) => { setItem(i, f, (e.target as HTMLTextAreaElement).value); autoGrow(e.target as HTMLTextAreaElement); }} />
  );
  const fcls = (i: number, f: string, base: string) => base + (items[i].formulas?.[f] ? " has-formula" : "");

  // dataCells: chung cho head + sub (mọi cột trừ STT + Hạng Mục). Có cột "Ghi chú nội bộ" (không xuất Excel).
  const dataCells = (i: number) => (
    <>
      {showDetail && <td className="col-detail">{taInput(i, "detail")}</td>}
      <td className="col-dvt">{txtInput(i, "unit")}</td>
      <td className={fcls(i, "quantity", "col-qty")} style={{ position: "relative" }}>{numInput(i, "quantity")}</td>
      {usesDays && <td className={fcls(i, "days", "col-qty")} style={{ position: "relative" }}>{numInput(i, "days")}</td>}
      <td className={fcls(i, "unitPrice", "col-price")} style={{ position: "relative" }}>{numInput(i, "unitPrice")}</td>
      <td className="col-amount">{M.fmtNumCell(M.lineAmount(items[i], usesDays))}</td>
      <td className="col-notes">{taInput(i, "notes")}</td>
      <td className="col-internal-note">{taInput(i, "internalNote", "(không xuất Excel)")}</td>
      {editable && <td className="col-action"><button className="add-sub" title="Thêm hàng con" onClick={() => addSubAfter(i)}>↳</button><button className="rm-row" title="Xóa hàng" onClick={() => removeRow(i)}>✕</button></td>}
    </>
  );

  const infoColspan = 6 + (showDetail ? 1 : 0) + (usesDays ? 1 : 0) + 1;
  let sttNo = 0, sectionIdx = -1, subNo = 0;

  const subtotalAll = sheets.reduce((acc, s) => { const t = templates.find((x) => x.id === s.templateId); return acc + M.sheetSubtotalGrouped(s.items, !!t?.layout?.hasDays, s.groupSubtotal); }, 0);
  const tt = M.quoteTotals(subtotalAll, q.vatPercent, q.discount);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h1>{isNew ? "Tạo báo giá mới" : "Báo giá " + M.codeLabel(q)}{!isNew && <span className={`status ${q.status}`} style={{ marginLeft: 10 }}>{M.statusLabel(q.status)}</span>}</h1>
        <button className="btn" onClick={back}>← Quay lại</button>
      </div>

      <div className="editor">
        <div className="meta-2col">
          <fieldset className="meta-col">
            <legend>Bên nhận · Khách hàng</legend>
            <label>Tên khách hàng<input defaultValue={q.toCompany || ""} placeholder="Tên công ty khách" disabled={!editable} onInput={(e) => setQ("toCompany", (e.target as HTMLInputElement).value)} /></label>
            <label>Người liên hệ<input defaultValue={q.toContact || ""} placeholder="Người liên hệ phía KH" disabled={!editable} onInput={(e) => setQ("toContact", (e.target as HTMLInputElement).value)} /></label>
            <label>Email<input type="email" defaultValue={q.toEmail || ""} placeholder="Email khách (hiện ở 'Kính gửi')" disabled={!editable} onInput={(e) => setQ("toEmail", (e.target as HTMLInputElement).value)} /></label>
            <label>Điện thoại<input defaultValue={q.toPhone || ""} placeholder="SĐT khách hàng" disabled={!editable} onInput={(e) => setQ("toPhone", (e.target as HTMLInputElement).value)} /></label>
            <label>Địa chỉ<input defaultValue={q.toAddress || ""} placeholder="Địa chỉ khách hàng" disabled={!editable} onInput={(e) => setQ("toAddress", (e.target as HTMLInputElement).value)} /></label>
          </fieldset>
          <fieldset className="meta-col">
            <legend>Bên gửi · Công ty báo giá</legend>
            <label>Công ty <span className="muted" style={{ fontSize: 11 }}>(đã chọn lúc tạo)</span>
              <select value={q.companyId} disabled title="Công ty đã chọn khi tạo báo giá — không đổi ở đây">{companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
            <label>Người gửi<input defaultValue={q.fromContact || ""} placeholder="Người phụ trách" disabled={!editable} onInput={(e) => setQ("fromContact", (e.target as HTMLInputElement).value)} /></label>
            <label>Chức danh<input defaultValue={q.fromTitle || ""} placeholder="VD: Trưởng phòng KD" disabled={!editable} onInput={(e) => setQ("fromTitle", (e.target as HTMLInputElement).value)} /></label>
            <label>Điện thoại<input defaultValue={q.fromPhone || ""} placeholder="SĐT người gửi" disabled={!editable} onInput={(e) => setQ("fromPhone", (e.target as HTMLInputElement).value)} /></label>
            <label>Địa chỉ <span className="muted" style={{ fontSize: 11 }}>(tự theo công ty)</span><input value={q.fromAddress || ""} readOnly title="Tự lấy theo Công ty bên gửi" disabled={!editable} /></label>
          </fieldset>
        </div>

        <div className="meta-row">
          <label>Số xuất Excel <span className="muted" style={{ fontSize: 11 }}>(GN…)</span><input value={q.quoteNumber || ""} placeholder={isNew ? "Tự động cấp khi lưu" : ""} readOnly disabled={!editable} /></label>
          <label>Ngày báo giá<input type="date" defaultValue={q.quoteDate} disabled={!editable} onInput={(e) => { setQ("quoteDate", (e.target as HTMLInputElement).value); redraw(); }} /></label>
          <label>Ngày thi công <span className="muted" style={{ fontSize: 11 }}>(nội bộ)</span><input type="date" defaultValue={q.executionDate || ""} disabled={!editable} onInput={(e) => setQ("executionDate", (e.target as HTMLInputElement).value)} /></label>
          <label>VAT (%)<input type="number" step="0.1" defaultValue={q.vatPercent} disabled={!editable} onInput={(e) => { setQ("vatPercent", Number((e.target as HTMLInputElement).value) || 0); redraw(); }} /></label>
          <label>Giảm giá (VNĐ) <span className="muted" style={{ fontSize: 11 }}>(trừ vào tổng)</span><input type="number" step="1000" min="0" defaultValue={Number(q.discount) || 0} disabled={!editable} onInput={(e) => { setQ("discount", Number((e.target as HTMLInputElement).value) || 0); redraw(); }} /></label>
        </div>

        <div className="center-line">{M.vnDateText(q.quoteDate, q.city)}</div>
        <input className="title-input" defaultValue={q.title || ""} placeholder="Tên báo giá (chung cho mọi sheet)" disabled={!editable} onInput={(e) => setQ("title", (e.target as HTMLInputElement).value)} />
        <div className="quote-no">(Số: {q.quoteNumber || ""})</div>
        <textarea className="greeting" rows={2} defaultValue={q.greeting || ""} disabled={!editable} onInput={(e) => setQ("greeting", (e.target as HTMLTextAreaElement).value)} />

        {/* sheet tabs */}
        <div className="sheet-tabs">
          {sheets.map((s, i) => (
            <div key={s._k ?? i} className={`sheet-tab ${i === ai ? "active" : ""}`} aria-pressed={i === ai} onClick={() => switchSheet(i)}>
              <span>{s.name || templates.find((t) => t.id === s.templateId)?.name || "Sheet " + (i + 1)}</span>
              {editable && sheets.length > 1 && <span className="rm-tab" title="Xóa sheet" onClick={(e) => { e.stopPropagation(); removeSheet(i); }}>✕</span>}
            </div>
          ))}
          {editable && <button className="btn btn-sm add-sheet" onClick={addSheet}>+ Thêm sheet</button>}
        </div>

        <div className="sheet-meta" style={{ display: "flex", gap: 14, margin: "8px 0", alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ fontSize: 13 }}>Tên sheet: <input value={activeSheet.name || ""} disabled={!editable} onChange={(e) => { activeSheet.name = e.target.value; mark(); redraw(); }} style={{ padding: "6px 10px", border: "1px solid var(--border-strong)", borderRadius: "var(--radius-sm)", background: "var(--surface)" }} /></label>
          <label style={{ fontSize: 13 }}>Template: <select value={activeSheet.templateId} disabled={!editable} onChange={(e) => { activeSheet.templateId = Number(e.target.value); mark(); redraw(); }}>{templates.filter((t) => t.companyId === q.companyId).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
        </div>

        <div className="tbl-scroll">
          <table className="excel-table" onPaste={onPaste} onKeyDown={onGridKeyDown} onFocus={onGridFocus}>
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
                <th scope="col" style={{ width: 150 }} className="th-internal-note" title="Chỉ xem/quản lý nội bộ — KHÔNG xuất ra Excel/PDF">GHI CHÚ NỘI BỘ<br /><span style={{ fontWeight: 400, fontSize: 10, opacity: 0.75 }}>(không xuất Excel)</span></th>
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
                      <td className="col-stt"><input data-f="label" defaultValue={it.label || ""} placeholder={letter} disabled={!editable} style={{ width: 34, textAlign: "center" }} onInput={(e) => setItem(i, "label", (e.target as HTMLInputElement).value)} /></td>
                      <td className="col-hangmuc"><textarea data-f="name" rows={1} defaultValue={it.name || ""} placeholder={isSub ? "Tên nhóm con" : "Tên nhóm (vd: Wallsticker)"} disabled={!editable} ref={autoGrow} onInput={(e) => { setItem(i, "name", (e.target as HTMLTextAreaElement).value); autoGrow(e.target as HTMLTextAreaElement); }} /></td>
                      {showDetail && <td className="col-detail" />}
                      <td className="col-dvt">{txtInput(i, "unit")}</td>
                      <td className={fcls(i, "quantity", "col-qty")} style={{ position: "relative" }}>{numInput(i, "quantity")}</td>
                      {usesDays && <td className="col-qty" />}
                      <td className="col-price">{M.fmtNumCell(subAmt)}</td>
                      <td className="col-amount">{activeSheet.groupSubtotal ? M.fmtNumCell(subAmt * Math.max(1, Number(it.quantity) || 1)) : ""}</td>
                      <td className="col-notes">{taInput(i, "notes", "Ghi chú nhóm")}</td>
                      <td className="col-internal-note">{taInput(i, "internalNote", "(không xuất Excel)")}</td>
                      {editable && <td className="col-action"><button className="rm-row" title={isSub ? "Xóa nhóm con" : "Xóa nhóm"} onClick={() => removeRow(i)}>✕</button></td>}
                    </tr>
                  );
                }
                if (rk[i] === "info") {
                  return (
                    <tr key={it._k ?? i} data-row={i} className="info-row">
                      <td className="col-stt" />
                      <td className="col-info" colSpan={infoColspan}><textarea data-f="name" rows={1} defaultValue={it.name || ""} placeholder="Dòng thông tin chương trình (không tính tiền)" disabled={!editable} ref={autoGrow} onInput={(e) => { setItem(i, "name", (e.target as HTMLTextAreaElement).value); autoGrow(e.target as HTMLTextAreaElement); }} /></td>
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
                    <td className="col-hangmuc" rowSpan={span}><textarea data-f="name" rows={1} defaultValue={it.name || ""} disabled={!editable} ref={autoGrow} onInput={(e) => { setItem(i, "name", (e.target as HTMLTextAreaElement).value); autoGrow(e.target as HTMLTextAreaElement); }} /></td>
                    {dataCells(i)}
                  </tr>
                );
              })}
              {items.length === 0 && <tr><td colSpan={12} className="muted" style={{ textAlign: "center", padding: 18 }}>Chưa có hàng nào — bấm “+ Thêm hàng” bên dưới.</td></tr>}
            </tbody>
          </table>
        </div>

        {editable && (
          <div className="grid-add-bar" style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "10px 0" }}>
            <button className="btn btn-sm" onClick={addItem}>+ Thêm hàng</button>
            <button className="btn btn-sm" onClick={addSection}>+ Thêm nhóm</button>
            <button className="btn btn-sm" onClick={addSubSection}>+ Nhóm con</button>
            <button className="btn btn-sm" onClick={addInfo}>+ Dòng thông tin</button>
          </div>
        )}

        {editable && (
          <label className="toggle-totals" style={{ display: "inline-flex", alignItems: "center", gap: 8, margin: "16px 0 6px", fontSize: 13.5, cursor: "pointer" }}>
            <input type="checkbox" defaultChecked={q.showTotals !== false} onChange={(e) => { setQ("showTotals", e.target.checked); redraw(); }} />
            <span>Hiển thị bảng <strong>Tổng cộng / VAT / Thành tiền</strong> (cả màn hình lẫn Excel/PDF)</span>
          </label>
        )}

        {q.showTotals !== false && (
          <div className="quote-summary">
            <h3 style={{ margin: "18px 0 6px" }}>Tổng báo giá ({sheets.length} sheet)</h3>
            <table className="summary-table">
              <thead><tr><th scope="col">STT</th><th scope="col">Sheet</th><th scope="col" style={{ textAlign: "right" }}>Tổng (VNĐ)</th></tr></thead>
              <tbody>
                {sheets.map((s, i) => { const t = templates.find((x) => x.id === s.templateId); const sub = M.sheetSubtotalGrouped(s.items, !!t?.layout?.hasDays, s.groupSubtotal); return <tr key={s._k ?? i}><td style={{ textAlign: "center" }}>{i + 1}</td><td>{s.name || t?.name || `Sheet ${i + 1}`}</td><td style={{ textAlign: "right" }}>{M.fmtMoney(sub)}</td></tr>; })}
              </tbody>
              <tfoot>
                <tr><td colSpan={2}>Tổng cộng</td><td style={{ textAlign: "right" }}>{M.fmtMoney(tt.subtotal)}</td></tr>
                <tr><td colSpan={2}>VAT ({Number(q.vatPercent) || 0}%)</td><td style={{ textAlign: "right" }}>{M.fmtMoney(tt.vat)}</td></tr>
                {tt.discount > 0 && <tr><td colSpan={2}>Giảm giá</td><td style={{ textAlign: "right" }}>-{M.fmtMoney(tt.discount)}</td></tr>}
                <tr><td colSpan={2}><strong>Thành tiền</strong></td><td style={{ textAlign: "right", color: "var(--danger)" }}><strong>{M.fmtMoney(tt.total)}</strong></td></tr>
              </tfoot>
            </table>
          </div>
        )}

        <div className="actions">
          {editable && <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? "Đang lưu…" : "Lưu"}</button>}
          {!isNew && !["converted", "lost"].includes(q.status) && hasPerm("quote:send") && <button className="btn btn-success" onClick={convert}>✓ Khách chốt</button>}
          {!isNew && !["converted", "lost"].includes(q.status) && hasPerm("quote:send") && <button className="btn btn-danger" onClick={lost}>✗ Khách không chốt</button>}
          {!isNew && (
            <>
              <button className="btn" onClick={() => exportFile("xlsx")}>Tải Excel</button>
              <button className="btn" onClick={() => exportFile("pdf")}>Tải PDF</button>
              <button className="btn" onClick={async () => { try { const r = await api.quoteVersions(q.id); setVersions(r.data); } catch (ex) { toast(ex instanceof ApiError ? ex.message : "Lỗi", "error"); } }}>Lịch sử phiên bản</button>
              {(me.role === "admin" || q.createdById === me.id) && <button className="btn" onClick={() => setMembersOpen(true)}>Thành viên phụ trách</button>}
            </>
          )}
        </div>
      </div>

      {versions && <VersionsModal versions={versions} onClose={() => setVersions(null)} />}
      {membersOpen && <MembersModal quoteId={q.id} current={(q.members || []).map((m) => m.id)} onClose={() => setMembersOpen(false)} onSaved={(ids) => { q.members = ids.map((id) => ({ id })); setMembersOpen(false); }} />}
    </div>
  );
}

function VersionsModal({ versions, onClose }: { versions: QuoteVersion[]; onClose: () => void }) {
  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Lịch sử phiên bản">
        <div className="modal-head"><h3>Lịch sử phiên bản</h3><button className="icon-btn" onClick={onClose} aria-label="Đóng">✕</button></div>
        <div className="modal-body">
          {versions.length === 0 ? <p className="muted">Chưa có phiên bản nào.</p> : (
            <table className="list-table"><thead><tr><th>Phiên bản</th><th>Thời gian</th><th style={{ textAlign: "right" }}>Tổng (VNĐ)</th></tr></thead>
              <tbody>{versions.map((v) => <tr key={v.id}><td>#{v.versionNo}</td><td>{M.fmtDate(v.createdAt)}</td><td style={{ textAlign: "right" }}>{M.fmtMoney(v.total)}</td></tr>)}</tbody></table>
          )}
        </div>
        <div className="modal-foot"><button className="btn btn-primary" onClick={onClose}>Đóng</button></div>
      </div>
    </div>
  );
}

function MembersModal({ quoteId, current, onClose, onSaved }: { quoteId: number; current: number[]; onClose: () => void; onSaved: (ids: number[]) => void }) {
  const [users, setUsers] = useState<AssignableUser[] | null>(null);
  const [sel, setSel] = useState<number[]>(current);
  const [saving, setSaving] = useState(false);
  useEffect(() => { api.assignableUsers().then((r) => setUsers(r.data)).catch(() => setUsers([])); }, []);
  const toggle = (id: number) => setSel((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id]);
  const save = async () => { setSaving(true); try { await api.setMembers(quoteId, sel); toast("Đã lưu thành viên", "success"); onSaved(sel); } catch (ex) { toast(ex instanceof ApiError ? ex.message : "Lỗi", "error"); setSaving(false); } };
  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Thành viên phụ trách">
        <div className="modal-head"><h3>Thành viên phụ trách</h3><button className="icon-btn" onClick={onClose} aria-label="Đóng">✕</button></div>
        <div className="modal-body">
          <p className="muted" style={{ marginTop: 0 }}>Cho phép xem & sửa báo giá này.</p>
          {!users ? <div className="skeleton-wrap">{Array.from({ length: 4 }).map((_, i) => <div className="skeleton-row" key={i} />)}</div> : (
            <div className="list-wrap">{users.map((u) => <label key={u.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", cursor: "pointer" }}><input type="checkbox" checked={sel.includes(u.id)} onChange={() => toggle(u.id)} /><span>{u.displayName}{u.title ? <span className="muted"> · {u.title}</span> : ""}</span></label>)}</div>
          )}
        </div>
        <div className="modal-foot"><button className="btn" onClick={onClose}>Hủy</button><button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? "Đang lưu…" : "Lưu"}</button></div>
      </div>
    </div>
  );
}
