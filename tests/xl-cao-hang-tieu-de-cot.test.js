// Chiều cao NƯỚNG SẴN trong tệp mẫu không đủ cho chữ của chính nó — soát toàn diện đợt 3 1d.
//
// ── LỖI ─────────────────────────────────────────────────────────────────────
// Hai hàng giữ nguyên chiều cao của tệp mẫu, và chiều cao đó hụt so với số đo Excel thật
// (Excel COM: AutoFit riêng từng ô, xoá tạm các ô khác cùng hàng):
//   · Colorfull, hàng tiêu đề cột (hàng 4, cao 25pt): ô "THÀNH TIỀN " (Times New Roman 12 đậm, bật
//     wrap) không vừa bề rộng cột nên Excel ngắt hai dòng "THÀNH / TIỀN", cần 31,5pt — hàng 25pt
//     xén mất nửa trên dòng đầu và nửa dưới dòng hai. Đúng ở cả ba mẫu Colorfull (bản có ngày thì ô
//     đó dịch sang cột I).
//   · GN, hàng tiêu đề "BẢNG BÁO GIÁ …" (B7, Times New Roman 14 đậm) cao 17,5pt trong khi MỘT dòng
//     cỡ 14 cần 18,75pt — tiêu đề ngắn (không kích hoạt nhánh xuống dòng của L44) bị hụt 1,25pt.
import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { buildQuoteBuffer } from "../src/excel.js";

async function xuat(code, { anh = false, title = "Moana" } = {}) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await buildQuoteBuffer({
    quoteNumber: "GN26D3", title, toCompany: "Công ty ABC", toContact: "Anh A", vatPercent: 8, showTotals: true,
    city: "TP. Hồ Chí Minh", quoteDate: new Date("2026-09-24"),
    sheets: [{ order: 1, name: "", showImages: anh, template: { code }, items: [{ order: 0, kind: "item", name: "A", unit: "cái", quantity: 1, unitPrice: 1000 }] }],
  }));
  return wb.worksheets[0];
}

describe("Colorfull: hàng tiêu đề cột đủ cao cho 'THÀNH TIỀN' xuống hai dòng", () => {
  // [mẫu, cột Thành Tiền]
  for (const [code, cot] of [["clofull_decor", "H"], ["clofull_banner", "H"], ["clofull_conngay", "I"]]) {
    for (const anh of [false, true]) {
      it(`${code}${anh ? " + cột ảnh" : ""}`, async () => {
        const ws = await xuat(code, { anh });
        const o = ws.getCell(`${cot}4`);
        expect(String(o.value).trim()).toBe("THÀNH TIỀN");
        expect(o.alignment?.wrapText, "bài giả định ô bật wrap như tệp mẫu").toBe(true);
        expect(ws.getRow(4).height, "Excel cần 31,5pt cho hai dòng TNR 12 đậm").toBeGreaterThanOrEqual(31.5);
      });
    }
  }
});

describe("GN: hàng tiêu đề đủ cao cho MỘT dòng chữ 14 đậm", () => {
  for (const code of ["marico_decor", "unibenfood", "gn_banner"]) {
    for (const anh of [false, true]) {
      it(`${code}${anh ? " + cột ảnh" : ""}: tiêu đề ngắn ≥ 18,75pt, không bật wrap`, async () => {
        const ws = await xuat(code, { anh });
        const o = ws.getCell("B7");
        expect(o.font?.size).toBe(14);
        expect(o.alignment?.wrapText ?? false).toBe(false);
        expect(ws.getRow(7).height, "một dòng TNR 14 đậm cần 18,75pt").toBeGreaterThanOrEqual(18.75);
      });
    }

    it(`${code}: hàng tiêu đề cột (hàng 11) vẫn đúng chiều cao tệp mẫu — không nới vô cớ`, async () => {
      const ws = await xuat(code);
      expect(ws.getRow(11).height).toBe(33);
    });
  }
});
