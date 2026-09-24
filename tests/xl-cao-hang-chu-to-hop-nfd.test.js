// Chữ tiếng Việt dạng TỔ HỢP (NFD) làm hàng Excel cao gấp đôi cần thiết — soát toàn diện đợt 3.
//
// ── LỖI ─────────────────────────────────────────────────────────────────────
// Unikey/OpenKey đặt bảng mã "Unicode tổ hợp", hoặc chữ dán từ nơi khác, cho ra "ô" = "o" + U+0302
// thay vì một ký tự "ô" dựng sẵn. `rongKyTuPx` (src/excel.ts) tra từng ký tự: dấu kết hợp đứng
// riêng không có trong bảng bề rộng và cũng không tách được thành chữ gốc, nên rơi xuống nhánh
// "ký tự lạ" 15px — rộng như chữ 'M' — trong khi Excel vẽ nó với bề rộng 0. Đo bằng Excel COM
// (Rows.AutoFit) trên clofull_decor: tên hạng mục bên dưới, bản NFC app đặt 63pt, bản NFD app đặt
// 108pt, còn Excel chỉ cần 51pt cho CẢ HAI dạng. Chỉ thừa chỗ trống, không che chữ.
import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { buildQuoteBuffer, soDongKhiXuongHang } from "../src/excel.js";

const CHU = [
  "Thi công lắp đặt tháo dỡ backdrop sân khấu, bao gồm vận chuyển",
  "HẠNG MỤC SÂN KHẤU VÀ TRANG TRÍ KHU VỰC ĐÓN KHÁCH",
  "Bàn check in: bàn dán AW, kích thước 1m2W x 0m75H x 0m5D",
  "Vận chuyển, lắp đặt và tháo dỡ trong ngày tại Vincom Đồng Khởi",
];
// Bề rộng lấy từ các cột thật của mẫu: 16,82 (GN Ghi chú), 21,18 (CLF), 34 và 38 (Hạng Mục).
const COT = [16.81640625, 21.1796875, 34, 38];

describe("chữ NFD ước lượng số dòng như chữ NFC", () => {
  for (const chu of CHU) {
    for (const rong of COT) {
      for (const dam of [true, false]) {
        it(`cột ${rong} · ${dam ? "đậm" : "thường"} · ${chu.slice(0, 30)}…`, () => {
          const nfd = chu.normalize("NFD");
          expect(nfd).not.toBe(chu);   // bảo đảm bài thật sự thử chữ tổ hợp
          expect(soDongKhiXuongHang(nfd, rong, { dam })).toBe(soDongKhiXuongHang(chu, rong, { dam }));
        });
      }
    }
  }

  it("dấu kết hợp không dựng sẵn được (không có dạng NFC) cũng không tính bề rộng", () => {
    // "x" + dấu huyền: Unicode không có "x huyền" dựng sẵn nên NFC vẫn để nguyên hai ký tự.
    const la = "x̀".repeat(20);
    expect(la.normalize("NFC")).toBe(la);
    expect(soDongKhiXuongHang(la, 16.81640625, { dam: false })).toBe(soDongKhiXuongHang("x".repeat(20), 16.81640625, { dam: false }));
  });
});

describe("tệp xuất: hàng của tên NFD cao đúng như tên NFC", () => {
  async function caoHang(code, ten) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await buildQuoteBuffer({
      quoteNumber: "GN26NFD", title: "NFD", toCompany: "Công ty ABC", toContact: "Anh A", vatPercent: 8, showTotals: false,
      city: "TP. Hồ Chí Minh", quoteDate: new Date("2026-09-24"),
      sheets: [{ order: 1, name: "S", template: { code }, items: [{ order: 0, kind: "item", name: ten, notes: ten, unit: "cái", quantity: 1, unitPrice: 1000 }] }],
    }));
    const ws = wb.worksheets[0];
    let cao = null;
    ws.eachRow((row) => { if (String(row.getCell("C").value ?? "") === ten) cao = row.height; });
    return cao;
  }
  for (const code of ["clofull_decor", "marico_decor", "unibenfood"]) {
    it(code, async () => {
      const chu = CHU[0];
      const nfc = await caoHang(code, chu);
      const nfd = await caoHang(code, chu.normalize("NFD"));
      expect(nfc, "không thấy hàng NFC").not.toBeNull();
      expect(nfd, `NFD ${nfd}pt — NFC ${nfc}pt: hàng cao thừa vì dấu kết hợp bị tính 15px`).toBe(nfc);
    });
  }
});
