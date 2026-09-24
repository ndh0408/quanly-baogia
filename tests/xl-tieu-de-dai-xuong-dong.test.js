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
import { buildQuoteBuffer, soDongKhiXuongHang, HE_SO_TIEU_DE } from "../src/excel.js";

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
//
// ── ĐO LẠI Ở NGƯỠNG 2→3 DÒNG (soát toàn diện đợt 4 d4-excel 1) ──
// Bộ 832 ca chỉ dò kỹ ngưỡng 1→2 dòng. Đo bổ sung bằng Excel COM (cùng cách: ô tạm rộng ĐÚNG số px
// của vùng gộp, bật wrap, AutoFit): 237 chuỗi — tiền tố cắt ở MỌI ranh giới từ của 7 câu gốc (HOA,
// thường, Title Case, tiếng Anh, kích thước), 40–260 ký tự — × 8 vùng gộp = 1896 ca, phủ 1 đến 4 dòng.
// Ca khó nhất nằm ở ngưỡng 2→3 dòng: cỡ 18 cần hệ số ≥ 1,0006 (hệ số cũ 1,0 ⇒ app ước 2 dòng, Excel
// vẽ 3 — dòng thứ ba bị xén), cỡ 14 cần ≥ 1,0233 (hệ số cũ 1,035 chỉ còn biên ~1%). Các ca "Excel 2/3
// dòng" cuối danh sách là những ca sát nhất của bộ đo mới.
//
// Hai ca "Excel vừa một dòng" của bộ cũ nay nằm trong vùng ĐÁNH ĐỔI có chủ ý và được bỏ khỏi danh sách:
// "…VINCOM ĐỒNG" ở clofull_decor (app bật wrap từ hệ số 1,0189) và "…VINCOM ĐỒNG KHỞI" ở unibenfood
// (từ 1,0439). Giữ chúng một dòng thì biên trên ca khó nhất tụt dưới 2% — mà chữ bị xén tệ hơn một
// hàng tiêu đề cao dư: thà cao còn hơn cắt chữ.
const SAT_NGUONG = [
  // Excel vừa MỘT dòng — hệ số chung 1,05 vẫn bật wrap và nới hàng.
  ["clofull_decor", true, "BẢNG BÁO GIÁ - Sự kiện ra mắt sản phẩm mới Moana tại Vincom Đồng Khởi ngày 01/10/2026 booth", 1],
  ["clofull_conngay", false, "BẢNG BÁO GIÁ - SỰ KIỆN RA MẮT SẢN PHẨM MỚI MOANA TẠI VINCOM ĐỒNG KHỞI", 1],
  ["unibenfood", true, "BẢNG BÁO GIÁ - Hội Nghị Khách Hàng Thường Niên Mùa Hè Tổng Kết Năm Tri Ân Đối Tác Chiến Lược Khu", 1],
  // Excel cần HAI dòng — những ca sát ngưỡng nhất của bộ đo; hạ hệ số quá tay là chúng bị cắt hai đầu.
  ["unibenfood", true, "BẢNG BÁO GIÁ - Sự kiện ra mắt sản phẩm mới Moana tại Vincom Đồng Khởi ngày 01/10/2026 booth chính khu vực", 2],
  ["unibenfood", true, "BẢNG BÁO GIÁ - Hội Nghị Khách Hàng Thường Niên Mùa Hè Tổng Kết Năm Tri Ân Đối Tác Chiến Lược Khu Vực", 2],
  ["clofull_conngay", true, "BẢNG BÁO GIÁ - Unilever Vietnam Activation Roadshow Summer Campaign Booth Design Production Installation", 2],
  ["clofull_decor", false, "BẢNG BÁO GIÁ - LED P3.91 6mW x 3mH 01/10/2026 W&M 0m8W x 0m5H x 8 tấm 1m2W x", 2],
  ["clofull_decor", true, "BẢNG BÁO GIÁ - thi công lắp đặt tháo dỡ vận chuyển bảo trì bảo dưỡng hệ thống trang trí sự kiện tiệc tất", 2],
  ["marico_decor", true, "BẢNG BÁO GIÁ - Sự kiện ra mắt sản phẩm mới Moana tại Vincom Đồng Khởi ngày 01/10/2026 - Booth chính khu", 2],
  // Excel cần BA dòng — ngưỡng 2→3, ràng buộc thật của hệ số (xem đo lại ở trên).
  ["clofull_decor", true, "BẢNG BÁO GIÁ - thi công lắp đặt tháo dỡ vận chuyển bảo trì bảo dưỡng hệ thống trang trí sự kiện tiệc tất niên cuối năm của công ty tại khách sạn lớn trung tâm thành phố với đầy đủ thiết bị ánh sáng âm thanh", 3],
  ["clofull_conngay", true, "BẢNG BÁO GIÁ - thi công lắp đặt tháo dỡ vận chuyển bảo trì bảo dưỡng hệ thống trang trí sự kiện tiệc tất niên cuối năm của công ty tại khách sạn lớn trung tâm thành phố với đầy đủ thiết bị ánh sáng âm thanh màn hình led sân", 3],
  ["unibenfood", true, "BẢNG BÁO GIÁ - Hội Nghị Khách Hàng Thường Niên Mùa Hè Tổng Kết Năm Tri Ân Đối Tác Chiến Lược Khu Vực Miền Nam Và Miền Trung Tổ Chức Tại Trung Tâm Hội Nghị Quốc Gia Với Chương Trình Nghệ Thuật Đặc Sắc", 3],
  ["marico_decor", true, "BẢNG BÁO GIÁ - thi công lắp đặt tháo dỡ vận chuyển bảo trì bảo dưỡng hệ thống trang trí sự kiện tiệc tất niên cuối năm của công ty tại khách sạn lớn trung tâm thành phố với đầy đủ thiết bị ánh sáng âm thanh màn hình led sân", 3],
];

async function xuatTieuDe(code, anh, chu) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await buildQuoteBuffer({
    quoteNumber: "GN26L44", title: chu.replace(/^BẢNG BÁO GIÁ - /, ""), vatPercent: 8, showTotals: false,
    city: "TP. Hồ Chí Minh", quoteDate: new Date("2026-09-24"),
    sheets: [{ order: 1, name: "", showImages: anh, template: { code }, items: [{ order: 0, kind: "item", name: "A", unit: "cái", quantity: 1, unitPrice: 1000 }] }],
  }));
  const ws = wb.worksheets[0];
  const addr = code.startsWith("clofull") ? "B2" : "B7";
  return { ws, addr, o: ws.getCell(addr) };
}

describe("L44 sát ngưỡng: wrap đúng khi Excel cần, không sớm hơn", () => {
  for (const [code, anh, chu, dongExcel] of SAT_NGUONG) {
    it(`${code}${anh ? " + cột ảnh" : ""} · Excel ${dongExcel} dòng · ${chu.slice(15, 60)}…`, async () => {
      const { ws, addr, o } = await xuatTieuDe(code, anh, chu);
      expect(o.value, "bài phải thử đúng chuỗi đã đo").toBe(chu);
      if (dongExcel === 1) {
        expect(o.alignment?.wrapText ?? false, "Excel vừa một dòng mà vẫn bật wrap — hàng tiêu đề nới gấp đôi vô cớ").toBe(false);
      } else {
        expect(o.alignment?.wrapText, "Excel cần nhiều dòng mà không bật wrap → chữ bị cắt hai đầu").toBe(true);
        const moiDong = code.startsWith("clofull") ? 22.5 : 18.75;
        expect(ws.getRow(+addr.slice(1)).height, `Excel vẽ ${dongExcel} dòng — hàng thấp hơn là dòng cuối bị xén`)
          .toBeGreaterThanOrEqual(dongExcel * moiDong);
      }
    });
  }
});

// ── BIÊN AN TOÀN (soát toàn diện đợt 4 d4-excel 1) ──────────────────────────────────────────────
// Hệ số tiêu đề phải chừa ÍT NHẤT 2% trên mọi ca Excel cần nhiều dòng ở trên: máy khác DPI / bản
// Excel khác vẽ chữ lệch vài phần trăm, và hệ số tới hạn cứ nhích lên mỗi lần đo dày hơn (832 ca:
// 0,98 ở cỡ 18 → 1896 ca: 1,0006). Chia hệ số cho 1,02 mà vẫn đủ dòng thì còn biên 2%.
function beRongVungGop(ws, addr) {
  const vung = ws.model.merges.find((m) => m.startsWith(`${addr}:`));
  const [, c1, c2] = /^([A-Z])\d+:([A-Z])\d+$/.exec(vung);
  let tong = 0;
  for (let i = c1.charCodeAt(0); i <= c2.charCodeAt(0); i++) tong += ws.getColumn(String.fromCharCode(i)).width;
  return tong;
}

describe("L44 biên: hệ số tiêu đề chừa ≥ 2% trên các ca Excel khó nhất", () => {
  for (const [code, anh, chu, dongExcel] of SAT_NGUONG.filter((x) => x[3] >= 2)) {
    it(`${code}${anh ? " + cột ảnh" : ""} · Excel ${dongExcel} dòng · ${chu.slice(15, 60)}…`, async () => {
      const { ws, addr, o } = await xuatTieuDe(code, anh, chu);
      const co = o.font.size;
      const heSo = HE_SO_TIEU_DE[co];
      expect(heSo, `cỡ ${co} phải có hệ số tiêu đề đã đo`).toBeTypeOf("number");
      expect(soDongKhiXuongHang(chu, beRongVungGop(ws, addr), { dam: true, co, heSo: heSo / 1.02 }),
        `hệ số ${heSo} chừa chưa tới 2% trên ca này`).toBeGreaterThanOrEqual(dongExcel);
    });
  }
});
