// L28 — bản phía MÁY CHỦ của web/src/lib/formula.khoangTrang.test.ts + đối chiếu hai phía + tệp xuất.
//
// LỖI: người dùng chép "=MAX(F2-100, 0)" từ Excel tiếng Anh, hoặc gõ "=1 000 000*8%". evalArith (cả hai
// bản) xoá sạch khoảng trắng nên lưới vẫn ra số, ô không đỏ, bước tự kiểm khớp. translateFormula đổi
// "," → "." nhưng GIỮ khoảng trắng, nên tệp chứa <f>MAX(G13-100. 0)</f> / <f>1 000 000*8%</f>. Excel
// đọc khoảng trắng giữa hai toán hạng là toán tử giao vùng → sai cú pháp → KHÔNG MỞ ĐƯỢC CẢ TỆP (đo
// bằng Excel COM: "Unable to get the Open property of the Workbooks class", kể cả chế độ sửa chữa).
import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { evalEditorFormula, translateFormula } from "../src/quoteFormula.js";
import { evalFormula as evalWeb } from "../web/src/lib/formula.ts";
import { buildQuoteBuffer } from "../src/excel.js";

const O = { E2: 2, F1: 58000, F2: 57000 };
const refs = { cell: (a) => O[a.replace(/\$/g, "")] ?? 0, range: () => [] };
const LOI = ["=1 000 000*8%", "=MAX(F1-100, 0)", "=SUM(E2*1, 5)", "=SUM(F1*1 ,5)", "=F1*1 ,5", "=F1*1 .5", "=F1 F2", "=MIN(F1*1000, 500000)"];
const DUNG = [["=F1 * 2", 116000], ["= 1000000 * 8 %", 80000], ["=SUM(1; 2)", 3], ["=ROUND( F1*1,1 ; -3 )", 64000], ["=SUM( F1 ; F2 )", 115000], ["=( F1 + F2 ) / 5", 23000], ["=MAX(E2, 5)", 5]];

describe("L28 — máy chủ: khoảng trắng giữa hai chữ số là lỗi", () => {
  it.each(LOI)("%s → null", (fx) => expect(evalEditorFormula(fx, refs)).toBeNull());
  it.each(DUNG)("%s = %s", (fx, kq) => expect(evalEditorFormula(fx, refs)).toBeCloseTo(kq, 9));
  it.each([...LOI, ...DUNG.map((d) => d[0])])("%s: web === máy chủ", (fx) => expect(evalWeb(fx, { ...refs, range: () => null })).toBe(evalEditorFormula(fx, refs)));
});

// ctx GN: editor E=quantity F=unitPrice → Excel F/G; hàng editor n → Excel 11+n.
const ctx = {
  colToField: { E: "quantity", F: "unitPrice" }, fieldToCol: { quantity: "F", unitPrice: "G" },
  allowedRef: new Set(["quantity", "unitPrice"]), rowToExcel: (n) => (n >= 1 && n <= 10 ? 11 + n : null), rangeOk: () => true,
};

describe("L28 — translateFormula KHÔNG BAO GIỜ ghi khoảng trắng Excel không đọc được", () => {
  it.each(LOI)("%s → null (ghi số)", (fx) => expect(translateFormula(fx, ctx)).toBeNull());
  it.each([
    ["=F1 * 2", "G12*2"],
    ["=SUM( F1 ; F2 )", "SUM(G12,G13)"],
    ["=ROUND( F1*1,1 ; -3 )", "ROUND(G12*1.1,-3)"],
    ["=( F1 + F2 ) / 5", "(G12+G13)/5"],
    ["=MAX(E2, 5)", "MAX(F13,5)"],
    ["=SUM(F1 : F2)", "SUM(G12:G13)"],
  ])("%s → %s (khoảng trắng quanh toán tử được bỏ, nghĩa không đổi)", (fx, ra) => expect(translateFormula(fx, ctx)).toBe(ra));
});

describe("L28 — tệp xuất thật: không ô công thức nào chứa khoảng trắng", () => {
  it("MAX(F2-100, 0) / 1 000 000*8% / SUM(E3*1, 5) → ô ghi SỐ, không ghi công thức hỏng", async () => {
    const q = {
      quoteNumber: "L28", title: "T", toCompany: "K", city: "TP. Hồ Chí Minh", quoteDate: new Date("2026-09-24"), vatPercent: 8, hnTables: [],
      sheets: [{ order: 1, name: "S", groupSubtotal: false, discount: 0, extraTables: [], template: { code: "marico_decor" }, items: [
        { order: 1, kind: "section", name: "Nhóm", quantity: 1 },
        { order: 2, kind: "item", name: "A", unit: "bộ", quantity: 1, unitPrice: 58000 },
        { order: 3, kind: "item", name: "B", unit: "bộ", quantity: 1, unitPrice: 57900, formulas: { unitPrice: "=MAX(F2-100, 0)" } },
        { order: 4, kind: "item", name: "C", unit: "bộ", quantity: 1, unitPrice: 80000, formulas: { unitPrice: "=1 000 000*8%" } },
        { order: 5, kind: "item", name: "D", unit: "bộ", quantity: 1, unitPrice: 1.5, formulas: { unitPrice: "=SUM(E3*1, 5)" } },
        { order: 6, kind: "item", name: "E", unit: "bộ", quantity: 1, unitPrice: 116000, formulas: { unitPrice: "=F2 * 2" } },
      ] }],
    };
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await buildQuoteBuffer(q));
    const ws = wb.worksheets[0];
    const congThuc = [];
    ws.eachRow((row) => row.eachCell((c) => { if (c.value && typeof c.value === "object" && c.value.formula) congThuc.push(c.value.formula); }));
    expect(congThuc.filter((f) => /\s/.test(f))).toEqual([]);
    expect(congThuc).toContain("G13*2");               // công thức hợp lệ vẫn sống, khoảng trắng được bỏ
    const gia = {};
    ws.eachRow((row, r) => { const t = row.getCell("C").value; if (typeof t === "string") gia[t] = ws.getCell(`G${r}`).value; });
    expect(gia.B).toBe(57900);
    expect(gia.C).toBe(80000);
    expect(gia.D).toBe(1.5);
  });
});
