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

    // Chiều cao: giữ của tệp mẫu, TRỪ KHI nó thấp hơn một dòng Excel — GN nướng sẵn 17,5pt cho chữ 14
    // đậm cần 18,75pt, nên từ đợt soát 3 (1d) hàng này được nới đúng lên 18,75. CLF 27,5pt ≥ 22,5 giữ nguyên.
    it(`${code}: tiêu đề ngắn — không đổi căn lề, chiều cao = tệp mẫu (hoặc đủ một dòng nếu mẫu thấp hơn)`, async () => {
      const { o, cao } = await oTieuDe(code, "Moana", "Booth");
      expect(o.alignment?.wrapText ?? false).toBe(false);
      expect(cao).toBe(Math.max(goc, moiDong));
    });
  }

  it("tiêu đề rất dài (500 ký tự) vẫn trong trần 409pt của Excel", async () => {
    const { o, cao } = await oTieuDe("clofull_decor", "Tiêu đề ".repeat(62).trim(), "S");
    expect(o.alignment?.wrapText).toBe(true);
    expect(cao).toBeLessThanOrEqual(409);
    expect(cao).toBeGreaterThan(3 * 22.5);
  });
});

// ── SÁT NGƯỠNG: KHÔNG XUỐNG DÒNG SỚM, NHƯNG CŨNG KHÔNG CẮT CHỮ (soát toàn diện đợt 3 1c) ─────────
// Hệ số an toàn 1,05 của bảng bề rộng (đo trên chữ CỠ 11) làm tiêu đề cỡ 14/18 đậm bật wrap khi Excel
// vẫn vừa một dòng — hàng tiêu đề bị nới gấp đôi mà chỉ chứa một dòng chữ. SỐ ĐO EXCEL THẬT: 104
// chuỗi × 8 vùng gộp tiêu đề (4 mẫu, có/không cột ảnh) = 832 ca; mỗi ca đặt ô tạm rộng ĐÚNG số px của
// vùng gộp, bật wrap, AutoFit hàng rồi đọc số dòng. Mỗi dòng dưới đây là một ca trong bộ đó:
// [mẫu, có cột ảnh, chuỗi tiêu đề đầy đủ, số dòng Excel vẽ].
const SAT_NGUONG = [
  // Excel vừa MỘT dòng — bản cũ vẫn bật wrap và nới hàng.
  ["clofull_decor", false, "BẢNG BÁO GIÁ - SỰ KIỆN RA MẮT SẢN PHẨM MỚI MOANA TẠI VINCOM ĐỒNG", 1],
  ["clofull_decor", true, "BẢNG BÁO GIÁ - Sự kiện ra mắt sản phẩm mới Moana tại Vincom Đồng Khởi ngày 01/10/2026 booth", 1],
  ["clofull_conngay", false, "BẢNG BÁO GIÁ - SỰ KIỆN RA MẮT SẢN PHẨM MỚI MOANA TẠI VINCOM ĐỒNG KHỞI", 1],
  ["unibenfood", false, "BẢNG BÁO GIÁ - SỰ KIỆN RA MẮT SẢN PHẨM MỚI MOANA TẠI VINCOM ĐỒNG KHỞI", 1],
  ["unibenfood", true, "BẢNG BÁO GIÁ - Hội Nghị Khách Hàng Thường Niên Mùa Hè Tổng Kết Năm Tri Ân Đối Tác Chiến Lược Khu", 1],
  // Excel cần HAI dòng — những ca sát ngưỡng nhất của bộ đo; hạ hệ số quá tay là chúng bị cắt hai đầu.
  ["unibenfood", true, "BẢNG BÁO GIÁ - Sự kiện ra mắt sản phẩm mới Moana tại Vincom Đồng Khởi ngày 01/10/2026 booth chính khu vực", 2],
  ["unibenfood", true, "BẢNG BÁO GIÁ - Hội Nghị Khách Hàng Thường Niên Mùa Hè Tổng Kết Năm Tri Ân Đối Tác Chiến Lược Khu Vực", 2],
  ["clofull_conngay", true, "BẢNG BÁO GIÁ - Unilever Vietnam Activation Roadshow Summer Campaign Booth Design Production Installation", 2],
  ["clofull_decor", false, "BẢNG BÁO GIÁ - LED P3.91 6mW x 3mH 01/10/2026 W&M 0m8W x 0m5H x 8 tấm 1m2W x", 2],
];

describe("L44 sát ngưỡng: wrap đúng khi Excel cần, không sớm hơn", () => {
  for (const [code, anh, chu, dongExcel] of SAT_NGUONG) {
    it(`${code}${anh ? " + cột ảnh" : ""} · Excel ${dongExcel} dòng · ${chu.slice(15, 60)}…`, async () => {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await buildQuoteBuffer({
        quoteNumber: "GN26L44", title: chu.replace(/^BẢNG BÁO GIÁ - /, ""), vatPercent: 8, showTotals: false,
        city: "TP. Hồ Chí Minh", quoteDate: new Date("2026-09-24"),
        sheets: [{ order: 1, name: "", showImages: anh, template: { code }, items: [{ order: 0, kind: "item", name: "A", unit: "cái", quantity: 1, unitPrice: 1000 }] }],
      }));
      const ws = wb.worksheets[0];
      const addr = code.startsWith("clofull") ? "B2" : "B7";
      const o = ws.getCell(addr);
      expect(o.value, "bài phải thử đúng chuỗi đã đo").toBe(chu);
      if (dongExcel === 1) {
        expect(o.alignment?.wrapText ?? false, "Excel vừa một dòng mà vẫn bật wrap — hàng tiêu đề nới gấp đôi vô cớ").toBe(false);
      } else {
        expect(o.alignment?.wrapText, "Excel cần hai dòng mà không bật wrap → chữ bị cắt hai đầu").toBe(true);
        expect(ws.getRow(+addr.slice(1)).height).toBeGreaterThanOrEqual(2 * (code.startsWith("clofull") ? 22.5 : 18.75));
      }
    });
  }
});
