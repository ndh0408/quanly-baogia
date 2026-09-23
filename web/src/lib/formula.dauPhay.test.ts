// DẤU PHẨY TÁCH ĐỐI SỐ KIỂU EXCEL TIẾNG ANH — người dùng báo 2026-09-23 (production quote #47):
// ô Đơn giá "=ROUND(E2*63000,-3)" hiện 554.397 (đọc "," là dấu thập phân: 63000.-3) thay vì
// 554.000, và file Excel xuất ra mất công thức vì bước tự kiểm thấy lệch.
// CÙNG bộ ca với tests/quoteFormula-dauPhay.test.js (bản sao phía máy chủ) — sửa thì sửa cả hai.
import { describe, it, expect } from "vitest";
import { chuanHoaDauTachDoiSo, evalFormula } from "./formula";

const refs = { cell: (a: string) => ({ E2: 8.8, E3: 2, F3: 100 } as Record<string, number>)[a.replace(/\$/g, "")] ?? 0, range: () => [1, 2, 3] };

describe("chuanHoaDauTachDoiSo", () => {
  it.each([
    ["ROUND(E2*63000,-3)", "ROUND(E2*63000;-3)"],   // ca người dùng báo
    ["ROUND(E2*63000,0)", "ROUND(E2*63000;0)"],     // ROUND chỉ một dấu phẩy → luôn là tách đối số
    ["SUM(E2,E3)", "SUM(E2;E3)"],                   // sát ô tham chiếu
    ["MAX(E2, 5)", "MAX(E2; 5)"],
    ["ROUND(SUM(E2,E3)*1000,-2)", "ROUND(SUM(E2;E3)*1000;-2)"],
    ["E3*1,5", "E3*1,5"],                           // ngoài hàm: thập phân
    ["SUM(1,5)", "SUM(1,5)"],                       // hai chữ số: vẫn hiểu là 1,5 (quy ước Việt)
    ["ROUND(E2*1,5;0)", "ROUND(E2*1,5;0)"],         // đã có ";" → kiểu Việt, giữ nguyên
    ["(E2+E3)*1,5", "(E2+E3)*1,5"],
  ])("%s → %s", (vao, ra) => expect(chuanHoaDauTachDoiSo(vao)).toBe(ra));
});

describe("evalFormula với dấu phẩy kiểu Excel tiếng Anh", () => {
  it("=ROUND(E2*63000,-3) = 554.000 (trước: 554.397)", () => expect(evalFormula("=ROUND(E2*63000,-3)", refs)).toBe(554000));
  it("=ROUND(E2*63000;-3) kiểu Việt vẫn đúng", () => expect(evalFormula("=ROUND(E2*63000;-3)", refs)).toBe(554000));
  it("=E3*1,5 vẫn là 3", () => expect(evalFormula("=E3*1,5", refs)).toBe(3));
  it("=SUM(E2,E3) = 10,8", () => expect(evalFormula("=SUM(E2,E3)", refs)).toBeCloseTo(10.8));
});
