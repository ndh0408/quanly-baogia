// XLSX-07 — hệ số nhóm lẻ (SL nhóm 1,5) làm "Tổng Cộng" trong Excel thành số .5 và VAT tính trên gốc
// chưa làm tròn, trong khi máy chủ (src/money.ts) làm tròn tổng sheet về số nguyên. ĐÃ ĐO (audit):
// tệp ghi 4.748.529,5, CSDL 4.748.530.
// Sửa: CHỈ khi có hệ số nhóm không nguyên → công thức Tổng Cộng bọc ROUND(…,0) và giá trị cache làm
// tròn. SL nhóm nguyên → tệp giữ nguyên (không thêm ROUND) — GN của báo giá thường không đổi.
import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { buildQuoteBuffer } from "../src/excel.js";
import { computeQuoteTotals } from "../src/money.js";

const baoGia = (slNhom) => ({
  quoteNumber: "GN26X07", title: "T", toCompany: "K", vatPercent: 8, showTotals: true, city: "HCM",
  quoteDate: new Date("2026-06-13T00:00:00Z"), fromContact: "S",
  sheets: [{ order: 1, name: "S", groupSubtotal: true, template: { code: "marico_decor" }, items: [
    { kind: "section", name: "Nhóm", quantity: slNhom },
    { kind: "item", name: "Mục", detail: "", unit: "cái", quantity: 1, unitPrice: 333333, days: null, notes: "" },
  ] }],
});

async function oTongCong(quote) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await buildQuoteBuffer(quote));
  const ws = wb.worksheets[0];
  let ra = null;
  ws.eachRow((row) => row.eachCell((c) => {
    const v = c.value;
    if (!ra && v && typeof v === "object" && typeof v.formula === "string" && /(^|ROUND\()[A-Z]+\d+(\*[A-Z]+\d+)?(\+|,0\)|$)/.test(v.formula) && !/^ROUND\([A-Z]+\d+\*[A-Z]+\d+,0\)$/.test(v.formula) && c.row > 12) ra = v;
  }));
  return ra;
}

describe("XLSX-07: Tổng Cộng với hệ số nhóm lẻ", () => {
  it("SL nhóm 1,5 × 333.333 → Tổng Cộng 500.000 (số nguyên, khớp CSDL), công thức có ROUND", async () => {
    const q = baoGia(1.5);
    const soLuu = Number(computeQuoteTotals({ vatPercent: 8, sheets: q.sheets }).subtotal);
    expect(soLuu).toBe(500000);
    const o = await oTongCong(q);
    expect(o, "không tìm thấy ô Tổng Cộng").toBeTruthy();
    expect(o.result, "Tổng Cộng trong tệp lẻ .5, khác số đã lưu").toBe(soLuu);
    expect(o.formula).toMatch(/^ROUND\(.*,0\)$/);
  });

  it("SL nhóm NGUYÊN → công thức Tổng Cộng KHÔNG đổi (không bọc ROUND)", async () => {
    const o = await oTongCong(baoGia(2));
    expect(o.formula).not.toMatch(/^ROUND\(/);
    expect(o.result).toBe(666666);
  });
});
