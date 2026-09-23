// L32 — bản phía MÁY CHỦ của web/src/lib/formula.ceilingFloor.test.ts + đối chiếu hai phía + dịch
// Excel + tệp xuất + nhập. CEILING/FLOOR bỏ qua đối số bội số ở CẢ HAI bộ tính:
// "=CEILING(1234567;1000)" ra 1.234.567 thay vì 1.235.000, ô không đỏ; translateFormula loại CEILING
// nên tệp Excel ghi đúng con số sai đó. Số kỳ vọng ĐO BẰNG EXCEL 16 THẬT qua COM.
import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { evalEditorFormula, translateFormula, soDoiSoHopLe } from "../src/quoteFormula.js";
import { evalFormula as evalWeb } from "../web/src/lib/formula.ts";
import { buildQuoteBuffer } from "../src/excel.js";
import { parseQuoteWorkbook } from "../src/excelImport.js";

const refs = { cell: (a) => (a === "F2" ? 1234567 : 0), range: () => [] };
const RA_SO = [
  ["=CEILING(1234567;1000)", 1235000], ["=FLOOR(1234567;1000)", 1234000], ["=CEILING(F2;1000)", 1235000],
  ["=CEILING(-2,5;2)", -2], ["=CEILING(-2,5;-2)", -4], ["=FLOOR(-2,5;2)", -4], ["=FLOOR(-2,5;-2)", -2],
  ["=CEILING(-5;-2)", -6], ["=FLOOR(-5;-2)", -4], ["=CEILING(5;0)", 0], ["=FLOOR(0;0)", 0], ["=CEILING(0;-2)", 0],
  ["=CEILING(3000*1,1;100)", 3300], ["=FLOOR(6000*1,15;100)", 6900], ["=CEILING(-28990*2,675;100)", -77500],
  ["=FLOOR(3510*0,07;0,05)", 245.70000000000002], ["=CEILING(101900*0,95;1000)", 97000], ["=FLOOR(-58084*2,675;1000)", -156000],
  ["=FLOOR(-274*0,29;100)", -100], ["=CEILING(41041*0,35;0,1)", 14364.400000000001], ["=CEILING(-1400000*1,1;0,05)", -1540000],
  ["=FLOOR(-12,55*1,1;1000)", -1000], ["=CEILING(257*0,95;500)", 500],
  ["=CEILING(F2/3)", 411523], ["=FLOOR(F2/3)", 411522], ["=CEILING(-2.5)", -2], ["=FLOOR(-2.5)", -3],
];
const RA_NULL = ["=CEILING(2,5;-2)", "=FLOOR(2,5;-2)", "=FLOOR(5;0)", "=CEILING(1;2;3)", "=CEILING(1234567,1000)"];

describe("L32 — máy chủ + đối chiếu hai phía", () => {
  it.each(RA_SO)("%s = %s", (fx, kq) => expect(evalEditorFormula(fx, refs)).toBeCloseTo(kq, 9));
  it.each(RA_NULL)("%s → null", (fx) => expect(evalEditorFormula(fx, refs)).toBeNull());
  it.each([...RA_SO.map((c) => c[0]), ...RA_NULL])("%s: web === máy chủ", (fx) =>
    expect(evalWeb(fx, { ...refs, range: () => null })).toBe(evalEditorFormula(fx, refs)));
});

const ctx = {
  colToField: { E: "quantity", F: "unitPrice" }, fieldToCol: { quantity: "F", unitPrice: "G" },
  allowedRef: new Set(["quantity", "unitPrice"]), rowToExcel: (n) => (n >= 1 && n <= 10 ? 11 + n : null), rangeOk: () => true,
};
describe("L32 — dịch sang Excel", () => {
  it.each([
    ["=CEILING(F2;1000)", "CEILING(G13,1000)"],
    ["=FLOOR(F2*1,1;100)", "FLOOR(G13*1.1,100)"],
  ])("%s → %s", (fx, ra) => expect(translateFormula(fx, ctx)).toBe(ra));
  it("một đối số → null (Excel BẮT BUỘC có bội số — ghi số)", () => {
    expect(translateFormula("=CEILING(F2/3)", ctx)).toBeNull();
    expect(soDoiSoHopLe("CEILING(G13)")).toBe(false);
    expect(soDoiSoHopLe("FLOOR(G13,100,1)")).toBe(false);
  });
});

const baoGia = (itemB) => ({
  quoteNumber: "L32", title: "T", toCompany: "K", city: "TP. Hồ Chí Minh", quoteDate: new Date("2026-09-24"), vatPercent: 8, hnTables: [],
  sheets: [{ order: 1, name: "S", groupSubtotal: false, discount: 0, extraTables: [], template: { code: "marico_decor" }, items: [
    { order: 1, kind: "item", name: "A", unit: "bộ", quantity: 1, unitPrice: 1234567 },
    { order: 2, kind: "item", name: "B", unit: "bộ", quantity: 1, ...itemB },
  ] }],
});
describe("L32 — tệp xuất / nhập thật", () => {
  it("=CEILING(F1;1000) lưu 1.235.000 → công thức sống CEILING(G12,1000)", async () => {
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await buildQuoteBuffer(baoGia({ unitPrice: 1235000, formulas: { unitPrice: "=CEILING(F1;1000)" } })));
    const v = wb.worksheets[0].getCell("G13").value;
    expect(v && typeof v === "object" ? v.formula : v).toBe("CEILING(G12,1000)");
    expect(v.result).toBe(1235000);
  });
  it("số cũ 1.234.567 (bộ tính cũ bỏ bội số) → ghi SỐ, không để Excel mở ra 1.235.000", async () => {
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await buildQuoteBuffer(baoGia({ unitPrice: 1234567, formulas: { unitPrice: "=CEILING(F1;1000)" } })));
    expect(wb.worksheets[0].getCell("G13").value).toBe(1234567);
  });
  it("nhập tệp Excel có =CEILING(G12,1000) → giữ công thức", async () => {
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await buildQuoteBuffer(baoGia({ unitPrice: 1 })));
    wb.worksheets[0].getCell("G13").value = { formula: "CEILING(G12,1000)", result: 1235000 };
    const res = await parseQuoteWorkbook(Buffer.from(await wb.xlsx.writeBuffer()));
    const sheet = res.sheets.find((s) => !s.skipped);
    expect(sheet.items[1].formulas).toEqual({ unitPrice: "=CEILING({unitPrice:1};1000)" });
    expect(sheet.items[1].unitPrice).toBe(1235000);
  });
});
