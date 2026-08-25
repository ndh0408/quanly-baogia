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

/** Màu nền hàng NHÓM / NHÓM CON do app tô lúc xuất (excel.ts) — dấu hiệu chắc nhất. */
const FILL_SECTION = new Set(["FFFAE9DB", "FFFCEFDB", "FFE2EFDA"]);
const FILL_SUB = new Set(["FFC9D9EF", "FFEAF1FB"]);
/** Màu nền hàng TIÊU ĐỀ CỘT — phụ trợ khi nhận diện hàng tiêu đề. */
const FILL_HEADER = new Set(["FFF3C9A1", "FFFFCC99"]);
const TEMPLATE_MARKER_PREFIX = "__QUANLY_TEMPLATE__:";

/** Chữ mở đầu các dòng TỔNG / chân trang → hết bảng hạng mục. */
const RE_TOTALS = /^(TONG CONG|TONG|CONG|VAT|THANH TIEN|GIAM GIA|CHIET KHAU|TOTAL|SUBTOTAL|SUB TOTAL|GRAND TOTAL)\b/;
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
/** Trần dòng/sheet khi LƯU — phải khớp sheetSchema trong src/validators.ts. */
export const MAX_ITEMS_PER_SHEET = 2000;

/** Giá trị ô (mọi kiểu ExcelJS) → chuỗi hiển thị. */
function cellText(v: unknown): string {
  if (v == null) return "";
  // Ô CHỮ do app xuất ra có thể được thêm dấu ' ở đầu để Excel không hiểu nhầm là công thức
  // (neutralizeFormula ở excel.ts). Đọc ngược phải BÓC ra, nếu không mỗi vòng xuất→nhập lại
  // cộng thêm một dấu nháy vào tên hạng mục.
  if (typeof v === "string") return v.replace(/^'(?=[=+\-@\t\r])/, "");
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const o = v as Record<string, unknown>;
  if (Array.isArray(o.richText)) return (o.richText as { text?: string }[]).map((r) => r.text || "").join("");
  if (o.formula !== undefined || o.sharedFormula !== undefined) return cellText(o.result);
  if (typeof o.text === "string") return o.text;
  return "";
}

// Số kiểu VN/US — PORT từ web/src/lib/clipboard.ts (giữ khớp hành vi dán tay).
function parseLooseNumber(s: string): number {
  let str = String(s).trim().replace(/[^\d.,-]/g, "");
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
  let str = String(s).trim().replace(/[^\d.,-]/g, "");
  if (!str || str === "-") return 0;
  const neg = str.startsWith("-"); str = str.replace(/-/g, "");
  const dots = (str.match(/\./g) || []).length, commas = (str.match(/,/g) || []).length;
  if (dots && commas) str = str.lastIndexOf(",") > str.lastIndexOf(".") ? str.replace(/\./g, "").replace(",", ".") : str.replace(/,/g, "");
  else if (dots + commas > 1) str = str.replace(/[.,]/g, "");
  else str = str.replace(",", ".");
  const n = Number(str) || 0;
  return neg ? -n : n;
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

/** Số của 1 ô: ưu tiên số thật / kết quả công thức; chuỗi thì đọc kiểu VN. */
function numOf(cell: Cell | null, decimal = false): number {
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
  return decimal ? parseLooseDecimal(t) : parseLooseNumber(t);
}
const isBlank = (cell: Cell | null) => !cell || cellText(cell.value).trim() === "";
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

  // Dòng nhóm của file ngoài thường vẫn có ĐVT + Số Lượng, còn Đơn Giá là tổng các ô Thành Tiền
  // bên dưới (vd `=SUM(H13:H18)` hoặc `=H30`). Đây là dấu hiệu cấu trúc mạnh hơn việc ô ĐVT trống.
  const amountLetter = colOf._amount ? colLetter(colOf._amount) : "";
  const hasGroupPriceFormula = (r: number) => {
    const fx = fxOf(cellAt(r, "unitPrice"));
    if (!fx || !amountLetter) return false;
    const refs = [...fx.matchAll(/\$?([A-Z]{1,3})\$?\d+/gi)].map((m) => m[1].toUpperCase());
    return refs.length > 0 && refs.every((L) => L === amountLetter);
  };

  // ── Quét thô: chốt dòng cuối của bảng + nhận diện kiểu BANNER (nhóm con đánh SỐ) ──
  const lastSheetRow = ws.rowCount || hit.row;
  const scanEnd = Math.min(lastSheetRow, hit.row + MAX_SCAN_ROWS);
  let lastRow = hit.row;
  let blankRun = 0;
  let stopRow = 0;              // dòng làm bảng dừng (dòng tổng / chân trang / khoảng trống dài)
  const bodyRows: number[] = [];
  for (let r = hit.row + 1; r <= scanEnd; r++) {
    const stt = textAt(r, "_stt"), name = textAt(r, "name");
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
  base.firstRow = bodyRows[0];
  base.lastRow = lastRow;
  base.stats.rows = bodyRows.length;

  // Bản BANNER: nhóm con đánh SỐ (STT số + có tên + KHÔNG ĐVT + có giá) → hàng STT-trống là MỤC.
  const numberedSub = bodyRows.some((r) => {
    const stt = textAt(r, "_stt"), name = textAt(r, "name");
    if (!/^\d+$/.test(stt) || !name) return false;
    const fill = fillOf(cellAt(r, "name")) || fillOf(cellAt(r, "_stt"));
    return FILL_SUB.has(fill) || hasGroupPriceFormula(r)
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
    const merged = !!nameCell?.isMerged && coordNum(nameCell.master?.row, false) < r;
    let name = merged ? "" : cellText(nameCell?.value).trim();

    // Dòng CHỮ TỰ DO chạy ngang cả bảng (mẫu CLF gộp B5:I5 "* Thông tin chương trình: …") — chữ
    // nằm ở ô chủ thuộc cột STT. Đây chính là dòng kind="info" của app → trả về đúng dạng đó.
    const bannerText = (!name && stt && stt.length > 12 && !hasUnit && !hasQty && !hasPrice && !hasAmt) ? stt : "";

    const prevKind = raws.length ? raws[raws.length - 1].kind : null;
    let kind: ImportedKind;
    if (bannerText) { kind = "info"; name = bannerText.replace(/^\*\s*Thông tin chương trình\s*:\s*/i, "").trim(); }
    else if (merged) kind = "sub";
    else if (FILL_SECTION.has(fill)) kind = "section";
    else if (FILL_SUB.has(fill)) kind = "subsection";
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
    it.quantity = numOf(cellAt(r, "quantity"), true);
    it.unitPrice = isGroup ? 0 : numOf(cellAt(r, "unitPrice"));
    if (colOf.days) it.days = isGroup ? null : (numOf(cellAt(r, "days"), true) || null);
    if (kind === "info") { it.unit = ""; it.quantity = 0; it.unitPrice = 0; it.days = null; }

    // Ô SỐ mà lại là NGÀY THÁNG (khách gõ nhầm ô) → numOf trả 0, phải nói rõ để không âm thầm mất tiền.
    for (const [role, vn] of [["quantity", "Số Lượng"], ["unitPrice", "Đơn Giá"], ["days", "Số Ngày"]] as const) {
      if (colOf[role] && isDateCell(cellAt(r, role))) warn.push(`Ô ${vn} đang là NGÀY THÁNG, không phải số — đã để 0, cần nhập lại`);
    }

    // Thành Tiền trong file có khớp SL × ĐG (× Ngày) không? Lệch = khách sửa tay ô tổng → cảnh báo,
    // KHÔNG tự ý sửa số của khách.
    if ((kind === "item" || kind === "sub") && hasAmt) {
      const amt = numOf(cellAt(r, "_amount"));
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
      return Math.round(qtyForAmount(it) * (colOf.days ? (Number(it.days) || 1) : 1) * (Number(it.unitPrice) || 0));
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
  const detailRows = base.items.filter((it) => String(it.detail || "").trim()).length;
  if (detailRows) base.warnings.push(`File có ${detailRows} dòng chứa cột Chi Tiết. Trường này đã bỏ khỏi báo giá nên nội dung đó sẽ không được nạp.`);
  for (const x of raws) {
    if (x.kind === "item") base.stats.items++;
    else if (x.kind === "sub") base.stats.subs++;
    else if (x.kind === "section") base.stats.sections++;
    else if (x.kind === "subsection") base.stats.subsections++;
    else base.stats.infos++;
  }

  // Nhóm có ghi Thành Tiền ở dòng nhóm → báo giá này bật "tổng tiền theo nhóm".
  base.groupSubtotal = raws.some((x) => (x.kind === "section" || x.kind === "subsection") && !isBlank(cellAt(x.row, "_amount")));

  // ── Khối TỔNG dưới bảng: Tổng Cộng / VAT % / Giảm Giá / Thành Tiền ──
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
    const val = numOf(ws.getCell(r, amountCol));
    if (/^VAT/.test(label)) {
      totals.vat = val;
      let pctText = "";
      for (let c = 1; c <= scanCols; c++) pctText += " " + cellText(ws.getCell(r, c).value);
      const m = pctText.match(/(\d+(?:[.,]\d+)?)\s*%/);
      if (m) totals.vatPercent = Number(m[1].replace(",", "."));
    } else if (/^(GIAM GIA|CHIET KHAU)/.test(label)) totals.discount = val;
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
  if (base.showImages) base.warnings.push("File có cột HÌNH ẢNH — ảnh KHÔNG nạp lại được, cần thêm ảnh thủ công sau khi nạp.");
  if (base.stats.formulasDropped) base.warnings.push(`${base.stats.formulasDropped} công thức không nạp được (đã giữ con số) — xem cột Cảnh báo từng dòng.`);
  if (!base.items.length) base.warnings.push("Không đọc được hạng mục nào trong bảng.");
  if (base.items.length > MAX_ITEMS_PER_SHEET) base.warnings.push(`Bảng có ${base.items.length} dòng — app lưu tối đa ${MAX_ITEMS_PER_SHEET} dòng/sheet, phần dư cần tách sang sheet khác.`);
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
  const line = (it: ImportedItem) => Math.round(qtyForAmount(it) * (s.hasDays ? (Number(it.days) || 1) : 1) * (Number(it.unitPrice) || 0));
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
  if (!sheets.some((s) => !s.skipped && s.items.length)) {
    warnings.push("Không tìm thấy bảng báo giá nào trong file. File cần có hàng tiêu đề kiểu: STT | Hạng Mục | ĐVT | Số Lượng | Đơn Giá | Thành Tiền.");
  }
  return { sheets, warnings };
}
