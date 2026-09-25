import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { buildQuoteBuffer } from "../src/excel.js";
import { parseQuoteWorkbook } from "../src/excelImport.js";
import { toGridItems, giuTruongChiApp } from "../web/src/lib/importApply.js";

const baoGia = (code, items) => ({
  quoteNumber: "SN1", title: "Số ngày", toCompany: "Cty mẫu", city: "TP. Hồ Chí Minh", quoteDate: new Date("2026-09-25"), vatPercent: 8, hnTables: [],
  sheets: [{ order: 1, name: "S", groupSubtotal: true, discount: 0, extraTables: [], template: { code },
    items: items.map((it, i) => ({ order: i + 1, kind: "item", unit: "cái", quantity: 1, unitPrice: 100000, ...it })) }],
});

async function roundTrip(q) {
  const buf = await buildQuoteBuffer(q);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const parsed = await parseQuoteWorkbook(Buffer.from(buf));
  return { ws: wb.worksheets[0], sheet: parsed.sheets.find((s) => !s.skipped) };
}

describe("Số ngày: công thức sống qua xuất và nạp lại", () => {
  it("ô Số ngày có công thức giữ công thức của chính nó", async () => {
    const { ws, sheet } = await roundTrip(baoGia("unibenfood", [{ name: "A", days: 3, formulas: { days: "=1+2" } }]));
    expect(ws.getCell("F12").value).toMatchObject({ formula: "1+2", result: 3 });
    expect(sheet.items.find((it) => it.name === "A").formulas.days).toBe("=1+2");
  });

  it("ô khác trỏ tới Số ngày trống phải đọc 1 cả khi nạp lại", async () => {
    const { ws, sheet } = await roundTrip(baoGia("unibenfood", [
      { name: "Ngày trống", days: null },
      { name: "Tham chiếu", days: 2, unitPrice: 50000, formulas: { unitPrice: "=E1*50000" } },
    ]));
    expect(ws.getCell("F12").value).toBe(1);
    expect(ws.getCell("G13").value).toMatchObject({ formula: "F12*50000", result: 50000 });
    expect(sheet.items.find((it) => it.name === "Tham chiếu").formulas.unitPrice).toBe("={days:1}*50000");
  });

  it("mẫu không có cột Số ngày: nạp lại vào cùng sheet giữ công thức ngày đang ẩn", async () => {
    const cu = { kind: "item", name: "A", unit: "cái", quantity: 1, unitPrice: 100000, days: null, formulas: { days: "=1+2" } };
    const { ws, sheet } = await roundTrip(baoGia("marico_decor", [cu]));
    expect(ws.getCell("H12").value).toMatchObject({ result: 100000 });
    const nhap = toGridItems(sheet.items, { usesDays: false, addrDetail: true });
    const thay = giuTruongChiApp([cu], nhap.items, { giuGhiChuNoiBo: true, giuCongThucNgayAn: true });
    expect(thay.items[0].formulas.days).toBe("=1+2");
    expect(thay.items[0].days).toBeNull();
  });

  it("Số ngày trỏ tổng nhóm khác giữ công thức; Số ngày của hàng nhóm vẫn để trống", async () => {
    const q = baoGia("unibenfood", [
      { kind: "section", name: "Nhóm A", quantity: 1, days: 2, formulas: { days: "=1+1" } },
      { name: "A1", days: 2, unitPrice: 100000 },
      { name: "A2", days: 3, unitPrice: 100000 },
      { kind: "section", name: "Nhóm B", quantity: 1 },
      { name: "B1", days: 5, unitPrice: 60000, formulas: { days: "=F1/100000" } },
    ]);
    const { ws, sheet } = await roundTrip(q);
    expect(ws.getCell("F12").value).toBeNull();
    expect(ws.getCell("F16").value).toMatchObject({ formula: "G12/100000", result: 5 });
    expect(sheet.items.find((it) => it.name === "B1").formulas.days).toBeTruthy();
    expect(sheet.items.find((it) => it.name === "Nhóm A").formulas?.days).toBeUndefined();
  });

  it("không gắn công thức ngày ẩn vào địa chỉ cũ khi file đã chèn dòng", () => {
    const old = [
      { kind: "item", name: "A", unit: "cái", quantity: 1, unitPrice: 100000, formulas: { days: "=E2" } },
      { kind: "item", name: "B", unit: "cái", quantity: 1, unitPrice: 100000 },
    ];
    const imported = [old[0], { kind: "item", name: "X", unit: "cái", quantity: 1, unitPrice: 100000 }, old[1]]
      .map((it) => ({ ...it, formulas: undefined }));
    const result = giuTruongChiApp(old, imported, { giuGhiChuNoiBo: true, giuCongThucNgayAn: true });
    expect(result.items[0].formulas?.days).toBeUndefined();
    expect(result.congThucNgayAnMat).toBe(1);
  });
});
