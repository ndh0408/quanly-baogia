// SỐ LƯỢNG KHÁC 0 MÀ NHỎ HƠN 0,05 KHÔNG ĐƯỢC LÀM TRÒN THÀNH 0 (chủ repo 2026-11-09).
//
// Báo giá #101 (FP_A26_049, nháp): gõ "=0.3*0.15" vào ô Số Lượng → app lưu đúng 0,045 nhưng Thành Tiền
// TRỐNG. Luật "làm tròn Số Lượng về 1 số lẻ" (99ad4ef, 2026-06-30) cho qtyRound(0,045) = 0 → 0 × giá = 0.
// Quyết định của chủ repo: phép tính ra < 0,05 thì làm tròn thành 0,1. Tức 0 < |SL| < 0,05 → ±0,1; SL = 0
// vẫn 0; mọi giá trị khác ROUND_HALF_UP 1 số lẻ như cũ; dòng quantityExact (4 số lẻ) không đổi. Số lưu
// trong CSDL giữ nguyên số thô.
//
// Luật có NHIỀU BẢN SAO (shared/ không import được src/ và ngược lại): shared/quote-math.ts, src/money.ts
// (number + Decimal), src/excel.ts, src/pdf.ts, src/excelImport.ts, src/quoteFormula.ts. Bài này chạy MỌI
// bản trên cùng bảng giá trị — sót một bản là web, số lưu, PDF, tệp Excel ra bốn con số khác nhau.
// Ô SL có công thức trong tệp Excel còn phải tự ra 0,1 khi Excel tính lại (fullCalcOnLoad): chỉ bọc
// ROUND(…,1) như cũ thì Excel ra 0 và Thành Tiền 0, trong khi app/PDF ra 0,1 × giá.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import * as WEB from "../shared/quote-math.js";
import { qtyRound as qtyRoundMayChu, computeQuoteTotals } from "../src/money.js";
import { pdfTotals, renderQuotePdf } from "../src/pdf.js";
import { buildFormulaContext, evalEditorFormula, unwrapSoLuong } from "../src/quoteFormula.js";
import { buildQuoteBuffer } from "../src/excel.js";
import { parseQuoteWorkbook, computeSubtotal } from "../src/excelImport.js";
import { extraTableSum } from "../src/quoteUtils.js";
import { reconstructExportRows, retargetPastedFormulas, khopCotThanhTien } from "../web/src/lib/clipboard.ts";
import { diffItems } from "../web/src/lib/importApply.js";

// [SL thô, SL app dùng để hiện + tính tiền]
const BANG = [
  [0.045, 0.1], [0.01, 0.1], [0.0001, 0.1], [0.0499, 0.1], [-0.03, -0.1], [0, 0],
  [0.05, 0.1], [0.72, 0.7], [0.96, 1], [7.378, 7.4], [-7.378, -7.4], [5.65, 5.7],
];
const GIA = 1_000_000;
const dong = (quantity, unitPrice = GIA, extra = {}) => ({ kind: "item", name: "Hạng mục", quantity, unitPrice, ...extra });

// Mẫu GN: cột editor A=_stt B=name C=detail D=unit E=quantity F=unitPrice G=_amount H=notes
const GN_COLS = { stt: "B", name: "C", detail: "D", unit: "E", quantity: "F", unitPrice: "G", amount: "H", notes: "I" };
const slBoTuKiem = (it) => buildFormulaContext({ cols: GN_COLS, items: [it], rowToExcel: () => 12 })._editorRefs.cell("E1");
const tienBoTuKiem = (it) => buildFormulaContext({ cols: GN_COLS, items: [it], rowToExcel: () => 12 })._editorRefs.cell("G1");

describe("mọi bản qtyRound / qtyForAmount ra CÙNG một số", () => {
  for (const [tho, app] of BANG) {
    it(`SL ${tho} → ${app}`, () => {
      const tien = Math.round(app * GIA);
      expect(WEB.qtyRound(tho), "shared/quote-math.ts").toBe(app);
      expect(qtyRoundMayChu(tho), "src/money.ts qtyRound").toBe(app);
      expect(WEB.lineAmount(dong(tho), false), "Thành Tiền lưới web").toBe(tien);
      const soLuu = computeQuoteTotals({ vatPercent: 0, sheets: [{ items: [dong(tho)] }] });
      expect(Number(soLuu.sheetTotals[0].gross), "src/money.ts Decimal (số lưu)").toBe(tien);
      expect(pdfTotals({ vatPercent: 0, sheets: [{ items: [dong(tho)] }] }).gross, "src/pdf.ts").toBe(tien);
      expect(computeSubtotal({ items: [dong(tho)], hasDays: false, groupSubtotal: false }), "src/excelImport.ts").toBe(tien);
      expect(extraTableSum({ items: [dong(tho)] }), "bảng nội bộ (src/quoteUtils.ts)").toBe(tien);
      expect(slBoTuKiem(dong(tho)), "bộ tự kiểm công thức (src/quoteFormula.ts)").toBe(app);
      expect(tienBoTuKiem(dong(tho))).toBe(tien);
    });
  }

  it("ô SL hiện 0,1 cho SL 0,045 (không còn ô trống)", () => {
    expect(WEB.fmtNumCell(0.045)).toBe("0,1");
    expect(WEB.fmtNumCell(-0.03)).toBe("-0,1");
    expect(WEB.fmtNumCell(0)).toBe("");
  });

  it("dòng quantityExact (4 số lẻ) KHÔNG đổi luật: 0,045 vẫn là 0,045", () => {
    const it0 = dong(0.045, 2_200_000, { quantityExact: true });
    expect(WEB.qtyForAmount(it0)).toBe(0.045);
    expect(WEB.lineAmount(it0, false)).toBe(99_000);
    expect(Number(computeQuoteTotals({ vatPercent: 0, sheets: [{ items: [it0] }] }).subtotal)).toBe(99_000);
    expect(pdfTotals({ vatPercent: 0, sheets: [{ items: [it0] }] }).gross).toBe(99_000);
    expect(slBoTuKiem(it0)).toBe(0.045);
    expect(extraTableSum({ items: [it0] })).toBe(99_000);
  });

  it("nhóm SL 0,03: hiện 0,1 nhưng hệ số nhóm vẫn ×1 (như mọi SL ≤ 1)", () => {
    const items = [{ kind: "section", name: "N", quantity: 0.03 }, dong(2, 100_000)];
    expect(WEB.groupMult(items[0])).toBe(1);
    expect(Number(computeQuoteTotals({ vatPercent: 0, sheets: [{ groupSubtotal: true, items }] }).subtotal)).toBe(200_000);
    expect(pdfTotals({ vatPercent: 0, sheets: [{ groupSubtotal: true, items }] }).subtotal).toBe(200_000);
  });
});

describe("báo giá #101: SL =0.3*0.15 (0,045) × 2.200.000", () => {
  const items = [dong(0.045, 2_200_000, { formulas: { quantity: "=0.3*0.15" } })];
  it("Thành Tiền 220.000, VAT 8% = 17.600, Tổng 237.600 — web = số lưu (Decimal) = PDF", () => {
    const q = { vatPercent: 8, sheets: [{ groupSubtotal: false, discount: 0, items }] };
    const web = WEB.quoteTotals([WEB.sheetTotals(q.sheets[0], false)], 8);
    const soLuu = computeQuoteTotals(q);
    const pdf = pdfTotals(q);
    expect(web).toMatchObject({ subtotal: 220_000, vat: 17_600, total: 237_600 });
    expect([Number(soLuu.subtotal), Number(soLuu.vat), Number(soLuu.total)]).toEqual([220_000, 17_600, 237_600]);
    expect([pdf.subtotal, pdf.vat, pdf.total]).toEqual([220_000, 17_600, 237_600]);
  });
});

// ── Tệp Excel ────────────────────────────────────────────────────────────────────────────────────
// unibenfood (GN có ngày, không Chi Tiết): cột Excel quantity=E days=F unitPrice=G amount=H; hàng 1 → 12.
const baoGia = (items, extra = {}) => ({
  quoteNumber: "SLNHO", title: "T", toCompany: "K", city: "TP. Hồ Chí Minh", quoteDate: new Date("2026-11-09"), vatPercent: 8, hnTables: [],
  sheets: [{ order: 1, name: "S", groupSubtotal: false, discount: 0, extraTables: [], template: { code: "unibenfood" },
    items: items.map((it, i) => ({ order: i + 1, unit: "m2", days: 1, ...it })), ...extra }],
});
async function moTep(q) {
  const buf = await buildQuoteBuffer(q);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf);
  return { ws: wb.worksheets[0], buf };
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
    // ExcelJS không ghi lại result = 0 (đọc về là undefined) → coi như 0.
    if (!(Math.abs(excel - Number(v.result ?? 0)) < 1e-9)) lech.push(`${c.address} =${v.formula}: Excel ${excel}, app ${v.result}`);
  }));
  return lech;
}

describe("xuất Excel: hàng SL 0,045 ra đúng số app hiển thị", () => {
  it("SL công thức =0.3*0.15: ô SL bọc MAX(ROUND(…,1),0.1) — Excel tính lại ra 0,1 và Thành Tiền 220.000", async () => {
    const { ws } = await moTep(baoGia([dong(0.045, 2_200_000, { formulas: { quantity: "=0.3*0.15" } })]));
    const sl = ws.getCell("E12").value;
    expect(sl).toMatchObject({ formula: "MAX(ROUND(0.3*0.15,1),0.1)", result: 0.1 });
    expect(ws.getCell("H12").value.result).toBe(220_000);
    expect(lechKhiTinhLai(ws), "Excel mở tệp ra số khác app/PDF").toEqual([]);
    const so = excelTinhLai(ws);
    expect(so("E12")).toBe(0.1);
    expect(so("H12")).toBe(220_000);
    // Tổng Cộng / VAT / Thành Tiền của sheet khớp số lưu.
    const ketQua = [];
    ws.eachRow((row) => row.eachCell((c) => { const v = c.value; if (v && typeof v === "object" && "formula" in v) ketQua.push(so(c.address)); }));
    expect(ketQua).toEqual(expect.arrayContaining([220_000, 17_600, 237_600]));
  });

  it("SL không công thức 0,045 → ghi SỐ 0,1; SL âm =-0.2*0.15 → MIN(…,-0.1); SL thường giữ ROUND(…,1) như cũ", async () => {
    const { ws } = await moTep(baoGia([
      dong(0.045, 2_200_000),
      dong(-0.03, 1_000_000, { formulas: { quantity: "=-0.2*0.15" } }),
      dong(0.72, 100_000, { formulas: { quantity: "=0.8*0.9" } }),
      dong(0.045, 2_200_000, { quantityExact: true, formulas: { quantity: "=0.3*0.15" } }),
      dong(0, 500_000),
    ]));
    expect(ws.getCell("E12").value).toBe(0.1);
    expect(ws.getCell("H12").value.result).toBe(220_000);
    expect(ws.getCell("E13").value).toMatchObject({ formula: "MIN(ROUND(-0.2*0.15,1),-0.1)", result: -0.1 });
    expect(ws.getCell("H13").value.result).toBe(-100_000);
    expect(ws.getCell("E14").value, "tệp của SL thường không được đổi").toMatchObject({ formula: "ROUND(0.8*0.9,1)", result: 0.7 });
    expect(ws.getCell("E15").value, "dòng quantityExact giữ nguyên").toMatchObject({ formula: "0.3*0.15", result: 0.045 });
    expect(ws.getCell("H15").value.result).toBe(99_000);
    expect(ws.getCell("G16").value).toBe(500_000);
    expect(excelTinhLai(ws)("H16"), "SL = 0 vẫn là 0").toBe(0);
    expect(lechKhiTinhLai(ws)).toEqual([]);
  });

  it("SL trỏ ô TỔNG NHÓM ra số nhỏ (=F2/40000000 = 0,025): công thức sống, Excel tính lại khớp app", async () => {
    // Hàng lẻ trước nhóm nên không vòng; ô Đơn Giá nhóm = Σ mục = 1.000.000.
    const { ws } = await moTep(baoGia([
      dong(0.025, 2_200_000, { name: "Phí", formulas: { quantity: "=F2/40000000" } }),
      { kind: "section", name: "Nhóm", quantity: 0 },
      dong(1, 1_000_000, { name: "Mục" }),
    ]));
    const sl = ws.getCell("E12").value;
    expect(sl && typeof sl === "object" ? sl.formula : sl).toMatch(/^MAX\(ROUND\(G13\/40000000,1\),0\.1\)$/);
    expect(ws.getCell("H12").value.result).toBe(220_000);
    expect(lechKhiTinhLai(ws)).toEqual([]);
  });

  it("nạp lại tệp vừa xuất: công thức gốc + SL thô 0,045 về nguyên vẹn, không cảnh báo", async () => {
    const { buf } = await moTep(baoGia([
      dong(0.045, 2_200_000, { name: "Decal", formulas: { quantity: "=0.3*0.15" } }),
      dong(-0.03, 1_000_000, { name: "Trừ", formulas: { quantity: "=-0.2*0.15" } }),
    ]));
    const sheet = (await parseQuoteWorkbook(Buffer.from(buf))).sheets.find((s) => !s.skipped);
    const decal = sheet.items.find((x) => x.name === "Decal"), tru = sheet.items.find((x) => x.name === "Trừ");
    expect(decal.formulas?.quantity).toBe("=0.3*0.15");
    expect(decal.quantity).toBeCloseTo(0.045, 10);
    expect(decal.warn ?? []).toEqual([]);
    expect(tru.formulas?.quantity).toBe("=-0.2*0.15");
    expect(tru.quantity).toBeCloseTo(-0.03, 10);
    expect(tru.warn ?? []).toEqual([]);
    expect(computeSubtotal(sheet)).toBe(120_000);
  });
});

describe("unwrapSoLuong — bóc đúng lớp app bọc, không bóc nhầm", () => {
  it.each([
    ["MAX(ROUND(0.3*0.15,1),0.1)", "0.3*0.15"],
    ["=MIN(ROUND(-0.2*0.15,1),-0.1)", "-0.2*0.15"],
    ["ROUND(E12,1)", "E12"],
    ["max( ROUND(E12*2, 1) , 0.1 )", "E12*2"],
    // Không phải lớp của app → giữ nguyên.
    ["MAX(ROUND(E12,1),-0.1)", "MAX(ROUND(E12,1),-0.1)"],
    ["MIN(ROUND(E12,1),0.1)", "MIN(ROUND(E12,1),0.1)"],
    ["MAX(ROUND(E12,1),ROUND(E13,1),0.1)", "MAX(ROUND(E12,1),ROUND(E13,1),0.1)"],
    ["MAX(E12,0.1)", "MAX(E12,0.1)"],
    ["ROUND(E12,1)+ROUND(E13,1)", "ROUND(E12,1)+ROUND(E13,1)"],
  ])("%s → %s", (vao, ra) => {
    expect(unwrapSoLuong(vao)).toBe(ra);
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

  it("hàng SL 0,045 × 2.200.000: SL in 0,1, Thành Tiền in 220.000", async () => {
    await renderQuotePdf({
      quoteNumber: "SLNHO", title: "T", quoteDate: new Date("2026-11-09"), company: { name: "Cty" }, subtotal: 0, vat: 0, total: 0, vatPercent: 8,
      sheets: [{ name: "S1", groupSubtotal: false, items: [{ kind: "item", name: "Decal", unit: "m2", quantity: 0.045, unitPrice: 2_200_000 }] }],
    });
    const hang = chu.slice(chu.indexOf("Decal"), chu.indexOf("Decal") + 5);   // [tên, ĐVT, SL, Đơn giá, Thành tiền]
    expect(hang[2]).toBe("0,1");
    expect(hang[4]).toBe((220_000).toLocaleString("vi-VN"));
  });
});

describe("lưới web: dán khối Excel + bảng đối chiếu nhập Excel dùng CÙNG luật", () => {
  const ROLES = ["_stt", "name", "detail", "unit", "quantity", "unitPrice", "_amount"];
  const NUM = new Set(["quantity", "unitPrice", "days"]);
  const webLetter = (role) => ({ quantity: "E", unitPrice: "F", _amount: "G" })[role] || null;

  it("dán SL '=F12*0.15' (0,3 × 0,15 = 0,045) mà Thành Tiền 220.000 → dịch '=E1*0.15', không cờ đỏ", () => {
    const m = [
      ["1", "Khung", "", "m2", "0.3", "1,000", "300"],
      ["2", "Decal", "", "m2", "=F12*0.15", "2,200,000", "220,000"],
    ];
    const built = reconstructExportRows(m, ROLES, NUM, false);
    retargetPastedFormulas(built, m, ROLES, { webLetter, baseRow: 0 });
    expect(built[1].formulas.quantity).toBe("=E1*0.15");
    expect(built[1].quantity).toBeCloseTo(0.045, 10);
    expect(built[1]._fxWarn, "tự kiểm Thành Tiền tính SL 0,045 thành 0 → ô đỏ oan").toBeUndefined();
  });

  it("khối có cột Thành Tiền: SL 0,045 × 2.200.000 = 220.000 được nhận là cột Thành Tiền", () => {
    expect(khopCotThanhTien([["1", "Decal", "", "m2", "0,045", "2.200.000", "220.000"]], ROLES)).toBe(true);
  });

  it("nhập Excel đổi SL 0 → 0,045: bảng đối chiếu báo ĐỔI (Thành Tiền 0 → 220.000), không phải 'giữ nguyên'", () => {
    const truoc = [{ kind: "item", name: "Decal", unit: "m2", quantity: 0, unitPrice: 2_200_000 }];
    const sau = [{ kind: "item", name: "Decal", unit: "m2", quantity: 0.045, unitPrice: 2_200_000 }];
    const [hang] = diffItems(truoc, sau, false);
    expect(hang.kind).toBe("changed");
    expect(hang.fields.find((f) => f.field === "quantity")).toMatchObject({ before: 0, after: 0.1 });
  });
});
