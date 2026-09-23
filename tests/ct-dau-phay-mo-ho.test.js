// L29 / L30 / L34 — bản phía MÁY CHỦ của web/src/lib/formula.dauPhayMoHo.test.ts + đối chiếu hai phía
// + dịch sang công thức Excel + tệp xuất. Xem chú thích đầu tệp web cho mô tả từng lỗi.
import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { chuanHoaDauTachDoiSo, evalEditorFormula, translateFormula } from "../src/quoteFormula.js";
import { chuanHoaDauTachDoiSo as chuanHoaWeb, evalFormula as evalWeb } from "../web/src/lib/formula.ts";
import { buildQuoteBuffer } from "../src/excel.js";

const O = { E2: 8.8, F1: 58000, F2: 57000, F3: 1050000, G3: 1234.5 };
const refs = { cell: (a) => O[a.replace(/\$/g, "").toUpperCase()] ?? 0, range: () => [] };
const tinh = (fx) => evalEditorFormula(fx, refs);

const CHUAN_HOA = [
  ["ROUND(SUM(F1,F2);-3)", "ROUND(SUM(F1;F2);-3)"], ["SUM(F1,F2;100)", "SUM(F1;F2;100)"], ["ROUND(E2*1,5;0)", "ROUND(E2*1,5;0)"],
  ["ROUND(E2*63000,-3)", "ROUND(E2*63000;-3)"], ["ROUND(E2*63000,0)", "ROUND(E2*63000;0)"], ["ROUND(F1*1,1,-3)", "ROUND(F1*1,1;-3)"],
  ["SUM(1,5)", "SUM(1,5)"], ["INT(F3*1,5)", "INT(F3*1,5)"], ["E3*1,5", "E3*1,5"],
  ["ROUND(F1*0,5)", null], ["ROUND(1,5*2)", null], ["MIN(F2*1000,500000)", null], ["PRODUCT(-500000,20%)", null],
  ["SUM(F1,F2*1,5)", null], ["F1,5", null], ["F1.5", null], ["(F1,F2)", null],
];
const RA_SO = [
  ["=ROUND(SUM(F1,F2);-3)", 115000], ["=SUM(F1,F2;100)", 115100], ["=F1*1,5", 87000], ["=ROUND(SUM(F1;F2)*1,1;-3)", 127000],
  ["=SUM(2x1,5)", 3], ["=INT(3x1,5)", 4], ["=2x1,5", 3],
  ["=ROUND(F3*0,5;0)", 525000], ["=ROUND(E2*63000,-3)", 554000], ["=ROUND(E2*63000,0)", 554400], ["=ROUND(F1*1,1,-3)", 64000], ["=ROUND(G3,0)", 1235],
  ["=SUM(1,5)", 1.5], ["=SUM(1,25)", 1.25], ["=SUM(F3*1,5)", 1575000],
];
const RA_NULL = [
  "=F1,5", "=F1.5", "=(F1,F2)", "=SUM((F1,F2))", "=F1,F2",
  "=ROUND(F3*0,5)", "=ROUNDDOWN(F3*0,9)", "=ROUND(F3*1,1)", "=ROUNDUP(F3*1,15)", "=ROUND(1,5*2)",
  "=MIN(F3*1000,500000)", "=PRODUCT(-500000,20%)", "=INT(-MAX(63000,1000))", "=SUM(2*F3/2,500000)", "=INT(SUM(PRODUCT(63000,63000)))", "=SUM(F1,F3*1,5)",
];

describe("máy chủ — cùng luật dấu phẩy với web", () => {
  it.each(CHUAN_HOA)("chuanHoaDauTachDoiSo(%s) → %s", (vao, ra) => expect(chuanHoaDauTachDoiSo(vao)).toBe(ra));
  it.each(RA_SO)("%s = %s", (fx, kq) => expect(tinh(fx)).toBeCloseTo(kq, 9));
  it.each(RA_NULL)("%s → null", (fx) => expect(tinh(fx)).toBeNull());
});

describe("đối chiếu hai phía trên cùng bộ đầu vào", () => {
  const webRefs = { ...refs, range: () => null };
  it.each(CHUAN_HOA)("chuanHoa %s: web === máy chủ", (vao) => expect(chuanHoaWeb(vao)).toBe(chuanHoaDauTachDoiSo(vao)));
  it.each([...RA_SO.map((c) => c[0]), ...RA_NULL])("%s: web === máy chủ", (fx) => expect(evalWeb(fx, webRefs)).toBe(tinh(fx)));
});

// ctx GN: editor E=quantity F=unitPrice → Excel F/G; hàng editor n → Excel 11+n.
const ctx = {
  colToField: { E: "quantity", F: "unitPrice" }, fieldToCol: { quantity: "F", unitPrice: "G" },
  allowedRef: new Set(["quantity", "unitPrice"]), rowToExcel: (n) => (n >= 1 && n <= 10 ? 11 + n : null), rangeOk: () => true,
};
describe("translateFormula — không bao giờ ghi 'G12.G13' / 'G12.5' / công thức mang nghĩa khác", () => {
  it.each([
    ["=ROUND(SUM(F1,F2);-3)", "ROUND(SUM(G12,G13),-3)"],   // bản cũ: ROUND(SUM(G12.G13),-3)
    ["=SUM(2x1,5)", "SUM(2*1.5)"],
    ["=ROUND(F1*1,1,-3)", "ROUND(G12*1.1,-3)"],
    ["=ROUND(E2*63000,0)", "ROUND(F13*63000,0)"],
  ])("%s → %s", (fx, ra) => expect(translateFormula(fx, ctx)).toBe(ra));
  it.each(RA_NULL)("%s → null (ghi số)", (fx) => expect(translateFormula(fx, ctx)).toBeNull());
});

describe("tệp xuất thật", () => {
  const baoGia = (itemB) => ({
    quoteNumber: "L29", title: "T", toCompany: "K", city: "TP. Hồ Chí Minh", quoteDate: new Date("2026-09-24"), vatPercent: 8, hnTables: [],
    sheets: [{ order: 1, name: "S", groupSubtotal: false, discount: 0, extraTables: [], template: { code: "marico_decor" }, items: [
      { order: 1, kind: "section", name: "Nhóm", quantity: 1 },
      { order: 2, kind: "item", name: "A", unit: "bộ", quantity: 1, unitPrice: 58000 },
      { order: 3, kind: "item", name: "C", unit: "bộ", quantity: 1, unitPrice: 57000 },
      { order: 4, kind: "item", name: "B", unit: "bộ", quantity: 1, ...itemB },
    ] }],
  });
  const donGiaB = async (q) => {
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await buildQuoteBuffer(q));
    const ws = wb.worksheets[0];
    let r = null; ws.eachRow((row, i) => { if (row.getCell("C").value === "B") r = i; });
    return ws.getCell(`G${r}`).value;
  };
  it("L29: =ROUND(SUM(F2,F3);-3) lưu 115.000 → công thức ROUND(SUM(G13,G14),-3), result 115.000", async () => {
    const v = await donGiaB(baoGia({ unitPrice: 115000, formulas: { unitPrice: "=ROUND(SUM(F2,F3);-3)" } }));
    expect(v.formula).toBe("ROUND(SUM(G13,G14),-3)");
    expect(v.result).toBe(115000);
  });
  it("L29: số cũ 58.000 của công thức đó → ghi SỐ 58.000, không ghi 'G13.G14' (Excel sẽ ra 115.000)", async () => {
    expect(await donGiaB(baoGia({ unitPrice: 58000, formulas: { unitPrice: "=ROUND(SUM(F2,F3);-3)" } }))).toBe(58000);
  });
  it("L30: công thức cũ =ROUND(F2*0,5) lưu 29.000 → ghi đúng SỐ đã lưu", async () => {
    expect(await donGiaB(baoGia({ unitPrice: 29000, formulas: { unitPrice: "=ROUND(F2*0,5)" } }))).toBe(29000);
  });
});
