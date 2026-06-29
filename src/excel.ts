import ExcelJS from "exceljs";
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getConfig } from "./templateConfigs.js";
import { stitchXlsxBuffers } from "./xlsxStitcher.js";
import { buildFormulaContext } from "./quoteFormula.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

// CẮT số về 2 chữ số thập phân — KHÔNG làm tròn (5,6375→5,63). Khớp util.js (web) + money.js (ROUND_DOWN).
function trunc2(x: any) {
  const n = Number(x) || 0;
  const t = Math.trunc(Math.abs(n) * 100 + 1e-6) / 100;   // +1e-6 khử nhiễu float, vẫn CẮT (không làm tròn)
  return n < 0 ? -t : t;
}

// Template .xlsx files never change at runtime — read each from disk ONCE and
// cache the bytes in RAM. Every export then loads from the cached Buffer instead
// of re-reading ~170-207 KB/sheet off disk (big win on the inline export path).
const _templateCache = new Map();
function templateBuffer(filePath: string) {
  let buf = _templateCache.get(filePath);
  if (!buf) { buf = readFileSync(path.join(ROOT, filePath)); _templateCache.set(filePath, buf); }
  return buf;
}

function vnDateText(d: any, city: any) {
  const dt = d instanceof Date ? d : new Date(d);
  return `${city || "TP. Hồ Chí Minh"}, ngày ${String(dt.getDate()).padStart(2, "0")} tháng ${String(dt.getMonth() + 1).padStart(2, "0")} năm ${dt.getFullYear()}`;
}

// Neutralize spreadsheet formula injection: a text cell whose value starts with
// = + - @ (or a leading tab/CR) is interpreted as a formula by Excel/Sheets when
// the exported file is opened. Prefix a zero-width-safe apostrophe so the value
// is shown literally. Only applied to plain strings (numbers/dates untouched).
function neutralizeFormula(value: any) {
  if (typeof value !== "string" || value.length === 0) return value;
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function setCell(ws: any, ref: any, value: any) {
  if (!ref) return;
  ws.getCell(ref).value = neutralizeFormula(value);
}

function safeMerge(ws: any, range: any) {
  try { ws.mergeCells(range); } catch {}
}

function safeUnmerge(ws: any, range: any) {
  try { ws.unMergeCells(range); } catch {}
}

/** Ensure a cell has wrapText alignment so multi-line content displays correctly */
function ensureWrap(cell: any) {
  const align = cell.alignment ? { ...cell.alignment } : {};
  align.wrapText = true;
  if (!align.vertical) align.vertical = "middle";
  cell.alignment = align;
}

/**
 * Set a cell's fill and/or font color WITHOUT leaking the change to sibling cells.
 * ExcelJS shares one style object across every cell that has identical styling
 * (very common in template-loaded sheets where whole item ranges are styled the
 * same). Mutating a property via `cell.fill = …` / `cell.font = …` mutates that
 * SHARED object, so the colour bleeds onto neighbouring cells (e.g. a green group
 * row tinting the plain item rows around it). Cloning the cell's style into a fresh
 * per-cell object first isolates the change to this one cell.
 */
function paintCell(cell: any, { fill, fontColor, bold }: { fill?: any; fontColor?: any; bold?: any } = {}) {
  const style = cell.style ? JSON.parse(JSON.stringify(cell.style)) : {};
  if (fill === "none") style.fill = { type: "pattern", pattern: "none" };   // xoá nền (để ô trắng)
  else if (fill) style.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
  if (fontColor != null || bold != null) {
    style.font = { ...(style.font || {}) };
    if (fontColor != null) style.font.color = { argb: fontColor };
    if (bold != null) style.font.bold = bold;
  }
  cell.style = style;
}

/** Strip leading/trailing whitespace AND collapse internal newlines to spaces. */
function clean(s: any) {
  if (s == null) return "";
  return String(s).replace(/[\r\n]+/g, " ").trim();
}

/** 0→"A", 1→"B", …, 25→"Z", 26→"AA". Auto letter for section (nhóm) rows. */
function sectionLetter(n: number) {
  let s = "", x = n + 1;
  while (x > 0) { const m = (x - 1) % 26; s = String.fromCharCode(65 + m) + s; x = Math.floor((x - 1) / 26); }
  return s;
}

/** Parse "C3" → 0-based {col,row} anchor used by ExcelJS addImage. */
function cellAnchor(ref: any) {
  const m = /^([A-Z]+)(\d+)$/i.exec(ref || "");
  if (!m) return { col: 0, row: 0 };
  let col = 0;
  for (const ch of m[1].toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { col: col - 1, row: Number(m[2]) - 1 };
}

/** Insert a base64 data-URL image floating over the given cell; clears the cell text. */
const MAX_LOGO_BYTES = 6 * 1024 * 1024; // hard cap on decoded logo size (DoS guard)

function insertCustomerLogo(ws: any, ref: any, dataUrl: any, ext: any) {
  const m = /^data:image\/(png|jpe?g|gif);base64,(.+)$/i.exec(dataUrl);
  if (!m) return;
  let extension = m[1].toLowerCase();
  if (extension === "jpg") extension = "jpeg";
  // Reject oversize logos up front (decoded size ≈ base64 length * 3/4) so a huge
  // data-URL can't be buffered into memory during export.
  if (Math.floor((m[2].length * 3) / 4) > MAX_LOGO_BYTES) return;
  try {
    const buffer = Buffer.from(m[2], "base64");
    const imageId = ws.workbook.addImage({ buffer, extension });
    try { ws.getCell(ref).value = null; } catch {}
    const a = cellAnchor(ref);
    ws.addImage(imageId, {
      tl: { col: a.col + 0.05, row: a.row + 0.05 },
      ext: ext || { width: 170, height: 64 },
      editAs: "oneCell",
    });
  } catch { /* ignore bad image */ }
}

function applyTemplateCleanup(ws: any, cfg: any) {
  const cleanup = cfg.cleanup || {};

  // Unmerge ranges left over from the sample (e.g. vertically-merged STT / Hạng Mục
  // cells that grouped sub-items). Must run BEFORE filling items so each row writes
  // independently. Accepts a master cell ("C7") or an explicit range ("C7:C9").
  for (const ref of (cleanup.unmergeRanges || [])) {
    try { ws.unMergeCells(ref); } catch {}
  }

  // Clear leftover residual cells (uses original row positions)
  for (const ref of (cleanup.extraCellsToClear || [])) {
    try { ws.getCell(ref).value = null; } catch {}
  }

  // Remove all images outside the header area (keep only logo)
  if (cleanup.keepImagesAboveRow != null && Array.isArray(ws._media)) {
    const keep = cleanup.keepImagesAboveRow;
    ws._media = ws._media.filter((m: any) => {
      const top = m.range?.tl?.nativeRow ?? 99;
      return top < keep;
    });
  }

  // Remove specific rows entirely (do this LAST, in reverse order to keep indices valid)
  // ExcelJS spliceRows has a batch-count bug — splice 1 row at a time.
  const toRemove = (cleanup.removeRows || []).slice().sort((a: any, b: any) => b - a);
  for (const r of toRemove) {
    try { ws.spliceRows(r, 1); } catch {}
  }
}

function unmergeTotals(ws: any, cfg: any, lastItemRow: any) {
  // Unmerge each totals row's label cells BEFORE splicing,
  // so ExcelJS doesn't carry stale merge references after splice.
  const t = cfg.totals;
  const rows = [
    lastItemRow + t.subtotal.rowOffset,
    lastItemRow + t.vat.rowOffset,
    lastItemRow + t.total.rowOffset,
  ];
  const groups = [t.subtotal, t.vat, t.total];
  rows.forEach((r, i) => {
    for (const [colStart, colEnd] of (groups[i].labelCells || [])) {
      if (colStart !== colEnd) safeUnmerge(ws, `${colStart}${r}:${colEnd}${r}`);
    }
  });
}

/** Fill data for one sheet using its template config. Returns totals.
 *  sheetLabel: khi báo giá có NHIỀU sheet, tên sheet được nối vào tiêu đề ("… - Banner"). */
function fillSheetData(ws: any, cfg: any, quote: any, sheet: any, vatPct: any, sheetLabel?: string) {
  applyTemplateCleanup(ws, cfg);

  const c = cfg.cells;
  const pal = cfg.palette || null;   // bảng màu tuỳ template (GN: peach/xanh lá/xanh dương)
  let items = (sheet.items || []).slice().sort((a: any, b: any) => (a.order || 0) - (b.order || 0));
  // Thứ tự item THEO ĐÚNG EDITOR (trước khi lọc dòng "info" của CLF) — công thức người
  // dùng đánh ref theo thứ tự này; giữ lại để dịch ref đúng dù `items` bị lọc bên dưới.
  const editorItems = items.slice();

  // Templates with a dedicated "program info" banner (CLF B5) collect kind:"info"
  // rows into that single cell instead of rendering them as item rows. The banner
  // is CLEARED when the quote has no info line, so the placeholder dots never print
  // — i.e. the line is opt-in per quote (the toggle the J5 guide note asked for).
  if (c.infoBannerCell) {
    const infoLines = items.filter((it: any) => it.kind === "info").map((it: any) => (it.name || "").trim()).filter(Boolean);
    items = items.filter((it: any) => it.kind !== "info");
    setCell(ws, c.infoBannerCell, infoLines.length ? `* Thông tin chương trình: ${infoLines.join("; ")}` : "");
    ensureWrap(ws.getCell(c.infoBannerCell));
  }

  if (c.toCompany) setCell(ws, c.toCompany, clean(quote.toCompany));
  if (c.toContact) setCell(ws, c.toContact, clean(quote.toContact));
  if (c.toPhone) setCell(ws, c.toPhone, clean(quote.toPhone));
  if (c.toAddress) setCell(ws, c.toAddress, clean(quote.toAddress));
  // Combined recipient block (e.g. CLF "Kính gửi: Cty X  Mr/Ms Y  Email: Z")
  if (c.toBlockCell) {
    const txt = c.toBlockFormat
      ? c.toBlockFormat({ company: quote.toCompany, contact: quote.toContact, email: quote.toEmail, phone: quote.toPhone, address: quote.toAddress })
      : (quote.toCompany || "");
    // Keep newlines (multi-line recipient block) — don't collapse via clean().
    setCell(ws, c.toBlockCell, (txt || "").trim());
    ensureWrap(ws.getCell(c.toBlockCell));
  }
  if (c.fromContactCell) {
    const txt = c.fromContactFormat
      ? c.fromContactFormat({ contact: quote.fromContact, title: quote.fromTitle, phone: quote.fromPhone })
      : (quote.fromContact || "");
    setCell(ws, c.fromContactCell, clean(txt));
  }
  // Combined sender letterhead block (e.g. CLF F1: company / address / contact - title - phone).
  if (c.fromBlockCell) {
    const txt = c.fromBlockFormat
      ? c.fromBlockFormat({
          companyName: quote.company?.name,
          contact: quote.fromContact,
          title: quote.fromTitle,
          phone: quote.fromPhone,
          address: quote.fromAddress,
        })
      : (quote.fromContact || "");
    setCell(ws, c.fromBlockCell, (txt || "").trim());
    ensureWrap(ws.getCell(c.fromBlockCell));
  }
  if (c.fromPhone) setCell(ws, c.fromPhone, clean(quote.fromPhone));
  if (c.fromAddress) setCell(ws, c.fromAddress, clean(quote.fromAddress));
  if (c.date) setCell(ws, c.date, vnDateText(quote.quoteDate, quote.city));
  if (c.title) {
    let title = c.titleFormat ? c.titleFormat(quote.title) : (quote.title || "");
    // Báo giá nhiều sheet: nối tên sheet vào tiêu đề ("BẢNG BÁO GIÁ - MOANA - POSM - Banner").
    const lbl = (sheetLabel || "").trim();
    if (lbl) title = `${title} - ${lbl}`;
    setCell(ws, c.title, clean(title));
  }
  if (c.quoteNumber) {
    setCell(ws, c.quoteNumber, c.quoteNumberFormat ? c.quoteNumberFormat(quote.quoteNumber) : (quote.quoteNumber || ""));
  }
  if (c.greeting) setCell(ws, c.greeting, quote.greeting || "");

  // Customer logo: if the template has an anchor cell and the quote carries a
  // base64 logo, drop the placeholder text and float the image over that cell.
  if (c.customerLogoCell && quote.customerLogo) {
    insertCustomerLogo(ws, c.customerLogoCell, quote.customerLogo, c.customerLogoExt);
  }

  // Items
  const itemsCfg = cfg.items;

  // Normalize item-row styling from a reference clean row. Some sample templates
  // grouped sub-items via vertical merges; after unmerging, the formerly-merged
  // sub-cells lose their borders/font. Copy a known-good item row's per-column
  // style over the whole item range BEFORE any splice so every row matches.
  if (itemsCfg.styleRow) {
    const src = itemsCfg.styleRow;
    for (const colLetter of Object.values(itemsCfg.columns)) {
      const refStyle = ws.getCell(`${colLetter}${src}`).style;
      if (!refStyle) continue;
      const snap = JSON.parse(JSON.stringify(refStyle));
      for (let r = itemsCfg.firstRow; r <= itemsCfg.lastRow; r++) {
        if (r === src) continue;
        ws.getCell(`${colLetter}${r}`).style = JSON.parse(JSON.stringify(snap));
      }
    }
  }

  const skipRows = new Set(itemsCfg.skipRows || []);
  const templateRowCount = itemsCfg.lastRow - itemsCfg.firstRow + 1;
  // Available item slots = template rows EXCLUDING skipRows (e.g. section headers)
  const slotRows: number[] = [];
  for (let r = itemsCfg.firstRow; r <= itemsCfg.lastRow; r++) {
    if (!skipRows.has(r)) slotRows.push(r);
  }
  const slotCount = slotRows.length;
  const n = items.length;
  const originalLastItemRow = itemsCfg.lastRow;
  let actualLastRow = originalLastItemRow;

  if (itemsCfg.preserveStructure) {
    // STRUCTURE PRESERVATION MODE (for templates with section headers, Phí quản lý etc.)
    // Don't splice or duplicate. Fill items into available slot rows. Blank unused slots.
    // For n > slotCount, just truncate (or could add more, but TBD).
    // Totals stay at fixed positions (rowOffset from originalLastItemRow).
  } else if (n > slotCount) {
    // Add extra rows by duplicating the last item row
    const extraRows = n - slotCount;
    ws.duplicateRow(itemsCfg.lastRow, extraRows, true);
    // The new rows become additional slots
    for (let i = 1; i <= extraRows; i++) slotRows.push(itemsCfg.lastRow + i);
    actualLastRow = originalLastItemRow + extraRows;
  } else if (n < slotCount && n > 0) {
    // Remove (slotCount - n) unused rows from the END of the slot range
    unmergeTotals(ws, cfg, originalLastItemRow);
    const removeCount = slotCount - n;
    // Remove rows from the end of slotRows (excluding skipRows which stay)
    const rowsToRemove = slotRows.slice(-removeCount);
    // Sort descending so we splice from the bottom up
    for (const r of rowsToRemove.sort((a, b) => b - a)) {
      ws.spliceRows(r, 1);
      actualLastRow--;
      // Update slotRows that are below the removed row
      for (let i = 0; i < slotRows.length; i++) {
        if (slotRows[i] > r) slotRows[i]--;
      }
    }
    // Keep only the first n slots
    slotRows.length = n;
  } else if (n === 0) {
    // No items: clear all slot data, keep structure
    // Don't splice, just leave empty
  }

  const cols = itemsCfg.columns;

  // Row heights: use the configured uniform height; otherwise size each row to fit its
  // content so the tall sample heights baked into the template don't carry over (fixes
  // "hàng bị to" khi số mục ít hơn slot mẫu). TỰ CĂN CHỈNH theo chữ như Excel: ước lượng
  // số dòng SAU KHI XUỐNG HÀNG (wrap) theo ĐỘ RỘNG CỘT — không chỉ đếm \n — nên tên nhóm
  // / hạng mục dài (vd "Booth backdrop … (thay AW booth có sẵn)") không bị cắt mất chữ.
  const colWidthOf = (letter: any) => { try { const w = ws.getColumn(letter).width; return (w && w > 0) ? w : null; } catch { return null; } };
  const wrapLines = (text: any, letter: any) => {
    if (text == null || text === "") return 1;
    const cw = colWidthOf(letter) || 12;
    const perLine = Math.max(4, Math.floor(cw - 1));   // chừa 1 ký tự lề → ưu tiên cao hơn (thà cao còn hơn cắt chữ)
    let total = 0;
    for (const seg of String(text).split(/\r?\n/)) total += Math.max(1, Math.ceil((seg.length || 1) / perLine));
    return Math.max(1, total);
  };
  // Group structure for "hàng con" (mirror the editor): a "sub" extends the current
  // group only when the previous row was a head/sub, else it starts its own group.
  // Tính TRƯỚC vòng đo chiều cao để biết hàng nào là "sub" (ô tên bị gộp, không hiện).
  const effKind = items.map(() => "head");
  for (let i = 0; i < items.length; i++) {
    const k = items[i]?.kind;
    if (k === "info") effKind[i] = "info";
    else if (k === "section" || k === "subsection") effKind[i] = "section";
    else if (k === "sub" && i > 0 && (effKind[i - 1] === "head" || effKind[i - 1] === "sub")) effKind[i] = "sub";
    else effKind[i] = "head";
  }

  for (let hi = 0; hi < slotRows.length; hi++) {
    const r = slotRows[hi];
    if (itemsCfg.rowHeight) { ws.getRow(r).height = itemsCfg.rowHeight; continue; }
    const it = items[hi];
    let lines = 1;
    if (it) {
      // Hàng con (sub): ô STT + Hạng Mục gộp lên dòng cha → tên KHÔNG hiện ở dòng này, nên
      // không đo chiều cao theo tên (tránh hàng cao vô ích).
      const nameForHeight = effKind[hi] === "sub" ? null : it.name;
      for (const [t, letter] of [[nameForHeight, cols.name], [it.detail, cols.detail], [it.notes, cols.notes]]) {
        if (t && letter) lines = Math.max(lines, wrapLines(t, letter));
      }
    }
    // Chặn trên 409 pt (giới hạn chiều cao hàng của Excel) để file không out-of-spec.
    ws.getRow(r).height = Math.min(409, Math.max(18, lines * 15 + 3));
  }

  // Per-section subtotal = sum of item/sub amounts until the next section. Shown only
  // when sheet.groupSubtotal is on. Section rows are letter-coded (A,B,C…) and never
  // count toward the grand subtotal (their qty/price are 0).
  const showGroupSub = !!(sheet && sheet.groupSubtotal);
  const sectionSum: Record<number, number> = {};
  {
    let cur = -1;
    for (let i = 0; i < items.length; i++) {
      if (effKind[i] === "section") { cur = i; sectionSum[i] = 0; }
      else if ((effKind[i] === "head" || effKind[i] === "sub") && items[i] && cur >= 0) {
        const it = items[i];
        const qty = Number(it.quantity) || 0, days = Number(it.days) || 1, price = Number(it.unitPrice) || 0;
        sectionSum[cur] += Math.round(cols.days ? trunc2(qty) * days * price : trunc2(qty) * price);   // SL cắt 2 số, Thành Tiền làm tròn
      }
    }
  }

  // Công thức người dùng TỰ GÕ (it.formulas) → công thức Excel thật. Dựng bộ dịch theo
  // sheet (slotRows đã chốt). Ô số nào dịch được + tự kiểm khớp thì ghi công thức; không
  // thì ghi số như cũ (putNum bên dưới) — không bao giờ làm hỏng export.
  // Bản đồ ĐỐI TƯỢNG item (item/sub đã đặt chỗ) → hàng Excel: tra theo địa chỉ đối tượng
  // nên ref công thức dịch ĐÚNG bất kể CLF lọc dòng "info" làm lệch chỉ số mảng.
  const rowByItem = new Map();
  for (let j = 0; j < slotRows.length; j++) {
    const it2 = items[j];
    if (it2 && (it2.kind === "item" || it2.kind === "sub") && slotRows[j] != null) rowByItem.set(it2, slotRows[j]);
  }
  const fctx = buildFormulaContext({
    cols,
    items: editorItems,                                  // thứ tự editor (ref người dùng khớp)
    rowToExcel: (idx0: any) => rowByItem.has(editorItems[idx0]) ? rowByItem.get(editorItems[idx0]) : null,
  });
  // Ghi 1 ô số: ưu tiên công thức người dùng (kết quả = giá trị đã tính), fallback ghi số.
  const putNum = (it2: any, row: any, field: any, colX: any, value: any) => {
    if (!colX) return;
    const raw = it2 && it2.formulas && it2.formulas[field];
    const fx = raw ? fctx.cellFormula(raw, value) : null;
    if (fx) ws.getCell(`${colX}${row}`).value = { formula: fx, result: value };
    else setCell(ws, `${colX}${row}`, value);
  };

  let subtotal = 0;
  let itemNo = 0;
  let sectionIdx = -1;
  let mult = 1;
  // Bản BANNER (gn_banner): NHÓM CON đánh số 1,2,3 (reset mỗi nhóm chính), MỤC bên dưới KHÔNG đánh số.
  const numberSubs = !!itemsCfg.numberSubsections;
  let subNo = 0;
  // ===== Công thức SỐNG cho dòng NHÓM + subtotal =====
  // Mục tiêu: khách sửa Số Lượng/Đơn Giá 1 mục trong Excel → Đơn giá nhóm, Thành tiền nhóm,
  // Tổng Cộng, VAT, Thành Tiền TỰ tính lại (không còn ô tổng "chết"). Số `result` GIỮ NGUYÊN =
  // giá trị tính ở server → snapshot không đổi; chỉ THÊM công thức để Excel tự cập nhật khi sửa.
  // Hàng Excel [đầu, cuối] các MỤC (head/sub) thuộc nhóm tại index si (dừng ở nhóm/nhóm con kế).
  const childExcelRange = (si: number): [number, number] | null => {
    let first: number | null = null, last: number | null = null;
    for (let j = si + 1; j < items.length; j++) {
      if (effKind[j] === "section") break;                                  // nhóm/nhóm con kế
      if (effKind[j] !== "head" && effKind[j] !== "sub") continue;          // bỏ info/khác
      const rr = slotRows[j];
      if (rr == null) continue;
      if (first == null) first = rr; last = rr;
    }
    return first == null ? null : [first, last as number];
  };
  const groupAmtRows: number[] = [];   // hàng nhóm/nhóm con có Thành Tiền nhóm (khi bật ×SL)
  const looseAmtRows: number[] = [];   // hàng mục KHÔNG thuộc nhóm nào (trước nhóm đầu tiên)
  let seenSection = false;
  for (let i = 0; i < slotRows.length; i++) {
    const r = slotRows[i];
    const it = items[i];
    if (it && effKind[i] === "section") {
      // Section header. NHÓM CHÍNH (kind="section"): tự cấp chữ A/B/C. NHÓM CON
      // (kind="subsection"): TUYỆT ĐỐI KHÔNG có chữ A/B/C (cột STT để TRỐNG), KHÔNG thêm
      // ký tự "↳" nào vào tên — chỉ khác bằng NỀN nhạt hơn + thụt lề (căn lề, không ký tự),
      // khớp đúng yêu cầu "nhóm con không có chữ gì hết". Không làm lệch thứ tự A/B/C nhóm chính.
      const isSubSection = it.kind === "subsection";
      let letter;
      if (isSubSection) {
        // Mặc định nhóm con KHÔNG có chữ A/B/C. Bản BANNER: đánh số 1,2,3 (theo thứ tự nhóm con).
        letter = (it.label && String(it.label).trim()) || (numberSubs ? String(++subNo) : "");
      } else {
        sectionIdx++;
        letter = (it.label && String(it.label).trim()) || sectionLetter(sectionIdx);
        subNo = 0;   // số nhóm con reset theo từng nhóm chính
      }
      itemNo = 0; // item numbering restarts under each section
      if (cols.stt) setCell(ws, `${cols.stt}${r}`, letter || null);   // nhóm con: STT TRỐNG hẳn (không A/B/C)
      if (cols.name) {
        const nameCell = ws.getCell(`${cols.name}${r}`);
        setCell(ws, `${cols.name}${r}`, it.name || ""); ensureWrap(nameCell);
        if (isSubSection) nameCell.alignment = { ...(nameCell.alignment || {}), indent: 1 };   // thụt lề, KHÔNG dùng ký tự
      }
      if (cols.detail) ws.getCell(`${cols.detail}${r}`).value = null;
      if (cols.days) ws.getCell(`${cols.days}${r}`).value = null;
      if (cols.unit) setCell(ws, `${cols.unit}${r}`, clean(it.unit));
      if (cols.quantity) ws.getCell(`${cols.quantity}${r}`).value = (Number(it.quantity) || 0) || null;
      const gmult = showGroupSub ? Math.max(1, Number(it.quantity) || 1) : 1;   // ×SL chỉ khi bật "thành tiền nhóm"
      mult = gmult;
      seenSection = true;
      if (showGroupSub) groupAmtRows.push(r);
      // Đơn Giá nhóm = SUM Thành Tiền các mục con (CÔNG THỨC SỐNG). Thành Tiền nhóm = Đơn Giá nhóm ×
      // Số Lượng nhóm (sống, chỉ khi bật). Không có mục con → ghi số như cũ (an toàn).
      const childRng = childExcelRange(i);
      if (cols.unitPrice) {
        if (childRng && sectionSum[i]) ws.getCell(`${cols.unitPrice}${r}`).value = { formula: `SUM(${cols.amount}${childRng[0]}:${cols.amount}${childRng[1]})`, result: sectionSum[i] };
        else ws.getCell(`${cols.unitPrice}${r}`).value = sectionSum[i] || null;
      }
      if (cols.amount) {
        if (showGroupSub && childRng && sectionSum[i]) {
          const fAmt = gmult > 1 ? `${cols.unitPrice}${r}*${cols.quantity}${r}` : `${cols.unitPrice}${r}`;   // ×SL khi SL>1; SL≤1 → = đơn giá nhóm
          ws.getCell(`${cols.amount}${r}`).value = { formula: fAmt, result: sectionSum[i] * gmult };
        } else {
          ws.getCell(`${cols.amount}${r}`).value = showGroupSub ? ((sectionSum[i] * gmult) || null) : null;
        }
      }
      if (cols.notes) setCell(ws, `${cols.notes}${r}`, it.notes || null);
      for (const col of Object.values(cols)) {
        // Nhóm con: ô STT + Ghi Chú để TRẮNG (không tô nền) — chỉ tô dải giữa. Bản BANNER có
        // đánh SỐ vào ô STT nên ô STT ĐƯỢC tô nền (số nằm trên dải), chỉ Ghi Chú để trắng.
        const bareSubCell = isSubSection && (col === cols.notes || (col === cols.stt && !numberSubs));
        paintCell(ws.getCell(`${col}${r}`), {
          // Nhóm chính A/B/C: nền KEM + chữ nâu. Nhóm con: nền XANH + chữ xanh. Khớp web,
          // theo yêu cầu khách (hoán đổi so với trước). STT/Ghi Chú của nhóm con để trắng.
          fill: bareSubCell ? "none" : (isSubSection ? "FFEAF1FB" : "FFFCEFDB"),
          bold: true,
          fontColor: isSubSection ? "FF1F4E79" : "FF9A5B14",
        });
      }
    } else if (it && effKind[i] === "info") {
      // Program-info line: free text in the Hạng Mục cell, no STT / qty / price / amount.
      if (cols.stt) ws.getCell(`${cols.stt}${r}`).value = null;
      if (cols.name) { setCell(ws, `${cols.name}${r}`, it.name || ""); ensureWrap(ws.getCell(`${cols.name}${r}`)); }
      for (const key of ["detail", "unit", "quantity", "days", "unitPrice", "amount"]) {
        if (cols[key]) ws.getCell(`${cols[key]}${r}`).value = null;
      }
      if (cols.notes) { setCell(ws, `${cols.notes}${r}`, it.notes || ""); ensureWrap(ws.getCell(`${cols.notes}${r}`)); }
      if (cols.name) {
        const nameCell = ws.getCell(`${cols.name}${r}`);
        nameCell.font = { ...(nameCell.font || {}), italic: true };
      }
    } else if (it) {
      const isSub = effKind[i] === "sub";
      if (!seenSection) looseAmtRows.push(r);   // mục lẻ (trước nhóm đầu) → cộng riêng vào subtotal
      const qty = Number(it.quantity) || 0;
      const days = Number(it.days) || 1;
      const price = Number(it.unitPrice) || 0;
      let amt;
      if (cols.days) {
        amt = price * trunc2(qty) * days;   // Số Lượng CẮT 2 số trước khi × giá
        putNum(it, r, "days", cols.days, days);
      } else {
        amt = price * trunc2(qty);
      }
      amt = Math.round(amt);   // Thành Tiền làm tròn về số nguyên (khớp web + dòng cộng = tổng)
      subtotal += amt * mult;
      // STT + Hạng Mục: only the group head writes them; sub-rows leave them blank,
      // then get covered by the vertical merge applied after this loop.
      if (isSub) {
        if (cols.stt) ws.getCell(`${cols.stt}${r}`).value = null;
        if (cols.name) ws.getCell(`${cols.name}${r}`).value = null;
      } else {
        // Bản BANNER: MỤC dưới nhóm con KHÔNG đánh số (số dồn cho nhóm con). Mặc định: đánh 1,2,3.
        if (numberSubs) { if (cols.stt) ws.getCell(`${cols.stt}${r}`).value = null; }
        else { itemNo++; if (cols.stt) setCell(ws, `${cols.stt}${r}`, itemNo); }
        // Multi-line text fields: keep newlines and enable wrapText
        if (cols.name) {
          setCell(ws, `${cols.name}${r}`, it.name || "");
          ensureWrap(ws.getCell(`${cols.name}${r}`));
        }
      }
      if (cols.detail) {
        setCell(ws, `${cols.detail}${r}`, it.detail || "");
        ensureWrap(ws.getCell(`${cols.detail}${r}`));
      }
      if (cols.unit) setCell(ws, `${cols.unit}${r}`, clean(it.unit));
      // Số Lượng: CẮT còn 2 số (TRUNC) — vẫn GIỮ công thức người dùng (bọc TRUNC) để khách thấy;
      // số khớp Thành Tiền (=ROUND(SL×ĐG)). Số chẵn → không lẻ ("0"); có lẻ → đúng 2 số ("0.00").
      if (cols.quantity) {
        const qT = trunc2(qty);
        const rawQ = it.formulas && it.formulas.quantity;
        const fxQ = rawQ ? fctx.cellFormula(rawQ, qty) : null;
        const qCell = ws.getCell(`${cols.quantity}${r}`);
        if (fxQ) qCell.value = { formula: `TRUNC(${fxQ},2)`, result: qT };
        else qCell.value = qT;
        // Định dạng hiển thị: số chẵn → "0" (không lẻ); có lẻ → "0.00" (đúng 2 số). PHẢI gán qua
        // bản sao style (giống paintCell) — gán cell.numFmt trực tiếp KHÔNG "ăn" trên hàng được
        // duplicateRow nhân bản (style dùng chung) → trước đây 7,70 in ra 8 ở các dòng phía sau.
        const qSt = qCell.style ? JSON.parse(JSON.stringify(qCell.style)) : {};
        qSt.numFmt = Number.isInteger(qT) ? "0" : "0.00";
        qCell.style = qSt;
      }
      putNum(it, r, "unitPrice", cols.unitPrice, price);
      if (cols.amount) {
        ws.getCell(`${cols.amount}${r}`).value = {
          formula: `ROUND(${itemsCfg.amountFormula(r)},0)`,   // Thành Tiền = làm tròn(SL×ĐG) số nguyên
          result: amt,
        };
      }
      if (cols.notes) {
        setCell(ws, `${cols.notes}${r}`, it.notes || "");
        ensureWrap(ws.getCell(`${cols.notes}${r}`));
      }
      // Apply italic style to specific columns (config: itemsCfg.italicColumns)
      if (itemsCfg.italicColumns) {
        for (const col of itemsCfg.italicColumns) {
          const cell = ws.getCell(`${col}${r}`);
          const f = cell.font ? { ...cell.font } : {};
          f.italic = true;
          cell.font = f;
        }
      }
    } else {
      // Blank slot
      for (const col of Object.values(cols)) {
        ws.getCell(`${col}${r}`).value = null;
      }
    }
  }

  // Vertical merges for "hàng con" groups: STT + Hạng Mục span each head + its subs,
  // reproducing the CLF template's grouped look. Done after the fill loop so slotRows
  // hold final positions. Skipped if the surviving rows aren't contiguous.
  for (let i = 0; i < items.length; i++) {
    if (effKind[i] !== "head") continue;
    let span = 1;
    while (i + span < items.length && effKind[i + span] === "sub") span++;
    if (span <= 1) continue;
    const r1 = slotRows[i], r2 = slotRows[i + span - 1];
    if (r1 == null || r2 == null || r2 - r1 !== span - 1) continue;
    for (const col of [cols.stt, cols.name]) {
      if (!col) continue;
      safeMerge(ws, `${col}${r1}:${col}${r2}`);
      const cell = ws.getCell(`${col}${r1}`);
      cell.alignment = { ...(cell.alignment || {}), vertical: "middle" };
    }
  }

  // Totals — positions based on actual last row (changes only when we splice/duplicate)
  const t = cfg.totals;
  const subtotalRow = actualLastRow + t.subtotal.rowOffset;
  const vatRow = actualLastRow + t.vat.rowOffset;

  // When sections are present, a simple SUM(column) double-counts (mục con per-unit +
  // thành tiền nhóm), so write the computed value instead of a SUM formula.
  const hasSections = items.some((it: any) => it && (it.kind === "section" || it.kind === "subsection"));
  // Subtotal SỐNG: KHÔNG nhóm (hoặc có nhóm nhưng tắt ×SL → dòng nhóm trống) → SUM cột Thành Tiền;
  // có nhóm + bật ×SL → cộng các dòng NHÓM (đã ×SL) + mục lẻ, tránh double-count với mục con.
  let subtotalFormula: any = null;
  if (!hasSections || !showGroupSub) {
    subtotalFormula = t.subtotal.formula({ first: itemsCfg.firstRow, last: actualLastRow, subtotalRow });
  } else {
    const rows = [...groupAmtRows, ...looseAmtRows].sort((a, b) => a - b);
    if (rows.length) subtotalFormula = rows.map((rr) => `${cols.amount}${rr}`).join("+");
  }
  applyTotalsRow(ws, t.subtotal, subtotalRow, {
    text: t.subtotal.labelText ? t.subtotal.labelText(vatPct) : null,
    formula: subtotalFormula,
    result: subtotal,
    rawValue: subtotalFormula == null ? subtotal : null,
  });
  // VAT làm tròn số nguyên (khớp tổng đã chốt ở server) — bọc ROUND để Excel cũng tính ra số nguyên.
  const vatAmt = Math.round(subtotal * vatPct / 100);
  applyTotalsRow(ws, t.vat, vatRow, {
    text: t.vat.labelText(vatPct),
    formula: `ROUND(${t.vat.formula({ subtotalRow, vatPct })},0)`,
    result: vatAmt,
  });

  // Optional "Giảm Giá" row. Only rendered on a sheet when this is the sole sheet
  // (the quote-level discount belongs on the grand total; multi-sheet exports show
  // it on the summary sheet instead). Inserting it pushes the total + footer down 1.
  const discount = Number(quote.discount) || 0;
  const onlySheet = (quote.sheets || []).length === 1;
  let discountRow = null;
  let extraTotalsRows = 0;
  if (discount > 0 && onlySheet && t.discount) {
    discountRow = vatRow + 1;
    ws.duplicateRow(vatRow, 1, true);   // clone VAT row's styling for the new Giảm Giá row
    extraTotalsRows = 1;
    applyTotalsRow(ws, t.discount, discountRow, {
      text: t.discount.labelText ? t.discount.labelText(vatPct) : "Giảm Giá",
      rawValue: discount,
    });
  }

  const totalRow = actualLastRow + t.total.rowOffset + extraTotalsRows;
  applyTotalsRow(ws, t.total, totalRow, {
    text: t.total.labelText(vatPct),
    formula: t.total.formula({ subtotalRow, vatRow, discountRow }),
    result: subtotal + vatAmt - (discountRow ? discount : 0),   // = Cộng + VAT(đã tròn) − Giảm Giá
  });

  // Footer merges (e.g. CLF "* Ghi chú" at C:D) ride the item splice/duplicate by
  // `shift` rows. ExcelJS spliceRows drops these merges, leaving the text duplicated
  // across both columns — recompute the shifted row, clear the secondary cells, re-merge.
  if (cfg.footerMerges) {
    const shift = (actualLastRow - originalLastItemRow) + extraTotalsRows;
    for (const range of cfg.footerMerges) {
      const m = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(range);
      if (!m) continue;
      const newRow = parseInt(m[2], 10) + shift;
      const startCol = m[1].charCodeAt(0), endCol = m[3].charCodeAt(0);
      safeUnmerge(ws, `${m[1]}${newRow}:${m[3]}${newRow}`);
      for (let cc = startCol + 1; cc <= endCol; cc++) {
        try { ws.getCell(`${String.fromCharCode(cc)}${newRow}`).value = null; } catch {}
      }
      safeMerge(ws, `${m[1]}${newRow}:${m[3]}${newRow}`);
    }
  }

  // === Áp bảng màu mới + Ghi chú (chỉ template khai báo cfg.palette, vd GN) ===
  // GN_KhongNgay.xlsx mặc định header/tổng màu nâu đậm (chữ trắng) + nhóm xanh dương —
  // đè lại cho khớp mẫu: header/tổng peach, nhóm xanh lá, STT/Hạng Mục xanh dương, số
  // tiền tổng đen đậm, và in "Ghi chú" (quote.notes) vào ô cạnh phần tổng.
  if (pal) {
    const colVals = Object.values(cols);
    const valueCol = t.total.valueCell;

    // (a) Hàng tiêu đề cột → nền peach + chữ đen đậm (thay nền nâu/chữ trắng của mẫu).
    if (pal.headerFill && pal.headerRows) {
      for (const hr of pal.headerRows) {
        for (const col of colVals) {
          paintCell(ws.getCell(`${col}${hr}`), { fill: pal.headerFill, fontColor: "FF000000", bold: true });
        }
      }
    }

    // (b) STT + Hạng Mục của các hàng item (đầu nhóm) → chữ xanh dương đậm.
    if (pal.nameColor) {
      for (let i = 0; i < slotRows.length; i++) {
        if (!items[i] || effKind[i] !== "head") continue;
        for (const col of [cols.stt, cols.name]) {
          if (!col) continue;
          paintCell(ws.getCell(`${col}${slotRows[i]}`), { fontColor: pal.nameColor, bold: true });
        }
      }
    }

    // (c) 3 dòng tổng (Cộng/VAT/Thành Tiền + Giảm Giá nếu có) → nền peach, chữ đen đậm.
    if (pal.totalsFill || pal.totalsValueColor) {
      const totalRows = [subtotalRow, vatRow, totalRow];
      if (discountRow) totalRows.push(discountRow);
      // chỉ tô các cột thuộc khối tổng (nhãn + giá trị) để không đè ô Ghi chú bên trái
      const tCols = new Set();
      for (const grp of [t.subtotal, t.vat, t.total]) {
        for (const [a, b] of (grp.labelCells || [])) {
          for (let cc = a.charCodeAt(0); cc <= b.charCodeAt(0); cc++) tCols.add(String.fromCharCode(cc));
        }
        if (grp.valueCell) tCols.add(grp.valueCell);
      }
      for (const tr of totalRows) {
        if (pal.totalsFill) {
          for (const col of tCols) {
            paintCell(ws.getCell(`${col}${tr}`), { fill: pal.totalsFill, fontColor: "FF000000", bold: true });
          }
        }
        if (pal.totalsValueColor) {
          paintCell(ws.getCell(`${valueCol}${tr}`), { fontColor: pal.totalsValueColor, bold: true });
        }
      }
    }

    // (d) Ghi chú: in quote.notes thành 1 dòng dưới phần tổng (merge ngang colFrom→colTo).
    //     Có ghi chú → "Ghi chú: <nội dung>" (nâu đỏ); không có → để trống.
    if (pal.note) {
      const nr = totalRow + (pal.note.rowOffset || 1);
      const c1 = `${pal.note.colFrom}${nr}`, c2 = `${pal.note.colTo}${nr}`;
      // KHÔNG merge: ExcelJS reset ô richText-đã-merge về canh giữa khi lưu. Để chữ tràn
      // trái tự nhiên (các ô C..I dòng này trống) → "Ghi chú:" canh trái đúng như mẫu.
      safeUnmerge(ws, `${c1}:${c2}`);
      const ncell = ws.getCell(c1);
      const note = (quote.notes == null ? "" : String(quote.notes)).trim();
      if (note) {
        // Chuỗi THƯỜNG + font nền nâu đậm (KHÔNG richText). RichText bị Excel render ĐEN
        // cho tới khi click vào ô; gán màu vào FONT NỀN của ô thì hiện nâu ngay khi mở file.
        const st = ncell.style ? JSON.parse(JSON.stringify(ncell.style)) : {};
        st.font = { name: "Times New Roman", family: 1, size: 11, bold: true, color: { argb: pal.note.color || "FF843C0C" } };
        st.alignment = { vertical: "middle", horizontal: "left", wrapText: false };
        ncell.style = st;
        ncell.value = `Ghi chú: ${note}`;
        ws.getRow(nr).height = Math.max(ws.getRow(nr).height || 0, 20);
      } else {
        ncell.value = null;
      }
    }

    // (e) Cuối báo giá (cân đối kiểu GN gốc): lời chào canh TRÁI (cột B:F) + "Ý Kiến Khách
    //     Hàng" canh giữa cột PHẢI (G:I) CÙNG hàng → chừa chỗ ký + đóng dấu.
    if (pal.footer) {
      const f = pal.footer;
      const ff = { name: "Times New Roman", family: 1, size: 11 };
      // Ghi 1 dòng vào dải [from..to] (merge ngang). Gán font/căn-lề qua style TRƯỚC value
      // vì font/alignment đơn lẻ không "ăn" trên ô đã merge.
      const writeMerged = (r: any, value: any, { bold, from, to, align }: { bold?: any; from?: any; to?: any; align?: any } = {}) => {
        const a = `${from || "B"}${r}`, b = `${to || "I"}${r}`;
        safeUnmerge(ws, `${a}:${b}`); safeMerge(ws, `${a}:${b}`);
        const cell = ws.getCell(a);
        const st = cell.style ? JSON.parse(JSON.stringify(cell.style)) : {};
        st.font = { ...ff, bold: !!bold };
        st.alignment = { horizontal: align || "center", vertical: "middle" };
        cell.style = st;
        cell.value = value;
      };
      // Lời chào ("Rất mong…" / "Trân trọng…") canh GIỮA trong cột trái (B:F) → cân đối.
      if (f.left) {
        const lr = totalRow + (f.rowOffset || 2);
        (f.left.lines || []).forEach((line: any, idx: any) =>
          writeMerged(lr + idx, line, { from: f.left.from, to: f.left.to, align: "center" }));
      }
      // "Ý Kiến Khách Hàng" canh giữa cột PHẢI, CÙNG hàng dòng lời chào đầu
      if (f.customer) {
        writeMerged(totalRow + (f.customer.rowOffset || 2), f.customer.text,
          { from: f.customer.from, to: f.customer.to, align: "center" });
      }
      // Chừa khoảng trống ký + đóng dấu (tên người gửi chỉ in khi sign.showSender)
      const s = f.sign;
      if (s) {
        const gapStart = totalRow + (s.gapRowOffset || 4);
        for (let i = 0; i < (s.gapRows || 4); i++) ws.getRow(gapStart + i).height = s.gapRowHeight || 20;
        if (s.showSender) {
          const courtesy = s.courtesyCell ? clean(ws.getCell(s.courtesyCell).value) : "";
          const name = [courtesy, clean(quote.fromContact)].filter(Boolean).join(" ");
          let nr = gapStart + (s.gapRows || 4);
          if (name) writeMerged(nr++, name, { bold: true });
          if (clean(quote.fromTitle)) writeMerged(nr++, clean(quote.fromTitle));
          if (clean(quote.fromPhone)) writeMerged(nr, clean(quote.fromPhone));
        }
      }
    }
  }

  return {
    subtotal,
    vat: subtotal * vatPct / 100,
    total: subtotal * (1 + vatPct / 100),
  };
}

function applyTotalsRow(ws: any, rowCfg: any, row: any, { text, formula, result, rawValue }: { text?: any; formula?: any; result?: any; rawValue?: any }) {
  // Clear secondary cells in merge first (to avoid leftover duplicated values)
  for (const [colStart, colEnd] of (rowCfg.labelCells || [])) {
    if (colStart === colEnd) continue;
    // Clear cells from colStart+1 to colEnd
    const startCol = colStart.charCodeAt(0);
    const endCol = colEnd.charCodeAt(0);
    for (let c = startCol + 1; c <= endCol; c++) {
      try { ws.getCell(`${String.fromCharCode(c)}${row}`).value = null; } catch {}
    }
    safeMerge(ws, `${colStart}${row}:${colEnd}${row}`);
  }
  if (text != null && rowCfg.labelCells && rowCfg.labelCells.length) {
    const [colStart] = rowCfg.labelCells[0];
    ws.getCell(`${colStart}${row}`).value = text;
  }
  if (rowCfg.valueCell) {
    if (formula != null) ws.getCell(`${rowCfg.valueCell}${row}`).value = { formula, result };
    else if (rawValue != null) ws.getCell(`${rowCfg.valueCell}${row}`).value = rawValue;
  }
}

function uniqueSheetName(wb: any, name: any) {
  let base = (name || "Sheet").replace(/[[\]/\\?*:]/g, "").substring(0, 31);
  if (!base) base = "Sheet";
  let candidate = base;
  let i = 2;
  while (wb.getWorksheet(candidate)) {
    const suffix = ` (${i})`;
    candidate = base.substring(0, 31 - suffix.length) + suffix;
    i++;
  }
  return candidate;
}

function colLetter(n: number) {
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function deepClone(o: any) {
  if (o == null) return o;
  return JSON.parse(JSON.stringify(o));
}

/**
 * Copy a font object including ALL ExcelJS-supported properties.
 * Plain JSON clone misses properties exposed only via getters; this enumerates
 * the well-known keys so attributes like `family` and `scheme` survive cross-workbook copy.
 */
function cloneFont(srcFont: any) {
  if (!srcFont) return undefined;
  const keys = [
    "name", "size", "bold", "italic", "underline", "strike",
    "color", "family", "scheme", "charset", "vertAlign", "outline", "shadow"
  ];
  const out: Record<string, any> = {};
  for (const k of keys) {
    if (srcFont[k] !== undefined) {
      out[k] = (k === "color" && srcFont.color) ? { ...srcFont.color } : srcFont[k];
    }
  }
  // Default family=1 (roman/serif) when missing, so Excel doesn't substitute a fallback font
  // that loses Vietnamese diacritic glyphs.
  if (out.name && out.family === undefined) out.family = 1;
  return out;
}

function copyWorksheetToWorkbook(srcWs: any, dstWb: any, newName: any) {
  const dstWs = dstWb.addWorksheet(newName);

  // Column widths + styles
  const srcCols = srcWs.columns || [];
  for (let i = 0; i < srcCols.length; i++) {
    const sc = srcCols[i];
    if (!sc) continue;
    const dc = dstWs.getColumn(i + 1);
    if (sc.width != null) dc.width = sc.width;
    if (sc.hidden) dc.hidden = true;
  }

  // Rows + cells
  srcWs.eachRow({ includeEmpty: true }, (srcRow: any, rowNum: any) => {
    const dstRow = dstWs.getRow(rowNum);
    if (srcRow.height) dstRow.height = srcRow.height;
    if (srcRow.hidden) dstRow.hidden = true;
    srcRow.eachCell({ includeEmpty: true }, (srcCell: any, colNum: any) => {
      const dstCell = dstRow.getCell(colNum);
      // VALUE: preserve formulas + plain values + rich text
      if (srcCell.value != null) {
        if (typeof srcCell.value === "object" && srcCell.value.formula) {
          dstCell.value = { formula: srcCell.value.formula, result: srcCell.value.result };
        } else {
          dstCell.value = srcCell.value;
        }
      }
      // STYLE: set each property explicitly (style.* doesn't carry cross-workbook reliably).
      // Use cloneFont to preserve `family` attribute — required for Vietnamese diacritics to render.
      if (srcCell.font) dstCell.font = cloneFont(srcCell.font);
      if (srcCell.alignment) dstCell.alignment = deepClone(srcCell.alignment);
      if (srcCell.border) dstCell.border = deepClone(srcCell.border);
      if (srcCell.fill) dstCell.fill = deepClone(srcCell.fill);
      if (srcCell.numFmt) dstCell.numFmt = srcCell.numFmt;
      if (srcCell.protection) dstCell.protection = deepClone(srcCell.protection);
    });
  });

  // Merged cells
  const merges = srcWs._merges || {};
  for (const key of Object.keys(merges)) {
    const m = merges[key];
    if (!m) continue;
    const top = m.top ?? m.model?.top;
    const left = m.left ?? m.model?.left;
    const bottom = m.bottom ?? m.model?.bottom;
    const right = m.right ?? m.model?.right;
    if (top == null) continue;
    try {
      dstWs.mergeCells(`${colLetter(left)}${top}:${colLetter(right)}${bottom}`);
    } catch {}
  }

  // Images — workbook.media is indexed by imageId
  const images = srcWs.getImages ? srcWs.getImages() : [];
  for (const img of images) {
    const media = srcWs.workbook.media?.[img.imageId];
    if (!media || !media.buffer) continue;
    const imageId = dstWb.addImage({
      buffer: media.buffer,
      extension: media.extension || "png",
    });
    dstWs.addImage(imageId, img.range);
  }

  // Sheet view properties (page setup, default row height)
  if (srcWs.properties) {
    Object.assign(dstWs.properties, deepClone(srcWs.properties));
  }
  if (srcWs.pageSetup) {
    Object.assign(dstWs.pageSetup, deepClone(srcWs.pageSetup));
  }

  return dstWs;
}

async function buildSummaryBuffer(sheetTotals: any, quote: any, vatPct: any) {
  const wb = new ExcelJS.Workbook();
  addSummarySheet(wb, sheetTotals, quote, vatPct);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function addSummarySheet(wb: any, sheetTotals: any, quote: any, vatPct: any) {
  const ws = wb.addWorksheet("Tổng Báo Giá");
  ws.columns = [
    { width: 6 },
    { width: 45 },
    { width: 22 },
  ];

  ws.mergeCells("A1:C1");
  ws.getCell("A1").value = `TỔNG BÁO GIÁ ${quote.quoteNumber || ""}`;
  ws.getCell("A1").font = { name: "Times New Roman", family: 1, size: 14, bold: true };
  ws.getCell("A1").alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(1).height = 26;

  ws.mergeCells("A2:C2");
  ws.getCell("A2").value = neutralizeFormula(quote.title || "");
  ws.getCell("A2").font = { name: "Times New Roman", family: 1, size: 11, italic: true };
  ws.getCell("A2").alignment = { horizontal: "center", vertical: "middle" };

  const headerRow = 4;
  const headers = ["STT", "Hạng mục", "Thành tiền (VNĐ)"];
  headers.forEach((h: any, i: any) => {
    const cell = ws.getCell(headerRow, i + 1);
    cell.value = h;
    cell.font = { name: "Times New Roman", family: 1, size: 11, bold: true };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFCC99" } };
    cell.border = {
      top: { style: "medium" }, bottom: { style: "thin" },
      left: { style: i === 0 ? "medium" : "thin" },
      right: { style: i === headers.length - 1 ? "medium" : "thin" },
    };
  });

  let subtotalAll = 0;
  sheetTotals.forEach((st: any, idx: any) => {
    const r = headerRow + 1 + idx;
    ws.getCell(r, 1).value = idx + 1;
    ws.getCell(r, 2).value = neutralizeFormula(st.name);
    ws.getCell(r, 3).value = st.subtotal;
    ws.getCell(r, 3).numFmt = "#,##0";
    for (let c = 1; c <= 3; c++) {
      const cell = ws.getCell(r, c);
      cell.font = { name: "Times New Roman", family: 1, size: 11 };
      cell.alignment = { horizontal: c === 1 ? "center" : c === 3 ? "right" : "left", vertical: "middle" };
      cell.border = {
        top: { style: "thin" }, bottom: { style: "thin" },
        left: { style: c === 1 ? "medium" : "thin" },
        right: { style: c === 3 ? "medium" : "thin" },
      };
    }
    subtotalAll += st.subtotal;
  });

  const totalsStart = headerRow + 1 + sheetTotals.length;
  // LUÔN tính "Tổng cộng" từ tổng các sheet ĐANG hiển thị (subtotalAll = Σ subtotal từng sheet,
  // đều đã cắt Số Lượng + làm tròn Thành Tiền) → khớp ĐÚNG tổng các dòng sheet ngay phía trên,
  // tự nhất quán. money.js cũng cắt + làm tròn nên với báo giá đã lưu mới, số này == tổng đã lưu;
  // báo giá CŨ (lưu theo Số Lượng chưa cắt) cũng không còn lệch dòng-vs-tổng trong file Excel.
  const discountVal = Number(quote.discount) || 0;
  const subtotalVal = subtotalAll;
  const vatVal = Math.round(subtotalVal * vatPct / 100);
  const grandTotal = subtotalVal + vatVal - discountVal;
  const totalRows = [
    { label: "Tổng cộng", value: subtotalVal },
    { label: `VAT (${vatPct}%)`, value: vatVal },
  ];
  if (discountVal > 0) totalRows.push({ label: "Giảm giá", value: discountVal });
  totalRows.push({ label: "Thành tiền", value: grandTotal });
  totalRows.forEach((tr, i: any) => {
    const r = totalsStart + i;
    ws.mergeCells(r, 1, r, 2);
    const lblCell = ws.getCell(r, 1);
    lblCell.value = tr.label;
    lblCell.font = { name: "Times New Roman", family: 1, size: 11, bold: true };
    lblCell.alignment = { horizontal: "center", vertical: "middle" };
    lblCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFCC99" } };
    lblCell.border = {
      top: { style: "thin" },
      bottom: { style: i === totalRows.length - 1 ? "medium" : "thin" },
      left: { style: "medium" }, right: { style: "thin" },
    };
    const valCell = ws.getCell(r, 3);
    valCell.value = tr.value;
    valCell.numFmt = "#,##0";
    valCell.font = { name: "Times New Roman", family: 1, size: 11, bold: true, color: { argb: "FFC00000" } };
    valCell.alignment = { horizontal: "right", vertical: "middle" };
    valCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFCC99" } };
    valCell.border = {
      top: { style: "thin" },
      bottom: { style: i === totalRows.length - 1 ? "medium" : "thin" },
      left: { style: "thin" }, right: { style: "medium" },
    };
  });
}

/**
 * Strip workbook-level "junk" that causes Excel to flag the file as needing repair:
 *  - External `definedNames` referencing other workbook files (`[3]DATA`, etc.)
 *  - Leftover external link references in `_workbook.definedNames`
 *  - Stale calculation chain etc.
 */
function scrubWorkbook(wb: any) {
  // ExcelJS stores defined names in NameManager. Its `.model` getter/setter accepts an
  // array of {name, ranges}. We filter out any name whose ranges include external-file
  // markers like '[4]DATA'!$I$12:$I$318 — those are leftover references from the original
  // .xls source that point to workbooks we don't have, causing Excel to mark the file
  // as needing repair on open.
  try {
    const dn = wb.definedNames;
    if (dn) {
      const model = Array.isArray(dn.model) ? dn.model : [];
      const cleaned = model.filter((d: any) => {
        const ranges = d?.ranges || [];
        return !ranges.some((r: any) => typeof r === "string" && /\[\d+\]/.test(r));
      });
      if (cleaned.length !== model.length) {
        dn.model = cleaned;
      }
    }
  } catch {}
  // Note: don't delete wb.calcProperties — ExcelJS xlsx writer reads it (fullCalcOnLoad)
}

/**
 * Renumber worksheet sheetIds sequentially (1..N) to match their position order.
 * Excel flags out-of-order sheetIds (e.g. 69, 1, 2 after cross-workbook copy) as needing repair.
 */
function renumberSheetIds(wb: any) {
  wb.worksheets.forEach((ws: any, i: any) => {
    try { ws.id = i + 1; } catch {}
  });
}

/**
 * Build each sheet as a complete standalone xlsx buffer, then stitch them together
 * at the OOXML/zip level. This preserves each template's original styling perfectly,
 * which cell-by-cell cross-workbook copying in ExcelJS does not.
 */
export async function buildQuoteBuffer(quote: any) {
  const sheets = (quote.sheets || []).slice().sort((a: any, b: any) => (a.order || 0) - (b.order || 0));
  if (sheets.length === 0) {
    throw new Error("Báo giá phải có ít nhất 1 sheet");
  }
  const vatPct = Number(quote.vatPercent) || 0;

  const sheetBuffers: Buffer[] = [];
  const sheetNames: string[] = [];
  const sheetTotals: { name: string; subtotal: number; vat: number; total: number }[] = [];
  const usedNames = new Set();
  const uniq = (name: any) => {
    let n = name, i = 2;
    while (usedNames.has(n)) n = `${name} (${i++})`;
    usedNames.add(n);
    return n;
  };

  for (let idx = 0; idx < sheets.length; idx++) {
    const sheet = sheets[idx];
    const tplCode = sheet.template?.code || sheet.templateCode;
    if (!tplCode) throw new Error(`Sheet thứ ${idx + 1} chưa có template`);
    const cfg = getConfig(tplCode);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(templateBuffer(cfg.filePath));   // cached bytes, no disk IO
    scrubWorkbook(wb);
    const ws = wb.getWorksheet(cfg.sheetName) || wb.worksheets[0];

    // Tiêu đề từng sheet nối tên sheet ("… - Banner") — áp dụng CẢ khi chỉ 1 sheet.
    const totals = fillSheetData(ws, cfg, quote, sheet, vatPct, (sheet.name || "").trim());

    // Tên tab Excel: chỉ đánh số "N. …" khi báo giá có NHIỀU sheet (1 sheet giữ nguyên).
    const baseName = sheet.name || cfg.sheetName || `Sheet ${idx + 1}`;
    const labeled = sheets.length > 1 ? `${idx + 1}. ${baseName}`.replace(/[[\]/\\?*:]/g, "").substring(0, 31) : baseName;
    const displayName = uniq(labeled);
    ws.name = displayName;

    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    sheetBuffers.push(buf);
    sheetNames.push(displayName);
    sheetTotals.push({ name: displayName, ...totals });
  }

  // Cross-sheet summary worksheet — only when the quote opts to show totals.
  if (quote.showTotals !== false) {
    const summaryName = uniq("Tổng Báo Giá");
    const summaryBuf = await buildSummaryBuffer(sheetTotals, quote, vatPct);
    sheetBuffers.push(summaryBuf);
    sheetNames.push(summaryName);
  }

  // Stitch all into one xlsx
  return stitchXlsxBuffers(sheetBuffers, sheetNames);
}

// Backwards-compatible name: callers that previously got a Workbook now get a buffer.
// Update the export route to consume a buffer.
export const buildQuoteWorkbook = buildQuoteBuffer;
