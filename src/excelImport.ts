// ĐỌC NGƯỢC file Excel báo giá → dữ liệu lưới của app (ngược với src/excel.ts).
//
// Dùng cho: xuất báo giá gửi khách → khách sửa trong Excel → gửi lại → NẠP THẲNG vào báo giá,
// khỏi gõ tay/copy-paste. Cũng nạp được file NGOÀI (không do app xuất) miễn có hàng tiêu đề.
//
// Bốn thứ phải "hiểu" cho đúng:
//   1. CỘT NÀO LÀ GÌ  → dò HÀNG TIÊU ĐỀ ("STT | Hạng Mục | ĐVT | SỐ LƯỢNG | ĐƠN GIÁ | THÀNH TIỀN |
//      Ghi Chú") rồi map theo TÊN CỘT, KHÔNG bám vị trí cứng → khách chèn/xoá cột vẫn đúng.
//   2. NHÓM / NHÓM CON / HÀNG CON → theo MÀU NỀN (app tô cố định lúc xuất) + ô GỘP DỌC (hàng con)
//      + hình dạng dòng (STT chữ A/B, không ĐVT…). Màu là dấu hiệu chắc nhất với file app xuất ra.
//   3. CÔNG THỨC THAM CHIẾU Ô → dịch "=G13*F13" sang hệ toạ độ EDITOR, dạng canonical
//      "{unitPrice:2}*{quantity:2}" (theo TÊN FIELD + dòng) rồi web đổi sang chữ cột của lưới đích
//      → KHÔNG LỆCH Ô, kể cả khi mẫu đích khác (có/không cột Chi Tiết, có/không Số Ngày).
//   4. MẪU (template) NÀO → đoán theo cột Số Ngày, cách đánh số nhóm con, tên sheet, màu nhóm.
//
// AN TOÀN LÀ TRÊN HẾT (đây là tiền của khách): mọi công thức dịch xong đều được TỰ KIỂM lại bằng
// chính con số Excel đã tính sẵn trong file. Lệch → BỎ công thức, giữ CON SỐ + ghi cảnh báo.
// Không có gì bị nạp âm thầm: mọi nghi ngờ đều đẩy lên danh sách cảnh báo cho người dùng xem.

import ExcelJS from "exceljs";
import { TEMPLATE_CONFIGS } from "./templateConfigs.js";
import { excelFormulaToEditor, unwrapRound, evalEditorFormula } from "./quoteFormula.js";
import { nhanLamTronDong } from "./tienDong.js";

// ===== Kiểu dữ liệu trả về =====
export type ImportedKind = "item" | "sub" | "section" | "subsection" | "info";

export type ImportedItem = {
  kind: ImportedKind;
  label?: string;
  name: string;
  detail?: string;
  unit?: string;
  quantity: number;
  quantityExact?: boolean;
  unitPrice: number;
  days?: number | null;
  notes?: string;
  internalNote?: string;
  /** Công thức dạng canonical "{field:row}" — web đổi sang chữ cột lưới đích (lib/importApply.ts). */
  formulas?: Record<string, string>;
  /** Hàng trong file Excel (để đối chiếu khi xem trước). */
  row: number;
  /** Cảnh báo riêng dòng này (công thức bị bỏ, Thành Tiền lệch…). */
  warn?: string[];
};

export type ImportedSheet = {
  index: number;
  name: string;
  /** Có giá trị = sheet bị BỎ QUA (vd sheet "Tổng Báo Giá" hoặc không tìm ra bảng). */
  skipped?: string;
  headerRow?: number;
  firstRow?: number;
  lastRow?: number;
  /** field → chữ cột Excel, để hiện cho người dùng thấy "app hiểu cột nào là gì". */
  columns?: Record<string, string>;
  templateCode?: string | null;
  templateName?: string | null;
  templateWhy?: string;
  hasDays: boolean;
  numberSubs: boolean;
  groupSubtotal: boolean;
  showImages: boolean;
  items: ImportedItem[];
  totals?: { subtotal?: number | null; vatPercent?: number | null; vat?: number | null; discount?: number | null; total?: number | null };
  /** File do CHÍNH app xuất ra (có mã mẫu nhúng ở ô A1) — xem bocTienToThuTu(). */
  fromApp?: boolean;
  warnings: string[];
  stats: { rows: number; items: number; sections: number; subsections: number; subs: number; infos: number; formulas: number; formulasDropped: number };
};

export type ImportResult = { sheets: ImportedSheet[]; warnings: string[] };

// ===== Tiện ích chung =====

/** Chuẩn hoá chữ tiêu đề: bỏ dấu, bỏ phần trong ngoặc, bỏ xuống dòng → "SỐ LƯỢNG" = "SO LUONG". */
function normHdr(s: unknown): string {
  return String(s ?? "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[\r\n]+/g, " ")
    .normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d")
    .toUpperCase().replace(/[^A-Z ]/g, "").replace(/\s+/g, " ").trim();
}

/** Tên cột trong file → vai trò. GIỮ KHỚP với HEADER_ROLE ở web/src/lib/clipboard.ts (dán tay). */
const HEADER_ROLE: Record<string, string> = {
  "STT": "_stt", "TT": "_stt", "NO": "_stt",
  "HANG MUC": "name", "NOI DUNG": "name", "TEN HANG MUC": "name", "MO TA": "name", "DIEN GIAI": "name",
  "CHI TIET": "detail",
  "DVT": "unit", "DON VI": "unit", "DON VI TINH": "unit", "UNIT": "unit",
  "SO LUONG": "quantity", "SL": "quantity", "QTY": "quantity", "QUANTITY": "quantity",
  "SO NGAY": "days", "NGAY": "days", "DAYS": "days",
  "DON GIA": "unitPrice", "GIA": "unitPrice", "UNIT PRICE": "unitPrice", "PRICE": "unitPrice",
  "THANH TIEN": "_amount", "AMOUNT": "_amount",
  "GHI CHU": "notes", "NOTES": "notes", "NOTE": "notes", "REMARK": "notes",
  "GHI CHU NOI BO": "internalNote",
  "HINH ANH": "_images", "IMAGE": "_images", "IMAGES": "_images",
};

/** Màu nền hàng NHÓM / NHÓM CON do app tô lúc xuất (excel.ts) — dấu hiệu chắc nhất.
 *
 * ── VÌ SAO SINH RA TỪ `TEMPLATE_CONFIGS` CHỨ KHÔNG CHÉP TAY ────────────────────────────────
 * Hai tập này từng là hằng số chép tay, và đã LỆCH một lần: đổi màu nhóm của Colorfull sang
 * F6D479 / D5DDA2 trong `templateConfigs.ts` mà quên sửa ở đây. Đo được hậu quả:
 *   khách mở tệp, gõ SỐ đè lên ô Đơn Giá của hàng NHÓM CON (phá `=SUM(...)`) rồi gửi lại
 *   → bộ nhập không còn nhận ra màu nên xếp hàng đó thành HẠNG MỤC THẬT
 *   → đơn giá của nó (vốn là TỔNG các mục con) bị cộng LẦN THỨ HAI: 1.200.000 thay vì 800.000.
 * App chỉ kêu "tổng lệch với số ghi trong file", không một chữ nào nói cấu trúc nhóm đã sai —
 * nên người dùng đọc ra thành "khách sửa số". Sinh từ cấu hình thì đổi màu là hai đầu tự khớp.
 *
 * Những mã CHÉP TAY bên dưới là màu của các bản đã phát hành TRƯỚC: tệp khách đang giữ trong hộp
 * thư vẫn mang màu cũ, nạp lại phải còn nhận ra. Đừng dọn.
 */
const mauTuCauHinh = (khoa: "sectionFill" | "subFill") =>
  Object.values(TEMPLATE_CONFIGS as Record<string, any>)
    .flatMap((t) => [t?.items?.[khoa], t?.palette?.[khoa]])
    .filter((v): v is string => typeof v === "string" && /^[0-9A-Fa-f]{8}$/.test(v))
    .map((v) => v.toUpperCase());
const FILL_SECTION = new Set(["FFFAE9DB", "FFFCEFDB", "FFE2EFDA", "FFF6D479", ...mauTuCauHinh("sectionFill")]);
const FILL_SUB = new Set(["FFC9D9EF", "FFEAF1FB", "FFD5DDA2", ...mauTuCauHinh("subFill")]);
/** Màu nền hàng TIÊU ĐỀ CỘT — phụ trợ khi nhận diện hàng tiêu đề. */
const FILL_HEADER = new Set(["FFF3C9A1", "FFFFCC99"]);
const TEMPLATE_MARKER_PREFIX = "__QUANLY_TEMPLATE__:";

/** Chữ mở đầu các dòng TỔNG / chân trang → hết bảng hạng mục. */
const RE_TOTALS = /^(TONG CONG|TONG|CONG|VAT|THANH TIEN|GIAM GIA|CHIET KHAU|DISCOUNT|TOTAL|SUBTOTAL|SUB TOTAL|GRAND TOTAL)\b/;
const RE_FOOTER = /^(GHI CHU|RAT MONG|TRAN TRONG|Y KIEN KHACH HANG|NGUOI LAP|DAI DIEN|XAC NHAN|KY TEN)\b/;

function colLetter(n: number) {
  let s = "";
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
function colIndex(L: string) { let n = 0; for (const ch of String(L).toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64); return n; }

/** Toạ độ ô CHỦ của vùng gộp: .d.ts của ExcelJS khai string còn runtime trả number → nhận cả hai. */
function coordNum(v: unknown, isCol: boolean): number {
  if (typeof v === "number") return v;
  const s = String(v ?? "").trim();
  if (/^\d+$/.test(s)) return Number(s);
  return isCol && /^[A-Za-z]+$/.test(s) ? colIndex(s) : NaN;
}

// ===== TRẦN AN TOÀN (file 10MB nén cao có thể bung ra hàng triệu ô) =====
// Đọc xlsx chạy đồng bộ trên event loop → phải tự chặn, không để 1 request treo cả server.
const MAX_SHEETS = 30;          // số sheet đọc trong 1 file
// Quét HẾT bảng dù dài bao nhiêu — trần này chỉ là chốt chặn file hỏng/chạy loạn (Excel tối đa
// ~1.048.576 dòng), báo giá thật không bao giờ chạm tới. KHÔNG dùng để cắt bớt hạng mục.
const MAX_SCAN_ROWS = 200_000;
const MAX_HEADER_SCAN = 200;    // số hàng dò tìm hàng tiêu đề
const MAX_SCAN_COLS = 60;
/**
 * Trần dòng/sheet khi LƯU — PHẢI khớp `sheetSchema.items.max()` trong src/validators.ts.
 *
 * TRƯỚC 2026-09-16 hằng số này là 2000 trong khi trần lưu thật là 1000. Hai hậu quả, cả hai đã đo:
 * (a) sheet 1.001–2.000 dòng KHÔNG nhận được cảnh báo nào ở bước xem trước rồi ăn lỗi 400 lúc bấm
 * Lưu — người dùng đối chiếu cả file xong mới biết; (b) đây là con số app TỰ NÓI với người dùng mà
 * không đúng sự thật. web/src/components/ImportExcelModal.tsx:14 đã dùng 1000 từ trước, nên hai đầu
 * đang khai hai con số khác nhau.
 */
export const MAX_ITEMS_PER_SHEET = 1000;

/**
 * TRẦN TỔNG HẠNG MỤC CHO CẢ MỘT FILE — chốt chặn BỘ NHỚ, không phải chốt nghiệp vụ.
 *
 * ĐÃ TÁI HIỆN được sập tiến trình: một file .xlsx 4,1 MB (DƯỚI trần upload 10 MB) chứa 2 sheet ×
 * 200.000 dòng làm LUỒNG CHÍNH chết với `FATAL ERROR: Reached heap limit`, exit 134 — ngã đúng
 * lúc GIẢI structured-clone kết quả từ worker (`v8::ValueDeserializer::ReadValue`). Chuỗi khuếch
 * đại: worker phân tích xong → `postMessage` clone TOÀN BỘ sang luồng chính → `res.json` lại
 * `JSON.stringify` thành một chuỗi nữa. Trần heap của app ở production là 1024 MB
 * (docker-compose.prod.yml: NODE_OPTIONS --max-old-space-size=1024).
 *
 * `MAX_SCAN_ROWS` KHÔNG đỡ được: nó là trần QUÉT mỗi sheet (200.000), nhân `MAX_SHEETS` (30) ra
 * 6.000.000 hạng mục — trần trên giấy, không phải trần thật.
 *
 * 30.000 = MAX_SHEETS × MAX_ITEMS_PER_SHEET: đúng bằng lượng TỐI ĐA đường lưu có thể nhận từ một
 * file, nên trần này không cắt mất thứ gì vốn lưu được.
 */
export const MAX_IMPORT_TOTAL_ITEMS = MAX_SHEETS * MAX_ITEMS_PER_SHEET;

/** Giá trị ô (mọi kiểu ExcelJS) → chuỗi hiển thị. */
function cellText(v: unknown): string {
  if (v == null) return "";
  // Ô CHỮ do app xuất ra có thể được thêm dấu ' ở đầu để Excel không hiểu nhầm là công thức
  // (neutralizeFormula ở excel.ts). Đọc ngược phải BÓC ra, nếu không mỗi vòng xuất→nhập lại
  // cộng thêm một dấu nháy vào tên hạng mục.
  // Lookahead phải KHỚP ĐÚNG regex của phía xuất — kể cả nhánh có khoảng trắng đứng trước
  // (`"' =SUM(...)"`). Lệch một nhánh là dấu nháy cộng dồn qua mỗi vòng xuất→nhập.
  if (typeof v === "string") return v.replace(/^'(?=[\t\r]|\s*[=+\-@])/, "");
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const o = v as Record<string, unknown>;
  if (Array.isArray(o.richText)) return (o.richText as { text?: string }[]).map((r) => r.text || "").join("");
  if (o.formula !== undefined || o.sharedFormula !== undefined) return cellText(o.result);
  if (typeof o.text === "string") return o.text;
  return "";
}

// Số kiểu VN/US — PORT từ web/src/lib/clipboard.ts (giữ khớp hành vi dán tay).
//
// GIỮ KHỚP MỌI MẢNH của clipboard.ts: tachNgoacKeToan (GRID-13), boPhanTram (L15), suyQuyUocSo + parseTheoQuyUoc.
// Trước soát toàn diện L51 bản port dừng ở hai hàm đầu: dán vào lưới đọc "(500.000)" = −500.000 và
// SL "1.500" (bảng quy ước VN) = 1500, còn nạp CÙNG dữ liệu từ tệp (ô định dạng Text) ra +500.000 và
// 1,5 — chiết khấu thành khoản CỘNG mà không một cảnh báo dòng nào (Đơn Giá lẫn Thành Tiền cùng sai dấu).

// Số âm kiểu KẾ TOÁN: định dạng Accounting hiện "(1.500.000)" thay vì "-1.500.000". Ngoặc bao TRỌN giá
// trị thì đảo dấu (bộ lọc ký tự bên dưới bỏ ngoặc, không có bước này là số âm thành DƯƠNG). Phần TRONG
// ngoặc phải là SỐ thuần: Đơn Giá chữ "(Tạm tính) 500.000 (chưa VAT)" cũng mở "(" đóng ")" nhưng là hai
// chú thích — bản trước nạp thành −500.000, không cảnh báo (soát toàn diện đợt 3). Chữ tiền được gỡ gồm cả
// "đồng" / "dong" / "US$" — thiếu thì "(1.500.000 đồng)" nạp +1.500.000 (phản biện đợt 3).
const AM_KE_TOAN = /^\((.*)\)$/;
const SO_TRONG_NGOAC = /^[\s\d.,%-]*\d[\s\d.,%-]*$/;
const tachNgoacKeToan = (s: string): { s: string; am: boolean } => {
  const t = String(s).trim().replace(/\s*[₫đ$]$|^[₫đ$]\s*/gi, "").trim();
  const m = AM_KE_TOAN.exec(t);
  return m && SO_TRONG_NGOAC.test(m[1].replace(/vnđ|vnd|usd|us\$|đồng|dong|[₫đ$]/gi, "")) ? { s: m[1], am: true } : { s: String(s), am: false };
};

// PHẦN TRĂM (PORT boPhanTram, soát toàn diện L15): ô CHỮ "10%" ở cột SL/Đơn Giá — bộ lọc ký tự bỏ "%"
// nên trước đây nạp thành 10, "Phí quản lý 10% × 50.000.000" ra 500.000.000. Dán vào lưới đã đọc 0,1
// từ b98716d. Chỉ nhận "%" đứng CUỐI một chuỗi toàn số: "10% VAT" vẫn đọc như cũ. (Ô SỐ định dạng %
// trong xlsx vốn đã là 0,1 — không đi qua nhánh chữ.)
const PHAN_TRAM = /^-?[\d.,\s]*\d[\d.,\s]*%$/;
const boPhanTram = (s: string): string | null => { const t = String(s ?? "").trim(); return PHAN_TRAM.test(t) ? t.slice(0, -1) : null; };
const chia100 = (n: number) => Number((n / 100).toPrecision(12));

// CHỮ SỐ DÍNH SAU CHỮ CÁI (PORT boCumChuSo, soát toàn diện đợt 3 L17): ô chữ SL "12 m2" từng nạp 122,
// Đơn Giá "95.000đ/m2" nạp 95,0002 — bộ lọc ký tự bỏ chữ mà giữ chữ số của "m2". Cụm có chữ cái ĐỨNG
// TRƯỚC chữ số bị bỏ cả cụm; chữ đứng SAU số ("95.000đ", "10bộ") vẫn là đơn vị. Tiền tố "x" / mã tiền viết
// liền ở ĐẦU ô ("x2", "VNĐ1.500.000") được gỡ trước, không bị bỏ cả cụm (phản biện đợt 3).
const TIEN_TO_SO = /^(?:vnđ|vnd|usd|đ|x)(?=\d)/iu;
const boCumChuSo = (s: string) => String(s ?? "").trim().replace(TIEN_TO_SO, "").replace(/[\p{L}\d.,]+/gu, (m) => (/\p{L}[.,]?\d/u.test(m) ? " " : m));

function parseLooseNumber(s: string): number {
  const kt = tachNgoacKeToan(s);
  if (kt.am) { const n = parseLooseNumber(kt.s); return n ? -Math.abs(n) : 0; }
  const pt = boPhanTram(s); if (pt != null) return chia100(parseLooseNumber(pt));
  let str = boCumChuSo(s).trim().replace(/[^\d.,-]/g, "");
  if (!str || str === "-") return 0;
  if (str.includes(",") && str.includes(".")) {
    str = str.lastIndexOf(",") > str.lastIndexOf(".") ? str.replace(/\./g, "").replace(",", ".") : str.replace(/,/g, "");
  } else if (str.includes(",")) {
    const p = str.split(",");
    str = (p.length === 2 && p[1].length <= 2) ? p[0] + "." + p[1] : str.replace(/,/g, "");
  } else if ((str.match(/\./g) || []).length > 1) {
    str = str.replace(/\./g, "");
  } else if (/^-?\d{1,3}(\.\d{3})+$/.test(str)) {
    str = str.replace(/\./g, "");
  }
  return Number(str) || 0;
}
/** Cột SỐ LƯỢNG / SỐ NGÀY là SỐ ĐO NHỎ: 1 dấu chấm/phẩy = THẬP PHÂN (13.5 ≠ 13500). */
function parseLooseDecimal(s: string): number {
  const kt = tachNgoacKeToan(s);
  if (kt.am) { const n = parseLooseDecimal(kt.s); return n ? -Math.abs(n) : 0; }
  const pt = boPhanTram(s); if (pt != null) return chia100(parseLooseDecimal(pt));
  let str = boCumChuSo(s).trim().replace(/[^\d.,-]/g, "");
  if (!str || str === "-") return 0;
  const neg = str.startsWith("-"); str = str.replace(/-/g, "");
  const dots = (str.match(/\./g) || []).length, commas = (str.match(/,/g) || []).length;
  if (dots && commas) str = str.lastIndexOf(",") > str.lastIndexOf(".") ? str.replace(/\./g, "").replace(",", ".") : str.replace(/,/g, "");
  else if (dots + commas > 1) str = str.replace(/[.,]/g, "");
  else str = str.replace(",", ".");
  const n = Number(str) || 0;
  return neg ? -n : n;
}

/**
 * QUY ƯỚC SỐ của cả bảng, suy từ những ô số dạng CHỮ không mơ hồ (PORT suyQuyUocSo). "1.500" đứng
 * riêng thì mơ hồ (1500 cái máy VN hay 1,5 m² máy US), nhưng bảng thường có ô rõ ràng: "1.500.000"
 * (≥ 2 nhóm nghìn) / "1.234,5" → VN; "1,500,000" / "1,234.5" → US; ở cột TIỀN, một nhóm "250.000"
 * đã là nghìn VN (tiền VND không có 3 số lẻ). Không tín hiệu hoặc hai phía mâu thuẫn → null: giữ
 * cách đọc cũ (SL/Ngày thập phân, tiền đoán nghìn).
 */
type QuyUocSo = "vn" | "us";
function suyQuyUocSo(matrix: string[][], laCotTien?: (c: number) => boolean): QuyUocSo | null {
  let vn = false, us = false;
  for (const row of matrix) {
    row.forEach((raw, c) => {
      const v0 = String(raw ?? "").trim();
      if (!v0 || v0.startsWith("=")) return;
      const s = tachNgoacKeToan(v0).s.replace(/[\s₫đ$]/gi, "").replace(/^-/, "");
      if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return;
      const d = s.lastIndexOf("."), p = s.lastIndexOf(",");
      if (d >= 0 && p >= 0) { if (p > d) vn = true; else us = true; return; }
      if (/^\d{1,3}(\.\d{3}){2,}$/.test(s)) { vn = true; return; }
      if (/^\d{1,3}(,\d{3}){2,}$/.test(s)) { us = true; return; }
      if (laCotTien?.(c)) {
        if (/^\d{1,3}\.\d{3}$/.test(s)) vn = true;
        else if (/^\d{1,3},\d{3}$/.test(s)) us = true;
      }
    });
  }
  return vn === us ? null : vn ? "vn" : "us";
}

/** Đọc số theo quy ước ĐÃ BIẾT của bảng: bỏ dấu nghìn, đổi dấu thập phân thành "." (PORT parseTheoQuyUoc).
 *  Đúng MỘT dấu nghìn mà nhóm sau không đủ 3 chữ số ("0.5" ở bảng VN) là dấu THẬP PHÂN — bản trước bỏ
 *  mọi "." nên SL "0.5" thành 5, tiền sai 10 lần, và bảng không có cột Thành Tiền thì không một cảnh báo
 *  (soát toàn diện đợt 3, L51). Lưới đọc ô đó cũng ra 0,5 (khopQuyUoc → parseLooseDecimal). */
function parseTheoQuyUoc(s: string, qu: QuyUocSo): number {
  const kt = tachNgoacKeToan(s);
  if (kt.am) { const n = parseTheoQuyUoc(kt.s, qu); return n ? -Math.abs(n) : 0; }
  const pt = boPhanTram(s); if (pt != null) return chia100(parseTheoQuyUoc(pt, qu));
  let str = boCumChuSo(s).trim().replace(/[^\d.,-]/g, "");
  if (!str || str === "-") return 0;
  const nghin = qu === "vn" ? "." : ",", thapPhan = qu === "vn" ? "," : ".";
  const nhom = str.split(nghin);
  if (nhom.length === 2 && !str.includes(thapPhan) && nhom[1].length !== 3) str = nhom.join(".");
  else str = qu === "vn" ? str.replace(/\./g, "").replace(",", ".") : str.replace(/,/g, "");
  return Number(str) || 0;
}

/** Làm tròn Số Lượng 1 chữ số — KHỚP qtyRound ở excel.ts / money (để đối chiếu Thành Tiền). */
function qtyRound(n: number) { const t = Math.round(Math.abs(n) * 10 + 1e-6) / 10; return n < 0 ? -t : t; }
function qtyExact(n: number) { const t = Math.round(Math.abs(n) * 10_000 + 1e-8) / 10_000; return n < 0 ? -t : t; }
const qtyForAmount = (it: Pick<ImportedItem, "quantity" | "quantityExact">) => it.quantityExact ? qtyExact(it.quantity) : qtyRound(it.quantity);

/** 0→"A" … chữ nhóm tự sinh (khớp sectionLetter ở excel.ts). */
function sectionLetter(n: number) {
  let s = "", x = n + 1;
  while (x > 0) { const m = (x - 1) % 26; s = String.fromCharCode(65 + m) + s; x = Math.floor((x - 1) / 26); }
  return s;
}

type Cell = ExcelJS.Cell;

/** Định dạng ô kiểu NGÀY ("dd/mm/yyyy", "d-mmm-yy"…) — "#,##0" hay "0.0" thì không dính. */
const DATE_FMT_RE = /y{2,4}|[dm]{1,4}\s*[/-]|[/-]\s*[dm]{1,4}/i;

/**
 * Ô SỐ nhưng khách lỡ nhập NGÀY → tuyệt đối không được đọc thành 20.260.801 hay 46.235.
 * Bắt cả hai kiểu Excel lưu: giá trị Date thật, và SỐ SÊ-RI kèm định dạng ngày.
 */
const isDateCell = (cell: Cell | null) => {
  const v = cell?.value as unknown;
  if (v instanceof Date) return true;
  if (v && typeof v === "object" && (v as { result?: unknown }).result instanceof Date) return true;
  const fmt = (cell as unknown as { numFmt?: string })?.numFmt;
  return typeof v === "number" && !!fmt && DATE_FMT_RE.test(fmt);
};

/**
 * Số của 1 ô: ưu tiên số thật / kết quả công thức; chuỗi thì đọc kiểu VN — theo `qu` (quy ước của cả
 * bảng, suyQuyUocSo) khi đã suy ra được. Ô số thật KHÔNG bao giờ đi qua nhánh chữ.
 */
function numOf(cell: Cell | null, decimal = false, qu: QuyUocSo | null = null): number {
  if (!cell) return 0;
  const v = cell.value as unknown;
  if (typeof v === "number") return v;
  if (isDateCell(cell)) return 0;   // ngày tháng KHÔNG phải số lượng/đơn giá — nơi gọi sẽ cảnh báo
  if (v && typeof v === "object") {
    const r = (v as Record<string, unknown>).result;
    if (typeof r === "number") return r;
  }
  const t = cellText(v).trim();
  if (!t) return 0;
  if (qu) return parseTheoQuyUoc(t, qu);
  return decimal ? parseLooseDecimal(t) : parseLooseNumber(t);
}
const isBlank = (cell: Cell | null) => !cell || cellText(cell.value).trim() === "";
/**
 * Mã lỗi Excel của ô (`#N/A`, `#REF!`, `#DIV/0!`…) — cả ô lỗi trần lẫn công thức có KẾT QUẢ lỗi.
 * numOf/cellText coi chúng như ô TRỐNG (→ 0), nên không có dòng này thì một Đơn Giá `#N/A` nạp vào
 * thành 0 mà không có cảnh báo nào phân biệt với ô bỏ trống thật (XLSX-08).
 */
function errOf(cell: Cell | null): string | null {
  const v = cell?.value as Record<string, any> | null | undefined;
  if (!v || typeof v !== "object") return null;
  const e = v.error ?? v.result?.error;
  return typeof e === "string" && e ? e : null;
}
/** Công thức của ô (ExcelJS tự dịch shared-formula khi khách kéo công thức xuống). */
function fxOf(cell: Cell | null): string | null {
  if (!cell) return null;
  try { const f = (cell as unknown as { formula?: string }).formula; return f ? String(f) : null; } catch { return null; }
}
/** Kết quả Excel đã tính sẵn cho ô công thức (nguồn sự thật để tự kiểm). */
function resultOf(cell: Cell | null): number | null {
  const r = (cell as unknown as { result?: unknown })?.result;
  return typeof r === "number" ? r : null;
}
function fillOf(cell: Cell | null): string {
  const f = cell?.fill as { pattern?: string; fgColor?: { argb?: string } } | undefined;
  return (f && f.pattern === "solid" && f.fgColor?.argb) ? String(f.fgColor.argb).toUpperCase() : "";
}

function markedTemplate(ws: ExcelJS.Worksheet, hasDays: boolean): string | null {
  const raw = cellText(ws.getCell("A1").value).trim();
  if (!raw.startsWith(TEMPLATE_MARKER_PREFIX)) return null;
  const code = raw.slice(TEMPLATE_MARKER_PREFIX.length).trim();
  const cfg = TEMPLATE_CONFIGS[code];
  if (!cfg) return null;
  // Marker chỉ được tin khi cấu trúc cốt lõi vẫn khớp; file bị sửa/chắp sheet sẽ quay về heuristic.
  return !!cfg.items?.columns?.days === hasDays ? code : null;
}

// ===== Dò HÀNG TIÊU ĐỀ =====
type HeaderHit = { row: number; roles: Map<number, string>; score: number };

function findHeaderRow(ws: ExcelJS.Worksheet): HeaderHit | null {
  const maxRow = Math.min(ws.rowCount || 0, MAX_HEADER_SCAN);
  const maxCol = Math.min(Math.max(ws.columnCount || 0, 10), MAX_SCAN_COLS);
  let best: HeaderHit | null = null;
  for (let r = 1; r <= maxRow; r++) {
    const roles = new Map<number, string>();
    const taken = new Set<string>();
    let filled = 0;
    for (let c = 1; c <= maxCol; c++) {
      const cell = ws.getCell(r, c);
      const key = normHdr(cellText(cell.value));
      if (!key) continue;
      const role = HEADER_ROLE[key];
      if (role && !taken.has(role)) { roles.set(c, role); taken.add(role); }
      if (FILL_HEADER.has(fillOf(cell))) filled++;
    }
    // Bảng báo giá tối thiểu phải có cột TÊN + (SỐ LƯỢNG hoặc ĐƠN GIÁ hoặc THÀNH TIỀN).
    if (!taken.has("name") || !(taken.has("quantity") || taken.has("unitPrice") || taken.has("_amount"))) continue;
    const score = roles.size + (taken.has("_stt") ? 2 : 0) + (filled >= 3 ? 2 : 0);
    if (!best || score > best.score) best = { row: r, roles, score };
  }
  return best;
}

// ===== Đọc 1 sheet =====
function emptySheet(index: number, name: string): ImportedSheet {
  return {
    index, name, hasDays: false, numberSubs: false, groupSubtotal: false, showImages: false,
    items: [], warnings: [],
    stats: { rows: 0, items: 0, sections: 0, subsections: 0, subs: 0, infos: 0, formulas: 0, formulasDropped: 0 },
  };
}

function parseSheet(ws: ExcelJS.Worksheet, index: number): ImportedSheet {
  const base = emptySheet(index, ws.name || `Sheet ${index + 1}`);

  // Sheet "Tổng Báo Giá" do app tự sinh — KHÔNG phải bảng hạng mục, bỏ qua.
  if (/^TONG BAO GIA/.test(normHdr(cellText(ws.getCell(1, 1).value)))) {
    return { ...base, skipped: "Sheet tổng hợp do app tự sinh — không cần nạp" };
  }

  const hit = findHeaderRow(ws);
  if (!hit) return { ...base, skipped: "Không tìm thấy hàng tiêu đề (STT / Hạng Mục / Số Lượng / Đơn Giá)" };

  const colOf: Record<string, number> = {};
  for (const [c, role] of hit.roles) if (colOf[role] == null) colOf[role] = c;
  const roleOfCol = new Map<number, string>();
  for (const [role, c] of Object.entries(colOf)) roleOfCol.set(c, role);

  // Ô "THẬT" của (hàng, vai trò). Ô GỘP NGANG (vd nhãn "Tổng Cộng" gộp B:G, banner CLF gộp B5:I5)
  // bị ExcelJS trả về giá trị của ô chủ ở MỌI cột trong vùng gộp → đọc thẳng sẽ tưởng dòng đó có
  // đủ ĐVT/Số Lượng/Đơn Giá. Chỉ nhận ô nếu nó KHÔNG bị gộp ngang (ô chủ cùng cột).
  const cellAt = (r: number, role: string): Cell | null => {
    const c = colOf[role];
    if (!c) return null;
    const cell = ws.getCell(r, c);
    const m = cell.isMerged ? cell.master : null;
    if (m) { const mc = coordNum(m.col, true); if (isFinite(mc) && mc !== c) return null; }   // giá trị mượn từ cột khác → coi như trống
    return cell;
  };
  const textAt = (r: number, role: string) => cellText(cellAt(r, role)?.value).trim();

  base.headerRow = hit.row;
  base.hasDays = colOf.days != null;
  base.showImages = colOf._images != null;
  base.columns = Object.fromEntries(Object.entries(colOf).map(([role, c]) => [role, colLetter(c)]));
  const markerCode = markedTemplate(ws, base.hasDays);
  // Dấu mã mẫu nhúng ở ô A1 = bằng chứng file do CHÍNH app xuất ra. Dùng ở bocTienToThuTu().
  base.fromApp = !!markerCode;
  const appBannerCell = markerCode ? TEMPLATE_CONFIGS[markerCode]?.cells?.infoBannerCell : null;
  const appBannerRow = appBannerCell ? Number(/\d+$/.exec(String(appBannerCell))?.[0] || 0) : 0;
  let appBannerInfo: string | null = null;
  if (appBannerCell) {
    const raw = cellText(ws.getCell(String(appBannerCell)).value).trim();
    // Colorfull dùng chung dải B5 cho mã tra cứu và nội dung chương trình. Chỉ phần có nhãn
    // "Thông tin chương trình" là item; mã + lời chào chỉ là metadata đầu trang.
    const body = raw.replace(/^\(\s*Số\s*:\/\/[^)]*\)\s*/iu, "");
    const m = /^\*\s*Thông tin chương trình\s*:\s*(.+)$/iu.exec(body);
    if (m) appBannerInfo = m[1].trim();
  }

  // Dòng nhóm của file ngoài thường vẫn có ĐVT + Số Lượng, còn Đơn Giá là tổng các ô Thành Tiền
  // bên dưới (vd `=SUM(H13:H18)` hoặc `=H30`). Đây là dấu hiệu cấu trúc mạnh hơn việc ô ĐVT trống.
  //
  // Hai điều kiện cho "tổng nhóm" (soát toàn diện L46):
  //   · HƯỚNG — mọi tham chiếu nằm ở dòng BÊN DƯỚI. Trước đây chỉ hỏi "mọi tham chiếu có ở cột Thành
  //     Tiền không", nên dòng PHÍ tính theo các mục BÊN TRÊN (`=SUM(H7:H8)*10%` — "Phí quản lý 10%" có
  //     ĐVT + SL) bị xếp thành nhóm con, Đơn Giá ép 0, mất tiền phí; STT là số thì còn lật numberSubs
  //     của CẢ sheet → đoán ra mẫu Banner → web không ghép được vào sheet đang có, mặc định TẠO SHEET MỚI.
  //   · KHÔNG NHÂN / CHIA hệ số (`*` `/` `%` `^`) — "10% tổng các mục dưới" là PHÍ, không phải tổng nhóm.
  // Hình dạng còn lại để MỞ, CÓ CHỦ Ý: tệp ngoài viết tổng nhóm đủ kiểu — `SUBTOTAL(9,F5:F6)`,
  // `ROUND(SUM(F5:F6),0)`, `=+SUM(..)`, `=(F5+F6)`. Bản đầu của chốt này dùng danh sách TRẮNG (chỉ
  // `SUM(..)` / `=Hx` / `=Hx+Hy`) và các dạng đó rơi xuống nhánh hạng mục: dòng nhóm mang đơn giá bằng
  // tổng các mục bên dưới → tiền CỘNG ĐÔI, không một cảnh báo dòng nào.
  const amountLetter = colOf._amount ? colLetter(colOf._amount) : "";
  /** Đơn Giá dòng r là công thức gom các ô ở dòng BÊN DƯỚI, chỉ trong các cột `cot`, không nhân hệ số. */
  const tongCacDongDuoi = (r: number, cot: string[]) => {
    const fx = fxOf(cellAt(r, "unitPrice"));
    if (!fx || /[*/%^]/.test(fx)) return false;
    const refs = [...fx.matchAll(/\$?([A-Z]{1,3})\$?(\d+)/gi)];
    return refs.length > 0 && refs.every((m) => cot.includes(m[1].toUpperCase()) && Number(m[2]) > r);
  };
  const hasGroupPriceFormula = (r: number) => !!amountLetter && tongCacDongDuoi(r, [amountLetter]);

  // ── Quét thô: chốt dòng cuối của bảng + nhận diện kiểu BANNER (nhóm con đánh SỐ) ──
  const lastSheetRow = ws.rowCount || hit.row;
  const scanEnd = Math.min(lastSheetRow, hit.row + MAX_SCAN_ROWS);
  let lastRow = hit.row;
  // Số dòng BỊ CẮT vì vượt trần lưu — đếm để nói với người dùng, không để dựng đối tượng.
  let daCat = 0;
  let blankRun = 0;
  let stopRow = 0;              // dòng làm bảng dừng (dòng tổng / chân trang / khoảng trống dài)
  const bodyRows: number[] = [];
  for (let r = hit.row + 1; r <= scanEnd; r++) {
    const stt = textAt(r, "_stt"), name = textAt(r, "name");
    // File do app xuất có thể dùng hàng ngay sau tiêu đề chỉ để in mã + lời chào. Không đưa hàng
    // metadata đó vào bảng; nếu có nội dung chương trình thật thì giữ lại để dựng item `info`.
    if (r === appBannerRow && appBannerInfo == null) continue;
    // Nửa dưới của hàng TIÊU ĐỀ cao 2 hàng (ô gộp dọc 3:4 — kiểu rất hay gặp ở báo giá VN): ExcelJS
    // trả giá trị ô chủ cho ô phụ, cellAt chỉ loại ô gộp NGANG, nên hàng này đọc ra STT="STT",
    // ĐVT="ĐVT", Ghi chú="Ghi chú" và ô Hạng Mục gộp dọc → thành "hàng con" rác đứng đầu danh sách
    // nạp (soát toàn diện L52). Ô Hạng Mục thuộc vùng gộp có ô chủ ở chính hàng tiêu đề → bỏ qua.
    if (colOf.name) {
      const nc = ws.getCell(r, colOf.name);
      if (nc.isMerged && coordNum(nc.master?.row, false) === hit.row) continue;
    }
    const allBlank = !stt && !name && isBlank(cellAt(r, "unit")) && isBlank(cellAt(r, "quantity"))
      && isBlank(cellAt(r, "unitPrice")) && isBlank(cellAt(r, "_amount"));
    if (allBlank) { if (++blankRun >= 4) { stopRow = r; break; } continue; }
    blankRun = 0;
    // Hết bảng khi gặp dòng TỔNG CỘNG / VAT / THÀNH TIỀN / chân trang. Dòng có ĐVT + Số Lượng thì
    // vẫn là hạng mục thật (tên hạng mục có thể chứa chữ "Tổng …").
    const looksItem = !isBlank(cellAt(r, "unit")) && !isBlank(cellAt(r, "quantity"));
    const labelCells = [stt, textAt(r, "quantity"), textAt(r, "unitPrice"), textAt(r, "days")];
    const hitTotals = labelCells.some((t) => t && (RE_TOTALS.test(normHdr(t)) || RE_FOOTER.test(normHdr(t))));
    if (hitTotals && !looksItem) { stopRow = r; break; }
    if (name && (RE_FOOTER.test(normHdr(name)) || RE_TOTALS.test(normHdr(name))) && !looksItem && isBlank(cellAt(r, "unitPrice"))) { stopRow = r; break; }
    bodyRows.push(r);
    lastRow = r;
  }
  // Sheet TỔNG nhận theo CẤU TRÚC, không chỉ theo chữ ở A1 (soát toàn diện L50). Khách đổi tiêu đề
  // ("TỔNG HỢP BÁO GIÁ") hay chèn một hàng logo lên đầu là luật A1 ở trên trượt, còn hàng
  // "STT | Hạng mục | Thành tiền" vẫn đủ làm hàng tiêu đề → mỗi sheet con thành một hạng mục 0đ, mẫu
  // đoán GN kể cả tệp Colorfull, modal mặc định "Thay toàn bộ" → sheet rác hoặc ĐÈ một sheet GN.
  // Bảng KHÔNG có cột ĐVT / Số Lượng / Đơn Giá mới xét, và phải thêm một trong hai:
  //   · tên tab là "Tổng Báo Giá" (app đặt; khách dán giá trị đè công thức thì chỉ còn dấu hiệu này);
  //   · mọi ô Thành Tiền có chữ đều là công thức trỏ sang SHEET KHÁC ('Décor'!H20) — đúng thứ app
  //     ghi; bảng chỉ-có-Thành-Tiền của tệp ngoài ghi số thường thì vẫn nạp như cũ.
  if (!colOf.unit && !colOf.quantity && !colOf.unitPrice && colOf._amount && bodyRows.length) {
    const coChu = bodyRows.filter((r) => !isBlank(cellAt(r, "_amount")));
    const troSheetKhac = coChu.length > 0 && coChu.every((r) => (fxOf(cellAt(r, "_amount")) || "").includes("!"));
    if (troSheetKhac || /^TONG BAO GIA/.test(normHdr(ws.name))) {
      return { ...emptySheet(index, base.name), skipped: "Sheet tổng hợp do app tự sinh — không cần nạp" };
    }
  }

  base.firstRow = bodyRows[0];
  base.lastRow = lastRow;
  base.stats.rows = bodyRows.length;

  // Quy ước số của CẢ bảng (L51) — suy từ ô số dạng CHỮ của cột SL / Ngày / Đơn Giá / Thành Tiền; hai
  // cột sau là cột tiền. Tệp app xuất ghi số THẬT nên không có ô nào ở đây → qu = null, y như cũ.
  const chuSo = (cell: Cell | null): string => {
    const v = cell?.value as unknown;
    if (v == null || typeof v === "number" || v instanceof Date) return "";
    if (typeof v === "object" && ((v as { formula?: unknown }).formula !== undefined || (v as { sharedFormula?: unknown }).sharedFormula !== undefined)) return "";
    return cellText(v).trim();
  };
  const bangChuSo: string[][] = [];
  for (const r of bodyRows) {
    const hang = (["quantity", "days", "unitPrice", "_amount"] as const).map((role) => chuSo(cellAt(r, role)));
    if (hang.some(Boolean)) bangChuSo.push(hang);
  }
  const qu = suyQuyUocSo(bangChuSo, (c) => c >= 2);

  // Dòng có đủ ĐVT + SL + Đơn Giá THƯỜNG — hình dạng hạng mục. "Không thường" = Đơn Giá gom các ô ở
  // dòng BÊN DƯỚI, tính cả cột ĐƠN GIÁ chứ không chỉ Thành Tiền: nhóm CHÍNH bản BANNER có nhóm con được
  // app ghi `=SUM(G7,G9)` (Đơn Giá các nhóm con — src/excel.ts subSectionRows), hoặc
  // `=SUM(H6:H6)+SUM(G7,G9)` khi có cả mục lẻ. Chỉ xét cột Thành Tiền thì nhóm chính nhãn SỐ ("1" — nhãn
  // tự đặt hợp lệ) + ĐVT + SL bị coi là hạng mục, hạ màu nhóm → tiền cộng đôi (soát toàn diện L49).
  const priceLetter = colOf.unitPrice ? colLetter(colOf.unitPrice) : "";
  const dangHangMuc = (r: number) => !isBlank(cellAt(r, "unit")) && !isBlank(cellAt(r, "quantity"))
    && !isBlank(cellAt(r, "unitPrice")) && !tongCacDongDuoi(r, [amountLetter, priceLetter].filter(Boolean));

  // Bản BANNER: nhóm con đánh SỐ (STT số + có tên + KHÔNG ĐVT + có giá) → hàng STT-trống là MỤC.
  // Nền nhóm con chỉ được tính khi dòng KHÔNG mang hình dạng hạng mục: hàng khách chèn dưới nhóm
  // con ("Format Same As Above") mang nền đó + STT "1" không được lật cách đánh số của CẢ sheet (L49).
  const numberedSub = bodyRows.some((r) => {
    const stt = textAt(r, "_stt"), name = textAt(r, "name");
    if (!/^\d+$/.test(stt) || !name) return false;
    const fill = fillOf(cellAt(r, "name")) || fillOf(cellAt(r, "_stt"));
    return (FILL_SUB.has(fill) && !dangHangMuc(r)) || hasGroupPriceFormula(r)
      || (isBlank(cellAt(r, "unit")) && isBlank(cellAt(r, "quantity")) && !isBlank(cellAt(r, "unitPrice")));
  });
  const effectiveNumberSubs = markerCode ? !!TEMPLATE_CONFIGS[markerCode]?.items?.numberSubsections : numberedSub;
  base.numberSubs = effectiveNumberSubs;

  // ── Phân loại + đọc giá trị từng dòng ──
  type Raw = { row: number; kind: ImportedKind; it: ImportedItem };
  const raws: Raw[] = [];
  let sectionSeq = 0, subSeq = 0;

  for (const r of bodyRows) {
    const sttCell = cellAt(r, "_stt"), nameCell = cellAt(r, "name");
    const stt = cellText(sttCell?.value).trim();
    const unit = textAt(r, "unit");
    const hasUnit = unit !== "";
    const hasQty = !isBlank(cellAt(r, "quantity"));
    const hasPrice = !isBlank(cellAt(r, "unitPrice"));
    const hasAmt = !isBlank(cellAt(r, "_amount"));
    const fill = fillOf(nameCell) || fillOf(sttCell);
    const groupPriceFormula = hasGroupPriceFormula(r);

    // Ô Hạng Mục GỘP DỌC và dòng này không phải dòng đầu ô gộp → HÀNG CON (tên nằm ở dòng cha).
    // Cũng là hàng con khi Ô STT là ô phụ của vùng gộp dọc từ hàng trên mà ô tên TRỐNG: tệp
    // Colorfull xuất trước bản sửa L47 có hàng con ở hàng 17–18 chỉ gộp được STT (ô Hạng Mục là
    // ô trống riêng) — nhận theo ô tên thì ra hạng mục TÊN RỖNG, xuất lại thành STT mới trống.
    const sttGopDoc = !!sttCell?.isMerged && coordNum(sttCell.master?.row, false) < r;
    const merged = (!!nameCell?.isMerged && coordNum(nameCell.master?.row, false) < r)
      || (sttGopDoc && cellText(nameCell?.value).trim() === "");
    let name = merged ? "" : cellText(nameCell?.value).trim();

    // Dòng CHỮ TỰ DO chạy ngang cả bảng (mẫu CLF gộp B5:I5 "* Thông tin chương trình: …") — chữ
    // nằm ở ô chủ thuộc cột STT. Đây chính là dòng kind="info" của app → trả về đúng dạng đó.
    const bannerText = (!name && stt && stt.length > 12 && !hasUnit && !hasQty && !hasPrice && !hasAmt) ? stt : "";

    // MÀU NHÓM MÀ HÌNH DẠNG HẠNG MỤC (soát toàn diện L49): khách Insert Row ngay dưới hàng nhóm thì
    // Excel "Format Same As Above" → hàng mới mang nền nhóm. Xét màu trước hình dạng là "1 | Hạng mục
    // mới | cái | 2 | 500.000" thành NHÓM: Đơn Giá ép 0, SL 2 thành hệ số nhân các mục bên dưới.
    // Chỉ để màu THUA khi đủ cả bốn: STT là số + ĐVT + SL + Đơn Giá thường (không phải tổng các dòng
    // dưới — xem dangHangMuc). Nhóm thật của app CÓ THỂ mang STT số (nhãn tự đặt "1"/"2") và có ĐVT +
    // SL, nhưng khi đó Đơn Giá của nó là công thức gom các dòng dưới (Thành Tiền mục con, hoặc Đơn Giá
    // nhóm con ở bản BANNER) nên không đủ bốn. Nhóm con bản BANNER (đánh số) CÓ STT thì màu luôn thắng:
    // khách gõ số đè Đơn Giá nhóm con là ca có thật — xem chú thích FILL_SECTION ở đầu tệp.
    // Nền nhóm CHÍNH còn nhận cả STT TRỐNG (soát toàn diện đợt 3): mẫu Banner mục vốn không đánh số nên
    // khách chèn hàng hay để trống STT, mà nhóm chính do app xuất LUÔN có nhãn ở ô STT (sectionLetter
    // hoặc nhãn tự đặt — src/excel.ts). Nền nhóm CON mẫu thường thì không: nhóm con mẫu thường vốn để
    // trống STT, và khách gõ số đè Đơn Giá của nó (đủ bốn điều kiện) vẫn phải là nhóm con. Nhưng bản
    // BANNER (đánh số nhóm con) thì nhóm con app xuất LUÔN có STT (`label || String(++subNo)`), nên nền
    // nhóm con + STT TRỐNG + đủ hình dạng hạng mục là hàng chèn — mục Banner vốn không đánh số (phản biện
    // đợt 3: "Hạng mục mới | cái | 2 | 500.000" dưới "Nhóm con A1" từng nạp thành nhóm con, tổng hụt).
    const sttSo = /^\d+$/.test(stt);
    const mauNhomMaLaHangMuc = dangHangMuc(r) && (FILL_SUB.has(fill)
      ? effectiveNumberSubs ? stt === "" : sttSo
      : FILL_SECTION.has(fill) && (sttSo || stt === ""));

    const prevKind = raws.length ? raws[raws.length - 1].kind : null;
    let kind: ImportedKind;
    if (r === appBannerRow && appBannerInfo != null) { kind = "info"; name = appBannerInfo; }
    else if (bannerText) { kind = "info"; name = bannerText.replace(/^\*\s*Thông tin chương trình\s*:\s*/i, "").trim(); }
    else if (merged) kind = "sub";
    else if (FILL_SECTION.has(fill) && !mauNhomMaLaHangMuc) kind = "section";
    else if (FILL_SUB.has(fill) && !mauNhomMaLaHangMuc) kind = "subsection";
    // STT chữ A/B thường là nhóm; nếu dòng vẫn có ĐVT thì chỉ coi là nhóm khi Đơn Giá tổng hợp
    // từ cột Thành Tiền. Tránh nuốt file ngoài dùng A/B/C để đánh số hạng mục thường.
    else if (/^[A-Z]{1,2}$/.test(stt) && (!hasUnit || groupPriceFormula)) kind = "section";
    else if (effectiveNumberSubs && /^\d+$/.test(stt) && name !== "" && (groupPriceFormula || (!hasUnit && hasPrice))) kind = "subsection";
    else if (!stt && name === "" && (hasUnit || hasQty || hasPrice) && (prevKind === "item" || prevKind === "sub")) kind = "sub";
    else if (!stt && name !== "" && !hasUnit && !hasQty && !hasPrice && !hasAmt) kind = "info";
    // !hasQty là chốt chặn quan trọng: file ngoài rất hay thiếu ĐỒNG THỜI cột STT và ĐVT
    // ("Hạng Mục | Số Lượng | Đơn Giá | Thành Tiền" — bảng dịch vụ phổ biến). Không có nó thì MỌI
    // dòng rơi vào đây thành nhóm con, rồi Đơn Giá bị ép 0 → nạp xong báo giá 0đ mà không một
    // cảnh báo nào. Dòng CÓ Số Lượng thì chắc chắn là hạng mục, không phải tiêu đề nhóm.
    else if (!effectiveNumberSubs && !stt && name !== "" && (groupPriceFormula || (!hasUnit && !hasQty))) kind = "subsection";
    else if (name !== "" && !hasUnit && hasPrice && !hasQty) kind = "subsection";
    else kind = "item";

    const it: ImportedItem = { kind, name: kind === "sub" ? "" : name, quantity: 0, unitPrice: 0, row: r };
    const warn: string[] = [];
    if (mauNhomMaLaHangMuc && kind === "item") warn.push(`Dòng tô màu nhóm nhưng có ${stt ? "STT số" : "STT trống"} + ĐVT + Số Lượng + Đơn Giá — đã nạp thành hạng mục, kiểm tra lại`);

    // Chữ nhóm: app tự đánh A/B/C (banner: nhóm con 1/2/3) → chỉ giữ label khi khách đặt KHÁC.
    if (kind === "section") {
      const auto = sectionLetter(sectionSeq++);
      subSeq = 0;
      if (stt && stt !== auto) it.label = stt.slice(0, 12);
    } else if (kind === "subsection") {
      const auto = effectiveNumberSubs ? String(++subSeq) : "";
      if (stt && stt !== auto) it.label = stt.slice(0, 12);
    }

    const isGroup = kind === "section" || kind === "subsection";
    if (colOf.detail && !isGroup) it.detail = textAt(r, "detail");
    // Nhóm vẫn có thể có ĐVT (vd "Booth ... | bộ | 5"). Giữ lại để lưới hiển thị đúng file.
    if (kind !== "info") it.unit = unit;
    if (colOf.notes) it.notes = cellText(cellAt(r, "notes")?.value).trim();
    if (colOf.internalNote) {
      const n = cellText(cellAt(r, "internalNote")?.value).trim();
      if (n) it.internalNote = n;
    }

    // Số. Dòng NHÓM: Đơn Giá / Thành Tiền là TỔNG do app tự tính → KHÔNG nạp (app cộng lại),
    // chỉ giữ SỐ LƯỢNG (hệ số nhân của nhóm).
    it.quantity = numOf(cellAt(r, "quantity"), true, qu);
    it.unitPrice = isGroup ? 0 : numOf(cellAt(r, "unitPrice"), false, qu);
    if (colOf.days) it.days = isGroup ? null : (numOf(cellAt(r, "days"), true, qu) || null);
    if (kind === "info") { it.unit = ""; it.quantity = 0; it.unitPrice = 0; it.days = null; }

    // Ô SỐ mà lại là NGÀY THÁNG (khách gõ nhầm ô) → numOf trả 0, phải nói rõ để không âm thầm mất tiền.
    for (const [role, vn] of [["quantity", "Số Lượng"], ["unitPrice", "Đơn Giá"], ["days", "Số Ngày"]] as const) {
      if (colOf[role] && isDateCell(cellAt(r, role))) warn.push(`Ô ${vn} đang là NGÀY THÁNG, không phải số — đã để 0, cần nhập lại`);
    }
    // Ô số đang LỖI trong Excel → numOf đọc thành 0. Nói rõ, đừng để lẫn với ô trống (XLSX-08).
    if (kind !== "info") {
      for (const [role, vn] of [["quantity", "Số Lượng"], ["unitPrice", "Đơn Giá"], ["days", "Số Ngày"], ["_amount", "Thành Tiền"]] as const) {
        if (isGroup && role !== "quantity") continue;   // nhóm: Đơn Giá/Thành Tiền do app tự tính lại
        const loi = colOf[role] ? errOf(cellAt(r, role)) : null;
        if (loi) warn.push(`Ô ${vn} đang LỖI ${loi} trong Excel — đã để 0, cần nhập lại`);
      }
    }

    // Thành Tiền trong file có khớp SL × ĐG (× Ngày) không? Lệch = khách sửa tay ô tổng → cảnh báo,
    // KHÔNG tự ý sửa số của khách.
    if ((kind === "item" || kind === "sub") && hasAmt) {
      const amt = numOf(cellAt(r, "_amount"), false, qu);
      const factor = (colOf.days ? (Number(it.days) || 1) : 1) * it.unitPrice;
      const rounded = Math.round(qtyRound(it.quantity) * factor);
      const exact = Math.round(qtyExact(it.quantity) * factor);
      const tolerance = Math.max(2, Math.abs(amt) * 0.005);
      const roundedDiff = Math.abs(rounded - amt), exactDiff = Math.abs(exact - amt);
      // Chỉ bật khi số chính xác khớp file RÕ RÀNG hơn cách làm tròn cũ. Báo giá cũ/app-export
      // vẫn giữ quantityExact=false nên không đổi tiền hàng loạt.
      if (amt && exactDiff <= tolerance && exactDiff + 0.5 < roundedDiff) it.quantityExact = true;
      else if (amt && roundedDiff > tolerance && exactDiff > tolerance) {
        warn.push(`Thành Tiền trong file (${amt.toLocaleString("vi-VN")}) không khớp Số Lượng × Đơn Giá (${rounded.toLocaleString("vi-VN")})`);
      }
    }

    if (warn.length) it.warn = warn;

    // ── CẮT NGAY TẠI VÒNG QUÉT, KHÔNG DỰNG ĐỐI TƯỢNG CHO PHẦN DƯ ────────────
    // Bản vá đầu cắt SAU vòng này (`raws.length = MAX_ITEMS_PER_SHEET`) và ĐÃ ĐO LÀ KHÔNG ĐỦ:
    // đẩy file 8,79 MB (2 sheet × 200.000 dòng) lên dev thật thì tiến trình VẪN bị nhân giết —
    // `oom-kill … Killed process (node) anon-rss 1.529.596 kB`. Cắt sau thì 400.000 đối tượng
    // `ImportedItem` ĐÃ được dựng xong rồi mới bỏ đi; đỉnh bộ nhớ nằm ở CHÍNH LÚC DỰNG.
    //
    // `resourceLimits` của worker KHÔNG cứu được: nó chặn old-space của worker, còn Buffer/chuỗi
    // do ExcelJS sinh ra nằm NGOÀI vùng đó, mà trần cgroup thì tính CẢ tiến trình.
    //
    // Vẫn ĐẾM TIẾP (`daCat++`) chứ không `break`: người dùng cần biết file có BAO NHIÊU dòng để
    // quyết định tách thế nào. Đếm một biến số nguyên thì không tốn gì; dựng đối tượng mới tốn.
    if (raws.length >= MAX_ITEMS_PER_SHEET) { daCat++; continue; }
    raws.push({ row: r, kind, it });
  }

  // ── Công thức tham chiếu ô: dịch sang toạ độ EDITOR (canonical) + TỰ KIỂM ──
  const rowToIdx = new Map<number, number>();
  raws.forEach((x, i) => rowToIdx.set(x.row, i));
  const refCtx = {
    fieldOfCol: (L: string) => {
      const role = roleOfCol.get(colIndex(L));
      // Chỉ cho tham chiếu ô SỐ (gồm cột Thành Tiền) — ref ô chữ vô nghĩa với công thức.
      return role && ["quantity", "unitPrice", "days", "_amount"].includes(role) ? role : null;
    },
    rowToEditor: (r: number) => (rowToIdx.has(r) ? rowToIdx.get(r)! + 1 : null),
  };
  // Giá trị 1 ô theo hệ EDITOR (để tự kiểm) — khớp cách web tính Thành Tiền.
  const valueOfRef = (field: string, editorRow: number): number => {
    const x = raws[editorRow - 1];
    if (!x || x.kind === "info") return NaN;
    const it = x.it;
    if (field === "_amount") {
      if (x.kind === "section" || x.kind === "subsection") return NaN;   // tổng nhóm: app tự tính
      return nhanLamTronDong(qtyForAmount(it), colOf.days ? (Number(it.days) || 1) : 1, Number(it.unitPrice) || 0);   // chính xác — XLSX-06
    }
    if (field === "quantity") return qtyForAmount(it);
    if (field === "unitPrice") return Number(it.unitPrice) || 0;
    if (field === "days") return Number(it.days) || 0;
    return NaN;
  };
  /** Tính giá trị công thức canonical (thay {field:row} bằng số) — dùng để tự kiểm. */
  const evalCanonical = (canon: string): number | null => {
    let bad = false;
    let s = canon.replace(/^=/, "");
    s = s.replace(/\{(\w+):(\d+)\}\s*:\s*\{(\w+):(\d+)\}/g, (_m, f1, r1, _f2, r2) => {
      const a = Math.min(Number(r1), Number(r2)), b = Math.max(Number(r1), Number(r2));
      const vals: number[] = [];
      for (let k = a; k <= b; k++) { const v = valueOfRef(String(f1), k); if (!isFinite(v)) { bad = true; return "0"; } vals.push(v); }
      return vals.join(";");
    });
    s = s.replace(/\{(\w+):(\d+)\}/g, (_m, f, r) => {
      const v = valueOfRef(String(f), Number(r));
      if (!isFinite(v)) { bad = true; return "0"; }
      return String(v);
    });
    if (bad) return null;
    return evalEditorFormula(s);
  };
  const FIELD_VN: Record<string, string> = { quantity: "Số Lượng", unitPrice: "Đơn Giá", days: "Số Ngày" };

  // File ngoài thường cho một dòng phí tham chiếu Đơn Giá nhóm (vd `=G12*13/100`). Web không
  // lưu số tổng nhóm trong item, nên bung ref đó thành chính công thức SUM con của nhóm trước khi
  // đổi toạ độ. Công thức/cached result vẫn qua lớp tự kiểm bên dưới.
  const groupFormulaByAddr = new Map<string, string>();
  for (const x of raws) {
    if (x.kind !== "section" && x.kind !== "subsection") continue;
    for (const role of ["unitPrice", "_amount"]) {
      const c = colOf[role], fx = fxOf(cellAt(x.row, role));
      if (c && fx) groupFormulaByAddr.set(`${colLetter(c)}${x.row}`, fx.replace(/^=/, ""));
    }
  }
  const expandGroupRefs = (formula: string, depth = 0, seen = new Set<string>()): string => {
    if (depth >= 4) return formula;
    return formula.replace(/\$?([A-Z]{1,3})\$?(\d+)/gi, (match, L: string, r: string, offset: number, whole: string) => {
      const before = whole.slice(0, offset), after = whole.slice(offset + match.length);
      if (/:\s*$/.test(before) || /^\s*:/.test(after)) return match; // không bung đầu/cuối của range
      const key = `${L.toUpperCase()}${r}`, nested = groupFormulaByAddr.get(key);
      if (!nested || seen.has(key)) return match;
      const nextSeen = new Set(seen); nextSeen.add(key);
      return `(${expandGroupRefs(nested, depth + 1, nextSeen)})`;
    });
  };

  for (const x of raws) {
    if (x.kind === "info") continue;
    const isGroup = x.kind === "section" || x.kind === "subsection";
    // Dòng nhóm: chỉ Số Lượng là của người dùng (Đơn Giá = SUM do app sinh → bỏ).
    const fields = isGroup
      ? [{ field: "quantity", round1: true }]
      : [{ field: "quantity", round1: true }, { field: "unitPrice", round1: false },
         ...(colOf.days ? [{ field: "days", round1: false }] : [])];
    for (const f of fields) {
      const cell = cellAt(x.row, f.field);
      const raw = fxOf(cell);
      if (!raw) continue;
      // Công thức ra LỖI: đã có cảnh báo "đang LỖI … đã để 0" ở vòng quét; câu "đã giữ con số" dưới
      // đây sẽ sai (con số là 0) — XLSX-08.
      if (errOf(cell)) continue;
      // Bóc lớp ROUND(...,1) mà CHÍNH app bọc quanh công thức Số Lượng lúc xuất.
      const rawBody = expandGroupRefs(raw.replace(/^=/, ""));
      const src = f.round1 ? unwrapRound(rawBody, 1) : rawBody;
      const appQtyRoundWrapper = f.round1 && src !== rawBody;
      const canon = excelFormulaToEditor(src, refCtx);
      const label = FIELD_VN[f.field] || f.field;
      if (!canon) {
        base.stats.formulasDropped++;
        (x.it.warn || (x.it.warn = [])).push(`Công thức ô ${label} ("=${src}") không dịch được sang lưới — đã giữ con số`);
        continue;
      }
      // TỰ KIỂM: công thức dịch xong phải ra ĐÚNG con số Excel đã tính sẵn trong file.
      const want = resultOf(cell);
      const got = evalCanonical(canon);
      // File do app xuất bọc Số Lượng bằng ROUND(...,1), nhưng canonical cố ý giữ công thức gốc.
      // So giá trị đã làm tròn để xác minh; lưu lại kết quả GỐC để lần xuất kế tiếp vẫn giữ formula.
      const checked = appQtyRoundWrapper && got != null ? qtyRound(got) : got;
      if (checked == null || (want != null && Math.abs(checked - want) > Math.max(0.5, Math.abs(want) * 1e-6))) {
        base.stats.formulasDropped++;
        (x.it.warn || (x.it.warn = [])).push(`Công thức ô ${label} ("=${src}") cho kết quả khác số trong file — đã giữ con số, bỏ công thức`);
        continue;
      }
      (x.it.formulas || (x.it.formulas = {}))[f.field] = canon;
      base.stats.formulas++;
      const resolved = want ?? got;
      if (resolved != null) {
        if (f.field === "quantity") x.it.quantity = appQtyRoundWrapper && got != null ? got : resolved;
        else if (f.field === "unitPrice") x.it.unitPrice = resolved;
        else if (f.field === "days") x.it.days = resolved;
      }
    }
  }

  base.items = raws.map((x) => x.it);
  // (Cảnh báo cột Chi Tiết dời xuống SAU bước đoán mẫu — nó phụ thuộc mẫu nào, xem bên dưới.)
  for (const x of raws) {
    if (x.kind === "item") base.stats.items++;
    else if (x.kind === "sub") base.stats.subs++;
    else if (x.kind === "section") base.stats.sections++;
    else if (x.kind === "subsection") base.stats.subsections++;
    else base.stats.infos++;
  }

  // Nhóm có ghi Thành Tiền ở dòng nhóm → báo giá này bật "tổng tiền theo nhóm".
  base.groupSubtotal = raws.some((x) => (x.kind === "section" || x.kind === "subsection") && !isBlank(cellAt(x.row, "_amount")));

  // ── Khối TỔNG dưới bảng: Cộng / Discount / Tổng Cộng / VAT % / Thành Tiền ──
  // File do app xuất ra (và file khách gửi) có Discount nằm NGAY DƯỚI dòng "Cộng", ghi số ÂM.
  // `totals.subtotal` phải là số CHƯA trừ (dòng "Cộng") vì nó được đem so với tổng các dòng hạng
  // mục đọc được — nên nhánh "TONG CONG" chỉ ghi khi chưa có gì (dòng "Cộng" luôn đến trước).
  const totals: NonNullable<ImportedSheet["totals"]> = {};
  const amountCol = colOf._amount || colOf.unitPrice || 1;
  const scanCols = Math.min(Math.max(ws.columnCount || 0, 10), 40);
  for (let r = lastRow + 1; r <= Math.min(lastRow + 12, lastSheetRow); r++) {
    let label = "";
    for (let c = 1; c <= scanCols; c++) {
      const t = normHdr(cellText(ws.getCell(r, c).value));
      if (t && RE_TOTALS.test(t)) { label = t; break; }
    }
    if (!label) continue;
    // Ô tổng đang LỖI (#REF!…) → KHÔNG ghi 0 vào tổng đối chiếu (XLSX-08): "Tổng cộng lệch với 0"
    // là cảnh báo sai hướng; bỏ qua ô đó như không có.
    if (errOf(ws.getCell(r, amountCol))) continue;
    const val = numOf(ws.getCell(r, amountCol), false, qu);
    if (/^VAT/.test(label)) {
      totals.vat = val;
      let pctText = "";
      for (let c = 1; c <= scanCols; c++) pctText += " " + cellText(ws.getCell(r, c).value);
      const m = pctText.match(/(\d+(?:[.,]\d+)?)\s*%/);
      if (m) totals.vatPercent = Number(m[1].replace(",", "."));
    } else if (/^(GIAM GIA|CHIET KHAU|DISCOUNT)/.test(label)) totals.discount = Math.abs(val);   // file ghi số ÂM
    else if (/^(THANH TIEN|GRAND TOTAL)/.test(label)) totals.total = val;
    else if (/^(TONG CONG|TONG|CONG|SUBTOTAL|SUB TOTAL|TOTAL)/.test(label) && totals.subtotal == null) totals.subtotal = val;
  }
  if (Object.keys(totals).length) base.totals = totals;

  // ── Đoán MẪU ──
  const guess = guessTemplate(ws, base, markerCode);
  base.templateCode = guess.code;
  base.templateName = guess.name;
  base.templateWhy = guess.why;

  // ── Cảnh báo mức sheet ──
  // CỘT CHI TIẾT: cảnh báo hay không PHỤ THUỘC MẪU, nên phải đứng sau bước đoán mẫu ở trên.
  // Colorfull nay HIỆN cột này (templateConfigs: `clofull_decor.items.removeDetail = false`) →
  // nội dung nạp vào và in ra đúng chỗ, báo "sẽ không được nạp" là nói sai với người dùng.
  // Các mẫu KHÔNG hiện cột thì giữ nguyên cảnh báo cũ, y nguyên câu chữ.
  const detailRows = base.items.filter((it) => String(it.detail || "").trim()).length;
  if (detailRows) {
    const itemsCfgCuaMau = base.templateCode ? TEMPLATE_CONFIGS[base.templateCode]?.items : null;
    const mauHienChiTiet = !!itemsCfgCuaMau?.columns?.detail && !itemsCfgCuaMau?.removeDetail;
    if (!mauHienChiTiet) base.warnings.push(`File có ${detailRows} dòng chứa cột Chi Tiết. Trường này đã bỏ khỏi báo giá nên nội dung đó sẽ không được nạp.`);
  }
  // CÒN HẠNG MỤC PHÍA DƯỚI? Bảng dừng ở dòng tổng / khoảng trống dài; nếu bên dưới vẫn còn dòng
  // trông như hạng mục (có ĐVT + Số Lượng) thì phải BÁO, tuyệt đối không bỏ qua âm thầm.
  if (stopRow) {
    const tail: number[] = [];
    for (let r = stopRow + 1; r <= Math.min(lastSheetRow, stopRow + 400); r++) {
      if (!isBlank(cellAt(r, "unit")) && !isBlank(cellAt(r, "quantity")) && !isBlank(cellAt(r, "unitPrice"))) tail.push(r);
    }
    if (tail.length) {
      base.warnings.push(`Còn ${tail.length} dòng trông như hạng mục nằm DƯỚI phần tổng (dòng ${tail[0]}…) — app chỉ nạp phần bảng phía trên, hãy kiểm tra lại file.`);
    }
  }
  // Chế độ Thay trên web giữ ảnh đang có của dòng còn khớp (importApply.giuTruongChiApp, L48) — câu này
  // chỉ còn nói phần đúng: ảnh NẰM TRONG FILE không đọc được, dòng mới phải thêm ảnh tay.
  // TIÊU ĐỀ 2 TẦNG (L52): ô tiêu đề một cột SỐ gộp NGANG nhiều cột, hàng ngay dưới chia cột con
  // ("Đơn giá" → "Vật tư | Nhân công"). App chỉ đọc được cột con ĐẦU — Đơn Giá hụt phần còn lại. Dòng
  // lệch đã có cảnh báo Thành Tiền riêng, nhưng không câu nào nói VÌ SAO; nói ở cấp sheet.
  // Hàng dưới phải TRÔNG NHƯ hàng tiêu đề con (soát toàn diện đợt 3): CẢ cột con đầu lẫn cột con thứ hai
  // đều có chữ RIÊNG không phải số. Tiêu đề gộp ngang chỉ để trang trí (F3:G3) mà hàng dưới là dòng chữ
  // gộp cả bảng ("* Thông tin chương trình: …" A4:H4 — ô mượn giá trị ô chủ cột khác) hay dòng nhóm có
  // chữ ở cột tiền ("A | PHẦN DỰNG | … | Theo thực tế", cột con thứ hai trống) thì không phải tiêu đề con.
  const chuRieng = (r: number, col: number) => {
    const o = ws.getCell(r, col), m = o.isMerged ? o.master : null;
    if (m && (coordNum(m.row, false) !== r || coordNum(m.col, true) !== col)) return "";   // ô phụ của vùng gộp
    const t = cellText(o.value).trim();
    return /^[\d\s.,()%₫đ$-]*$/i.test(t) ? "" : t;   // trống hoặc là SỐ (dữ liệu) → không phải tiêu đề con
  };
  for (const [role, vn] of [["quantity", "Số Lượng"], ["days", "Số Ngày"], ["unitPrice", "Đơn Giá"], ["_amount", "Thành Tiền"]] as const) {
    const c = colOf[role];
    if (!c) continue;
    const ben = ws.getCell(hit.row, c + 1), m = ben.isMerged ? ben.master : null;
    if (!m || coordNum(m.row, false) !== hit.row || coordNum(m.col, true) !== c) continue;
    const t = chuRieng(hit.row + 1, c);
    if (!t || !chuRieng(hit.row + 1, c + 1)) continue;
    base.warnings.push(`Tiêu đề nhiều tầng: cột ${vn} (${colLetter(c)}) gộp ngang nhiều cột con — app chỉ đọc cột con đầu tiên “${t}”, các cột con còn lại KHÔNG được cộng vào. Kiểm tra lại ${vn} từng dòng.`);
  }
  if (base.showImages) base.warnings.push("File có cột HÌNH ẢNH — ảnh trong file KHÔNG nạp lại được. Dòng còn khớp với sheet đích giữ nguyên ảnh đang có; dòng mới cần thêm ảnh thủ công sau khi nạp.");
  if (base.stats.formulasDropped) base.warnings.push(`${base.stats.formulasDropped} công thức không nạp được (đã giữ con số) — xem cột Cảnh báo từng dòng.`);
  if (!base.items.length) base.warnings.push("Không đọc được hạng mục nào trong bảng.");
  if (daCat)
    base.warnings.push(
      `Bảng có ${base.items.length + daCat} dòng, app lưu tối đa ${MAX_ITEMS_PER_SHEET} dòng/sheet — ` +
        `ĐÃ CẮT ${daCat} dòng cuối. Phần dư cần tách sang sheet khác rồi nạp lại.`,
    );
  // Thiếu cột thì app phải ĐOÁN cấu trúc, và đoán sai là mất tiền/mất nhóm mà người dùng không hay.
  // Nói thẳng ra ngay trên bảng đối chiếu để họ soi lại trước khi bấm nạp.
  {
    const thieu: string[] = [];
    if (!colOf._stt) thieu.push("STT");
    if (!colOf.unit) thieu.push("ĐVT");
    if (!colOf.quantity) thieu.push("Số Lượng");
    if (!colOf.unitPrice) thieu.push("Đơn Giá");
    if (thieu.length) {
      base.warnings.push(
        `File không có cột ${thieu.join(" / ")} — app phải tự đoán đâu là nhóm, đâu là hạng mục` +
        (!colOf._stt && !colOf.unit ? " (thiếu cả STT lẫn ĐVT thì chỉ dựa vào Số Lượng để phân biệt)" : "") +
        ". Hãy soi kỹ cột “Loại” trong bảng đối chiếu trước khi nạp.",
      );
    }
  }
  if (totals.subtotal != null) {
    const calc = computeSubtotal(base);
    if (Math.abs(calc - totals.subtotal) > Math.max(2, Math.abs(totals.subtotal) * 0.005)) {
      base.warnings.push(`Tổng cộng tự tính (${calc.toLocaleString("vi-VN")}) lệch với "Tổng Cộng" ghi trong file (${totals.subtotal.toLocaleString("vi-VN")}) — kiểm tra các dòng có cảnh báo.`);
    }
  }
  return base;
}

/** Tổng tiền của sheet theo đúng cách app tính (mục con cộng vào nhóm; nhóm ×SL khi bật). */
export function computeSubtotal(s: Pick<ImportedSheet, "items" | "hasDays" | "groupSubtotal">): number {
  // Nhân CHÍNH XÁC rồi làm tròn — khớp src/money.ts (XLSX-06). Double lệch 1đ ở giá không chia hết 10.
  const line = (it: ImportedItem) => nhanLamTronDong(qtyForAmount(it), s.hasDays ? (Number(it.days) || 1) : 1, Number(it.unitPrice) || 0);
  if (!s.groupSubtotal) return s.items.reduce((a, it) => (it.kind === "item" || it.kind === "sub" ? a + line(it) : a), 0);
  let total = 0, mult = 1, seen = false;
  for (const it of s.items) {
    if (it.kind === "section" || it.kind === "subsection") { mult = Math.max(1, qtyForAmount(it) || 1); seen = true; continue; }
    if (it.kind === "item" || it.kind === "sub") total += line(it) * (seen ? mult : 1);
  }
  return total;
}

/** Đoán mẫu báo giá của sheet: cột Số Ngày, cách đánh số nhóm con, tên sheet, màu nhóm, chữ cột. */
function guessTemplate(ws: ExcelJS.Worksheet, s: ImportedSheet, markerCode?: string | null) {
  if (markerCode && TEMPLATE_CONFIGS[markerCode]) {
    const cfg = TEMPLATE_CONFIGS[markerCode];
    return { code: markerCode, name: cfg.displayName || markerCode, why: "mã mẫu được nhúng trong file xuất", score: 999 };
  }
  let best: { code: string | null; name: string | null; why: string; score: number } = { code: null, name: null, why: "", score: -99 };
  const sheetName = normHdr(ws.name);
  const nameCol = s.columns?.name ? colIndex(s.columns.name) : 0;
  const sectionFills = new Set<string>();
  if (nameCol) for (const it of s.items) if (it.kind === "section") sectionFills.add(fillOf(ws.getCell(it.row, nameCol)));

  for (const [code, cfg] of Object.entries(TEMPLATE_CONFIGS)) {
    const cols: Record<string, string> = cfg.items?.columns || {};
    const why: string[] = [];
    let score = 0;
    if (!!cols.days === s.hasDays) { score += 3; why.push(s.hasDays ? "có cột Số Ngày" : "không có cột Số Ngày"); } else score -= 8;
    if (!!cfg.items?.numberSubsections === s.numberSubs) { score += 2; if (s.numberSubs) why.push("nhóm con đánh số"); } else score -= 3;
    // CỘT CHI TIẾT — dấu hiệu DUY NHẤT tách nhóm mẫu Colorfull khỏi nhóm mẫu Gia Nguyễn.
    //
    // Trước đây vòng chấm này không nhìn tới nó, nên bằng chứng duy nhất còn lại là MÀU NỀN HÀNG
    // NHÓM (+3) — thứ chỉ có ở file do chính app xuất ra. File Colorfull do khách/đối tác gửi tới,
    // bảng phẳng không có hàng nhóm tô màu, sẽ về hoà điểm rồi rơi vào mẫu GN đứng trước trong
    // `TEMPLATE_CONFIGS`. Hậu quả dây chuyền: cửa sổ nạp dán nhãn "Dạng file: GN (không ngày)",
    // ghép sai sheet đích, và cảnh báo "cột Chi Tiết sẽ không được nạp" thì bật/tắt theo mẫu ĐOÁN
    // SAI chứ không theo mẫu thật.
    //
    // Đặt +3/−6: cùng hạng với cột Số Ngày (+3/−8) vì cũng là khác biệt CẤU TRÚC BẢNG nhìn thấy
    // được, không phải chuyện trình bày. `hienChiTiet` = mẫu thật sự IN cột đó ra (khai `detail`
    // VÀ không gộp nó vào Hạng Mục) — đúng thứ người đọc file nhìn thấy.
    const hienChiTiet = !!cols.detail && !cfg.items?.removeDetail;
    const fileCoChiTiet = s.columns?.detail != null;
    if (hienChiTiet === fileCoChiTiet) { score += 3; if (fileCoChiTiet) why.push("có cột Chi Tiết"); } else score -= 6;
    // Tên tab do người dùng tự đặt → bằng chứng YẾU hơn màu nhóm (màu do chính app tô lúc xuất).
    if (cfg.sheetName && sheetName.includes(normHdr(cfg.sheetName))) { score += 2; why.push(`tên sheet "${cfg.sheetName}"`); }
    for (const role of ["name", "unit", "quantity", "unitPrice"]) {
      if (cols[role] && s.columns?.[role] === cols[role]) score += 0.5;
    }
    if (cols.amount && s.columns?._amount === cols.amount) score += 0.5;
    // Màu nền hàng nhóm: dấu vân tay do CHÍNH app tô lúc xuất → bằng chứng mạnh nhất.
    const wantFill = String(cfg.items?.sectionFill || "FFFAE9DB").toUpperCase();
    if (sectionFills.size && sectionFills.has(wantFill)) { score += 3; why.push("màu nhóm khớp"); }
    if (score > best.score) best = { code, name: cfg.displayName || code, why: why.join(" · "), score };
  }
  return best;
}

/**
 * Đọc file .xlsx báo giá → danh sách sheet + hạng mục theo đúng cấu trúc lưới của app.
 * KHÔNG ném lỗi vì 1 sheet hỏng: sheet nào không đọc được thì đánh dấu `skipped`.
 */
/**
 * BÓC TIỀN TỐ THỨ TỰ "N. " mà `buildQuoteBuffer` thêm vào TÊN TAB.
 *
 * Lúc xuất, báo giá NHIỀU sheet được đánh số tab: "Banner" → "1. Banner". Nạp lại mà giữ nguyên
 * thì tên phình thêm một lớp sau MỖI vòng xuất–nhập ("1. 1. Banner"), và người dùng nhìn thấy
 * đúng chuỗi rác đó trên tab lẫn trong file gửi khách lần sau. (Đo được 2026-09-07 trên
 * BaoGia_GN26073 - 0902.xlsx: tab hiện "1. Banner", "2. Ticketbox", "4. LCD"…)
 *
 * BA ĐIỀU KIỆN, đủ chặt để KHÔNG BAO GIỜ cắt nhầm tên thật của khách:
 *   1. file do CHÍNH app xuất — có mã mẫu nhúng ở ô A1 (`fromApp`);
 *   2. có TỪ 2 sheet dữ liệu trở lên — một sheet thì `buildQuoteBuffer` KHÔNG đánh số, nên "2. "
 *      trong tên là của người dùng;
 *   3. con số phải ĐÚNG BẰNG vị trí của sheet đó trong file — "3. LCD" nằm ở vị trí 3 mới bóc.
 * Thiếu bất kỳ điều nào thì để nguyên tên.
 */
function bocTienToThuTu(sheets: ImportedSheet[]): void {
  const doc = sheets.filter((s) => !s.skipped);
  if (doc.length < 2) return;
  doc.forEach((s, i) => {
    if (!s.fromApp) return;
    const m = /^\s*(\d{1,3})\s*\.\s+(.+)$/.exec(s.name);
    if (!m || Number(m[1]) !== i + 1) return;
    const boc = m[2].trim();
    if (boc) s.name = boc;
  });
}

export async function parseQuoteWorkbook(buffer: Buffer): Promise<ImportResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheets: ImportedSheet[] = [];
  const warnings: string[] = [];
  wb.eachSheet((ws, id) => {
    // Trần số sheet: file 10MB nén cao có thể chứa rất nhiều sheet → không để 1 request ngốn hết CPU.
    if (sheets.length >= MAX_SHEETS) {
      if (sheets.length === MAX_SHEETS) warnings.push(`File có quá nhiều sheet — app chỉ đọc ${MAX_SHEETS} sheet đầu.`);
      sheets.push({ ...emptySheet(sheets.length, ws.name || `Sheet ${id}`), skipped: "Vượt giới hạn số sheet đọc được" });
      return;
    }
    try {
      sheets.push(parseSheet(ws, sheets.length));
    } catch (e) {
      sheets.push({
        ...emptySheet(sheets.length, ws.name || `Sheet ${id}`),
        skipped: `Lỗi đọc sheet: ${e instanceof Error ? e.message : "không rõ"}`,
      });
    }
  });
  bocTienToThuTu(sheets);
  if (!sheets.some((s) => !s.skipped && s.items.length)) {
    warnings.push("Không tìm thấy bảng báo giá nào trong file. File cần có hàng tiêu đề kiểu: STT | Hạng Mục | ĐVT | Số Lượng | Đơn Giá | Thành Tiền.");
  }
  return { sheets, warnings };
}
