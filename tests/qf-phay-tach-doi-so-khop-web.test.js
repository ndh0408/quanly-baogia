// GRID-03 (phía máy chủ) — src/quoteFormula.ts phải hiểu dấu "," GIỐNG lưới web.
//
// Luồng frontend đã sửa web/src/lib/formula.ts: "," đứng SÁT một tham chiếu ô là dấu TÁCH ĐỐI SỐ
// ("=SUM(E1,E2)", "=ROUND(G3,2)"); một đối số không đọc được → cả công thức lỗi. Máy chủ vẫn coi
// MỌI "," là thập phân: bước tự kiểm lúc xuất Excel (evalEditorFormula) ra số khác lưới → công thức
// sống bị bỏ, ô Excel chỉ còn số. Và nếu chỉ sửa bước tự kiểm mà quên translateFormula, "SUM(E1,E2)"
// sẽ được ghi ra Excel thành "SUM(F12.F13)" — công thức hỏng.
import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { translateFormula, evalEditorFormula } from "../src/quoteFormula.js";
import { buildQuoteBuffer } from "../src/excel.js";

const GN_COLS = { stt: "B", name: "C", detail: "D", unit: "E", quantity: "F", unitPrice: "G", amount: "H", notes: "I" };
const gnCtx = () => ({
  colToField: { A: "_stt", B: "name", C: "detail", D: "unit", E: "quantity", F: "unitPrice", G: "_amount", H: "notes" },
  fieldToCol: { ...GN_COLS, _stt: "B", _amount: "H" },
  allowedRef: new Set(["quantity", "unitPrice", "days"]),
  rowToExcel: (n) => (n >= 1 && n <= 10 ? 11 + n : null),
  rangeOk: () => true,
});
const refs = (bang) => ({ cell: (a) => bang[a.replace(/\$/g, "").toUpperCase()] ?? 0, range: () => [] });

describe("evalEditorFormula — cùng ngữ nghĩa GRID-03 với lưới web", () => {
  const r = refs({ F1: 100000, F2: 250000, F3: 123.456 });
  it("=SUM(F1,F2) = 350000 (không phải 100000,25)", () => expect(evalEditorFormula("=SUM(F1,F2)", r)).toBe(350000));
  it("=ROUND(F3,2) = 123.46 (không phải 0)", () => expect(evalEditorFormula("=ROUND(F3,2)", r)).toBeCloseTo(123.46));
  it("=F1*1,1 — ',' giữa hai CHỮ SỐ vẫn là thập phân", () => expect(evalEditorFormula("=F1*1,1", r)).toBeCloseTo(110000));
  it("=SUM(F1;F2) (cú pháp ';' cũ) vẫn chạy", () => expect(evalEditorFormula("=SUM(F1;F2)", r)).toBe(350000));
  it("đối số không đọc được → cả công thức lỗi (null), không lọc bỏ im lặng", () => {
    expect(evalEditorFormula("=SUM(F1;1.2.3)", r)).toBeNull();
  });
  it("không có refs (số học thuần): '3,7*2' vẫn là 7,4", () => expect(evalEditorFormula("=3,7*2")).toBeCloseTo(7.4));
});

describe("translateFormula — ',' sát ô thành ',' tách đối số của Excel, không thành '.'", () => {
  it("=SUM(F3,F4) → SUM(G14,G15)", () => expect(translateFormula("=SUM(F3,F4)", gnCtx())).toBe("SUM(G14,G15)"));
  it("=ROUND(F3,2) → ROUND(G14,2)", () => expect(translateFormula("=ROUND(F3,2)", gnCtx())).toBe("ROUND(G14,2)"));
  it("=F3*1,1 → G14*1.1 (không đổi)", () => expect(translateFormula("=F3*1,1", gnCtx())).toBe("G14*1.1"));
  it("=SUM(F3;F4) → SUM(G14,G15) (không đổi)", () => expect(translateFormula("=SUM(F3;F4)", gnCtx())).toBe("SUM(G14,G15)"));
});

describe("xuất Excel (GN): công thức dùng ',' tách đối số được GIỮ SỐNG", () => {
  it("Đơn Giá '=SUM(F1,F2)' của dòng 3 → ô Excel là công thức SUM(G12,G13), kết quả 350000", async () => {
    const buf = await buildQuoteBuffer({
      quoteNumber: "GN26QF", title: "T", toCompany: "K", vatPercent: 0, showTotals: true, city: "HCM",
      quoteDate: new Date("2026-06-13T00:00:00Z"), fromContact: "S",
      sheets: [{ order: 1, name: "S", groupSubtotal: false, template: { code: "marico_decor" }, items: [
        { kind: "item", name: "A", detail: "", unit: "cái", quantity: 1, unitPrice: 100000, days: null, notes: "" },
        { kind: "item", name: "B", detail: "", unit: "cái", quantity: 1, unitPrice: 250000, days: null, notes: "" },
        { kind: "item", name: "C", detail: "", unit: "cái", quantity: 1, unitPrice: 350000, days: null, notes: "", formulas: { unitPrice: "=SUM(F1,F2)" } },
      ] }],
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const v = wb.worksheets[0].getCell("G14").value;
    expect(v && typeof v === "object" ? v.formula : v, "công thức bị bỏ, chỉ còn số chết").toBe("SUM(G12,G13)");
    expect(v.result).toBe(350000);
  });
});
