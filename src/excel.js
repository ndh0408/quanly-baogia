import ExcelJS from "exceljs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getConfig } from "./templateConfigs.js";
import { stitchXlsxBuffers } from "./xlsxStitcher.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

function vnDateText(d, city) {
  const dt = d instanceof Date ? d : new Date(d);
  return `${city || "TP. Hồ Chí Minh"}, ngày ${String(dt.getDate()).padStart(2, "0")} tháng ${String(dt.getMonth() + 1).padStart(2, "0")} năm ${dt.getFullYear()}`;
}

function setCell(ws, ref, value) {
  if (!ref) return;
  ws.getCell(ref).value = value;
}

function safeMerge(ws, range) {
  try { ws.mergeCells(range); } catch {}
}

function safeUnmerge(ws, range) {
  try { ws.unMergeCells(range); } catch {}
}

/** Ensure a cell has wrapText alignment so multi-line content displays correctly */
function ensureWrap(cell) {
  const align = cell.alignment ? { ...cell.alignment } : {};
  align.wrapText = true;
  if (!align.vertical) align.vertical = "middle";
  cell.alignment = align;
}

/** Strip leading/trailing whitespace AND collapse internal newlines to spaces. */
function clean(s) {
  if (s == null) return "";
  return String(s).replace(/[\r\n]+/g, " ").trim();
}

/** Parse "C3" → 0-based {col,row} anchor used by ExcelJS addImage. */
function cellAnchor(ref) {
  const m = /^([A-Z]+)(\d+)$/i.exec(ref || "");
  if (!m) return { col: 0, row: 0 };
  let col = 0;
  for (const ch of m[1].toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { col: col - 1, row: Number(m[2]) - 1 };
}

/** Insert a base64 data-URL image floating over the given cell; clears the cell text. */
function insertCustomerLogo(ws, ref, dataUrl, ext) {
  const m = /^data:image\/(png|jpe?g|gif);base64,(.+)$/i.exec(dataUrl);
  if (!m) return;
  let extension = m[1].toLowerCase();
  if (extension === "jpg") extension = "jpeg";
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

function applyTemplateCleanup(ws, cfg) {
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
    ws._media = ws._media.filter(m => {
      const top = m.range?.tl?.nativeRow ?? 99;
      return top < keep;
    });
  }

  // Remove specific rows entirely (do this LAST, in reverse order to keep indices valid)
  // ExcelJS spliceRows has a batch-count bug — splice 1 row at a time.
  const toRemove = (cleanup.removeRows || []).slice().sort((a, b) => b - a);
  for (const r of toRemove) {
    try { ws.spliceRows(r, 1); } catch {}
  }
}

function unmergeTotals(ws, cfg, lastItemRow) {
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

/** Fill data for one sheet using its template config. Returns totals. */
function fillSheetData(ws, cfg, quote, sheet, vatPct) {
  applyTemplateCleanup(ws, cfg);

  const c = cfg.cells;
  const items = (sheet.items || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));

  if (c.toCompany) setCell(ws, c.toCompany, clean(quote.toCompany));
  if (c.toContact) setCell(ws, c.toContact, clean(quote.toContact));
  // Combined recipient block (e.g. CLF "Kính gửi: Cty X  Mr/Ms Y  Email: Z")
  if (c.toBlockCell) {
    const txt = c.toBlockFormat
      ? c.toBlockFormat({ company: quote.toCompany, contact: quote.toContact })
      : (quote.toCompany || "");
    setCell(ws, c.toBlockCell, clean(txt));
  }
  if (c.fromContactCell) {
    const txt = c.fromContactFormat
      ? c.fromContactFormat({ contact: quote.fromContact, title: quote.fromTitle, phone: quote.fromPhone })
      : (quote.fromContact || "");
    setCell(ws, c.fromContactCell, clean(txt));
  }
  if (c.fromPhone) setCell(ws, c.fromPhone, clean(quote.fromPhone));
  if (c.fromAddress) setCell(ws, c.fromAddress, clean(quote.fromAddress));
  if (c.date) setCell(ws, c.date, vnDateText(quote.quoteDate, quote.city));
  if (c.title) {
    const title = c.titleFormat ? c.titleFormat(quote.title) : (quote.title || "");
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
  const slotRows = [];
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

  // Apply uniform row height for all item rows if configured
  if (itemsCfg.rowHeight) {
    for (const r of slotRows) {
      ws.getRow(r).height = itemsCfg.rowHeight;
    }
  }

  let subtotal = 0;
  for (let i = 0; i < slotRows.length; i++) {
    const r = slotRows[i];
    const it = items[i];
    if (it) {
      const qty = Number(it.quantity) || 0;
      const days = Number(it.days) || 1;
      const price = Number(it.unitPrice) || 0;
      let amt;
      if (cols.days) {
        amt = price * qty * days;
        setCell(ws, `${cols.days}${r}`, days);
      } else {
        amt = price * qty;
      }
      subtotal += amt;
      if (cols.stt) setCell(ws, `${cols.stt}${r}`, i + 1);
      // Multi-line text fields: keep newlines and enable wrapText
      if (cols.name) {
        setCell(ws, `${cols.name}${r}`, it.name || "");
        ensureWrap(ws.getCell(`${cols.name}${r}`));
      }
      if (cols.detail) {
        setCell(ws, `${cols.detail}${r}`, it.detail || "");
        ensureWrap(ws.getCell(`${cols.detail}${r}`));
      }
      if (cols.unit) setCell(ws, `${cols.unit}${r}`, clean(it.unit));
      if (cols.quantity) setCell(ws, `${cols.quantity}${r}`, qty);
      if (cols.unitPrice) setCell(ws, `${cols.unitPrice}${r}`, price);
      if (cols.amount) {
        ws.getCell(`${cols.amount}${r}`).value = {
          formula: itemsCfg.amountFormula(r),
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

  // Totals — positions based on actual last row (changes only when we splice/duplicate)
  const t = cfg.totals;
  const subtotalRow = actualLastRow + t.subtotal.rowOffset;
  const vatRow = actualLastRow + t.vat.rowOffset;
  const totalRow = actualLastRow + t.total.rowOffset;

  applyTotalsRow(ws, t.subtotal, subtotalRow, {
    text: t.subtotal.labelText ? t.subtotal.labelText(vatPct) : null,
    formula: t.subtotal.formula({ first: itemsCfg.firstRow, last: actualLastRow, subtotalRow }),
    result: subtotal,
  });
  applyTotalsRow(ws, t.vat, vatRow, {
    text: t.vat.labelText(vatPct),
    formula: t.vat.formula({ subtotalRow, vatPct }),
    result: subtotal * vatPct / 100,
  });
  applyTotalsRow(ws, t.total, totalRow, {
    text: t.total.labelText(vatPct),
    formula: t.total.formula({ subtotalRow, vatRow }),
    result: subtotal * (1 + vatPct / 100),
  });

  return {
    subtotal,
    vat: subtotal * vatPct / 100,
    total: subtotal * (1 + vatPct / 100),
  };
}

function applyTotalsRow(ws, rowCfg, row, { text, formula, result }) {
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
    ws.getCell(`${rowCfg.valueCell}${row}`).value = { formula, result };
  }
}

function uniqueSheetName(wb, name) {
  let base = (name || "Sheet").replace(/[\[\]\/\\?*:]/g, "").substring(0, 31);
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

function colLetter(n) {
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function deepClone(o) {
  if (o == null) return o;
  return JSON.parse(JSON.stringify(o));
}

/**
 * Copy a font object including ALL ExcelJS-supported properties.
 * Plain JSON clone misses properties exposed only via getters; this enumerates
 * the well-known keys so attributes like `family` and `scheme` survive cross-workbook copy.
 */
function cloneFont(srcFont) {
  if (!srcFont) return undefined;
  const keys = [
    "name", "size", "bold", "italic", "underline", "strike",
    "color", "family", "scheme", "charset", "vertAlign", "outline", "shadow"
  ];
  const out = {};
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

function copyWorksheetToWorkbook(srcWs, dstWb, newName) {
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
  srcWs.eachRow({ includeEmpty: true }, (srcRow, rowNum) => {
    const dstRow = dstWs.getRow(rowNum);
    if (srcRow.height) dstRow.height = srcRow.height;
    if (srcRow.hidden) dstRow.hidden = true;
    srcRow.eachCell({ includeEmpty: true }, (srcCell, colNum) => {
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

async function buildSummaryBuffer(sheetTotals, quote, vatPct) {
  const wb = new ExcelJS.Workbook();
  addSummarySheet(wb, sheetTotals, quote, vatPct);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function addSummarySheet(wb, sheetTotals, quote, vatPct) {
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
  ws.getCell("A2").value = quote.title || "";
  ws.getCell("A2").font = { name: "Times New Roman", family: 1, size: 11, italic: true };
  ws.getCell("A2").alignment = { horizontal: "center", vertical: "middle" };

  const headerRow = 4;
  const headers = ["STT", "Hạng mục", "Thành tiền (VNĐ)"];
  headers.forEach((h, i) => {
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
  sheetTotals.forEach((st, idx) => {
    const r = headerRow + 1 + idx;
    ws.getCell(r, 1).value = idx + 1;
    ws.getCell(r, 2).value = st.name;
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
  const vatVal = Math.round(subtotalAll * vatPct) / 100;
  const totalRows = [
    { label: "Tổng cộng", value: subtotalAll },
    { label: `VAT (${vatPct}%)`, value: vatVal },
    { label: "Thành tiền", value: subtotalAll + vatVal },
  ];
  totalRows.forEach((tr, i) => {
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
function scrubWorkbook(wb) {
  // ExcelJS stores defined names in NameManager. Its `.model` getter/setter accepts an
  // array of {name, ranges}. We filter out any name whose ranges include external-file
  // markers like '[4]DATA'!$I$12:$I$318 — those are leftover references from the original
  // .xls source that point to workbooks we don't have, causing Excel to mark the file
  // as needing repair on open.
  try {
    const dn = wb.definedNames;
    if (dn) {
      const model = Array.isArray(dn.model) ? dn.model : [];
      const cleaned = model.filter(d => {
        const ranges = d?.ranges || [];
        return !ranges.some(r => typeof r === "string" && /\[\d+\]/.test(r));
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
function renumberSheetIds(wb) {
  wb.worksheets.forEach((ws, i) => {
    try { ws.id = i + 1; } catch {}
  });
}

/**
 * Build each sheet as a complete standalone xlsx buffer, then stitch them together
 * at the OOXML/zip level. This preserves each template's original styling perfectly,
 * which cell-by-cell cross-workbook copying in ExcelJS does not.
 */
export async function buildQuoteBuffer(quote) {
  const sheets = (quote.sheets || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
  if (sheets.length === 0) {
    throw new Error("Báo giá phải có ít nhất 1 sheet");
  }
  const vatPct = Number(quote.vatPercent) || 0;

  const sheetBuffers = [];
  const sheetNames = [];
  const sheetTotals = [];
  const usedNames = new Set();
  const uniq = (name) => {
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
    await wb.xlsx.readFile(path.join(ROOT, cfg.filePath));
    scrubWorkbook(wb);
    const ws = wb.getWorksheet(cfg.sheetName) || wb.worksheets[0];

    const totals = fillSheetData(ws, cfg, quote, sheet, vatPct);

    const displayName = uniq(sheet.name || cfg.sheetName || `Sheet ${idx + 1}`);
    ws.name = displayName;

    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    sheetBuffers.push(buf);
    sheetNames.push(displayName);
    sheetTotals.push({ name: displayName, ...totals });
  }

  // Summary sheet
  const summaryName = uniq("Tổng Báo Giá");
  const summaryBuf = await buildSummaryBuffer(sheetTotals, quote, vatPct);
  sheetBuffers.push(summaryBuf);
  sheetNames.push(summaryName);

  // Stitch all into one xlsx
  return stitchXlsxBuffers(sheetBuffers, sheetNames);
}

// Backwards-compatible name: callers that previously got a Workbook now get a buffer.
// Update the export route to consume a buffer.
export const buildQuoteWorkbook = buildQuoteBuffer;
