// L27 — ROUND/ROUNDUP/ROUNDDOWN/INT phải ra ĐÚNG số Excel ra. Bản cũ tính Math.ceil/round(x*10^d)
// trên double: =ROUNDUP(3000*1,1;-2) ra 3.400 (Excel 3.300), =ROUND(-52500;-3) ra -52.000 (Excel
// -53.000). Tệp xuất có fullCalcOnLoad nên Excel tính lại khi mở → Thành tiền/Tổng lệch app và PDF.
// Số kỳ vọng ĐO BẰNG EXCEL 16 THẬT qua COM (2026-09-24), không phải tự suy.
// CÙNG bộ ca với tests/ct-lam-tron-khop-excel.test.js (bản sao phía máy chủ) — sửa thì sửa cả hai.
import { describe, it, expect } from "vitest";
import { evalFormula } from "./formula";

// Công thức kiểu Việt (";" tách đối số, "," thập phân) → số Excel ra.
const CA_EXCEL: [string, number][] = [
  ["=ROUNDUP(3000*1,1;-2)", 3300],
  ["=ROUNDUP(100000*1,1;-3)", 110000],
  ["=ROUNDDOWN(6000*1,15;-2)", 6900],
  ["=ROUND(3000*1,15;-2)", 3500],
  ["=INT(4,35*100)", 435],
  ["=INT(-4,35*100)", -435],
  ["=ROUND(-52500;-3)", -53000],
  ["=ROUNDUP(-52100;-3)", -53000],
  ["=ROUNDDOWN(-52900;-3)", -52000],
  ["=ROUND(2,675;2)", 2.68],
  ["=ROUND(1,005;2)", 1.01],
  ["=ROUND(1234,5;1,7)", 1234.5],        // số chữ số lẻ bị cắt về 1
  ["=ROUND(1234,5678;-1,5)", 1230],
  ["=INT(-0,5)", -1],
  ["=ROUND(-0,5;0)", -1],
  ["=ROUND(-2,5;0)", -3],
  ["=ROUNDUP(-2,1;0)", -3],
  ["=ROUNDDOWN(-2,9;0)", -2],
  ["=INT(0,29*100)", 29],
  // Lô ngẫu nhiên đã đo bằng Excel — những ca bản cũ ra SAI.
  ["=ROUNDUP(-37193*0,3;-3)", -12000],
  ["=ROUNDUP(-4531000*0,29;-3)", -1314000],
  ["=ROUNDUP(940000*1,1;1)", 1034000],
  ["=ROUNDUP(431700*0,07;1)", 30219],
  ["=ROUNDUP(-54717*4,35;-1)", -238020],
  ["=INT(88000*4,35)", 382800],
  ["=INT(2514000*1,005)", 2526570],
  ["=INT(-23280*1,1)", -25608],
  ["=ROUND(-37190*0,85;0)", -31612],
  ["=ROUND(-31,95*0,3;2)", -9.59],
  ["=ROUND(-308700*1,05;-1)", -324140],
  ["=ROUNDDOWN(182000*1,005;1)", 182910],
  ["=ROUNDDOWN(13580*1,15;2)", 15617],
  ["=ROUNDDOWN(16263*0,95;2)", 15449.85],
  ["=ROUNDDOWN(4494*1,15;1)", 5168.1],
];

describe("L27 — làm tròn khớp Excel (15 chữ số có nghĩa, nửa đi xa số 0)", () => {
  it.each(CA_EXCEL)("%s = %s", (fx, excel) => expect(evalFormula(fx)).toBeCloseTo(excel, 9));

  it("ô tham chiếu: =ROUNDUP(F2*1,1;-2) với F2 = 2.625.000 → 2.887.500 (bản cũ 2.887.600)", () => {
    const refs = { cell: (a: string) => (a === "F2" ? 2625000 : 0), range: () => null };
    expect(evalFormula("=ROUNDUP(F2*1,1;-2)", refs)).toBe(2887500);
  });

  it("không trả -0 khi làm tròn số âm nhỏ về 0", () => {
    expect(Object.is(evalFormula("=ROUND(-0,4;0)"), 0)).toBe(true);
    expect(Object.is(evalFormula("=ROUNDDOWN(-0,9;0)"), 0)).toBe(true);
  });

  it("số chữ số lẻ rất lớn / rất âm vẫn ra đúng số Excel", () => {
    expect(evalFormula("=ROUND(1,23;400)")).toBe(1.23);
    expect(evalFormula("=ROUND(1,23;20)")).toBe(1.23);
    expect(evalFormula("=ROUNDUP(5;-20)")).toBe(1e20);
  });
});
