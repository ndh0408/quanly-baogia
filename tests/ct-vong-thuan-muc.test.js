// VÒNG THUẦN giữa các ô MỤC lọt vào tệp Excel (có từ trước 8e1920d, soát chéo nhánh sua-round-tong-nhom).
//
// Công thức chỉ trỏ SL / Đơn Giá / Số Ngày của mục (không trỏ Thành Tiền, không trỏ ô tổng nhóm) trước đây
// KHÔNG được soát vòng: cổng soát ở cellFormula chỉ bật khi có `_amount`. "=ROUND(F2;-3)" gõ ngay trong F2,
// hay F2 "=F3" với F3 "=F2", có số lưu tự khớp nên lọt bộ tự kiểm và được ghi nguyên vào tệp. Tệp đặt
// fullCalcOnLoad nên Excel báo circular reference ngay khi mở (Excel 16 COM đo được: CIRCULAR tại G13 / F13).
// Lưới web thì tô đỏ và giữ số đã lưu (GridTable oVongLap), nên tệp phải ghi SỐ đó.
//
// Bài "gác" giữ luật tệp cũ không đổi: ô chỉ ĐỌC từ một vòng, và ô trên một "vòng" có mắt xích tự kiểm
// trượt (mắt xích đó vốn ghi số, Excel không còn vòng), vẫn giữ công thức như trước. Dữ liệu tự dựng.
import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { buildQuoteBuffer } from "../src/excel.js";

// Mẫu GN (marico_decor): cột editor E = SL, F = Đơn Giá, G = Thành Tiền; cột Excel SL = F, ĐG = G, Thành
// Tiền = H; hàng editor k → hàng Excel 11 + k (không có hàng nhóm).
const muc = (name, quantity, unitPrice, formulas) => ({ kind: "item", name, unit: "cái", quantity, unitPrice, ...(formulas ? { formulas } : {}) });
async function xuat(items) {
  const q = {
    quoteNumber: "VT1", title: "Vòng thuần", toCompany: "Cty mẫu", city: "TP. Hồ Chí Minh", quoteDate: new Date("2026-09-25"), vatPercent: 8, hnTables: [],
    sheets: [{ order: 1, name: "S", groupSubtotal: false, discount: 0, extraTables: [], template: { code: "marico_decor" },
      items: items.map((it, i) => ({ order: i + 1, ...it })) }],
  };
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await buildQuoteBuffer(q));
  return wb.worksheets[0];
}

describe("vòng thuần giữa các ô mục → ghi SỐ (Excel không còn circular reference)", () => {
  it("Đơn Giá tự trỏ chính nó \"=ROUND(F2;-3)\"", async () => {
    const ws = await xuat([muc("a0", 1, 100000), muc("a", 1, 1000000, { unitPrice: "=ROUND(F2;-3)" })]);
    expect(ws.getCell("G13").value).toBe(1000000);
  });
  it("hai Đơn Giá trỏ nhau (F2 \"=F3\", F3 \"=F2\")", async () => {
    const ws = await xuat([muc("a0", 1, 100000), muc("a", 1, 500000, { unitPrice: "=F3" }), muc("b", 1, 500000, { unitPrice: "=F2" })]);
    expect(ws.getCell("G13").value).toBe(500000);
    expect(ws.getCell("G14").value).toBe(500000);
  });
  it("SL tự trỏ \"=E2*1\" (ô SL bọc ROUND vẫn là vòng)", async () => {
    const ws = await xuat([muc("a0", 1, 100000), muc("a", 2, 300000, { quantity: "=E2*1" })]);
    expect(ws.getCell("F13").value).toBe(2);
  });
  it("vòng bốn ô qua SL và Đơn Giá của hai hàng", async () => {
    // a.SL "=E2" → b.SL "=F2/100000" → b.ĐG "=F1*1" → a.ĐG "=E1*100000" → a.SL. Số lưu tự khớp (2 / 200.000).
    const ws = await xuat([
      muc("a", 2, 200000, { quantity: "=E2", unitPrice: "=E1*100000" }),
      muc("b", 2, 200000, { quantity: "=F2/100000", unitPrice: "=F1*1" }),
    ]);
    for (const addr of ["F12", "G12", "F13", "G13"]) expect(typeof ws.getCell(addr).value, addr).toBe("number");
  });
});

describe("gác: ô KHÔNG nằm trên vòng giữ nguyên công thức như tệp cũ", () => {
  it("ô chỉ ĐỌC từ một vòng: F1 \"=F2*2\" với F2 ↔ F3 → F1 vẫn sống, F2/F3 thành số", async () => {
    const ws = await xuat([
      muc("doc", 1, 1000000, { unitPrice: "=F2*2" }),
      muc("a", 1, 500000, { unitPrice: "=F3" }), muc("b", 1, 500000, { unitPrice: "=F2" }),
    ]);
    expect(ws.getCell("G12").value).toMatchObject({ formula: "G13*2", result: 1000000 });
    expect(ws.getCell("G13").value).toBe(500000);
    expect(ws.getCell("G14").value).toBe(500000);
  });
  it("\"vòng\" có mắt xích tự kiểm trượt: F2 \"=F3\" (khớp), F3 \"=F2*2\" (lệch, vốn ghi số) → F2 vẫn sống", async () => {
    const ws = await xuat([muc("a0", 1, 100000), muc("a", 1, 500000, { unitPrice: "=F3" }), muc("b", 1, 500000, { unitPrice: "=F2*2" })]);
    expect(ws.getCell("G13").value).toMatchObject({ formula: "G14", result: 500000 });
    expect(ws.getCell("G14").value).toBe(500000);
  });
  it("chuỗi dài không vòng (40 ô, mỗi ô trỏ ô trên) giữ nguyên công thức", async () => {
    const items = [muc("m1", 1, 1000)];
    for (let k = 2; k <= 40; k++) items.push(muc(`m${k}`, 1, 1000, { unitPrice: `=F${k - 1}` }));
    const ws = await xuat(items);
    for (let k = 2; k <= 40; k++) expect(ws.getCell(`G${11 + k}`).value).toMatchObject({ formula: `G${10 + k}`, result: 1000 });
  });
  it("SL trỏ SL hàng khác, Đơn Giá trỏ Đơn Giá hàng khác (không vòng) → sống", async () => {
    const ws = await xuat([muc("a", 3, 100000), muc("b", 3, 100000, { quantity: "=E1", unitPrice: "=F1" })]);
    expect(ws.getCell("F13").value).toMatchObject({ formula: "ROUND(F12,1)", result: 3 });
    expect(ws.getCell("G13").value).toMatchObject({ formula: "G12", result: 100000 });
  });
});
