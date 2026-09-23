// L37 — bản phía MÁY CHỦ của web/src/lib/formula.thieuToanTu.test.ts + đối chiếu hai phía + dịch Excel
// + tệp xuất. "=2SUM(F2;F3)" từng ra 21.113.000 ở CẢ HAI bộ tính (kết quả hàm dính vào chữ số "2"), nên
// bước tự kiểm khớp và tệp ghi "2SUM(G13,G14)" — chuỗi lọt cả chốt ký tự lẫn soDoiSoHopLe. Excel thật
// không mở được tệp; mở bằng chế độ sửa chữa thì công thức bị xoá.
import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { evalEditorFormula, translateFormula } from "../src/quoteFormula.js";
import { evalFormula as evalWeb } from "../web/src/lib/formula.ts";
import { buildQuoteBuffer } from "../src/excel.js";

const O = { F2: 1050000, F3: 63000, F4: -5 };
const refs = { cell: (a) => O[a.replace(/\$/g, "")] ?? 0, range: () => [] };
const RA_NULL = ["=2SUM(F2;F3)", "=SUM(F2)SUM(F3)", "=1,1SUM(F2;F3)", "=MAX(1;2)MAX(3;4)", "=SUM(1;2)(3)", "=2(F2)", "=ROUND(F2;-3)5"];
const RA_SO = [
  ["=2*SUM(F2;F3)", 2226000], ["=-SUM(1;2)", -3], ["=SUM(1;2)-SUM(3;4)", -4], ["=10/SUM(2;3)", 2],
  ["=ROUND(F2;-3)*1,1", 1155000], ["=ABS(F4)*2", 10], ["=ROUND(SUM(F2;F3)*1,1;-3)", 1224000], ["=SUM(F4;1)*-2", 8],
];

describe("L37 — máy chủ + đối chiếu hai phía", () => {
  it.each(RA_NULL)("%s → null", (fx) => expect(evalEditorFormula(fx, refs)).toBeNull());
  it.each(RA_SO)("%s = %s", (fx, kq) => expect(evalEditorFormula(fx, refs)).toBeCloseTo(kq, 9));
  it.each([...RA_NULL, ...RA_SO.map((c) => c[0])])("%s: web === máy chủ", (fx) =>
    expect(evalWeb(fx, { ...refs, range: () => null })).toBe(evalEditorFormula(fx, refs)));
});

const ctx = {
  colToField: { E: "quantity", F: "unitPrice" }, fieldToCol: { quantity: "F", unitPrice: "G" },
  allowedRef: new Set(["quantity", "unitPrice"]), rowToExcel: (n) => (n >= 1 && n <= 10 ? 11 + n : null), rangeOk: () => true,
};
describe("L37 — translateFormula chặn theo CÚ PHÁP, không dựa vào bộ tính", () => {
  it.each(RA_NULL)("%s → null", (fx) => expect(translateFormula(fx, ctx)).toBeNull());
  it("=2*SUM(F2;F3) vẫn dịch được", () => expect(translateFormula("=2*SUM(F2;F3)", ctx)).toBe("2*SUM(G13,G14)"));
});

describe("L37 — tệp xuất thật", () => {
  it("=2SUM(F2;F3) lưu 21.113.000 (số cũ) → ô ghi SỐ, không ghi '2SUM(…)'", async () => {
    const buf = await buildQuoteBuffer({
      quoteNumber: "L37", title: "T", toCompany: "K", city: "TP. Hồ Chí Minh", quoteDate: new Date("2026-09-24"), vatPercent: 8, hnTables: [],
      sheets: [{ order: 1, name: "S", groupSubtotal: false, discount: 0, extraTables: [], template: { code: "marico_decor" }, items: [
        { order: 1, kind: "section", name: "Nhóm", quantity: 1 },
        { order: 2, kind: "item", name: "A", unit: "bộ", quantity: 1, unitPrice: 1050000 },
        { order: 3, kind: "item", name: "C", unit: "bộ", quantity: 1, unitPrice: 63000 },
        { order: 4, kind: "item", name: "B", unit: "bộ", quantity: 1, unitPrice: 21113000, formulas: { unitPrice: "=2SUM(F2;F3)" } },
      ] }],
    });
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf);
    const ws = wb.worksheets[0];
    const congThuc = [];
    ws.eachRow((row) => row.eachCell((c) => { if (c.value && typeof c.value === "object" && c.value.formula) congThuc.push(c.value.formula); }));
    expect(congThuc.filter((f) => /[\d.)%]\s*[A-Za-z(]/.test(f))).toEqual([]);
    expect(ws.getCell("G15").value).toBe(21113000);
  });
});
