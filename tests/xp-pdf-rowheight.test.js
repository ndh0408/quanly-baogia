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

// ─────────────────────────────────────────────────────────────────────────────
// VÒNG 2 — hai vấn đề bộ test vòng 1 không chạm tới.
//
// (A) NHÁNH CẮT (`clipped`) làm MẤT CHỮ trong tài liệu GỬI KHÁCH, im lặng. `name` và `detail`
//     đều được phép dài 2000 ký tự (src/validators.ts) → hàng cần hơn một trang giấy; mã cắt
//     cụt bằng `height`/`ellipsis` cho CẢ 6 ô, không log, không dấu hiệu nào ngoài một dấu "…"
//     lọt thỏm. Quyết định của vòng này: VẪN cắt (hàng cao hơn cả trang thì không chỗ nào vẽ
//     trọn được), nhưng phải CÓ DẤU HIỆU NHÌN THẤY ĐƯỢC trong PDF + cảnh báo trong log.
//
// (B) Hàng TIÊU ĐỀ bảng bị vẽ RA NGOÀI lề dưới khi sheet kế tiếp KHÔNG có tên: `if (sh.name)`
//     trong renderQuotePdf bỏ qua lệnh text duy nhất có thể ép pdfkit sang trang, nên
//     `drawHeader(doc.y + 4)` vẽ thẳng xuống dưới đáy trang. Có sẵn từ trước bản vá vòng 1.

/** Bung nội dung TỪNG trang riêng (pdfkit ghi một content stream cho mỗi trang). */
function pageStreams(buf) {
  const s = buf.toString("latin1");
  const out = [];
  const re = /stream\r?\n/g;
  let m;
  while ((m = re.exec(s))) {
    const start = m.index + m[0].length;
    const end = s.indexOf("endstream", start);
    if (end < 0) continue;
    let t;
    try { t = zlib.inflateSync(Buffer.from(s.slice(start, end), "latin1")).toString("latin1"); } catch { continue; }
    if (/\bre\b/.test(t) || /\bTm\b/.test(t)) out.push(t);   // bỏ stream phông
  }
  return out;
}
const wideRects = (txt) =>
  [...txt.matchAll(/([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) re/g)]
    .map((x) => ({ x: +x[1], y: +x[2], w: +x[3], h: +x[4] }))
    .filter((r) => r.w > 500);
const PAGE_BOTTOM = 841.89 - 40;   // A4 cao 841,89pt, lề 40 (renderQuotePdf)

describe("PDF — hàng quá cao: cắt thì phải NHÌN THẤY được, không im lặng", () => {
  const LONG = (CHUNK.repeat(30)).slice(0, 2000);
  const quote = () => quoteOf([{ kind: "item", name: LONG, detail: LONG, unit: "cai", quantity: 1, unitPrice: 1000 }]);

  it("mọi khung hàng nằm TRỌN trong lề trang", async () => {
    const buf = await renderQuotePdf(quote());
    for (const txt of pageStreams(buf)) {
      for (const r of wideRects(txt)) expect(r.y + r.h).toBeLessThanOrEqual(PAGE_BOTTOM + 0.01);
    }
  });

  it("hàng bị cắt phải có DẤU HIỆU nhìn thấy được: viền đỏ", async () => {
    const buf = await renderQuotePdf(quote());
    const all = pageStreams(buf).join("\n");
    // pdfkit ghi màu viền dạng "r g b SCN" (hoặc "… RG"). Đỏ = thành phần đỏ cao, xanh lá/lam thấp.
    const reds = [...all.matchAll(/([\d.]+) ([\d.]+) ([\d.]+) (?:SCN|RG)\b/g)]
      .filter((m) => +m[1] > 0.5 && +m[2] < 0.3 && +m[3] < 0.3);
    expect(reds.length).toBeGreaterThan(0);   // ĐỎ khi chưa vá: chỉ có viền xám #bbb
  });

  it("KHÔNG sinh trang chỉ có mỗi hàng tiêu đề bảng", async () => {
    const buf = await renderQuotePdf(quote());
    for (const txt of pageStreams(buf)) {
      const rects = wideRects(txt);
      if (!rects.some((r) => r.h === 18)) continue;          // trang không có bảng
      expect(rects.some((r) => r.h !== 18)).toBe(true);      // ĐỎ khi chưa vá: trang chỉ có tiêu đề
    }
  });
});

describe("PDF — tiêu đề bảng của sheet KHÔNG TÊN không được vẽ ra ngoài lề dưới", () => {
  it("quét 26..40 hạng mục ở sheet đầu: mọi khung tiêu đề đều trong lề", async () => {
    for (let n = 26; n <= 40; n++) {
      const first = Array.from({ length: n }, (_, i) => ({ kind: "item", name: "Ghe " + (i + 1), unit: "cai", quantity: 1, unitPrice: 1000 }));
      const buf = await renderQuotePdf({
        ...quoteOf(first),
        // Sheet thứ hai KHÔNG có tên → renderQuotePdf bỏ qua lệnh text, pdfkit không tự sang trang.
        sheets: [
          { name: "S1", groupSubtotal: false, items: first },
          { name: "", groupSubtotal: false, items: [{ kind: "item", name: "Ban", unit: "cai", quantity: 1, unitPrice: 2000 }] },
        ],
      });
      for (const txt of pageStreams(buf)) {
        for (const r of wideRects(txt).filter((x) => x.h === 18)) {
          expect(r.y + r.h, `n=${n} tiêu đề tại y=${r.y}`).toBeLessThanOrEqual(PAGE_BOTTOM + 0.01);
        }
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GHIM LỜI KHAI VỀ BỐ CỤC. Bình luận cũ trong src/pdf.ts nói bản vá "không dàn lại trang cho
// hàng nghìn báo giá đang chạy". Đo thật với phông PRODUCTION (Dockerfile chép DejaVuSerif.ttf
// vào fonts/Times.ttf) thì lời khai đó SAI: cột "Hạng mục" rộng 196pt ở cỡ 10 chứa được ~35 ký
// tự MỘT dòng, tên hạng mục dài hơn thế (chuyện thường ngày với tên tiếng Việt) đi từ 1 dòng
// (20pt) lên 2 dòng (32pt) → báo giá 2000 dòng đi từ 53 lên 85 trang (+60%).
//
// Test này ghim con số đó để bình luận trong mã không trôi khỏi thực tế lần nữa. CHỈ chạy khi
// máy có phông DejaVu Serif thật — trên máy CI trống fonts/ thì pdf.ts rơi về Times dựng sẵn
// (ASCII, hẹp hơn), bố cục KHÁC production nên phép đo vô nghĩa.
const DEJAVU = "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf";
const DEJAVU2 = "/usr/share/fonts/dejavu/DejaVuSerif.ttf";   // đường dẫn trong image (Dockerfile)
const dejavu = [DEJAVU, DEJAVU2].find((p) => fs.existsSync(p));
// Cùng lý do với tests/pii-rotate-safety.test.js: dưới REQUIRE_DB_TESTS=1 thì thiếu điều kiện phải
// là ĐỎ, không phải bỏ qua âm thầm. Thiếu phông DejaVu là 9 bài dưới đây lặng lẽ biến mất, mà đó
// đúng là nhóm ghim con số bố cục PDF (+60% số trang) — thứ dễ trôi nhất khi ai đó "tối ưu" pdf.ts.
// Phông có sẵn ở gói `fonts-dejavu-core` (Debian/Ubuntu) hoặc `font-dejavu` (Alpine, đúng gói mà
// Dockerfile cài).
if (!dejavu && process.env.REQUIRE_DB_TESTS === "1") {
  throw new Error(
    `REQUIRE_DB_TESTS=1 nhưng không tìm thấy DejaVuSerif.ttf (đã tìm: ${DEJAVU}, ${DEJAVU2}). ` +
    "9 bài ghim bố cục PDF sẽ bị bỏ qua âm thầm. Cài: apt-get install fonts-dejavu-core");
}

describe.skipIf(!dejavu)("PDF — bản vá CÓ dàn lại trang (ghim con số đã đo)", () => {
  /** Chiều cao hàng theo ĐÚNG hai công thức: cũ đếm "\n", mới đo bằng heightOfString. */
  function rowHeights(name) {
    const d = new PDFDocument({ size: "A4", margin: 40 });
    d.font(dejavu).fontSize(10);
    const h = d.heightOfString(name, { width: 200 - 4 });
    const out = { old: 8 + name.split("\n").length * 12, neu: 8 + Math.max(1, Math.ceil(h / 12)) * 12 };
    d.end();
    return out;
  }
  const nameOfLen = (n) => (CHUNK.repeat(30)).slice(0, n);

  it("tên ≤ ~35 ký tự: chiều cao KHÔNG đổi (20pt) — báo giá tên ngắn giữ nguyên bố cục", () => {
    const r = rowHeights(nameOfLen(30));
    expect(r.old).toBe(20);
    expect(r.neu).toBe(20);
  });

  it("tên 40–60 ký tự: 20pt → 32pt, tức +60% số trang cho báo giá dài", () => {
    for (const len of [40, 50, 60]) {
      const r = rowHeights(nameOfLen(len));
      expect(r.old, `len=${len}`).toBe(20);
      expect(r.neu, `len=${len}`).toBe(32);
    }
    // 2000 dòng, phần dùng được của một trang A4 lề 40 = 761,89pt.
    const usable = 841.89 - 40 - 40;
    expect(Math.ceil((2000 * 20) / usable)).toBe(53);
    expect(Math.ceil((2000 * 32) / usable)).toBe(85);
  });
});
