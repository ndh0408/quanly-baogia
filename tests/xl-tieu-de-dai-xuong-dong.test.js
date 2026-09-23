// L44 — tiêu đề dài bị CẮT CẢ HAI ĐẦU: ô tiêu đề gộp, canh giữa, không xuống dòng, cao cố định.
//
// ── LỖI ─────────────────────────────────────────────────────────────────────
// `fillSheetData` ghép "BẢNG BÁO GIÁ - <tiêu đề> - <tên sheet>" rồi ghi vào ô tiêu đề mà không đổi
// căn lề hay chiều cao hàng. Ô đó GỘP NGANG (CLF B2:I2 · Times New Roman 18 đậm · cao 27,5pt;
// GN B7:I7 · 14 đậm · 17,5pt), canh giữa, KHÔNG bật wrap. Ô gộp không tràn chữ sang ô bên cạnh ⇒
// chuỗi rộng hơn vùng gộp bị Excel cắt mất cả hai đầu, trên màn hình lẫn khi in. Đo bằng Excel COM
// (AutoFit trên ô tạm cùng font): "Sự kiện ra mắt sản phẩm mới Moana tại Vincom Đồng Khởi ngày
// 01/10/2026" + sheet "Booth chính + POSM" cần 952,5pt ở CLF (vùng gộp 746,2pt) và 771,8pt ở GN
// (vùng gộp 631,5pt) — tức phải 2 dòng. Excel cần 22,5pt/dòng với chữ 18 đậm, 18,75pt/dòng với 14.
import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { buildQuoteBuffer } from "../src/excel.js";

const TIEU_DE_DAI = "Sự kiện ra mắt sản phẩm mới Moana tại Vincom Đồng Khởi ngày 01/10/2026";
function baoGia(code, title, sheetName, showImages = false) {
  return {
    quoteNumber: "GN26L44", title, toCompany: "Công ty ABC", toContact: "Anh A", vatPercent: 8, showTotals: false,
    city: "TP. Hồ Chí Minh", quoteDate: new Date("2026-09-24"),
    sheets: [
      { order: 1, name: sheetName, showImages, template: { code }, items: [{ order: 0, kind: "item", name: "A", unit: "cái", quantity: 1, unitPrice: 1000 }] },
      { order: 2, name: "Phụ", template: { code }, items: [{ order: 0, kind: "item", name: "B", unit: "cái", quantity: 1, unitPrice: 1000 }] },
    ],
  };
}
async function oTieuDe(code, title, sheetName, showImages) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await buildQuoteBuffer(baoGia(code, title, sheetName, showImages)));
  const ws = wb.worksheets[0];
  const addr = code.startsWith("clofull") ? "B2" : "B7";
  const o = ws.getCell(addr);
  return { o, cao: ws.getRow(+addr.slice(1)).height, ws };
}

// [mẫu, ô, cao 1 dòng Excel (pt), cao gốc của tệp mẫu]
const MAU = [["clofull_decor", 22.5, 27.5], ["clofull_conngay", 22.5, 27.5], ["marico_decor", 18.75, 17.5], ["unibenfood", 18.75, 17.5], ["gn_banner", 18.75, 17.5]];

describe("L44: tiêu đề dài xuống dòng và hàng đủ cao, tiêu đề ngắn giữ nguyên", () => {
  for (const [code, moiDong, goc] of MAU) {
    for (const anh of [false, true]) {
      it(`${code}${anh ? " + cột ảnh" : ""}: tiêu đề 106 ký tự bật wrap, hàng ≥ 2 dòng Excel`, async () => {
        const { o, cao } = await oTieuDe(code, TIEU_DE_DAI, "Booth chính + POSM", anh);
        expect(String(o.value)).toContain("Booth chính + POSM");
        expect(o.alignment?.wrapText, "không bật xuống dòng → chữ bị cắt hai đầu").toBe(true);
        expect(o.alignment?.horizontal, "vẫn phải canh giữa").toBe("center");
        expect(cao, `hàng tiêu đề cao ${cao}pt — 2 dòng cần ${2 * moiDong}pt`).toBeGreaterThanOrEqual(2 * moiDong);
      });
    }

    it(`${code}: tiêu đề ngắn — không đổi căn lề, không đổi chiều cao của tệp mẫu`, async () => {
      const { o, cao } = await oTieuDe(code, "Moana", "Booth");
      expect(o.alignment?.wrapText ?? false).toBe(false);
      expect(cao).toBe(goc);
    });
  }

  it("tiêu đề rất dài (500 ký tự) vẫn trong trần 409pt của Excel", async () => {
    const { o, cao } = await oTieuDe("clofull_decor", "Tiêu đề ".repeat(62).trim(), "S");
    expect(o.alignment?.wrapText).toBe(true);
    expect(cao).toBeLessThanOrEqual(409);
    expect(cao).toBeGreaterThan(3 * 22.5);
  });
});
