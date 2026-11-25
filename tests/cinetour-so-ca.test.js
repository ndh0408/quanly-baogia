// ============================================================================
// MẪU CINETOUR — CỘT SỐ CA (chủ repo 2026-11-25), phần THUẦN (không cần CSDL).
//
// Bốn mẫu: GN / CLF × Không ngày / Có ngày, bố cục của mẫu thường cùng công ty + một cột "SỐ CA":
//   Không ngày: Thành Tiền = SL × Số Ca × Đơn Giá;   Có ngày: SL × Số Ngày × Số Ca × Đơn Giá.
// Số Ca trống / 0 = ×1 (y luật Số Ngày). Tiền phải khớp TỪNG ĐỒNG giữa lưới web (shared/quote-math.ts), tiền máy chủ
// lưu (src/money.ts, Decimal), tệp Excel (src/excel.ts — kể cả khi Excel TÍNH LẠI công thức), PDF (src/pdf.ts) và
// bộ nạp Excel (src/excelImport.ts). ĐỎ trên 7a6ce18: chưa có mẫu, chưa có cột, chưa tính Số Ca ở đâu cả.
// ============================================================================
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync } from "node:fs";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { buildQuoteBuffer } from "../src/excel.js";
import { renderQuotePdf, pdfTotals } from "../src/pdf.js";
import { parseQuoteWorkbook, computeSubtotal } from "../src/excelImport.js";
import { getConfig, TEMPLATE_CONFIGS } from "../src/templateConfigs.js";
import { computeQuoteTotals } from "../src/money.js";
import { evalEditorFormula } from "../src/quoteFormula.js";
import { extraTableSum, bangNoiBoCoNgay, bangNoiBoCoCa, chuanHoaSoCaTheoCoCa, sanitizeExtraTables, vanTayHn } from "../src/quoteUtils.js";
import { loiKhoaHangNoiBoDaDuyet } from "../src/hnDuyetHang.js";
import { chupHang } from "../src/khoanChi.js";
import { sheetTotals, quoteTotals, lineAmount } from "../shared/quote-math.js";

const MA = {
  gnKhong: "gn_cinetour", gnCo: "gn_cinetour_conngay",
  clfKhong: "clofull_cinetour", clfCo: "clofull_cinetour_conngay",
};
const chu = (v) => (v && typeof v === "object" && Array.isArray(v.richText)) ? v.richText.map((x) => x.text).join("")
  : (v && typeof v === "object" && (v.formula || v.sharedFormula)) ? `=${v.formula || v.sharedFormula}` : String(v ?? "");
const hoaKhongDau = (s) => String(s).replace(/\s+/g, " ").trim().toUpperCase();

describe("bốn mẫu CINETOUR — cấu hình", () => {
  it("mỗi mẫu có tệp, có cột Số Ca đúng chỗ, công thức Thành Tiền đủ thừa số", () => {
    const mong = {
      [MA.gnKhong]: { cot: { quantity: "E", shifts: "F", unitPrice: "G", amount: "H" }, days: undefined, ct: "G12*E12*F12" },
      [MA.gnCo]: { cot: { quantity: "E", days: "F", shifts: "G", unitPrice: "H", amount: "I" }, ct: "H12*E12*F12*G12" },
      [MA.clfKhong]: { cot: { detail: "D", quantity: "F", shifts: "G", unitPrice: "H", amount: "I" }, days: undefined, ct: "H12*F12*G12" },
      [MA.clfCo]: { cot: { detail: "D", quantity: "F", days: "G", shifts: "H", unitPrice: "I", amount: "J" }, ct: "I12*F12*G12*H12" },
    };
    for (const [ma, m] of Object.entries(mong)) {
      const c = getConfig(ma);
      expect(existsSync(new URL(`../${c.filePath}`, import.meta.url)), `${ma}: thiếu tệp ${c.filePath}`).toBe(true);
      expect(c.items.columns, ma).toMatchObject(m.cot);
      if ("days" in m) expect(c.items.columns.days, `${ma} không được có Số Ngày`).toBeUndefined();
      expect(c.items.amountFormula(12), ma).toBe(m.ct);
      // Hộp nhãn khối tổng = hai cột ngay trước cột tiền (khớp vùng gộp của tệp mẫu — lệch là tệp xuất ra mở không được).
      const tien = c.totals.subtotal.valueCell;
      expect(tien, ma).toBe(m.cot.amount);
      const [a, b] = c.totals.subtotal.labelCells[0];
      expect(b.charCodeAt(0) + 1, `${ma}: hộp nhãn phải sát cột tiền`).toBe(tien.charCodeAt(0));
      expect(b.charCodeAt(0) - a.charCodeAt(0)).toBe(1);
    }
  });

  it("CHỈ bốn mẫu CINETOUR có cột Số Ca — mọi mẫu cũ giữ nguyên", () => {
    const coCa = Object.entries(TEMPLATE_CONFIGS).filter(([, c]) => c.items?.columns?.shifts).map(([k]) => k).sort();
    expect(coCa).toEqual(Object.values(MA).sort());
    expect(getConfig("marico_decor").items.amountFormula(12)).toBe("G12*F12");
    expect(getConfig("unibenfood").items.amountFormula(12)).toBe("G12*E12*F12");
    expect(getConfig("clofull_conngay").items.amountFormula(12)).toBe("H12*F12*G12");
  });
});

// ── Báo giá mẫu dùng chung cho Excel / PDF / tiền ───────────────────────────────────────────
const hang = (o) => ({ kind: "item", unit: "người", quantity: 1, unitPrice: 0, days: null, shifts: null, ...o });
const sheetMau = (templateCode, coNgay, extra = {}) => ({
  id: 1, name: "Rạp", order: 1, templateCode, template: { code: templateCode }, groupSubtotal: false, discount: 0, extraTables: [],
  items: [
    hang({ name: "Bảo vệ", quantity: 2, unitPrice: 150_000, shifts: 3, ...(coNgay ? { days: 2 } : {}), notes: "ca đêm" }),
    hang({ name: "Lễ tân", quantity: 1.5, unitPrice: 333_333, shifts: null, ...(coNgay ? { days: null } : {}) }),   // Số Ca + Số Ngày trống = ×1
    { kind: "section", name: "Kỹ thuật", quantity: 2 },
    hang({ name: "Âm thanh", quantity: 1, unitPrice: 2_500_000, shifts: 2, ...(coNgay ? { days: 3 } : {}) }),
    hang({ name: "Ánh sáng", quantity: 3, unitPrice: 15, shifts: 0.5, ...(coNgay ? { days: 1 } : {}), formulas: { shifts: "=1/2" } }),   // 22,5 → 23
  ],
  ...extra,
});
const baoGiaMau = (sheets) => ({
  id: 1, quoteNumber: "GN26999", title: "Cinetour", toCompany: "CGV", toContact: "Mr. Tài", fromContact: "Lan Anh",
  fromTitle: "Account", fromPhone: "0914291951", fromAddress: "34 Đào Trí", city: "TP. Hồ Chí Minh",
  quoteDate: new Date("2026-11-25T00:00:00Z"), vatPercent: 8, hnTables: [], company: { name: "Cty" }, sheets,
});
const coNgayCua = (ma) => !!getConfig(ma).items.columns.days;

/** TÍNH LẠI một sheet Excel như Excel mở tệp ra (fullCalcOnLoad): ô công thức → giá trị, đệ quy theo tham chiếu. */
function tinhLaiExcel(ws) {
  const daTinh = new Map();
  const soCot = (L) => [...L].reduce((a, c) => a * 26 + c.charCodeAt(0) - 64, 0);
  const chuCot = (n) => { let s = ""; while (n > 0) { const d = (n - 1) % 26; s = String.fromCharCode(65 + d) + s; n = Math.floor((n - 1) / 26); } return s; };
  const o = (addr) => {
    const a = addr.replace(/\$/g, "").toUpperCase();
    if (daTinh.has(a)) return daTinh.get(a);
    daTinh.set(a, NaN);   // chặn vòng
    const cell = ws.getCell(a);
    let kq = 0;
    const f = cell.formula;
    if (f) {
      kq = evalEditorFormula(`=${f}`, {
        cell: (x) => o(x),
        range: (x, y) => {
          const p = /^\$?([A-Z]+)\$?(\d+)$/i.exec(x), q = /^\$?([A-Z]+)\$?(\d+)$/i.exec(y);
          const out = [];
          for (let r = Math.min(+p[2], +q[2]); r <= Math.max(+p[2], +q[2]); r++)
            for (let c = Math.min(soCot(p[1]), soCot(q[1])); c <= Math.max(soCot(p[1]), soCot(q[1])); c++) out.push(o(`${chuCot(c)}${r}`));
          return out;
        },
      });
      if (kq == null) throw new Error(`không tính lại được ô ${a}: =${f}`);
    } else if (typeof cell.value === "number") kq = cell.value;
    daTinh.set(a, kq);
    return kq;
  };
  return o;
}

async function moTep(buf) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  return wb;
}

describe("XUẤT EXCEL bốn mẫu CINETOUR — cột, công thức, tổng sau khi Excel tính lại", () => {
  for (const ma of Object.values(MA)) {
    it(`${ma}: tiêu đề SỐ CA đúng cột, ô Số Ca có số (trống = 1), công thức Thành Tiền gồm cột Số Ca, tổng / VAT tính lại khớp máy chủ`, async () => {
      const c = getConfig(ma), cot = c.items.columns, coNgay = coNgayCua(ma);
      for (const nhom of [false, true]) {
        const sh = sheetMau(ma, coNgay, { groupSubtotal: nhom, discount: nhom ? 100_000 : 0 });
        const q = baoGiaMau([sh]);
        const ws = (await moTep(await buildQuoteBuffer(q))).worksheets[0];
        const hd = c.items.headerRow;
        expect(hoaKhongDau(chu(ws.getCell(`${cot.shifts}${hd}`).value)), `${ma}: tiêu đề Số Ca`).toBe("SỐ CA");
        expect(hoaKhongDau(chu(ws.getCell(`${cot.quantity}${hd}`).value))).toBe("SỐ LƯỢNG");
        if (coNgay) expect(hoaKhongDau(chu(ws.getCell(`${cot.days}${hd}`).value))).toBe("SỐ NGÀY");
        expect(hoaKhongDau(chu(ws.getCell(`${cot.unitPrice}${hd}`).value))).toMatch(/^ĐƠN GIÁ/);
        expect(hoaKhongDau(chu(ws.getCell(`${cot.amount}${hd}`).value))).toMatch(/^THÀNH TIỀN/);
        // Tìm hàng theo tên.
        const hangCua = (ten) => { let r = null; ws.eachRow((row, i) => { if (i > hd && chu(row.getCell(cot.name).value).trim() === ten) r = i; }); return r; };
        const rBV = hangCua("Bảo vệ"), rLT = hangCua("Lễ tân"), rAS = hangCua("Ánh sáng");
        expect(rBV && rLT && rAS, `${ma}: thiếu hàng`).toBeTruthy();
        expect(ws.getCell(`${cot.shifts}${rBV}`).value).toBe(3);
        expect(ws.getCell(`${cot.shifts}${rLT}`).value, "Số Ca trống phải ghi 1 — ô 0 là Excel tính lại ra 0 đồng").toBe(1);
        const fTien = chu(ws.getCell(`${cot.amount}${rBV}`).value);
        expect(fTien, `${ma}: Thành Tiền thiếu thừa số Số Ca`).toContain(`${cot.shifts}${rBV}`);
        if (coNgay) expect(fTien).toContain(`${cot.days}${rBV}`);
        expect(fTien).toMatch(/^=ROUND\(/);
        // Ô Số Ca có công thức → tệp mang công thức sống (=1/2), kết quả 0,5.
        expect(chu(ws.getCell(`${cot.shifts}${rAS}`).value), "công thức Số Ca bị hạ thành số").toBe("=1/2");
        // Excel tính lại = số máy chủ lưu, từng đồng.
        const tinh = tinhLaiExcel(ws);
        const may = computeQuoteTotals({ vatPercent: 8, sheets: [sh] });
        const web = quoteTotals([sheetTotals(sh, coNgay, true)], 8);
        expect(Number(may.subtotal), `${ma}: tiền máy chủ ≠ lưới web`).toBe(web.subtotal);
        expect(Number(may.total)).toBe(web.total);
        expect(tinh(`${cot.amount}${rBV}`)).toBe(lineAmount(sh.items[0], coNgay, true));
        expect(tinh(`${cot.amount}${rLT}`)).toBe(lineAmount(sh.items[1], coNgay, true));
        expect(tinh(`${cot.amount}${rAS}`), "0,5 ca × 3 × 15 = 22,5 → 23").toBe(lineAmount(sh.items[4], coNgay, true));
        const nhanCot = c.totals.subtotal.labelCells[0][0], tienCot = c.totals.subtotal.valueCell;
        const hangNhan = (re) => { let r = null; ws.eachRow((row, i) => { if (i > rAS && !r && re.test(chu(row.getCell(nhanCot).value).trim())) r = i; }); return r; };
        const rTong = hangNhan(/^(Tổng Cộng)$/), rVat = hangNhan(/^VAT/), rTT = hangNhan(/^Thành Tiền$/);
        expect(rTong && rVat && rTT, `${ma}: không thấy khối tổng`).toBeTruthy();
        expect(tinh(`${tienCot}${rTong}`), `${ma}: Tổng Cộng (đã trừ Discount) sau khi Excel tính lại`).toBe(Number(may.subtotal));
        expect(tinh(`${tienCot}${rVat}`), `${ma}: VAT`).toBe(Number(may.vat));
        expect(tinh(`${tienCot}${rTT}`), `${ma}: Thành Tiền`).toBe(Number(may.total));
      }
    });
  }

  it("mẫu thường KHÔNG đổi: cùng báo giá (hàng còn giữ số ca) xuất mẫu GN không ngày không nhân Số Ca", async () => {
    const sh = sheetMau("marico_decor", false);
    const ws = (await moTep(await buildQuoteBuffer(baoGiaMau([sh])))).worksheets[0];
    const tieuDe = [];
    ws.getRow(11).eachCell((c) => tieuDe.push(hoaKhongDau(chu(c.value))));
    expect(tieuDe).not.toContain("SỐ CA");
  });
});

describe("NHẬP EXCEL — xuất tệp CINETOUR rồi nạp lại ra y nguyên", () => {
  for (const ma of Object.values(MA)) {
    it(`${ma}: nhận đúng mẫu, cột Số Ca, số ca từng dòng, công thức; tổng nạp lại = tổng lúc xuất`, async () => {
      const coNgay = coNgayCua(ma);
      const sh = sheetMau(ma, coNgay, { groupSubtotal: true });
      const kq = await parseQuoteWorkbook(Buffer.from(await buildQuoteBuffer(baoGiaMau([sh]))));
      const t = kq.sheets.find((s) => !s.skipped);
      expect(t.templateCode, `${ma}: không nhận ra mã mẫu nhúng`).toBe(ma);
      expect(t.hasShifts).toBe(true);
      expect(t.hasDays).toBe(coNgay);
      expect(t.columns.shifts).toBe(getConfig(ma).items.columns.shifts);
      const ten = (n) => t.items.find((i) => i.name === n);
      expect(Number(ten("Bảo vệ").shifts)).toBe(3);
      expect(ten("Lễ tân").shifts ?? null, "ô Số Ca ghi 1 → nạp lại là 1 (×1)").toBe(1);
      expect(Number(ten("Ánh sáng").shifts)).toBe(0.5);
      expect(ten("Ánh sáng").formulas?.shifts, "công thức Số Ca rơi khi nạp lại").toBe("=1/2");
      if (coNgay) expect(Number(ten("Âm thanh").days)).toBe(3);
      expect(t.items.flatMap((i) => i.warn || []), "nạp lại tệp chính app xuất không được có cảnh báo").toEqual([]);
      expect(computeSubtotal(t)).toBe(Number(computeQuoteTotals({ vatPercent: 0, sheets: [{ ...sh, discount: 0 }] }).subtotal));
    });
  }

  it("tệp ngoài có cột \"Số ca\" (không mã mẫu): nhận cột, đối chiếu Thành Tiền có Số Ca không cảnh báo, đoán mẫu CINETOUR", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Rạp");
    ws.addRow(["STT", "Hạng Mục", "ĐVT", "Số Lượng", "Số ca", "Đơn Giá", "Thành Tiền", "Ghi Chú"]);
    ws.addRow([1, "Bảo vệ", "người", 2, 3, 150000, 900000, ""]);
    ws.addRow([2, "Lễ tân", "người", 1, 2, 200000, 400000, ""]);
    ws.addRow(["", "Tổng Cộng", "", "", "", "", 1300000, ""]);
    const kq = await parseQuoteWorkbook(Buffer.from(await wb.xlsx.writeBuffer()));
    const t = kq.sheets.find((s) => !s.skipped);
    expect(t.hasShifts).toBe(true);
    expect(t.items.map((i) => Number(i.shifts))).toEqual([3, 2]);
    expect(t.items.flatMap((i) => i.warn || [])).toEqual([]);
    expect(t.warnings.filter((w) => /lệch/.test(w))).toEqual([]);
    expect(computeSubtotal(t)).toBe(1_300_000);
    expect(t.templateCode).toBe(MA.gnKhong);
  });
});

describe("PDF — có cột Số ca, tiền khớp máy chủ", () => {
  let ve = [];
  beforeEach(() => {
    ve = [];
    const goc = PDFDocument.prototype.text;
    vi.spyOn(PDFDocument.prototype, "text").mockImplementation(function (t, ...rest) { ve.push(String(t)); return goc.call(this, t, ...rest); });
  });
  afterEach(() => vi.restoreAllMocks());

  it("CINETOUR có ngày: in cột \"Số ngày\" + \"Số ca\"; Thành tiền từng hàng và tổng khớp computeQuoteTotals", async () => {
    const sh = sheetMau(MA.gnCo, true, { groupSubtotal: true, discount: 50_000 });
    const q = baoGiaMau([sh]);
    await renderQuotePdf(q);
    expect(ve).toContain("Số ca");
    expect(ve).toContain("Số ngày");
    const i = ve.indexOf("Bảo vệ");
    expect(ve.slice(i, i + 7), "hàng Bảo vệ: [tên, ĐVT, SL, Ngày, Ca, Đơn giá, Thành tiền]").toEqual(["Bảo vệ", "người", "2", "2", "3", "150.000", "1.800.000"]);
    const may = computeQuoteTotals({ vatPercent: 8, sheets: [sh] });
    const p = pdfTotals(q);
    expect(p.subtotal).toBe(Number(may.subtotal));
    expect(p.vat).toBe(Number(may.vat));
    expect(p.total).toBe(Number(may.total));
  });

  it("CINETOUR không ngày: cột Số ca, KHÔNG có cột Số ngày; Số Ca trống in 1", async () => {
    await renderQuotePdf(baoGiaMau([sheetMau(MA.clfKhong, false)]));
    expect(ve).toContain("Số ca");
    expect(ve).not.toContain("Số ngày");
    const i = ve.indexOf("Lễ tân");
    expect(ve.slice(i, i + 6)).toEqual(["Lễ tân", "người", "1,5", "1", "333.333", "500.000"]);
  });

  it("mẫu thường: bảng PDF giữ sáu cột như trước", async () => {
    await renderQuotePdf(baoGiaMau([{ ...sheetMau("marico_decor", false), items: [hang({ name: "Bàn", quantity: 2, unitPrice: 1000 })] }]));
    expect(ve).not.toContain("Số ca");
    const i = ve.indexOf("Bàn");
    expect(ve.slice(i, i + 5)).toEqual(["Bàn", "người", "2", "1.000", "2.000"]);
  });
});

describe("tiền máy chủ (Decimal) = lưới web — Số Ca, trống = ×1, nhóm × Số Ca", () => {
  it("bảng giá trị ngẫu nhiên có số lẻ sát ,5: computeQuoteTotals khớp sheetTotals/quoteTotals từng đồng", () => {
    let seed = 7;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    for (let lan = 0; lan < 200; lan++) {
      const coNgay = rnd() < 0.5;
      const items = [];
      for (let k = 0; k < 6; k++) {
        if (rnd() < 0.15) { items.push({ kind: "section", name: "N", quantity: Math.round(rnd() * 30) / 10 }); continue; }
        items.push(hang({
          quantity: Math.round(rnd() * 100) / 10, unitPrice: Math.round(rnd() * 400_000) + (rnd() < 0.3 ? 0.5 : 0),
          shifts: rnd() < 0.3 ? null : Math.round(rnd() * 8) / 2, days: coNgay && rnd() < 0.8 ? Math.round(rnd() * 10) / 2 : null,
        }));
      }
      const sh = { items, groupSubtotal: rnd() < 0.5, discount: 0 };
      const may = computeQuoteTotals({ vatPercent: 8, sheets: [sh] });
      const web = quoteTotals([sheetTotals(sh, coNgay, true)], 8);
      expect([Number(may.subtotal), Number(may.vat), Number(may.total)], `lần ${lan}: ${JSON.stringify(sh)}`).toEqual([web.subtotal, web.vat, web.total]);
    }
  });
});

describe("bảng nội bộ / Hà Nội dùng mẫu CINETOUR", () => {
  const ds = [
    { id: 1, companyId: 1, hasDays: true, hasShifts: false },   // mẫu ĐẦU của công ty (dự phòng bảng thiếu templateId)
    { id: 2, companyId: 1, hasDays: false, hasShifts: true },
    { id: 3, companyId: 1, hasDays: true, hasShifts: true },
  ];
  it("bangNoiBoCoCa theo templateId; bảng thiếu mẫu dùng mẫu dự phòng (không có Số Ca) — tiền bảng cũ không đổi", () => {
    expect(bangNoiBoCoCa({ templateId: 2 }, 1, ds)).toBe(true);
    expect(bangNoiBoCoCa({ templateId: 3 }, 1, ds)).toBe(true);
    expect(bangNoiBoCoCa({}, 1, ds)).toBe(false);
    expect(bangNoiBoCoNgay({}, 1, ds)).toBe(true);
  });
  it("extraTableSum nhân Số Ca khi mẫu có cột; false thì không", () => {
    const t = { category: "hanoi", items: [{ kind: "item", quantity: 2, unitPrice: 100_000, days: 2, shifts: 3 }, { kind: "item", quantity: 1, unitPrice: 50_000, shifts: null }] };
    expect(extraTableSum(t, true, true)).toBe(1_200_000 + 50_000);
    expect(extraTableSum(t, true, false)).toBe(400_000 + 50_000);
    expect(extraTableSum(t, false, true)).toBe(600_000 + 50_000);
  });
  it("lưu bảng giữ Số Ca; bảng không có số ca thì hình dạng JSON + vân tay y như trước", () => {
    const [t] = sanitizeExtraTables([{ category: "hcm", templateId: 2, items: [{ kind: "item", name: "a", quantity: 1, unitPrice: 1, shifts: 2, rid: "r1" }, { kind: "item", name: "b", quantity: 1, unitPrice: 1, rid: "r2" }] }]);
    expect(t.items[0].shifts).toBe(2);
    expect("shifts" in t.items[1]).toBe(false);
    expect(vanTayHn([{ items: [{ name: "b", quantity: 1 }] }])).not.toContain("shifts");
    expect(vanTayHn([{ items: [{ name: "b", quantity: 1, shifts: 2 }] }])).not.toBe(vanTayHn([{ items: [{ name: "b", quantity: 1, shifts: 3 }] }]));
  });
  it("hàng Chi phí HCM ĐÃ DUYỆT: sửa Số Ca là sửa hàng khoá → 409", () => {
    const db = [{ category: "hcm", templateId: 2, items: [{ kind: "item", name: "Bảo vệ", quantity: 1, unitPrice: 100_000, shifts: 2, rid: "r1", approved: true }] }];
    const sua = JSON.parse(JSON.stringify(db)); sua[0].items[0].shifts = 3;
    expect(loiKhoaHangNoiBoDaDuyet(sua, db)?.status).toBe(409);
    expect(loiKhoaHangNoiBoDaDuyet(JSON.parse(JSON.stringify(db)), db)).toBeNull();
  });
  it("ảnh chụp khoản chi (Hóa đơn đầu vào) nhân Số Ca theo mẫu", () => {
    const p = { it: { kind: "item", quantity: 2, unitPrice: 100_000, shifts: 3 }, ten: "Bảo vệ", t: { category: "hcm", name: "HCM" } };
    expect(chupHang(p, false, "sheet", true)).toMatchObject({ amount: 600_000, shifts: 3 });
    expect(chupHang(p, false, "sheet", false).amount).toBe(200_000);
    expect("shifts" in chupHang(p, false, "sheet", false)).toBe(false);
  });
});

describe("máy chủ ép Số Ca = null ở mẫu không có cột (chuanHoaSoCaTheoCoCa)", () => {
  it("mẫu không có cột → null; mẫu có cột / không tra được → giữ", () => {
    const sheets = [
      { templateId: 1, items: [{ shifts: 3 }, { shifts: null }] },
      { templateId: 2, items: [{ shifts: 3 }] },
      { templateId: 99, items: [{ shifts: 4 }] },
    ];
    chuanHoaSoCaTheoCoCa(sheets, new Map([[1, false], [2, true]]));
    expect(sheets.map((s) => s.items.map((i) => i.shifts))).toEqual([[null, null], [3], [4]]);
    expect(() => chuanHoaSoCaTheoCoCa(null, new Map())).not.toThrow();
  });
});
