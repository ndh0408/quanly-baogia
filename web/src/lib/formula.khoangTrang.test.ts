// L28 — khoảng trắng KẸP GIỮA hai phần của số ("=1 000 000*8%", "=MAX(F1-100, 0)") bị evalArith xoá
// sạch rồi tính như không có gì: lưới ra 80.000 / 57.900, ô không đỏ. Lúc xuất, tệp ghi nguyên
// "1 000 000*8%" / "MAX(G13-100. 0)" — Excel đọc khoảng trắng là toán tử GIAO VÙNG nên từ chối mở
// CẢ tệp báo giá. Nay ô ĐỎ (null) như Excel báo lỗi cú pháp; khoảng trắng quanh toán tử vẫn được.
// CÙNG bộ ca với tests/ct-khoang-trang-giua-so.test.js (bản sao phía máy chủ) — sửa thì sửa cả hai.
import { describe, it, expect } from "vitest";
import { evalFormula, evalArith, type FormulaRefs } from "./formula";

const O: Record<string, number> = { E2: 2, F1: 58000, F2: 57000 };
const refs: FormulaRefs = { cell: (a) => O[a.replace(/\$/g, "")] ?? 0, range: () => null };

describe("L28 — khoảng trắng giữa hai chữ số là LỖI (ô đỏ), không bị nuốt", () => {
  it.each([
    "=1 000 000*8%",
    "=MAX(F1-100, 0)",
    "=SUM(E2*1, 5)",
    "=SUM(F1*1 ,5)",
    "=F1*1 ,5",
    "=F1*1 .5",
    "=F1 F2",                // hai ô dính nhau qua dấu cách: Excel hiểu là giao vùng → #NULL!
    "=MIN(F1*1000, 500000)",
  ])("%s → null", (fx) => expect(evalFormula(fx, refs)).toBeNull());
  it("evalArith trực tiếp", () => {
    expect(evalArith("1 000")).toBeNull();
    expect(evalArith("1, 5")).toBeNull();
  });
});

describe("L28 — khoảng trắng hợp lệ (quanh toán tử, ngoặc, dấu ;) vẫn tính như cũ", () => {
  it.each([
    ["=F1 * 2", 116000],
    ["= 1000000 * 8 %", 80000],
    ["=SUM(1; 2)", 3],
    ["=ROUND( F1*1,1 ; -3 )", 64000],
    ["=SUM( F1 ; F2 )", 115000],
    ["=( F1 + F2 ) / 5", 23000],
    ["=MAX(E2, 5)", 5],
  ])("%s = %s", (fx, kq) => expect(evalFormula(fx, refs)).toBeCloseTo(kq as number, 9));
});
