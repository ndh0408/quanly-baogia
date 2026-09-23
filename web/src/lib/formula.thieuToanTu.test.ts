// L37 — gõ THIẾU toán tử giữa số và hàm: "=2SUM(F2;F3)". Kết quả hàm được thay vào chuỗi bằng String(r)
// nên dính liền vào chữ số đứng cạnh: "2" + "1113000" = 21.113.000, ô không đỏ. "=SUM(F2)SUM(F3)" ra
// 105.000.063.000. Tệp xuất ghi nguyên "2SUM(G12,G13)" — Excel không mở được tệp (đo bằng Excel COM).
// Nay kết quả hàm được bọc ngoặc "(1113000)" → "2(1113000)" là lỗi cú pháp → ô đỏ, như Excel.
// CÙNG bộ ca với tests/ct-thieu-toan-tu.test.js (bản sao phía máy chủ) — sửa thì sửa cả hai.
import { describe, it, expect } from "vitest";
import { evalFormula, type FormulaRefs } from "./formula";

const O: Record<string, number> = { F2: 1050000, F3: 63000, F4: -5 };
const refs: FormulaRefs = { cell: (a) => O[a.replace(/\$/g, "")] ?? 0, range: () => null };

describe("L37 — số / hàm dính nhau không có toán tử → lỗi", () => {
  it.each(["=2SUM(F2;F3)", "=SUM(F2)SUM(F3)", "=1,1SUM(F2;F3)", "=MAX(1;2)MAX(3;4)", "=SUM(1;2)(3)", "=2(F2)", "=ROUND(F2;-3)5"])(
    "%s → null (bản cũ ghép chữ số)", (fx) => expect(evalFormula(fx, refs)).toBeNull());
});

describe("L37 — kết quả hàm bọc ngoặc không đổi nghĩa công thức hợp lệ", () => {
  it.each([
    ["=2*SUM(F2;F3)", 2226000],
    ["=-SUM(1;2)", -3],
    ["=SUM(1;2)-SUM(3;4)", -4],
    ["=10/SUM(2;3)", 2],
    ["=ROUND(F2;-3)*1,1", 1155000],
    ["=ABS(F4)*2", 10],
    ["=ROUND(SUM(F2;F3)*1,1;-3)", 1224000],
    ["=SUM(F4;1)*-2", 8],
  ])("%s = %s", (fx, kq) => expect(evalFormula(fx, refs)).toBeCloseTo(kq as number, 9));
});
