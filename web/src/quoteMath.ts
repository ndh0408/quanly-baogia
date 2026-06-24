// Port THUẦN (không state/DOM) các helper tính tiền/định dạng từ public/js/util.js + editor.js.
// PHẢI giữ byte-identical với src/money.js để tổng trên màn = tổng DB = file Excel (không lệch đồng).

export type ItemKind = "item" | "sub" | "section" | "subsection" | "info";
export type Item = {
  kind: ItemKind; label?: string; name?: string; detail?: string; unit?: string;
  quantity?: number; days?: number | null; unitPrice?: number; notes?: string; internalNote?: string;
  approved?: boolean; approvedAt?: string | null; approvedBy?: number | null;
  formulas?: Record<string, string>; order?: number;
};
export type Sheet = { id?: number; templateId?: number; name?: string | null; groupSubtotal?: boolean; order?: number; items: Item[]; extraTables?: unknown[] };
export type TemplateLayout = { hasDays?: boolean; hasDetail?: boolean; numberSubsections?: boolean };
export type Template = { id: number; code?: string; name: string; companyId?: number; layout?: TemplateLayout };
export type Company = { id: number; name: string; shortName?: string; address?: string };

export const fmtMoney = (n?: number | null) => (n == null || isNaN(Number(n)) ? "0" : Number(n).toLocaleString("vi-VN"));
export const roundVnd = (n: number) => Math.round(Number(n) || 0);

// CẮT 2 số thập phân (KHÔNG làm tròn) — khớp Decimal ROUND_DOWN của server.
export function trunc2(x: number) {
  const n = Number(x) || 0;
  const t = Math.trunc(Math.abs(n) * 100 + 1e-6) / 100;
  return n < 0 ? -t : t;
}
// Thành Tiền 1 dòng = SL(cắt2) × (Ngày) × Đơn Giá, làm tròn VNĐ. 1 nguồn cho dòng/nhóm/tổng/Excel.
export function lineAmount(it: Item, usesDays: boolean) {
  const q = trunc2(it.quantity || 0), d = Number(it.days) || 1, p = Number(it.unitPrice) || 0;
  return Math.round(usesDays ? q * d * p : q * p);
}
// Tổng sheet có hệ số nhóm: section.Số Lượng nhân các dòng dưới nó (tới section kế); section tự nó = 0.
export function sheetSubtotalGrouped(items: Item[], usesDays: boolean, groupSubtotal?: boolean) {
  let mult = 1, sum = 0;
  for (const it of items || []) {
    if (it.kind === "section" || it.kind === "subsection") { mult = groupSubtotal ? Math.max(1, Number(it.quantity) || 1) : 1; continue; }
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
// Ô số: dấu chấm nghìn VN, RỖNG khi 0 (tránh ô đầy "0"); phần lẻ hiện đúng 2 số.
export function fmtNumCell(v?: number | string) {
  const t = trunc2(Number(v) || 0);
  if (!t || isNaN(t)) return "";
  if (Number.isInteger(t)) return t.toLocaleString("vi-VN");
  const [intp, dec] = Math.abs(t).toFixed(2).split(".");
  const out = Number(intp).toLocaleString("vi-VN") + "," + dec;
  return t < 0 ? "-" + out : out;
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
