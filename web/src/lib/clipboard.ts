// Port THUẦN (không DOM/import) từ public/grid-clipboard.js — clipboard cho lưới Excel báo giá.
// RFC-4180 parse/serialize (ô nhiều dòng không vỡ) + parse số VN/US an toàn (1,000,000→1000000,
// không còn lỗi 1.000×) + dựng lại nguyên bảng báo giá app xuất ra. PHẢI khớp bản SPA.

export function parseClipboardTSV(text: string | null): string[][] {
  if (text == null) return [[""]];
  text = String(text).replace(/^\uFEFF/, ""); // strip BOM (escape thay ký tự trần — lint no-irregular-whitespace)
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

// Riêng cột SỐ LƯỢNG / SỐ NGÀY: là SỐ ĐO NHỎ (vd 13.524 m2). 1 dấu "." hoặc "," → THẬP PHÂN
// (KHÔNG đoán "nghìn" như parseLooseNumber); NHIỀU dấu → ngăn nghìn. Tránh "13.524"→13524.
export function parseLooseDecimal(s: string): number {
  let str = String(s).trim().replace(/[^\d.,-]/g, "");
  if (!str || str === "-") return 0;
  const neg = str.startsWith("-"); str = str.replace(/-/g, "");
  const dots = (str.match(/\./g) || []).length, commas = (str.match(/,/g) || []).length;
  if (dots && commas) {
    str = str.lastIndexOf(",") > str.lastIndexOf(".") ? str.replace(/\./g, "").replace(",", ".") : str.replace(/,/g, "");
  } else if (dots + commas > 1) {
    str = str.replace(/[.,]/g, "");   // nhiều dấu cùng loại (1.234.567 / 1,234,567) = ngăn nghìn
  } else {
    str = str.replace(",", ".");      // đúng 1 dấu = thập phân
  }
  const n = Number(str) || 0;
  return neg ? -n : n;
}

export type RebuiltItem = Record<string, unknown> & { kind: string; formulas?: Record<string, string> };
export function reconstructExportRows(matrix: string[][], roles: string[], numericRoles: Set<string>, numberSubs = false): RebuiltItem[] {
  const numSet = numericRoles instanceof Set ? numericRoles : new Set(["quantity", "unitPrice", "days"]);
  const idx = (role: string) => roles.indexOf(role);
  const sttI = idx("_stt"), nameI = idx("name"), unitI = idx("unit"), qtyI = idx("quantity"), priceI = idx("unitPrice");
  const cell = (row: string[], i: number) => (i >= 0 && i < row.length && row[i] != null ? String(row[i]) : "");
  // BANNER xuất ra có NHÓM CON đánh SỐ + KHÔNG ĐVT (vd "1  CGV Kim Cúc"). Nếu DATA có kiểu đó → nguồn là
  // banner → hàng STT-trống là MỤC (không phải nhóm con). Nếu KHÔNG có → nguồn là GN-không-ngày → hàng
  // STT-trống + có tên = NHÓM CON (vd "Chi phí vận chuyển"). Phân biệt để mỗi template hiểu đúng paste.
  const hasNumberedSub = matrix.some((r) => /^\d+$/.test(cell(r, sttI).trim()) && cell(r, nameI).trim() !== "" && cell(r, unitI).trim() === "" && cell(r, priceI).trim() !== "");
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
    else if (stt === "" && name.trim() !== "" && !hasItemData && !hasPrice) kind = "info";   // dòng thông tin: STT trống + TÊN, KHÔNG đo/giá
    else if (!numberSubs && !hasNumberedSub && stt === "" && name.trim() !== "") kind = "subsection";   // GN KHÔNG NGÀY: nhóm con = STT TRỐNG + có TÊN (KỂ CẢ có ĐVT/giá, vd "Chi phí vận chuyển"). CHỈ khi data KHÔNG có nhóm-con-đánh-số (banner).
    else if (name.trim() !== "" && !hasUnit && hasPrice) kind = "subsection";   // NHÓM CON theo DATA: có TÊN + GIÁ nhưng KHÔNG ĐVT — bắt được dù dán vào template đích khác
    else kind = "item";
    const it: RebuiltItem = { kind };
    roles.forEach((role, i) => {
      if (!role || role === "_stt" || role === "_amount") return;
      const v = cell(row, i);
      if (numSet.has(role)) {
        if (v.trim().startsWith("=")) { (it.formulas || (it.formulas = {}))[role] = v.trim(); it[role] = 0; }
        else it[role] = (role === "quantity" || role === "days") ? parseLooseDecimal(v) : parseLooseNumber(v);   // SL/Ngày = số đo → thập phân
      } else if (role === "detail" || role === "notes" || role === "name" || role === "label" || role === "internalNote") it[role] = v;
      else it[role] = v.trim();
    });
    if (kind === "section" || kind === "subsection") {
      it.unitPrice = 0;
      if (it.formulas) delete it.formulas.unitPrice;
      if (!(it.formulas && it.formulas.quantity)) it.quantity = parseLooseDecimal(cell(row, qtyI));
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

// ===== TỰ DỊCH công thức Excel trong khối DÁN → toạ độ WEB (retarget) =====
// Ô paste chứa "=…" mang địa chỉ Ô THEO FILE EXCEL (vd "=G12*F12") — lệch hẳn hệ cột/hàng web.
// Chiến lược: (1) DÒ khối bắt đầu từ cột X0/hàng R0 nào của file nguồn (quét, chấm điểm theo số
// tham chiếu rơi gọn vào khối); (2) DỊCH từng ref sang (role, dòng-trong-khối); (3) TỰ KIỂM bằng
// cột THÀNH TIỀN của dòng đó trong khối (SL×ĐG≈TT). Khớp → tự sửa công thức theo địa chỉ web +
// điền giá trị. Không chắc → GIỮ công thức gốc + cờ _fxWarn (ô ĐỎ, người dùng sửa tay).
const RT_FNS: Record<string, (a: number[]) => number> = {
  SUM: (a) => a.reduce((x, y) => x + y, 0), PRODUCT: (a) => a.reduce((x, y) => x * y, 1),
  AVERAGE: (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0), AVG: (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0),
  MIN: (a) => (a.length ? Math.min(...a) : 0), MAX: (a) => (a.length ? Math.max(...a) : 0),
  ROUND: (a) => { const p = 10 ** (a[1] || 0); return Math.round((a[0] || 0) * p) / p; },
  ROUNDUP: (a) => { const p = 10 ** (a[1] || 0); return Math.ceil((a[0] || 0) * p) / p; },
  ROUNDDOWN: (a) => { const p = 10 ** (a[1] || 0); return Math.trunc((a[0] || 0) * p) / p; },
  INT: (a) => Math.floor(a[0] || 0), ABS: (a) => Math.abs(a[0] || 0),
};
function rtArith(input: string): number | null {
  const s = String(input).replace(/\s+/g, "");
  if (!s || !/^[-+*/().0-9]+$/.test(s)) return null;
  let pos = 0;
  const peek = () => s[pos];
  const fac = (): number | null => {
    if (peek() === "(") { pos++; const v = expr(); if (peek() !== ")") return null; pos++; return v; }
    if (peek() === "-") { pos++; const v = fac(); return v === null ? null : -v; }
    if (peek() === "+") { pos++; return fac(); }
    let num = ""; while (pos < s.length && /[0-9.]/.test(s[pos])) num += s[pos++];
    return num && !isNaN(Number(num)) ? Number(num) : null;
  };
  const term = (): number | null => { let v = fac(); while (peek() === "*" || peek() === "/") { const op = s[pos++]; const r = fac(); if (v === null || r === null) return null; v = op === "*" ? v * r : v / r; } return v; };
  const expr = (): number | null => { let v = term(); while (peek() === "+" || peek() === "-") { const op = s[pos++]; const r = term(); if (v === null || r === null) return null; v = op === "+" ? v + r : v - r; } return v; };
  const r = expr();
  return pos === s.length && r !== null && isFinite(r) ? r : null;
}
// Đánh giá công thức đã thay ref bằng SỐ (còn hàm SUM/ROUND…, "%", ";" đối số, "," thập phân).
function rtEval(input: string): number | null {
  let s = String(input).trim().replace(/^=/, "").replace(/×/g, "*").replace(/(\d)\s*[xX]\s*(?=\d)/g, "$1*");
  s = s.replace(/(\d+(?:[.,]\d+)?)\s*%/g, (_m, nn) => String(Number(String(nn).replace(",", ".")) / 100));
  s = s.replace(/,/g, ".");
  let guard = 0;
  while (/[A-Za-z]+\s*\(/.test(s)) {
    if (guard++ > 60) return null;
    let changed = false;
    s = s.replace(/([A-Za-z]+)\s*\(([^()]*)\)/, (_m, name, args) => {
      changed = true;
      const fn = RT_FNS[String(name).toUpperCase()];
      if (!fn) return "NaN";
      const vals = String(args).split(";").map((a) => rtArith(a)).filter((v): v is number => v !== null && isFinite(v));
      const r = fn(vals);
      return r == null || !isFinite(r) ? "NaN" : String(r);
    });
    if (!changed) return null;
  }
  return rtArith(s);
}
const rtColIdx = (L: string) => { let nn = 0; for (const ch of L.toUpperCase()) nn = nn * 26 + (ch.charCodeAt(0) - 64); return nn - 1; };

export type RetargetOpts = {
  webLetter: (role: string) => string | null;   // role → chữ cột WEB của lưới đích (quantity/unitPrice/days/_amount)
  baseRow: number;                              // hàng web (0-based) của dòng ĐẦU khối sau khi dán
};
export function retargetPastedFormulas(built: RebuiltItem[], matrix: string[][], roles: string[], opts: RetargetOpts) {
  const n = built.length;
  const amtI = roles.indexOf("_amount"), dayI = roles.indexOf("days");
  const NUMOK = new Set(["quantity", "unitPrice", "days", "_amount"]);
  const cellRaw = (k: number, i: number) => (i >= 0 && matrix[k] && matrix[k][i] != null ? String(matrix[k][i]) : "");
  // Giá trị 1 ô của KHỐI theo (role, dòng k) — _amount đọc từ matrix; ô công thức → NaN (chưa biết).
  const valOf = (role: string, k: number): number => {
    const it = built[k];
    if (!it || it.kind === "info") return NaN;
    if (role === "_amount") { const s = cellRaw(k, amtI).trim(); return s && !s.startsWith("=") ? parseLooseNumber(s) : NaN; }
    if (it.formulas && it.formulas[role] != null) return NaN;
    const v = (it as Record<string, unknown>)[role];
    return v == null ? NaN : Number(v);
  };
  // Gom mọi ref (đơn + dải) của mọi công thức trong khối.
  const refRe = /([A-Za-z]+)(\d+)(?:\s*:\s*([A-Za-z]+)(\d+))?/g;
  const allRefs: { col: number; row: number }[] = [];
  const fxList: { k: number; f: string; raw: string }[] = [];
  built.forEach((it, k) => {
    if (!it.formulas) return;
    for (const f in it.formulas) {
      const raw = String(it.formulas[f] || "");
      if (!/[A-Za-z]+\d+/.test(raw)) continue;   // không tham chiếu ô → số học thuần, giữ nguyên vẫn đúng
      fxList.push({ k, f, raw });
      let m: RegExpExecArray | null; refRe.lastIndex = 0;
      while ((m = refRe.exec(raw))) {
        allRefs.push({ col: rtColIdx(m[1]), row: +m[2] });
        if (m[3] && m[4]) allRefs.push({ col: rtColIdx(m[3]), row: +m[4] });
      }
    }
  });
  if (!fxList.length) return;
  const markWarn = (k: number, f: string) => { const it = built[k] as RebuiltItem & { _fxWarn?: Record<string, boolean> }; (it._fxWarn || (it._fxWarn = {}))[f] = true; };
  // DÒ (X0, R0): cột/hàng Excel ĐẦU của khối — chấm điểm theo số ref rơi gọn vào khối + đúng cột số.
  let best: { x0: number; r0: number; score: number }[] = [];
  for (let x0 = 0; x0 <= 6; x0++) {
    for (let r0 = 1; r0 <= 500; r0++) {
      let score = 0;
      for (const rf of allRefs) {
        const role = roles[rf.col - x0];
        if (role && NUMOK.has(role) && rf.row - r0 >= 0 && rf.row - r0 < n) score++;
      }
      if (score > 0) {
        if (!best.length || score > best[0].score) best = [{ x0, r0, score }];
        else if (score === best[0].score) best.push({ x0, r0, score });
      }
    }
  }
  const tryFit = (x0: number, r0: number, apply: boolean): { ok: number; dist: number } => {
    let okCount = 0, dist = 0;
    for (const { k, f, raw } of fxList) {
      // Dịch ref → địa chỉ WEB; fail ref nào → bỏ ô này (đánh đỏ khi apply).
      let good = true;
      const rendered = raw.replace(/^=/, "").replace(/([A-Za-z]+)(\d+)(?:\s*:\s*([A-Za-z]+)(\d+))?/g, (mm, c1, r1, c2, r2) => {
        if (!good) return mm;
        const roleA = roles[rtColIdx(c1) - x0]; const ka = +r1 - r0;
        if (!roleA || !NUMOK.has(roleA) || ka < 0 || ka >= n) { good = false; return mm; }
        const La = opts.webLetter(roleA); if (!La) { good = false; return mm; }
        if (c2 && r2) {
          const roleB = roles[rtColIdx(c2) - x0]; const kb = +r2 - r0;
          if (roleB !== roleA || kb < 0 || kb >= n) { good = false; return mm; }
          return La + (opts.baseRow + Math.min(ka, kb) + 1) + ":" + La + (opts.baseRow + Math.max(ka, kb) + 1);
        }
        return La + (opts.baseRow + ka + 1);
      });
      if (!good) { if (apply) markWarn(k, f); continue; }
      // Eval theo giá trị KHỐI: thay ref bằng SỐ.
      let evalable = true;
      const numeric = raw.replace(/^=/, "").replace(/([A-Za-z]+)(\d+)(?:\s*:\s*([A-Za-z]+)(\d+))?/g, (mm, c1, r1, c2, r2) => {
        if (!evalable) return mm;
        const roleA = roles[rtColIdx(c1) - x0]; const ka = +r1 - r0;
        if (c2 && r2) {
          const kb = +r2 - r0; const vals: number[] = [];
          for (let kk = Math.min(ka, kb); kk <= Math.max(ka, kb); kk++) { const v = valOf(roleA, kk); if (!isFinite(v)) { evalable = false; return mm; } vals.push(v); }
          return vals.join(";");
        }
        const v = valOf(roleA, ka); if (!isFinite(v)) { evalable = false; return mm; }
        return String(v);
      });
      const fxVal = evalable ? rtEval(numeric) : null;
      if (fxVal == null || !isFinite(fxVal)) { if (apply) markWarn(k, f); continue; }
      // TỰ KIỂM bằng THÀNH TIỀN dòng k của khối: fx là 1 vế của SL×(Ngày×)ĐG.
      const amtS = cellRaw(k, amtI).trim();
      const amt = amtS && !amtS.startsWith("=") ? parseLooseNumber(amtS) : NaN;
      const qty = f === "quantity" ? fxVal : valOf("quantity", k);
      const price = f === "unitPrice" ? fxVal : valOf("unitPrice", k);
      const days = dayI >= 0 ? (f === "days" ? fxVal : (valOf("days", k) || 1)) : 1;
      if (!isFinite(amt) || amt === 0 || !isFinite(qty) || !isFinite(price)) { if (apply) markWarn(k, f); continue; }
      const qR = (() => { const t = Math.round(Math.abs(qty) * 10 + 1e-6) / 10; return qty < 0 ? -t : t; })();   // SL làm tròn 1 số như app
      const predicted = Math.round(qR * (isFinite(days) ? days : 1) * price);
      if (Math.abs(predicted - amt) > Math.max(2, Math.abs(amt) * 0.005)) { if (apply) markWarn(k, f); continue; }
      okCount++;
      // Khoảng cách ref → dòng chứa công thức: tie-break khi dữ liệu TUẦN HOÀN khiến nhiều (X0,R0)
      // cùng verify OK — công thức thật luôn tham chiếu hàng GẦN nó, chọn diễn giải gần nhất.
      { let mD: RegExpExecArray | null; refRe.lastIndex = 0; while ((mD = refRe.exec(raw))) { dist += Math.abs((+mD[2] - r0) - k); if (mD[4]) dist += Math.abs((+mD[4] - r0) - k); } }
      if (apply) {
        const it = built[k] as RebuiltItem & Record<string, unknown>;
        (it.formulas as Record<string, string>)[f] = "=" + rendered;
        it[f] = fxVal;
      }
    }
    return { ok: okCount, dist };
  };
  // Chọn ứng viên (X0,R0): verify PASS nhiều nhất → tie-break tổng-khoảng-cách-ref NHỎ nhất
  // (ưu tiên X0=1 — app xuất từ cột B). Quét tối đa 12 ứng viên điểm cao.
  best.sort((a, b) => ((a.x0 === 1 ? -1 : 0) - (b.x0 === 1 ? -1 : 0)) || a.r0 - b.r0);
  let win: { x0: number; r0: number } | null = null, winOk = -1, winDist = Infinity;
  for (const c of best.slice(0, 12)) {
    const { ok, dist } = tryFit(c.x0, c.r0, false);
    if (ok > winOk || (ok === winOk && dist < winDist)) { winOk = ok; winDist = dist; win = c; }
  }
  if (win && winOk > 0) tryFit(win.x0, win.r0, true);
  else for (const { k, f } of fxList) markWarn(k, f);   // không khớp được gì → giữ công thức gốc + ô ĐỎ hết
}
