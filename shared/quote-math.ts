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
export type Sheet = { id?: number; templateId?: number; name?: string | null; groupSubtotal?: boolean; showImages?: boolean; order?: number; items: Item[]; extraTables?: unknown[] };
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
// Thành Tiền 1 dòng: mặc định SL làm tròn 1 số; dòng quantityExact dùng tối đa 4 số lẻ theo file Excel.
export function lineAmount(it: Item, usesDays: boolean) {
  const q = qtyForAmount(it), d = Number(it.days) || 1, p = Number(it.unitPrice) || 0;
  return Math.round(usesDays ? q * d * p : q * p);
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
// Tổng báo giá: làm tròn subtotal, VAT từ subtotal đã tròn, kẹp giảm giá vào [0, gross]. Mirror money.js.
export function quoteTotals(subtotalRaw: number, vatPct?: number, discountRaw?: number) {
  const subtotal = roundVnd(subtotalRaw);
  const vat = roundVnd((subtotal * (Number(vatPct) || 0)) / 100);
  const gross = subtotal + vat;
  let discount = roundVnd(discountRaw || 0);
  if (discount < 0) discount = 0;
  if (discount > gross) discount = gross;
  return { subtotal, vat, discount, total: gross - discount };
}
// 0→"A", 25→"Z", 26→"AA". Chữ nhóm tự động.
export function groupLetter(n: number) {
  let s = "", x = n + 1;
  while (x > 0) { const m = (x - 1) % 26; s = String.fromCharCode(65 + m) + s; x = Math.floor((x - 1) / 26); }
  return s;
}
// Ô số: dấu chấm nghìn VN, RỖNG khi 0 (tránh ô đầy "0"); Số Lượng làm tròn 1 chữ số thập phân (7,4).
export function fmtNumCell(v?: number | string, exact = false) {
  const t = exact ? qtyExact(Number(v) || 0) : qtyRound(Number(v) || 0);
  if (!t || isNaN(t)) return "";
  return t.toLocaleString("vi-VN", { maximumFractionDigits: exact ? 4 : 1 });
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
