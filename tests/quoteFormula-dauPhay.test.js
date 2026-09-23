// Bản phía MÁY CHỦ của web/src/lib/formula.dauPhay.test.ts — cùng bộ ca. Xem chú thích ở
// chuanHoaDauTachDoiSo (src/quoteFormula.ts). Người dùng báo 2026-09-23: "=ROUND(E2*63000,-3)"
// xuất Excel không ra công thức.
import { describe, it, expect } from "vitest";
import { chuanHoaDauTachDoiSo, evalEditorFormula, translateFormula } from "../src/quoteFormula.js";

describe("chuanHoaDauTachDoiSo (máy chủ)", () => {
  it.each([
    ["ROUND(E2*63000,-3)", "ROUND(E2*63000;-3)"],
    ["ROUND(E2*63000,0)", "ROUND(E2*63000;0)"],
    ["SUM(E2,E3)", "SUM(E2;E3)"],
    ["MAX(E2, 5)", "MAX(E2; 5)"],
    ["ROUND(SUM(E2,E3)*1000,-2)", "ROUND(SUM(E2;E3)*1000;-2)"],
    ["E3*1,5", "E3*1,5"],
    ["SUM(1,5)", "SUM(1,5)"],
    ["ROUND(E2*1,5;0)", "ROUND(E2*1,5;0)"],
    ["(E2+E3)*1,5", "(E2+E3)*1,5"],
  ])("%s → %s", (vao, ra) => expect(chuanHoaDauTachDoiSo(vao)).toBe(ra));

  it("evalEditorFormula: =ROUND(E2*63000,-3) = 554.000", () => {
    const refs = { cell: (a) => (a === "E2" ? 8.8 : 0), range: () => [] };
    expect(evalEditorFormula("=ROUND(E2*63000,-3)", refs)).toBe(554000);
  });

  it("translateFormula: ra công thức Excel đúng dấu phẩy, không còn dính '63000.-3'", () => {
    const ctx = {
      colToField: { E: "quantity", F: "unitPrice" }, fieldToCol: { quantity: "E", unitPrice: "F" },
      allowedRef: new Set(["quantity", "unitPrice"]), rowToExcel: (n) => n + 5, rangeOk: () => true,
    };
    expect(translateFormula("=ROUND(E2*63000,-3)", ctx)).toBe("ROUND(E7*63000,-3)");
  });
});

describe("Xuất Excel: công thức dấu phẩy kiểu Excel tiếng Anh còn nguyên trong file", () => {
  it("GN không ngày — Đơn giá =ROUND(E2*63000,-3) ra công thức ROUND(…,-3), không chỉ còn số", async () => {
    const { buildQuoteBuffer } = await import("../src/excel.js");
    const ExcelJS = (await import("exceljs")).default;
    const q = {
      quoteNumber: "X", title: "T", toCompany: "K", city: "TP. Hồ Chí Minh", quoteDate: new Date("2026-09-23"), vatPercent: 8, hnTables: [],
      sheets: [{ order: 1, name: "Backdrop", groupSubtotal: false, discount: 0, extraTables: [], template: { code: "marico_decor" }, items: [
        { order: 1, kind: "section", name: "Backdrop", quantity: 1 },
        { order: 2, kind: "item", name: "Vách", unit: "m2", quantity: 8.8, unitPrice: 58000 },
        { order: 3, kind: "item", name: "Chi phí căng khung", unit: "bộ", quantity: 1, unitPrice: 554000, formulas: { unitPrice: "=ROUND(E2*63000,-3)" } },
      ] }],
    };
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await buildQuoteBuffer(q));
    const ws = wb.worksheets[0];
    let o = null;
    ws.eachRow((row) => row.eachCell((c) => { if (c.value && typeof c.value === "object" && /ROUND\(.*63000/.test(c.value.formula || "")) o = c; }));
    expect(o, "file Excel không có công thức ROUND(…63000…)").toBeTruthy();
    expect(o.value.formula).toMatch(/^ROUND\([A-Z]+\d+\*63000,-3\)$/);
    expect(o.value.result).toBe(554000);
  });
});

describe("Chốt chặn số đối số — Excel không bao giờ phải 'sửa tệp' vì công thức", async () => {
  const { soDoiSoHopLe, translateFormula } = await import("../src/quoteFormula.js");
  it("tệp production 2026-09-23 ghi 'ROUND(F13*63000.-3)' (ROUND 1 đối số) → bị chặn", () => {
    expect(soDoiSoHopLe("ROUND(F13*63000.-3)")).toBe(false);
    expect(soDoiSoHopLe("ROUND(F13*63000.-3)+800000")).toBe(false);
  });
  it.each([
    ["ROUND(F13*63000,-3)", true], ["ROUNDUP(A1,0)", true], ["ROUNDDOWN(A1)", false], ["INT(A1,2)", false],
    ["SUM(H13:H15)", true], ["SUM(H13,H14,H15)", true], ["SUM()", false], ["ABS(F3)", true],
    ["(F3+G3)*2", true], ["ROUND((F3+G3)*2,0)", true], ["ROUND(F3", false], ["F3)", false],
  ])("%s → %s", (f, dung) => expect(soDoiSoHopLe(f)).toBe(dung));
  it("translateFormula không bao giờ trả công thức sai số đối số", () => {
    const ctx = {
      colToField: { E: "quantity", F: "unitPrice" }, fieldToCol: { quantity: "E", unitPrice: "F" },
      allowedRef: new Set(["quantity", "unitPrice"]), rowToExcel: (n) => n + 5, rangeOk: () => true,
    };
    // "=ROUND(E2*1,5)" — MƠ HỒ (L30): app cũ nhận ROUND một đối số nên công thức đã lưu mang nghĩa
    // ROUND(E2*1,5); đọc kiểu Excel tiếng Anh lại là ROUND(E2*1;5). Không chọn thay → không dịch, ghi số.
    expect(translateFormula("=ROUND(E2*1,5)", ctx)).toBeNull();
    // "=ROUND(E2*1,5)*2" kiểu Việt ĐÚNG nghĩa thập phân + có ";" → ROUND(E7*1.5,0)*2
    expect(translateFormula("=ROUND(E2*1,5;0)*2", ctx)).toBe("ROUND(E7*1.5,0)*2");
    // ROUND chỉ MỘT đối số (bộ tính của lưới vẫn tính được: số chữ số mặc định 0) nhưng Excel coi là
    // công thức hỏng → null (ghi số), không để Excel phải "sửa tệp".
    expect(translateFormula("=ROUND(E2*2)", ctx)).toBeNull();
  });
});
