// L31 — hàm có NGOẶC TRÒN THƯỜNG trong đối số: "=ROUND(F1*(1+8%);0)", "=MAX((F2-F3);0)". Vòng rút gọn
// hàm cũ dùng regex ([A-Za-z]+)\s*\(([^()]*)\) — chỉ khớp lời gọi KHÔNG có ngoặc nào bên trong — nên
// không rút được gì và trả null: lưới báo "Công thức không tính được", Đơn giá = 0. Đây là mẫu tính
// giá rất hay dùng (giá × (1 + VAT)). Nhập tệp Excel có công thức dạng này cũng mất công thức.
// CÙNG bộ ca với tests/ct-ngoac-trong-ham.test.js (bản sao phía máy chủ) — sửa thì sửa cả hai.
import { describe, it, expect } from "vitest";
import { evalFormula, type FormulaRefs } from "./formula";

const O: Record<string, number> = { F1: 1050000, F2: 58000, F3: 57000 };
const refs: FormulaRefs = { cell: (a) => O[a.replace(/\$/g, "")] ?? 0, range: () => null };

describe("L31 — ngoặc thường trong đối số hàm", () => {
  it.each([
    ["=ROUND(F1*(1+8%);0)", 1134000],
    ["=ROUND((F1+100000)*1,1;-3)", 1265000],
    ["=MAX((F2-F3);0)", 1000],
    ["=ROUND(F2/(1+10%);0)", 52727],
    ["=ROUND(F1*(1+8%),0)", 1134000],                 // dấu phẩy kiểu Anh sau ")"
    ["=INT((0,1+0,7)*10)", 8],                        // Excel 16: 8
    ["=SUM(((1)))", 1],
    ["=ROUND(SUM((F2+F3)*2;F1)*(1+10%);-3)", 1408000],
    ["=ABS(-(F2-F3))", 1000],
    ["=MIN((F2);(F3))", 57000],
  ])("%s = %s", (fx, kq) => expect(evalFormula(fx, refs)).toBeCloseTo(kq, 9));

  it.each([
    "=SUM((1;2))",                // ";" trong ngoặc thường không phải đối số → lỗi
    "=ROUND(F1*(1+8%;0)",         // thiếu ngoặc đóng
    "=ROUND(F1*(1+8%));0)",       // thừa ngoặc đóng
    "=TONG((1+2))",               // hàm lạ
  ])("%s → null", (fx) => expect(evalFormula(fx, refs)).toBeNull());
});
