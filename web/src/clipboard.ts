// Port THUẦN (không DOM/import) từ public/grid-clipboard.js — clipboard cho lưới Excel báo giá.
// RFC-4180 parse/serialize (ô nhiều dòng không vỡ) + parse số VN/US an toàn (1,000,000→1000000,
// không còn lỗi 1.000×) + dựng lại nguyên bảng báo giá app xuất ra. PHẢI khớp bản SPA.

export function parseClipboardTSV(text: string | null): string[][] {
  if (text == null) return [[""]];
  text = String(text).replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let started = false;
  const end = text.length;
  for (let i = 0; i < end; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; continue; } inQuotes = false; continue; }
      field += ch; continue;
    }
    if (ch === '"' && field === "") { inQuotes = true; started = true; continue; }
    if (ch === "\t") { row.push(field); field = ""; started = true; continue; }
    if (ch === "\r") { row.push(field); rows.push(row); row = []; field = ""; started = false; if (text[i + 1] === "\n") i++; continue; }
    if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; started = false; continue; }
    field += ch; started = true;
  }
  if (field !== "" || row.length > 0 || started) { row.push(field); rows.push(row); }
  if (rows.length > 1) { const last = rows[rows.length - 1]; if (last.length === 1 && last[0] === "") rows.pop(); }
  return rows.length ? rows : [[""]];
}

export function tsvEscapeField(v: unknown): string {
  const s = String(v == null ? "" : v);
  return /[\t\n\r"]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
export const cellsToTSV = (matrix: string[][]) => matrix.map((row) => row.map(tsvEscapeField).join("\t")).join("\r\n");
const htmlEsc = (s: unknown) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export function cellsToHTML(matrix: string[][]): string {
  let out = "<table>";
  for (const row of matrix) { out += "<tr>"; for (const cell of row) out += "<td>" + htmlEsc(cell).replace(/\r\n|\r|\n/g, "<br>") + "</td>"; out += "</tr>"; }
  return out + "</table>";
}

// "1.000.000" / "1,000,000" → 1000000 ; "12,5" → 12.5 ; "1.234,56" → 1234.56 ; "1.234" → 1234 (nghìn VN).
export function parseLooseNumber(s: string): number {
  s = String(s).trim().replace(/[^\d.,-]/g, "");
  if (!s || s === "-") return 0;
  if (s.includes(",") && s.includes(".")) {
    s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (s.includes(",")) {
    const p = s.split(",");
    s = (p.length === 2 && p[1].length <= 2) ? p[0] + "." + p[1] : s.replace(/,/g, "");
  } else if ((s.match(/\./g) || []).length > 1) {
    s = s.replace(/\./g, "");
  } else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, "");
  }
  return Number(s) || 0;
}

export type RebuiltItem = Record<string, unknown> & { kind: string; formulas?: Record<string, string> };
export function reconstructExportRows(matrix: string[][], roles: string[], numericRoles: Set<string>, numberSubs = false): RebuiltItem[] {
  const numSet = numericRoles instanceof Set ? numericRoles : new Set(["quantity", "unitPrice", "days"]);
  const idx = (role: string) => roles.indexOf(role);
  const sttI = idx("_stt"), nameI = idx("name"), unitI = idx("unit"), qtyI = idx("quantity"), priceI = idx("unitPrice");
  const cell = (row: string[], i: number) => (i >= 0 && i < row.length && row[i] != null ? String(row[i]) : "");
  const out: RebuiltItem[] = [];
  for (const row of matrix) {
    const stt = cell(row, sttI).trim();
    const name = cell(row, nameI);
    const hasItemData = cell(row, unitI).trim() !== "" || cell(row, qtyI).trim() !== "";
    const hasUnit = cell(row, unitI).trim() !== "";
    const priceRaw = cell(row, priceI).trim();
    const hasPrice = priceRaw !== "" && (priceRaw.startsWith("=") || parseLooseNumber(priceRaw) !== 0);
    let kind: string;
    if (/^[A-Za-z]{1,2}$/.test(stt)) kind = "section";
    else if (numberSubs && /^\d+$/.test(stt) && name.trim() !== "") kind = "subsection";   // BANNER (template đích=banner): nhóm con đánh SỐ
    else if (stt === "" && name.trim() === "" && (hasItemData || hasPrice)) kind = "sub";   // hàng con (nối, không tên)
    else if (name.trim() !== "" && !hasUnit && hasPrice) kind = "subsection";   // NHÓM CON theo DATA: có TÊN + GIÁ nhưng KHÔNG ĐVT — bắt được dù dán vào template đích khác
    else if (stt === "" && name.trim() !== "" && !hasItemData && !hasPrice) kind = "info";
    else kind = "item";
    const it: RebuiltItem = { kind };
    roles.forEach((role, i) => {
      if (!role || role === "_stt" || role === "_amount") return;
      const v = cell(row, i);
      if (numSet.has(role)) {
        if (v.trim().startsWith("=")) { (it.formulas || (it.formulas = {}))[role] = v.trim(); it[role] = 0; }
        else it[role] = parseLooseNumber(v);
      } else if (role === "detail" || role === "notes" || role === "name" || role === "label" || role === "internalNote") it[role] = v;
      else it[role] = v.trim();
    });
    if (kind === "section" || kind === "subsection") {
      it.unitPrice = 0;
      if (it.formulas) delete it.formulas.unitPrice;
      if (!(it.formulas && it.formulas.quantity)) it.quantity = parseLooseNumber(cell(row, qtyI));
    }
    if (kind === "info") { it.unit = ""; it.quantity = 0; it.unitPrice = 0; delete it.formulas; }
    if (it.formulas && !Object.keys(it.formulas).length) delete it.formulas;
    out.push(it);
  }
  return out;
}

// Map cột THEO HÀNG TIÊU ĐỀ file Excel nguồn (STT|Hạng Mục|…) → dán đúng dù sheet đích khác
// template (vd nguồn KHÔNG ngày, đích CÓ ngày): cột "Đơn Giá" vẫn vào unitPrice, không lệch sang "Số Ngày".
const HEADER_ROLE: Record<string, string> = {
  "STT": "_stt", "HANG MUC": "name", "CHI TIET": "detail", "DVT": "unit",
  "SO LUONG": "quantity", "SO NGAY": "days", "DON GIA": "unitPrice",
  "THANH TIEN": "_amount", "GHI CHU": "notes", "NOTES": "notes", "GHI CHU NOI BO": "internalNote",
};
function normHdr(s: string): string {
  return String(s || "").replace(/\([^)]*\)/g, " ").replace(/[\r\n]+/g, " ")
    .normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d")
    .toUpperCase().replace(/[^A-Z ]/g, "").replace(/\s+/g, " ").trim();
}
export function isHeaderRow(row: string[] | undefined): boolean {
  return !!row && normHdr(row[0] || "") === "STT";
}
export function headerToRoles(row: string[]): string[] {
  return row.map((h) => HEADER_ROLE[normHdr(h)] || "");
}

export function looksLikeExportPaste(matrix: string[][], startCol: number, fieldCount: number): boolean {
  if (startCol !== 0 || !matrix.length) return false;
  const col0Ok = matrix.every((r) => { const c = (r[0] || "").trim(); return c === "" || /^[A-Za-z]{1,2}$/.test(c) || /^\d+$/.test(c); });
  if (!col0Ok) return false;
  const hasGroupLetter = matrix.some((r) => /^[A-Z]$/.test((r[0] || "").trim()));
  const maxCols = Math.max(...matrix.map((r) => r.length));
  // maxCols > fieldCount: có cột STT thừa (Windows giữ cột rỗng cuối). NHƯNG Excel cho Mac hay BỎ
  // cột rỗng cuối → maxCols == fieldCount; khi đó dựa vào: khối NHIỀU DÒNG + có chữ nhóm A/B (rất khó
  // trùng với dán dữ liệu thường) → vẫn coi là báo giá app xuất ra.
  return hasGroupLetter && (maxCols > fieldCount || matrix.length > 1);
}
