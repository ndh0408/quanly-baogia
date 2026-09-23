/**
 * ============================================================================
 * BẬT CỘT "HÌNH ẢNH" → CỘT ẢNH LÀ CỘT CUỐI MỚI CỦA BẢNG, MỌI DẢI KÉO NGANG PHẢI NỐI SANG NÓ.
 *
 * Người dùng báo 2026-09-23 (ảnh chụp tệp Colorfull xuất có cột ảnh): dải "BẢNG BÁO GIÁ" và dải
 * "Thông tin chương trình" dừng ở cột Ghi Chú, cột HÌNH ẢNH trắng — "chưa kéo màu hoàn chỉnh";
 * hàng nhóm con thì ô ảnh tô xanh trong khi ô Ghi Chú cạnh đó trắng (tệp mẫu Colorfull người dùng
 * chỉnh: nhóm con chỉ tô C..H). Áp cho CẢ bốn mẫu: GN / GN có ngày / CLF / CLF có ngày.
 * ============================================================================
 */
import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { buildQuoteBuffer } from "../src/excel.js";

const MAU = ["marico_decor", "unibenfood", "clofull_decor", "clofull_conngay"];
const cot = (s) => [...s].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
const giai = (m) => { const x = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(m); return x ? { c1: cot(x[1]), r1: +x[2], c2: cot(x[3]), r2: +x[4] } : null; };
const nen = (c) => { const f = c.fill; return f && f.type === "pattern" && f.fgColor ? (f.fgColor.argb || `t${f.fgColor.theme}`) : null; };

async function xuat(code, showImages = true) {
  const q = { quoteNumber: "X", title: "T", toCompany: "K", toContact: "Ms. A", city: "TP. Hồ Chí Minh", quoteDate: new Date("2026-09-23"), vatPercent: 8, hnTables: [],
    sheets: [{ order: 1, name: "S", groupSubtotal: false, discount: 0, extraTables: [], showImages, template: { code }, templateCode: code, items: [
      { order: 0, kind: "info", name: "Thông tin chương trình" },
      { order: 1, kind: "section", name: "NHOM", quantity: 1 },
      { order: 2, kind: "item", name: "A", unit: "m2", quantity: 2, days: 1, unitPrice: 1000 },
      { order: 3, kind: "subsection", name: "CON", quantity: 1 },
      { order: 4, kind: "item", name: "B", unit: "m2", quantity: 1, days: 1, unitPrice: 1000 }] }] };
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await buildQuoteBuffer(q));
  return wb.worksheets[0];
}
const oTieuDeAnh = (ws) => { let o = null; ws.eachRow((row) => row.eachCell((c) => { if (String(c.value) === "HÌNH ẢNH") o = c; })); return o; };

describe("Cột HÌNH ẢNH: dải kéo ngang nối dài + nền theo ô Ghi Chú", () => {
  for (const code of MAU) {
    it(`${code}: mọi dải đầu trang từng dừng ở cột cuối cũ nay dừng ở cột ảnh; không gộp chồng`, async () => {
      const cu = await xuat(code, false);
      const moi = await xuat(code, true);
      const h = oTieuDeAnh(moi);
      expect(h, "không thấy ô tiêu đề HÌNH ẢNH").toBeTruthy();
      const cotAnh = h.col, cotCuoiCu = cotAnh - 1, hangTieuDe = +h.address.match(/\d+/)[0];
      // Dải đầu trang của bản KHÔNG ảnh kết thúc ở cột cuối cũ → bản có ảnh phải kết thúc ở cột ảnh.
      const daiCu = (cu.model.merges || []).map(giai).filter((v) => v && v.c2 === cotCuoiCu && v.r2 < hangTieuDe);
      expect(daiCu.length, "mẫu phải có ít nhất một dải đầu trang để bài kiểm có nghĩa").toBeGreaterThan(0);
      const daiMoi = (moi.model.merges || []).map(giai).filter(Boolean);
      for (const d of daiCu) {
        expect(daiMoi.some((v) => v.r1 === d.r1 && v.c1 === d.c1 && v.c2 === cotAnh), `dải hàng ${d.r1} chưa nối sang cột ảnh`).toBe(true);
      }
      const chong = daiMoi.some((a, i) => daiMoi.some((b, j) => i < j && a.c1 <= b.c2 && b.c1 <= a.c2 && a.r1 <= b.r2 && b.r1 <= a.r2));
      expect(chong, "vùng gộp chồng nhau → Excel đòi sửa tệp").toBe(false);
    });

    it(`${code}: ô ảnh mang ĐÚNG nền của ô Ghi Chú cùng hàng (nhóm tô, nhóm con theo mẫu)`, async () => {
      const ws = await xuat(code, true);
      const h = oTieuDeAnh(ws), cotAnh = h.col;
      let soHang = 0;
      ws.eachRow((row, r) => {
        const ten = String(row.getCell("C").value ?? "");
        if (ten === "NHOM" || ten === "CON" || ten === "A" || ten === "B") {
          soHang++;
          expect(nen(ws.getCell(r, cotAnh)), `${ten}: nền ô ảnh khác ô Ghi Chú`).toBe(nen(ws.getCell(r, cotAnh - 1)));
        }
      });
      expect(soHang).toBe(4);
    });
  }
});
