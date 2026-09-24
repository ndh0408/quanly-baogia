// XLSX-06 — excel.ts / pdf.ts / excelImport.ts nhân tiền bằng double rồi Math.round → lệch ±1đ so
// với Decimal của máy chủ (src/money.ts) khi giá không phải bội số 10. ĐÃ ĐO: giá 15 × SL 4,1 —
// double 61, Decimal 62. Ba đường nay dùng chung nhanLamTronDong (src/tienDong.ts).
import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { Prisma } from "@prisma/client";
import { nhanLamTronDong } from "../src/tienDong.js";
import { computeQuoteTotals } from "../src/money.js";
import { pdfTotals } from "../src/pdf.js";
import { computeSubtotal } from "../src/excelImport.js";
import { buildQuoteBuffer } from "../src/excel.js";

const { Decimal } = Prisma;
const decimal = (...xs) => xs.reduce((a, x) => a.times(new Decimal(x)), new Decimal(1)).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();

describe("nhanLamTronDong khớp Prisma.Decimal ROUND_HALF_UP", () => {
  it("ca đã đo: 15 × 4,1 = 62 (double cho 61)", () => {
    expect(Math.round(15 * 4.1)).toBe(61);   // chứng minh lỗi của cách cũ
    expect(nhanLamTronDong(4.1, 15)).toBe(62);
  });

  it("vét: SL k/10 (k=1..99) × giá 1..3000 × ngày {1,2,3} — trùng Decimal từng đồng", () => {
    let lech = 0;
    for (let k = 1; k < 100; k++) {
      const q = k / 10;
      for (let p = 1; p <= 3000; p++) {
        if (nhanLamTronDong(q, p) !== decimal(q, p)) lech++;
        for (const d of [2, 3]) if (nhanLamTronDong(q, d, p) !== decimal(q, d, p)) lech++;
      }
    }
    expect(lech).toBe(0);
  });

  it("số âm và SL 4 chữ số lẻ", () => {
    expect(nhanLamTronDong(-2.5, 1)).toBe(decimal(-2.5, 1));
    expect(nhanLamTronDong(1.2345, 333)).toBe(decimal(1.2345, 333));
    expect(Object.is(nhanLamTronDong(-0.1, 1), -0)).toBe(false);
  });
});

describe("ba đường xuất/nhập ra ĐÚNG số đã lưu", () => {
  const items = [{ kind: "item", name: "Lẻ", unit: "cái", quantity: 4.1, unitPrice: 15, days: null }];
  const soLuu = Number(computeQuoteTotals({ vatPercent: 0, sheets: [{ items }] }).subtotal);

  it("số lưu (Decimal) là 62", () => expect(soLuu).toBe(62));

  it("PDF (pdfTotals) = số lưu", () => {
    expect(pdfTotals({ vatPercent: 0, sheets: [{ items }] }).subtotal).toBe(soLuu);
  });

  it("nhập Excel (computeSubtotal) = số lưu", () => {
    expect(computeSubtotal({ items, hasDays: false, groupSubtotal: false })).toBe(soLuu);
  });

  it("Excel: result cache của ô Thành Tiền = số lưu", async () => {
    const buf = await buildQuoteBuffer({
      quoteNumber: "GN26X06", title: "T", toCompany: "K", vatPercent: 0, showTotals: true, city: "HCM",
      quoteDate: new Date("2026-06-13T00:00:00Z"), fromContact: "S",
      sheets: [{ order: 1, name: "S", groupSubtotal: false, template: { code: "marico_decor" }, items: [{ ...items[0], detail: "", notes: "" }] }],
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ws = wb.worksheets[0];
    const ketQua = [];
    ws.eachRow((row) => row.eachCell((c) => { const v = c.value; if (v && typeof v === "object" && typeof v.formula === "string" && /^ROUND\(/.test(v.formula)) ketQua.push(v.result); }));
    expect(ketQua[0], "ô Thành Tiền cache số khác số đã lưu").toBe(soLuu);
  });
});
