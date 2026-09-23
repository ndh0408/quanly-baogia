// Bản phía MÁY CHỦ của web/src/lib/formula.daiSaiCho.test.ts + đối chiếu hai phía + dịch Excel + tệp
// xuất. Phát hiện khi đối chiếu 2.676 công thức ngẫu nhiên với Excel 16 thật: 127 ca app ra số mà Excel
// ra #VALUE! — đều là dải ô ở chỗ chỉ nhận một giá trị ("=ABS(F1:F3)", "=ROUND(F1:F3;0)"). Bộ tự kiểm
// tính y như lưới nên tệp ghi công thức sống; Excel mở ra #VALUE! lan xuống Thành tiền, Tổng cộng.
import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { evalEditorFormula, translateFormula } from "../src/quoteFormula.js";
import { evalFormula as evalWeb } from "../web/src/lib/formula.ts";
import { buildQuoteBuffer } from "../src/excel.js";

const O = { F1: 100, F2: -200, F3: 300, E2: 2 };
const refs = {
  cell: (a) => O[a.replace(/\$/g, "")] ?? 0,
  range: (a, b) => { const r0 = Number(a.replace(/\D/g, "")), r1 = Number(b.replace(/\D/g, "")); const out = []; for (let r = Math.min(r0, r1); r <= Math.max(r0, r1); r++) out.push(O[a.replace(/[\d$]/g, "") + r] ?? 0); return out; },
};
const RA_NULL = ["=ABS(F1:F3)", "=INT(F1:F3)", "=ROUND(F1:F3;0)", "=ROUNDUP(F1:F2;-2)", "=CEILING(F1:F3;100)", "=SUM(F1:F3*2)", "=SUM(-F1:F3)", "=MAX(F1:F3+1;0)", "=F1:F3*2", "=ROUND(1;2;3)", "=INT(1;2)", "=ABS(1;2)"];
const RA_SO = [["=SUM(F1:F3)", 200], ["=SUM(F1:F3)*2", 400], ["=ROUND(SUM(F1:F3)*1,1;-2)", 200], ["=MAX(F1:F3;0)", 300], ["=MIN(0;F1:F3)", -200], ["=SUM(F1:F2;F3)", 200], ["=AVERAGE( F1:F3 )", 66.66666666666667], ["=ABS(F2:F2)", 200], ["=ROUND(E2*2)", 4]];

describe("dải sai chỗ — máy chủ + đối chiếu hai phía", () => {
  it.each(RA_NULL)("%s → null", (fx) => expect(evalEditorFormula(fx, refs)).toBeNull());
  it.each(RA_SO)("%s = %s", (fx, kq) => expect(evalEditorFormula(fx, refs)).toBeCloseTo(kq, 9));
  it.each([...RA_NULL, ...RA_SO.map((c) => c[0])])("%s: web === máy chủ", (fx) => expect(evalWeb(fx, refs)).toBe(evalEditorFormula(fx, refs)));
});

const ctx = {
  colToField: { E: "quantity", F: "unitPrice" }, fieldToCol: { quantity: "F", unitPrice: "G" },
  allowedRef: new Set(["quantity", "unitPrice"]), rowToExcel: (n) => (n >= 1 && n <= 10 ? 11 + n : null), rangeOk: () => true,
};
describe("dải sai chỗ — translateFormula chặn theo cú pháp: dải phải là nguyên một đối số", () => {
  it.each(["=SUM(F1:F3*2)", "=SUM(-F1:F3)", "=MAX(F1:F3+1;0)", "=F1:F3*2"])("%s → null", (fx) => expect(translateFormula(fx, ctx)).toBeNull());
  it.each([["=SUM(F1:F3)*2", "SUM(G12:G14)*2"], ["=MIN(0;F1:F3)", "MIN(0,G12:G14)"], ["=AVERAGE( F1:F3 )", "AVERAGE(G12:G14)"]])("%s → %s", (fx, ra) => expect(translateFormula(fx, ctx)).toBe(ra));
});

describe("dải sai chỗ — tệp xuất thật", () => {
  it("=ABS(F1:F2) lưu 100 (số app cũ) → ô ghi SỐ, không ghi công thức Excel ra #VALUE!", async () => {
    const buf = await buildQuoteBuffer({
      quoteNumber: "DAI", title: "T", toCompany: "K", city: "TP. Hồ Chí Minh", quoteDate: new Date("2026-09-24"), vatPercent: 8, hnTables: [],
      sheets: [{ order: 1, name: "S", groupSubtotal: false, discount: 0, extraTables: [], template: { code: "marico_decor" }, items: [
        { order: 1, kind: "item", name: "A", unit: "bộ", quantity: 1, unitPrice: 100 },
        { order: 2, kind: "item", name: "B", unit: "bộ", quantity: 1, unitPrice: 200 },
        { order: 3, kind: "item", name: "C", unit: "bộ", quantity: 1, unitPrice: 100, formulas: { unitPrice: "=ABS(F1:F2)" } },
      ] }],
    });
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf);
    expect(wb.worksheets[0].getCell("G14").value).toBe(100);
  });
});
