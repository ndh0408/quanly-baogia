// Pure, DOM-free clipboard helpers for the Excel-style quote grid.
// Kept in its own module so the tricky bits (RFC-4180 parsing, VN/US number
// parsing) are UNIT-TESTABLE in isolation (tests import this file directly).
// No imports, no side effects, no `document` — safe to load in Node/Vitest.

// ---- Parse a clipboard payload (TSV from Excel/Google Sheets/Numbers) -------
// Excel & Sheets quote any cell that contains a TAB, newline, or a double-quote,
// using RFC-4180 rules: the field is wrapped in "…" and inner quotes are doubled
// ("" → "). A naive split on \n / \t therefore EXPLODES multi-line cells and leaks
// literal quotes. This state machine handles quoting + CRLF/CR/LF row endings so a
// multi-line "Hạng Mục" copied from Excel comes back as ONE cell.
// Returns a matrix: string[][] (always at least [[""]]).
export function parseClipboardTSV(text) {
  if (text == null) return [[""]];
  text = String(text).replace(/^\uFEFF/, ""); // strip a leading UTF-8 BOM
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  let started = false; // did we see any char on this logical row?
  const end = text.length;
  for (let i = 0; i < end; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; continue; } // escaped "
        inQuotes = false; continue; // closing quote
      }
      field += ch; // any char (incl. \t \n \r) stays inside the quoted field
      continue;
    }
    if (ch === '"' && field === "") { inQuotes = true; started = true; continue; }
    if (ch === "\t") { row.push(field); field = ""; started = true; continue; }
    if (ch === "\r") { row.push(field); rows.push(row); row = []; field = ""; started = false; if (text[i + 1] === "\n") i++; continue; }
    if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; started = false; continue; }
    field += ch; started = true;
  }
  if (field !== "" || row.length > 0 || started) { row.push(field); rows.push(row); }
  // A terminal newline leaves a trailing [""] row → drop it (don't paste a blank row).
  if (rows.length > 1) {
    const last = rows[rows.length - 1];
    if (last.length === 1 && last[0] === "") rows.pop();
  }
  return rows.length ? rows : [[""]];
}

// ---- Serialize a matrix back to clipboard formats ---------------------------
export function tsvEscapeField(v) {
  const s = String(v == null ? "" : v);
  return /[\t\n\r"]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// text/plain: RFC-4180 TSV, rows joined with CRLF (what Excel emits + accepts).
export function cellsToTSV(matrix) {
  return matrix.map((row) => row.map(tsvEscapeField).join("\t")).join("\r\n");
}

function htmlEsc(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// text/html: a real <table> so pasting into Word/Outlook/Google Sheets keeps the
// grid shape; multi-line cells render with <br>.
export function cellsToHTML(matrix) {
  let out = "<table>";
  for (const row of matrix) {
    out += "<tr>";
    for (const cell of row) out += "<td>" + htmlEsc(cell).replace(/\r\n|\r|\n/g, "<br>") + "</td>";
    out += "</tr>";
  }
  return out + "</table>";
}

// ---- Parse a pasted number (Vietnamese OR US grouping) ----------------------
// "1.000.000" / "1,000,000" → 1000000 ; "12,5" → 12.5 ; "1.234,56" → 1234.56.
// FIX: a single dotted group like "1.234" is VN thousands → 1234 (was misread as
// 1.234, a 1000x money error). Genuine US decimals like "1234.5" stay 1234.5.
export function parseLooseNumber(s) {
  s = String(s).trim().replace(/[^\d.,-]/g, "");
  if (!s || s === "-") return 0;
  if (s.includes(",") && s.includes(".")) {
    s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (s.includes(",")) {
    const p = s.split(",");
    s = (p.length === 2 && p[1].length <= 2) ? p[0] + "." + p[1] : s.replace(/,/g, "");
  } else if ((s.match(/\./g) || []).length > 1) {
    s = s.replace(/\./g, ""); // 1.234.567 → 1234567
  } else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, ""); // single VN-thousands group: 1.234 / 12.500 → 1234 / 12500
  }
  return Number(s) || 0;
}
