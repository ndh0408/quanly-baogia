// PHÁT HIỆN THÊM khi đối chiếu 2.676 công thức ngẫu nhiên với Excel 16 thật (sau L27–L37): 127 ca app ra
// SỐ mà Excel ra #VALUE! — tất cả đều là DẢI ô đặt vào chỗ chỉ nhận MỘT giá trị: "=ABS(F1:F3)",
// "=INT(F2:F6)", "=ROUND(F1:F3;0)". Bộ tính bung dải thành "a;b;c" rồi hàm một đối số lấy a[0] (ROUND
// còn lấy b làm số chữ số lẻ!) → ra số; bộ tự kiểm máy chủ tính y vậy nên tệp ghi công thức sống; Excel
// mở ra #VALUE! lan xuống Thành tiền, Tổng. Dải nằm TRONG phép tính ("=SUM(F1:F3*2)") còn bị ghép thành
// SUM(a; b; c*2). Nay: dải phải là NGUYÊN một đối số, và hàm một giá trị nhận đúng số đối số của nó.
// CÙNG bộ ca với tests/ct-dai-sai-cho.test.js (bản sao phía máy chủ) — sửa thì sửa cả hai.
import { describe, it, expect } from "vitest";
import { evalFormula, type FormulaRefs } from "./formula";

const O: Record<string, number> = { F1: 100, F2: -200, F3: 300, E2: 2 };
const refs: FormulaRefs = {
  cell: (a) => O[a.replace(/\$/g, "")] ?? 0,
  range: (a, b) => { const r0 = Number(a.replace(/\D/g, "")), r1 = Number(b.replace(/\D/g, "")); const out: number[] = []; for (let r = Math.min(r0, r1); r <= Math.max(r0, r1); r++) out.push(O[a.replace(/[\d$]/g, "") + r] ?? 0); return out; },
};

describe("dải ô ở chỗ chỉ nhận một giá trị → lỗi (Excel #VALUE!)", () => {
  it.each([
    "=ABS(F1:F3)", "=INT(F1:F3)", "=ROUND(F1:F3;0)", "=ROUNDUP(F1:F2;-2)", "=CEILING(F1:F3;100)",
    "=SUM(F1:F3*2)", "=SUM(-F1:F3)", "=MAX(F1:F3+1;0)", "=F1:F3*2",
    "=ROUND(1;2;3)", "=INT(1;2)", "=ABS(1;2)",
  ])("%s → null", (fx) => expect(evalFormula(fx, refs)).toBeNull());
});

describe("dải đúng chỗ (nguyên một đối số) vẫn tính như cũ", () => {
  it.each([
    ["=SUM(F1:F3)", 200],
    ["=SUM(F1:F3)*2", 400],
    ["=ROUND(SUM(F1:F3)*1,1;-2)", 200],
    ["=MAX(F1:F3;0)", 300],
    ["=MIN(0;F1:F3)", -200],
    ["=SUM(F1:F2;F3)", 200],
    ["=AVERAGE( F1:F3 )", 66.66666666666667],
    ["=ABS(F2:F2)", 200],             // dải MỘT ô: Excel vẫn nhận
    ["=ROUND(E2*2)", 4],              // ROUND một đối số của app cũ vẫn tính (xuất Excel thì ghi số)
  ])("%s = %s", (fx, kq) => expect(evalFormula(fx, refs)).toBeCloseTo(kq as number, 9));
});
