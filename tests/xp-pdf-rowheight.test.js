// LỖI: chiều cao hàng trong bảng hạng mục của PDF được tính bằng cách ĐẾM ký tự "\n"
//      (src/pdf.ts, drawItemsTable: `8 + lines * 12`), trong khi chữ lại được vẽ CÓ ràng buộc
//      bề rộng cột (`doc.text(v, x, y, { width: cols[i].w - 4 })`) nên pdfkit TỰ xuống dòng.
//      Cột "Hạng mục" chỉ rộng 200pt ở cỡ chữ 10 (~40 ký tự/dòng) còn tên hạng mục được phép
//      dài tới 2000 ký tự (src/validators.ts) → một tên dài chiếm 6–8 dòng nhưng khung hàng
//      vẫn chỉ cao 20pt.
//
// TÁI HIỆN: render báo giá có MỘT hạng mục tên ~250 ký tự (không dấu, để không phụ thuộc việc
//      máy có font Unicode trong fonts/ hay không), rồi bung stream nội dung PDF và đọc lệnh
//      `x y w h re` — đó chính là khung chữ nhật app kẻ cho hàng đó.
//
// HẬU QUẢ: khung kẻ ngắn hơn chữ → chữ của hàng này tràn đè lên hàng dưới, `y += rowH` đẩy sai
//      nên cả bảng lệch, và điều kiện ngắt trang (`y + rowH > pageBottom()`) cũng dùng đúng con
//      số sai đó nên trang bị tràn. Đây là tài liệu GỬI CHO KHÁCH.
import { describe, it, expect } from "vitest";
import zlib from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import PDFDocument from "pdfkit";
import { renderQuotePdf } from "../src/pdf.js";

const FONT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fonts");
/** Cùng cách chọn font với src/pdf.ts (registerFonts) — nếu không thì chiều cao đo ra lệch. */
function bodyFont() {
  const reg = path.join(FONT_DIR, "Times.ttf"), bold = path.join(FONT_DIR, "Times-Bold.ttf");
  return fs.existsSync(reg) && fs.existsSync(bold) ? reg : "Times-Roman";
}
/** Chiều cao chữ THẬT khi bị ràng trong bề rộng cột "Hạng mục" (200pt, trừ 4pt đệm). */
function neededHeight(text) {
  const probe = new PDFDocument({ size: "A4", margin: 40 });
  probe.font(bodyFont()).fontSize(10);
  const h = probe.heightOfString(String(text), { width: 200 - 4 });
  probe.end();
  return h;
}
/** Bung mọi stream trong PDF → chuỗi lệnh vẽ. */
function contentOps(buf) {
  const s = buf.toString("latin1");
  const out = [];
  const re = /stream\r?\n/g;
  let m;
  while ((m = re.exec(s))) {
    const start = m.index + m[0].length;
    const end = s.indexOf("endstream", start);
    if (end < 0) continue;
    try { out.push(zlib.inflateSync(Buffer.from(s.slice(start, end), "latin1")).toString("latin1")); } catch { /* stream font, bỏ qua */ }
  }
  return out.join("\n");
}
const rowRects = (buf) =>
  [...contentOps(buf).matchAll(/([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) re/g)]
    .map((x) => ({ x: +x[1], y: +x[2], w: +x[3], h: +x[4] }))
    .filter((r) => r.w > 500 && r.h !== 18);   // bỏ hàng TIÊU ĐỀ bảng (cao đúng 18pt)

const CHUNK = "Backdrop khung sat son tinh dien kem bat hiflex in UV 1440dpi lap dat tai tang tret ";
const quoteOf = (items) => ({
  quoteNumber: "PDFWRAP", title: "Bao gia", quoteDate: new Date("2026-08-01"),
  company: { name: "Cty" }, subtotal: 0, vat: 0, total: 0, vatPercent: 0,
  sheets: [{ name: "S1", groupSubtotal: false, items }],
});

describe("PDF — khung hàng phải cao bằng chữ đã tự xuống dòng", () => {
  it("hạng mục tên dài: khung chữ nhật phải đủ cao cho chữ", async () => {
    const name = (CHUNK + CHUNK + CHUNK).slice(0, 250);
    const buf = await renderQuotePdf(quoteOf([{ kind: "item", name, unit: "cai", quantity: 1, unitPrice: 1000 }]));
    const rects = rowRects(buf);
    expect(rects.length).toBe(1);
    const need = neededHeight(name);
    expect(need).toBeGreaterThan(40);                 // tự kiểm: chữ này THỰC SỰ phải xuống nhiều dòng
    expect(rects[0].h).toBeGreaterThanOrEqual(need);  // ĐỎ khi chưa vá: h = 20pt
  });

  it("nhiều hạng mục tên dài: bảng phải tràn sang trang thứ hai", async () => {
    const items = Array.from({ length: 12 }, (_, i) => ({
      kind: "item", name: (CHUNK + CHUNK).slice(0, 160) + " #" + (i + 1), unit: "cai", quantity: 1, unitPrice: 1000,
    }));
    const buf = await renderQuotePdf(quoteOf(items));
    const pages = (buf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
    expect(pages).toBeGreaterThanOrEqual(2);          // ĐỎ khi chưa vá: dồn hết vào 1 trang, chữ chồng nhau
  });

  it("hàng ngắn bình thường vẫn cao tối thiểu 18pt (không đổi hành vi cũ)", async () => {
    const buf = await renderQuotePdf(quoteOf([{ kind: "item", name: "Ghe", unit: "cai", quantity: 2, unitPrice: 50000 }]));
    const rects = rowRects(buf);
    expect(rects.length).toBe(1);
    expect(rects[0].h).toBe(20);
  });
});
