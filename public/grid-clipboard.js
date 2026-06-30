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

// Riêng cột SỐ LƯỢNG / SỐ NGÀY: là SỐ ĐO NHỎ (vd 13.524 m2). 1 dấu "." hoặc "," → THẬP PHÂN
// (KHÔNG đoán "nghìn"); NHIỀU dấu → ngăn nghìn. Tránh "13.524"→13524 làm tổng sai gấp ngàn lần.
export function parseLooseDecimal(s) {
  let str = String(s).trim().replace(/[^\d.,-]/g, "");
  if (!str || str === "-") return 0;
  const neg = str.startsWith("-"); str = str.replace(/-/g, "");
  const dots = (str.match(/\./g) || []).length, commas = (str.match(/,/g) || []).length;
  if (dots && commas) {
    str = str.lastIndexOf(",") > str.lastIndexOf(".") ? str.replace(/\./g, "").replace(",", ".") : str.replace(/,/g, "");
  } else if (dots + commas > 1) {
    str = str.replace(/[.,]/g, "");
  } else {
    str = str.replace(",", ".");
  }
  const n = Number(str) || 0;
  return neg ? -n : n;
}

// ---- Reconstruct a quote table copied from the app's OWN Excel export -----------------
// Khi người dùng copy NGUYÊN bảng báo giá từ file app xuất ra (gồm cả cột STT) rồi dán vào
// lưới, hàm này DỰNG LẠI đúng cấu trúc: nhóm lớn (A/B/C) / nhóm con / hàng con / dòng thông
// tin / item — dựa trên đúng quy luật export:
//   • STT là CHỮ (A,B,…)                         → nhóm chính (section)
//   • STT trống + KHÔNG có tên + có ĐVT/SL/giá   → hàng con (sub)  [STT+tên bị gộp ô với dòng cha]
//   • STT trống + CÓ tên + KHÔNG ĐVT/SL + có giá → nhóm con (subsection)  [giá = tổng nhóm]
//   • STT trống + CÓ tên + KHÔNG giá             → dòng thông tin (info)
//   • còn lại (STT số)                           → item
// `roles` = thứ tự field của từng cột dán vào (vd ["_stt","name","detail","unit","quantity",
// "unitPrice","_amount","notes"]); cột "_stt"/"_amount" là tính toán, KHÔNG nhập.
export function reconstructExportRows(matrix, roles, numericRoles, numberSubs = false) {
  const numSet = numericRoles instanceof Set ? numericRoles : new Set(numericRoles || ["quantity", "unitPrice", "days"]);
  const idx = (role) => roles.indexOf(role);
  const sttI = idx("_stt"), nameI = idx("name"), unitI = idx("unit"), qtyI = idx("quantity"), priceI = idx("unitPrice");
  const cell = (row, i) => (i >= 0 && i < row.length && row[i] != null ? String(row[i]) : "");
  const out = [];
  for (const row of matrix) {
    const stt = cell(row, sttI).trim();
    const name = cell(row, nameI);
    const hasItemData = cell(row, unitI).trim() !== "" || cell(row, qtyI).trim() !== "";
    const hasUnit = cell(row, unitI).trim() !== "";
    const priceRaw = cell(row, priceI).trim();
    // Giá là công thức ("=…") cũng tính là CÓ giá (parseLooseNumber không đọc nổi công thức).
    const hasPrice = priceRaw !== "" && (priceRaw.startsWith("=") || parseLooseNumber(priceRaw) !== 0);
    let kind;
    if (/^[A-Za-z]{1,2}$/.test(stt)) kind = "section";
    else if (numberSubs && /^\d+$/.test(stt) && name.trim() !== "") kind = "subsection";   // BANNER (template đích=banner): nhóm con đánh SỐ
    else if (stt === "" && name.trim() === "" && (hasItemData || hasPrice)) kind = "sub";   // hàng con (nối, không tên)
    else if (name.trim() !== "" && !hasUnit && hasPrice) kind = "subsection";   // NHÓM CON theo DATA: có TÊN + GIÁ nhưng KHÔNG ĐVT — bắt được dù dán vào template đích khác
    else if (stt === "" && name.trim() !== "" && !hasItemData && !hasPrice) kind = "info";
    else kind = "item";
    const it = { kind };
    roles.forEach((role, i) => {
      if (!role || role === "_stt" || role === "_amount") return;
      const v = cell(row, i);
      if (numSet.has(role)) {
        // Công thức Excel dán dưới dạng text ("=3.7*2.5", "=G3*F3"): giữ thành CÔNG THỨC
        // (it.formulas[role]) để có nút ƒ + được tính lại; nếu không thì parse số như cũ.
        // it[role]=0 chỉ là placeholder — caller gọi recomputeAll() để đánh giá công thức.
        if (v.trim().startsWith("=")) { (it.formulas || (it.formulas = {}))[role] = v.trim(); it[role] = 0; }
        else it[role] = (role === "quantity" || role === "days") ? parseLooseDecimal(v) : parseLooseNumber(v);   // SL/Ngày = số đo → thập phân
      }
      else if (role === "detail" || role === "notes" || role === "name" || role === "label") it[role] = v;
      else it[role] = v.trim();
    });
    // Nhóm/nhóm con: ô "Đơn Giá" trong export là TỔNG nhóm (tính tự động) → không phải đơn giá thật.
    if (kind === "section" || kind === "subsection") {
      it.unitPrice = 0;
      if (it.formulas) delete it.formulas.unitPrice;   // nhóm không nhận công thức đơn giá
      if (!(it.formulas && it.formulas.quantity)) it.quantity = parseLooseDecimal(cell(row, qtyI));   // giữ công thức SL nếu có; số → thập phân
    }
    if (kind === "info") { it.unit = ""; it.quantity = 0; it.unitPrice = 0; delete it.formulas; }   // dòng thông tin: không số/không công thức
    if (it.formulas && !Object.keys(it.formulas).length) delete it.formulas;
    out.push(it);
  }
  return out;
}

// Map cột THEO HÀNG TIÊU ĐỀ file Excel nguồn (STT|Hạng Mục|…) → dán đúng dù sheet đích khác template
// (vd nguồn KHÔNG ngày, đích CÓ ngày): cột "Đơn Giá" vẫn vào unitPrice, không lệch sang "Số Ngày".
const HEADER_ROLE = {
  "STT": "_stt", "HANG MUC": "name", "CHI TIET": "detail", "DVT": "unit",
  "SO LUONG": "quantity", "SO NGAY": "days", "DON GIA": "unitPrice",
  "THANH TIEN": "_amount", "GHI CHU": "notes", "NOTES": "notes", "GHI CHU NOI BO": "internalNote",
};
function normHdr(s) {
  return String(s || "").replace(/\([^)]*\)/g, " ").replace(/[\r\n]+/g, " ")
    .normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d")
    .toUpperCase().replace(/[^A-Z ]/g, "").replace(/\s+/g, " ").trim();
}
export function isHeaderRow(row) { return !!row && normHdr(row[0] || "") === "STT"; }
export function headerToRoles(row) { return row.map((h) => HEADER_ROLE[normHdr(h)] || ""); }

// Có nên coi khối dán là "bảng báo giá app xuất ra" (gồm cột STT) để dựng lại cấu trúc?
// An toàn: chỉ khi dán từ cột đầu, cột STT toàn dạng STT (chữ đơn / số / trống) và hoặc có
// chữ nhóm (A/B) hoặc khối rộng hơn số cột nhập (tức có thêm cột STT). fieldCount = số FIELDS.
export function looksLikeExportPaste(matrix, startCol, fieldCount) {
  if (startCol !== 0 || !matrix.length) return false;
  const col0Ok = matrix.every((r) => { const c = (r[0] || "").trim(); return c === "" || /^[A-Za-z]{1,2}$/.test(c) || /^\d+$/.test(c); });
  if (!col0Ok) return false;
  // Chữ nhóm A/B/C là 1 ký tự HOA (loại tiêu đề 2 chữ như "TT"/"KL"/"ID" của bảng ngoài).
  const hasGroupLetter = matrix.some((r) => /^[A-Z]$/.test((r[0] || "").trim()));
  const maxCols = Math.max(...matrix.map((r) => r.length));
  // PHẢI vừa có chữ nhóm VỪA rộng hơn số cột nhập (tức có thêm cột STT) → đúng bảng app xuất ra.
  // Dùng AND (không phải OR) để bảng Excel ngoài bị dán nhầm không bị hiểu sai thành nhóm.
  // maxCols > fieldCount: có cột STT thừa (Windows giữ cột rỗng cuối). NHƯNG Excel cho Mac hay BỎ
  // cột rỗng cuối → maxCols == fieldCount; khi đó dựa vào: khối NHIỀU DÒNG + có chữ nhóm A/B (rất khó
  // trùng với dán dữ liệu thường) → vẫn coi là báo giá app xuất ra.
  return hasGroupLetter && (maxCols > fieldCount || matrix.length > 1);
}
