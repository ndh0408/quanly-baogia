// L35 — ô Số Ngày để TRỐNG (lưu 0 / null) được tham chiếu: app ra 0, tệp Excel ra số khác.
//
// Hai quy ước cho cùng một ô: Thành Tiền của chính hàng đó (lineAmount, excel.ts) dùng days||1 và ô
// Số Ngày trong tệp được GHI là 1 (putNum với days||1); nhưng khi ô khác tham chiếu tới nó, bộ tự kiểm
// máy chủ (editorCellNum) đọc days||0 = 0 — khớp lưới web (GridTable cellNum, cũng ||0) — nên công thức
// sống "F12*50000" được ghi kèm result 0. Excel (fullCalcOnLoad) tính lại trên ô Số Ngày = 1 → 50.000:
// Đơn giá / Thành tiền / Tổng trong tệp gửi khách khác app và PDF, không cảnh báo.
//
// Sửa phía máy chủ: editorCellNum đọc Số Ngày theo ĐÚNG quy ước của ô Excel (days||1). Khi lưới web còn
// đọc 0 (GridTable.tsx đang khoá — xem conLai) thì bộ tự kiểm lệch → ghi SỐ đúng như app; khi lưới sửa
// theo cùng quy ước thì công thức sống được giữ và Excel ra đúng số app.
import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { buildFormulaContext } from "../src/quoteFormula.js";
import { buildQuoteBuffer } from "../src/excel.js";

// unibenfood (GN có ngày, không Chi Tiết): cột editor A=_stt B=name C=unit D=quantity E=days
// F=unitPrice G=_amount; cột Excel quantity=E days=F unitPrice=G amount=H; hàng 1 → Excel 12.
const baoGia = (itemB, daysA = 0) => ({
  quoteNumber: "L35", title: "T", toCompany: "K", city: "TP. Hồ Chí Minh", quoteDate: new Date("2026-09-24"), vatPercent: 8, hnTables: [],
  sheets: [{ order: 1, name: "S", groupSubtotal: false, discount: 0, extraTables: [], template: { code: "unibenfood" }, items: [
    { order: 1, kind: "item", name: "A", unit: "bộ", quantity: 1, days: daysA, unitPrice: 100000 },
    { order: 2, kind: "item", name: "B", unit: "bộ", quantity: 1, days: 1, ...itemB },
  ] }],
});
async function mo(q) {
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await buildQuoteBuffer(q));
  return wb.worksheets[0];
}

describe("L35 — Số Ngày trống được tham chiếu", () => {
  it("ô Số Ngày trống vẫn được ghi là 1 trong tệp (quy ước days||1 của Thành Tiền)", async () => {
    const ws = await mo(baoGia({ unitPrice: 0 }));
    expect(ws.getCell("F12").value).toBe(1);
  });

  it.each([0, null])("days = %s, lưới lưu 0 cho =E1*50000 → tệp ghi SỐ 0, không ghi công thức Excel sẽ tính ra 50.000", async (daysA) => {
    const ws = await mo(baoGia({ unitPrice: 0, formulas: { unitPrice: "=E1*50000" } }, daysA));
    const v = ws.getCell("G13").value;
    // Nếu có công thức thì số Excel tính lại (Số Ngày F12 × 50.000) phải bằng result — đó là bất biến thật.
    if (v && typeof v === "object" && v.formula) expect(Number(ws.getCell("F12").value) * 50000).toBe(v.result);
    else expect(v).toBe(0);
  });

  it("khi số đã lưu theo cùng quy ước (50.000) → công thức sống F12*50000, result 50.000", async () => {
    const ws = await mo(baoGia({ unitPrice: 50000, formulas: { unitPrice: "=E1*50000" } }));
    const v = ws.getCell("G13").value;
    expect(v.formula).toBe("F12*50000");
    expect(v.result).toBe(50000);
  });

  it("bộ tự kiểm đọc Số Ngày trống = 1, Số Ngày có số thì đọc đúng số đó", () => {
    const items = [{ kind: "item", quantity: 1, days: 0, unitPrice: 0 }, { kind: "item", quantity: 1, days: 3, unitPrice: 1 }, { kind: "item", quantity: 1, days: null, unitPrice: 1 }];
    const fc = buildFormulaContext({ cols: { stt: "B", name: "C", unit: "D", quantity: "E", days: "F", unitPrice: "G", amount: "H" }, items, rowToExcel: (i) => 12 + i });
    expect(fc._editorRefs.cell("E1")).toBe(1);
    expect(fc._editorRefs.cell("E2")).toBe(3);
    expect(fc._editorRefs.cell("E3")).toBe(1);
    expect(fc._editorRefs.cell("F1")).toBe(0);   // Đơn giá trống vẫn là 0 như cũ
  });
});
