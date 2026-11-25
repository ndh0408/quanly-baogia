// HỆ SỐ NHÓM NHỎ HƠN 1 PHẢI NHÂN THẬT (chủ repo báo GẤP 2026-11-25, production).
//
// Báo giá #108 (FP_B26_023), sheet "Cổng", bật "Hiện Thành Tiền nhóm": hàng NHÓM "Cổng Aeon BT" ghi chú "Chia 2"
// gõ Số Lượng 0,5 (bằng công thức). Thành Tiền nhóm vẫn hiện 29.262.660 (= ×1) thay vì 14.631.330, tổng sheet sai
// theo. Nguyên nhân: hệ số nhóm bị ép TỐI THIỂU 1 — `Math.max(1, SL || 1)`. Ý định ban đầu chỉ là "nhóm bỏ trống
// = ×1", nhưng Math.max kẹp luôn 0,5 lên 1. Luật mới: hệ số = SL ĐANG HIỂN THỊ của nhóm (qtyForAmount — đã gồm luật
// SL < 0,05 → 0,1 và quantityExact) nếu > 0; trống / 0 / âm → ×1.
//
// Luật có NHIỀU BẢN SAO (shared/ không import được src/ và ngược lại): shared/quote-math.ts (groupMult — lưới web),
// src/money.ts (tiền máy chủ LƯU + VAT), src/pdf.ts, src/excel.ts (ô Thành Tiền nhóm + công thức ×SL + Tổng Cộng),
// src/quoteFormula.ts (heSoNhom — bộ tự kiểm công thức tham chiếu ô tổng nhóm), src/excelImport.ts (computeSubtotal
// — đối chiếu tổng khi nhập Excel). Bài này chạy MỌI bản trên cùng bảng giá trị — sót một bản là web, số lưu, PDF,
// tệp Excel ra bốn con số khác nhau.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import * as WEB from "../shared/quote-math.js";
import { computeQuoteTotals } from "../src/money.js";
import { pdfTotals, renderQuotePdf } from "../src/pdf.js";
import { buildFormulaContext, evalEditorFormula } from "../src/quoteFormula.js";
import { buildQuoteBuffer } from "../src/excel.js";
import { computeSubtotal } from "../src/excelImport.js";

// [mô tả, hàng nhóm, hệ số đúng]
const BANG = [
  ["SL 0,5", { quantity: 0.5 }, 0.5],
  ["SL 2", { quantity: 2 }, 2],
  ["SL 1", { quantity: 1 }, 1],
  ["SL 1,5", { quantity: 1.5 }, 1.5],
  ["SL 0", { quantity: 0 }, 1],
  ["SL trống (undefined)", {}, 1],
  ["SL null", { quantity: null }, 1],
  ["SL −1", { quantity: -1 }, 1],
  ["SL 0,03 (luật SL nhỏ → hiện 0,1)", { quantity: 0.03 }, 0.1],
  ["SL 0,96 (hiện 1)", { quantity: 0.96 }, 1],
  ["SL 1,04 (hiện 1)", { quantity: 1.04 }, 1],
  ["quantityExact 0,25", { quantity: 0.25, quantityExact: true }, 0.25],
  ["quantityExact 0,00001 (4 số lẻ ra 0 → ×1)", { quantity: 0.00001, quantityExact: true }, 1],
];
const MUC = { kind: "item", name: "Mục", unit: "cái", quantity: 2, unitPrice: 100_000 };   // 200.000
const nhom = (o) => ({ kind: "section", name: "Nhóm", unit: "gói", unitPrice: 0, ...o });
// Mẫu GN: cột editor A=_stt B=name C=detail D=unit E=quantity F=unitPrice G=_amount H=notes
const GN_COLS = { stt: "B", name: "C", detail: "D", unit: "E", quantity: "F", unitPrice: "G", amount: "H", notes: "I" };
/** Bộ tự kiểm (src/quoteFormula.ts) đọc ô Thành Tiền nhóm "G1" — phải ra ĐÚNG số lưới web hiện ở ô đó. */
const oNhomBoTuKiem = (items) =>
  buildFormulaContext({ cols: GN_COLS, items, rowToExcel: () => null, nhom: { groupSubtotal: true, numberSubs: false, oExcel: () => null } })._editorRefs.cell("G1");

describe("mọi bản groupMult ra CÙNG một hệ số", () => {
  for (const [ten, g, he] of BANG) {
    it(`${ten} → ×${he}`, () => {
      const items = [nhom(g), MUC];
      const tien = Math.round(200_000 * he);
      expect(WEB.groupMult(items[0]), "shared/quote-math.ts groupMult (lưới web)").toBe(he);
      expect(WEB.sheetTotals({ items, groupSubtotal: true }, false).gross, "tổng sheet lưới web").toBe(tien);
      const soLuu = computeQuoteTotals({ vatPercent: 0, sheets: [{ groupSubtotal: true, items }] });
      expect(Number(soLuu.sheetTotals[0].gross), "src/money.ts (số LƯU)").toBe(tien);
      expect(pdfTotals({ vatPercent: 0, sheets: [{ groupSubtotal: true, items }] }).gross, "src/pdf.ts").toBe(tien);
      expect(Math.round(computeSubtotal({ items, hasDays: false, groupSubtotal: true })), "src/excelImport.ts").toBe(tien);
      expect(oNhomBoTuKiem(items), "bộ tự kiểm src/quoteFormula.ts (heSoNhom)").toBeCloseTo(200_000 * he, 6);
    });
  }

  it("tắt 'Hiện Thành Tiền nhóm' thì mọi bản vẫn ×1 (SL 0,5 không nhân)", () => {
    const items = [nhom({ quantity: 0.5 }), MUC];
    expect(WEB.sheetTotals({ items, groupSubtotal: false }, false).gross).toBe(200_000);
    expect(Number(computeQuoteTotals({ vatPercent: 0, sheets: [{ groupSubtotal: false, items }] }).subtotal)).toBe(200_000);
    expect(pdfTotals({ vatPercent: 0, sheets: [{ groupSubtotal: false, items }] }).gross).toBe(200_000);
    expect(computeSubtotal({ items, hasDays: false, groupSubtotal: false })).toBe(200_000);
  });

  it("SL nhóm lẻ: tổng làm tròn đồng ở mức sheet, web = máy chủ (0,5 × 333.333 = 166.666,5 → 166.667)", () => {
    const items = [nhom({ quantity: 0.5 }), { ...MUC, quantity: 1, unitPrice: 333_333 }];
    const web = WEB.sheetTotals({ items, groupSubtotal: true }, false).gross;
    expect(web).toBe(166_667);
    expect(Number(computeQuoteTotals({ vatPercent: 0, sheets: [{ groupSubtotal: true, items }] }).subtotal)).toBe(web);
    expect(pdfTotals({ vatPercent: 0, sheets: [{ groupSubtotal: true, items }] }).gross).toBe(web);
  });
});

// ── Sheet "Cổng" của báo giá #108 — dữ liệu TỰ DỰNG theo cấu trúc chủ repo tả (không chép từ production) ──────
// Hàng editor (1-based): 1 nhóm "Cổng Aeon BT" SL =1/2 · 2 mục SL =7.6*2.8*2 (42,56 → hiện 42,6) × 565.000 ·
// 3 mục 2 × 800.000 · 4 mục 1 × đơn giá =sum(G2:G3)*0.14. G = cột Thành Tiền của lưới.
const tongCong = 24_069_000 + 1_600_000 + 3_593_660;   // 29.262.660 = Đơn Giá nhóm (Σ mục)
const cong108 = () => [
  { kind: "section", name: "Cổng Aeon BT", unit: "gói", quantity: 0.5, unitPrice: 0, notes: "Chia 2", formulas: { quantity: "=1/2" } },
  { kind: "item", name: "Khung cổng", unit: "m2", quantity: 42.56, unitPrice: 565_000, formulas: { quantity: "=7.6*2.8*2" } },
  { kind: "item", name: "Đèn", unit: "bộ", quantity: 2, unitPrice: 800_000 },
  { kind: "item", name: "Phí thi công", unit: "gói", quantity: 1, unitPrice: 3_593_660, formulas: { unitPrice: "=sum(G2:G3)*0.14" } },
];
/** + nhóm thứ hai SL TRỐNG (×1): một mục trỏ vào ô Thành Tiền nhóm Cổng (=G1*10% → 1.463.133) + 3 × 100.000. */
const cong108HaiNhom = () => [
  ...cong108(),
  { kind: "section", name: "Phí quản lý", unit: "", quantity: 0, unitPrice: 0 },
  { kind: "item", name: "Phí quản lý 10%", unit: "gói", quantity: 1, unitPrice: 1_463_133, formulas: { unitPrice: "=G1*10%" } },
  { kind: "item", name: "Vận chuyển", unit: "chuyến", quantity: 3, unitPrice: 100_000 },
];

describe("báo giá #108 sheet 'Cổng': nhóm SL 0,5 → Thành Tiền nhóm 14.631.330", () => {
  it("lưới web = số lưu (Decimal) = PDF = đối chiếu nhập Excel = 0,5 × 29.262.660", () => {
    expect(tongCong).toBe(29_262_660);
    const items = cong108();
    expect(WEB.lineAmount(items[1], false), "42,56 hiện 42,6 × 565.000").toBe(24_069_000);
    expect(WEB.sheetSubtotalGrouped(items, false, true)).toBe(14_631_330);
    const sh = { groupSubtotal: true, discount: 0, items };
    const soLuu = computeQuoteTotals({ vatPercent: 8, sheets: [sh] });
    expect(Number(soLuu.sheetTotals[0].gross)).toBe(14_631_330);
    expect(Number(soLuu.vat)).toBe(1_170_506);   // 14.631.330 × 8% = 1.170.506,4
    expect(Number(soLuu.total)).toBe(15_801_836);
    expect(WEB.quoteTotals([WEB.sheetTotals(sh, false)], 8)).toMatchObject({ subtotal: 14_631_330, vat: 1_170_506, total: 15_801_836 });
    expect(pdfTotals({ vatPercent: 8, sheets: [sh] })).toMatchObject({ gross: 14_631_330, vat: 1_170_506, total: 15_801_836 });
    expect(computeSubtotal({ items, hasDays: false, groupSubtotal: true })).toBe(14_631_330);
    expect(oNhomBoTuKiem(items), "bộ tự kiểm đọc ô Thành Tiền nhóm").toBe(14_631_330);
  });

  it("nhóm thứ hai SL TRỐNG vẫn ×1: tổng = 14.631.330 + 1.463.133 + 300.000", () => {
    const items = cong108HaiNhom();
    const dung = 14_631_330 + 1_463_133 + 300_000;
    expect(WEB.sheetSubtotalGrouped(items, false, true)).toBe(dung);
    expect(Number(computeQuoteTotals({ vatPercent: 0, sheets: [{ groupSubtotal: true, items }] }).subtotal)).toBe(dung);
    expect(pdfTotals({ vatPercent: 0, sheets: [{ groupSubtotal: true, items }] }).gross).toBe(dung);
  });
});

// ── Tệp Excel ────────────────────────────────────────────────────────────────────────────────────
// marico_decor (GN): cột Excel SL=F · ĐG=G · Thành Tiền=H; hàng editor k → hàng Excel 11 + k.
const baoGia = (items, { code = "marico_decor", groupSubtotal = true } = {}) => ({
  quoteNumber: "FP_B26_023", title: "T", toCompany: "K", city: "TP. Hồ Chí Minh", quoteDate: new Date("2026-11-25"), vatPercent: 8, hnTables: [],
  sheets: [{ order: 1, name: "Cổng", groupSubtotal, discount: 0, extraTables: [], template: { code },
    items: items.map((it, i) => ({ order: i + 1, ...it })) }],
});
async function moTep(q) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await buildQuoteBuffer(q));
  return wb.worksheets[0];
}
/** Mô phỏng Excel TÍNH LẠI sheet (fullCalcOnLoad): mỗi ô công thức tính từ CÁC Ô nó trỏ tới, không dùng
 *  số `result` đã ghi sẵn. Công thức Excel dùng "." thập phân và "," tách đối số → đổi "," thành ";". */
function excelTinhLai(ws) {
  const nho = new Map();
  const so = (addr) => {
    const a = addr.replace(/\$/g, "").toUpperCase();
    if (nho.has(a)) return nho.get(a);
    const v = ws.getCell(a).value;
    let kq = 0;
    if (v && typeof v === "object" && "formula" in v) kq = evalEditorFormula("=" + v.formula.replace(/,/g, ";"), refs) ?? NaN;
    else if (typeof v === "number") kq = v;
    nho.set(a, kq);
    return kq;
  };
  const refs = {
    cell: so,
    range: (a, b) => {
      const pa = /^\$?([A-Z]+)\$?(\d+)$/i.exec(a), pb = /^\$?([A-Z]+)\$?(\d+)$/i.exec(b);
      if (pa[1].toUpperCase() !== pb[1].toUpperCase()) throw new Error("dải nhiều cột — bài này chưa cần");
      const out = [];
      for (let r = Math.min(+pa[2], +pb[2]); r <= Math.max(+pa[2], +pb[2]); r++) out.push(so(pa[1] + r));
      return out;
    },
  };
  return so;
}
/** Mọi ô công thức trong sheet: Excel tính lại phải ra ĐÚNG số app ghi sẵn (result). */
function lechKhiTinhLai(ws) {
  const so = excelTinhLai(ws), lech = [];
  ws.eachRow((row) => row.eachCell((c) => {
    const v = c.value;
    if (!v || typeof v !== "object" || !("formula" in v) || v.formula.includes("!")) return;
    const excel = so(c.address);
    if (!(Math.abs(excel - Number(v.result ?? 0)) < 1e-6)) lech.push(`${c.address} =${v.formula}: Excel ${excel}, app ${v.result}`);
  }));
  return lech;
}
/** Giá trị Excel TÍNH LẠI của mọi ô công thức (để tìm Tổng Cộng / VAT / Thành Tiền sheet). */
function moiOCongThuc(ws) {
  const so = excelTinhLai(ws), out = [];
  ws.eachRow((row) => row.eachCell((c) => { const v = c.value; if (v && typeof v === "object" && "formula" in v && !v.formula.includes("!")) out.push(so(c.address)); }));
  return out;
}

describe("xuất Excel: ô Thành Tiền nhóm SL 0,5 và tổng sheet ra 14.631.330 sau khi Excel tính lại", () => {
  it("sheet 'Cổng': H12 = G12*F12, F12 = 0,5; Excel tính lại H12 = Tổng Cộng = 14.631.330, VAT + Thành Tiền khớp số lưu", async () => {
    const q = baoGia(cong108());
    const ws = await moTep(q);
    expect(ws.getCell("F12").value, "ô SL nhóm mang đúng số đang hiện").toBe(0.5);
    expect(ws.getCell("G12").value).toMatchObject({ formula: "SUM(H13:H15)", result: tongCong });
    expect(ws.getCell("H12").value, "ô Thành Tiền nhóm phải ×SL nhóm — bản cũ ghi G12 (×1)").toMatchObject({ formula: "G12*F12", result: 14_631_330 });
    const so = excelTinhLai(ws);
    expect(so("H12")).toBe(14_631_330);
    expect(lechKhiTinhLai(ws), "Excel mở tệp ra số khác app").toEqual([]);
    const soLuu = computeQuoteTotals({ vatPercent: 8, sheets: q.sheets });
    expect([Number(soLuu.subtotal), Number(soLuu.vat), Number(soLuu.total)]).toEqual([14_631_330, 1_170_506, 15_801_836]);
    expect(moiOCongThuc(ws), "Tổng Cộng / VAT / Thành Tiền trong tệp").toEqual(expect.arrayContaining([14_631_330, 1_170_506, 15_801_836]));
  });

  it("nhóm thứ hai SL TRỐNG giữ công thức cũ (= đơn giá nhóm), ô trỏ =G1*10% dịch thành công thức sống trỏ H12", async () => {
    const q = baoGia(cong108HaiNhom());
    const ws = await moTep(q);
    expect(ws.getCell("H16").value, "nhóm SL trống: công thức như trước bản sửa").toMatchObject({ formula: "G16", result: 1_763_133 });
    // Bộ tự kiểm (heSoNhom) phải cùng luật với ô H12, không thì tham chiếu bị huỷ → ghi số chết.
    expect(ws.getCell("G17").value).toMatchObject({ formula: "H12*10%", result: 1_463_133 });
    expect(lechKhiTinhLai(ws)).toEqual([]);
    const dung = 14_631_330 + 1_763_133;
    expect(Number(computeQuoteTotals({ vatPercent: 8, sheets: q.sheets }).subtotal)).toBe(dung);
    expect(moiOCongThuc(ws)).toEqual(expect.arrayContaining([dung]));
  });

  it("SL nhóm 1 / trống / 0 / âm giữ NGUYÊN ký tự công thức cũ (= đơn giá nhóm); SL 2 vẫn ×SL như cũ", async () => {
    for (const [sl, ct] of [[1, "G12"], [undefined, "G12"], [0, "G12"], [-1, "G12"], [2, "G12*F12"], [1.04, "G12"]]) {
      const ws = await moTep(baoGia([nhom({ quantity: sl }), MUC]));
      expect(ws.getCell("H12").value?.formula, `SL nhóm ${sl}`).toBe(ct);
      expect(lechKhiTinhLai(ws), `SL nhóm ${sl}`).toEqual([]);
    }
  });

  it("bản BANNER (gn_banner): nhóm cha SL 0,5 có mục lẻ + nhóm con — Tổng Cộng nhân mục lẻ ×SL cha, khớp số lưu", async () => {
    const items = [
      nhom({ name: "Cha", quantity: 0.5 }),
      { kind: "item", name: "Lẻ", unit: "cái", quantity: 1, unitPrice: 1_000_000 },
      { kind: "subsection", name: "Con", unit: "gói", quantity: 2, unitPrice: 0 },
      { kind: "item", name: "Trong con", unit: "cái", quantity: 1, unitPrice: 300_000 },
    ];
    const q = baoGia(items, { code: "gn_banner" });
    const ws = await moTep(q);
    expect(lechKhiTinhLai(ws)).toEqual([]);
    const dung = 0.5 * 1_000_000 + 2 * 300_000;
    expect(WEB.sheetSubtotalGrouped(items, false, true)).toBe(dung);
    expect(Number(computeQuoteTotals({ vatPercent: 8, sheets: q.sheets }).subtotal)).toBe(dung);
    expect(moiOCongThuc(ws), "Tổng Cộng trong tệp").toEqual(expect.arrayContaining([dung]));
  });
});

describe("PDF in đúng con số lưới hiện", () => {
  let chu = [];
  beforeEach(() => {
    chu = [];
    const goc = PDFDocument.prototype.text;
    vi.spyOn(PDFDocument.prototype, "text").mockImplementation(function (t, ...rest) { chu.push(String(t)); return goc.call(this, t, ...rest); });
  });
  afterEach(() => vi.restoreAllMocks());

  it("hàng nhóm 'Cổng Aeon BT': Đơn Giá 29.262.660, Thành Tiền 14.631.330", async () => {
    await renderQuotePdf({
      quoteNumber: "FP_B26_023", title: "T", quoteDate: new Date("2026-11-25"), company: { name: "Cty" }, subtotal: 0, vat: 0, total: 0, vatPercent: 8,
      sheets: [{ name: "Cổng", groupSubtotal: true, items: cong108() }],
    });
    const i = chu.indexOf("Cổng Aeon BT");
    expect(i, "không thấy hàng nhóm trong PDF").toBeGreaterThanOrEqual(0);
    const hang = chu.slice(i, i + 6);
    expect(hang).toContain((29_262_660).toLocaleString("vi-VN"));
    expect(hang, "PDF in Thành Tiền nhóm ×1").toContain((14_631_330).toLocaleString("vi-VN"));
    expect(hang.filter((t) => t === (29_262_660).toLocaleString("vi-VN")), "29.262.660 chỉ được là Đơn Giá nhóm, không phải cả Thành Tiền").toHaveLength(1);
  });
});
