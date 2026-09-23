// Port THUẦN máy tính công thức Excel từ public/js/editor.js (evalArith + evalFormula + FORMULA_FNS).
// Hỗ trợ số học + ( ) + × + phần trăm (8%→0.08) + hàm SUM/AVERAGE/AVG/PRODUCT/MIN/MAX/ROUND/
// ROUNDUP/ROUNDDOWN/INT/ABS/CEILING/FLOOR. Tham số ngăn bởi ";" (Excel VN); "," = dấu thập phân.
// refs (chỉ lưới cấp): resolve "G3"/"H3:H8" về số. Vắng refs = hành vi cũ (export/test).

export type FormulaRefs = { cell: (a: string) => number; range: (a: string, b: string) => number[] | null };

export function evalArith(input: string | number): number | null {
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

const FORMULA_FNS: Record<string, (a: number[]) => number> = {
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

export function evalFormula(input: string, refs?: FormulaRefs): number | null {
  let s = String(input).trim().replace(/^=/, "");
  if (!s) return null;
  s = s.replace(/×/g, "*").replace(/(\d)\s*[xX]\s*(?=\d)/g, "$1*");
  if (refs) {
    // DẤU PHẨY CẠNH MỘT THAM CHIẾU Ô LÀ DẤU TÁCH ĐỐI SỐ (GRID-03). Excel ở máy đặt vùng US tách đối số
    // bằng ",", người dùng gõ theo thói quen: "=SUM(E1,E2)". Bản cũ thay ref thành số TRƯỚC rồi mới
    // đọc "," là dấu thập phân → "SUM(100000,250000)" = 100000,25 (đúng phải 350000); "=ROUND(G3,2)"
    // → "123.45,2" không đọc được → đối số bị lọc bỏ → 0, im lặng. Dấu thập phân không bao giờ đứng
    // sát một chữ cái, nên "," ngay sau hoặc ngay trước một ô/dải là tách đối số, không mơ hồ.
    // "=E3*1,1" (thập phân giữa hai CHỮ SỐ) không bị đụng.
    s = s.replace(/(\$?[A-Za-z]+\$?\d+)\s*,/g, "$1;").replace(/,\s*(?=\$?[A-Za-z]+\$?\d+)/g, ";");
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
