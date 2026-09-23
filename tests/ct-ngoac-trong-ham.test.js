// L31 — bản phía MÁY CHỦ của web/src/lib/formula.ngoacTrongHam.test.ts + đối chiếu hai phía + tệp xuất
// + NHẬP tệp Excel. Hàm có ngoặc thường trong đối số ("=ROUND(F1*(1+8%);0)") trước đây trả null ở cả
// hai bộ tính: lưới đỏ + đơn giá 0; xuất Excel chỉ còn số; nhập tệp Excel mất công thức.
import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { evalEditorFormula, translateFormula } from "../src/quoteFormula.js";
import { evalFormula as evalWeb } from "../web/src/lib/formula.ts";
import { buildQuoteBuffer } from "../src/excel.js";
import { parseQuoteWorkbook } from "../src/excelImport.js";

const O = { F1: 1050000, F2: 58000, F3: 57000 };
const refs = { cell: (a) => O[a.replace(/\$/g, "")] ?? 0, range: () => [] };
const RA_SO = [
  ["=ROUND(F1*(1+8%);0)", 1134000], ["=ROUND((F1+100000)*1,1;-3)", 1265000], ["=MAX((F2-F3);0)", 1000],
  ["=ROUND(F2/(1+10%);0)", 52727], ["=ROUND(F1*(1+8%),0)", 1134000], ["=INT((0,1+0,7)*10)", 8], ["=SUM(((1)))", 1],
  ["=ROUND(SUM((F2+F3)*2;F1)*(1+10%);-3)", 1408000], ["=ABS(-(F2-F3))", 1000], ["=MIN((F2);(F3))", 57000],
];
const RA_NULL = ["=SUM((1;2))", "=ROUND(F1*(1+8%;0)", "=ROUND(F1*(1+8%));0)", "=TONG((1+2))"];

describe("L31 — máy chủ", () => {
  it.each(RA_SO)("%s = %s", (fx, kq) => expect(evalEditorFormula(fx, refs)).toBeCloseTo(kq, 9));
  it.each(RA_NULL)("%s → null", (fx) => expect(evalEditorFormula(fx, refs)).toBeNull());
  it.each([...RA_SO.map((c) => c[0]), ...RA_NULL])("%s: web === máy chủ", (fx) =>
    expect(evalWeb(fx, { ...refs, range: () => null })).toBe(evalEditorFormula(fx, refs)));
});

const ctx = {
  colToField: { E: "quantity", F: "unitPrice" }, fieldToCol: { quantity: "F", unitPrice: "G" },
  allowedRef: new Set(["quantity", "unitPrice"]), rowToExcel: (n) => (n >= 1 && n <= 10 ? 11 + n : null), rangeOk: () => true,
};
describe("L31 — dịch sang Excel", () => {
  it.each([
    ["=ROUND(F1*(1+8%);0)", "ROUND(G12*(1+8%),0)"],
    ["=MAX((F2-F3);0)", "MAX((G13-G14),0)"],
    ["=ROUND(F1*(1+8%),0)", "ROUND(G12*(1+8%),0)"],
  ])("%s → %s", (fx, ra) => expect(translateFormula(fx, ctx)).toBe(ra));
});

const baoGia = (items) => ({
  quoteNumber: "L31", title: "T", toCompany: "K", city: "TP. Hồ Chí Minh", quoteDate: new Date("2026-09-24"), vatPercent: 8, hnTables: [],
  sheets: [{ order: 1, name: "S", groupSubtotal: false, discount: 0, extraTables: [], template: { code: "marico_decor" }, items }],
});
describe("L31 — tệp xuất / nhập thật", () => {
  it("xuất: =ROUND(F1*(1+8%);0) lưu 1.134.000 → công thức sống ROUND(G12*(1+8%),0)", async () => {
    const buf = await buildQuoteBuffer(baoGia([
      { order: 1, kind: "item", name: "A", unit: "bộ", quantity: 1, unitPrice: 1050000 },
      { order: 2, kind: "item", name: "B", unit: "bộ", quantity: 1, unitPrice: 1134000, formulas: { unitPrice: "=ROUND(F1*(1+8%);0)" } },
    ]));
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf);
    const v = wb.worksheets[0].getCell("G13").value;
    expect(v && typeof v === "object" ? v.formula : v).toBe("ROUND(G12*(1+8%),0)");
    expect(v.result).toBe(1134000);
  });
  it("nhập: tệp Excel có ô =ROUND(G12*(1+8%),0) → giữ được CÔNG THỨC, không chỉ số", async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await buildQuoteBuffer(baoGia([
      { order: 1, kind: "item", name: "A", unit: "bộ", quantity: 1, unitPrice: 1050000 },
      { order: 2, kind: "item", name: "B", unit: "bộ", quantity: 1, unitPrice: 1 },
    ])));
    wb.worksheets[0].getCell("G13").value = { formula: "ROUND(G12*(1+8%),0)", result: 1134000 };
    const res = await parseQuoteWorkbook(Buffer.from(await wb.xlsx.writeBuffer()));
    const sheet = res.sheets.find((s) => !s.skipped);
    expect(sheet.items[1].unitPrice).toBe(1134000);
    expect(sheet.items[1].formulas).toEqual({ unitPrice: "=ROUND({unitPrice:1}*(1+8%);0)" });
    expect(sheet.stats.formulasDropped).toBe(0);
  });
});
