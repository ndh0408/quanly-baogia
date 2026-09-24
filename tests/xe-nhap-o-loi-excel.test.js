// XLSX-08 — nhập Excel: ô Đơn Giá / Thành Tiền / Tổng đang LỖI Excel (#N/A, #REF!) bị đọc thành 0 mà
// không có cảnh báo đúng. ĐÃ ĐO (audit): Đơn Giá #N/A → p=0, KHÔNG có cảnh báo dòng; công thức #REF!
// → cảnh báo "không dịch được… đã giữ con số" (sai: con số là 0); ô Tổng Cộng lỗi → totals.subtotal=0
// → cảnh báo "lệch tổng so với 0".
import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { buildQuoteBuffer } from "../src/excel.js";
import { parseQuoteWorkbook } from "../src/excelImport.js";

async function tepLoi() {
  const buf = await buildQuoteBuffer({
    quoteNumber: "GN26X08", title: "T", toCompany: "K", vatPercent: 8, showTotals: false, city: "HCM",
    quoteDate: new Date("2026-06-13T00:00:00Z"), fromContact: "S",
    sheets: [{ order: 1, name: "Décor", groupSubtotal: false, template: { code: "marico_decor" }, items: [
      { kind: "item", name: "Âm thanh", unit: "bộ", quantity: 1, unitPrice: 5000000, detail: "", notes: "" },
      { kind: "item", name: "Ánh sáng", unit: "bộ", quantity: 2, unitPrice: 3000000, detail: "", notes: "" },
      { kind: "item", name: "Sân khấu", unit: "bộ", quantity: 1, unitPrice: 1000000, detail: "", notes: "" },
    ] }],
  });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.worksheets[0];
  // Tìm hàng theo tên, cột Đơn Giá theo giá trị gốc.
  const hang = {};
  let cotGia = null, oTong = null;
  ws.eachRow((row, r) => row.eachCell((c) => {
    if (c.value === "Âm thanh" || c.value === "Ánh sáng") hang[c.value] = r;
    if (c.value === 5000000) cotGia = c.col;
    if (typeof c.value === "string" && /T[ổô]ng C[ộo]ng/i.test(c.value)) oTong = r;
  }));
  ws.getCell(hang["Âm thanh"], cotGia).value = { error: "#N/A" };
  ws.getCell(hang["Ánh sáng"], cotGia).value = { formula: "Z999+#REF!", result: { error: "#REF!" } };
  // Ô tổng: cột Thành Tiền ở hàng "Tổng Cộng".
  let cotTien = null;
  ws.getRow(oTong).eachCell((c) => { if (c.value && typeof c.value === "object" && "formula" in c.value) cotTien = c.col; });
  ws.getCell(oTong, cotTien).value = { formula: "SUM(#REF!)", result: { error: "#REF!" } };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe("XLSX-08: ô lỗi Excel khi nhập", () => {
  it("Đơn Giá #N/A và công thức ra #REF! → cảnh báo 'đang LỖI', không nói 'đã giữ con số'", async () => {
    const res = await parseQuoteWorkbook(await tepLoi());
    const sheet = res.sheets.find((s) => !s.skipped);
    const am = sheet.items.find((i) => i.name === "Âm thanh");
    const anh = sheet.items.find((i) => i.name === "Ánh sáng");
    expect(am.unitPrice).toBe(0);
    expect((am.warn || []).join(" | "), "ô #N/A nạp giá 0 mà không cảnh báo").toMatch(/Đơn Giá đang LỖI #N\/A/);
    expect((anh.warn || []).join(" | ")).toMatch(/Đơn Giá đang LỖI #REF!/);
    expect((anh.warn || []).join(" | "), "nói 'đã giữ con số' trong khi con số là 0").not.toMatch(/đã giữ con số/);
  });

  it("ô Tổng Cộng lỗi → không đem 0 ra đối chiếu", async () => {
    const res = await parseQuoteWorkbook(await tepLoi());
    const sheet = res.sheets.find((s) => !s.skipped);
    expect(sheet.totals?.subtotal, "ô tổng lỗi bị đọc thành 0").toBeUndefined();
    expect((sheet.warnings || []).join(" | ")).not.toMatch(/lệch với "Tổng Cộng" ghi trong file \(0\)/);
  });
});
