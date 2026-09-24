// ┌─────────────────────────────────────────────────────────────────────────────┐
// │ shared/quote-math.ts — NGUỒN DUY NHẤT (single source) toán tiền + định dạng     │
// │ báo giá, dùng CHUNG cho frontend (web/) và (dần) backend. Thuần: KHÔNG DOM,     │
// │ KHÔNG Prisma/Decimal → import được ở mọi nơi (Vite, tsx, node, vitest).         │
// │ Backend `src/money.js` dùng Decimal cho độ chính xác DB; test `tests/money-      │
// │ parity` khóa 2 cài đặt KHÔNG ĐƯỢC LỆCH. Sửa chính sách làm tròn ở ĐÂY (1 chỗ).  │
// └─────────────────────────────────────────────────────────────────────────────┘
export type ItemKind = "item" | "sub" | "section" | "subsection" | "info";
export type Item = {
  kind: ItemKind; label?: string; name?: string; detail?: string; unit?: string;
  quantity?: number; quantityExact?: boolean; days?: number | null; unitPrice?: number; notes?: string; internalNote?: string;
  approved?: boolean; approvedAt?: string | null; approvedBy?: number | null;
  formulas?: Record<string, string>; order?: number;
  images?: string[];   // MẢNG ảnh base64 data-URL (cột "Hình ảnh", chỉ khi sheet.showImages)
};
export type Sheet = { id?: number; codeNo?: number | null; templateId?: number; name?: string | null; groupSubtotal?: boolean; showImages?: boolean; discount?: number; order?: number; items: Item[]; extraTables?: unknown[] };
export type TemplateLayout = { hasDays?: boolean; hasDetail?: boolean; numberSubsections?: boolean };
export type Template = { id: number; code?: string; name: string; companyId?: number; layout?: TemplateLayout };
export type Company = { id: number; name: string; shortName?: string; address?: string };

export const fmtMoney = (n?: number | null) => (n == null || isNaN(Number(n)) ? "0" : Number(n).toLocaleString("vi-VN"));
export const roundVnd = (n: number) => Math.round(Number(n) || 0);

// LÀM TRÒN Số Lượng về 1 chữ số thập phân (7,378→7,4; 6,42→6,4). +1e-6 khử nhiễu float để 5,65→5,7
// khớp Decimal ROUND_HALF_UP(1) của server. 1 nguồn cho hiển thị Số Lượng lẫn tính Thành Tiền.
export function qtyRound(x: number) {
  const n = Number(x) || 0;
  const t = Math.round(Math.abs(n) * 10 + 1e-6) / 10;
  return n < 0 ? -t : t;
}
/** DB lưu tối đa 4 số lẻ. Dùng cho dòng Excel ngoài có Thành Tiền tính theo số gốc. */
export function qtyExact(x: number) {
  const n = Number(x) || 0;
  const t = Math.round(Math.abs(n) * 10_000 + 1e-8) / 10_000;
  return n < 0 ? -t : t;
}
export const qtyForAmount = (it: Pick<Item, "quantity" | "quantityExact">) =>
  it.quantityExact ? qtyExact(Number(it.quantity) || 0) : qtyRound(Number(it.quantity) || 0);

// ── NHÂN TIỀN CHÍNH XÁC (soát chéo money#6 / excel#11) ───────────────────────────────────────
// XLSX-06 đưa PDF, số cache trong ô Excel và bảng nhập Excel sang phép nhân của src/tienDong.ts
// (khớp Decimal ROUND_HALF_UP của src/money.ts từng đồng). Lưới web mà còn `Math.round(q * p)` thì
// 0,7 × 163.845 = 114691,4999… hiện 114.691 trong khi tệp gửi khách ghi 114.692.
// BẢN SAO của src/tienDong.ts — shared/ không import được src/ và ngược lại (rootDir=src, container
// không có shared/). tests/xt-luoi-web-tien-dong.test.js chạy hai bản trên cùng dữ liệu.
// Viết `BigInt(0)` chứ KHÔNG viết literal `0n`: web build target es2017 (vite.config.ts), literal
// BigInt không có ở target đó (esbuild cảnh báo "may crash at run-time") — trình duyệt cũ vấp lỗi cú
// pháp là sập CẢ bundle. Gọi hàm thì chỉ cần tránh gọi: không có BigInt (Safari < 14) → nhánh dự phòng.
const CO_BIGINT = typeof BigInt === "function";

/** Số → [phần nguyên đã bỏ dấu phẩy (BigInt, có dấu), số chữ số thập phân] — y như src/tienDong.ts. */
function tachSo(x: number): [bigint, number] {
  if (!Number.isFinite(x) || x === 0) return [BigInt(0), 0];
  let s = String(x);
  if (/e/i.test(s)) s = Math.abs(x) < 1 ? x.toFixed(20).replace(/0+$/, "").replace(/\.$/, "") : BigInt(Math.round(x)).toString();
  const am = s.startsWith("-");
  if (am) s = s.slice(1);
  const [nguyen, le = ""] = s.split(".");
  const m = BigInt(nguyen + le || "0");
  return [am ? -m : m, le.length];
}

/** Tích các thừa số, làm tròn nửa-lên theo độ lớn (ROUND_HALF_UP, -2,5 → -3) — khớp src/tienDong.ts. */
export function nhanLamTronDong(...thuaSo: number[]): number {
  // ĐƯỜNG TẮT: hàm chạy ~2.600 lần mỗi lượt vẽ lưới. Sai số của tích double chỉ cỡ 1e-15 tương
  // đối, nên phần lẻ cách ,5 xa hơn ngưỡng dưới đây thì làm tròn double cho ĐÚNG kết quả của phép
  // nhân chính xác. Chỉ tích rơi sát ,5 (hoặc số khổng lồ) mới đi đường BigInt.
  let x = 1;
  for (const t of thuaSo) x *= Number(t) || 0;
  const ax = Math.abs(x);
  if (Math.abs(ax - Math.floor(ax) - 0.5) > 1e-9 + ax * 1e-12) return Math.round(x) || 0;   // `|| 0`: không trả -0
  if (!CO_BIGINT) {
    const r = Number(x.toPrecision(15));   // khử nhiễu double: 61,49999999999999 → 61,5
    return (r < 0 ? -Math.round(-r) : Math.round(r)) || 0;
  }
  let m = BigInt(1);
  let thapPhan = 0;
  for (const t of thuaSo) {
    const [a, b] = tachSo(Number(t) || 0);
    m *= a;
    thapPhan += b;
  }
  if (thapPhan === 0) return Number(m) || 0;
  const chia = BigInt(10) ** BigInt(thapPhan);
  const am = m < BigInt(0);
  const tri = am ? -m : m;
  let thuong = tri / chia;
  if ((tri % chia) * BigInt(2) >= chia) thuong += BigInt(1);
  return Number(am ? -thuong : thuong) || 0;
}

// Thành Tiền 1 dòng: mặc định SL làm tròn 1 số; dòng quantityExact dùng tối đa 4 số lẻ theo file Excel.
export function lineAmount(it: Item, usesDays: boolean) {
  const q = qtyForAmount(it), d = Number(it.days) || 1, p = Number(it.unitPrice) || 0;
  return usesDays ? nhanLamTronDong(q, d, p) : nhanLamTronDong(q, p);
}
/** Hệ số nhân của hàng NHÓM = Số Lượng của nhóm, lấy ĐÚNG con số đang hiển thị trên lưới
 *  (qtyRound 1 số lẻ, hoặc 4 số lẻ với dòng quantityExact). Lấy số thô thì ô hiện "2,4" mà tiền
 *  nhân 2,4213 — người dùng lẫn khách không đối chiếu nổi. Tối thiểu 1 (nhóm bỏ trống = ×1). */
export const groupMult = (it: Pick<Item, "quantity" | "quantityExact">) => Math.max(1, qtyForAmount(it) || 1);
// Tổng sheet có hệ số nhóm: section.Số Lượng nhân các dòng dưới nó (tới section kế); section tự nó = 0.
export function sheetSubtotalGrouped(items: Item[], usesDays: boolean, groupSubtotal?: boolean) {
  let mult = 1, sum = 0;
  for (const it of items || []) {
    if (it.kind === "section" || it.kind === "subsection") { mult = groupSubtotal ? groupMult(it) : 1; continue; }
    if (it.kind === "info") continue;
    sum += lineAmount(it, usesDays) * mult;
  }
  return sum;
}
// ── GIẢM GIÁ (Discount) sống ở MỨC SHEET, và trừ TRƯỚC khi tính VAT ───────────────────────────
//     Cộng → Discount → Tổng Cộng → VAT(Tổng Cộng) → Thành Tiền
// Đây là bố cục file khách đang dùng, nên VAT PHẢI tính trên số đã trừ. `Quote.discount` chỉ còn
// là TỔNG các sheet (suy ra). Mirror ở src/money.ts — sửa chính sách thì sửa CẢ HAI.
/** Giảm giá của MỘT sheet, kẹp vào [0, tổng sheet] → Tổng Cộng của sheet không bao giờ âm vì Discount. */
export function sheetDiscountOf(gross: number, raw?: number | null) {
  const d = roundVnd(raw || 0);
  if (d <= 0) return 0;
  const cap = Math.max(0, roundVnd(gross));
  return d > cap ? cap : d;
}
/** Khối tổng của MỘT sheet: Cộng (chưa trừ) · Discount · Tổng Cộng (= net, số sheet đóng góp). */
export function sheetTotals(sheet: Pick<Sheet, "items" | "groupSubtotal" | "discount">, usesDays: boolean) {
  const gross = roundVnd(sheetSubtotalGrouped(sheet.items || [], usesDays, sheet.groupSubtotal));
  const discount = sheetDiscountOf(gross, sheet.discount);
  return { gross, discount, net: gross - discount };
}
export type SheetTotals = ReturnType<typeof sheetTotals>;
/** Tổng báo giá từ khối tổng của từng sheet. `subtotal` = Σ Tổng Cộng (ĐÃ trừ Discount) → VAT tính trên nó. */
export function quoteTotals(per: SheetTotals[], vatPct?: number) {
  const gross = roundVnd(per.reduce((a, x) => a + x.gross, 0));
  const discount = roundVnd(per.reduce((a, x) => a + x.discount, 0));
  const subtotal = roundVnd(per.reduce((a, x) => a + x.net, 0));
  const vat = roundVnd((subtotal * (Number(vatPct) || 0)) / 100);
  return { gross, discount, subtotal, vat, total: subtotal + vat };
}
// 0→"A", 25→"Z", 26→"AA". Chữ nhóm tự động.
export function groupLetter(n: number) {
  let s = "", x = n + 1;
  while (x > 0) { const m = (x - 1) % 26; s = String.fromCharCode(65 + m) + s; x = Math.floor((x - 1) / 26); }
  return s;
}
// Ô số: dấu chấm nghìn VN, RỖNG khi 0 (tránh ô đầy "0"); Số Lượng làm tròn 1 chữ số thập phân (7,4).
// GRID-10: toLocaleString CÓ options dựng một bộ định dạng ICU MỚI mỗi lần gọi (đo: 16µs/lần, so với
// 0,38µs khi dùng lại) — một lượt vẽ lưới 378 dòng gọi ~2.600 lần = ~43ms chỉ để định dạng số, lặp lại
// ở mỗi Enter / dán / phím công thức. Dùng lại hai bộ định dạng dựng sẵn: cùng locale, cùng options
// nên đầu ra y hệt (có bài kiểm so từng giá trị với cách cũ).
const NF_1 = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 });
const NF_4 = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 4 });
export function fmtNumCell(v?: number | string, exact = false) {
  const t = exact ? qtyExact(Number(v) || 0) : qtyRound(Number(v) || 0);
  if (!t || isNaN(t)) return "";
  return (exact ? NF_4 : NF_1).format(t);
}
// "1.234.567" / "12,5" / "-5.000" → số.
export function parseVN(s: string | number) {
  let str = String(s).replace(/[^\d.,-]/g, "");
  if (!str || str === "-") return 0;
  const neg = str.startsWith("-");
  str = str.replace(/-/g, "").replace(/\./g, "");
  const parts = str.split(",");
  const num = parts.length > 1 ? Number(parts[0] + "." + parts.slice(1).join("")) : Number(parts[0]);
  return (neg ? -1 : 1) * (num || 0);
}
// Gom nghìn LIVE khi đang gõ (cho phép dấu phẩy thập phân dở dang).
export function liveFormat(raw: string) {
  let s = String(raw).replace(/[^\d.,-]/g, "");
  const neg = s.startsWith("-");
  s = s.replace(/-/g, "").replace(/\./g, "");
  const [intpRaw, ...rest] = s.split(",");
  const intp = intpRaw.replace(/^0+(?=\d)/, "");
  const grouped = intp ? Number(intp).toLocaleString("vi-VN") : "";
  const out = rest.length ? (grouped || "0") + "," + rest.join("") : grouped;
  return (neg ? "-" : "") + out;
}
export function vnDateText(d?: string, city?: string) {
  const dt = d ? new Date(d) : new Date();
  if (isNaN(dt.getTime())) return city || "TP. Hồ Chí Minh";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${city || "TP. Hồ Chí Minh"}, ngày ${p(dt.getDate())} tháng ${p(dt.getMonth() + 1)} năm ${dt.getFullYear()}`;
}
export const fmtDate = (d?: string | null) => { if (!d) return ""; const dt = new Date(d); if (isNaN(dt.getTime())) return ""; const p = (n: number) => String(n).padStart(2, "0"); return `${p(dt.getDate())}/${p(dt.getMonth() + 1)}/${dt.getFullYear()}`; };

// Phân loại hàng hiển thị: head | sub | section | info (giống drawItems + pvRows).
export type RowKind = "head" | "sub" | "section" | "info";
export function computeRowKinds(items: Item[]): RowKind[] {
  const rk: RowKind[] = items.map(() => "head");
  for (let i = 0; i < items.length; i++) {
    const k = items[i].kind;
    if (k === "info") rk[i] = "info";
    else if (k === "section" || k === "subsection") rk[i] = "section";
    else if (k === "sub" && i > 0 && (rk[i - 1] === "head" || rk[i - 1] === "sub")) rk[i] = "sub";
    else rk[i] = "head";
  }
  return rk;
}
export const rowspanOf = (rk: RowKind[], i: number) => { let s = 1, j = i + 1; while (j < rk.length && rk[j] === "sub") { s++; j++; } return s; };

// Factory hàng trống (giống editor.js).
export const blankItem = (usesDays: boolean): Item => ({ kind: "item", name: "", detail: "", unit: "", quantity: 0, unitPrice: 0, days: usesDays ? 1 : null, notes: "" });
export const blankSub = (usesDays: boolean): Item => ({ kind: "sub", name: "", detail: "", unit: "", quantity: 0, unitPrice: 0, days: usesDays ? 1 : null, notes: "" });
export const blankInfo = (): Item => ({ kind: "info", name: "", detail: "", unit: "", quantity: 0, unitPrice: 0, days: null, notes: "" });
export const blankSection = (): Item => ({ kind: "section", label: "", name: "", detail: "", unit: "", quantity: 0, unitPrice: 0, days: null, notes: "" });
export const blankSubSection = (): Item => ({ kind: "subsection", label: "", name: "", detail: "", unit: "", quantity: 0, unitPrice: 0, days: null, notes: "" });

export const STATUS_LABEL: Record<string, string> = { draft: "Nháp", pending: "Chờ duyệt", approved: "Đã duyệt", rejected: "Bị từ chối", sent: "Đã gửi", converted: "Đã chốt", lost: "Không chốt" };
export const statusLabel = (s: string) => STATUS_LABEL[s] || s || "—";
export const codeLabel = (q: { projectCode?: string | null; projectVersion?: number | null; quoteNumber?: string }) => { const c = q.projectCode || q.quoteNumber || ""; return q.projectVersion && q.projectVersion > 1 ? `${c}_v${q.projectVersion}` : c; };
/**
 * MÃ SẢN XUẤT CỦA MỘT SHEET = mã báo giá + hậu tố HAI CHỮ SỐ ("_01", "_02").
 * `codeNo` là SỐ ĐÃ ĐÓNG BĂNG trong CSDL (`QuoteSheet.codeNo`), KHÔNG phải vị trí trong mảng —
 * xoá sheet 02 thì 03 vẫn là 03. Báo giá MỘT sheet thì không có hậu tố.
 * ⚠️ MIRROR của src/quoteCode.ts; tests/projectcode-parity.test.js khoá hai bản không được lệch.
 */
export function sheetCode(q: { projectCode?: string | null; projectVersion?: number | null; quoteNumber?: string }, codeNo: number, total: number) {
  const base = codeLabel(q);
  return total > 1 ? `${base}_${String(codeNo).padStart(2, "0")}` : base;
}
/** `codeNo` đã cấp, hoặc vị trí + 1 cho dữ liệu cũ chưa backfill. */
export const soMa = (sh: { codeNo?: number | null } | null | undefined, i: number) =>
  sh && sh.codeNo != null && sh.codeNo > 0 ? sh.codeNo : i + 1;

