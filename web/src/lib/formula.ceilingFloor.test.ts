// L32 — CEILING/FLOOR bỏ qua đối số BỘI SỐ: "=CEILING(1234567;1000)" ra 1.234.567 (Excel 1.235.000), ô
// không đỏ; "=CEILING(1234567,1000)" kiểu Anh ra 1.234.568. Số sai đi vào tổng, PDF và tệp Excel.
// Nay tính đúng như Excel (bội số, số âm, bội số 0 / trái dấu → lỗi). Số kỳ vọng ĐO BẰNG EXCEL 16 THẬT.
// CÙNG bộ ca với tests/ct-ceiling-floor.test.js (bản sao phía máy chủ) — sửa thì sửa cả hai.
import { describe, it, expect } from "vitest";
import { evalFormula, type FormulaRefs } from "./formula";

const refs: FormulaRefs = { cell: (a) => (a === "F2" ? 1234567 : 0), range: () => null };

describe("L32 — CEILING/FLOOR(số; bội số) khớp Excel", () => {
  it.each([
    ["=CEILING(1234567;1000)", 1235000],
    ["=FLOOR(1234567;1000)", 1234000],
    ["=CEILING(F2;1000)", 1235000],
    ["=CEILING(-2,5;2)", -2],
    ["=CEILING(-2,5;-2)", -4],
    ["=FLOOR(-2,5;2)", -4],
    ["=FLOOR(-2,5;-2)", -2],
    ["=CEILING(-5;-2)", -6],
    ["=FLOOR(-5;-2)", -4],
    ["=CEILING(5;0)", 0],
    ["=FLOOR(0;0)", 0],
    ["=CEILING(0;-2)", 0],
    ["=CEILING(3000*1,1;100)", 3300],       // 3300,0000000000005 — bản chỉ chia rồi ceil ra 3.400
    ["=FLOOR(6000*1,15;100)", 6900],        // 6899,999999999999 → 6.900 như Excel
    ["=CEILING(-28990*2,675;100)", -77500],
    ["=FLOOR(3510*0,07;0,05)", 245.70000000000002],
    ["=CEILING(101900*0,95;1000)", 97000],
    ["=FLOOR(-58084*2,675;1000)", -156000],
    ["=FLOOR(-274*0,29;100)", -100],
    ["=CEILING(41041*0,35;0,1)", 14364.400000000001],
    ["=CEILING(-1400000*1,1;0,05)", -1540000],
    ["=FLOOR(-12,55*1,1;1000)", -1000],
    ["=CEILING(257*0,95;500)", 500],
  ])("%s = %s", (fx, kq) => expect(evalFormula(fx, refs)).toBeCloseTo(kq, 9));

  it.each([
    "=CEILING(2,5;-2)",          // Excel #NUM!
    "=FLOOR(2,5;-2)",            // Excel #NUM!
    "=FLOOR(5;0)",               // Excel #DIV/0!
    "=CEILING(1;2;3)",           // thừa đối số
    "=CEILING(1234567,1000)",    // kiểu Anh "số,số" — mơ hồ như ROUND (bản cũ ra 1.234.568 im lặng)
  ])("%s → null (ô đỏ)", (fx) => expect(evalFormula(fx, refs)).toBeNull());

  it("một đối số giữ nghĩa cũ (làm tròn tới số nguyên) — công thức đã lưu không đổi số", () => {
    expect(evalFormula("=CEILING(F2/3)", refs)).toBe(411523);
    expect(evalFormula("=FLOOR(F2/3)", refs)).toBe(411522);
    expect(evalFormula("=CEILING(-2.5)", refs)).toBe(-2);
    expect(evalFormula("=FLOOR(-2.5)", refs)).toBe(-3);
  });
});
