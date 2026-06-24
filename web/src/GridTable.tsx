import { useEffect, useRef, useState } from "react";
import { toast } from "./ui";
import * as M from "./quoteMath";
import { evalFormula, type FormulaRefs } from "./formula";
import { type ItemK, nextK, autoGrow } from "./gridShared";

// Lưới Excel DÙNG CHUNG (lưới chính báo giá + mỗi bảng nội bộ HCM/HN/Khách). Bê đầy đủ drawItems:
// head/sub/section/subsection/info + rowspan, công thức =… (badge ƒ), gom-nghìn-live, dán Excel khối,
// Enter-nav, undo/redo (Ctrl+Z/Y theo lưới đang focus), thêm/xóa hàng·nhóm·nhóm-con·dòng-thông-tin.
// Mutate `items` TẠI CHỖ rồi gọi onChange() (cha: mark dirty + vẽ lại tổng). Mỗi instance có undo riêng.

export type GridTableProps = {
  items: ItemK[];
  usesDays: boolean;
  showDetail: boolean;
  numberSubs: boolean;
  editable: boolean;
  internalNote: boolean;           // lưới chính: true (cột Ghi chú nội bộ); bảng nội bộ: false
  approveCol?: boolean;            // bảng nội bộ HCM/Khách: cột Duyệt
  canApprove?: boolean;           // chỉ admin tick Duyệt
  groupSubtotal: boolean;
  onGroupSubtotal?: (v: boolean) => void;   // tự bật khi Số Lượng nhóm > 1
  onChange: () => void;           // cha: mark dirty + redraw (cập nhật tổng)
};

export function GridTable(props: GridTableProps) {
  const { items, usesDays, showDetail, numberSubs, editable, internalNote, approveCol, canApprove, groupSubtotal, onGroupSubtotal, onChange } = props;
  const [, setTick] = useState(0);
  const navRedraw = () => setTick((t) => t + 1);     // vẽ lại CHỈ lưới này (điều hướng, không đổi dữ liệu)
  const undoRef = useRef<string[]>([]);
  const redoRef = useRef<string[]>([]);
  const focusRef = useRef<{ i: number; f: string } | null>(null);
  const focusPend = useRef<{ i: number; f: string } | null>(null);
  const tableRef = useRef<HTMLTableElement | null>(null);

  // Ctrl+Z/Y — chỉ tác động khi ô đang focus NẰM TRONG lưới này (nhiều lưới cùng tồn tại).
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!editable || !tableRef.current?.contains(document.activeElement)) return;
      const z = e.key.toLowerCase() === "z", y = e.key.toLowerCase() === "y";
      if ((e.ctrlKey || e.metaKey) && z && !e.shiftKey) { e.preventDefault(); doUndo(); }
      else if ((e.ctrlKey || e.metaKey) && (y || (z && e.shiftKey))) { e.preventDefault(); doRedo(); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editable]);
  // Focus ô đích sau khi vẽ lại (paste / Enter-nav / undo) — quét TRONG lưới này.
  useEffect(() => {
    if (!focusPend.current || !tableRef.current) return;
    const { i, f } = focusPend.current; focusPend.current = null;
    const el = tableRef.current.querySelector(`tr[data-row="${i}"] [data-f="${f}"]`) as HTMLInputElement | HTMLTextAreaElement | null;
    if (el) { el.focus(); try { const n = el.value.length; el.setSelectionRange(n, n); } catch { /* ignore */ } }
  });

  const FIELDS = (["name", showDetail ? "detail" : null, "unit", "quantity", usesDays ? "days" : null, "unitPrice", "notes", internalNote ? "internalNote" : null].filter(Boolean)) as string[];
  const NUMERIC = new Set(["quantity", "unitPrice", "days"]);
  const setItem = (i: number, f: string, v: unknown) => { (items[i] as Record<string, unknown>)[f] = v; onChange(); };
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

  // ── row ops ──────────────────────────────────────────────────────────────────
  const pushItem = (it: ItemK) => { pushUndo(); it._k = nextK(); items.push(it); onChange(); focusCell(items.length - 1, "name"); };
  const addItem = () => pushItem(M.blankItem(usesDays));
  const addSection = () => pushItem(M.blankSection());
  const addSubSection = () => pushItem(M.blankSubSection());
  const addInfo = () => pushItem(M.blankInfo());
  const addSubAfter = (i: number) => { pushUndo(); const it = M.blankSub(usesDays) as ItemK; it._k = nextK(); items.splice(i + 1, 0, it); onChange(); focusCell(i + 1, showDetail ? "detail" : "unit"); };
  const removeRow = (i: number) => { pushUndo(); items.splice(i, 1); onChange(); };

  // ── undo/redo + dán + nav ─────────────────────────────────────────────────────
  const restore = (json: string) => { const arr = JSON.parse(json) as ItemK[]; arr.forEach((it) => { if (it._k == null) it._k = nextK(); }); items.splice(0, items.length, ...arr); recomputeAll(); onChange(); };
  const doUndo = () => { if (!undoRef.current.length) return; redoRef.current.push(snap()); restore(undoRef.current.pop() as string); };
  const doRedo = () => { if (!redoRef.current.length) return; undoRef.current.push(snap()); restore(redoRef.current.pop() as string); };
  const parseTSV = (text: string) => text.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n").map((ln) => ln.split("\t"));
  const onPaste = (e: { clipboardData: DataTransfer; target: EventTarget | null; preventDefault(): void }) => {
    if (!editable) return;
    const f0 = (e.target as HTMLElement)?.getAttribute?.("data-f"); if (!f0 || !FIELDS.includes(f0)) return;
    const text = e.clipboardData.getData("text/plain"); if (!text) return;
    const rows = parseTSV(text);
    if (rows.length <= 1 && (!rows[0] || rows[0].length <= 1)) return;
    e.preventDefault(); pushUndo();
    const i0 = focusRef.current?.i ?? 0;
    const c0 = Math.max(0, FIELDS.indexOf(f0));
    rows.forEach((cells, r) => {
      const ri = i0 + r;
      if (ri >= items.length) { const nit = M.blankItem(usesDays) as ItemK; nit._k = nextK(); items.push(nit); }
      const it = items[ri] as Record<string, unknown>;
      cells.forEach((val, c) => {
        const f = FIELDS[c0 + c]; if (!f) return;
        if (NUMERIC.has(f)) it[f] = val.trim() === "" ? 0 : M.parseVN(val);
        else it[f] = (f === "name" || f === "detail" || f === "notes" || f === "internalNote") ? val : val.trim().replace(/\s+/g, " ");
        if (it.formulas) delete (it.formulas as Record<string, string>)[f];
      });
    });
    recomputeAll(); onChange(); focusCell(i0, f0);
    toast(`Đã dán ${rows.length} dòng × ${rows[0].length} cột`, "success");
  };
  const onGridKeyDown = (e: { key: string; shiftKey: boolean; target: EventTarget | null; preventDefault(): void }) => {
    if (e.key !== "Enter" || e.shiftKey) return;
    const fc = focusRef.current; if (!fc || !FIELDS.includes(fc.f)) return;
    e.preventDefault();
    if (fc.i + 1 >= items.length) { pushUndo(); const nit = M.blankItem(usesDays) as ItemK; nit._k = nextK(); items.push(nit); onChange(); }
    focusCell(fc.i + 1, fc.f);
    navRedraw();
  };
  const onGridFocus = (e: { target: EventTarget | null }) => {
    const el = e.target as HTMLElement | null; const f = el?.getAttribute?.("data-f"); const tr = el?.closest?.("tr[data-row]");
    if (f && tr) focusRef.current = { i: parseInt(tr.getAttribute("data-row") || "0", 10), f };
  };

  // ── ô SỐ (công thức + gom nghìn live) / text / textarea ──────────────────────
  const onNumInput = (i: number, f: string, el: HTMLInputElement) => {
    const raw = el.value; const it = items[i] as Record<string, unknown>;
    if (raw.trim().startsWith("=")) { onChange(); return; }
    const before = el.selectionStart ?? raw.length;
    const digitsBefore = raw.slice(0, before).replace(/\D/g, "").length;
    const formatted = M.liveFormat(raw);
    el.value = formatted;
    let pos = 0, seen = 0; while (pos < formatted.length && seen < digitsBefore) { if (/\d/.test(formatted[pos])) seen++; pos++; }
    try { el.setSelectionRange(pos, pos); } catch { /* ignore */ }
    const n = M.parseVN(formatted); it[f] = n;
    if (it.formulas) delete (it.formulas as Record<string, string>)[f];
    if (items[i].kind === "section" && f === "quantity" && n > 1 && !groupSubtotal) onGroupSubtotal?.(true);
    onChange();
  };
  const onNumBlur = (i: number, f: string, el: HTMLInputElement) => {
    const raw = el.value.trim(); const it = items[i] as Record<string, unknown>;
    if (raw.startsWith("=")) { if (!it.formulas) it.formulas = {}; (it.formulas as Record<string, string>)[f] = raw; const v = evalFormula(raw, refs); it[f] = v ?? 0; }
    else { if (it.formulas) delete (it.formulas as Record<string, string>)[f]; it[f] = M.parseVN(raw); }
    recomputeAll(); onChange();
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
  const toggleApprove = (i: number, checked: boolean) => { const it = items[i] as Record<string, unknown>; it.approved = checked; it.approvedAt = checked ? new Date().toISOString() : null; onChange(); };

  // ── derived ───────────────────────────────────────────────────────────────────
  const rk = M.computeRowKinds(items);
  const sectionSum: Record<number, number> = {};
  { let cur = -1; for (let i = 0; i < items.length; i++) { if (rk[i] === "section") { cur = i; sectionSum[i] = 0; } else if ((rk[i] === "head" || rk[i] === "sub") && cur >= 0) sectionSum[cur] += M.lineAmount(items[i], usesDays); } }
  const extraCols = (internalNote ? 1 : 0) + (approveCol ? 1 : 0);
  const infoColspan = 6 + (showDetail ? 1 : 0) + (usesDays ? 1 : 0) + extraCols;
  let sttNo = 0, sectionIdx = -1, subNo = 0;

  const dataCells = (i: number) => (
    <>
      {showDetail && <td className="col-detail">{taInput(i, "detail")}</td>}
      <td className="col-dvt">{txtInput(i, "unit")}</td>
      <td className={fcls(i, "quantity", "col-qty")} style={{ position: "relative" }}>{numInput(i, "quantity")}</td>
      {usesDays && <td className={fcls(i, "days", "col-qty")} style={{ position: "relative" }}>{numInput(i, "days")}</td>}
      <td className={fcls(i, "unitPrice", "col-price")} style={{ position: "relative" }}>{numInput(i, "unitPrice")}</td>
      <td className="col-amount">{M.fmtNumCell(M.lineAmount(items[i], usesDays))}</td>
      <td className="col-notes">{taInput(i, "notes")}</td>
      {internalNote && <td className="col-internal-note">{taInput(i, "internalNote", "(không xuất Excel)")}</td>}
      {approveCol && <td className="col-approve">{editable ? <label className="ap-wrap"><input type="checkbox" defaultChecked={!!items[i].approved} disabled={!canApprove} onChange={(e) => toggleApprove(i, e.target.checked)} /> Duyệt</label> : (items[i].approved ? "✓" : "")}{items[i].approved && items[i].approvedAt ? <span className="ap-date"> ✓ {M.fmtDate(items[i].approvedAt)}</span> : null}</td>}
      {editable && <td className="col-action"><button className="add-sub" title="Thêm hàng con" onClick={() => addSubAfter(i)}>↳</button><button className="rm-row" title="Xóa hàng" onClick={() => removeRow(i)}>✕</button></td>}
    </>
  );

  return (
    <>
      <div className="tbl-scroll">
        <table className="excel-table" ref={tableRef} onPaste={onPaste} onKeyDown={onGridKeyDown} onFocus={onGridFocus}>
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
                    <td className="col-amount">{groupSubtotal ? M.fmtNumCell(subAmt * Math.max(1, Number(it.quantity) || 1)) : ""}</td>
                    <td className="col-notes">{taInput(i, "notes", "Ghi chú nhóm")}</td>
                    {internalNote && <td className="col-internal-note">{taInput(i, "internalNote", "(không xuất Excel)")}</td>}
                    {approveCol && <td className="col-approve" />}
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
    </>
  );
}
