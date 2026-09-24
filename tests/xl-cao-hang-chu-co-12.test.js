// Ô chữ CỠ 12 ngoài bảng hạng mục bị hụt chiều cao dòng cuối — soát toàn diện đợt 3 1b.
//
// ── LỖI ─────────────────────────────────────────────────────────────────────
// `caoTheoChu` (src/excel.ts) nới hàng của khối "Kính gửi" (C3:I3) và dải "* Thông tin chương
// trình" (B5:I5) của Colorfull theo số dòng, nhưng tính mỗi dòng 15pt — số của chữ cỡ 11. Hai ô
// này là Times New Roman CỠ 12, Excel cần 15,75pt mỗi dòng. Đo bằng Excel COM (chép chữ sang ô tạm
// rộng đúng vùng gộp rồi AutoFit): khối "Kính gửi" đủ 5 dòng (công ty · người liên hệ · ĐT · Đ/c ·
// Email) cần 78,75pt mà app đặt 78pt; dải thông tin 7 dòng cần 110,25pt mà app đặt 108pt. Hụt
// 0,75pt mỗi dòng nên từ khoảng 5 dòng trở lên dòng cuối bắt đầu bị xén.
import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { buildQuoteBuffer, soDongKhiXuongHang } from "../src/excel.js";

const INFO = [
  "Chương trình ra mắt sản phẩm mới Moana tại Vincom Đồng Khởi ngày 01/10/2026, thời gian lắp đặt từ 22h đêm hôm trước",
  "Địa điểm: sảnh chính tầng trệt, khu vực đón khách bên trái thang cuốn, diện tích 120m2",
  "Thời gian thi công: 22h đến 5h sáng hôm sau, tháo dỡ ngay sau khi kết thúc chương trình",
  "Liên hệ tại chỗ: anh Nam 0909 123 456, chị Lan 0912 345 678 — phụ trách kỹ thuật và hậu cần",
  "Yêu cầu: mọi hạng mục in ấn phải duyệt maquette trước 3 ngày, vật tư đạt chuẩn chống cháy",
];

async function xuat(code, { info = [], notes = null } = {}) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await buildQuoteBuffer({
    quoteNumber: "CF26D3", title: "Moana", toCompany: "Công ty ABC", toContact: "Anh Nguyễn Văn A", toEmail: "a@abc.vn",
    toPhone: "0909 123 456", toAddress: "123 Nguyễn Văn Linh, Q.7", notes, vatPercent: 8, showTotals: true,
    city: "TP. Hồ Chí Minh", quoteDate: new Date("2026-09-24"),
    sheets: [{ order: 1, name: "S", template: { code }, items: [
      ...info.map((name, i) => ({ order: i, kind: "info", name })),
      { order: 50, kind: "item", name: "Hạng mục", unit: "cái", quantity: 1, unitPrice: 1000 },
    ] }],
  }));
  return wb.worksheets[0];
}
/** Tổng bề rộng LƯU của các cột trong vùng gộp bắt đầu ở `addr` (thứ `soDongKhiXuongHang` nhận). */
function beRongGop(ws, addr) {
  const vung = ws.model.merges.find((m) => m.startsWith(`${addr}:`));
  const [, a, b] = /^([A-Z])\d+:([A-Z])\d+$/.exec(vung);
  let tong = 0;
  for (let i = a.charCodeAt(0); i <= b.charCodeAt(0); i++) tong += ws.getColumn(String.fromCharCode(i)).width;
  return tong;
}

describe("chữ cỡ 12: mỗi dòng 15,75pt như Excel", () => {
  for (const code of ["clofull_decor", "clofull_conngay", "clofull_banner"]) {
    it(`${code} · khối "Kính gửi" 5 dòng cao ≥ 78,75pt (số đo Excel)`, async () => {
      const ws = await xuat(code);
      const o = ws.getCell("C3");
      expect(o.font?.size, "bài này giả định ô C3 cỡ 12 như tệp mẫu").toBe(12);
      expect(String(o.value).split("\n")).toHaveLength(5);
      expect(ws.getRow(3).height, "dòng Email bị xén").toBeGreaterThanOrEqual(78.75);
    });

    it(`${code} · dải thông tin chương trình nhiều dòng: đủ 15,75pt cho MỖI dòng ước lượng`, async () => {
      const ws = await xuat(code, { info: [...INFO, ...INFO] });
      const o = ws.getCell("B5");
      expect(o.font?.size).toBe(12);
      const soDong = soDongKhiXuongHang(o.value, beRongGop(ws, "B5"), { dam: !!o.font.bold, co: 12 });
      expect(soDong, "cần ca đủ dài để lộ phần hụt").toBeGreaterThanOrEqual(5);
      expect(ws.getRow(5).height).toBeGreaterThanOrEqual(soDong * 15.75);
    });
  }

  it("ô '* Ghi chú' cỡ 11 giữ nguyên 15pt/dòng (không nới vô cớ)", async () => {
    const ghiChu = INFO.join("\n");
    const ws = await xuat("clofull_decor", { notes: ghiChu });
    let r = null;
    ws.eachRow((row, i) => { if (String(row.getCell("C").value ?? "").startsWith("* Ghi chú")) r = i; });
    expect(r).not.toBeNull();
    const o = ws.getCell(`C${r}`);
    expect(o.font?.size).toBe(11);
    const soDong = soDongKhiXuongHang(o.value, beRongGop(ws, `C${r}`), { dam: !!o.font.bold, co: 11 });
    expect(ws.getRow(r).height).toBe(Math.min(409, soDong * 15 + 3));
  });
});
