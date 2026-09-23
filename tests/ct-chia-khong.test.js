// L36 — bản phía MÁY CHỦ của web/src/lib/formula.chiaKhong.test.ts + đối chiếu hai phía + tệp xuất.
// "=2/(1/0)": cả hai bộ tính ra 0 (x/Infinity), bộ tự kiểm khớp 0 = 0 nên tệp ghi công thức sống; Excel
// tính ra #DIV/0! ở Đơn giá rồi lan xuống Thành tiền, Tổng cộng, VAT. Nay chia 0 ở đâu cũng là lỗi.
import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { evalEditorFormula } from "../src/quoteFormula.js";
import { evalFormula as evalWeb } from "../web/src/lib/formula.ts";
import { buildQuoteBuffer } from "../src/excel.js";

const O = { E1: 0, E2: 4, F2: 1000 };
const refs = { cell: (a) => O[a.replace(/\$/g, "")] ?? 0, range: () => [] };
const RA_NULL = ["=2/(1/0)", "=10/(E2/E1)", "=F2/(E2/E1)+5", "=-AVERAGE(1;2;3)+(1000-0)/(0,5/0)", "=5+1/(0*3)", "=E2/E1", "=SUM(1;2/(3/0))", "=ROUND(F2/(E1/E2);0)", `=1/(${"9".repeat(200)}*${"9".repeat(200)})`];
const RA_SO = [["=10/(4/2)", 5], ["=0/5", 0], ["=F2/E2", 250], ["=F2/(E2/2)", 500], ["=E1*5/2", 0], ["=1/3*3", 1]];

describe("L36 — máy chủ + đối chiếu hai phía", () => {
  it.each(RA_NULL)("%s → null", (fx) => expect(evalEditorFormula(fx, refs)).toBeNull());
  it.each(RA_SO)("%s = %s", (fx, kq) => expect(evalEditorFormula(fx, refs)).toBeCloseTo(kq, 12));
  it.each([...RA_NULL, ...RA_SO.map((c) => c[0])])("%s: web === máy chủ", (fx) =>
    expect(evalWeb(fx, { ...refs, range: () => null })).toBe(evalEditorFormula(fx, refs)));
});

describe("L36 — tệp xuất thật", () => {
  it("=F2/(E2/E3) với Số lượng E3 = 0, lưới lưu 0 → ô ghi SỐ 0, không ghi công thức Excel ra #DIV/0!", async () => {
    // GN (marico_decor): editor E = Số lượng, F = Đơn giá; hàng 1 → Excel 12.
    const buf = await buildQuoteBuffer({
      quoteNumber: "L36", title: "T", toCompany: "K", city: "TP. Hồ Chí Minh", quoteDate: new Date("2026-09-24"), vatPercent: 8, hnTables: [],
      sheets: [{ order: 1, name: "S", groupSubtotal: false, discount: 0, extraTables: [], template: { code: "marico_decor" }, items: [
        { order: 1, kind: "item", name: "A", unit: "bộ", quantity: 4, unitPrice: 1000 },
        { order: 2, kind: "item", name: "B", unit: "bộ", quantity: 0, unitPrice: 5000 },
        { order: 3, kind: "item", name: "C", unit: "bộ", quantity: 1, unitPrice: 0, formulas: { unitPrice: "=F1/(E1/E2)" } },
      ] }],
    });
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf);
    expect(wb.worksheets[0].getCell("G14").value).toBe(0);
  });
});
