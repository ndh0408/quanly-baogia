// L29 / L30 / L34 — dấu phẩy "," trong công thức: tách đối số (kiểu Excel tiếng Anh) hay thập phân
// (kiểu Việt)? Ba lỗi cùng nằm ở chuanHoaDauTachDoiSo:
//   L29: công thức có ";" thì bị bỏ qua CẢ công thức → "=ROUND(SUM(F1,F2);-3)" đọc "F1,F2" thành số
//        58000,57 → lưới 58.000, Excel (đọc "G13.G14" là dải) 115.000.
//   L30: ROUND chỉ một dấu phẩy "số,số" luôn bị coi là tách đối số → công thức ĐÃ LƯU "=ROUND(F1*0,5)"
//        (525.000 theo app cũ) thành ROUND(0;5) = 0 khi lưới tính lại; "2x1,5" có "x1" bị coi là ô.
//   L34: "=MIN(F2*1000,500000)" chép từ Excel tiếng Anh bị đọc F2*1000,5 → 1.050.525.000, không đỏ.
// Ca mơ hồ thật → null (ô đỏ / giữ số đã lưu), KHÔNG đoán một con số.
// CÙNG bộ ca với tests/ct-dau-phay-mo-ho.test.js (bản sao phía máy chủ) — sửa thì sửa cả hai.
import { describe, it, expect } from "vitest";
import { chuanHoaDauTachDoiSo, evalFormula, type FormulaRefs } from "./formula";

const O: Record<string, number> = { E2: 8.8, F1: 58000, F2: 57000, F3: 1050000, G3: 1234.5 };
const refs: FormulaRefs = { cell: (a) => O[a.replace(/\$/g, "").toUpperCase()] ?? 0, range: () => null };
const tinh = (fx: string) => evalFormula(fx, refs);

describe("chuanHoaDauTachDoiSo — luật mới", () => {
  it.each([
    ["ROUND(SUM(F1,F2);-3)", "ROUND(SUM(F1;F2);-3)"],   // L29: có ";" vẫn đổi dấu phẩy sát ô tham chiếu
    ["SUM(F1,F2;100)", "SUM(F1;F2;100)"],
    ["ROUND(E2*1,5;0)", "ROUND(E2*1,5;0)"],             // kiểu Việt: "1,5" vẫn là thập phân
    ["ROUND(E2*63000,-3)", "ROUND(E2*63000;-3)"],
    ["ROUND(E2*63000,0)", "ROUND(E2*63000;0)"],         // "…,0)": hai cách đọc cùng một số
    ["ROUND(F1*1,1,-3)", "ROUND(F1*1,1;-3)"],           // đã có một dấu tách chắc chắn → còn lại là thập phân
    ["SUM(1,5)", "SUM(1,5)"],
    ["INT(F3*1,5)", "INT(F3*1,5)"],
    ["E3*1,5", "E3*1,5"],
    ["ROUND(F1*0,5)", null],                            // L30: mơ hồ
    ["ROUND(1,5*2)", null],
    ["MIN(F2*1000,500000)", null],                      // L34: kiểu Anh rõ ràng
    ["PRODUCT(-500000,20%)", null],
    ["SUM(F1,F2*1,5)", null],                           // L34: đã có dấu phẩy khác bị đổi → kiểu Anh
    ["F1,5", null],                                     // L29: dấu phẩy/chấm dính ô tham chiếu
    ["F1.5", null],
    ["(F1,F2)", null],
  ])("%s → %s", (vao, ra) => expect(chuanHoaDauTachDoiSo(vao)).toBe(ra));
});

describe("L29 — dấu phẩy trong hàm con + ';' ở ngoài", () => {
  it("=ROUND(SUM(F1,F2);-3) = 115.000 (bản cũ 58.000)", () => expect(tinh("=ROUND(SUM(F1,F2);-3)")).toBe(115000));
  it("=SUM(F1,F2;100) = 115.100", () => expect(tinh("=SUM(F1,F2;100)")).toBe(115100));
  it.each(["=F1,5", "=F1.5", "=(F1,F2)", "=SUM((F1,F2))", "=F1,F2"])("%s → null (bản cũ ghép thành một số)", (fx) => expect(tinh(fx)).toBeNull());
  it("kiểu Việt không đổi: =F1*1,5 = 87.000; =ROUND(SUM(F1;F2)*1,1;-3) = 127.000", () => {
    expect(tinh("=F1*1,5")).toBe(87000);
    expect(tinh("=ROUND(SUM(F1;F2)*1,1;-3)")).toBe(127000);
  });
});

describe("L30 — công thức kiểu Việt ĐÃ LƯU không bị âm thầm đổi nghĩa", () => {
  it.each(["=ROUND(F3*0,5)", "=ROUNDDOWN(F3*0,9)", "=ROUND(F3*1,1)", "=ROUNDUP(F3*1,15)", "=ROUND(1,5*2)"])(
    "%s → null (mơ hồ: không ra 0 / 1.050.000 im lặng)", (fx) => expect(tinh(fx)).toBeNull());
  it("'x' nhân trước số thập phân: =SUM(2x1,5) = 3, =INT(3x1,5) = 4, =2x1,5 = 3", () => {
    expect(tinh("=SUM(2x1,5)")).toBe(3);
    expect(tinh("=INT(3x1,5)")).toBe(4);
    expect(tinh("=2x1,5")).toBe(3);
  });
  it("cách viết không mơ hồ vẫn tính đúng", () => {
    expect(tinh("=ROUND(F3*0,5;0)")).toBe(525000);
    expect(tinh("=ROUND(E2*63000,-3)")).toBe(554000);
    expect(tinh("=ROUND(E2*63000,0)")).toBe(554400);
    expect(tinh("=ROUND(F1*1,1,-3)")).toBe(64000);
    expect(tinh("=ROUND(G3,0)")).toBe(1235);
  });
});

describe("L34 — dấu phẩy kiểu Anh giữa hai chữ số trong hàm nhiều đối số", () => {
  it.each(["=MIN(F3*1000,500000)", "=PRODUCT(-500000,20%)", "=INT(-MAX(63000,1000))", "=SUM(2*F3/2,500000)", "=INT(SUM(PRODUCT(63000,63000)))", "=SUM(F1,F3*1,5)"])(
    "%s → null (bản cũ đọc thành số thập phân)", (fx) => expect(tinh(fx)).toBeNull());
  it("quy ước Việt vẫn giữ: =SUM(1,5) = 1,5; =SUM(F3*1,5) = 1.575.000; =MAX(F3*1,15;0) = 1.207.500", () => {
    expect(tinh("=SUM(1,5)")).toBe(1.5);
    expect(tinh("=SUM(1,25)")).toBe(1.25);
    expect(tinh("=SUM(F3*1,5)")).toBe(1575000);
    expect(tinh("=MAX(F3*1,15;0)")).toBeCloseTo(1207500, 6);
  });
});
