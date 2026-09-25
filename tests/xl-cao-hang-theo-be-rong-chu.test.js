// L40 — chữ dài trong ô Hạng Mục / Ghi chú bị CHE DÒNG CUỐI: chiều cao hàng ước lượng thiếu.
//
// ── LỖI ─────────────────────────────────────────────────────────────────────
// `wrapLines` (src/excel.ts) coi MỖI KÝ TỰ rộng đúng 1 đơn vị bề rộng cột (= chữ số '0' của font
// mặc định, 7px). Ô Hạng Mục là Times New Roman 11 ĐẬM: chữ HOA, W/M/m và chữ có dấu rộng hơn hẳn
// đơn vị đó. Hàng lại được đặt chiều cao CỐ ĐỊNH, nên Excel không tự giãn — dòng cuối bị che cả
// trên màn hình lẫn khi in. Đo bằng Excel thật (Rows.AutoFit): "Banner hàng rào: 0m8W x 0m5H x 8
// tấm" ở mẫu GN có ngày (cột C rộng 38) cần 28,5pt mà app đặt 18pt; dòng nhóm viết HOA cần 42,75pt
// mà app đặt 33pt.
//
// ── SỐ ĐO THẬT ──────────────────────────────────────────────────────────────
// Bảng BAN_DO dưới đây lấy từ Excel 365 trên máy dev (COM: đặt chữ vào ô Times New Roman, bật
// wrap, đặt bề rộng cột, gọi Rows.AutoFit rồi đọc RowHeight; số dòng = (cao − 0,75) / 14,25 với
// chữ đậm 11, cao / 15 với chữ thường 11, (cao − 0,75) / 12,75 với cỡ 10). Chọn những ca bộ ước
// lượng cũ đoán THIẾU dòng. LƯU Ý đơn vị: bề rộng ở đây là bề rộng LƯU trong tệp (thứ ExcelJS đọc
// ra, gồm 5px đệm) — COM `ColumnWidth` là bề rộng HIỂN THỊ, nhỏ hơn 5/7.
import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { buildQuoteBuffer, soDongKhiXuongHang } from "../src/excel.js";

// [bề rộng cột LƯU trong .xlsx, đậm?, cỡ chữ, nghiêng?, số dòng Excel cần, chữ] — bề rộng lấy
// đúng các cột của mẫu: 38 (GN Hạng Mục), 48 (GN C:D gộp), 16,82 (GN Ghi chú), 34/30 (CLF Hạng
// Mục/Chi Tiết), 29, 21,18 và 16,18 (CLF Ghi chú cỡ 10) · Chi Tiết của CLF là chữ nghiêng cỡ 10.
const BAN_DO = [
  [38, true, 11, false, 2, "Banner hàng rào: 0m8W x 0m5H x 8 tấm"],
  [21.1796875, true, 11, false, 3, "Banner hàng rào: 0m8W x 0m5H x 8 tấm"],
  [38, true, 11, false, 3, "HẠNG MỤC SÂN KHẤU VÀ TRANG TRÍ KHU VỰC ĐÓN KHÁCH"],
  [34, true, 11, false, 3, "HẠNG MỤC SÂN KHẤU VÀ TRANG TRÍ KHU VỰC ĐÓN KHÁCH"],
  [50, true, 11, false, 2, "HẠNG MỤC SÂN KHẤU VÀ TRANG TRÍ KHU VỰC ĐÓN KHÁCH"],
  [16.81640625, false, 11, false, 5, "HẠNG MỤC SÂN KHẤU VÀ TRANG TRÍ KHU VỰC ĐÓN KHÁCH"],
  [29, false, 10, true, 3, "HẠNG MỤC SÂN KHẤU VÀ TRANG TRÍ KHU VỰC ĐÓN KHÁCH"],
  [38, true, 11, false, 3, "THIẾT KẾ VÀ SẢN XUẤT POSM CHO CHUỖI CỬA HÀNG MIỀN BẮC"],
  [16.1796875, true, 11, false, 6, "THIẾT KẾ VÀ SẢN XUẤT POSM CHO CHUỖI CỬA HÀNG MIỀN BẮC"],
  [30, false, 10, true, 3, "THIẾT KẾ VÀ SẢN XUẤT POSM CHO CHUỖI CỬA HÀNG MIỀN BẮC"],
  [21.1796875, false, 11, false, 4, "THIẾT KẾ VÀ SẢN XUẤT POSM CHO CHUỖI CỬA HÀNG MIỀN BẮC"],
  [34, true, 11, false, 2, "Đã bao gồm VAT. Đã bao gồm VAT"],
  [16.81640625, false, 11, false, 3, "Đã bao gồm VAT. Đã bao gồm VAT"],
  [29, true, 11, false, 2, "WWWW MMMM mmmm wwww"],
  [16.1796875, true, 11, false, 4, "Thi công ban đêm, từ 22h đến 5h sáng hôm sau"],
  [16.81640625, true, 11, false, 5, "Bàn check in: bàn dán AW, kích thước 1m2W x 0m75H x 0m5D"],
  [38, true, 11, false, 3, "Màn hình LED P3.91 indoor 6mW x 3mH, bao gồm bộ xử lý và kỹ thuật vận hành"],
  [48, true, 11, false, 3, "Sự kiện ra mắt sản phẩm mới Moana tại Vincom Đồng Khởi ngày 01/10/2026 - Booth chính + POSM"],
  [29, true, 11, false, 5, "HẠNG MỤC SÂN KHẤU VÀ TRANG TRÍ KHU VỰC ĐÓN KHÁCH. Giá thuê 01 ngày, phát sinh tính thêm 50%"],
  [30, false, 11, false, 5, "Standee chân sắt 0m6W x 1m6H, in PP cán màng. THIẾT KẾ VÀ SẢN XUẤT POSM CHO CHUỖI CỬA HÀNG MIỀN BẮC"],
  [48, true, 11, false, 4, "Standee chân sắt 0m6W x 1m6H, in PP cán màng. Sự kiện ra mắt sản phẩm mới Moana tại Vincom Đồng Khởi ngày 01/10/2026 - Booth chính + POSM"],
  [16.1796875, false, 11, false, 15, "Vận chuyển, lắp đặt và tháo dỡ trong ngày tại Vincom Đồng Khởi. HẠNG MỤC SÂN KHẤU VÀ TRANG TRÍ KHU VỰC ĐÓN KHÁCH. HẠNG MỤC SÂN KHẤU VÀ TRANG TRÍ KHU VỰC ĐÓN KHÁCH"],
];
/** Chiều cao Excel cần cho `dong` dòng (pt) — cùng công thức đã dùng để đổi số đo ra số dòng. */
const caoCan = (dong, dam, co) => co === 10 ? dong * 12.75 + 0.75 : dam ? dong * 14.25 + 0.75 : dong * 15;

describe("L40: ước lượng số dòng khớp Excel thật", () => {
  for (const [rong, dam, co, nghieng, dong, chu] of BAN_DO) {
    it(`cột ${rong} · ${dam ? "đậm" : nghieng ? "nghiêng" : "thường"} ${co} · cần ${dong} dòng: ${chu.slice(0, 40)}`, () => {
      const uoc = soDongKhiXuongHang(chu, rong, { dam, co });
      expect(uoc, "ước lượng THIẾU dòng → hàng che mất dòng cuối").toBeGreaterThanOrEqual(dong);
      expect(uoc, "ước lượng thừa quá nhiều → hàng cao vô cớ").toBeLessThanOrEqual(dong + 1);
    });
  }

  it("cột hẹp bất thường / ký tự lạ không làm treo và không ra số vô lý", () => {
    expect(soDongKhiXuongHang("x".repeat(500), 0.5)).toBeGreaterThan(1);
    expect(soDongKhiXuongHang("🎉".repeat(30), 16.8, { dam: false })).toBeGreaterThanOrEqual(2);
    expect(soDongKhiXuongHang("", 20)).toBe(1);
    expect(soDongKhiXuongHang("a\n\nb", 20)).toBe(3);
  });
});

function baoGia(code, items) {
  return {
    quoteNumber: "GN26L40", title: "Cao hàng", toCompany: "Công ty ABC", toContact: "Anh A",
    vatPercent: 8, showTotals: false, city: "TP. Hồ Chí Minh", quoteDate: new Date("2026-09-24"),
    sheets: [{ order: 1, name: "S", groupSubtotal: false, template: { code }, items: items.map((x, i) => ({ order: i, unit: "cái", quantity: 1, unitPrice: 1000, ...x })) }],
  };
}
async function caoHangCo(code, items, cot, chu) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await buildQuoteBuffer(baoGia(code, items)));
  const ws = wb.worksheets[0];
  let cao = null;
  ws.eachRow((row) => { if (String(row.getCell(cot).value ?? "") === chu) cao = row.height; });
  return cao;
}

describe("L40: tệp xuất đặt hàng đủ cao cho chữ (số đo Excel thật)", () => {
  // Số dòng Excel đo ở bề rộng W là CẬN DƯỚI cho mọi cột hẹp hơn hoặc bằng W (cột hẹp đi thì không
  // bao giờ ít dòng hơn), nên mỗi ca mang bề rộng đã đo và chỉ hợp lệ khi cột của mẫu ≤ bề rộng đó —
  // ca kiểm ngay dưới đòi điều ấy, đổi `columnWidths` rộng ra mà không đo lại là ĐỎ ở đây.
  // 2026-09-25: Hạng Mục Colorfull 34 → 39,8 (cột STT thu về 6,63 như GN, phần dôi dồn sang). Hai ca
  // đo ở C 34 không còn dùng được; thay bằng số đo ở 48/50 (≥ 39,8) và thêm cột Chi Tiết (D 30, đo đúng).
  const CA = [
    // [mẫu, cột, chữ, loại hàng, đậm, cỡ, số dòng Excel cần, trường chứa chữ, bề rộng đã đo]
    ["unibenfood", "C", "Banner hàng rào: 0m8W x 0m5H x 8 tấm", "item", true, 11, 2, "name", 38],
    ["unibenfood", "C", "HẠNG MỤC SÂN KHẤU VÀ TRANG TRÍ KHU VỰC ĐÓN KHÁCH", "section", true, 11, 3, "name", 38],
    ["unibenfood", "C", "THIẾT KẾ VÀ SẢN XUẤT POSM CHO CHUỖI CỬA HÀNG MIỀN BẮC", "item", true, 11, 3, "name", 38],
    ["clofull_decor", "C", "Sự kiện ra mắt sản phẩm mới Moana tại Vincom Đồng Khởi ngày 01/10/2026 - Booth chính + POSM", "item", true, 11, 3, "name", 48],
    ["clofull_decor", "C", "HẠNG MỤC SÂN KHẤU VÀ TRANG TRÍ KHU VỰC ĐÓN KHÁCH", "section", true, 11, 2, "name", 50],
    ["clofull_decor", "D", "THIẾT KẾ VÀ SẢN XUẤT POSM CHO CHUỖI CỬA HÀNG MIỀN BẮC", "item", false, 10, 3, "detail", 30],
    ["clofull_conngay", "D", "THIẾT KẾ VÀ SẢN XUẤT POSM CHO CHUỖI CỬA HÀNG MIỀN BẮC", "item", false, 10, 3, "detail", 30],
  ];
  for (const [code, cot, chu, kind, dam, co, dong, truong, rongDo] of CA) {
    it(`${code} · ${kind} "${chu.slice(0, 30)}…" cao ≥ ${caoCan(dong, dam, co)}pt`, async () => {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await buildQuoteBuffer(baoGia(code, [{ kind: "item", name: "X" }])));
      expect(wb.worksheets[0].getColumn(cot).width, "cột rộng hơn bề rộng đã đo — số đo Excel không còn là cận dưới").toBeLessThanOrEqual(rongDo);
      const muc = truong === "name" ? { kind, name: chu } : { kind, name: "Hạng mục", [truong]: chu };
      const cao = await caoHangCo(code, [{ kind: "section", name: "NHÓM", quantity: 1 }, muc], cot, chu);
      expect(cao, "không thấy hàng").not.toBeNull();
      expect(cao, `hàng cao ${cao}pt — Excel cần ${caoCan(dong, dam, co)}pt, dòng cuối bị che`).toBeGreaterThanOrEqual(caoCan(dong, dam, co));
    });
  }

  it("marico_decor · Ghi chú 'Đã bao gồm VAT. Đã bao gồm VAT' ở cột I (16,8 · thường 11) cao ≥ 45pt", async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await buildQuoteBuffer(baoGia("marico_decor", [{ kind: "item", name: "Hạng mục", notes: "Đã bao gồm VAT. Đã bao gồm VAT" }])));
    const ws = wb.worksheets[0];
    let cao = null;
    ws.eachRow((row) => { if (String(row.getCell("I").value ?? "").startsWith("Đã bao gồm VAT.")) cao = row.height; });
    expect(cao).not.toBeNull();
    expect(cao, `hàng cao ${cao}pt — Excel cần 45pt`).toBeGreaterThanOrEqual(45);
  });

  it("chữ ngắn vẫn giữ hàng một dòng (không nới vô cớ)", async () => {
    expect(await caoHangCo("unibenfood", [{ kind: "item", name: "Standee" }], "C", "Standee")).toBe(18);
    expect(await caoHangCo("clofull_decor", [{ kind: "item", name: "Bàn check in" }], "C", "Bàn check in")).toBe(18);
  });
});
