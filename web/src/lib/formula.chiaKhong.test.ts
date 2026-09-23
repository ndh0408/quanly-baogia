// L36 — chia cho 0 ở GIỮA biểu thức ("=2/(1/0)", "=G3/(H3/D3)" khi D3 = 0): evalArith chỉ kiểm isFinite
// ở kết quả CUỐI, mà x/Infinity = 0 là số hữu hạn → lưới ra 0, ô không đỏ. Bộ tự kiểm lúc xuất cũng ra 0
// nên công thức được ghi vào tệp; Excel ra #DIV/0! ở Đơn giá rồi lan sang Thành tiền, Tổng, VAT.
// CÙNG bộ ca với tests/ct-chia-khong.test.js (bản sao phía máy chủ) — sửa thì sửa cả hai.
import { describe, it, expect } from "vitest";
import { evalFormula, evalArith, type FormulaRefs } from "./formula";

const O: Record<string, number> = { E1: 0, E2: 4, F2: 1000 };
const refs: FormulaRefs = { cell: (a) => O[a.replace(/\$/g, "")] ?? 0, range: () => null };

describe("L36 — chia cho 0 ở bất cứ đâu trong biểu thức → lỗi (ô đỏ)", () => {
  it.each([
    "=2/(1/0)",
    "=10/(E2/E1)",
    "=F2/(E2/E1)+5",
    "=-AVERAGE(1;2;3)+(1000-0)/(0,5/0)",
    "=5+1/(0*3)",
    "=E2/E1",
    "=SUM(1;2/(3/0))",
    "=ROUND(F2/(E1/E2);0)",
  ])("%s → null", (fx) => expect(evalFormula(fx, refs)).toBeNull());
  it("tràn số ở giữa (1/(A*A) với A 200 chữ số: A*A = ∞, 1/∞ = 0) cũng là lỗi — Excel #NUM!", () => {
    const A = "9".repeat(200);
    expect(evalArith(`1/(${A}*${A})`)).toBeNull();
  });
});

describe("L36 — phép chia hợp lệ không đổi", () => {
  it.each([
    ["=10/(4/2)", 5],
    ["=0/5", 0],
    ["=F2/E2", 250],
    ["=F2/(E2/2)", 500],
    ["=E1*5/2", 0],
    ["=1/3*3", 1],
  ])("%s = %s", (fx, kq) => expect(evalFormula(fx, refs)).toBeCloseTo(kq as number, 12));
});
