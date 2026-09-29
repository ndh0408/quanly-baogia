// LOGO CỦA TỆP MẪU KHÔNG ĐƯỢC MÉO KHI BẢNG ĐỔI BỀ RỘNG CỘT — `chupAnhMau` / `datLaiAnhMau` (src/excel.ts).
//
// ── LỖI ─────────────────────────────────────────────────────────────────────
// Neo DrawingML của ảnh là (cột, lệch EMU trong cột, hàng, lệch trong hàng) cho hai góc. Logo COLORFUL
// của mẫu Colorfull neo B+596900 EMU (62,7px) → D+209550 EMU (22px). `columnWidths` đổi các cột NẰM
// DƯỚI logo mà để nguyên neo, nên logo co giãn theo cột:
//   · tệp mẫu (B 12,36 · C 21,18): logo 194,33 × 81,33px, tỉ lệ 2,39 (ảnh gốc 471×186 = 2,53);
//   · từ khi Hạng Mục nới 21,18 → 34: 284,33px, tỉ lệ 3,50 — giãn ngang 46%;
//   · thêm B 12,36 → 7 (STT hẹp như GN): mép cột D lùi 38px, B còn 49px — HẸP HƠN chính độ lệch 62,7px,
//     trạng thái Excel không bao giờ ghi. Excel COM mở tệp xuất của bản đó (2026-09-29): Excel KẸP độ
//     lệch về mép cột B, logo vẽ ở 75,67 → 336px — 260,33 × 81,33px, tỉ lệ 3,20.
// Bản vá chụp hình học tuyệt đối của ảnh mẫu theo kích thước GỐC rồi tính lại neo theo kích thước MỚI:
// kích thước giữ nguyên, vị trí đi theo ô chứa góc trên-trái (hay đứng yên nếu `editAs="absolute"`).
//
// ── VÒNG 2: CHÍNH TỆP MẪU CŨNG BÓP LOGO ─────────────────────────────────────
// "Đúng hình tệp mẫu" vẫn méo: tệp mẫu vẽ 194,33 × 81,33px (2,389) mà PNG nhúng là 471×186 (2,532,
// pHYs hai chiều bằng nhau) — hẹp ngang 5,6%. Chủ repo: "bản B bị méo thì fix đi". Mẫu Colorfull nay
// bật `anhMau.giuTiLeAnhGoc` (src/templateConfigs.ts): GÓC TRÊN-TRÁI và CHIỀU CAO như tệp mẫu, bề ngang =
// cao × tỉ lệ pixel của tệp PNG thật. Bài đọc kích thước PNG từ chính gói tệp mẫu, không ghi cứng số.
// Mép phải dời 284 → 295,6px; bài khoá luôn việc logo KHÔNG đè ô có chữ / ô gộp nào ở hàng 1–4.
// Ba mẫu GN không bật cờ: neo y như tệp mẫu (và y như ed1b5b9).
//
// Bài này đọc THẲNG XML của tệp xuất (drawing + <cols>/<row>) — không qua getter phân số của ExcelJS
// (getter đó KẸP độ lệch về mép cột, đọc qua nó thì một neo tràn trông như không tràn) — và quy ra px
// theo đúng cách Excel đo ở 96dpi: cột px = trunc(((256·w + trunc(128/7)) / 256) · 7), cột không khai
// 64px, cột/hàng ẩn 0; hàng pt × 12700 EMU. Đã đối chiếu với Excel COM (Shapes.Left/Width) trên tệp
// xuất: khớp tới 0,01px.
//
// ĐỎ TRÊN MÃ CŨ:
//   · tắt `datLaiAnhMau(ws, anhMau)` ở cuối `fillSheetData` (neo logo y như bản 582ce85 — `chupAnhMau`
//     chỉ đọc): cả SÁU ca Colorfull đỏ (đo lại 2026-09-29, trên 6c06121). Câu đỏ đầu tiên là TỈ LỆ —
//     "logo vẽ 246.33 × 81.33px, tỉ lệ 3.029; ảnh gốc 471×186 = 2.532" (theo XML: x 89,67 → 336 thay vì
//     → 295,6); nới riêng câu tỉ lệ thì `kiemNeoTrongO` vẫn làm đỏ cả sáu ca: "góc trên-trái: lệch
//     62.67px trong cột 2 chỉ rộng 49px";
//   · trên 4c4bd07 (logo đúng hình tệp mẫu, chưa theo ảnh gốc): sáu ca Colorfull đỏ ở tỉ lệ — 2,389 so
//     với 2,532, lệch 5,6% — và hai ca đơn vị `giuTiLeAnhGoc` đỏ (cờ bị bỏ qua).
// Ca GN xanh ở mọi phía: GN không có gì phải sửa, và nó đỏ nếu ai đó "sửa" bằng cách ghim vị trí TUYỆT
// ĐỐI cho mọi ảnh (logo GN sẽ rời khối "From:" 77px vì C/D của GN đổi).
//
// ── VÒNG 3: `anhMau: null` VÀ HAI NHÁNH DỰ PHÒNG CỦA `tiLeAnhGoc` ─────────────
// · Mẫu kế thừa Colorfull muốn TẮT cờ bằng `{ ...clofull_decor, anhMau: null }`. Tham số mặc định
//   `tuyChon = {}` của `chupAnhMau` chỉ thay `undefined`, nên mã cũ đọc `null.giuTiLeAnhGoc` → TypeError
//   ngay ở ảnh mẫu đầu tiên, CẢ lần xuất hỏng (500). Nay `null` = không khai.
// · ĐỌC KHÔNG RA kích thước ảnh ⇒ giữ hình tệp mẫu như không bật cờ. Thử năm kiểu: PNG cụt, JPEG mang
//   đuôi .png, PNG khai cao 0, JPEG cụt trước khối SOF, đuôi .emf. Ca "JPEG mang đuôi .png" lộ một lỗi thật:
//   `imgDims` không soát chữ ký tệp, đọc 8 byte của khối JFIF ra 65536 × 4292542531px ⇒ logo bị ép còn
//   0,0012px bề ngang. Nay `imgDims` chỉ đọc khi byte đúng là định dạng mà đuôi khai.
// · Ảnh JPEG mang đuôi .jpeg / .jpg / .JPG, lưu thành tệp mẫu rồi NẠP LẠI (ExcelJS lấy đuôi từ tên tệp trong
//   xl/media/ — đúng đường `buildQuoteBuffer` đi): bề ngang theo khối SOF của ảnh chính, không theo ảnh thu
//   nhỏ 160×120 nằm trong khối Exif đứng trước nó.
// ĐỎ TRÊN MÃ CŨ (a410028, đo 2026-09-29): "tuyChon = null" và ca xuất thật `anhMau: null` (TypeError), ca
// "JPEG mang đuôi .png" (bề ngang 0,0012px). Đột biến trên mã đã sửa (mỗi lần một chỗ, chạy tệp này):
//   · `tiLeAnhGoc` trả `d ? d.w / d.h : 1` (đọc không ra coi như vuông) → cả năm ca "đọc KHÔNG ra" đỏ;
//   · bỏ phép đổi jpg → jpeg → ca .jpg và .JPG đỏ; bỏ `.toLowerCase()` → ca .JPG đỏ;
//   · `imgDims` bỏ soát chữ ký PNG → ca "JPEG mang đuôi .png" đỏ;
//   · `imgDims` quét JPEG từng byte thay vì nhảy qua từng khối → ba ca JPEG đỏ (vớ SOF của ảnh thu nhỏ, 4:3);
//     đảo cao / rộng khi đọc SOF → ba ca JPEG đỏ (1:3);
//   · `tiLeAnhGoc` bỏ điều kiện cao > 0 → ca "PNG khai cao 0" đỏ: tỉ lệ vô cực, neo ra `col 16383, colOff
//     Infinity` — tệp Excel coi là hỏng.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import JSZip from "jszip";
import ExcelJS from "exceljs";
import { buildQuoteBuffer, chupAnhMau, datLaiAnhMau } from "../src/excel.js";
import { getConfig, TEMPLATE_CONFIGS } from "../src/templateConfigs.js";

const EMU_PX = 9525, EMU_PT = 12700;
/** Bề rộng px Excel vẽ cho bề rộng LƯU `w` (96dpi, chữ số rộng nhất 7px — font Normal Calibri 11). */
const pxCot = (w) => Math.trunc(((256 * w + Math.trunc(128 / 7)) / 256) * 7);

const thuocTinh = (s) => Object.fromEntries([...s.matchAll(/([\w:]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));

/** Số thứ tự cột (1-based) của chữ cột: "A" → 1, "K" → 11, "AA" → 27. */
const soCot = (chu) => [...chu].reduce((s, ch) => s * 26 + ch.charCodeAt(0) - 64, 0);

/**
 * Hình học mọi ảnh của sheet ĐẦU TIÊN có drawing, đọc thẳng từ XML. Trả về các ảnh:
 * { kieu, editAs, from, to, x1, y1, x2, y2 } (px) kèm `anhGoc` = { w, h } pixel của tệp PNG mà ảnh trỏ
 * tới (đọc IHDR trong chính gói), cùng hàm `rongCot(c1)` / `caoHang(r1)` (px, 1-based) và
 * `oCoChu(hangToiDa)` — khung px của mọi ô CÓ giá trị ở hàng 1…hangToiDa (ô thuộc vùng gộp → cả vùng).
 */
async function hinhHoc(buf) {
  const zip = await JSZip.loadAsync(buf);
  const ten = Object.keys(zip.files).sort();
  for (const sheet of ten.filter((t) => /^xl\/worksheets\/[^/]+\.xml$/.test(t))) {
    const relTen = sheet.replace("worksheets/", "worksheets/_rels/") + ".rels";
    const rels = zip.file(relTen) ? await zip.file(relTen).async("string") : "";
    const rel = [...rels.matchAll(/<Relationship ([^>]*)\/>/g)].map((m) => thuocTinh(m[1])).find((a) => /\/drawing$/.test(a.Type));
    if (!rel) continue;
    const xml = await zip.file(sheet).async("string");
    const tenDrawing = path.posix.basename(rel.Target);
    const d = await zip.file(`xl/drawings/${tenDrawing}`).async("string");
    const relD = zip.file(`xl/drawings/_rels/${tenDrawing}.rels`) ? await zip.file(`xl/drawings/_rels/${tenDrawing}.rels`).async("string") : "";
    const tepCuaRel = Object.fromEntries([...relD.matchAll(/<Relationship ([^>]*)\/>/g)].map((m) => thuocTinh(m[1])).map((a) => [a.Id, a.Target]));

    const fmt = /<sheetFormatPr ([^>]*)\/>/.exec(xml);
    const hangMacDinh = Number(fmt && thuocTinh(fmt[1]).defaultRowHeight) || 15;
    const cot = new Map();
    for (const m of xml.matchAll(/<col ([^>]*)\/>/g)) {
      const a = thuocTinh(m[1]);
      for (let c = +a.min; c <= Math.min(+a.max, 200); c++) cot.set(c, a.hidden === "1" ? 0 : a.width != null ? pxCot(+a.width) : 64);
    }
    const hang = new Map();
    for (const m of xml.matchAll(/<row ([^>]*?)\/?>/g)) {
      const a = thuocTinh(m[1]);
      hang.set(+a.r, a.hidden === "1" ? 0 : (a.ht != null ? +a.ht : hangMacDinh) * EMU_PT / EMU_PX);
    }
    const rongCot = (c1) => (cot.has(c1) ? cot.get(c1) : 64);
    const caoHang = (r1) => (hang.has(r1) ? hang.get(r1) : hangMacDinh * EMU_PT / EMU_PX);
    const X = (p) => { let s = 0; for (let c = 1; c <= p.col; c++) s += rongCot(c); return s + p.colOff / EMU_PX; };
    const Y = (p) => { let s = 0; for (let r = 1; r <= p.row; r++) s += caoHang(r); return s + p.rowOff / EMU_PX; };
    const diem = (khoi, the) => {
      const m = new RegExp(`<xdr:${the}><xdr:col>(\\d+)</xdr:col><xdr:colOff>(-?\\d+)</xdr:colOff><xdr:row>(\\d+)</xdr:row><xdr:rowOff>(-?\\d+)</xdr:rowOff></xdr:${the}>`).exec(khoi);
      return m && { col: +m[1], colOff: +m[2], row: +m[3], rowOff: +m[4] };
    };
    const anh = [];
    for (const m of d.matchAll(/<xdr:(twoCellAnchor|oneCellAnchor)([^>]*)>([\s\S]*?)<\/xdr:\1>/g)) {
      const from = diem(m[3], "from"), to = diem(m[3], "to");
      const ext = /<xdr:ext cx="(\d+)" cy="(\d+)"/.exec(m[3]);
      // Neo không đọc được (vd. colOff "Infinity" khi tỉ lệ ảnh ra vô cực): báo thẳng XML, đừng để TypeError.
      if (!from || (m[1] === "twoCellAnchor" ? !to : !ext)) throw new Error(`neo ảnh (${m[1]}) hỏng, XML: ${m[3].slice(0, 400)}`);
      const g = { kieu: m[1], editAs: thuocTinh(m[2]).editAs, from, to, x1: X(from), y1: Y(from) };
      if (to) Object.assign(g, { x2: X(to), y2: Y(to) });
      else Object.assign(g, { x2: g.x1 + ext[1] / EMU_PX, y2: g.y1 + ext[2] / EMU_PX });
      // Tệp ảnh thật: r:embed → rels của drawing → xl/media/…; PNG thì IHDR nằm ở byte 12–23.
      const embed = /r:embed="([^"]+)"/.exec(m[3])?.[1];
      const tepAnh = embed && tepCuaRel[embed] ? path.posix.normalize(path.posix.join("xl/drawings", tepCuaRel[embed])) : null;
      const b = tepAnh && zip.file(tepAnh) ? await zip.file(tepAnh).async("nodebuffer") : null;
      g.anhGoc = b && b.length > 24 && b.toString("latin1", 12, 16) === "IHDR" ? { w: b.readUInt32BE(16), h: b.readUInt32BE(20) } : null;
      anh.push(g);
    }
    const mepTrai = (c1) => { let s = 0; for (let c = 1; c < c1; c++) s += rongCot(c); return s; };
    const mepTren = (r1) => { let s = 0; for (let r = 1; r < r1; r++) s += caoHang(r); return s; };
    const gop = [...xml.matchAll(/<mergeCell ref="([A-Z]+)(\d+):([A-Z]+)(\d+)"\/>/g)]
      .map((m) => ({ c1: soCot(m[1]), r1: +m[2], c2: soCot(m[3]), r2: +m[4], ten: `${m[1]}${m[2]}:${m[3]}${m[4]}` }));
    const oCoChu = (hangToiDa) => {
      const ds = [];
      for (const m of xml.matchAll(/<c r="([A-Z]+)(\d+)"[^>]*?(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const [c, r] = [soCot(m[1]), +m[2]];
        if (r > hangToiDa || !/<(v|is)>/.test(m[3] || "")) continue;
        const v = gop.find((g) => c >= g.c1 && c <= g.c2 && r >= g.r1 && r <= g.r2) || { c1: c, r1: r, c2: c, r2: r, ten: `${m[1]}${m[2]}` };
        ds.push({ ten: v.ten, x1: mepTrai(v.c1), x2: mepTrai(v.c2 + 1), y1: mepTren(v.r1), y2: mepTren(v.r2 + 1) });
      }
      return ds;
    };
    return { anh, rongCot, caoHang, oCoChu };
  }
  return { anh: [], rongCot: () => 64, caoHang: () => 20, oCoChu: () => [] };
}

const tepMau = (code) => fs.readFileSync(path.join(process.cwd(), getConfig(code).filePath));

/** Neo phải nằm TRONG ô của nó: cột/hàng có bề rộng > 0 và độ lệch nhỏ hơn bề rộng đó. */
function kiemNeoTrongO(hh, p, nhan) {
  const rong = hh.rongCot(p.col + 1), cao = hh.caoHang(p.row + 1);
  expect(rong, `${nhan}: neo rơi vào cột ẩn (${p.col + 1})`).toBeGreaterThan(0);
  expect(p.colOff / EMU_PX, `${nhan}: lệch ${(p.colOff / EMU_PX).toFixed(2)}px trong cột ${p.col + 1} chỉ rộng ${rong}px`).toBeLessThanOrEqual(rong);
  expect(cao, `${nhan}: neo rơi vào hàng ẩn (${p.row + 1})`).toBeGreaterThan(0);
  expect(p.rowOff / EMU_PX, `${nhan}: lệch ${(p.rowOff / EMU_PX).toFixed(2)}px trong hàng ${p.row + 1} chỉ cao ${cao}px`).toBeLessThanOrEqual(cao);
}

function baoGia(code, { day = false } = {}) {
  return {
    quoteNumber: "CLF26LOGO", projectCode: "FP_A26_009", projectVersion: 1, title: "Logo giữ hình",
    toCompany: "CTY CP PHIM THIÊN NGÂN", toContact: "Ms. Ninh", vatPercent: 8, showTotals: false,
    city: "TP. Hồ Chí Minh", quoteDate: new Date("2026-09-29"),
    // "Đủ thứ": khối Kính gửi đủ 5 dòng + dòng mã (hàng 3 cao lên), có dải thông tin chương trình
    // (hàng 5 hiện), có cột HÌNH ẢNH (thêm một cột rộng 19 sau Ghi Chú) — mọi đường đổi kích thước;
    // và khối người gửi (Colorfull: F1, cùng hàng với logo) có chữ, để phép soi "không đè" có đối tượng.
    ...(day ? {
      toPhone: "0909 123 456", toAddress: "123 Nguyễn Văn Linh, Q.7", toEmail: "ninh@thienngan.vn",
      company: { name: "Công ty TNHH Colorfull" }, fromContact: "Lan Anh", fromTitle: "Account", fromPhone: "0914 291 951",
      fromAddress: "12 Lê Lợi, Q.1, TP. Hồ Chí Minh",
    } : {}),
    sheets: [{
      order: 1, name: "Booth", groupSubtotal: false, discount: 0, extraTables: [], showImages: day, template: { code },
      items: [
        ...(day ? [{ order: 0, kind: "info", name: "Premiere phim Thỏ Ơi 20/9" }] : []),
        { order: 1, kind: "section", name: "Booth", quantity: 1 },
        { order: 2, kind: "item", name: "Vách giữa: 2m5W x 2m6H", detail: ". KS", unit: "m2", quantity: 12.7, days: 1, unitPrice: 504_000 },
      ],
    }],
  };
}

describe("logo COLORFUL: CHỖ và CHIỀU CAO như tệp mẫu, bề ngang theo TỈ LỆ ẢNH GỐC — dù bảng đổi bề rộng cột", () => {
  for (const code of ["clofull_decor", "clofull_banner", "clofull_conngay"]) {
    for (const day of [false, true]) {
      it(`${code}${day ? " · đủ thứ (hàng 3 cao lên, dải thông tin, cột ảnh, khối người gửi)" : ""}: góc trên-trái + chiều cao như tệp mẫu, tỉ lệ = ảnh PNG gốc (≤ 0,5%), neo trong ô, không đè chữ hàng 1–4`, async () => {
        const goc = await hinhHoc(tepMau(code));
        const ra = await hinhHoc(await buildQuoteBuffer(baoGia(code, { day })));
        expect(goc.anh, `${code}: tệp mẫu phải có đúng một logo thì phép so mới có nghĩa`).toHaveLength(1);
        expect(ra.anh, `${code}: mất logo / thừa ảnh`).toHaveLength(1);
        // Bài chỉ có nghĩa khi cột DƯỚI logo thật sự đổi bề rộng so với tệp mẫu.
        expect([2, 3].some((c) => ra.rongCot(c) !== goc.rongCot(c)), `${code}: cột dưới logo không đổi — bài không soi gì`).toBe(true);
        const [g, r] = [goc.anh[0], ra.anh[0]];
        expect(r.editAs, `${code}: đổi kiểu neo của tệp mẫu`).toBe(g.editAs);
        // CHỖ + CHIỀU CAO: góc trên-trái và mép dưới như tệp mẫu.
        for (const k of ["x1", "y1", "y2"]) {
          expect(Math.abs(r[k] - g[k]), `${code}: ${k} = ${r[k].toFixed(2)}px, tệp mẫu ${g[k].toFixed(2)}px`).toBeLessThanOrEqual(1);
        }
        expect(Math.abs((r.y2 - r.y1) - (g.y2 - g.y1)), `${code}: cao ${(r.y2 - r.y1).toFixed(2)}px, tệp mẫu ${(g.y2 - g.y1).toFixed(2)}px`).toBeLessThanOrEqual(0.1);
        // TỈ LỆ: theo pixel của chính tệp PNG trong gói tệp mẫu — không phải hình tệp mẫu vẽ (2,389, bóp 5,6%).
        expect(g.anhGoc, `${code}: không đọc được kích thước PNG của logo trong tệp mẫu`).toBeTruthy();
        expect(r.anhGoc, `${code}: tệp xuất nhúng ảnh khác tệp mẫu`).toEqual(g.anhGoc);
        const tiLeGoc = g.anhGoc.w / g.anhGoc.h, tiLe = (r.x2 - r.x1) / (r.y2 - r.y1);
        expect(Math.abs(tiLe / tiLeGoc - 1),
          `${code}: logo vẽ ${(r.x2 - r.x1).toFixed(2)} × ${(r.y2 - r.y1).toFixed(2)}px, tỉ lệ ${tiLe.toFixed(3)}; ảnh gốc ${g.anhGoc.w}×${g.anhGoc.h} = ${tiLeGoc.toFixed(3)}`,
        ).toBeLessThanOrEqual(0.005);
        kiemNeoTrongO(ra, r.from, `${code} góc trên-trái`);
        kiemNeoTrongO(ra, r.to, `${code} góc dưới-phải`);
        // KHÔNG ĐÈ: logo rộng ra bên phải nên soi mọi ô có chữ / vùng gộp ở hàng 1–4 (khối người gửi F1,
        // tiêu đề B2, khối Kính gửi C3, tiêu đề cột hàng 4). A1 là dấu mẫu ẩn (numFmt ";;;").
        const oChu = ra.oCoChu(4);
        expect(oChu.length, `${code}: không đọc được ô nào ở hàng 1–4 — phép soi đè vô nghĩa`).toBeGreaterThan(3);
        if (day) expect(oChu.some((o) => /^F1(:|$)/.test(o.ten)), `${code}: khối người gửi (F1) phải có chữ`).toBe(true);
        const de = oChu.filter((o) => o.x1 < r.x2 && r.x1 < o.x2 && o.y1 < r.y2 && r.y1 < o.y2);
        expect(de.map((o) => `${o.ten} (x ${o.x1}→${o.x2}, y ${o.y1.toFixed(1)}→${o.y2.toFixed(1)})`),
          `${code}: logo x ${r.x1.toFixed(2)}→${r.x2.toFixed(2)}, y ${r.y1.toFixed(2)}→${r.y2.toFixed(2)} đè lên ô có chữ`).toEqual([]);
      });
    }
  }
});

describe("logo GIA NGUYỄN: neo KHÔNG đổi — nó đi theo khối \"From:\" như mọi tệp GN đã gửi", () => {
  for (const code of ["marico_decor", "gn_banner", "unibenfood"]) {
    it(code, async () => {
      const goc = await hinhHoc(tepMau(code));
      const ra = await hinhHoc(await buildQuoteBuffer(baoGia(code, { day: true })));
      expect(goc.anh).toHaveLength(1);
      expect(ra.anh.filter((a) => a.kieu === "twoCellAnchor"), `${code}: mất logo`).toHaveLength(1);
      const r = ra.anh.find((a) => a.kieu === "twoCellAnchor");
      expect({ editAs: r.editAs, from: r.from, to: r.to }).toEqual({ editAs: goc.anh[0].editAs, from: goc.anh[0].from, to: goc.anh[0].to });
      // Bề rộng / chiều cao của logo cũng y như tệp mẫu (F, G và hàng 2 không đổi).
      expect(Math.abs((r.x2 - r.x1) - (goc.anh[0].x2 - goc.anh[0].x1))).toBeLessThanOrEqual(1);
      expect(Math.abs((r.y2 - r.y1) - (goc.anh[0].y2 - goc.anh[0].y1))).toBeLessThanOrEqual(1);
    });
  }
});

/** PNG hợp lệ w×h (một màu) — đủ để ExcelJS nhúng và ghi ra tệp. */
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
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(Buffer.concat(Array.from({ length: h }, () => row)))), chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** JPEG baseline xám w×h HỢP LỆ: GDI+ và WIC của Windows giải mã ra đúng w×h, điểm ảnh xám 128 (thử
 *  2026-09-29). Mọi khối 8×8 chỉ có DC = 0. Mỗi bảng Huffman có một mã dài 1 bit, nên mỗi khối là 2 bit "0"
 *  (DC loại 0 + AC EOB), đệm bit 1 cho đủ byte. `thuNho: [w, h]` chèn TRƯỚC khối SOF một khối APP1 "Exif"
 *  mang nguyên một JPEG thu nhỏ có SOF RIÊNG, như ảnh chụp từ điện thoại / máy ảnh. */
function jpeg(w, h, { thuNho } = {}) {
  const khoi = (ma, du) => { const dai = Buffer.alloc(2); dai.writeUInt16BE(du.length + 2); return Buffer.concat([Buffer.from([0xff, ma]), dai, du]); };
  const u16 = (v) => [v >> 8, v & 255];
  const soBit = 2 * Math.ceil(w / 8) * Math.ceil(h / 8);
  const quet = Buffer.alloc(Math.ceil(soBit / 8));
  if (soBit % 8) quet[quet.length - 1] = (1 << (8 - (soBit % 8))) - 1;
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),                                                                   // SOI
    khoi(0xe0, Buffer.from("JFIF\0\x01\x01\0\0\x01\0\x01\0\0", "latin1")),                      // APP0
    ...(thuNho ? [khoi(0xe1, Buffer.concat([Buffer.from("Exif\0\0MM\0*\0\0\0\x08\0\0\0\0\0\0", "latin1"), jpeg(...thuNho)]))] : []),
    khoi(0xdb, Buffer.concat([Buffer.from([0]), Buffer.alloc(64, 1)])),                           // DQT
    khoi(0xc0, Buffer.from([8, ...u16(h), ...u16(w), 1, 1, 0x11, 0])),                            // SOF0: CAO trước, RỘNG sau
    khoi(0xc4, Buffer.from([0x00, 1, ...Array(15).fill(0), 0])),                                 // DHT (DC)
    khoi(0xc4, Buffer.from([0x10, 1, ...Array(15).fill(0), 0])),                                 // DHT (AC)
    khoi(0xda, Buffer.from([1, 1, 0, 0, 63, 0])), quet,                                          // SOS + dữ liệu quét
    Buffer.from([0xff, 0xd9]),                                                                   // EOI
  ]);
}

describe("chupAnhMau / datLaiAnhMau: mọi kiểu neo, cột bị ẩn, hàng đổi cao", () => {
  /** Dựng một sheet "mẫu" có một ảnh (mặc định PNG 40×20, tỉ lệ 2), chụp, đổi kích thước bằng `doi`, đặt
   *  lại, rồi đọc hình học trước / sau từ tệp. `tuyChon` đi thẳng vào `chupAnhMau` (như `cfg.anhMau` của
   *  mẫu). `anh` = { buffer, extension } thay ảnh mặc định. `napLai`: LƯU sheet mẫu ra tệp rồi NẠP LẠI, như
   *  `buildQuoteBuffer` nạp tệp mẫu. Khi ấy ảnh mang đuôi của tệp trong xl/media/ (ExcelJS lấy đuôi từ tên
   *  tệp), đúng thứ `tiLeAnhGoc` đọc lúc xuất thật. */
  async function thu(themAnh, doi, tuyChon, { anh = { buffer: png(40, 20), extension: "png" }, napLai = false } = {}) {
    let wb = new ExcelJS.Workbook();
    let ws = wb.addWorksheet("S");
    [4, 12.36328125, 21.1796875, 50, 10].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
    [30, 20, 40, 25].forEach((h, i) => { ws.getRow(i + 1).height = h; });
    const id = wb.addImage(anh);
    themAnh(ws, id);
    const tepMau = Buffer.from(await wb.xlsx.writeBuffer());
    const truoc = await hinhHoc(tepMau);
    if (napLai) { wb = new ExcelJS.Workbook(); await wb.xlsx.load(tepMau); ws = wb.getWorksheet("S"); }
    const chup = chupAnhMau(ws, tuyChon);
    doi(ws);
    datLaiAnhMau(ws, chup);
    return { truoc, sau: await hinhHoc(Buffer.from(await wb.xlsx.writeBuffer())), tepMau };
  }
  const n = (col, colOff, row, rowOff) => ({ nativeCol: col, nativeColOff: colOff, nativeRow: row, nativeRowOff: rowOff });
  const gan = (a, b, nhan) => { for (const k of ["x1", "x2", "y1", "y2"]) expect(Math.abs(a[k] - b[k]), `${nhan}: ${k} ${a[k]} ≠ ${b[k]}`).toBeLessThanOrEqual(1); };

  it("twoCell editAs=oneCell: cột dưới ảnh thu hẹp HƠN độ lệch, hàng giữa ảnh cao lên — giữ chỗ và cỡ", async () => {
    const { truoc, sau } = await thu(
      (ws, id) => ws.addImage(id, { tl: n(1, 596900, 0, 12700), br: n(3, 209550, 2, 95250), editAs: "oneCell" }),
      (ws) => { ws.getColumn(2).width = 7; ws.getColumn(3).width = 34; ws.getRow(2).height = 80; },
    );
    gan(sau.anh[0], truoc.anh[0], "oneCell");
    kiemNeoTrongO(sau, sau.anh[0].from, "tl"); kiemNeoTrongO(sau, sau.anh[0].to, "br");
  });

  it("cột chứa góc trên-trái bị ẨN (bề rộng 0) — neo dời sang cột có bề rộng, hình không đổi", async () => {
    const { truoc, sau } = await thu(
      (ws, id) => ws.addImage(id, { tl: n(1, 190500, 0, 0), br: n(3, 95250, 1, 0), editAs: "oneCell" }),
      (ws) => { const c = ws.getColumn(2); c.hidden = true; c.width = 0; ws.getColumn(1).width = 30; },
    );
    // Cột trước ảnh (A) rộng ra: ảnh oneCell đi theo ô của nó — mép trái B (ẩn hay không vẫn là mép phải
    // của A) dịch bao nhiêu thì ảnh dịch bấy nhiêu — và giữ cỡ.
    const dich = pxCot(30) - pxCot(4);
    expect(sau.anh[0].x1 - truoc.anh[0].x1, "không đi theo ô chứa nó").toBeCloseTo(dich, 5);
    expect(Math.abs((sau.anh[0].x2 - sau.anh[0].x1) - (truoc.anh[0].x2 - truoc.anh[0].x1)), "đổi bề rộng").toBeLessThanOrEqual(1);
    expect(sau.anh[0].from.col, "neo vẫn nằm ở cột ẩn").not.toBe(1);
    kiemNeoTrongO(sau, sau.anh[0].from, "tl"); kiemNeoTrongO(sau, sau.anh[0].to, "br");
  });

  it("editAs=absolute: cột BÊN TRÁI ảnh đổi bề rộng — ảnh đứng yên trên trang, cỡ không đổi", async () => {
    const { truoc, sau } = await thu(
      (ws, id) => ws.addImage(id, { tl: n(2, 95250, 1, 0), br: n(3, 190500, 2, 63500), editAs: "absolute" }),
      (ws) => { ws.getColumn(1).width = 20; ws.getColumn(2).width = 3; ws.getRow(1).height = 50; },
    );
    expect(sau.anh[0].editAs).toBe("absolute");
    gan(sau.anh[0], truoc.anh[0], "absolute");
    kiemNeoTrongO(sau, sau.anh[0].from, "tl"); kiemNeoTrongO(sau, sau.anh[0].to, "br");
  });

  it("oneCellAnchor (tl + ext): góc trên-trái đi theo ô, kích thước `ext` giữ nguyên, neo không tràn", async () => {
    const { truoc, sau } = await thu(
      (ws, id) => ws.addImage(id, { tl: n(1, 571500, 1, 0), ext: { width: 120, height: 40 } }),
      (ws) => { ws.getColumn(2).width = 5; },
    );
    expect(sau.anh[0].kieu).toBe("oneCellAnchor");
    gan(sau.anh[0], truoc.anh[0], "oneCellAnchor");
    kiemNeoTrongO(sau, sau.anh[0].from, "tl");
  });

  // ── `giuTiLeAnhGoc` (cấu hình mẫu `anhMau.giuTiLeAnhGoc`) ──────────────────────────────────────────
  it("giuTiLeAnhGoc · twoCell: ảnh mẫu vẽ MÉO (2,58) → giữ góc trên-trái + chiều cao, bề ngang = cao × 2 (PNG 40×20)", async () => {
    const { truoc, sau } = await thu(
      (ws, id) => ws.addImage(id, { tl: n(1, 596900, 0, 12700), br: n(3, 209550, 2, 95250), editAs: "oneCell" }),
      (ws) => { ws.getColumn(2).width = 7; ws.getColumn(3).width = 34; },
      { giuTiLeAnhGoc: true },
    );
    const [a, b] = [truoc.anh[0], sau.anh[0]];
    expect(a.anhGoc).toEqual({ w: 40, h: 20 });
    expect(Math.abs((a.x2 - a.x1) / (a.y2 - a.y1) / 2 - 1), "ca thử phải bắt đầu từ một ảnh vẽ MÉO").toBeGreaterThan(0.05);
    for (const k of ["x1", "y1", "y2"]) expect(Math.abs(b[k] - a[k]), `${k} ${b[k]} ≠ ${a[k]}`).toBeLessThanOrEqual(1);
    expect(Math.abs((b.x2 - b.x1) / (b.y2 - b.y1) / 2 - 1), `tỉ lệ ${((b.x2 - b.x1) / (b.y2 - b.y1)).toFixed(3)}`).toBeLessThanOrEqual(0.005);
    kiemNeoTrongO(sau, b.from, "tl"); kiemNeoTrongO(sau, b.to, "br");
  });

  it("giuTiLeAnhGoc · oneCellAnchor (tl + ext 120×40): `ext` giữ chiều cao 40, bề ngang 80 theo PNG 40×20", async () => {
    const { truoc, sau } = await thu(
      (ws, id) => ws.addImage(id, { tl: n(1, 571500, 1, 0), ext: { width: 120, height: 40 } }),
      (ws) => { ws.getColumn(2).width = 5; },
      { giuTiLeAnhGoc: true },
    );
    const [a, b] = [truoc.anh[0], sau.anh[0]];
    expect(b.kieu).toBe("oneCellAnchor");
    for (const k of ["x1", "y1", "y2"]) expect(Math.abs(b[k] - a[k]), `${k} ${b[k]} ≠ ${a[k]}`).toBeLessThanOrEqual(1);
    expect(b.x2 - b.x1).toBeCloseTo(80, 1);
    kiemNeoTrongO(sau, b.from, "tl");
  });

  // Ảnh mẫu vẽ MÉO, neo như logo Colorfull (B+62,7px → D+22px) nhưng trên lưới của `thu`: 194,33 × 75,33px,
  // tỉ lệ 2,58. Sau đó cột B thu hẹp HƠN độ lệch và cột C nới ra. Nhờ vẽ méo, mọi tỉ lệ "đoán" (1, 2, 3…) đều
  // ra hình KHÁC tệp mẫu.
  const logoMeo = (ws, id) => ws.addImage(id, { tl: n(1, 596900, 0, 12700), br: n(3, 209550, 2, 95250), editAs: "oneCell" });
  const doiCotDuoiLogo = (ws) => { ws.getColumn(2).width = 7; ws.getColumn(3).width = 34; };

  // ── `tuyChon` = null là KHÔNG KHAI ──────────────────────────────────────────
  // Bốn cách "không bật" phải ra cùng một hình: y tệp mẫu. Mã cũ ném TypeError với null.
  for (const [nhan, tuyChon] of [["null", null], ["undefined", undefined], ["{}", {}], ["{ giuTiLeAnhGoc: false }", { giuTiLeAnhGoc: false }]]) {
    it(`tuyChon = ${nhan} (mẫu không bật / tắt cờ): không ném, ảnh giữ đúng chỗ và cỡ như tệp mẫu`, async () => {
      const { truoc, sau } = await thu(logoMeo, doiCotDuoiLogo, tuyChon);
      gan(sau.anh[0], truoc.anh[0], `tuyChon = ${nhan}`);
      kiemNeoTrongO(sau, sau.anh[0].from, "tl"); kiemNeoTrongO(sau, sau.anh[0].to, "br");
    });
  }

  // ── Nhánh dự phòng 1 của `tiLeAnhGoc`: ĐỌC KHÔNG RA kích thước ảnh ⇒ giữ hình tệp mẫu như không bật cờ ──
  const KHONG_DOC_RA = [
    ["PNG cụt — đứt giữa khối IHDR (20 byte đầu)", { buffer: png(40, 20).subarray(0, 20), extension: "png" }],
    ["JPEG mang đuôi .png (khai sai đuôi)", { buffer: jpeg(60, 20), extension: "png" }],
    ["PNG khai cao 0 (IHDR 40×0)", { buffer: png(40, 0), extension: "png" }],
    ["JPEG cụt — đứt trước khối SOF", { buffer: jpeg(60, 20).subarray(0, 60), extension: "jpg" }],
    ["đuôi .emf — ảnh vector, imgDims không đọc định dạng này", { buffer: Buffer.from("EMF: ảnh vector, không có kích thước pixel", "utf8"), extension: "emf" }],
  ];
  for (const [nhan, anh] of KHONG_DOC_RA) {
    it(`giuTiLeAnhGoc · đọc KHÔNG ra kích thước ảnh — ${nhan}: giữ hình tệp mẫu, neo trong ô, vẫn ghi ra tệp`, async () => {
      const { truoc, sau } = await thu(logoMeo, doiCotDuoiLogo, { giuTiLeAnhGoc: true }, { anh, napLai: true });
      expect(sau.anh, "mất ảnh / thừa ảnh").toHaveLength(1);
      const [a, b] = [truoc.anh[0], sau.anh[0]];
      gan(b, a, `${nhan}: vẽ ${(b.x2 - b.x1).toFixed(4)} × ${(b.y2 - b.y1).toFixed(2)}px, tệp mẫu ${(a.x2 - a.x1).toFixed(2)} × ${(a.y2 - a.y1).toFixed(2)}px`);
      kiemNeoTrongO(sau, b.from, "tl"); kiemNeoTrongO(sau, b.to, "br");
    });
  }

  // ── Nhánh dự phòng 2 của `tiLeAnhGoc`: ảnh JPEG mang đuôi .jpg ────────────────
  // Excel đặt tên "image1.jpeg", nhưng tệp do công cụ khác lưu có thể mang "image1.jpg". ExcelJS cũng ghi
  // đúng đuôi được truyền vào `addImage` (bài soát tiền đề này). `imgDims` chỉ biết "jpeg", nên `tiLeAnhGoc`
  // phải hạ chữ thường rồi đổi jpg → jpeg.
  // Ảnh thử là JPEG 60×20 (tỉ lệ 3) có ảnh thu nhỏ 160×120 trong khối Exif đứng TRƯỚC khối SOF chính. Đọc
  // nhầm SOF của ảnh thu nhỏ thì ra 4:3, đảo cao/rộng thì ra 1:3.
  for (const duoi of ["jpeg", "jpg", "JPG"]) {
    it(`giuTiLeAnhGoc · ảnh JPEG đuôi .${duoi} (tệp mẫu lưu ra rồi nạp lại): bề ngang = cao × 3 theo SOF của ảnh 60×20, không theo ảnh thu nhỏ trong Exif`, async () => {
      const anh = { buffer: jpeg(60, 20, { thuNho: [160, 120] }), extension: duoi };
      const { truoc, sau, tepMau } = await thu(logoMeo, doiCotDuoiLogo, { giuTiLeAnhGoc: true }, { anh, napLai: true });
      const media = Object.keys((await JSZip.loadAsync(tepMau)).files).filter((t) => /^xl\/media\/[^/]+$/.test(t));
      expect(media, "tiền đề: ảnh trong tệp mẫu phải mang đúng đuôi này").toEqual([`xl/media/image1.${duoi}`]);
      const [a, b] = [truoc.anh[0], sau.anh[0]];
      expect(Math.abs((a.x2 - a.x1) / (a.y2 - a.y1) / 3 - 1), "ca thử phải bắt đầu từ một ảnh vẽ MÉO").toBeGreaterThan(0.05);
      for (const k of ["x1", "y1", "y2"]) expect(Math.abs(b[k] - a[k]), `${k} ${b[k]} ≠ ${a[k]}`).toBeLessThanOrEqual(1);
      const tiLe = (b.x2 - b.x1) / (b.y2 - b.y1);
      expect(Math.abs(tiLe / 3 - 1), `.${duoi}: tỉ lệ ${tiLe.toFixed(4)}; JPEG 60×20 = 3`).toBeLessThanOrEqual(0.005);
      kiemNeoTrongO(sau, b.from, "tl"); kiemNeoTrongO(sau, b.to, "br");
    });
  }
});

describe("mẫu kế thừa Colorfull TẮT cờ bằng `anhMau: null`: coi như không khai, lần xuất không hỏng", () => {
  it("{ ...clofull_decor, anhMau: null }: xuất được, logo y hệt khi bỏ hẳn `anhMau`, tức đúng chỗ và cỡ tệp mẫu", async () => {
    const { anhMau: _, ...khongKhai } = TEMPLATE_CONFIGS.clofull_decor;
    // Mã mẫu tạm, mở đầu "clofull" như mọi mẫu Colorfull. Gỡ trong `finally`.
    const tam = { clofull_thu_anhmau_null: { ...TEMPLATE_CONFIGS.clofull_decor, anhMau: null }, clofull_thu_khong_khai: khongKhai };
    Object.assign(TEMPLATE_CONFIGS, tam);
    try {
      const goc = await hinhHoc(tepMau("clofull_decor"));
      const raNull = await hinhHoc(await buildQuoteBuffer(baoGia("clofull_thu_anhmau_null")));   // mã cũ: TypeError ở đây
      const raKhongKhai = await hinhHoc(await buildQuoteBuffer(baoGia("clofull_thu_khong_khai")));
      const raBatCo = await hinhHoc(await buildQuoteBuffer(baoGia("clofull_decor")));
      expect(raNull.anh, "mất logo / thừa ảnh").toHaveLength(1);
      const [g, r, k] = [goc.anh[0], raNull.anh[0], raKhongKhai.anh[0]];
      expect({ editAs: r.editAs, from: r.from, to: r.to }, "`anhMau: null` phải ra y như không khai").toEqual({ editAs: k.editAs, from: k.from, to: k.to });
      for (const t of ["x1", "y1", "x2", "y2"]) {
        expect(Math.abs(r[t] - g[t]), `${t} = ${r[t].toFixed(2)}px, tệp mẫu ${g[t].toFixed(2)}px`).toBeLessThanOrEqual(1);
      }
      kiemNeoTrongO(raNull, r.from, "góc trên-trái"); kiemNeoTrongO(raNull, r.to, "góc dưới-phải");
      // Tiền đề: bật cờ thì mép phải KHÁC tệp mẫu (bề ngang theo ảnh gốc), nên phép so ở trên phân biệt được
      // "đã tắt cờ" với "cờ vẫn bật".
      expect(Math.abs(raBatCo.anh[0].x2 - g.x2), "clofull_decor (bật cờ) phải vẽ logo rộng hơn tệp mẫu").toBeGreaterThan(5);
    } finally {
      for (const khoa of Object.keys(tam)) delete TEMPLATE_CONFIGS[khoa];
    }
  });
});
