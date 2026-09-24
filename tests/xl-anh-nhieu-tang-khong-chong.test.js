// L39 — cột HÌNH ẢNH: hạng mục có từ 2 ảnh trở lên thì ảnh dưới ĐÈ lên đáy ảnh trên.
//
// ── LỖI ─────────────────────────────────────────────────────────────────────
// `insertItemImages` (src/excel.ts) đặt vị trí ảnh bằng PHÂN SỐ hàng: `tl.row = hàng-1 + k/n + 0.015`.
// Setter `Anchor.row` của ExcelJS 4.4.0 (node_modules/exceljs/lib/doc/anchor.js) đổi phần lẻ ra
// EMU theo `row.height * 10000`, trong khi DrawingML tính 1pt = 12700 EMU. Mọi độ lệch dọc chỉ còn
// 10000/12700 ≈ 78,7% so với dự tính, còn kích thước ảnh (`ext`, 9525 EMU/px) thì vẫn đúng ⇒ các
// tầng ảnh bị kéo sát lại và chồng nhau. Đo bằng Excel thật (COM, Shapes.Top/Height): 2 ảnh vuông
// trong hàng 120pt chồng 8,3pt; 10 ảnh thì dồn hết lên trên, đáy hàng 405pt trống ~77pt.
//
// Bài này đọc lại TOẠ ĐỘ GỐC trong drawing của tệp xuất (nativeRow/nativeRowOff — EMU thật mà
// Excel dùng) chứ không đọc qua getter phân số của ExcelJS, vì getter đó mắc đúng lỗi quy đổi kia
// nên đọc qua nó thì lỗi tự triệt tiêu và bài luôn xanh.
import { describe, it, expect } from "vitest";
import zlib from "node:zlib";
import ExcelJS from "exceljs";
import { buildQuoteBuffer } from "../src/excel.js";

const EMU_PT = 12700, EMU_PX = 9525;

/** PNG hợp lệ w×h (RGB, một màu) — đủ cho `imgDims` đọc kích thước và cho Excel mở được. */
function png(w, h) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 0x80)]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  const buf = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${buf.toString("base64")}`;
}

function baoGia(code, soAnh, anh) {
  return {
    quoteNumber: "GN26L39", title: "Ảnh nhiều tầng", toCompany: "Công ty ABC", toContact: "Anh A",
    vatPercent: 8, showTotals: false, city: "TP. Hồ Chí Minh", quoteDate: new Date("2026-09-24"),
    sheets: [{
      order: 1, name: "S", groupSubtotal: false, showImages: true, template: { code },
      items: soAnh.map((n, i) => ({ kind: "item", order: i, name: `Hạng mục ${n} ảnh`, unit: "cái", quantity: 1, unitPrice: 1000, images: Array.from({ length: n }, () => anh) })),
    }],
  };
}

/** Ảnh của sheet đầu, gom theo hàng: [{ hang, caoHangEmu, anh: [{ tren, duoi }] }]. */
async function anhTheoHang(buf) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.worksheets[0];
  const theoHang = new Map();
  for (const img of ws.getImages()) {
    const tl = img.range.tl;
    if (!img.range.ext) continue;           // logo của mẫu (twoCellAnchor) — không phải ảnh hạng mục
    const hang = tl.nativeRow + 1;
    const tren = tl.nativeRowOff;
    const duoi = tren + Math.round(img.range.ext.height * EMU_PX);
    if (!theoHang.has(hang)) theoHang.set(hang, []);
    theoHang.get(hang).push({ tren, duoi });
  }
  return [...theoHang.entries()].map(([hang, anh]) => ({
    hang, caoHangEmu: Math.round((ws.getRow(hang).height || 15) * EMU_PT), anh: anh.sort((a, b) => a.tren - b.tren),
  }));
}

const MAU = ["marico_decor", "unibenfood", "clofull_decor", "clofull_conngay"];

describe("L39: ảnh nhiều tầng trong một ô HÌNH ẢNH không đè nhau và nằm gọn trong hàng", () => {
  for (const code of MAU) {
    it(`${code}: 1/2/3/5/10 ảnh vuông — không tầng nào chồng tầng trên, đáy ảnh cuối ≤ đáy hàng`, async () => {
      const hangs = await anhTheoHang(await buildQuoteBuffer(baoGia(code, [1, 2, 3, 5, 10], png(50, 50))));
      expect(hangs.map((h) => h.anh.length).sort((a, b) => a - b)).toEqual([1, 2, 3, 5, 10]);
      for (const { hang, caoHangEmu, anh } of hangs) {
        for (let k = 1; k < anh.length; k++) {
          const chong = (anh[k - 1].duoi - anh[k].tren) / EMU_PT;
          expect(chong, `hàng ${hang}: ảnh ${k + 1}/${anh.length} đè ảnh trên ${chong.toFixed(1)}pt`).toBeLessThanOrEqual(0);
        }
        const cuoi = anh[anh.length - 1];
        expect(cuoi.duoi, `hàng ${hang}: ảnh cuối tràn qua đáy hàng`).toBeLessThanOrEqual(caoHangEmu);
        expect(anh[0].tren).toBeGreaterThanOrEqual(0);
      }
    });
  }

  it("10 ảnh: chồng ảnh phủ hết chiều cao hàng — đáy hàng không còn dải trống lớn", async () => {
    const [{ caoHangEmu, anh }] = await anhTheoHang(await buildQuoteBuffer(baoGia("marico_decor", [10], png(50, 50))));
    expect(anh.length).toBe(10);
    const trongDay = (caoHangEmu - anh[9].duoi) / EMU_PT;
    // Lỗi cũ để trống ~77pt. Mỗi tầng chừa 6px (4,5pt) giữa các ảnh — đáy chỉ còn phần đệm đó.
    expect(trongDay, `đáy hàng trống ${trongDay.toFixed(1)}pt`).toBeLessThan(8);
  });

  it("ảnh chữ nhật đứng (tỉ lệ 1:3) nhiều tầng cũng không đè nhau", async () => {
    const hangs = await anhTheoHang(await buildQuoteBuffer(baoGia("clofull_decor", [2, 5], png(20, 60))));
    for (const { hang, caoHangEmu, anh } of hangs) {
      for (let k = 1; k < anh.length; k++) expect(anh[k].tren, `hàng ${hang} ảnh ${k + 1}`).toBeGreaterThanOrEqual(anh[k - 1].duoi);
      expect(anh[anh.length - 1].duoi).toBeLessThanOrEqual(caoHangEmu);
    }
  });
});
