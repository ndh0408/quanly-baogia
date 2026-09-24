import { sheetCode, soMa } from "./quoteCode.js";
import ExcelJS from "exceljs";
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getConfig } from "./templateConfigs.js";
import { stitchXlsxBuffers } from "./xlsxStitcher.js";
import { buildFormulaContext } from "./quoteFormula.js";
import { nhanLamTronDong } from "./tienDong.js";
import { ngayThangNamVN } from "./vnTime.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

// LÀM TRÒN Số Lượng về 1 chữ số thập phân (7,378→7,4; 6,42→6,4). Khớp util.js (web) + money.js (ROUND_HALF_UP).
function qtyRound(x: any) {
  const n = Number(x) || 0;
  const t = Math.round(Math.abs(n) * 10 + 1e-6) / 10;   // +1e-6 khử nhiễu float; làm tròn 1 số
  return n < 0 ? -t : t;
}
function qtyExact(x: any) {
  const n = Number(x) || 0;
  const t = Math.round(Math.abs(n) * 10_000 + 1e-8) / 10_000;
  return n < 0 ? -t : t;
}
const qtyForAmount = (it: any) => it?.quantityExact ? qtyExact(it.quantity) : qtyRound(it?.quantity);

// Template .xlsx files never change at runtime — read each from disk ONCE and
// cache the bytes in RAM. Every export then loads from the cached Buffer instead
// of re-reading ~170-207 KB/sheet off disk (big win on the inline export path).
const _templateCache = new Map();
const TEMPLATE_MARKER_PREFIX = "__QUANLY_TEMPLATE__:";
function templateBuffer(filePath: string) {
  let buf = _templateCache.get(filePath);
  if (!buf) { buf = readFileSync(path.join(ROOT, filePath)); _templateCache.set(filePath, buf); }
  return buf;
}

function stampTemplateMarker(ws: any, templateCode: string) {
  const cell = ws.getCell("A1");
  cell.value = `${TEMPLATE_MARKER_PREFIX}${templateCode}`;
  const style = cell.style ? JSON.parse(JSON.stringify(cell.style)) : {};
  style.font = { ...(style.font || {}), color: { argb: "FFFFFFFF" }, size: 1 };
  style.numFmt = ";;;"; // không hiện trong ô/print; importer vẫn đọc được giá trị thật
  cell.style = style;
}

// Ngày THEO LỊCH VIỆT NAM, không theo múi giờ của tiến trình (XLSX-11): container chạy UTC, nên
// báo giá nhân bản/tạo lúc 00:00–06:59 giờ VN (quoteDate = new Date() → 17:00–23:59Z hôm trước) in
// lùi một ngày. Ngày nhập từ web ('YYYY-MM-DD' → 00:00Z) cho CÙNG kết quả như trước.
export function vnDateText(d: any, city: any) {
  const { ngay, thang, nam } = ngayThangNamVN(d);
  return `${city || "TP. Hồ Chí Minh"}, ngày ${String(ngay).padStart(2, "0")} tháng ${String(thang).padStart(2, "0")} năm ${nam}`;
}

// Neutralize spreadsheet formula injection: a text cell whose value starts with
// = + - @ (or a leading tab/CR) is interpreted as a formula by Excel/Sheets when
// the exported file is opened. Prefix a zero-width-safe apostrophe so the value
// is shown literally. Only applied to plain strings (numbers/dates untouched).
// `\t`/`\r` ở NGAY đầu vẫn tính (Excel bỏ qua chúng khi phân giải ô), còn `= + - @` thì tính kể
// cả khi có khoảng trắng đứng trước: tên hạng mục KHÔNG đi qua `clean()` (xem chỗ ghi cột name),
// nên `" =SUM(...)"` giữ nguyên dấu cách tới lúc ghi ô. Đa số nơi nhận (Google Sheets, trình đọc
// CSV) cắt khoảng trắng đầu TRƯỚC khi quyết định "có phải công thức không", nên neo cứng vào ký
// tự đầu tiên là bỏ lọt. `\s` của JS CÓ bao gồm U+00A0 (no-break space) — ký tự hay dính theo khi
// dán từ Word — nên không cần liệt kê riêng.
//
// GIÁ PHẢI TRẢ, đã biết và CỐ Ý giữ: exceljs 4.4.0 KHÔNG hỗ trợ `quotePrefix` (thuộc tính kiểu ô
// mà Excel dùng để nhớ "đây là chữ" mà không hiện ký tự nào) — `grep -rn "quotePrefix"
// node_modules/exceljs/lib/` trả 0 kết quả. Nên cách duy nhất còn lại là chèn thật một dấu `'`
// vào chuỗi, và khách MỞ FILE RA SẼ THẤY nó với tên hạng mục kiểu "-Ghế Tiffany". Muốn bỏ dấu
// nháy cho nhánh `- +` (vốn gần như không bao giờ là công thức thật) thì phải sửa cả
// tests/xp3-excel-cells.test.js — bài đó đang chốt "không ô chữ nào bắt đầu bằng = + - @".
const DAU_CONG_THUC = /^[\t\r]|^\s*[=+\-@]/;
function neutralizeFormula(value: any) {
  if (typeof value !== "string" || value.length === 0) return value;
  return DAU_CONG_THUC.test(value) ? `'${value}` : value;
}

function setCell(ws: any, ref: any, value: any) {
  if (!ref) return;
  ws.getCell(ref).value = neutralizeFormula(value);
}

function safeMerge(ws: any, range: any) {
  try { ws.mergeCells(range); } catch {}
}

function safeUnmerge(ws: any, range: any) {
  try { ws.unMergeCells(range); } catch {}
}

function unmergeOverlapping(ws: any, c1: number, r1: number, c2: number, r2: number) {
  const merges = Object.entries(ws._merges || {});
  for (const [key, raw] of merges) {
    const m = raw as any;
    const top = m?.top ?? m?.model?.top, left = m?.left ?? m?.model?.left;
    const bottom = m?.bottom ?? m?.model?.bottom, right = m?.right ?? m?.model?.right;
    if (![top, left, bottom, right].every(Number.isFinite)) continue;
    if (right < c1 || left > c2 || bottom < r1 || top > r2) continue;
    try { ws.unMergeCells(key); } catch {
      try { ws.unMergeCells(`${colLetter(left)}${top}:${colLetter(right)}${bottom}`); } catch {}
    }
  }
}

/** Gộp vùng Hạng Mục qua cột Chi Tiết đã bỏ, giữ viền ngoài của bảng. */
function mergeNameArea(ws: any, nameCol: string, detailCol: string, r1: number, r2 = r1) {
  const c1 = colLetterToIdx(nameCol) + 1, c2 = colLetterToIdx(detailCol) + 1;
  if (c2 !== c1 + 1) throw new Error(`Cột Hạng Mục (${nameCol}) và vùng bỏ Chi Tiết (${detailCol}) phải nằm cạnh nhau`);
  const tl = ws.getCell(r1, c1), tr = ws.getCell(r1, c2);
  const bl = ws.getCell(r2, c1), br = ws.getCell(r2, c2);
  const style = tl.style ? JSON.parse(JSON.stringify(tl.style)) : {};
  const border = {
    ...(style.border || {}),
    top: tl.border?.top || tr.border?.top,
    left: tl.border?.left || bl.border?.left,
    right: tr.border?.right || br.border?.right,
    bottom: bl.border?.bottom || br.border?.bottom,
  };
  const range = `${nameCol}${r1}:${detailCol}${r2}`;
  unmergeOverlapping(ws, c1, r1, c2, r2);
  try { ws.mergeCells(range); } catch (e) {
    throw new Error(`Không thể xóa cột Chi Tiết bằng cách gộp vùng ${range}: ${e instanceof Error ? e.message : "lỗi không rõ"}`, { cause: e });
  }
  const master = ws.getCell(r1, c1);
  master.style = { ...style, border };
  ensureWrap(master);
}

/** Ensure a cell has wrapText alignment so multi-line content displays correctly */
function ensureWrap(cell: any) {
  const align = cell.alignment ? { ...cell.alignment } : {};
  align.wrapText = true;
  if (!align.vertical) align.vertical = "middle";
  cell.alignment = align;
}

/**
 * Set a cell's fill and/or font color WITHOUT leaking the change to sibling cells.
 * ExcelJS shares one style object across every cell that has identical styling
 * (very common in template-loaded sheets where whole item ranges are styled the
 * same). Mutating a property via `cell.fill = …` / `cell.font = …` mutates that
 * SHARED object, so the colour bleeds onto neighbouring cells (e.g. a green group
 * row tinting the plain item rows around it). Cloning the cell's style into a fresh
 * per-cell object first isolates the change to this one cell.
 */
function paintCell(cell: any, { fill, fontColor, bold }: { fill?: any; fontColor?: any; bold?: any } = {}) {
  const style = cell.style ? JSON.parse(JSON.stringify(cell.style)) : {};
  if (fill === "none") style.fill = { type: "pattern", pattern: "none" };   // xoá nền (để ô trắng)
  else if (fill) style.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
  if (fontColor != null || bold != null) {
    style.font = { ...(style.font || {}) };
    // Màu chữ nhận CẢ HAI dạng: chuỗi "FFRRGGBB" (argb) và đối tượng { theme, tint }. Tệp mẫu
    // Colorfull do người dùng chỉnh tay khai màu chữ hàng nhóm bằng THEME (`theme5` tint -0.25),
    // không phải argb — muốn ra đúng y tệp mẫu thì phải ghi lại đúng dạng đó.
    if (fontColor != null) style.font.color = typeof fontColor === "string" ? { argb: fontColor } : { ...fontColor };
    if (bold != null) style.font.bold = bold;
  }
  cell.style = style;
}

/**
 * Đổi style của MỘT ô mà không lan sang ô khác (XLSX-04).
 *
 * `ws.duplicateRow` (ExcelJS) gán CÙNG MỘT đối tượng style cho hàng nguồn và mọi hàng nhân bản
 * (`rDst.getCell(c).style = cell.style`). Gán thẳng `cell.alignment = …` / `cell.font = …` là sửa
 * đối tượng chung đó: một nhóm con hay dòng info rơi vào vùng nhân bản (báo giá dài hơn số khe của
 * mẫu) làm MỌI tên hạng mục từ hàng cuối của mẫu trở xuống bị thụt lề / in nghiêng. Cùng bẫy mà
 * `paintCell` đã tránh bằng cách nhân bản style trước khi sửa. Ô ngoài vùng nhân bản vốn đã có
 * style riêng nên đầu ra của chúng không đổi (style được ghi theo GIÁ TRỊ, không theo danh tính).
 */
function datStyleRieng(cell: any, patch: (st: any) => Record<string, unknown>) {
  const st = cell.style ? JSON.parse(JSON.stringify(cell.style)) : {};
  Object.assign(st, patch(st));
  cell.style = st;
}

// ── ƯỚC LƯỢNG SỐ DÒNG KHI EXCEL XUỐNG HÀNG — THEO BỀ RỘNG THẬT CỦA TỪNG KÝ TỰ (L40) ─────────────
// Bản cũ coi MỖI KÝ TỰ = 1 đơn vị bề rộng cột (tức bằng chữ số '0' của font mặc định, 7px). Ô Hạng
// Mục là Times New Roman 11 ĐẬM: chữ HOA, W/M/m, dấu tiếng Việt rộng hơn hẳn đơn vị đó, nên câu
// nhiều chữ HOA hoặc kích thước kiểu "0m8W" bị ước lượng thiếu một dòng và hàng (cao cố định) che
// mất dòng cuối. Đo bằng Excel thật (Rows.AutoFit): "Banner hàng rào: 0m8W x 0m5H x 8 tấm" ở cột
// 38 cần 2 dòng — app đặt 1; "HẠNG MỤC SÂN KHẤU VÀ TRANG TRÍ KHU VỰC ĐÓN KHÁCH" cần 3 — app đặt 2.
//
// BẢNG DƯỚI ĐÂY ĐO TRÊN EXCEL THẬT, không lấy từ bảng metric của font: bề rộng (px, 96dpi) mỗi
// ký tự Times New Roman 11pt, đậm và thường. Metric Adobe Times lệch khá xa bản Microsoft đã hint
// (vd 'e' đậm: metric 6,7px, Excel vẽ 8px). Mô phỏng ngắt-theo-từ bằng bảng này, so với Excel
// AutoFit trên 523 chuỗi (đậm 11 · thường 11 · thường 10 · nghiêng 10; 9 bề rộng cột lấy từ các
// mẫu): 0 ca thiếu dòng, ~15% ca thừa một dòng. Nhân thêm HE_SO_AN_TOAN và chừa biên để máy khác
// DPI/Excel khác bản vẫn không cắt chữ ("thà cao còn hơn cắt chữ").
// Chữ có dấu tra theo chữ gốc (NFD); móc ơ/ư và gạch đ rộng hơn chữ gốc ~1px. Ký tự lạ (emoji,
// chữ CJK…) tính 15px — rộng như 'M'. Dấu kết hợp ĐỨNG RIÊNG (chữ gõ bằng bảng mã "Unicode tổ
// hợp" của Unikey, hoặc dán từ nơi khác) thì rộng 0 như Excel vẽ — xem `soDongKhiXuongHang`.
const RONG_TNR11_PX: Record<"dam" | "thuong", Record<number, string>> = {
  dam:    { 3: "|", 4: " ,./fijl", 5: "!()-:;[]t'`\\‘’", 6: "Irz{}", 7: "acsy", 8: "\"#$*0123456789?JS_bdeghnopquvx~–“”", 9: "+<=>FPZ^k×", 10: "ELTVXYw", 11: "ABCDGNRU", 12: "HKOQm", 13: "&", 14: "@W", 15: "%M—…" },
  thuong: { 3: ",:ijl|'", 4: " ./;t`\\", 5: "!\"()-I[]fr‘’", 6: "J^sz“", 7: "$*0123456789?abcdeghknopquvxy{}”", 8: "#+<=>FS_~–×", 9: "ELPTZ", 10: "BCGRX", 11: "ADHKNOQUVYmw", 13: "%M", 14: "@W", 15: "—…" },
};
const BANG_RONG = { dam: new Map<string, number>(), thuong: new Map<string, number>() };
for (const k of ["dam", "thuong"] as const) {
  for (const [px, chuoi] of Object.entries(RONG_TNR11_PX[k])) for (const ch of chuoi) BANG_RONG[k].set(ch, Number(px));
}
const HE_SO_AN_TOAN = 1.05;   // biên cho máy khác DPI/bản Excel khác — xem đo đạc ở trên
// ── HỆ SỐ RIÊNG CHO TIÊU ĐỀ CỠ LỚN (L44) ─────────────────────────────────────────────────────
// Bảng trên đo ở cỡ 11 rồi nhân theo tỉ lệ cỡ chữ; ở cỡ 14/18 đậm nó ƯỚC LỐ vài phần trăm (nét
// chữ cỡ 11 bị hint rộng ra), nên 1,05 làm tiêu đề bật wrap khi Excel vẫn vừa một dòng — hàng tiêu
// đề nới gấp đôi mà chỉ chứa một dòng chữ. Đo Excel thật: 104 chuỗi × 8 vùng gộp tiêu đề (4 mẫu,
// có/không cột ảnh) = 832 ca, mỗi ca đặt ô tạm rộng ĐÚNG số px của vùng gộp, bật wrap rồi AutoFit.
// Hệ số NHỎ NHẤT mà mọi ca Excel cần hai dòng vẫn được bật wrap: cỡ 14 → 1,014; cỡ 18 → 0,98.
// Chọn chừa ~2% trên đó: 1,035 và 1,0 — số ca wrap sớm giảm từ 23 xuống 10 (trên 292 ca một
// dòng), 0 ca cắt chữ. Cỡ chưa đo giữ HE_SO_AN_TOAN.
const HE_SO_TIEU_DE: Record<number, number> = { 14: 1.035, 18: 1.0 };
const PX_MOI_DON_VI_COT = 7;  // 1 đơn vị bề rộng cột = chữ số '0' của font mặc định (Calibri 11 / Arial 10)
// Bề rộng LƯU trong .xlsx (thứ ExcelJS đọc/ghi) ĐÃ GỒM 5px đệm của Excel: cột lưu 38 rộng đúng
// 266px, còn Excel hiển thị "37,29". Phần chữ dùng được = 7 × bề rộng lưu − 5px đệm − 3px biên.
const DEM_EXCEL_PX = 5;
const LE_O_PX = 3;
const DAU_KET_HOP = /\p{Mn}/u;
function rongKyTuPx(ch: string, dam: boolean): number {
  const bang = dam ? BANG_RONG.dam : BANG_RONG.thuong;
  const co = bang.get(ch);
  if (co != null) return co;
  if (DAU_KET_HOP.test(ch)) return 0;
  if (ch === "đ") return (bang.get("d") ?? 8) + 1;
  if (ch === "Đ") return bang.get("D") ?? 11;
  const nfd = ch.normalize("NFD");
  const goc = nfd.length > 1 ? bang.get(nfd[0]) : undefined;
  if (goc != null) return goc + (nfd.includes("̛") ? 1 : 0);   // U+031B = móc của ơ/ư
  return 15;
}
/**
 * Số dòng Excel cần để hiện `text` trong ô rộng `beRongCot` đơn vị cột, chữ Times New Roman cỡ `co`
 * (đậm hay thường). Mô phỏng lối ngắt tham lam của Excel: ngắt theo TỪ, từ dài hơn cả dòng mới cắt
 * cứng. Xuất ra cho test (tests/xl-cao-hang-theo-be-rong-chu.test.js đối chiếu với số đo Excel thật).
 */
export function soDongKhiXuongHang(text: unknown, beRongCot: number, { dam = true, co = 11, heSo = HE_SO_AN_TOAN }: { dam?: boolean; co?: number; heSo?: number } = {}): number {
  if (text == null || text === "") return 1;
  // Chữ TỔ HỢP (NFD: "ô" = "o" + U+0302) tính mỗi dấu là một ký tự lạ 15px, nên ước lượng gấp ~2
  // lần số dòng thật (đo Excel COM: cùng câu, NFC cần 4 dòng, NFD bị tính 8). Dựng sẵn về NFC
  // trước khi đo; dấu nào không có dạng dựng sẵn thì `rongKyTuPx` tính rộng 0.
  text = String(text).normalize("NFC");
  const tiLe = ((Number(co) || 11) / 11) * heSo;
  const doRong = (s: string) => { let px = 0; for (const ch of s) px += rongKyTuPx(ch, dam); return px * tiLe; };
  // Chặn dưới 4 chữ số: cột quá hẹp (hoặc bề rộng hỏng) không được làm vòng cắt-cứng chạy vô hạn.
  const moiDong = Math.max(4 * PX_MOI_DON_VI_COT, Math.trunc(PX_MOI_DON_VI_COT * beRongCot + 0.5) - DEM_EXCEL_PX - LE_O_PX);
  const dauCach = doRong(" ");
  let total = 0;
  for (const seg of String(text).split(/\r?\n/)) {
    const tu = seg.split(/\s+/).filter(Boolean);
    if (!tu.length) { total += 1; continue; }
    let dong = 1, dai = 0;
    for (const w of tu) {
      const rw = doRong(w);
      const canThem = dai === 0 ? rw : dai + dauCach + rw;
      if (canThem <= moiDong) { dai = canThem; continue; }
      if (dai > 0) dong++;
      let con = rw;
      while (con > moiDong) { dong++; con -= moiDong; }
      dai = con;
    }
    total += dong;
  }
  return Math.max(1, total);
}

// ── CHIỀU CAO MỘT DÒNG CHỮ THEO CỠ ───────────────────────────────────────────────────────────
// Đo bằng Excel thật (Rows.AutoFit, Times New Roman, 96dpi): mỗi dòng cao đúng một số NGUYÊN px nên
// không tỉ lệ thuận với cỡ chữ — cỡ 12 cần 15,75pt (21px), cỡ 14 cần 18,75pt, cỡ 18 cần 22,5pt.
// Cỡ ≤ 11 giữ 15pt như mọi hàng hạng mục từ trước. Cỡ chưa đo thì làm tròn LÊN theo px ở tỉ lệ
// ~1,36 (tỉ lệ lớn nhất trong các cỡ đã đo) — thà cao còn hơn cắt chữ.
const CAO_MOT_DONG_PT: Record<number, number> = { 12: 15.75, 14: 18.75, 18: 22.5 };
function caoMotDongPt(co: number): number {
  const n = Number(co) || 11;
  if (n <= 11) return 15;
  return CAO_MOT_DONG_PT[n] ?? Math.ceil((n * 4) / 3 * 1.36) * 0.75;
}

/** Strip leading/trailing whitespace AND collapse internal newlines to spaces. */
function clean(s: any) {
  if (s == null) return "";
  return String(s).replace(/[\r\n]+/g, " ").trim();
}

/** 0→"A", 1→"B", …, 25→"Z", 26→"AA". Auto letter for section (nhóm) rows. */
function sectionLetter(n: number) {
  let s = "", x = n + 1;
  while (x > 0) { const m = (x - 1) % 26; s = String.fromCharCode(65 + m) + s; x = Math.floor((x - 1) / 26); }
  return s;
}

// ===== Cột "HÌNH ẢNH" theo TỪNG HẠNG MỤC (sheet.showImages) =====
// "A"→0, "Z"→25, "AA"→26 và ngược lại — tính chữ cột KẾ TIẾP sau cột cuối của template.
function colLetterToIdx(L: string) { let n = 0; for (const ch of String(L).toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; }
function idxToColLetter(n: number) { let s = ""; n = n + 1; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
// Đọc kích thước ảnh từ buffer (PNG/JPEG/GIF) để nhúng GIỮ TỈ LỆ — không cần thư viện ngoài.
function imgDims(buf: Buffer, ext: string): { w: number; h: number } | null {
  try {
    if (ext === "png" && buf.length > 24) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
    if (ext === "gif" && buf.length > 10) return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) };
    if (ext === "jpeg") {   // scan các marker SOF0..SOF15 (trừ DHT/DAC/RST)
      let i = 2;
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) { i++; continue; }
        const m = buf[i + 1];
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
        i += 2 + buf.readUInt16BE(i + 2);
      }
    }
  } catch { /* fallthrough */ }
  return null;
}
// Nhúng NHIỀU ảnh của 1 hạng mục vào Ô cột ảnh: xếp DỌC 1 ảnh/tầng — vị trí CHỈ phụ thuộc chiều
// cao hàng (do chính mình đặt) nên KHÔNG BAO GIỜ đè nhau, bất kể bề rộng cột thực tế. Ảnh fit
// khung giữ tỉ lệ; editAs oneCell → ảnh đi theo ô khi khách chèn/xoá hàng phía trên.
const IMG_BOX = 74;               // khung mỗi ảnh (px)
const MAX_ROW_PX = 540;           // Excel giới hạn hàng 409pt ≈ 545px — nhiều ảnh thì thu khung lại
const MAX_ITEM_IMG_BYTES = 3 * 1024 * 1024;   // cap ảnh/hạng mục (client đã nén ~JPEG 1400px)
// Định dạng ExcelJS ghi thẳng được vào .xlsx. KHÔNG có `webp` ở đây dù `webp` LƯU ĐƯỢC:
// regex của `images` trong src/validators.ts (tìm bằng `grep -n 'images: z.array'` — hiện ở
// dòng 163-165) nhận cả webp. Bên web, RE_ANH_HOP_LE (web/src/components/GridTable.tsx:122)
// cũng nhận webp, nhưng nó là guard HIỂN THỊ trong `safeImgSrc` (dòng 135) — chống chuỗi thoát
// khỏi `src=""`, KHÔNG phải đường lưu. Đường lưu thật là `fileToImg` (GridTable.tsx:1618): ảnh
// chọn từ máy được vẽ lên canvas rồi `toDataURL("image/jpeg", 0.82)` (dòng 1631), tức webp
// người dùng chèn đã thành JPEG trước khi rời trình duyệt; webp chỉ tới được server qua nhánh
// dự phòng khi `toDataURL` ném lỗi, hoặc qua API gọi thẳng.
// Vì sao vẫn không nhúng: muốn nhúng webp thì phải chuyển mã, mà dự án
// không có bộ chuyển mã ảnh nào trong package.json (không sharp, không jimp), còn ném thẳng
// byte webp vào file thì phụ thuộc Excel của KHÁCH có đọc được WebP không — Office bản vĩnh
// viễn 2016/2019 thì không, và một khung ảnh lỗi giữa báo giá gửi khách còn tệ hơn ô trống.
const ANH_NHUNG_DUOC = /^data:image\/(png|jpe?g|gif);base64,(.+)$/i;
function insertItemImages(ws: any, colLetter: string, rowNum: number, images: any) {
  // Lọc TRƯỚC khi tính chiều cao. Trước đây `n` đếm cả ảnh sắp bị bỏ (webp, hoặc quá nặng) nên
  // hàng bị kéo cao đúng số tầng đó rồi để trống — 3 ảnh webp = hàng cao 180pt không có gì
  // trong đó (đo bằng tests/b3-excel-item-images.test.js). Trần 10 ảnh giữ nguyên, nhưng nay
  // đếm trên ảnh NHÚNG ĐƯỢC.
  const list: RegExpExecArray[] = [];
  for (const s of (Array.isArray(images) ? images : [])) {
    if (typeof s !== "string") continue;
    const m = ANH_NHUNG_DUOC.exec(s);
    if (!m) continue;
    if (Math.floor((m[2].length * 3) / 4) > MAX_ITEM_IMG_BYTES) continue;   // DoS guard như logo
    list.push(m);
    if (list.length >= 10) break;
  }
  if (!list.length) return;
  const n = list.length;
  const box = Math.min(IMG_BOX, Math.floor(MAX_ROW_PX / n) - 6);   // n ảnh vẫn nằm gọn dưới trần 409pt
  const rowPx = n * (box + 6);
  const row = ws.getRow(rowNum);
  row.height = Math.max(row.height || 0, rowPx * 0.75);   // px → pt (1pt = 4/3px)
  const c0 = colLetterToIdx(colLetter);
  // TOẠ ĐỘ GỐC (EMU), KHÔNG ĐƯA PHÂN SỐ HÀNG CHO EXCELJS QUY ĐỔI (L39).
  // Bản cũ đặt `tl.row = hàng-1 + k/n + 0.015`. Setter `Anchor.row` của ExcelJS 4.4.0
  // (node_modules/exceljs/lib/doc/anchor.js) đổi phần lẻ ra EMU theo `row.height * 10000`, trong khi
  // DrawingML tính 1pt = 12700 EMU ⇒ mọi độ lệch dọc chỉ còn ~78,7% dự tính, còn `ext` (9525 EMU/px)
  // thì đúng — nên các tầng bị kéo sát lại và CHỒNG nhau. Đo bằng Excel thật: 2 ảnh vuông trong hàng
  // 120pt đè nhau 8,3pt; 10 ảnh dồn lên trên, đáy hàng 405pt trống ~77pt. Nay tự tính EMU: tầng k
  // bắt đầu ở k/n chiều cao hàng THẬT (≥ rowPx vì Math.max ở trên ⇒ mỗi tầng ≥ box+6 px, ảnh cao
  // ≤ box ⇒ giữa hai ảnh luôn còn ≥ 6px, ảnh cuối kết thúc trước đáy hàng).
  const EMU_MOI_PT = 12700, EMU_MOI_PX = 9525;
  const tangEmu = (Number(row.height) * EMU_MOI_PT) / n;
  for (let k = 0; k < n; k++) {
    const m = list[k];
    let extension = m[1].toLowerCase(); if (extension === "jpg") extension = "jpeg";
    try {
      const buffer = Buffer.from(m[2], "base64");
      const d = imgDims(buffer, extension);
      let w = box, h = box;
      if (d && d.w > 0 && d.h > 0) { const s = Math.min(box / d.w, box / d.h); w = Math.max(8, Math.round(d.w * s)); h = Math.max(8, Math.round(d.h * s)); }
      const imageId = ws.workbook.addImage({ buffer, extension });
      // Tầng k: đỉnh = k × (chiều cao hàng / n) + 2px đệm. Ngang: lệch 1px vào trong ô (bằng
      // `col + 0.05` cũ ở cột rộng 19).
      ws.addImage(imageId, {
        tl: { nativeCol: c0, nativeColOff: EMU_MOI_PX, nativeRow: rowNum - 1, nativeRowOff: Math.round(k * tangEmu + 2 * EMU_MOI_PX) },
        ext: { width: w, height: h },
        editAs: "oneCell",
      });
    } catch { /* bỏ ảnh hỏng, không phá export */ }
  }
}

function applyTemplateCleanup(ws: any, cfg: any) {
  const cleanup = cfg.cleanup || {};

  // Unmerge ranges left over from the sample (e.g. vertically-merged STT / Hạng Mục
  // cells that grouped sub-items). Must run BEFORE filling items so each row writes
  // independently. Accepts a master cell ("C7") or an explicit range ("C7:C9").
  for (const ref of (cleanup.unmergeRanges || [])) {
    try { ws.unMergeCells(ref); } catch {}
  }

  // Clear leftover residual cells (uses original row positions)
  for (const ref of (cleanup.extraCellsToClear || [])) {
    try { ws.getCell(ref).value = null; } catch {}
  }

  // GỘP LẠI VÙNG ĐẦU TRANG theo cấu hình — CHỈ Colorfull khai `headerMerges`, GN không có khoá
  // này nên không đi qua đây. Dùng để đưa khối "Kính gửi" ra GIỮA trang sau khi bỏ ô giữ chỗ logo
  // khách hàng: mẫu gốc gộp F3:I3 nên khối đó dạt hẳn sang phải, lệch bố cục so với bản GN.
  for (const range of ((cfg.headerMerges || []) as string[])) {
    const m = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(range);
    if (!m) continue;
    try {
      unmergeOverlapping(ws, colLetterToIdx(m[1]) + 1, parseInt(m[2], 10), colLetterToIdx(m[3]) + 1, parseInt(m[4], 10));
      safeMerge(ws, range);
    } catch { /* mẫu không có vùng đó */ }
  }

  // Remove all images outside the header area (keep only logo)
  if (cleanup.keepImagesAboveRow != null && Array.isArray(ws._media)) {
    const keep = cleanup.keepImagesAboveRow;
    ws._media = ws._media.filter((m: any) => {
      const top = m.range?.tl?.nativeRow ?? 99;
      return top < keep;
    });
  }

  // Remove specific rows entirely (do this LAST, in reverse order to keep indices valid)
  // ExcelJS spliceRows has a batch-count bug — splice 1 row at a time.
  const toRemove = (cleanup.removeRows || []).slice().sort((a: any, b: any) => b - a);
  for (const r of toRemove) {
    try { ws.spliceRows(r, 1); } catch {}
  }
}

function unmergeTotals(ws: any, cfg: any, lastItemRow: any) {
  // Unmerge each totals row's label cells BEFORE splicing,
  // so ExcelJS doesn't carry stale merge references after splice.
  const t = cfg.totals;
  const rows = [
    lastItemRow + t.subtotal.rowOffset,
    lastItemRow + t.vat.rowOffset,
    lastItemRow + t.total.rowOffset,
  ];
  const groups = [t.subtotal, t.vat, t.total];
  rows.forEach((r, i) => {
    for (const [colStart, colEnd] of (groups[i].labelCells || [])) {
      if (colStart !== colEnd) safeUnmerge(ws, `${colStart}${r}:${colEnd}${r}`);
    }
  });
}

/** Fill data for one sheet using its template config. Returns totals.
 *  sheetLabel: khi báo giá có NHIỀU sheet, tên sheet được nối vào tiêu đề ("… - Banner"). */
function fillSheetData(ws: any, cfg: any, quote: any, sheet: any, vatPct: any, sheetLabel?: string, sheetIdx = 0, tongSheet = 1) {
  applyTemplateCleanup(ws, cfg);

  const c = cfg.cells;
  const pal = cfg.palette || null;   // bảng màu tuỳ template (GN: peach/xanh lá/xanh dương)
  let items = (sheet.items || []).slice().sort((a: any, b: any) => (a.order || 0) - (b.order || 0));
  // Thứ tự item THEO ĐÚNG EDITOR (trước khi lọc dòng "info" của CLF) — công thức người
  // dùng đánh ref theo thứ tự này; giữ lại để dịch ref đúng dù `items` bị lọc bên dưới.
  const editorItems = items.slice();

  // Templates with a dedicated "program info" banner (CLF B5) collect kind:"info"
  // rows into that single cell instead of rendering them as item rows. The banner
  // is CLEARED when the quote has no info line, so the placeholder dots never print
  // — i.e. the line is opt-in per quote (the toggle the J5 guide note asked for).
  if (c.infoBannerCell) {
    const infoLines = items.filter((it: any) => it.kind === "info").map((it: any) => (it.name || "").trim()).filter(Boolean);
    items = items.filter((it: any) => it.kind !== "info");
    // ── DẢI NÀY CHỈ MANG "THÔNG TIN CHƯƠNG TRÌNH", KHÔNG GÌ KHÁC ────────────────────────
    // Có một lượt tôi cho nó gánh thêm mã dự án + lời chào, vì mẫu Colorfull không còn hàng trống
    // nào ở đầu trang (r1 thư đầu, r2 tiêu đề, r3 khối "Kính gửi", r4 tiêu đề cột) nên đây là chỗ
    // duy nhất đặt được. Người dùng xem file thật rồi chốt BỎ dòng đó đi. Giữ nguyên quyết định:
    // dải này chỉ in khi báo giá THẬT SỰ có dòng thông tin chương trình.
    const noiDungBanner = infoLines.length ? `* Thông tin chương trình: ${infoLines.join("; ")}` : "";
    setCell(ws, c.infoBannerCell, noiDungBanner);
    ensureWrap(ws.getCell(c.infoBannerCell));
    // TRỐNG THÌ ẨN HÀNG — để lại một dải màu rỗng vắt ngang bảng thì người nhận tưởng file lỗi.
    const hangBanner = parseInt(String(c.infoBannerCell).replace(/^[A-Z]+/, ""), 10);
    if (hangBanner) ws.getRow(hangBanner).hidden = !noiDungBanner;
  }

  if (c.toCompany) setCell(ws, c.toCompany, clean(quote.toCompany));
  if (c.toContact) setCell(ws, c.toContact, clean(quote.toContact));
  if (c.toPhone) setCell(ws, c.toPhone, clean(quote.toPhone));
  if (c.toAddress) setCell(ws, c.toAddress, clean(quote.toAddress));
  // Combined recipient block (e.g. CLF "Kính gửi: Cty X  Mr/Ms Y  Email: Z")
  if (c.toBlockCell) {
    const txt = c.toBlockFormat
      ? c.toBlockFormat({ company: quote.toCompany, contact: quote.toContact, email: quote.toEmail, phone: quote.toPhone, address: quote.toAddress })
      : (quote.toCompany || "");
    // Keep newlines (multi-line recipient block) — don't collapse via clean().
    setCell(ws, c.toBlockCell, (txt || "").trim());
    ensureWrap(ws.getCell(c.toBlockCell));
    // ── MÀU CHỮ + CĂN LỀ CỦA KHỐI NÀY ────────────────────────────────────────────────────────
    // CHỮ PHẢI VỀ MÀU MẶC ĐỊNH. Ô C3 của mẫu Colorfull VỐN là chữ mồi "logo cty khách hàng" màu
    // ĐỎ TƯƠI — đo trong cả `CLF_KhongNgay.xlsx` lẫn `CLF_CoNgay.xlsx`: font.color.argb =
    // FFFF0000. Bỏ tính năng logo khách hàng thì `extraCellsToClear` dọn GIÁ TRỊ nhưng GIỮ STYLE,
    // rồi `headerMerges` nhân style đỏ ấy ra cả dải C3:I3, rồi khối "Kính gửi" được ghi vào đúng
    // ô đó ⇒ MỌI báo giá Colorfull gửi khách in tên người nhận bằng CHỮ ĐỎ TƯƠI (đo trên cả ba
    // mẫu CLF). Ô "Kính gửi" GỐC của mẫu (F3) dùng theme 1 — trả về đúng thế.
    //
    // PHẢI NHÂN BẢN CẢ STYLE, KHÔNG GÁN THẲNG `o.font`/`o.alignment`: ExcelJS gộp các style giống
    // nhau thành MỘT đối tượng dùng chung cho nhiều ô, nên gán thẳng là sửa luôn mọi ô khác đang
    // dùng chung style đó — đúng cái bẫy đã ghi ở hàm `dat` của khối khung ngoài bên dưới.
    {
      const o = ws.getCell(c.toBlockCell);
      const st = JSON.parse(JSON.stringify(o.style || {}));
      st.font = { ...(st.font || {}), color: { theme: 1 } };
      // Canh GIỮA khi mẫu khai `toBlockCenter` (chỉ Colorfull): sau khi bỏ ô logo khách hàng, khối
      // này phủ cả C3:I3 nên căn trái/phải đều lệch — giữa mới cân với tiêu đề ở hàng trên.
      if (c.toBlockCenter) st.alignment = { ...(st.alignment || {}), horizontal: "center", vertical: "middle", wrapText: true };
      o.style = st;
      // PHẢI ĐẶT CHO CẢ Ô PHỤ CỦA VÙNG GỘP, không chỉ ô chủ.
      // `headerMerges` gộp C3:I3 TRƯỚC khúc này, mà `mergeCells` của ExcelJS LÀM PHẲNG style ra
      // toàn dải — tức màu đỏ của chữ mồi "logo cty khách hàng" đã kịp nhân ra D3..I3. Sửa mỗi ô
      // chủ thì Excel hiển thị đúng (nó vẽ theo ô chủ) nhưng chữ đỏ vẫn NẰM TRONG TỆP: ai bỏ gộp
      // trong Excel là nó hiện lại, và mọi công cụ đọc ô phụ vẫn thấy đỏ. Đo trên tệp do máy chủ
      // dev xuất ra: C3 đã theme1 mà D3/E3/F3/G3/H3/I3 vẫn FFFF0000.
      const vungKG = ((ws.model?.merges || []) as string[]).find((v) => v.startsWith(`${c.toBlockCell}:`));
      const mKG = vungKG && /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(vungKG);
      if (mKG) {
        for (let i = mKG[1].charCodeAt(0) + 1; i <= mKG[3].charCodeAt(0); i++) {
          try { ws.getCell(`${String.fromCharCode(i)}${mKG[2]}`).style = JSON.parse(JSON.stringify(st)); } catch { /* bỏ qua */ }
        }
      }
    }
  }
  if (c.fromContactCell) {
    const txt = c.fromContactFormat
      ? c.fromContactFormat({ contact: quote.fromContact, title: quote.fromTitle, phone: quote.fromPhone })
      : (quote.fromContact || "");
    setCell(ws, c.fromContactCell, clean(txt));
  }
  // Combined sender letterhead block (e.g. CLF F1: company / address / contact - title - phone).
  if (c.fromBlockCell) {
    const txt = c.fromBlockFormat
      ? c.fromBlockFormat({
          companyName: quote.company?.name,
          contact: quote.fromContact,
          title: quote.fromTitle,
          phone: quote.fromPhone,
          address: quote.fromAddress,
        })
      : (quote.fromContact || "");
    setCell(ws, c.fromBlockCell, (txt || "").trim());
    ensureWrap(ws.getCell(c.fromBlockCell));
  }
  if (c.fromPhone) setCell(ws, c.fromPhone, clean(quote.fromPhone));
  if (c.fromAddress) setCell(ws, c.fromAddress, clean(quote.fromAddress));
  if (c.date) setCell(ws, c.date, vnDateText(quote.quoteDate, quote.city));
  if (c.title) {
    let title = c.titleFormat ? c.titleFormat(quote.title) : (quote.title || "");
    // Báo giá nhiều sheet: nối tên sheet vào tiêu đề ("BẢNG BÁO GIÁ - MOANA - POSM - Banner").
    const lbl = (sheetLabel || "").trim();
    if (lbl) title = `${title} - ${lbl}`;
    setCell(ws, c.title, clean(title));
  }
  if (c.quoteNumber) {
    // MÃ SẢN XUẤT CỦA CHÍNH SHEET NÀY, không phải số GN của cả báo giá: mỗi tab Excel mang mã
    // riêng ("FP_A26_003_02") để khớp với trang Hoá đơn và với màn hình soạn.
    const maSheet = sheetCode(quote, soMa(sheet, sheetIdx), tongSheet) || quote.quoteNumber || "";
    setCell(ws, c.quoteNumber, c.quoteNumberFormat ? c.quoteNumberFormat(maSheet) : maSheet);
  }
  if (c.greeting) setCell(ws, c.greeting, quote.greeting || "");

  // Customer logo: if the template has an anchor cell and the quote carries a
  // base64 logo, drop the placeholder text and float the image over that cell.
  // (Đã GỠ tính năng "logo công ty khách hàng" — xem chú thích ở `clofull_decor` trong
  //  templateConfigs.ts. Chữ mồi "logo cty khách hàng" của mẫu nay bị xoá qua `extraCellsToClear`.)

  // Items
  const itemsCfg = cfg.items;

  // Normalize item-row styling from a reference clean row. Some sample templates
  // grouped sub-items via vertical merges; after unmerging, the formerly-merged
  // sub-cells lose their borders/font. Copy a known-good item row's per-column
  // style over the whole item range BEFORE any splice so every row matches.
  if (itemsCfg.styleRow) {
    const src = itemsCfg.styleRow;
    for (const colLetter of Object.values(itemsCfg.columns)) {
      const refStyle = ws.getCell(`${colLetter}${src}`).style;
      if (!refStyle) continue;
      const snap = JSON.parse(JSON.stringify(refStyle));
      for (let r = itemsCfg.firstRow; r <= itemsCfg.lastRow; r++) {
        if (r === src) continue;
        ws.getCell(`${colLetter}${r}`).style = JSON.parse(JSON.stringify(snap));
      }
    }
  }

  const skipRows = new Set(itemsCfg.skipRows || []);
  const templateRowCount = itemsCfg.lastRow - itemsCfg.firstRow + 1;
  // Available item slots = template rows EXCLUDING skipRows (e.g. section headers)
  const slotRows: number[] = [];
  for (let r = itemsCfg.firstRow; r <= itemsCfg.lastRow; r++) {
    if (!skipRows.has(r)) slotRows.push(r);
  }
  const slotCount = slotRows.length;
  const n = items.length;
  const originalLastItemRow = itemsCfg.lastRow;
  let actualLastRow = originalLastItemRow;

  if (itemsCfg.preserveStructure) {
    // STRUCTURE PRESERVATION MODE (for templates with section headers, Phí quản lý etc.)
    // Don't splice or duplicate. Fill items into available slot rows. Blank unused slots.
    // For n > slotCount, just truncate (or could add more, but TBD).
    // Totals stay at fixed positions (rowOffset from originalLastItemRow).
  } else if (n > slotCount) {
    // Add extra rows by duplicating the last item row
    const extraRows = n - slotCount;
    ws.duplicateRow(itemsCfg.lastRow, extraRows, true);
    // The new rows become additional slots
    for (let i = 1; i <= extraRows; i++) slotRows.push(itemsCfg.lastRow + i);
    actualLastRow = originalLastItemRow + extraRows;
  } else if (n < slotCount && n > 0) {
    // Remove (slotCount - n) unused rows from the END of the slot range
    unmergeTotals(ws, cfg, originalLastItemRow);
    const removeCount = slotCount - n;
    // Remove rows from the end of slotRows (excluding skipRows which stay)
    const rowsToRemove = slotRows.slice(-removeCount);
    // Sort descending so we splice from the bottom up
    for (const r of rowsToRemove.sort((a, b) => b - a)) {
      ws.spliceRows(r, 1);
      actualLastRow--;
      // Update slotRows that are below the removed row
      for (let i = 0; i < slotRows.length; i++) {
        if (slotRows[i] > r) slotRows[i]--;
      }
    }
    // Keep only the first n slots
    slotRows.length = n;
  } else if (n === 0) {
    // No items: clear all slot data, keep structure
    // Don't splice, just leave empty
  }

  const cols = itemsCfg.columns;
  // duplicateRow của ExcelJS có thể nhân bản merge dọc cũ của template sang slot mới. Gỡ sạch
  // merge trong vùng bảng trước khi ghi dữ liệu, rồi phần cuối hàm dựng lại đúng theo items mới.
  if (itemsCfg.removeDetail && cols.stt && cols.detail) {
    const from = colLetterToIdx(cols.stt) + 1, to = colLetterToIdx(cols.detail) + 1;
    for (const r of slotRows) unmergeOverlapping(ws, from, r, to, r);
  }
  // Cột của file mẫu KHÔNG còn dùng (vd "Chi Tiết") → ẩn HẲN: không hiện trên Excel, không in ra
  // PDF. KHÔNG xoá cột thật để mọi công thức/merge/ảnh trong mẫu giữ nguyên toạ độ. Kèm
  // columnWidths để nới cột còn lại cho cân bảng.
  for (const L of (itemsCfg.hiddenColumns || []) as string[]) {
    try { const c = ws.getColumn(L); c.hidden = true; c.width = 0; } catch { /* mẫu không có cột đó */ }
  }
  for (const [L, w] of Object.entries((itemsCfg.columnWidths || {}) as Record<string, number>)) {
    try { ws.getColumn(L).width = w; } catch { /* bỏ qua */ }
  }
  // Đổi NỀN hàng tiêu đề cột (STT/Hạng Mục…) → f3c9a1 cho MỌI mẫu — chỉ đổi nền + chữ đen đậm,
  // giữ nguyên viền/căn lề baked trong file mẫu. Khớp màu header của web.
  if (itemsCfg.headerRow && itemsCfg.paintHeader !== false) {
    for (const col of Object.values(cols)) paintCell(ws.getCell(`${col}${itemsCfg.headerRow}`), { fill: "FFF3C9A1", fontColor: "FF000000", bold: true });
  }
  // Cột "HÌNH ẢNH" (bật theo sheet): nằm NGAY SAU cột cuối của template — không dịch cột nào,
  // không đụng công thức. Header + width chỉ thêm khi bật (mặc định tắt → file y như cũ).
  /** Gán viền (và tuỳ chọn căn lề) cho MỘT ô mà không lem sang ô khác.
   *
   *  ExcelJS gộp các style giống hệt nhau thành MỘT đối tượng dùng chung cho nhiều ô, nên
   *  `cell.border = {...}` sửa luôn mọi ô đang dùng chung style đó. Đo được trên mẫu Colorfull
   *  CÓ NGÀY khi bật cột HÌNH ẢNH: đặt viền cho ô cột ảnh (K) làm cột L — NGOÀI bảng — mọc viền
   *  theo, kể cả ở hàng dải "* Thông tin chương trình" đang rỗng ⇒ ô rỗng có khung lơ lửng cạnh
   *  bảng. Cùng đúng cái bẫy mà hàm `dat` của khối khung ngoài đã ghi chú. */
  const datVien = (cell: any, vien: any, canhLe?: any) => {
    try {
      const st = JSON.parse(JSON.stringify(cell.style || {}));
      st.border = vien;
      if (canhLe) st.alignment = { ...(st.alignment || {}), ...canhLe };
      cell.style = st;
    } catch { /* ô không tồn tại */ }
  };

  const imgCol: string | null = sheet?.showImages
    ? idxToColLetter(Math.max(...Object.values(cols).map((L: any) => colLetterToIdx(String(L)))) + 1)
    : null;
  if (imgCol && itemsCfg.headerRow) {
    const hcell = ws.getCell(`${imgCol}${itemsCfg.headerRow}`);
    // NỀN HEADER PHẢI THEO ĐÚNG CỜ `paintHeader` NHƯ CÁC CỘT KHÁC.
    // Trước đây ô này luôn được tô peach F3C9A1, trong khi vòng tô ngay trên bỏ qua mọi mẫu khai
    // `paintHeader: false` (Colorfull — giữ nền nướng sẵn trong tệp mẫu). Đo trên tệp xuất thật:
    // B..I nền theme8/t0.4 (xanh ngọc của mẫu) mà J "HÌNH ẢNH" nền FFF3C9A1 ⇒ HÀNG TIÊU ĐỀ HAI
    // MÀU. Mẫu nào để nền baked thì chép style ô tiêu đề cột cuối sang, cho liền một dải.
    if (itemsCfg.paintHeader !== false) {
      paintCell(hcell, { fill: "FFF3C9A1", fontColor: "FF000000", bold: true });
    } else {
      const cotMau = (cols.notes || cols.amount) as string | undefined;
      if (cotMau) {
        try { hcell.style = JSON.parse(JSON.stringify(ws.getCell(`${cotMau}${itemsCfg.headerRow}`).style || {})); } catch { /* bỏ qua */ }
      }
    }
    hcell.value = "HÌNH ẢNH";
    // ĐỈNH/ĐÁY THEO Ô TIÊU ĐỀ CỘT CUỐI CŨ, không đặt cứng (L42): bản cũ ghi đáy 'medium' trong khi
    // đáy mọi ô tiêu đề khác là 'thin' (GN I11, CLF I4) ⇒ riêng dưới ô HÌNH ẢNH có một đoạn đáy dày.
    // Thiếu thì lui về nét cũ. Colorfull kẻ đỉnh dày ở khối `outerFrame` bên dưới — cột ảnh cũng đi qua đó.
    const vienTieuDeCu = ws.getCell(`${(cols.notes || cols.amount) as string}${itemsCfg.headerRow}`).border || {};
    datVien(hcell, {
      top: vienTieuDeCu.top ? { ...vienTieuDeCu.top } : { style: "medium" },
      left: { style: "thin" },
      bottom: vienTieuDeCu.bottom ? { ...vienTieuDeCu.bottom } : { style: "thin" },
      right: { style: "medium" },
    }, { vertical: "middle", horizontal: "center", wrapText: true });
    try { ws.getColumn(imgCol).width = 19; } catch { /* giữ mặc định */ }

    // ── CỘT ẢNH LÀ CỘT CUỐI MỚI CỦA BẢNG → MỌI DẢI KÉO NGANG CẢ BẢNG PHẢI NỐI DÀI SANG NÓ ──────
    // Người dùng báo 2026-09-23 (ảnh chụp tệp Colorfull): dải tiêu đề "BẢNG BÁO GIÁ" và dải "Thông
    // tin chương trình" dừng ở cột Ghi Chú, cột HÌNH ẢNH bên cạnh trắng trơn — "chưa kéo màu hoàn
    // chỉnh". Đo trên tệp xuất: CLF gộp F1:I1 · B2:I2 · C3:I3 · B5:I5, GN gộp B6:I6 · B7:I7 · B8:I8,
    // tất cả dừng ở cột cuối CŨ. Luật chung (không liệt kê theo mẫu): vùng gộp nào kết thúc đúng ở
    // cột cuối cũ và nằm TRÊN hàng tiêu đề cột (hoặc là dải thông tin chương trình) → gỡ gộp, chép
    // style ô cuối (nền, viền phải/dưới) sang cột ảnh, gộp lại tới cột ảnh. Chữ canh giữa tự về giữa
    // bảng mới. Vùng gộp trong thân bảng / khối tổng KHÔNG đụng (dựng lại theo hàng ở bên dưới).
    const cotCuoiCu = Math.max(...Object.values(cols).map((L: any) => colLetterToIdx(String(L)))) + 1;   // 1-based
    const cotAnh = colLetterToIdx(imgCol) + 1;
    const hangBannerAnh = c.infoBannerCell ? parseInt(String(c.infoBannerCell).replace(/^[A-Z]+/, ""), 10) : null;
    const giaiVung = (m: string) => {
      const x = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(m);
      return x ? { c1: colLetterToIdx(x[1]) + 1, r1: +x[2], c2: colLetterToIdx(x[3]) + 1, r2: +x[4] } : null;
    };
    for (const m of [...((ws.model.merges || []) as string[])]) {
      const v = giaiVung(m);
      if (!v || v.c2 !== cotCuoiCu) continue;
      const laDaiDauTrang = v.r2 < itemsCfg.headerRow;
      const laDaiThongTin = hangBannerAnh != null && v.r1 === hangBannerAnh && v.r2 === hangBannerAnh;
      if (!laDaiDauTrang && !laDaiThongTin) continue;
      try {
        ws.unMergeCells(m);
        for (let r = v.r1; r <= v.r2; r++) {
          ws.getCell(r, cotAnh).style = JSON.parse(JSON.stringify(ws.getCell(r, v.c2).style || {}));
        }
        ws.mergeCells(v.r1, v.c1, v.r2, cotAnh);
      } catch { /* vùng gộp lạ → để nguyên còn hơn làm hỏng tệp */ }
    }
  }

  // Row heights: use the configured uniform height; otherwise size each row to fit its
  // content so the tall sample heights baked into the template don't carry over (fixes
  // "hàng bị to" khi số mục ít hơn slot mẫu). TỰ CĂN CHỈNH theo chữ như Excel: ước lượng
  // số dòng SAU KHI XUỐNG HÀNG (wrap) theo ĐỘ RỘNG CỘT — không chỉ đếm \n — nên tên nhóm
  // / hạng mục dài (vd "Booth backdrop … (thay AW booth có sẵn)") không bị cắt mất chữ.
  const colWidthOf = (letter: any) => { try { const w = ws.getColumn(letter).width; return (w && w > 0) ? w : null; } catch { return null; } };
  /** Font của một ô để đo bề rộng chữ: đậm/thường + cỡ (mặc định 11). */
  const fontDo = (addr: string, epDam = false) => {
    try { const f = ws.getCell(addr).font || {}; return { dam: epDam || !!f.bold, co: Number(f.size) || 11 }; } catch { return { dam: true, co: 11 }; }
  };
  const wrapLines = (text: any, letter: any, beRongEp?: number | null, font?: { dam?: boolean; co?: number; heSo?: number }) => {
    if (text == null || text === "") return 1;
    const mergedNameWidth = itemsCfg.removeDetail && letter === cols.name && cols.detail
      ? (colWidthOf(cols.name) || 12) + (colWidthOf(cols.detail) || 12)
      : null;
    // `beRongEp` dùng cho Ô GỘP NGANG ngoài bảng hạng mục (khối "Kính gửi" C3:I3, dải thông tin
    // chương trình B5:I5, ô "* Ghi chú" C:D): bề rộng thật của chúng là TỔNG bề rộng các cột bị
    // phủ, không phải bề rộng một cột.
    const cw = beRongEp || mergedNameWidth || colWidthOf(letter) || 12;
    // NGẮT DÒNG THEO TỪ, KHÔNG THEO SỐ KÝ TỰ — Excel không cắt giữa từ.
    // Bản cũ hơn tính `ceil(độ dài / perLine)`, tức coi mỗi dòng luôn được lấp đầy:
    //     "Banner hàng rào: 0m8W x 0m5H x 8 tấm" trong cột rộng 21
    //        cũ  : ceil(36/20) = 2 dòng  → đặt cao 33pt
    //        thật: "Banner hàng rào:" / "0m8W x 0m5H x 8" / "tấm" = 3 dòng → DÒNG CUỐI BỊ CHE
    // Bản kế đó ngắt theo từ nhưng vẫn coi mỗi ký tự rộng 1 đơn vị cột, nên ở cột 38 câu ấy vẫn bị
    // che (L40). Nay đo theo bề rộng THẬT của từng ký tự — xem `soDongKhiXuongHang`.
    return soDongKhiXuongHang(text, cw, font);
  };
  // Group structure for "hàng con" (mirror the editor): a "sub" extends the current
  // group only when the previous row was a head/sub, else it starts its own group.
  // Tính TRƯỚC vòng đo chiều cao để biết hàng nào là "sub" (ô tên bị gộp, không hiện).
  const effKind = items.map(() => "head");
  for (let i = 0; i < items.length; i++) {
    const k = items[i]?.kind;
    if (k === "info") effKind[i] = "info";
    else if (k === "section" || k === "subsection") effKind[i] = "section";
    else if (k === "sub" && i > 0 && (effKind[i - 1] === "head" || effKind[i - 1] === "sub")) effKind[i] = "sub";
    else effKind[i] = "head";
  }

  for (let hi = 0; hi < slotRows.length; hi++) {
    const r = slotRows[hi];
    if (itemsCfg.rowHeight) { ws.getRow(r).height = itemsCfg.rowHeight; continue; }
    const it = items[hi];
    let lines = 1;
    if (it) {
      // Hàng con (sub): ô STT + Hạng Mục gộp lên dòng cha → tên KHÔNG hiện ở dòng này, nên
      // không đo chiều cao theo tên (tránh hàng cao vô ích).
      const nameForHeight = effKind[hi] === "sub" ? null : it.name;
      const measured = [[nameForHeight, cols.name], ...(!itemsCfg.removeDetail ? [[it.detail, cols.detail]] : []), [it.notes, cols.notes]];
      // Hàng NHÓM được tô đậm SAU vòng này (paintCell bold) — đo theo chữ đậm luôn cho khớp.
      const laNhom = effKind[hi] === "section";
      for (const [t, letter] of measured) {
        if (t && letter) lines = Math.max(lines, wrapLines(t, letter, null, fontDo(`${letter}${r}`, laNhom)));
      }
    }
    // Chặn trên 409 pt (giới hạn chiều cao hàng của Excel) để file không out-of-spec.
    ws.getRow(r).height = Math.min(409, Math.max(18, lines * 15 + 3));
  }

  // ── CHIỀU CAO CÁC HÀNG GỘP NGANG NGOÀI BẢNG HẠNG MỤC ──────────────────────────────────────
  // Vòng ngay trên chỉ đo HÀNG HẠNG MỤC. Hai hàng đầu trang của Colorfull giữ nguyên chiều cao
  // nướng sẵn trong tệp mẫu, và nó KHÔNG đủ: đo trên tệp xuất thật, khối "Kính gửi" (C3:I3) cao
  // 67pt trong khi `toBlockFormat` sinh 5 dòng cỡ 12pt ⇒ cần ≈75pt, nên DÒNG EMAIL BỊ CẮT ngay cả
  // khi mọi trường đều ngắn. Cùng đúng lớp lỗi "xuống hàng bị che" đã chữa cho hàng hạng mục.
  // GN không khai `toBlockCell`/`infoBannerCell` nên không đi qua đây.
  const beRongVungGop = (addr: string): number | null => {
    const vung = ((ws.model?.merges || []) as string[]).find((r) => r.startsWith(`${addr}:`));
    const m = vung && /^([A-Z]+)\d+:([A-Z]+)\d+$/.exec(vung);
    if (!m || m[1].length > 1 || m[2].length > 1) return null;
    let tong = 0;
    for (let i = m[1].charCodeAt(0); i <= m[2].charCodeAt(0); i++) tong += colWidthOf(String.fromCharCode(i)) || 0;
    return tong > 0 ? tong : null;
  };
  const caoTheoChu = (addr: any) => {
    if (!addr) return;
    try {
      const o = ws.getCell(addr);
      const chu = typeof o.value === "string" ? o.value : "";
      if (!chu) return;                       // ô rỗng: giữ nguyên (dải banner rỗng còn bị ẩn hàng)
      const r = parseInt(String(addr).replace(/^[A-Z]+/, ""), 10);
      if (!r) return;
      const f = fontDo(addr);
      const soDong = wrapLines(chu, null, beRongVungGop(addr), f);
      // Mỗi dòng theo CỠ CHỮ thật của ô: hai ô đi qua đây đều cỡ 12 (15,75pt/dòng) — tính 15pt như
      // chữ 11 thì khối "Kính gửi" đủ 5 dòng thiếu 0,75pt, dải thông tin 7 dòng thiếu 2,25pt, và
      // dòng cuối bị xén (đo Excel COM).
      const can = Math.min(409, Math.max(18, soDong * caoMotDongPt(f.co) + 3));
      // CHỈ NỚI RA, KHÔNG BÓP LẠI: chiều cao trong tệp mẫu là chủ ý trình bày của người dùng.
      const dangCo = ws.getRow(r).height;
      if (dangCo == null || can > dangCo) ws.getRow(r).height = can;
    } catch { /* mẫu không có ô đó */ }
  };
  caoTheoChu(c.toBlockCell);
  caoTheoChu(c.infoBannerCell);

  // ── TIÊU ĐỀ DÀI: XUỐNG DÒNG + NỚI CAO HÀNG (L44) ─────────────────────────────────────────────
  // Ô tiêu đề GỘP NGANG (CLF B2:I2 · 18 đậm · 27,5pt; GN B7:I7 · 14 đậm · 17,5pt), canh giữa, không
  // wrap. Ô gộp không tràn chữ sang ô bên cạnh ⇒ "BẢNG BÁO GIÁ - <tiêu đề> - <tên sheet>" dài hơn
  // vùng gộp bị Excel cắt CẢ HAI ĐẦU (đo: ~83 ký tự ở CLF, ~88 ở GN là bắt đầu cụt). Chỉ khi chữ
  // THẬT SỰ tràn mới bật wrap và nới hàng — tiêu đề vừa một dòng giữ nguyên từng thuộc tính của tệp
  // mẫu. Đặt SAU khối cột ảnh vì vùng gộp tiêu đề có thể vừa nối dài sang cột HÌNH ẢNH. Không đi qua
  // `caoTheoChu`: ô tiêu đề chỉ bật wrap khi chữ THẬT SỰ tràn, và giữ công thức cao riêng bên dưới.
  if (c.title) {
    try {
      const o = ws.getCell(c.title);
      const chu = typeof o.value === "string" ? o.value : "";
      const rong = beRongVungGop(c.title);
      const f = fontDo(c.title);
      const soDong = chu && rong ? wrapLines(chu, null, rong, { ...f, heSo: HE_SO_TIEU_DE[f.co] ?? HE_SO_AN_TOAN }) : 1;
      const r = parseInt(String(c.title).replace(/^[A-Z]+/, ""), 10);
      if (soDong > 1 && r) {
        datStyleRieng(o, (st) => ({ alignment: { ...(st.alignment || {}), wrapText: true, vertical: "middle" } }));
        const can = Math.min(409, Math.ceil(soDong * f.co * 1.35 + 2));
        const dangCo = ws.getRow(r).height;
        if (dangCo == null || can > dangCo) ws.getRow(r).height = can;
      } else if (chu && r) {
        // TIÊU ĐỀ MỘT DÒNG vẫn phải đủ cao cho MỘT dòng: GN nướng sẵn 17,5pt cho chữ 14 đậm trong khi
        // Excel cần 18,75pt (đo COM) — hụt 1,25pt ngay cả với tiêu đề ngắn. Chỉ nới, không bóp.
        const dangCo = ws.getRow(r).height;
        if (dangCo != null && caoMotDongPt(f.co) > dangCo) ws.getRow(r).height = caoMotDongPt(f.co);
      }
    } catch { /* mẫu không có ô tiêu đề */ }
  }

  // Per-section subtotal = sum of item/sub amounts until the next section. Shown only
  // when sheet.groupSubtotal is on. Section rows are letter-coded (A,B,C…) and never
  // count toward the grand subtotal (their qty/price are 0).
  const showGroupSub = !!(sheet && sheet.groupSubtotal);
  // Bản BANNER (gn_banner): NHÓM CON đánh số 1,2,3; MỤC bên dưới KHÔNG đánh số.
  const numberSubs = !!itemsCfg.numberSubsections;
  // Tổng nhóm. Nhóm con = Σ mục con. Bản BANNER: nhóm CHA = Σ TẤT CẢ mục con (cuộn qua nhóm con)
  // → khớp web "đơn giá hàng cha = tổng hàng con". Mẫu khác giữ cũ (nhóm con tổng riêng).
  const sectionSum: Record<number, number> = {};
  {
    let curSection = -1, curSub = -1;
    for (let i = 0; i < items.length; i++) {
      if (effKind[i] === "section") {
        if (items[i] && items[i].kind === "subsection") { curSub = i; sectionSum[i] = 0; }
        else { curSection = i; curSub = -1; sectionSum[i] = 0; }
      } else if ((effKind[i] === "head" || effKind[i] === "sub") && items[i]) {
        const it = items[i];
        const qty = qtyForAmount(it), days = Number(it.days) || 1, price = Number(it.unitPrice) || 0;
        const amt = cols.days ? nhanLamTronDong(qty, days, price) : nhanLamTronDong(qty, price);   // chính xác — XLSX-06
        const parent = curSub >= 0 ? curSub : curSection;
        if (parent >= 0) sectionSum[parent] += amt;
        if (numberSubs && curSub >= 0 && curSection >= 0) sectionSum[curSection] += amt;   // banner: dồn lên nhóm cha
      }
    }
  }

  // Công thức người dùng TỰ GÕ (it.formulas) → công thức Excel thật. Dựng bộ dịch theo
  // sheet (slotRows đã chốt). Ô số nào dịch được + tự kiểm khớp thì ghi công thức; không
  // thì ghi số như cũ (putNum bên dưới) — không bao giờ làm hỏng export.
  // Bản đồ ĐỐI TƯỢNG item (item/sub đã đặt chỗ) → hàng Excel: tra theo địa chỉ đối tượng
  // nên ref công thức dịch ĐÚNG bất kể CLF lọc dòng "info" làm lệch chỉ số mảng.
  const rowByItem = new Map();
  for (let j = 0; j < slotRows.length; j++) {
    const it2 = items[j];
    if (it2 && (it2.kind === "item" || it2.kind === "sub") && slotRows[j] != null) rowByItem.set(it2, slotRows[j]);
  }
  const fctx = buildFormulaContext({
    cols,
    items: editorItems,                                  // thứ tự editor (ref người dùng khớp)
    rowToExcel: (idx0: any) => rowByItem.has(editorItems[idx0]) ? rowByItem.get(editorItems[idx0]) : null,
  });
  // Ghi 1 ô số: ưu tiên công thức người dùng (kết quả = giá trị đã tính), fallback ghi số.
  const putNum = (it2: any, row: any, field: any, colX: any, value: any) => {
    if (!colX) return;
    const raw = it2 && it2.formulas && it2.formulas[field];
    const fx = raw ? fctx.cellFormula(raw, value, { item: it2, field }) : null;   // self → chặn vòng khi ref Thành Tiền
    if (fx) ws.getCell(`${colX}${row}`).value = { formula: fx, result: value };
    else setCell(ws, `${colX}${row}`, value);
  };

  let subtotal = 0;
  let itemNo = 0;
  let sectionIdx = -1;
  let mult = 1;
  let subNo = 0;
  // ===== Công thức SỐNG cho dòng NHÓM + subtotal =====
  // Mục tiêu: khách sửa Số Lượng/Đơn Giá 1 mục trong Excel → Đơn giá nhóm, Thành tiền nhóm,
  // Tổng Cộng, VAT, Thành Tiền TỰ tính lại (không còn ô tổng "chết"). Số `result` GIỮ NGUYÊN =
  // giá trị tính ở server → snapshot không đổi; chỉ THÊM công thức để Excel tự cập nhật khi sửa.
  // Hàng Excel [đầu, cuối] các MỤC (head/sub) thuộc nhóm tại index si (dừng ở nhóm/nhóm con kế).
  const childExcelRange = (si: number): [number, number] | null => {
    let first: number | null = null, last: number | null = null;
    for (let j = si + 1; j < items.length; j++) {
      if (effKind[j] === "section") break;                                  // nhóm/nhóm con kế
      if (effKind[j] !== "head" && effKind[j] !== "sub") continue;          // bỏ info/khác
      const rr = slotRows[j];
      if (rr == null) continue;
      if (first == null) first = rr; last = rr;
    }
    return first == null ? null : [first, last as number];
  };
  // Bản BANNER: nhóm CHA = ĐƠN GIÁ các NHÓM CON dưới nó (mỗi nhóm con đã = Σ mục của nó).
  // Trả HÀNG Excel của các nhóm con (rời nhau → SUM(a,b,c)).
  const subSectionRows = (si: number): number[] => {
    const rows: number[] = [];
    for (let j = si + 1; j < items.length; j++) {
      if (effKind[j] === "section") {
        if (items[j] && items[j].kind === "subsection") { const rr = slotRows[j]; if (rr != null) rows.push(rr); }
        else break;   // nhóm chính kế → dừng
      }
    }
    return rows;
  };
  // Biểu thức cộng vào Tổng Cộng, kèm hàng để sắp xếp (khi bật ×SL). Thường là ô Thành Tiền của
  // hàng nhóm; bản BANNER có nhóm lồng nhau thì là ô của các nhóm CON + mục lẻ của cha ×SL cha.
  const groupAmtTerms: { row: number; expr: string }[] = [];
  const coveredSubRows = new Set<number>();   // hàng nhóm con đã được nhóm cha gom vào Tổng Cộng
  const looseAmtRows: number[] = [];   // hàng mục KHÔNG thuộc nhóm nào (trước nhóm đầu tiên)
  let seenSection = false;
  // Có nhóm mang hệ số KHÔNG nguyên (SL nhóm 1,5) → Tổng Cộng có thể ra số lẻ .5 (XLSX-07). Xem chỗ dùng.
  let coHeSoNhomLe = false;
  for (let i = 0; i < slotRows.length; i++) {
    const r = slotRows[i];
    const it = items[i];
    if (it && effKind[i] === "section") {
      // Section header. NHÓM CHÍNH (kind="section"): tự cấp chữ A/B/C. NHÓM CON
      // (kind="subsection"): TUYỆT ĐỐI KHÔNG có chữ A/B/C (cột STT để TRỐNG), KHÔNG thêm
      // ký tự "↳" nào vào tên — chỉ khác bằng NỀN nhạt hơn + thụt lề (căn lề, không ký tự),
      // khớp đúng yêu cầu "nhóm con không có chữ gì hết". Không làm lệch thứ tự A/B/C nhóm chính.
      const isSubSection = it.kind === "subsection";
      let letter;
      if (isSubSection) {
        // Mặc định nhóm con KHÔNG có chữ A/B/C. Bản BANNER: đánh số 1,2,3 (theo thứ tự nhóm con).
        letter = (it.label && String(it.label).trim()) || (numberSubs ? String(++subNo) : "");
      } else {
        sectionIdx++;
        letter = (it.label && String(it.label).trim()) || sectionLetter(sectionIdx);
        subNo = 0;   // số nhóm con reset theo từng nhóm chính
      }
      itemNo = 0; // item numbering restarts under each section
      if (cols.stt) setCell(ws, `${cols.stt}${r}`, letter || null);   // nhóm con: STT TRỐNG hẳn (không A/B/C)
      if (cols.name) {
        const nameCell = ws.getCell(`${cols.name}${r}`);
        setCell(ws, `${cols.name}${r}`, it.name || ""); ensureWrap(nameCell);
        if (isSubSection) datStyleRieng(nameCell, (st) => ({ alignment: { ...(st.alignment || {}), indent: 1 } }));   // thụt lề, KHÔNG dùng ký tự
      }
      if (cols.detail) ws.getCell(`${cols.detail}${r}`).value = null;
      if (cols.days) ws.getCell(`${cols.days}${r}`).value = null;
      if (cols.unit) setCell(ws, `${cols.unit}${r}`, clean(it.unit));
      // SL hàng nhóm: ghi số ĐÃ làm tròn (ô này không set numFmt nên thừa hưởng định dạng template
      // → ghi số thô là khách mở file thấy đủ 4 chữ số, khác hẳn lưới web).
      const gq = qtyForAmount(it);
      if (cols.quantity) ws.getCell(`${cols.quantity}${r}`).value = (gq || 0) || null;
      const gmult = showGroupSub ? Math.max(1, gq || 1) : 1;   // ×SL chỉ khi bật "thành tiền nhóm"
      mult = gmult;
      if (!Number.isInteger(gmult)) coHeSoNhomLe = true;
      seenSection = true;
      // Đơn Giá nhóm = SUM Thành Tiền các mục con (CÔNG THỨC SỐNG). Thành Tiền nhóm = Đơn Giá nhóm ×
      // Số Lượng nhóm (sống, chỉ khi bật). Không có mục con → ghi số như cũ (an toàn).
      const childRng = childExcelRange(i);
      const looseSum = childRng ? `SUM(${cols.amount}${childRng[0]}:${cols.amount}${childRng[1]})` : null;   // mục TRỰC THUỘC nhóm này
      // Bản BANNER + nhóm CHÍNH có nhóm con → Đơn Giá = Σ Thành Tiền mục lẻ trực thuộc + Σ đơn giá
      // nhóm con (rời ô). Còn lại: Σ Thành Tiền mục con.
      const subRows = (numberSubs && !isSubSection) ? subSectionRows(i) : [];
      const subCells = cols.unitPrice ? subRows.map((rr) => `${cols.unitPrice}${rr}`) : [];
      const hasGroupBody = subRows.length > 0 || !!(childRng && sectionSum[i]);
      if (cols.unitPrice) {
        // Nhóm cha có CẢ mục lẻ LẪN nhóm con: phải cộng cả hai vế. Bỏ vế mục lẻ là công thức hụt
        // đúng phần đó — số ghi sẵn vẫn đủ nên lỗi chỉ lộ ra khi khách MỞ file, Excel tính lại.
        const priceTerms: string[] = [];
        if (subCells.length) { if (looseSum) priceTerms.push(looseSum); priceTerms.push(`SUM(${subCells.join(",")})`); }
        else if (looseSum && sectionSum[i]) priceTerms.push(looseSum);
        if (priceTerms.length) ws.getCell(`${cols.unitPrice}${r}`).value = { formula: priceTerms.join("+"), result: sectionSum[i] };
        else ws.getCell(`${cols.unitPrice}${r}`).value = sectionSum[i] || null;
      }
      if (showGroupSub && cols.amount) {
        // Tổng Cộng. BANNER + nhóm lồng nhau: Đơn Giá cha ĐÃ bao trùm nhóm con, nên cộng cả hàng
        // cha lẫn hàng con là cộng ĐÔI (2 nhóm con → gấp 3). Cộng các hàng nhóm CON (đã ×SL con)
        // + mục lẻ của cha ×SL cha — đúng quy ước "hệ số nhóm đặt lại ở mỗi nhóm" của
        // sheetSubtotalGrouped/computeQuoteTotals, tức đúng con số lưới web và DB đang giữ.
        if (subRows.length) {
          if (looseSum) groupAmtTerms.push({ row: r, expr: gmult > 1 ? `${looseSum}*${cols.quantity}${r}` : looseSum });
          for (const rr of subRows) { coveredSubRows.add(rr); groupAmtTerms.push({ row: rr, expr: `${cols.amount}${rr}` }); }
        } else if (!coveredSubRows.has(r)) {
          groupAmtTerms.push({ row: r, expr: `${cols.amount}${r}` });
        }
      }
      if (cols.amount) {
        if (showGroupSub && hasGroupBody) {
          const fAmt = gmult > 1 ? `${cols.unitPrice}${r}*${cols.quantity}${r}` : `${cols.unitPrice}${r}`;   // ×SL khi SL>1; SL≤1 → = đơn giá nhóm
          ws.getCell(`${cols.amount}${r}`).value = { formula: fAmt, result: sectionSum[i] * gmult };
        } else {
          ws.getCell(`${cols.amount}${r}`).value = showGroupSub ? ((sectionSum[i] * gmult) || null) : null;
        }
      }
      if (cols.notes) setCell(ws, `${cols.notes}${r}`, it.notes || null);
      for (const col of Object.values(cols)) {
        // Nhóm con: ô STT + Ghi Chú để TRẮNG (không tô nền) — chỉ tô dải giữa. Bản BANNER có
        // đánh SỐ vào ô STT nên ô STT ĐƯỢC tô nền (số nằm trên dải), chỉ Ghi Chú để trắng.
        const bareSubCell = isSubSection && (col === cols.notes || (col === cols.stt && !numberSubs));
        paintCell(ws.getCell(`${col}${r}`), {
          // Nhóm chính A/B/C: nền KEM + chữ nâu. Nhóm con: nền XANH + chữ xanh. Khớp web,
          // theo yêu cầu khách (hoán đổi so với trước). STT/Ghi Chú của nhóm con để trắng.
          fill: bareSubCell ? "none" : (isSubSection ? (itemsCfg.subFill || "FFC9D9EF") : (itemsCfg.sectionFill || "FFFAE9DB")),
          bold: true,
          // MÀU CHỮ CŨNG PHẢI THEO MẪU, KHÔNG CHỈ MÀU NỀN.
          // Đợt trước chỉ đổi `sectionFill`/`subFill` theo tệp mẫu người dùng chỉnh mà bỏ quên hai
          // màu chữ vốn đóng cứng ở đây, nên hàng nhóm ra chữ CAM-NÂU và nhóm con ra chữ XANH
          // DƯƠNG, trong khi tệp mẫu là đỏ gạch (theme5 tint -0.25) và xanh rêu (4F513E).
          // Người dùng mở tệp thật rồi chỉ ra đúng chỗ này.
          // Mặc định GIỮ NGUYÊN hai giá trị cũ ⇒ ba mẫu Gia Nguyễn không đổi một byte.
          fontColor: isSubSection
            ? (itemsCfg.subTextColor ?? "FF1F4E79")
            : (itemsCfg.sectionTextColor ?? "FF9A5B14"),
        });
      }
    } else if (it && effKind[i] === "info") {
      // Program-info line: free text in the Hạng Mục cell, no STT / qty / price / amount.
      if (cols.stt) ws.getCell(`${cols.stt}${r}`).value = null;
      if (cols.name) { setCell(ws, `${cols.name}${r}`, it.name || ""); ensureWrap(ws.getCell(`${cols.name}${r}`)); }
      for (const key of ["detail", "unit", "quantity", "days", "unitPrice", "amount"]) {
        if (cols[key]) ws.getCell(`${cols[key]}${r}`).value = null;
      }
      if (cols.notes) { setCell(ws, `${cols.notes}${r}`, it.notes || ""); ensureWrap(ws.getCell(`${cols.notes}${r}`)); }
      if (cols.name) {
        const nameCell = ws.getCell(`${cols.name}${r}`);
        datStyleRieng(nameCell, (st) => ({ font: { ...(st.font || {}), italic: true } }));
      }
    } else if (it) {
      const isSub = effKind[i] === "sub";
      if (!seenSection) looseAmtRows.push(r);   // mục lẻ (trước nhóm đầu) → cộng riêng vào subtotal
      const rawQty = Number(it.quantity) || 0;
      const qty = qtyForAmount(it);
      const days = Number(it.days) || 1;
      const price = Number(it.unitPrice) || 0;
      let amt;
      // Thành Tiền làm tròn về số nguyên (khớp web + dòng cộng = tổng). Nhân CHÍNH XÁC rồi mới làm
      // tròn (XLSX-06): double cho 15 × 4,1 = 61,4999… → 61 trong khi số đã lưu (Decimal) là 62.
      if (cols.days) {
        amt = nhanLamTronDong(qty, days, price);
        putNum(it, r, "days", cols.days, days);
      } else {
        amt = nhanLamTronDong(qty, price);
      }
      subtotal += amt * mult;
      // STT + Hạng Mục: only the group head writes them; sub-rows leave them blank,
      // then get covered by the vertical merge applied after this loop.
      if (isSub) {
        if (cols.stt) ws.getCell(`${cols.stt}${r}`).value = null;
        if (cols.name) ws.getCell(`${cols.name}${r}`).value = null;
      } else {
        // Bản BANNER: MỤC dưới nhóm con KHÔNG đánh số (số dồn cho nhóm con). Mặc định: đánh 1,2,3.
        if (numberSubs) { if (cols.stt) ws.getCell(`${cols.stt}${r}`).value = null; }
        else { itemNo++; if (cols.stt) setCell(ws, `${cols.stt}${r}`, itemNo); }
        // Multi-line text fields: keep newlines and enable wrapText
        if (cols.name) {
          setCell(ws, `${cols.name}${r}`, it.name || "");
          ensureWrap(ws.getCell(`${cols.name}${r}`));
        }
      }
      // Cột Chi Tiết đã bỏ khỏi bảng: không ghi dữ liệu; cuối vòng sẽ gộp vùng này vào Hạng Mục.
      if (cols.detail && !itemsCfg.removeDetail) {
        setCell(ws, `${cols.detail}${r}`, it.detail || "");
        ensureWrap(ws.getCell(`${cols.detail}${r}`));
      } else if (cols.detail) ws.getCell(`${cols.detail}${r}`).value = null;
      if (cols.unit) setCell(ws, `${cols.unit}${r}`, clean(it.unit));
      // Số Lượng: LÀM TRÒN còn 1 số (ROUND) — vẫn GIỮ công thức người dùng (bọc ROUND) để khách thấy;
      // số khớp Thành Tiền (=ROUND(SL×ĐG)). Số chẵn → không lẻ ("0"); có lẻ → đúng 1 số ("0.0").
      if (cols.quantity) {
        const qT = it.quantityExact ? qtyExact(qty) : qtyRound(qty);
        const rawQ = it.formulas && it.formulas.quantity;
        const fxQ = rawQ ? fctx.cellFormula(rawQ, rawQty, { item: it, field: "quantity" }) : null;
        const qCell = ws.getCell(`${cols.quantity}${r}`);
        if (fxQ) qCell.value = { formula: it.quantityExact ? fxQ : `ROUND(${fxQ},1)`, result: qT };
        else qCell.value = qT;
        // Định dạng hiển thị: số chẵn → "0" (không lẻ); có lẻ → "0.0" (đúng 1 số). PHẢI gán qua
        // bản sao style (giống paintCell) — gán cell.numFmt trực tiếp KHÔNG "ăn" trên hàng được
        // duplicateRow nhân bản (style dùng chung) → trước đây 7,70 in ra 8 ở các dòng phía sau.
        const qSt = qCell.style ? JSON.parse(JSON.stringify(qCell.style)) : {};
        qSt.numFmt = Number.isInteger(qT) ? "0" : (it.quantityExact ? "0.####" : "0.0");
        qCell.style = qSt;
      }
      putNum(it, r, "unitPrice", cols.unitPrice, price);
      if (cols.amount) {
        ws.getCell(`${cols.amount}${r}`).value = {
          formula: `ROUND(${itemsCfg.amountFormula(r)},0)`,   // Thành Tiền = làm tròn(SL×ĐG) số nguyên
          result: amt,
        };
      }
      if (cols.notes) {
        setCell(ws, `${cols.notes}${r}`, it.notes || "");
        ensureWrap(ws.getCell(`${cols.notes}${r}`));
      }
      // Apply italic style to specific columns (config: itemsCfg.italicColumns)
      if (itemsCfg.italicColumns) {
        for (const col of itemsCfg.italicColumns) {
          const cell = ws.getCell(`${col}${r}`);
          const f = cell.font ? { ...cell.font } : {};
          f.italic = true;
          cell.font = f;
        }
      }
    } else {
      // Blank slot
      for (const col of Object.values(cols)) {
        ws.getCell(`${col}${r}`).value = null;
      }
    }
    // Cột "HÌNH ẢNH": kẻ khung ô cho MỌI hàng trong bảng + nhúng ảnh của hạng mục (nếu có).
    // Ảnh giữ tỉ lệ, lưới 2 ảnh/hàng, editAs oneCell.
    // NỀN = ĐÚNG NỀN Ô GHI CHÚ CÙNG HÀNG, không tự tô theo loại hàng. Trước đây hàng nhóm con tô
    // subFill cho ô ảnh trong khi mẫu để TRẮNG ô Ghi Chú của hàng đó (tệp mẫu Colorfull người dùng
    // chỉnh: nhóm con chỉ tô C..H) → ô ảnh xanh lẻ loi cạnh ô Ghi Chú trắng. Chép nền cột cuối cũ thì
    // mẫu nào tô tới đâu, cột ảnh theo tới đó — GN lẫn Colorfull, nhóm lẫn nhóm con.
    if (imgCol && r != null) {
      const icell = ws.getCell(`${imgCol}${r}`);
      datVien(icell, { top: { style: "thin" }, left: { style: "thin" }, bottom: { style: "thin" }, right: { style: "medium" } });
      const nenCuoi = ws.getCell(`${(cols.notes || cols.amount) as string}${r}`).fill;
      if (nenCuoi && nenCuoi.type === "pattern" && nenCuoi.fgColor) {
        icell.fill = JSON.parse(JSON.stringify(nenCuoi));
      } else if (icell.fill) {
        icell.fill = { type: "pattern", pattern: "none" };
      }
      if (it && Array.isArray(it.images) && it.images.length) insertItemImages(ws, imgCol, r, it.images);
    }
  }

  // Cột Chi Tiết bị XÓA khỏi BẢNG (không ẩn): gộp toàn bộ bề rộng của nó vào Hạng Mục.
  // Vẫn giữ cột vật lý trong workbook để công thức báo giá cũ không bị dịch địa chỉ.
  if (itemsCfg.removeDetail && cols.name && cols.detail) {
    if (itemsCfg.headerRow) {
      ws.getCell(`${cols.detail}${itemsCfg.headerRow}`).value = null;
      mergeNameArea(ws, cols.name, cols.detail, itemsCfg.headerRow);
    }
    if (!items.length) {
      for (const r of slotRows) mergeNameArea(ws, cols.name, cols.detail, r);
    } else {
      for (let i = 0; i < items.length; i++) {
        if (effKind[i] === "sub") continue;
        let span = 1;
        if (effKind[i] === "head") while (i + span < items.length && effKind[i + span] === "sub") span++;
        const r1 = slotRows[i], r2 = slotRows[i + span - 1];
        if (r1 != null && r2 != null && r2 - r1 === span - 1) mergeNameArea(ws, cols.name, cols.detail, r1, r2);
      }
    }
  }

  // Vertical merges for "hàng con" groups. Khi Chi Tiết đã bỏ, Hạng Mục ở trên đã được gộp
  // thành hình chữ nhật C:D qua toàn bộ head+sub nên đây chỉ còn gộp STT.
  for (let i = 0; i < items.length; i++) {
    if (effKind[i] !== "head") continue;
    let span = 1;
    while (i + span < items.length && effKind[i + span] === "sub") span++;
    if (span <= 1) continue;
    const r1 = slotRows[i], r2 = slotRows[i + span - 1];
    if (r1 == null || r2 == null || r2 - r1 !== span - 1) continue;
    for (const col of [cols.stt, ...(itemsCfg.removeDetail ? [] : [cols.name])]) {
      if (!col) continue;
      // GỠ VÙNG GỘP CŨ CÒN SÓT TRONG SỔ TRƯỚC KHI GỘP (L47).
      // Mẫu Colorfull gộp sẵn C17:D17 cho ô "* Ghi chú". Báo giá dài hơn số khe thì `duplicateRow`
      // đẩy chữ xuống nhưng SỔ vùng gộp của ExcelJS vẫn giữ khoá "C17" (cùng bẫy đã ghi ở khối
      // footerMerges bên dưới) ⇒ `mergeCells("C16:C17")` ném "Cannot merge already merged cells",
      // `safeMerge` nuốt lỗi: STT gộp được mà Hạng Mục thì không — tệp gửi khách có ô tên hàng con
      // là một ô trống riêng, nạp lại thành hạng mục TÊN RỖNG. Trong vùng hạng mục không có vùng
      // gộp hợp lệ nào khác phủ cột này (dải thông tin ở trên, ô ghi chú dựng lại ở dưới), nên gỡ
      // mọi vùng chạm là an toàn.
      const ci = colLetterToIdx(col) + 1;
      unmergeOverlapping(ws, ci, r1, ci, r2);
      safeMerge(ws, `${col}${r1}:${col}${r2}`);
      const cell = ws.getCell(`${col}${r1}`);
      cell.alignment = { ...(cell.alignment || {}), vertical: "middle" };
    }
  }

  // Totals — positions based on actual last row (changes only when we splice/duplicate)
  const t = cfg.totals;
  const subtotalRow = actualLastRow + t.subtotal.rowOffset;

  // Hệ số nhóm lẻ → làm tròn tổng sheet TRƯỚC Discount/VAT, đúng thứ tự của src/money.ts (XLSX-07).
  if (coHeSoNhomLe) subtotal = Math.round(subtotal);

  // ── DISCOUNT RIÊNG CỦA SHEET ────────────────────────────────────────────────────────────────
  // Có Discount → khối tổng dài ra 2 hàng và VAT đổi gốc tính:
  //     Cộng → Discount (số ÂM) → Tổng Cộng (= Cộng + Discount) → VAT(Tổng Cộng) → Thành Tiền
  // Không có Discount → giữ NGUYÊN 3 hàng như cũ (Tổng Cộng → VAT → Thành Tiền), không chèn gì.
  // Kẹp vào [0, tổng sheet] đúng như computeQuoteTotals (src/money.ts) và shared/quote-math.ts —
  // ba chỗ này phải ra cùng một con số, nếu không file Excel nói khác cái đã lưu.
  const discountRaw = Math.round(Number(sheet?.discount) || 0);
  const discount = discountRaw > 0 ? Math.min(discountRaw, Math.max(0, Math.round(subtotal))) : 0;
  const vatRow0 = actualLastRow + t.vat.rowOffset;
  let discountRow: number | null = null;
  let netRow: number | null = null;
  let extraTotalsRows = 0;
  if (discount > 0 && t.discount) {
    // Nhân bản STYLE của hàng VAT gốc 2 lần rồi đẩy phần dưới xuống — hai hàng mới nằm NGAY DƯỚI
    // hàng "Cộng", nên style viền/nền của khối tổng liền mạch.
    ws.duplicateRow(vatRow0, 2, true);
    discountRow = subtotalRow + 1;
    netRow = subtotalRow + 2;
    extraTotalsRows = 2;
  }
  const vatRow = vatRow0 + extraTotalsRows;
  // Hàng mà VAT và Thành Tiền lấy làm gốc: "Tổng Cộng" khi có Discount, còn không thì chính "Cộng".
  const baseRow = netRow ?? subtotalRow;
  const netSubtotal = subtotal - discount;

  // When sections are present, a simple SUM(column) double-counts (mục con per-unit +
  // thành tiền nhóm), so write the computed value instead of a SUM formula.
  const hasSections = items.some((it: any) => it && (it.kind === "section" || it.kind === "subsection"));
  // Subtotal SỐNG: KHÔNG nhóm (hoặc có nhóm nhưng tắt ×SL → dòng nhóm trống) → SUM cột Thành Tiền;
  // có nhóm + bật ×SL → cộng các dòng NHÓM (đã ×SL) + mục lẻ, tránh double-count với mục con.
  let subtotalFormula: any = null;
  if (!hasSections || !showGroupSub) {
    subtotalFormula = t.subtotal.formula({ first: itemsCfg.firstRow, last: actualLastRow, subtotalRow });
  } else {
    const terms = [...groupAmtTerms, ...looseAmtRows.map((rr) => ({ row: rr, expr: `${cols.amount}${rr}` }))].sort((a, b) => a.row - b.row);
    if (terms.length) subtotalFormula = terms.map((x) => x.expr).join("+");
    // HỆ SỐ NHÓM LẺ (XLSX-07): ô nhóm = đơn giá × SL không làm tròn, nên Tổng Cộng thành 4.748.529,5
    // trong khi máy chủ (src/money.ts) làm tròn tổng sheet về số nguyên — giá trị ô khác số đã lưu, và
    // VAT = ROUND(Tổng Cộng × %) có thể lệch 1đ. Làm tròn ĐÚNG như máy chủ: ROUND tổng, không từng ô.
    // CHỈ khi có hệ số lẻ: SL nhóm nguyên thì tổng vốn nguyên, tệp (kể cả GN) giữ nguyên từng byte.
    if (coHeSoNhomLe && subtotalFormula) subtotalFormula = `ROUND(${subtotalFormula},0)`;
  }
  applyTotalsRow(ws, t.subtotal, subtotalRow, {
    // Có Discount thì hàng này chỉ còn là "Cộng" (chưa trừ) — nhãn "Tổng Cộng" chuyển xuống netRow.
    text: discountRow ? (t.subtotal.labelTextGross ? t.subtotal.labelTextGross(vatPct) : "Cộng")
                      : (t.subtotal.labelText ? t.subtotal.labelText(vatPct) : null),
    formula: subtotalFormula,
    result: subtotal,
    rawValue: subtotalFormula == null ? subtotal : null,
  });
  if (discountRow && netRow) {
    // Ghi số ÂM đúng như file khách đang dùng ("-3,000,000") → dòng Tổng Cộng là phép CỘNG,
    // nhìn vào cột là thấy ngay tiền đi đâu.
    applyTotalsRow(ws, t.discount, discountRow, {
      text: t.discount.labelText ? t.discount.labelText(vatPct) : "Discount",
      rawValue: -discount,
    });
    const vc = t.subtotal.valueCell;
    applyTotalsRow(ws, t.subtotal, netRow, {
      text: t.subtotal.labelText ? t.subtotal.labelText(vatPct) : "Tổng Cộng",
      formula: `${vc}${subtotalRow}+${vc}${discountRow}`,
      result: netSubtotal,
    });
  }
  // VAT làm tròn số nguyên (khớp tổng đã chốt ở server) — bọc ROUND để Excel cũng tính ra số nguyên.
  // Gốc tính là `baseRow`: có Discount thì VAT chạy trên số ĐÃ TRỪ.
  const vatAmt = Math.round(netSubtotal * vatPct / 100);
  applyTotalsRow(ws, t.vat, vatRow, {
    text: t.vat.labelText(vatPct),
    formula: `ROUND(${t.vat.formula({ subtotalRow: baseRow, vatPct })},0)`,
    result: vatAmt,
  });

  const totalRow = actualLastRow + t.total.rowOffset + extraTotalsRows;
  applyTotalsRow(ws, t.total, totalRow, {
    // `discountRow: null` là CỐ Ý: Discount đã bị trừ ở `baseRow` rồi, trừ lần nữa là trừ hai lần.
    text: t.total.labelText(vatPct),
    formula: t.total.formula({ subtotalRow: baseRow, vatRow, discountRow: null }),
    result: netSubtotal + vatAmt,   // = Tổng Cộng + VAT(đã tròn)
  });

  // ── BẬT CỘT ẢNH Ở MẪU CÓ KHUNG NƯỚNG SẴN (GN): CỘT CUỐI CŨ TRẢ CẠNH PHẢI DÀY VỀ NÉT MỎNG (L42) ──
  // Mẫu GN nướng khung ngoài vào tệp mẫu: cột Ghi chú mang viền PHẢI 'medium' ở mọi hàng từ tiêu
  // đề tới hạng mục cuối. Bật cột ảnh thì cột ảnh mới là cạnh phải của bảng (đã kẻ 'medium' ở trên),
  // còn nét dày ở Ghi chú thành MỘT VẠCH DÀY CHẠY DỌC GIỮA BẢNG — đo bằng Excel: I12 phải=DÀY,
  // J12 trái=DÀY. Colorfull không cần bước này: khung của nó dựng ở khối `outerFrame` ngay dưới và
  // đã lấy cột ảnh làm cột cuối. Chỉ hạ nét DÀY; nét mỏng/không viền giữ nguyên.
  if (imgCol && !itemsCfg.outerFrame && itemsCfg.headerRow) {
    const cotCu = (cols.notes || cols.amount) as string;
    for (let r = itemsCfg.headerRow; r <= actualLastRow; r++) {
      const o = ws.getCell(`${cotCu}${r}`);
      const phai = o.border?.right;
      if (phai && (phai.style === "medium" || phai.style === "thick" || phai.style === "double")) {
        datVien(o, { ...(o.border || {}), right: { ...phai, style: "thin" } });
      }
    }
  }

  // ── KHUNG NGOÀI DÀY CHO BẢNG (chỉ mẫu khai `items.outerFrame`) ──────────────────────────
  // Đo trên file xuất THẬT của Gia Nguyễn: hàng tiêu đề có viền TRÊN 'medium', và MỌI hàng của
  // bảng có viền TRÁI ở cột đầu + viền PHẢI ở cột cuối cũng 'medium' — tức bảng được đóng khung
  // dày ba cạnh, ruột thì 'thin'. Mẫu Colorfull không có: mọi viền đều 'thin', nên bảng trông
  // mỏng và trôi hơn hẳn khi đặt cạnh bản GN (người dùng chỉ ra đúng chỗ này).
  //
  // Làm ở ĐÂY chứ không nướng vào file mẫu, vì số hàng của bảng thay đổi theo từng báo giá (co
  // lại khi ít mục, nở thêm khi nhiều) — khung phải phủ đúng vùng THẬT sau khi đã dựng xong.
  // GN không khai khoá này (khung của nó nướng sẵn trong file mẫu) nên không đi qua đây.
  if (itemsCfg.outerFrame && cols.stt && itemsCfg.headerRow) {
    const DAY = { style: "medium" as const };
    const cotDau = cols.stt;
    // CỘT CUỐI CỦA BẢNG = cột HÌNH ẢNH khi sheet bật nó. Trước đây luôn lấy Ghi Chú, nên bật cột
    // ảnh thì cạnh phải 'medium' của khung kẻ ở Ghi Chú — tức MỘT VẠCH DÀY CHẠY DỌC GIỮA BẢNG,
    // còn cột ảnh nằm ngoài khung. Đo được: hàng hạng mục có I[phải=medium] trong khi J là cột ảnh.
    const cotCuoi = imgCol || cols.notes || cols.amount;
    const hangDau = itemsCfg.headerRow;
    // DỪNG Ở HÀNG HẠNG MỤC CUỐI, KHÔNG KÉO QUA KHỐI TỔNG.
    // Khối tổng chỉ chiếm ba cột (hộp nhãn + ô tiền), nên kéo khung xuống tới đó để lại hai vạch
    // dọc lơ lửng ở cột đầu và cột cuối cùng một ô rỗng có viền bên dưới bảng — người dùng chụp
    // màn hình chỉ ra đúng hai chỗ đó. Mẫu GN cũng dừng ở hàng cuối của bảng: các ô B..E của hàng
    // tổng bên đó KHÔNG có viền nào.
    const hangCuoi = actualLastRow;
    const dat = (addr: string, canh: "top" | "left" | "right" | "bottom") => {
      try {
        const o = ws.getCell(addr);
        // PHẢI NHÂN BẢN CẢ STYLE, không chỉ `border`. ExcelJS gộp các style giống nhau thành MỘT
        // đối tượng dùng chung cho nhiều ô, nên gán thẳng `o.border = {...}` làm viền LEM sang mọi
        // ô đang dùng chung style đó — đo được: đặt viền trái cho B4 thì C4 và D4 cũng dày lên.
        const st = JSON.parse(JSON.stringify(o.style || {}));
        st.border = { ...(st.border || {}), [canh]: DAY };
        o.style = st;
      } catch { /* ô không tồn tại */ }
    };
    // Cạnh TRÊN của hàng tiêu đề, chạy hết bề ngang bảng — gồm cả cột HÌNH ẢNH khi bật (ô tiêu đề
    // của nó lấy đỉnh theo ô tiêu đề cột cuối cũ, tức nét MỎNG của tệp mẫu Colorfull trước bước này).
    for (const L of [...(Object.values(cols) as string[]), ...(imgCol ? [imgCol] : [])]) dat(`${L}${hangDau}`, "top");
    // Cạnh TRÁI và PHẢI của BẢNG, từ hàng tiêu đề xuống hàng hạng mục cuối.
    for (let r = hangDau; r <= hangCuoi; r++) {
      dat(`${cotDau}${r}`, "left");
      if (cotCuoi) dat(`${cotCuoi}${r}`, "right");
    }
    // KHỐI TỔNG có khung riêng, cũng dày — đúng như mẫu GN: cạnh trái của hộp nhãn, cạnh phải của
    // ô tiền, và đáy của hàng cuối cùng ("Thành Tiền"). KHÔNG kẻ cạnh trên: khối tổng nằm liền
    // ngay dưới bảng nên cạnh trên của nó chính là đáy bảng.
    const nhan0 = (t.total?.labelCells?.[0]?.[0]) as string | undefined;
    const oTien = t.total?.valueCell as string | undefined;
    if (nhan0 && oTien) {
      const hangTongDau = actualLastRow + (t.subtotal?.rowOffset ?? 1);
      for (let r = hangTongDau; r <= totalRow; r++) {
        dat(`${nhan0}${r}`, "left");
        dat(`${oTien}${r}`, "right");
      }
      // ĐÁY KHỐI TỔNG PHẢI LIỀN MỘT NÉT, KHÔNG MỎNG Ở GIỮA.
      // Trước đây chỉ kẻ đáy cho ô nhãn ĐẦU và ô TIỀN, bỏ qua ô thứ hai của hộp nhãn — đáy ra
      // dày·MẢNH·dày. Đo đối chiếu với Gia Nguyễn (hàng "Thành Tiền"):
      //     GN   F:đáy dày   G:đáy dày   H:đáy dày
      //     CLF  F:đáy dày   G:đáy MẢNH  H:đáy dày   ← chỗ lệch
      // Người dùng yêu cầu "khung đậm nhạt học theo GN", nên kẻ đáy cho MỌI cột từ ô nhãn đầu
      // tới ô tiền. GN không đi qua nhánh này (`outerFrame` chỉ của Colorfull).
      for (let i = nhan0.charCodeAt(0); i <= oTien.charCodeAt(0); i++) {
        dat(`${String.fromCharCode(i)}${totalRow}`, "bottom");
      }
    }
  }

  // Footer merges (e.g. CLF "* Ghi chú" at C:D) ride the item splice/duplicate by
  // `shift` rows. ExcelJS spliceRows drops these merges, leaving the text duplicated
  // across both columns — recompute the shifted row, clear the secondary cells, re-merge.
  if (cfg.footerMerges) {
    const shift = (actualLastRow - originalLastItemRow) + extraTotalsRows;
    for (const range of cfg.footerMerges) {
      const m = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(range);
      if (!m) continue;
      const newRow = parseInt(m[2], 10) + shift;
      const startCol = m[1].charCodeAt(0), endCol = m[3].charCodeAt(0);
      // GIỮ CHỮ LẠI TRƯỚC KHI ĐỤNG VÀO Ô PHỤ — nếu không, dọn ô phụ là XOÁ luôn chữ.
      //
      // Đo trực tiếp trên `templates/CLF_KhongNgay.xlsx` (ô "* Ghi chú" gộp C17:D17):
      //   trước            C17="* Ghi chú: …"«C17   D17=…«C17   merges=["C17:D17"]
      //   duplicateRow(12,1,true):
      //                    C17=""   C18="* Ghi chú: …"«C18   D18=…«C18   merges=["C17:D17"]
      // Chữ dời đúng sang hàng 18 và D18 thành Ô PHỤ của C18, NHƯNG danh sách gộp của workbook vẫn
      // ghi C17:D17 — trạng thái mâu thuẫn. Hệ quả: `safeUnmerge("C18:D18")` không gỡ được gì (mô
      // hình không có vùng đó), rồi `getCell("D18").value = null` — mà trong ExcelJS, GÁN GIÁ TRỊ
      // CHO Ô PHỤ GHI XUYÊN SANG Ô CHỦ — nên chính dòng "dọn ô phụ" đã xoá trắng ô C18.
      //
      // Đo được trên file xuất thật: từ 8 hạng mục trở lên (vượt 7 khe hàng của mẫu CLF) thì khối
      // "* Ghi chú: - Tất cả các hạng mục trên là cho thuê…" BIẾN MẤT khỏi file gửi khách; dưới 7
      // hạng mục thì còn, vì lúc ấy bảng CO lại (spliceRows) chứ không nở.
      //
      // Cách chữa không phụ thuộc vào trạng thái gộp đang mâu thuẫn: đọc chữ ra, dọn, gộp lại, rồi
      // ghi chữ về đúng ô chủ. `footerMerges` hiện chỉ có ở nhánh Colorfull (templateConfigs.ts:
      // `clofull_decor` và hai bản kế thừa) — GN không đi qua đây.
      const oChinh = `${m[1]}${newRow}`;
      let chuGiuLai: unknown = null;
      try { chuGiuLai = ws.getCell(oChinh).value; } catch { /* mẫu không có ô đó */ }
      safeUnmerge(ws, `${m[1]}${newRow}:${m[3]}${newRow}`);
      for (let cc = startCol + 1; cc <= endCol; cc++) {
        try { ws.getCell(`${String.fromCharCode(cc)}${newRow}`).value = null; } catch {}
      }
      safeMerge(ws, `${m[1]}${newRow}:${m[3]}${newRow}`);
      // Ô "* GHI CHÚ" CỦA MẪU ĐI THEO Ô TÍCH CỦA NGƯỜI DÙNG.
      // Mẫu Colorfull nhúng cứng "* Ghi chú: - Tất cả các hạng mục trên là cho thuê…" vào ô này,
      // nên nó in ra MỌI báo giá kể cả khi người dùng KHÔNG bật "Thêm Ghi chú" ở màn soạn (đo trên
      // file thật: `quote.notes` = NULL mà ô C139 vẫn có chữ). Nay: có ghi chú thì in ghi chú của
      // người dùng vào đúng ô đó; không có thì để TRỐNG — giống hệt nếp của GN.
      if (cfg.noteFooterRange === range) {
        // GIỮ XUỐNG DÒNG NGƯỜI DÙNG GÕ. `clean()` gộp mọi xuống dòng thành DẤU CÁCH (xem chú thích
        // của nó) — đo được: ghi chú 5 dòng có gạch đầu dòng ra tệp chỉ còn 2 dòng, mọi gạch đầu
        // dòng dính liền nhau thành một khối chữ. Khối "Kính gửi" ngay trên đã cố ý KHÔNG dùng
        // `clean()` vì đúng lý do này; ô ghi chú thì bị bỏ sót.
        const ghiChu = String(quote.notes ?? "").trim();
        try {
          const oGC = ws.getCell(oChinh);
          oGC.value = ghiChu ? `* Ghi chú: 
${ghiChu}` : null;
          if (ghiChu) {
            ensureWrap(oGC);
            // Và NỚI CHIỀU CAO theo chữ: hàng này bị mẫu khoá cứng 61pt, ghi chú dài hơn ~4 dòng
            // là khách không đọc được phần còn lại.
            const fGC = fontDo(oChinh);
            const soDong = wrapLines(`* Ghi chú: 
${ghiChu}`, null, beRongVungGop(oChinh), fGC);
            const can = Math.min(409, Math.max(18, soDong * caoMotDongPt(fGC.co) + 3));
            const dangCo = ws.getRow(newRow).height;
            if (dangCo == null || can > dangCo) ws.getRow(newRow).height = can;
          }
        } catch { /* bỏ qua */ }
      } else if (chuGiuLai != null && chuGiuLai !== "") {
        try { ws.getCell(oChinh).value = chuGiuLai as never; } catch { /* bỏ qua */ }
      }
    }
  }

  // === Áp bảng màu mới + Ghi chú (chỉ template khai báo cfg.palette, vd GN) ===
  // GN_KhongNgay.xlsx mặc định header/tổng màu nâu đậm (chữ trắng) + nhóm xanh dương —
  // đè lại cho khớp mẫu: header/tổng peach, nhóm xanh lá, STT/Hạng Mục xanh dương, số
  // tiền tổng đen đậm, và in "Ghi chú" (quote.notes) vào ô cạnh phần tổng.
  if (pal) {
    const colVals = Object.values(cols);
    const valueCol = t.total.valueCell;

    // (a) Hàng tiêu đề cột → nền peach + chữ đen đậm (thay nền nâu/chữ trắng của mẫu).
    if (pal.headerFill && pal.headerRows) {
      for (const hr of pal.headerRows) {
        for (const col of colVals) {
          paintCell(ws.getCell(`${col}${hr}`), { fill: pal.headerFill, fontColor: "FF000000", bold: true });
        }
      }
    }

    // (b) STT + Hạng Mục của các hàng item (đầu nhóm) → chữ xanh dương đậm.
    if (pal.nameColor) {
      for (let i = 0; i < slotRows.length; i++) {
        if (!items[i] || effKind[i] !== "head") continue;
        for (const col of [cols.stt, cols.name]) {
          if (!col) continue;
          paintCell(ws.getCell(`${col}${slotRows[i]}`), { fontColor: pal.nameColor, bold: true });
        }
      }
    }

    // (c) 3 dòng tổng (Cộng/VAT/Thành Tiền + Giảm Giá nếu có) → nền peach, chữ đen đậm.
    if (pal.totalsFill || pal.totalsValueColor) {
      const totalRows = [subtotalRow, vatRow, totalRow];
      if (discountRow) totalRows.push(discountRow);
      if (netRow) totalRows.push(netRow);
      // chỉ tô các cột thuộc khối tổng (nhãn + giá trị) để không đè ô Ghi chú bên trái
      const tCols = new Set();
      for (const grp of [t.subtotal, t.vat, t.total]) {
        for (const [a, b] of (grp.labelCells || [])) {
          for (let cc = a.charCodeAt(0); cc <= b.charCodeAt(0); cc++) tCols.add(String.fromCharCode(cc));
        }
        if (grp.valueCell) tCols.add(grp.valueCell);
      }
      for (const tr of totalRows) {
        if (pal.totalsFill) {
          for (const col of tCols) {
            paintCell(ws.getCell(`${col}${tr}`), { fill: pal.totalsFill, fontColor: "FF000000", bold: true });
          }
        }
        if (pal.totalsValueColor) {
          paintCell(ws.getCell(`${valueCol}${tr}`), { fontColor: pal.totalsValueColor, bold: true });
        }
      }
    }

    // (d) Ghi chú: in quote.notes thành 1 dòng dưới phần tổng (merge ngang colFrom→colTo).
    //     Có ghi chú → "Ghi chú: <nội dung>" (nâu đỏ); không có → để trống.
    if (pal.note) {
      const nr = totalRow + (pal.note.rowOffset || 1);
      const c1 = `${pal.note.colFrom}${nr}`, c2 = `${pal.note.colTo}${nr}`;
      // KHÔNG merge: ExcelJS reset ô richText-đã-merge về canh giữa khi lưu. Để chữ tràn
      // trái tự nhiên (các ô C..I dòng này trống) → "Ghi chú:" canh trái đúng như mẫu.
      safeUnmerge(ws, `${c1}:${c2}`);
      const ncell = ws.getCell(c1);
      const note = (quote.notes == null ? "" : String(quote.notes)).trim();
      if (note) {
        // Chuỗi THƯỜNG + font nền nâu đậm (KHÔNG richText). RichText bị Excel render ĐEN
        // cho tới khi click vào ô; gán màu vào FONT NỀN của ô thì hiện nâu ngay khi mở file.
        const st = ncell.style ? JSON.parse(JSON.stringify(ncell.style)) : {};
        st.font = { name: "Times New Roman", family: 1, size: 11, bold: true, color: { argb: pal.note.color || "FF843C0C" } };
        st.alignment = { vertical: "middle", horizontal: "left", wrapText: false };
        ncell.style = st;
        ncell.value = `Ghi chú: ${note}`;
        ws.getRow(nr).height = Math.max(ws.getRow(nr).height || 0, 20);
      } else {
        ncell.value = null;
      }
    }

    // (e) Cuối báo giá (cân đối kiểu GN gốc): lời chào canh TRÁI (cột B:F) + "Ý Kiến Khách
    //     Hàng" canh giữa cột PHẢI (G:I) CÙNG hàng → chừa chỗ ký + đóng dấu.
    if (pal.footer) {
      const f = pal.footer;
      const ff = { name: "Times New Roman", family: 1, size: 11 };
      // Ghi 1 dòng vào dải [from..to] (merge ngang). Gán font/căn-lề qua style TRƯỚC value
      // vì font/alignment đơn lẻ không "ăn" trên ô đã merge.
      const writeMerged = (r: any, value: any, { bold, from, to, align }: { bold?: any; from?: any; to?: any; align?: any } = {}) => {
        const a = `${from || "B"}${r}`, b = `${to || "I"}${r}`;
        safeUnmerge(ws, `${a}:${b}`); safeMerge(ws, `${a}:${b}`);
        const cell = ws.getCell(a);
        const st = cell.style ? JSON.parse(JSON.stringify(cell.style)) : {};
        st.font = { ...ff, bold: !!bold };
        st.alignment = { horizontal: align || "center", vertical: "middle" };
        cell.style = st;
        // Cùng bộ lọc với `setCell`: khối này nhận quote.fromContact/fromTitle/fromPhone — chữ
        // người dùng gõ tự do. Không phải chống Excel tự chạy công thức (ô chuỗi trong .xlsx thì
        // Excel hiển thị nguyên văn), mà để MỌI đường ghi ô chữ ra file khách đi qua một luật:
        // chuỗi mở đầu bằng = + - @ khi được lưu-lại-thành-CSV hoặc dán sang Sheets mới thành lệnh.
        cell.value = neutralizeFormula(value);
      };
      // Lời chào ("Rất mong…" / "Trân trọng…") canh GIỮA trong cột trái (B:F) → cân đối.
      if (f.left) {
        const lr = totalRow + (f.rowOffset || 2);
        (f.left.lines || []).forEach((line: any, idx: any) =>
          writeMerged(lr + idx, line, { from: f.left.from, to: f.left.to, align: "center" }));
      }
      // "Ý Kiến Khách Hàng" canh giữa cột PHẢI, CÙNG hàng dòng lời chào đầu
      if (f.customer) {
        writeMerged(totalRow + (f.customer.rowOffset || 2), f.customer.text,
          { from: f.customer.from, to: f.customer.to, align: "center" });
      }
      // Chừa khoảng trống ký + đóng dấu (tên người gửi chỉ in khi sign.showSender)
      const s = f.sign;
      if (s) {
        const gapStart = totalRow + (s.gapRowOffset || 4);
        for (let i = 0; i < (s.gapRows || 4); i++) ws.getRow(gapStart + i).height = s.gapRowHeight || 20;
        if (s.showSender) {
          const courtesy = s.courtesyCell ? clean(ws.getCell(s.courtesyCell).value) : "";
          const name = [courtesy, clean(quote.fromContact)].filter(Boolean).join(" ");
          let nr = gapStart + (s.gapRows || 4);
          if (name) writeMerged(nr++, name, { bold: true });
          if (clean(quote.fromTitle)) writeMerged(nr++, clean(quote.fromTitle));
          if (clean(quote.fromPhone)) writeMerged(nr, clean(quote.fromPhone));
        }
      }
    }
  }

  // ── HÀNG TIÊU ĐỀ CỘT: NỚI THEO CHỮ ─────────────────────────────────────────────────────────
  // Hàng này giữ chiều cao NƯỚNG SẴN trong tệp mẫu, và ở Colorfull nó không đủ cho chính chữ của
  // mẫu: "THÀNH TIỀN " (Times New Roman 12 đậm, bật wrap) không vừa bề rộng cột nên Excel ngắt hai
  // dòng, cần 31,5pt (đo COM) mà hàng chỉ cao 25pt — cả hai dòng bị xén. Đo mọi ô của hàng theo cùng
  // bộ ước lượng với hàng hạng mục; ô không bật wrap chỉ chiếm một dòng. CHỈ NỚI RA, KHÔNG BÓP LẠI:
  // GN (33pt, chữ 10) đã đủ nên giữ nguyên. Đặt cuối cùng, sau mọi bước đổi nhãn/gộp ô/cột ảnh.
  if (itemsCfg.headerRow) {
    const hr = itemsCfg.headerRow;
    const gop = ((ws.model?.merges || []) as string[]).map((m) => /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(m)).filter(Boolean) as RegExpExecArray[];
    let can = 0;
    for (const L of new Set([...Object.values(cols) as string[], ...(imgCol ? [imgCol] : [])])) {
      const ci = colLetterToIdx(L);
      // Ô PHỤ của vùng gộp và ô ở cột bị ẩn: Excel không vẽ chữ của chúng.
      if (gop.some((m) => +m[2] <= hr && hr <= +m[4] && colLetterToIdx(m[1]) < ci && ci <= colLetterToIdx(m[3]))) continue;
      try {
        if (ws.getColumn(L).hidden) continue;
        const o = ws.getCell(`${L}${hr}`);
        const v = o.value;
        const chu = typeof v === "string" ? v : Array.isArray(v?.richText) ? v.richText.map((x: any) => x.text).join("") : "";
        if (!chu.trim()) continue;
        const f = fontDo(`${L}${hr}`);
        const soDong = o.alignment?.wrapText ? wrapLines(chu, L, beRongVungGop(`${L}${hr}`), f) : 1;
        can = Math.max(can, soDong > 1 ? soDong * caoMotDongPt(f.co) + 3 : caoMotDongPt(f.co));
      } catch { /* bỏ qua ô lạ */ }
    }
    const dangCo = ws.getRow(hr).height;
    if (can > 0 && dangCo != null && can > dangCo) ws.getRow(hr).height = Math.min(409, can);
  }

  return {
    subtotal,                       // "Cộng" — CHƯA trừ Discount
    discount,                       // đã kẹp vào [0, subtotal]
    netSubtotal,                    // "Tổng Cộng" của sheet = số nó đóng góp vào báo giá
    vat: vatAmt,
    total: netSubtotal + vatAmt,
    subtotalCell: `${t.subtotal.valueCell}${subtotalRow}`,
    // Ô chứa Discount (số ÂM) — sheet "Tổng Báo Giá" tham chiếu để dòng Discount ở đó SỐNG.
    discountCell: discountRow ? `${t.subtotal.valueCell}${discountRow}` : null,
    // Ô "Tổng Cộng" của sheet = số ĐÃ TRỪ Discount. Đây là con số sheet ĐÓNG GÓP vào báo giá,
    // nên sheet "Tổng Báo Giá" trỏ vào ĐÂY, không trỏ vào ô "Cộng".
    netCell: `${t.subtotal.valueCell}${baseRow}`,
  };
}

function applyTotalsRow(ws: any, rowCfg: any, row: any, { text, formula, result, rawValue }: { text?: any; formula?: any; result?: any; rawValue?: any }) {
  // Clear secondary cells in merge first (to avoid leftover duplicated values)
  for (const [colStart, colEnd] of (rowCfg.labelCells || [])) {
    if (colStart === colEnd) continue;
    // GỠ VÙNG GỘP CŨ CỦA MẪU TRƯỚC KHI GỘP LẠI THEO CẤU HÌNH.
    // Mẫu Colorfull gộp sẵn B:G cho ba hàng tổng. Khi `labelCells` trùng khít vùng đó thì không
    // sao — nhưng vừa thu nhãn về F:G (cho giống bản GN) thì `mergeCells("F16:G16")` chồng lên
    // vùng B16:G16 đang có, và ExcelJS XÉ nó thành hai vùng CHỒNG NHAU:
    //     B16:F16  +  F16:G16     ← trùng cột F
    // File ghi ra vẫn "thành công", nhưng mở lại là hỏng: đọc bằng ExcelJS ném "Cannot merge
    // already merged cells", và Excel báo tệp lỗi. Đo được trên chính file xuất.
    unmergeOverlapping(ws, colLetterToIdx(colStart) + 1, row, colLetterToIdx(colEnd) + 1, row);
    // ...VÀ GỠ THẲNG THEO VÙNG ĐÍCH. `unmergeOverlapping` đọc SỔ vùng gộp của ExcelJS, mà sổ đó
    // LỆCH khỏi trạng thái thật của ô sau `duplicateRow` (cùng bẫy đã gặp ở khối "* Ghi chú":
    // ô báo `isMerged` đúng, còn sổ vẫn ghi toạ độ CŨ). Hàng tổng cuối được dựng bằng duplicateRow
    // nên vùng B:G của mẫu không nằm trong sổ theo hàng mới → không gỡ được → `mergeCells` xé nó
    // thành B16:F16 + F16:G16 CHỒNG NHAU, và file mở lại là hỏng.
    safeUnmerge(ws, `${colStart}${row}:${colEnd}${row}`);
    // Clear cells from colStart+1 to colEnd
    const startCol = colStart.charCodeAt(0);
    const endCol = colEnd.charCodeAt(0);
    for (let c = startCol + 1; c <= endCol; c++) {
      try { ws.getCell(`${String.fromCharCode(c)}${row}`).value = null; } catch {}
    }
    safeMerge(ws, `${colStart}${row}:${colEnd}${row}`);
  }
  if (text != null && rowCfg.labelCells && rowCfg.labelCells.length) {
    const [colStart] = rowCfg.labelCells[0];
    ws.getCell(`${colStart}${row}`).value = text;
  }
  if (rowCfg.valueCell) {
    if (formula != null) ws.getCell(`${rowCfg.valueCell}${row}`).value = { formula, result };
    else if (rawValue != null) ws.getCell(`${rowCfg.valueCell}${row}`).value = rawValue;
  }
}

function uniqueSheetName(wb: any, name: any) {
  let base = (name || "Sheet").replace(/[[\]/\\?*:]/g, "").substring(0, 31);
  if (!base) base = "Sheet";
  let candidate = base;
  let i = 2;
  while (wb.getWorksheet(candidate)) {
    const suffix = ` (${i})`;
    candidate = base.substring(0, 31 - suffix.length) + suffix;
    i++;
  }
  return candidate;
}

function colLetter(n: number) {
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function deepClone(o: any) {
  if (o == null) return o;
  return JSON.parse(JSON.stringify(o));
}

/**
 * Copy a font object including ALL ExcelJS-supported properties.
 * Plain JSON clone misses properties exposed only via getters; this enumerates
 * the well-known keys so attributes like `family` and `scheme` survive cross-workbook copy.
 */
function cloneFont(srcFont: any) {
  if (!srcFont) return undefined;
  const keys = [
    "name", "size", "bold", "italic", "underline", "strike",
    "color", "family", "scheme", "charset", "vertAlign", "outline", "shadow"
  ];
  const out: Record<string, any> = {};
  for (const k of keys) {
    if (srcFont[k] !== undefined) {
      out[k] = (k === "color" && srcFont.color) ? { ...srcFont.color } : srcFont[k];
    }
  }
  // Default family=1 (roman/serif) when missing, so Excel doesn't substitute a fallback font
  // that loses Vietnamese diacritic glyphs.
  if (out.name && out.family === undefined) out.family = 1;
  return out;
}

function copyWorksheetToWorkbook(srcWs: any, dstWb: any, newName: any) {
  const dstWs = dstWb.addWorksheet(newName);

  // Column widths + styles
  const srcCols = srcWs.columns || [];
  for (let i = 0; i < srcCols.length; i++) {
    const sc = srcCols[i];
    if (!sc) continue;
    const dc = dstWs.getColumn(i + 1);
    if (sc.width != null) dc.width = sc.width;
    if (sc.hidden) dc.hidden = true;
  }

  // Rows + cells
  srcWs.eachRow({ includeEmpty: true }, (srcRow: any, rowNum: any) => {
    const dstRow = dstWs.getRow(rowNum);
    if (srcRow.height) dstRow.height = srcRow.height;
    if (srcRow.hidden) dstRow.hidden = true;
    srcRow.eachCell({ includeEmpty: true }, (srcCell: any, colNum: any) => {
      const dstCell = dstRow.getCell(colNum);
      // VALUE: preserve formulas + plain values + rich text
      if (srcCell.value != null) {
        if (typeof srcCell.value === "object" && srcCell.value.formula) {
          dstCell.value = { formula: srcCell.value.formula, result: srcCell.value.result };
        } else {
          dstCell.value = srcCell.value;
        }
      }
      // STYLE: set each property explicitly (style.* doesn't carry cross-workbook reliably).
      // Use cloneFont to preserve `family` attribute — required for Vietnamese diacritics to render.
      if (srcCell.font) dstCell.font = cloneFont(srcCell.font);
      if (srcCell.alignment) dstCell.alignment = deepClone(srcCell.alignment);
      if (srcCell.border) dstCell.border = deepClone(srcCell.border);
      if (srcCell.fill) dstCell.fill = deepClone(srcCell.fill);
      if (srcCell.numFmt) dstCell.numFmt = srcCell.numFmt;
      if (srcCell.protection) dstCell.protection = deepClone(srcCell.protection);
    });
  });

  // Merged cells
  const merges = srcWs._merges || {};
  for (const key of Object.keys(merges)) {
    const m = merges[key];
    if (!m) continue;
    const top = m.top ?? m.model?.top;
    const left = m.left ?? m.model?.left;
    const bottom = m.bottom ?? m.model?.bottom;
    const right = m.right ?? m.model?.right;
    if (top == null) continue;
    try {
      dstWs.mergeCells(`${colLetter(left)}${top}:${colLetter(right)}${bottom}`);
    } catch {}
  }

  // Images — workbook.media is indexed by imageId
  const images = srcWs.getImages ? srcWs.getImages() : [];
  for (const img of images) {
    const media = srcWs.workbook.media?.[img.imageId];
    if (!media || !media.buffer) continue;
    const imageId = dstWb.addImage({
      buffer: media.buffer,
      extension: media.extension || "png",
    });
    dstWs.addImage(imageId, img.range);
  }

  // Sheet view properties (page setup, default row height)
  if (srcWs.properties) {
    Object.assign(dstWs.properties, deepClone(srcWs.properties));
  }
  if (srcWs.pageSetup) {
    Object.assign(dstWs.pageSetup, deepClone(srcWs.pageSetup));
  }

  return dstWs;
}

async function buildSummaryBuffer(sheetTotals: any, quote: any, vatPct: any) {
  const wb = new ExcelJS.Workbook();
  wb.calcProperties.fullCalcOnLoad = true;
  (wb.calcProperties as any).forceFullCalc = true;
  (wb.calcProperties as any).calcMode = "auto";
  addSummarySheet(wb, sheetTotals, quote, vatPct);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function addSummarySheet(wb: any, sheetTotals: any, quote: any, vatPct: any) {
  const ws = wb.addWorksheet("Tổng Báo Giá");
  ws.columns = [
    { width: 6 },
    { width: 45 },
    { width: 22 },
  ];

  ws.mergeCells("A1:C1");
  ws.getCell("A1").value = `TỔNG BÁO GIÁ ${quote.quoteNumber || ""}`;
  ws.getCell("A1").font = { name: "Times New Roman", family: 1, size: 14, bold: true };
  ws.getCell("A1").alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(1).height = 26;

  ws.mergeCells("A2:C2");
  ws.getCell("A2").value = neutralizeFormula(quote.title || "");
  ws.getCell("A2").font = { name: "Times New Roman", family: 1, size: 11, italic: true };
  ws.getCell("A2").alignment = { horizontal: "center", vertical: "middle" };

  // Màu header + khối tổng sheet Tổng theo công ty: Gia Nguyễn = #f3c9a1; Colorfull (clofull) =
  // #F4CFB0, cùng màu hàng NHÓM của bảng màu Colorfull mới (người dùng chốt bằng ảnh chụp
  // 2026-09-23; trước đó là peach #FFCC99). Bộ nhập bỏ qua sheet này theo TIÊU ĐỀ (excelImport.ts
  // "TONG BAO GIA"), không theo màu — nên đổi màu ở đây không làm nó nhận nhầm hàng nhóm.
  const isClf = (quote.sheets || []).some((s: any) => String(s.template?.code || s.templateCode || "").startsWith("clofull"));
  const sumHeaderFill = isClf ? "FFF4CFB0" : "FFF3C9A1";
  const headerRow = 4;
  const headers = ["STT", "Hạng mục", "Thành tiền (VNĐ)"];
  headers.forEach((h: any, i: any) => {
    const cell = ws.getCell(headerRow, i + 1);
    cell.value = h;
    cell.font = { name: "Times New Roman", family: 1, size: 11, bold: true };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: sumHeaderFill } };
    cell.border = {
      top: { style: "medium" }, bottom: { style: "thin" },
      left: { style: i === 0 ? "medium" : "thin" },
      right: { style: i === headers.length - 1 ? "medium" : "thin" },
    };
  });

  // ── MỖI DÒNG LÀ SỐ ĐÃ TRỪ DISCOUNT CỦA SHEET ĐÓ ─────────────────────────────────────────────
  // Công thức trỏ vào ô "Tổng Cộng" của chính sheet (netCell) chứ không phải ô "Cộng": đây là con
  // số sheet ĐÓNG GÓP vào báo giá. Sheet nào không giảm giá thì netCell chính là ô "Tổng Cộng"
  // cũ, nên báo giá không có Discount ra file y HỆT bản trước.
  // KHÔNG có cột/dòng Discount ở đây — khoản giảm giá đã nằm trong khối tổng của từng tab sheet,
  // đưa lại lên đây chỉ khiến người đọc tưởng bị trừ hai lần.
  let subtotalAll = 0;
  sheetTotals.forEach((st: any, idx: any) => {
    const r = headerRow + 1 + idx;
    ws.getCell(r, 1).value = idx + 1;
    ws.getCell(r, 2).value = neutralizeFormula(st.name);
    const net = Number(st.netSubtotal ?? st.subtotal) || 0;
    const sheetRef = `'${String(st.name || "").replace(/'/g, "''")}'!${st.netCell || st.subtotalCell}`;
    ws.getCell(r, 3).value = { formula: sheetRef, result: net };
    ws.getCell(r, 3).numFmt = "#,##0";
    for (let c = 1; c <= 3; c++) {
      const cell = ws.getCell(r, c);
      cell.font = { name: "Times New Roman", family: 1, size: 11 };
      cell.alignment = { horizontal: c === 1 ? "center" : c === 3 ? "right" : "left", vertical: "middle" };
      cell.border = {
        top: { style: "thin" }, bottom: { style: "thin" },
        left: { style: c === 1 ? "medium" : "thin" },
        right: { style: c === 3 ? "medium" : "thin" },
      };
    }
    subtotalAll += net;
  });

  const totalsStart = headerRow + 1 + sheetTotals.length;
  // LUÔN tính "Tổng cộng" từ tổng các dòng ĐANG hiển thị (đều đã cắt Số Lượng + làm tròn Thành
  // Tiền, và đã trừ Discount) → khớp ĐÚNG các dòng ngay phía trên, tự nhất quán. money.ts cũng
  // cắt + làm tròn nên với báo giá đã lưu mới, số này == tổng đã lưu; báo giá CŨ (lưu theo Số
  // Lượng chưa cắt) cũng không còn lệch dòng-vs-tổng trong file Excel.
  const subtotalVal = subtotalAll;
  const vatVal = Math.round(subtotalVal * vatPct / 100);
  const grandTotal = subtotalVal + vatVal;
  const firstSheetRow = headerRow + 1;
  const lastSheetRow = headerRow + sheetTotals.length;
  const subtotalSummaryRow = totalsStart;
  const vatSummaryRow = totalsStart + 1;
  const totalRows: { label: string; value: number; formula?: string }[] = [
    { label: "Tổng cộng", value: subtotalVal, formula: sheetTotals.length ? `SUM(C${firstSheetRow}:C${lastSheetRow})` : "0" },
    { label: `VAT (${vatPct}%)`, value: vatVal, formula: `ROUND(C${subtotalSummaryRow}*${vatPct}%,0)` },
    { label: "Thành tiền", value: grandTotal, formula: `C${subtotalSummaryRow}+C${vatSummaryRow}` },
  ];
  totalRows.forEach((tr, i: any) => {
    const r = totalsStart + i;
    ws.mergeCells(r, 1, r, 2);
    const lblCell = ws.getCell(r, 1);
    lblCell.value = tr.label;
    lblCell.font = { name: "Times New Roman", family: 1, size: 11, bold: true };
    lblCell.alignment = { horizontal: "center", vertical: "middle" };
    lblCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: sumHeaderFill } };
    lblCell.border = {
      top: { style: "thin" },
      bottom: { style: i === totalRows.length - 1 ? "medium" : "thin" },
      left: { style: "medium" }, right: { style: "thin" },
    };
    const valCell = ws.getCell(r, 3);
    valCell.value = tr.formula ? { formula: tr.formula, result: tr.value } : tr.value;
    valCell.numFmt = "#,##0";
    valCell.font = { name: "Times New Roman", family: 1, size: 11, bold: true, color: { argb: "FFC00000" } };
    valCell.alignment = { horizontal: "right", vertical: "middle" };
    valCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: sumHeaderFill } };
    valCell.border = {
      top: { style: "thin" },
      bottom: { style: i === totalRows.length - 1 ? "medium" : "thin" },
      left: { style: "thin" }, right: { style: "medium" },
    };
  });
}

/**
 * Strip workbook-level "junk" that causes Excel to flag the file as needing repair:
 *  - External `definedNames` referencing other workbook files (`[3]DATA`, etc.)
 *  - Leftover external link references in `_workbook.definedNames`
 *  - Stale calculation chain etc.
 */
function scrubWorkbook(wb: any) {
  // ExcelJS stores defined names in NameManager. Its `.model` getter/setter accepts an
  // array of {name, ranges}. We filter out any name whose ranges include external-file
  // markers like '[4]DATA'!$I$12:$I$318 — those are leftover references from the original
  // .xls source that point to workbooks we don't have, causing Excel to mark the file
  // as needing repair on open.
  try {
    const dn = wb.definedNames;
    if (dn) {
      const model = Array.isArray(dn.model) ? dn.model : [];
      const cleaned = model.filter((d: any) => {
        const ranges = d?.ranges || [];
        return !ranges.some((r: any) => typeof r === "string" && /\[\d+\]/.test(r));
      });
      if (cleaned.length !== model.length) {
        dn.model = cleaned;
      }
    }
  } catch {}
  // Note: don't delete wb.calcProperties — ExcelJS xlsx writer reads it (fullCalcOnLoad)
}

/**
 * Renumber worksheet sheetIds sequentially (1..N) to match their position order.
 * Excel flags out-of-order sheetIds (e.g. 69, 1, 2 after cross-workbook copy) as needing repair.
 */
function renumberSheetIds(wb: any) {
  wb.worksheets.forEach((ws: any, i: any) => {
    try { ws.id = i + 1; } catch {}
  });
}

/**
 * Build each sheet as a complete standalone xlsx buffer, then stitch them together
 * at the OOXML/zip level. This preserves each template's original styling perfectly,
 * which cell-by-cell cross-workbook copying in ExcelJS does not.
 */
/** Trần cứng của Excel cho tên tab. */
const MAX_SHEET_NAME = 31;

/**
 * Cắt còn tối đa `max` đơn vị UTF-16 mà KHÔNG chẻ đôi cặp surrogate (L45).
 * Trần 31 của Excel đếm theo UTF-16, nên vẫn cắt theo đơn vị đó; chỉ bỏ nửa đầu của cặp surrogate
 * nếu nó đứng lẻ ở cuối. Bản cũ `.slice(0, 31)` để lại nửa đó với tên toàn emoji ('🎉'×20 → 15
 * emoji + 0xD83C), ghi ra XML UTF-8 thành U+FFFD: tab hiện '🎉…🎉�', dòng tên ở "Tổng Báo Giá" cũng vậy.
 */
function catDonViUtf16(s: string, max: number) {
  return s.slice(0, max).replace(/[\uD800-\uDBFF]$/, "");
}

/**
 * Tên tab Excel HỢP LỆ từ chuỗi người dùng gõ tự do.
 *
 * Setter `ws.name` của ExcelJS (node_modules/exceljs/lib/doc/worksheet.js:140-170) NÉM lỗi với
 * `* ? : \ / [ ]`, với dấu nháy đơn ở đầu/cuối, với chuỗi rỗng và với đúng chữ "History"; quá 31
 * ký tự thì nó chỉ cảnh báo rồi cắt TRONG BỘ NHỚ. `sheetSchema` phía validator chỉ có
 * `.max(120)` nên không chặn gì trong số đó.
 *
 * Hai hậu quả khác nhau, cả hai đều đã tái hiện (tests/excel-sheetname.test.js):
 *   1. Ký tự cấm → ném ngay → route xuất trả 500 tiếng Anh, người dùng KHÔNG xuất được file và
 *      không có manh mối nào chỉ về tên sheet. "Booth/Backdrop" là tên hoàn toàn bình thường.
 *   2. Quá 31 ký tự → KHÔNG báo gì. ExcelJS cắt trong bộ nhớ, nhưng `sheetNames` giữ tên THÔ và
 *      `xlsxStitcher.renameSheet` ghi đè `xl/workbook.xml` bằng chính tên thô đó → file tải về
 *      mở lên là Excel đòi "sửa chữa". Hỏng ÂM THẦM tệ hơn hỏng ồn ào.
 *
 * Lọc thay vì từ chối: người dùng đặt tên theo nghiệp vụ của họ, không theo luật OOXML. Đổi
 * `/` `:` thành khoảng trắng giữ nguyên ý nghĩa đọc được, còn ném lỗi thì chặn cả lần xuất.
 */
export function safeSheetName(raw: unknown, duPhong: string) {
  const s0 = String(raw ?? "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]/g, " ")   // ký tự điều khiển: XML 1.0 không cho, làm hỏng workbook.xml
    .replace(/[*?:/\\[\]]/g, " ")             // tập ký tự Excel cấm
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^'+|'+$/g, "")                   // nháy đơn đầu/cuối
    .trim();
  // Cắt 31 KHÔNG chẻ emoji (L45). Cắt có thể để lại khoảng trắng cuối — và cả dấu nháy đơn cuối
  // ("…x'y" cắt còn "…x'"), mà setter của ExcelJS NÉM với tên kết thúc bằng nháy ⇒ lọc lại lần nữa.
  const s = catDonViUtf16(s0, MAX_SHEET_NAME).trim().replace(/'+$/, "").trim();
  // So không phân biệt hoa/thường: Excel giữ chỗ "History" bất kể cách viết, dù ExcelJS chỉ chặn
  // đúng một cách viết.
  if (!s || s.toLowerCase() === "history") return duPhong.slice(0, MAX_SHEET_NAME);
  return s;
}

export async function buildQuoteBuffer(quote: any) {
  const sheets = (quote.sheets || []).slice().sort((a: any, b: any) => (a.order || 0) - (b.order || 0));
  if (sheets.length === 0) {
    throw new Error("Báo giá phải có ít nhất 1 sheet");
  }
  const vatPct = Number(quote.vatPercent) || 0;

  const sheetBuffers: Buffer[] = [];
  const sheetNames: string[] = [];
  const sheetTotals: { name: string; subtotal: number; discount: number; netSubtotal: number; vat: number; total: number; subtotalCell: string; discountCell: string | null }[] = [];
  // Excel ĐỐI CHIẾU TÊN TAB KHÔNG PHÂN BIỆT HOA/THƯỜNG (exceljs/lib/doc/worksheet.js:168 dùng
  // `.toLowerCase()`). Set phân biệt hoa/thường sẽ cho "Booth" và "booth" cùng lọt rồi ném ở setter.
  const usedNames = new Set<string>();
  const uniq = (name: string) => {
    let n = name, i = 2;
    while (usedNames.has(n.toLowerCase())) {
      const hau = ` (${i++})`;
      // Cắt lại SAU khi nối hậu tố. Bản cũ nối vào tên ĐÃ cắt 31 nên kết quả vượt trần trở lại.
      n = `${catDonViUtf16(name, MAX_SHEET_NAME - hau.length).trim()}${hau}`;   // không chẻ emoji (L45)
    }
    usedNames.add(n.toLowerCase());
    return n;
  };

  for (let idx = 0; idx < sheets.length; idx++) {
    const sheet = sheets[idx];
    const tplCode = sheet.template?.code || sheet.templateCode;
    if (!tplCode) throw new Error(`Sheet thứ ${idx + 1} chưa có template`);
    const cfg = getConfig(tplCode);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(templateBuffer(cfg.filePath));   // cached bytes, no disk IO
    scrubWorkbook(wb);
    const ws = wb.getWorksheet(cfg.sheetName) || wb.worksheets[0];

    // Tiêu đề từng sheet nối tên sheet ("… - Banner") — áp dụng CẢ khi chỉ 1 sheet.
    const totals = fillSheetData(ws, cfg, quote, sheet, vatPct, (sheet.name || "").trim(), idx, sheets.length);
    stampTemplateMarker(ws, tplCode);

    // Tên tab Excel: chỉ đánh số "N. …" khi báo giá có NHIỀU sheet (1 sheet giữ nguyên).
    // CẢ HAI nhánh đều phải đi qua safeSheetName. Bản cũ chỉ lọc ở nhánh nhiều-sheet, nên một báo
    // giá MỘT sheet tên "Booth/Backdrop" là 500 và không xuất được file.
    const duPhong = `Sheet ${idx + 1}`;
    const baseName = safeSheetName(sheet.name || cfg.sheetName, duPhong);
    const displayName = uniq(sheets.length > 1 ? safeSheetName(`${idx + 1}. ${baseName}`, duPhong) : baseName);
    ws.name = displayName;

    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    sheetBuffers.push(buf);
    sheetNames.push(displayName);
    sheetTotals.push({ name: displayName, ...totals });
  }

  // Cross-sheet summary worksheet — only when the quote opts to show totals.
  if (quote.showTotals !== false) {
    const summaryName = uniq("Tổng Báo Giá");
    const summaryBuf = await buildSummaryBuffer(sheetTotals, quote, vatPct);
    sheetBuffers.push(summaryBuf);
    sheetNames.push(summaryName);
  }

  // Stitch all into one xlsx
  return stitchXlsxBuffers(sheetBuffers, sheetNames);
}

