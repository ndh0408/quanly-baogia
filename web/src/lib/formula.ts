// Port THUẦN máy tính công thức Excel từ public/js/editor.js (evalArith + evalFormula + FORMULA_FNS).
// Hỗ trợ số học + ( ) + × + phần trăm (8%→0.08) + hàm SUM/AVERAGE/AVG/PRODUCT/MIN/MAX/ROUND/
// ROUNDUP/ROUNDDOWN/INT/ABS/CEILING/FLOOR. Tham số ngăn bởi ";" (Excel VN); "," = dấu thập phân.
// refs (chỉ lưới cấp): resolve "G3"/"H3:H8" về số. Vắng refs = hành vi cũ (export/test).

export type FormulaRefs = { cell: (a: string) => number; range: (a: string, b: string) => number[] | null };

export function evalArith(input: string | number): number | null {
  // Khoảng trắng KẸP GIỮA hai phần của một số ("1 000 000", "100, 0", "1 .5", hai ô dính nhau
  // "58000 57000") là LỖI cú pháp — Excel coi dấu cách giữa hai toán hạng là toán tử giao vùng. Bản cũ
  // xoá sạch khoảng trắng nên lưới vẫn ra số, ô không đỏ, còn tệp xuất chứa đúng chuỗi đó và Excel từ
  // chối mở CẢ tệp (L28). Khoảng trắng quanh toán tử/ngoặc vẫn được bỏ như cũ.
  if (/[\d.,]\s+[\d.,]/.test(String(input))) return null;
  const s = String(input).replace(/,/g, ".").replace(/\s+/g, "");
  if (!s || !/^[-+*/().0-9]+$/.test(s)) return null;
  let pos = 0;
  const peek = () => s[pos];
  function expr(): number | null {
    let v = term();
    while (peek() === "+" || peek() === "-") { const op = s[pos++]; const r = term(); if (v === null || r === null) return null; v = op === "+" ? v + r : v - r; }
    return v;
  }
  function term(): number | null {
    let v = factor();
    while (peek() === "*" || peek() === "/") { const op = s[pos++]; const r = factor(); if (v === null || r === null) return null; v = op === "*" ? v * r : v / r; }
    return v;
  }
  function factor(): number | null {
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

/**
 * LÀM TRÒN KIỂU EXCEL (ROUND / ROUNDUP / ROUNDDOWN / INT).
 *
 * Bản cũ tính thẳng Math.round/ceil/trunc(x * 10^d) trên double nên dính sai số dấu phẩy động:
 * 3000*1,1 = 3300,0000000000005 → ROUNDUP(…;-2) ra 3.400; 6000*1,15 = 6899,999999999999 →
 * ROUNDDOWN(…;-2) ra 6.800; 4,35*100 = 434,99999999999994 → INT ra 434. Excel ra 3.300 / 6.900 / 435
 * vì nó làm tròn toán hạng về 15 CHỮ SỐ CÓ NGHĨA trước. Thêm nữa Math.round đẩy nửa về phía +∞ nên
 * ROUND(-52500;-3) ra -52.000, Excel đi XA SỐ 0 → -53.000. Tệp xuất có fullCalcOnLoad nên Excel tính
 * lại khi mở: Thành tiền/Tổng trong Excel lệch app/PDF mà bước tự kiểm không bắt được (cùng bộ tính).
 *
 * Cách làm: chuẩn hoá về 15 chữ số, làm tròn TRỊ TUYỆT ĐỐI rồi trả dấu (ROUND nửa đi xa số 0,
 * ROUNDUP xa số 0, ROUNDDOWN về phía 0 — đúng Excel), và dịch dấu phẩy bằng số mũ thập phân ("e")
 * chứ không nhân 10^d. Số chữ số lẻ bị CẮT về số nguyên như Excel (ROUND(x;1,7) = ROUND(x;1)).
 * Đối chiếu Excel 16 thật qua COM: 3.010 ca (gồm CEILING/FLOOR) khớp hết, bản cũ lệch 1.323.
 * BẢN SAO: web/src/lib/formula.ts ↔ src/quoteFormula.ts — sửa thì sửa CẢ HAI.
 */
const so15 = (x: number) => Number(x.toPrecision(15));
/** x × 10^d bằng số mũ thập phân — không qua phép nhân double ("2.675e2" = 267,5 đúng tuyệt đối). */
const dichThapPhan = (x: number, d: number) => { const [m, e] = String(x).split("e"); return Number(m + "e" + (Number(e || 0) + d)); };
function lamTronExcel(x: number, soChuSo: number, kieu: "tron" | "len" | "xuong"): number {
  const n = so15(x), d = Math.trunc(soChuSo);
  if (!isFinite(n) || !isFinite(d)) return NaN;
  const v = dichThapPhan(Math.abs(n), d);
  if (!isFinite(v)) return n;   // số chữ số lẻ quá lớn: không còn gì để làm tròn
  const r = kieu === "tron" ? Math.round(v) : kieu === "len" ? Math.ceil(v) : Math.floor(v);
  const kq = Math.sign(n) * dichThapPhan(r, -d);
  return kq === 0 ? 0 : kq;     // không để lọt -0
}

const FORMULA_FNS: Record<string, (a: number[]) => number> = {
  SUM: (a) => a.reduce((x, y) => x + y, 0),
  PRODUCT: (a) => a.reduce((x, y) => x * y, 1),
  AVERAGE: (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0),
  AVG: (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0),
  MIN: (a) => (a.length ? Math.min(...a) : 0),
  MAX: (a) => (a.length ? Math.max(...a) : 0),
  ROUND: (a) => lamTronExcel(a[0] || 0, a[1] || 0, "tron"),
  ROUNDUP: (a) => lamTronExcel(a[0] || 0, a[1] || 0, "len"),
  ROUNDDOWN: (a) => lamTronExcel(a[0] || 0, a[1] || 0, "xuong"),
  INT: (a) => Math.floor(so15(a[0] || 0)),
  ABS: (a) => Math.abs(a[0] || 0),
  CEILING: (a) => Math.ceil(a[0] || 0),
  FLOOR: (a) => Math.floor(a[0] || 0),
};

/**
 * DẤU PHẨY TÁCH ĐỐI SỐ KIỂU EXCEL TIẾNG ANH → ";" (quy ước của app).
 *
 * App theo Excel tiếng Việt: ";" tách đối số, "," là dấu thập phân. Nhưng người dùng chép công
 * thức từ Excel tiếng Anh: "=ROUND(E2*63000,-3)" bị đọc thành ROUND(E2*63000.-3) = 554.397 thay
 * vì 554.000, rồi lúc xuất Excel bước tự kiểm thấy lệch nên BỎ công thức, chỉ ghi số (người dùng
 * báo 2026-09-23, production quote #47).
 *
 * Chỉ đổi dấu phẩy nằm NGAY TRONG danh sách đối số của một HÀM, và chỉ khi nó KHÔNG THỂ là dấu
 * thập phân: sát ô tham chiếu / dấu âm / ngoặc / chữ ("E2,E3", ",-3"), hoặc là dấu phẩy DUY NHẤT
 * của ROUND/ROUNDUP/ROUNDDOWN (Excel bắt buộc hai đối số). Công thức đã có ";" là kiểu Việt → giữ
 * nguyên; "," ngoài hàm ("=E3*1,5") vẫn là thập phân.
 * BẢN SAO: web/src/lib/formula.ts ↔ src/quoteFormula.ts — sửa quy tắc thì sửa CẢ HAI.
 */
export function chuanHoaDauTachDoiSo(s: string): string {
  if (s.includes(";") || !s.includes(",")) return s;
  const out = s.split("");
  const khung: { fn: string | null; phay: number[] }[] = [];
  const quyet = (k: { fn: string | null; phay: number[] }) => {
    if (!k.fn || !k.phay.length) return;
    const batHai = /^ROUND(UP|DOWN)?$/.test(k.fn) && k.phay.length === 1;
    for (const i of k.phay) {
      const truoc = s.slice(0, i).replace(/\s+$/, ""), sau = s.slice(i + 1).replace(/^\s+/, "");
      const soTruoc = /\d$/.test(truoc) && !/[A-Za-z]\$?\d+$/.test(truoc);   // chữ số KHÔNG thuộc ô tham chiếu
      const soSau = /^\d/.test(sau);
      if (batHai || !(soTruoc && soSau)) out[i] = ";";
    }
  };
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "(") { const m = /([A-Za-z]+)\s*$/.exec(s.slice(0, i)); khung.push({ fn: m ? m[1].toUpperCase() : null, phay: [] }); }
    else if (ch === ")") { const k = khung.pop(); if (k) quyet(k); }
    else if (ch === "," && khung.length) khung[khung.length - 1].phay.push(i);
  }
  return out.join("");
}

export function evalFormula(input: string, refs?: FormulaRefs): number | null {
  let s = String(input).trim().replace(/^=/, "");
  if (!s) return null;
  s = chuanHoaDauTachDoiSo(s);
  s = s.replace(/×/g, "*").replace(/(\d)\s*[xX]\s*(?=\d)/g, "$1*");
  if (refs) {
    // Dấu "," tách đối số ("=SUM(E1,E2)", "=ROUND(G3,2)") đã được chuanHoaDauTachDoiSo ở trên đổi
    // thành ";" — CÙNG một hàm với src/quoteFormula.ts, để bước tự kiểm lúc xuất Excel (so số máy chủ
    // với số web đã lưu) không lệch. Đừng thêm luật dấu phẩy riêng ở đây mà không thêm ở máy chủ.
    // $ chỉ có ý nghĩa lúc COPY/DÁN (khoá không cho dịch); khi TÍNH thì bỏ qua, y như Excel.
    s = s.replace(/(\$?[A-Za-z]+\$?\d+)\s*:\s*(\$?[A-Za-z]+\$?\d+)/g, (_m, a, b) => { const list = refs.range(a, b); return list && list.length ? list.join(";") : "0"; });
    s = s.replace(/(?<![A-Za-z0-9_.$])(\$?[A-Za-z]+\$?\d+)/g, (_m, a) => { const v = refs.cell(a); return v === null || v === undefined || isNaN(v) ? "0" : String(v); });
  }
  s = s.replace(/(\d+(?:[.,]\d+)?)\s*%/g, (_m, n) => String(Number(String(n).replace(",", ".")) / 100));
  let guard = 0;
  while (/[A-Za-z]+\s*\(/.test(s)) {
    if (guard++ > 100) return null;
    let changed = false;
    s = s.replace(/([A-Za-z]+)\s*\(([^()]*)\)/, (_m, name, args) => {
      changed = true;
      const fn = FORMULA_FNS[String(name).toUpperCase()];
      if (!fn) return "NaN";
      // Đối số KHÔNG đọc được (vd "123.45,2") → cả công thức lỗi, không lọc bỏ im lặng rồi tính tiếp
      // trên phần còn lại (GRID-03: =ROUND(G3,2) từng ra 0 mà ô không đỏ). Đối số rỗng ("SUM()") bỏ qua.
      let hong = false;
      const vals = String(args).split(";").filter((a) => a.trim() !== "").map((a) => evalArith(a)).filter((v): v is number => { if (v === null || !isFinite(v)) { hong = true; return false; } return true; });
      if (hong) return "NaN";
      const r = fn(vals);
      return r === null || !isFinite(r) ? "NaN" : String(r);
    });
    if (!changed) return null;
  }
  return evalArith(s);
}
