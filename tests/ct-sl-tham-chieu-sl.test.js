// SỐ LƯỢNG tham chiếu SỐ LƯỢNG hàng khác (=E3 — "Chi phí thi công" cùng diện tích với hàng trên)
// bị ghi SỐ CHẾT vào tệp Excel thay vì công thức sống (kiểm trên dev 9dd30dc, báo giá #248).
//
// Hàng trên "=2.75*2.05" lưu 5,6375; ô SL trong tệp là ROUND(2.75*2.05,1) = 5,6 (quy tắc SL làm tròn 1
// số lẻ). Hàng dưới "=E3": bộ tự kiểm đọc SL tham chiếu theo số ĐÃ làm tròn (5,6 — đúng số Excel thấy ở
// ô trên) rồi so với số THÔ lưới lưu (5,6375) → lệch → cellFormula trả null → ghi số 5,6. Khách sửa ô SL
// hàng trên trong Excel thì hàng dưới đứng im. Ô SL (không quantityExact) luôn được bọc ROUND(…,1), nên
// chỉ cần kết quả tự kiểm khớp SL đã làm tròn là tệp đúng.
import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { buildQuoteBuffer } from "../src/excel.js";

// unibenfood (GN có ngày, không Chi Tiết): cột editor A=_stt B=name C=unit D=quantity E=days
// F=unitPrice G=_amount; cột Excel quantity=E days=F unitPrice=G amount=H; hàng 1 → Excel 12.
const baoGia = (itemB, itemA = {}) => ({
  quoteNumber: "SLSL", title: "T", toCompany: "K", city: "TP. Hồ Chí Minh", quoteDate: new Date("2026-09-24"), vatPercent: 8, hnTables: [],
  sheets: [{ order: 1, name: "S", groupSubtotal: false, discount: 0, extraTables: [], template: { code: "unibenfood" }, items: [
    { order: 1, kind: "item", name: "Hallway", unit: "m2", quantity: 5.6375, days: 1, unitPrice: 95000, formulas: { quantity: "=2.75*2.05" }, ...itemA },
    { order: 2, kind: "item", name: "Chi phí thi công", unit: "m2", quantity: 5.6375, days: 1, unitPrice: 65000, ...itemB },
  ] }],
});
async function mo(q) {
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await buildQuoteBuffer(q));
  return wb.worksheets[0];
}

describe("SL tham chiếu SL hàng khác → công thức sống trong tệp Excel", () => {
  it("=D1 (hàng trên 5,6375 → hiện 5,6) → ô SL hàng dưới là ROUND(E12,1), result 5,6", async () => {
    const ws = await mo(baoGia({ formulas: { quantity: "=D1" } }));
    const tren = ws.getCell("E12").value, duoi = ws.getCell("E13").value;
    expect(tren.formula).toBe("ROUND(2.75*2.05,1)");
    expect(duoi && typeof duoi === "object" ? duoi.formula : duoi, "SL tham chiếu SL bị ghi số chết").toBe("ROUND(E12,1)");
    expect(duoi.result).toBe(5.6);
    // Thành Tiền không đổi: 5,6 × 65.000
    expect(ws.getCell("H13").value.result).toBe(364000);
  });

  it("gác: =D1*2 (app 11,275 → hiện 11,3) mà Excel tính ROUND(E12*2,1) = 11,2 → phải ghi SỐ 11,3", async () => {
    const ws = await mo(baoGia({ quantity: 11.275, formulas: { quantity: "=D1*2" } }));
    // Công thức sống ở đây Excel tính ra 11,2 ≠ 11,3 của app/PDF → tệp phải giữ số của app.
    expect(ws.getCell("E13").value).toBe(11.3);
  });

  it("gác: SL công thức hằng số vẫn giữ nguyên như cũ (ROUND(…,1))", async () => {
    const ws = await mo(baoGia({ quantity: 23.78, formulas: { quantity: "=8.2*2.9" } }));
    expect(ws.getCell("E13").value.formula).toBe("ROUND(8.2*2.9,1)");
    expect(ws.getCell("E13").value.result).toBe(23.8);
  });
});
