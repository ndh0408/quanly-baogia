// HỆ SỐ NHÓM LẺ (0,7 / 2,3 / 4 số lẻ) — web, máy chủ, PDF, Excel, bộ nạp Excel phải ra CÙNG MỘT ĐỒNG (2026-11-25).
//
// Từ hôm nay hệ số nhóm = SL nhóm đang hiện nếu > 0 (0,5 → ×0,5; trước kẹp tối thiểu 1 — tests/xg-he-so-nhom-duoi-1.test.js),
// nên hệ số lẻ thành chuyện thường. tests/cinetour-so-ca.test.js (bảng ngẫu nhiên) đỏ ở lần 50: nhóm SL 0,7 trên năm dòng
// (Thành Tiền 2.744.188 · 129.497 · 475.258 · 5.496.093 · 1.213.259 = 10.058.295). Máy chủ (src/money.ts, Decimal) cộng
// Σ dòng × 0,7 = 7.040.806,5 → 7.040.807; lưới web (`sum += lineAmount × mult` bằng double) ra 7.040.806,4999… → 7.040.806 —
// lệch 1đ ở Tổng, VAT (563.265 ↔ 563.264) và Thành Tiền (7.604.072 ↔ 7.604.070). PDF (sheetGross), Excel (Tổng Cộng ghi sẵn),
// bộ nạp Excel (computeSubtotal) cùng cách cộng double nên cùng lệch; ô Thành tiền nhóm của lưới và PDF thì in "7.040.806,5".
//
// Chuẩn: MÁY CHỦ (Decimal) và Excel (ô Thành tiền nhóm = Đơn giá nhóm × SL nhóm, Tổng Cộng = ROUND(Σ…)). Cách sửa: cộng
// Thành Tiền dòng (nguyên) theo TỪNG nhóm rồi nhân hệ số CHÍNH XÁC (hệ số × 10^4 trên BigInt), làm tròn nửa-lên MỘT lần —
// shared/quote-math.ts congTheoHeSoNhom + BẢN SAO src/tienDong.ts. Bài này chạy MỌI bản trên cùng dữ liệu.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { Prisma } from "@prisma/client";
import * as WEB from "../shared/quote-math.js";
import * as MAY from "../src/tienDong.js";
import { computeQuoteTotals } from "../src/money.js";
import { pdfTotals, renderQuotePdf } from "../src/pdf.js";
import { buildFormulaContext, evalEditorFormula } from "../src/quoteFormula.js";
import { buildQuoteBuffer } from "../src/excel.js";
import { parseQuoteWorkbook, computeSubtotal } from "../src/excelImport.js";
import { getConfig } from "../src/templateConfigs.js";

const { Decimal } = Prisma;
const hang = (o) => ({ kind: "item", unit: "người", quantity: 1, unitPrice: 0, days: null, shifts: null, ...o });

// ── Ca lần 50 của tests/cinetour-so-ca.test.js (mẫu CINETOUR không ngày: có Số Ca) ─────────────────────────────────
const LAN50 = () => [
  { kind: "section", name: "Nhóm 0,7", unit: "gói", quantity: 0.7, unitPrice: 0 },
  hang({ name: "Dòng 1", quantity: 8.4, unitPrice: 326689 }),
  hang({ name: "Dòng 2", quantity: 0.6, unitPrice: 215827.5 }),
  hang({ name: "Dòng 3", quantity: 4.6, unitPrice: 34439, shifts: 3 }),
  hang({ name: "Dòng 4", quantity: 6, unitPrice: 305338.5, shifts: 3 }),
  hang({ name: "Dòng 5", quantity: 8.1, unitPrice: 59914, shifts: 2.5 }),
];
const TIEN_DONG = [2_744_188, 129_497, 475_258, 5_496_093, 1_213_259];
const DON_GIA_NHOM = 10_058_295;
const DUNG = { subtotal: 7_040_807, vat: 563_265, total: 7_604_072 };   // 7.040.806,5 → 7.040.807; × 8% = 563.264,56 → 563.265

const MA = "gn_cinetour";
const baoGia = (items, extra = {}) => ({
  id: 1, quoteNumber: "GN26998", title: "Hệ số nhóm lẻ", toCompany: "K", city: "TP. Hồ Chí Minh", quoteDate: new Date("2026-11-25T00:00:00Z"),
  vatPercent: 8, hnTables: [], company: { name: "Cty" },
  sheets: [{ id: 1, order: 1, name: "Rạp", templateCode: MA, template: { code: MA }, groupSubtotal: true, discount: 0, extraTables: [],
    items: items.map((it, i) => ({ order: i + 1, ...it })), ...extra }],
});

/** TÍNH LẠI một sheet Excel như Excel mở tệp (fullCalcOnLoad) — ô công thức tính từ CÁC Ô nó trỏ tới, không dùng result. */
function tinhLaiExcel(ws) {
  const daTinh = new Map();
  const soCot = (L) => [...L].reduce((a, c) => a * 26 + c.charCodeAt(0) - 64, 0);
  const chuCot = (n) => { let s = ""; while (n > 0) { const d = (n - 1) % 26; s = String.fromCharCode(65 + d) + s; n = Math.floor((n - 1) / 26); } return s; };
  const o = (addr) => {
    const a = addr.replace(/\$/g, "").toUpperCase();
    if (daTinh.has(a)) return daTinh.get(a);
    daTinh.set(a, NaN);
    const cell = ws.getCell(a);
    let kq = 0;
    if (cell.formula) {
      kq = evalEditorFormula(`=${cell.formula.replace(/,/g, ";")}`, {
        cell: (x) => o(x),
        range: (x, y) => {
          const p = /^\$?([A-Z]+)\$?(\d+)$/i.exec(x), q = /^\$?([A-Z]+)\$?(\d+)$/i.exec(y);
          const out = [];
          for (let r = Math.min(+p[2], +q[2]); r <= Math.max(+p[2], +q[2]); r++)
            for (let c = Math.min(soCot(p[1]), soCot(q[1])); c <= Math.max(soCot(p[1]), soCot(q[1])); c++) out.push(o(`${chuCot(c)}${r}`));
          return out;
        },
      });
      if (kq == null) throw new Error(`không tính lại được ô ${a}: =${cell.formula}`);
    } else if (typeof cell.value === "number") kq = cell.value;
    daTinh.set(a, kq);
    return kq;
  };
  return o;
}
const chu = (v) => (v && typeof v === "object" && Array.isArray(v.richText)) ? v.richText.map((x) => x.text).join("") : String(v ?? "");
/** Hàng Tổng Cộng / VAT / Thành Tiền của khối tổng (mẫu không Discount) — theo nhãn, như cinetour-so-ca. */
function khoiTong(ws) {
  const t = getConfig(MA).totals, nhanCot = t.subtotal.labelCells[0][0], tienCot = t.subtotal.valueCell;
  const hangNhan = (re) => { let r = null; ws.eachRow((row, i) => { if (!r && re.test(chu(row.getCell(nhanCot).value).trim())) r = i; }); return r; };
  return { tienCot, rTong: hangNhan(/^Tổng Cộng$/), rVat: hangNhan(/^VAT/), rTT: hangNhan(/^Thành Tiền$/) };
}
const hangTheoTen = (ws, ten) => { const cot = getConfig(MA).items.columns.name; let r = null; ws.eachRow((row, i) => { if (!r && chu(row.getCell(cot).value).trim() === ten) r = i; }); return r; };

describe("ca lần 50 — nhóm SL 0,7 × 10.058.295", () => {
  it("chứng minh cách cũ sai: Σ (dòng × 0,7) bằng double = 7.040.806,4999… → 7.040.806", () => {
    let cu = 0;
    for (const a of TIEN_DONG) cu += a * 0.7;
    expect(cu).toBeLessThan(7_040_806.5);
    expect(Math.round(cu)).toBe(7_040_806);
    expect(Number(new Decimal(DON_GIA_NHOM).times(0.7).toDecimalPlaces(0, Decimal.ROUND_HALF_UP))).toBe(DUNG.subtotal);
  });

  it("lưới web = máy chủ (Decimal) = PDF = bộ nạp Excel: 7.040.807 · VAT 563.265 · Thành Tiền 7.604.072", () => {
    const items = LAN50();
    expect(items.slice(1).map((it) => WEB.lineAmount(it, false, true)), "Thành Tiền từng dòng (có Số Ca)").toEqual(TIEN_DONG);
    expect(WEB.sheetSubtotalGrouped(items, false, true, true), "shared/quote-math.ts sheetSubtotalGrouped").toBe(DUNG.subtotal);
    const sh = { items, groupSubtotal: true, discount: 0 };
    const web = WEB.quoteTotals([WEB.sheetTotals(sh, false, true)], 8);
    const may = computeQuoteTotals({ vatPercent: 8, sheets: [sh] });
    expect([Number(may.subtotal), Number(may.vat), Number(may.total)], "src/money.ts (số LƯU)").toEqual([DUNG.subtotal, DUNG.vat, DUNG.total]);
    expect([web.subtotal, web.vat, web.total], "lưới web").toEqual([DUNG.subtotal, DUNG.vat, DUNG.total]);
    expect(pdfTotals({ vatPercent: 8, sheets: [sh] }), "src/pdf.ts pdfTotals").toMatchObject({ gross: DUNG.subtotal, vat: DUNG.vat, total: DUNG.total });
    expect(computeSubtotal({ items, hasDays: false, hasShifts: true, groupSubtotal: true }), "src/excelImport.ts computeSubtotal").toBe(DUNG.subtotal);
  });

  it("ô Thành tiền nhóm: HIỆN 7.040.807 (nguyên, nửa-lên); giá trị ô (công thức trỏ vào) = 7.040.806,5 chính xác như ô Excel", () => {
    expect(WEB.nhanLamTronDong(DON_GIA_NHOM, 0.7), "số lưới / PDF hiện").toBe(7_040_807);
    expect(WEB.nhanHeSoNhom(DON_GIA_NHOM, 0.7)).toBe(7_040_806.5);
    expect(MAY.nhanHeSoNhom(DON_GIA_NHOM, 0.7)).toBe(7_040_806.5);
    // Bộ tự kiểm công thức (src/quoteFormula.ts soONhomWeb) đọc ô Thành tiền nhóm G1 — y GridTable.cellNum.
    // Sơ đồ cột editor của mẫu có Số Ca, không Chi Tiết: A STT · B Hạng mục · C ĐVT · D SL · E Số Ca · F Đơn giá · G Thành tiền.
    const cols = { stt: "B", name: "C", unit: "E", quantity: "F", shifts: "G", unitPrice: "H", amount: "I", notes: "J" };
    const boTuKiem = buildFormulaContext({ cols, items: LAN50(), rowToExcel: () => null, nhom: { groupSubtotal: true, numberSubs: false, oExcel: () => null } })._editorRefs;
    expect(boTuKiem.cell("F1"), "Đơn giá nhóm").toBe(DON_GIA_NHOM);
    expect(boTuKiem.cell("G1"), "Thành tiền nhóm — tích chính xác chưa làm tròn").toBe(7_040_806.5);
  });

  it("xuất Excel (gn_cinetour): ô nhóm = Đơn giá × SL (7.040.806,5), Tổng Cộng ghi sẵn = Excel tính lại = 7.040.807, VAT + Thành Tiền khớp số lưu", async () => {
    const q = baoGia(LAN50());
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await buildQuoteBuffer(q));
    const ws = wb.worksheets[0];
    const cot = getConfig(MA).items.columns;
    const rNhom = hangTheoTen(ws, "Nhóm 0,7");
    expect(rNhom, "không thấy hàng nhóm").toBeTruthy();
    const tinh = tinhLaiExcel(ws);
    expect(ws.getCell(`${cot.amount}${rNhom}`).value, "ô Thành tiền nhóm").toMatchObject({ formula: `${cot.unitPrice}${rNhom}*${cot.quantity}${rNhom}`, result: 7_040_806.5 });
    expect(tinh(`${cot.unitPrice}${rNhom}`)).toBe(DON_GIA_NHOM);
    const { tienCot, rTong, rVat, rTT } = khoiTong(ws);
    expect(rTong && rVat && rTT, "không thấy khối tổng").toBeTruthy();
    const oTong = ws.getCell(`${tienCot}${rTong}`).value;
    expect(oTong.formula, "hệ số lẻ → Tổng Cộng bọc ROUND như máy chủ").toMatch(/^ROUND\(/);
    expect(oTong.result, "Tổng Cộng ghi sẵn trong tệp — bản cũ 7.040.806").toBe(DUNG.subtotal);
    expect(tinh(`${tienCot}${rTong}`), "Excel tính lại Tổng Cộng").toBe(DUNG.subtotal);
    expect(tinh(`${tienCot}${rVat}`), "VAT").toBe(DUNG.vat);
    expect(tinh(`${tienCot}${rTT}`), "Thành Tiền").toBe(DUNG.total);
    // Nạp lại chính tệp đó: tổng tự tính = số lưu, không cảnh báo lệch.
    const kq = await parseQuoteWorkbook(Buffer.from(await buildQuoteBuffer(q)));
    const t = kq.sheets.find((s) => !s.skipped);
    expect(computeSubtotal(t), "nạp lại tệp xuất").toBe(DUNG.subtotal);
    expect((t.warnings || []).filter((w) => /lệch/.test(w))).toEqual([]);
  });

  describe("PDF in đúng con số lưới hiện", () => {
    let daIn = [];
    beforeEach(() => {
      daIn = [];
      const goc = PDFDocument.prototype.text;
      vi.spyOn(PDFDocument.prototype, "text").mockImplementation(function (t, ...rest) { daIn.push(String(t)); return goc.call(this, t, ...rest); });
    });
    afterEach(() => vi.restoreAllMocks());

    it("hàng nhóm: Đơn giá 10.058.295, Thành tiền 7.040.807 — không in \"7.040.806,5\"", async () => {
      await renderQuotePdf({ ...baoGia(LAN50()), subtotal: 0, vat: 0, total: 0 });
      const i = daIn.indexOf("Nhóm 0,7");
      expect(i, "không thấy hàng nhóm trong PDF").toBeGreaterThanOrEqual(0);
      const hangNhom = daIn.slice(i, i + 8);
      expect(hangNhom).toContain((DON_GIA_NHOM).toLocaleString("vi-VN"));
      expect(hangNhom, "Thành tiền nhóm in số lẻ / lệch").toContain((7_040_807).toLocaleString("vi-VN"));
      expect(daIn.some((t) => /,5$/.test(t) && t.startsWith("7.040.806")), "PDF in ',5'").toBe(false);
    });
  });
});

// ── Vòng ngẫu nhiên: hệ số nhóm lẻ 0,1–3,9 và 4 số lẻ (quantityExact), so lưới web với máy chủ TỪNG ĐỒNG ───────────────
function sinhSheet(rnd) {
  const coNgay = rnd() < 0.35, coCa = rnd() < 0.35;
  const items = [];
  const n = 2 + Math.floor(rnd() * 12);
  for (let k = 0; k < n; k++) {
    const x = rnd();
    if (x < 0.25) {
      const loai = rnd();
      // Hệ số lẻ 1 số (0,1–3,9), 4 số lẻ (quantityExact), và vài ca ×1 (trống / 0 / âm) cho đủ luật.
      const g = loai < 0.55 ? { quantity: (1 + Math.floor(rnd() * 39)) / 10 }
        : loai < 0.9 ? { quantity: (1 + Math.floor(rnd() * 39_999)) / 10_000, quantityExact: true }
          : { quantity: [0, null, -1, 1][Math.floor(rnd() * 4)] };
      items.push({ kind: rnd() < 0.3 ? "subsection" : "section", name: "N", unit: "", unitPrice: 0, ...g });
      continue;
    }
    if (x < 0.3) { items.push({ kind: "info", name: "ghi chú" }); continue; }
    items.push(hang({
      kind: rnd() < 0.2 ? "sub" : "item",
      quantity: rnd() < 0.15 ? (1 + Math.floor(rnd() * 9_999)) / 10_000 : Math.round(rnd() * 120) / 10,
      quantityExact: rnd() < 0.15,
      unitPrice: (rnd() < 0.1 ? -1 : 1) * (Math.round(rnd() * 900_000) + (rnd() < 0.35 ? 0.5 : 0)),
      days: coNgay && rnd() < 0.85 ? Math.round(rnd() * 10) / 2 : null,
      shifts: coCa && rnd() < 0.85 ? Math.round(rnd() * 8) / 2 : null,
    }));
  }
  return { coNgay, coCa, sh: { items, groupSubtotal: rnd() < 0.85, discount: rnd() < 0.15 ? Math.round(rnd() * 200_000) : 0 } };
}
/** Sheet SÁT ,5: mỗi nhóm hệ số lẻ 1 số lẻ (k/10, k lẻ) và một dòng cân để tổng nhóm tận cùng 5 → tích đúng ,5 — chỗ double
 *  cũ hay làm tròn nhầm (đo: ~3,5% ca như vậy). Bộ sinh thường hiếm khi rơi đúng ,5 nên một mình nó không chạm được lỗi. */
function sinhSatNam(rnd) {
  const items = [];
  for (let g = 1 + Math.floor(rnd() * 3); g > 0; g--) {
    items.push({ kind: "section", name: "N", unit: "", unitPrice: 0, quantity: (2 * Math.floor(rnd() * 20) + 1) / 10 });
    let tong = 0;
    for (let n = 1 + Math.floor(rnd() * 5); n > 0; n--) {
      const it = hang({ quantity: Math.round(rnd() * 120) / 10, unitPrice: Math.round(rnd() * 900_000) + (rnd() < 0.35 ? 0.5 : 0) });
      items.push(it);
      tong += WEB.lineAmount(it, false, false);
    }
    items.push(hang({ quantity: 1, unitPrice: ((5 - (tong % 10)) + 10) % 10 + 10 * Math.floor(rnd() * 90_000) }));
  }
  return { coNgay: false, coCa: false, sh: { items, groupSubtotal: true, discount: 0 } };
}
/** Các nhóm của sheet đúng vòng lặp tổng: [tổng Thành Tiền nguyên, hệ số] — hàng trước nhóm đầu tiên là nhóm ×1. */
function cacNhom(sh, coNgay, coCa) {
  const out = [[0, 1]];
  for (const it of sh.items) {
    if (it.kind === "section" || it.kind === "subsection") { out.push([0, sh.groupSubtotal ? WEB.groupMult(it) : 1]); continue; }
    if (it.kind === "info") continue;
    out[out.length - 1][0] += WEB.lineAmount(it, coNgay, coCa);
  }
  return out;
}

describe("vòng ngẫu nhiên 3.000 sheet (nửa thường, nửa sát ,5): hệ số nhóm lẻ (1 số và 4 số lẻ) — web = máy chủ = PDF = bộ nạp Excel từng đồng", () => {
  it("tổng sheet, VAT, Thành Tiền; ô nhóm (hiện + giá trị) = Decimal; bản web = bản máy chủ của hai hàm", () => {
    let seed = 20261125;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    let caDoubleCuSai = 0, caHeSoLe = 0;
    for (let lan = 0; lan < 3000; lan++) {
      const { coNgay, coCa, sh } = lan % 2 ? sinhSatNam(rnd) : sinhSheet(rnd);
      const ten = `lần ${lan}: ${JSON.stringify(sh)}`;
      const may = computeQuoteTotals({ vatPercent: 8, sheets: [sh] });
      const web = WEB.quoteTotals([WEB.sheetTotals(sh, coNgay, coCa)], 8);
      expect([web.gross, web.subtotal, web.vat, web.total], `${ten} — lưới web ≠ máy chủ`).toEqual([Number(may.sheetTotals[0].gross), Number(may.subtotal), Number(may.vat), Number(may.total)]);
      expect(pdfTotals({ vatPercent: 8, sheets: [sh] }), `${ten} — PDF`).toMatchObject({ gross: web.gross, vat: web.vat, total: web.total });
      expect(computeSubtotal({ items: sh.items, hasDays: coNgay, hasShifts: coCa, groupSubtotal: sh.groupSubtotal }), `${ten} — bộ nạp Excel`).toBe(web.gross);
      const nhom = cacNhom(sh, coNgay, coCa);
      expect(MAY.congTheoHeSoNhom(nhom), ten).toBe(web.gross);
      expect(WEB.congTheoHeSoNhom(nhom), ten).toBe(web.gross);
      // Ô Thành tiền từng nhóm: số HIỆN = Decimal làm tròn nửa-lên; GIÁ TRỊ (công thức trỏ vào) = tích chính xác.
      for (const [tong, he] of nhom) {
        const dec = new Decimal(tong).times(he);
        expect(WEB.nhanLamTronDong(tong, he), `${ten} — nhóm ${tong} × ${he} hiện`).toBe(Number(dec.toDecimalPlaces(0, Decimal.ROUND_HALF_UP)));
        expect(WEB.nhanHeSoNhom(tong, he), `${ten} — nhóm ${tong} × ${he} giá trị`).toBe(Number(dec.toString()));
        expect(MAY.nhanHeSoNhom(tong, he), ten).toBe(WEB.nhanHeSoNhom(tong, he));
      }
      // Bộ sinh phải chạm đúng lớp lỗi: cách cũ (Σ dòng × hệ số bằng double, rồi làm tròn) sai ở một phần đáng kể các ca.
      if (nhom.some(([, he]) => !Number.isInteger(he))) caHeSoLe++;
      let cu = 0;
      for (const it of sh.items) if (it.kind !== "section" && it.kind !== "subsection" && it.kind !== "info") cu += WEB.lineAmount(it, coNgay, coCa) * (cacHeSoCua(sh, it));
      if (Math.round(cu) !== web.gross) caDoubleCuSai++;
    }
    expect(caHeSoLe, "bộ sinh phải ra nhiều sheet có hệ số nhóm lẻ").toBeGreaterThan(1500);
    expect(caDoubleCuSai, "bộ sinh không chạm ca nào mà cách double cũ ra sai — bài không bảo vệ gì").toBeGreaterThan(0);
  });

  it("số âm sát ,5 làm tròn RA XA 0 như ROUND_HALF_UP của Decimal (−0,5 × 3 = −1,5 → −2), không phải Math.round (−1)", () => {
    const items = [{ kind: "section", quantity: 0.5 }, hang({ quantity: 1, unitPrice: -3 })];
    const may = Number(computeQuoteTotals({ vatPercent: 0, sheets: [{ items, groupSubtotal: true }] }).sheetTotals[0].gross);
    expect(may).toBe(-2);
    expect(WEB.sheetSubtotalGrouped(items, false, true)).toBe(may);
    expect(computeSubtotal({ items, hasDays: false, groupSubtotal: true })).toBe(may);
    expect(MAY.congTheoHeSoNhom([[-3, 0.5]])).toBe(-2);
  });

  it("vòng ngẫu nhiên xuất Excel (40 sheet): Tổng Cộng ghi sẵn = Excel tính lại = máy chủ", async () => {
    let seed = 7_040_807;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    for (let lan = 0; lan < 40; lan++) {
      const { sh } = sinhSheet(rnd);
      // Mẫu gn_cinetour (Số Ca, không Số Ngày): bỏ Số Ngày của hàng cho khớp mẫu; nhóm bật; không Discount (khối tổng 3 hàng).
      const items = sh.items.map((it) => ({ ...it, days: null, name: it.name || "x" }));
      const q = baoGia(items);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await buildQuoteBuffer(q));
      const ws = wb.worksheets[0];
      const { tienCot, rTong, rVat, rTT } = khoiTong(ws);
      const may = computeQuoteTotals({ vatPercent: 8, sheets: q.sheets });
      const tinh = tinhLaiExcel(ws);
      const ten = `lần ${lan}: ${JSON.stringify(items)}`;
      const oTong = ws.getCell(`${tienCot}${rTong}`).value;
      expect(typeof oTong === "object" ? oTong.result : oTong, `${ten} — Tổng Cộng ghi sẵn`).toBe(Number(may.subtotal));
      expect([tinh(`${tienCot}${rTong}`), tinh(`${tienCot}${rVat}`), tinh(`${tienCot}${rTT}`)], `${ten} — Excel tính lại`).toEqual([Number(may.subtotal), Number(may.vat), Number(may.total)]);
    }
  });
});

/** Hệ số nhóm của một hàng theo luật bản CŨ (để đếm ca cách double sai) — nhóm gần nhất phía trên, ×1 khi tắt. */
function cacHeSoCua(sh, it) {
  let he = 1;
  for (const x of sh.items) {
    if (x === it) return he;
    if (x.kind === "section" || x.kind === "subsection") he = sh.groupSubtotal ? WEB.groupMult(x) : 1;
  }
  return he;
}
