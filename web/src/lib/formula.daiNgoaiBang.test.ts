// L33 — dải VƯỢT số hàng của bảng ("=SUM(F1:F50)" trên bảng 4 hàng) ra 0 mà không báo. Lưới (GridTable)
// trả null cho dải có một đầu ngoài bảng và evalFormula thay CẢ dải bằng "0"; trong khi ô đơn ngoài bảng
// lại là 0 như ô trống Excel (=F1+F9 vẫn ra đúng). Excel và ý người dùng là 115.000; máy chủ (bộ tự kiểm)
// cũng ra 115.000 → web ≠ máy chủ. Nay: bộ giải dải trả null thì evalFormula tự bung dải qua refs.cell
// (ô ngoài bảng = 0, đúng Excel), có trần số ô như máy chủ.
// CÙNG bộ ca với tests/ct-dai-ngoai-bang.test.js (đối chiếu với bộ tự kiểm phía máy chủ).
import { describe, it, expect } from "vitest";
import { evalFormula, type FormulaRefs } from "./formula";

// Mô phỏng ĐÚNG hành vi GridTable: 4 hàng; cột D=Số lượng, F=Đơn giá; range trả null khi một đầu dải
// nằm ngoài bảng hoặc cột lạ; cell ngoài bảng = 0.
const BANG: Record<string, number>[] = [{ D: 1, F: 58000 }, { D: 2, F: 57000 }, { D: 3, F: 0 }, { D: 4, F: 0 }];
const COT = ["A", "B", "C", "D", "E", "F", "G", "H"];
const tach = (a: string) => { const m = /^\$?([A-Za-z]+)\$?(\d+)$/.exec(a); return m ? { L: m[1].toUpperCase(), r: Number(m[2]) - 1 } : null; };
const trongBang = (p: { L: string; r: number } | null) => !!p && COT.includes(p.L) && p.r >= 0 && p.r < BANG.length;
let soLanGoiO = 0;
const refs: FormulaRefs = {
  cell: (a) => { soLanGoiO++; const p = tach(a); return p && trongBang(p) ? BANG[p.r][p.L] ?? 0 : 0; },
  range: (a, b) => {
    const pa = tach(a), pb = tach(b);
    if (!trongBang(pa) || !trongBang(pb)) return null;
    const out: number[] = [];
    for (let r = Math.min(pa!.r, pb!.r); r <= Math.max(pa!.r, pb!.r); r++) out.push(BANG[r][pa!.L] ?? 0);
    return out;
  },
};

describe("L33 — dải có đầu nằm ngoài bảng", () => {
  it.each([
    ["=SUM(F1:F50)", 115000],      // bản cũ 0
    ["=SUM(F1:F5)", 115000],
    ["=SUM(F50:F1)", 115000],
    ["=SUM(F3:F9)", 0],
    ["=SUM(D1:F9)", 115010],       // dải nhiều cột: D1..D4 (10) + E (0) + F (115.000)
    ["=AVERAGE(F1:F4)", 28750],    // dải nằm gọn trong bảng: như cũ
    ["=SUM(F1:F3)", 115000],
    ["=F1+F9", 58000],
  ])("%s = %s", (fx, kq) => expect(evalFormula(fx, refs)).toBe(kq));

  it("dải khổng lồ (vượt trần 20.000 ô như máy chủ) → null, không bung ra bộ nhớ", () => {
    soLanGoiO = 0;
    expect(evalFormula("=SUM(F1:F4000000)", refs)).toBeNull();
    expect(soLanGoiO).toBe(0);
  });
});
