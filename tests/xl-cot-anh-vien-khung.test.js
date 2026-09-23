// L42 — bật cột HÌNH ẢNH: vạch DÀY chạy dọc giữa bảng (Ghi chú | Hình ảnh) ở mẫu GN, và ô tiêu đề
// HÌNH ẢNH có đáy dày lệch với mọi ô tiêu đề khác (cả GN lẫn Colorfull).
//
// ── LỖI ─────────────────────────────────────────────────────────────────────
// Mẫu GN nướng sẵn khung ngoài trong tệp mẫu: cột I (Ghi chú) có viền PHẢI 'medium' ở mọi hàng từ
// tiêu đề tới hạng mục cuối. Bật cột ảnh thì J thành cột cuối (viền phải 'medium'), nhưng không
// đoạn mã nào gỡ viền dày ở I — Colorfull thì đã chữa qua `outerFrame`, GN không đi qua nhánh đó.
// Đo bằng Excel COM Borders(): I12 phải=DÀY, J12 trái=DÀY. Riêng ô tiêu đề HÌNH ẢNH, `datVien` đặt
// cứng đáy 'medium' trong khi đáy các ô tiêu đề khác 'thin' (I11 đáy mảnh, J11 đáy DÀY; CLF I4/J4
// y như vậy).
import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { buildQuoteBuffer } from "../src/excel.js";

async function xuat(code, showImages) {
  const items = [
    { kind: "section", name: "NHOM", quantity: 1 },
    { kind: "item", name: "A", unit: "cái", quantity: 1, days: 1, unitPrice: 1000 },
    { kind: "subsection", name: "CON", quantity: 1 },
    { kind: "item", name: "B", unit: "cái", quantity: 1, days: 1, unitPrice: 1000 },
  ];
  const q = { quoteNumber: "X", title: "T", toCompany: "K", vatPercent: 8, showTotals: false, city: "TP. Hồ Chí Minh", quoteDate: new Date("2026-09-24"),
    sheets: [{ order: 1, name: "S", showImages, template: { code }, items: items.map((x, i) => ({ order: i, ...x })) }] };
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await buildQuoteBuffer(q));
  return wb.worksheets[0];
}
const kieu = (b) => b?.style ?? null;
/** Hàng tiêu đề cột (ô "Hạng Mục") và hàng hạng mục cuối ("B"). */
function hangBang(ws) {
  let dau = null, cuoi = null;
  ws.eachRow((row, r) => {
    const c = String(row.getCell("C").value ?? "");
    if (dau == null && /^Hạng Mục$/i.test(c.trim())) dau = r;
    if (c === "B") cuoi = r;
  });
  return { dau, cuoi };
}
const DAY = new Set(["medium", "thick", "double"]);

describe("L42: cột HÌNH ẢNH là cột cuối — chỉ nó mang cạnh phải dày; tiêu đề HÌNH ẢNH cùng nét với hàng tiêu đề", () => {
  for (const code of ["marico_decor", "gn_banner", "unibenfood", "clofull_decor", "clofull_conngay"]) {
    it(`${code}: không còn vạch dày giữa Ghi chú | Hình ảnh`, async () => {
      const ws = await xuat(code, true);
      const { dau, cuoi } = hangBang(ws);
      expect(dau && cuoi, "không dò được bảng").toBeTruthy();
      let cotAnh = null;
      ws.getRow(dau).eachCell((c) => { if (String(c.value) === "HÌNH ẢNH") cotAnh = c.col; });
      expect(cotAnh).toBeTruthy();
      const cotGhiChu = cotAnh - 1;
      for (let r = dau; r <= cuoi; r++) {
        if (ws.getRow(r).hidden) continue;   // dải thông tin chương trình rỗng của Colorfull bị ẩn
        const gc = ws.getCell(r, cotGhiChu).border || {}, anh = ws.getCell(r, cotAnh).border || {};
        expect(DAY.has(kieu(gc.right)), `hàng ${r}: Ghi chú còn cạnh phải ${kieu(gc.right)} — vạch dày giữa bảng`).toBe(false);
        expect(DAY.has(kieu(anh.left)), `hàng ${r}: Hình ảnh có cạnh trái ${kieu(anh.left)}`).toBe(false);
        expect(kieu(anh.right), `hàng ${r}: cột ảnh phải đóng khung ngoài`).toBe("medium");
      }
    });

    it(`${code}: ô tiêu đề HÌNH ẢNH có đáy/đỉnh cùng nét với ô tiêu đề Ghi chú`, async () => {
      const ws = await xuat(code, true);
      const { dau } = hangBang(ws);
      let cotAnh = null;
      ws.getRow(dau).eachCell((c) => { if (String(c.value) === "HÌNH ẢNH") cotAnh = c.col; });
      const gc = ws.getCell(dau, cotAnh - 1).border || {}, anh = ws.getCell(dau, cotAnh).border || {};
      expect(kieu(anh.bottom), "đáy tiêu đề HÌNH ẢNH lệch nét").toBe(kieu(gc.bottom));
      expect(kieu(anh.top), "đỉnh tiêu đề HÌNH ẢNH lệch nét").toBe(kieu(gc.top));
    });
  }

  it("GN TẮT cột ảnh: khung ngoài nướng sẵn giữ nguyên (Ghi chú vẫn là cạnh phải dày)", async () => {
    for (const code of ["marico_decor", "unibenfood"]) {
      const ws = await xuat(code, false);
      const { dau, cuoi } = hangBang(ws);
      for (let r = dau; r <= cuoi; r++) expect(kieu(ws.getCell(`I${r}`).border?.right), `${code} hàng ${r}`).toBe("medium");
    }
  });
});
