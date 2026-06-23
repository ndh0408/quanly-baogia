// Mang CÔNG THỨC người dùng TỰ GÕ trong editor (QuoteItem.formulas) RA file Excel.
//
// Bối cảnh: editor cho gõ công thức kiểu Excel vào ô Số Lượng / Đơn Giá / Số Ngày
// (vd "=1000000*8%", "=G3*1,1", "=SUM(H3:H8)"). Trước đây export CHỈ ghi con số đã
// tính — khách mở file bấm vào ô không thấy "=…". Module này dịch công thức editor
// sang công thức Excel thật để xuất ra.
//
// HAI hệ toạ độ KHÁC nhau phải khớp:
//   • Cột:  editor đánh A,B,C… theo thứ tự HIỂN THỊ (_stt=A, name=B, [detail], unit,
//           quantity, [days], unitPrice, _amount, notes) — KHÁC cột Excel của template
//           (vd GN: quantity=F, unitPrice=G, amount=H). Dịch qua TÊN FIELD trung gian.
//   • Hàng: editor ref dùng (chỉ số item + 1); Excel dùng hàng thật (firstRow + slot),
//           có chèn hàng nhóm ở giữa. Dịch qua slotRows.
//
// AN TOÀN LÀ TRÊN HẾT (báo giá = tiền của khách): mọi công thức dịch xong đều được
// TỰ KIỂM (đánh giá lại bằng bộ eval port từ frontend, so với giá trị đã lưu). Bất cứ
// nghi ngờ nào (hàm lạ, ref ngoài bảng, ref trỏ vào hàng nhóm/chữ, kết quả lệch) →
// QUAY VỀ ghi số như cũ. Vì vậy thay đổi này CHỈ tốt hơn, không bao giờ làm hỏng export.

// Hàm Excel có tên + ngữ nghĩa khớp 1:1 với bộ eval của editor → an toàn để xuất.
// CEILING/FLOOR bị LOẠI: editor coi là ceil/floor 1 đối số, còn Excel BẮT BUỘC có
// đối số "significance" → xuất ra sẽ lỗi ô. Công thức như vậy quay về ghi số.
const SAFE_FNS = new Set(["SUM", "PRODUCT", "AVERAGE", "MIN", "MAX", "ROUND", "ROUNDUP", "ROUNDDOWN", "INT", "ABS"]);
const FN_ALIAS = { AVG: "AVERAGE" };

/** 0→"A", 1→"B", …, 25→"Z", 26→"AA". Cột editor (giống groupLetter ở frontend). */
export function colLetter(n) {
  let s = "", x = n + 1;
  while (x > 0) { const m = (x - 1) % 26; s = String.fromCharCode(65 + m) + s; x = Math.floor((x - 1) / 26); }
  return s;
}

// ===== Bộ eval công thức editor — PORT TRUNG THÀNH từ public/js/editor.js =====
// CHỈ dùng để TỰ KIỂM: công thức dịch xong có còn cho ra đúng giá trị đã lưu không.
// Phải giữ khớp với frontend; có test ghim. (Nếu lệch → tự kiểm trượt → ghi số: an toàn.)
function evalArith(input) {
  let s = String(input).replace(/,/g, ".").replace(/\s+/g, "");
  if (!s || !/^[-+*/().0-9]+$/.test(s)) return null;
  let pos = 0;
  const peek = () => s[pos];
  function expr() {
    let v = term();
    while (peek() === "+" || peek() === "-") { const op = s[pos++]; const r = term(); if (v === null || r === null) return null; v = op === "+" ? v + r : v - r; }
    return v;
  }
  function term() {
    let v = factor();
    while (peek() === "*" || peek() === "/") { const op = s[pos++]; const r = factor(); if (v === null || r === null) return null; v = op === "*" ? v * r : v / r; }
    return v;
  }
  function factor() {
    if (peek() === "(") { pos++; const v = expr(); if (peek() !== ")") return null; pos++; return v; }
    if (peek() === "-") { pos++; const v = factor(); return v === null ? null : -v; }
    if (peek() === "+") { pos++; return factor(); }
    let num = "";
    while (pos < s.length && /[0-9.]/.test(s[pos])) num += s[pos++];
    if (!num || isNaN(Number(num))) return null;
    return Number(num);
  }
  const result = expr();
  if (pos !== s.length || result === null || !isFinite(result)) return null;
  return result;
}

const FORMULA_FNS = {
  SUM: (a) => a.reduce((x, y) => x + y, 0),
  PRODUCT: (a) => a.reduce((x, y) => x * y, 1),
  AVERAGE: (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0),
  AVG: (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0),
  MIN: (a) => (a.length ? Math.min(...a) : 0),
  MAX: (a) => (a.length ? Math.max(...a) : 0),
  ROUND: (a) => { const p = 10 ** (a[1] || 0); return Math.round((a[0] || 0) * p) / p; },
  ROUNDUP: (a) => { const p = 10 ** (a[1] || 0); return Math.ceil((a[0] || 0) * p) / p; },
  ROUNDDOWN: (a) => { const p = 10 ** (a[1] || 0); return Math.trunc((a[0] || 0) * p) / p; },
  INT: (a) => Math.floor(a[0] || 0),
  ABS: (a) => Math.abs(a[0] || 0),
  CEILING: (a) => Math.ceil(a[0] || 0),
  FLOOR: (a) => Math.floor(a[0] || 0),
};

/** Đánh giá công thức editor (cú pháp ";" tách đối số, "," là dấu thập phân). refs giải tham chiếu ô. */
export function evalEditorFormula(input, refs) {
  let s = String(input).trim().replace(/^=/, "");
  if (!s) return null;
  s = s.replace(/×/g, "*").replace(/(\d)\s*[xX]\s*(?=\d)/g, "$1*");
  if (refs) {
    s = s.replace(/([A-Za-z]+\d+)\s*:\s*([A-Za-z]+\d+)/g, (_m, a, b) => {
      const list = refs.range(a, b);
      return (list && list.length) ? list.join(";") : "0";
    });
    s = s.replace(/(?<![A-Za-z0-9_.])([A-Za-z]+\d+)/g, (_m, a) => {
      const v = refs.cell(a);
      return (v === null || v === undefined || isNaN(v)) ? "0" : String(v);
    });
  }
  s = s.replace(/(\d+(?:[.,]\d+)?)\s*%/g, (_m, n) => String(Number(n.replace(",", ".")) / 100));
  let guard = 0;
  while (/[A-Za-z]+\s*\(/.test(s)) {
    if (guard++ > 100) return null;
    let changed = false;
    s = s.replace(/([A-Za-z]+)\s*\(([^()]*)\)/, (_m, name, args) => {
      changed = true;
      const fn = FORMULA_FNS[name.toUpperCase()];
      if (!fn) return "NaN";
      const vals = args.split(";").map((a) => evalArith(a)).filter((v) => v !== null && isFinite(v));
      const r = fn(vals);
      return (r === null || !isFinite(r)) ? "NaN" : String(r);
    });
    if (!changed) return null;
  }
  return evalArith(s);
}

/**
 * Dịch MỘT công thức editor sang chuỗi công thức Excel (KHÔNG có dấu "=" đầu, hợp với
 * ExcelJS `{ formula }`), hoặc trả null nếu KHÔNG dịch được (gọi nơi dùng sẽ ghi số).
 *
 * ctx:
 *   colToField  : { "E": "quantity", … }  cột editor → tên field
 *   fieldToCol  : { "quantity": "F", "_amount": "H", … }  tên field → cột Excel
 *   allowedRef  : Set  field được phép tham chiếu (số/_amount; KHÔNG cho chữ/_stt)
 *   rowToExcel  : (editorRow:number) → excelRow:number | null   (null nếu hàng không hợp lệ)
 *   rangeOk     : (editorRow1, editorRow2) → bool   (Excel có liền mạch & toàn hàng item không)
 */
export function translateFormula(raw, ctx) {
  if (raw == null) return null;
  let s = String(raw).trim().replace(/^=/, "");
  if (!s) return null;

  // "×" và "x"/"X" giữa hai chữ số = nhân (giống editor).
  s = s.replace(/×/g, "*").replace(/(\d)\s*[xX]\s*(?=\d)/g, "$1*");

  // Đổi tham chiếu ô (đơn lẻ HOẶC dải) sang toạ độ Excel — quét 1 lượt để dải không
  // bị xử lý hai lần. Tên hàm (SUM…) không có chữ số đuôi nên KHÔNG bị bắt nhầm.
  let aborted = false;
  const refRe = /([A-Za-z]+)(\d+)(?:\s*:\s*([A-Za-z]+)(\d+))?/g;
  s = s.replace(refRe, (m, c1, r1, c2, r2) => {
    if (aborted) return m;
    const a = mapRef(ctx, c1, r1);
    if (!a) { aborted = true; return m; }
    if (c2 && r2) {
      const b = mapRef(ctx, c2, r2);
      // Dải PHẢI cùng một cột Excel + liền mạch + toàn hàng item (không chèn nhóm).
      if (!b || a.col !== b.col || !ctx.rangeOk(Number(r1), Number(r2))) { aborted = true; return m; }
      return `${a.col}${a.row}:${b.col}${b.row}`;
    }
    return `${a.col}${a.row}`;
  });
  if (aborted) return null;

  // Số kiểu VN: dấu thập phân "," → "."; rồi dấu tách đối số ";" → "," (chuẩn công thức Excel).
  // (editor chỉ dùng ";" tách đối số nên mọi "," còn lại đều là thập phân.)
  s = s.replace(/,/g, ".").replace(/;/g, ",");

  // Tên hàm: đổi bí danh (AVG→AVERAGE) + chỉ cho phép hàm an toàn; gặp hàm lạ → null.
  let bad = false;
  s = s.replace(/([A-Za-z]+)\s*\(/g, (m, name) => {
    const mapped = FN_ALIAS[name.toUpperCase()] || name.toUpperCase();
    if (!SAFE_FNS.has(mapped)) { bad = true; return m; }
    return `${mapped}(`;
  });
  if (bad) return null;

  // Chốt chặn: chỉ còn ký tự hợp lệ của công thức Excel.
  if (!/^[A-Za-z0-9.,:%+\-*/() ]+$/.test(s)) return null;
  return s;
}

function mapRef(ctx, colLetters, rowDigits) {
  const field = ctx.colToField[colLetters.toUpperCase()];
  if (!field || !ctx.allowedRef.has(field)) return null;   // ref chữ/_stt/cột không có → bỏ
  const col = ctx.fieldToCol[field];
  if (!col) return null;
  const row = ctx.rowToExcel(Number(rowDigits));
  if (row == null) return null;
  return { field, col, row };
}

/**
 * Dựng "bộ dịch công thức" cho MỘT sheet khi xuất Excel. Khép kín toàn bộ logic toạ độ
 * + tự kiểm để excel.js chỉ cần gọi `cellFormula(raw, computedValue)`.
 *
 * Tham số (lấy từ fillSheetData):
 *   cols       : itemsCfg.columns (field → cột Excel) của template
 *   items      : mảng item theo ĐÚNG THỨ TỰ EDITOR đã đánh số ref (TRƯỚC khi lọc dòng
 *                "info" của template CLF) — nên ref người dùng (row = index+1) khớp tuyệt đối.
 *   rowToExcel : (editorIndex0 : number) → hàng Excel của item ĐÓ nếu là ô tham chiếu được
 *                (item/sub đã đặt chỗ), ngược lại null. Tra theo ĐỊA CHỈ ĐỐI TƯỢNG item nên
 *                không lệ thuộc việc lọc/đổi chỉ số (xem cách dựng ở excel.js).
 */
export function buildFormulaContext({ cols, items, rowToExcel }) {
  const usesDays = !!cols.days;

  // Sơ đồ cột EDITOR (khớp ADDR_COLS): _stt, name, [detail], unit, quantity, [days],
  // unitPrice, _amount, notes. (internalNote là cột CUỐI, không xuất → không lệch chữ.)
  const editorFields = ["_stt", "name"];
  if (cols.detail) editorFields.push("detail");
  editorFields.push("unit", "quantity");
  if (usesDays) editorFields.push("days");
  editorFields.push("unitPrice", "_amount", "notes");

  const colToField = {};
  editorFields.forEach((f, i) => { colToField[colLetter(i)] = f; });
  const fieldToColIndex = {};
  editorFields.forEach((f, i) => { fieldToColIndex[f] = i; });

  const fieldToCol = { ...cols, _stt: cols.stt, _amount: cols.amount };
  // CHỈ cho tham chiếu các ô NHẬP LIỆU (Số Lượng / Đơn Giá / Số Ngày). KHÔNG cho tham
  // chiếu cột Thành Tiền (_amount): Thành Tiền = Đơn Giá × Số Lượng, nên một công thức ở
  // ô Đơn Giá/Số Lượng trỏ vào Thành Tiền sẽ tạo VÒNG LẶP (circular ref) trong Excel mà
  // bộ tự-kiểm tĩnh KHÔNG phát hiện được. Gặp ref như vậy → quay về ghi số (an toàn).
  const allowedRef = new Set(["quantity", "unitPrice", "days"]);

  const ctx = {
    colToField, fieldToCol, allowedRef,
    rowToExcel: (n) => rowToExcel(n - 1),
    rangeOk: (n1, n2) => {
      const a = Math.min(n1, n2) - 1, b = Math.max(n1, n2) - 1;
      let prev = null;
      for (let k = a; k <= b; k++) {
        const r = rowToExcel(k);              // section/info/blank/ngoài-bảng trong dải → bỏ
        if (r == null) return false;
        if (prev != null && r !== prev + 1) return false;   // không liền mạch trong Excel → bỏ
        prev = r;
      }
      return true;
    },
  };

  // Giá trị 1 ô theo HỆ TOẠ ĐỘ EDITOR (để tự kiểm) — mô phỏng cellNumByAddr ở frontend.
  const amountOf = (it) => {
    if (!it || it.kind === "section" || it.kind === "subsection" || it.kind === "info") return 0;
    const q = Number(it.quantity) || 0, p = Number(it.unitPrice) || 0;
    return usesDays ? q * (Number(it.days) || 1) * p : q * p;
  };
  const editorCellNum = (addr) => {
    const m = /^([A-Za-z]+)(\d+)$/.exec(String(addr).trim());
    if (!m) return 0;
    const field = colToField[m[1].toUpperCase()];
    const it = items[Number(m[2]) - 1];
    if (!field || !it) return 0;
    if (field === "_amount") return amountOf(it);
    if (field === "quantity" || field === "unitPrice" || field === "days") return Number(it[field]) || 0;
    return 0;   // _stt / cột chữ: không nằm trong công thức xuất được (allowedRef đã chặn)
  };
  const editorRefs = {
    cell: editorCellNum,
    range: (a, b) => {
      const pa = /^([A-Za-z]+)(\d+)$/.exec(a), pb = /^([A-Za-z]+)(\d+)$/.exec(b);
      if (!pa || !pb) return [];
      const c0 = Math.min(fieldToColIndex[colToField[pa[1].toUpperCase()]] ?? 0, fieldToColIndex[colToField[pb[1].toUpperCase()]] ?? 0);
      const c1 = Math.max(fieldToColIndex[colToField[pa[1].toUpperCase()]] ?? 0, fieldToColIndex[colToField[pb[1].toUpperCase()]] ?? 0);
      const r0 = Math.min(Number(pa[2]), Number(pb[2])), r1 = Math.max(Number(pa[2]), Number(pb[2]));
      const out = [];
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) out.push(editorCellNum(colLetter(c) + r));
      return out;
    },
  };

  return {
    /**
     * Trả công thức Excel cho ô có công thức gốc `raw` nếu DỊCH ĐƯỢC và TỰ KIỂM khớp
     * computedValue; ngược lại null (nơi gọi ghi số như cũ). Không cần biết chỉ số ô đang
     * ghi — ref trong công thức tự mang số hàng editor, dịch qua rowToExcel.
     */
    cellFormula(raw, computedValue) {
      if (!raw) return null;
      const ex = translateFormula(raw, ctx);
      if (!ex) return null;
      // Tự kiểm: công thức (theo hệ editor) phải cho ra đúng giá trị đã tính.
      const check = evalEditorFormula(raw, editorRefs);
      if (check == null || !isFinite(check)) return null;
      const target = Number(computedValue) || 0;
      if (Math.abs(check - target) > 1e-3 + 1e-6 * Math.max(Math.abs(check), Math.abs(target))) return null;
      return ex;
    },
    // Lộ ra cho test/soi.
    _ctx: ctx,
    _editorRefs: editorRefs,
  };
}
