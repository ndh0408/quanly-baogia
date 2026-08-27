// ============================================================================
// SO SÁNH MỘT SHEET SẮP GHI VỚI SHEET ĐANG CÓ — nền của `INCREMENTAL_QUOTE_SAVE`.
//
// ── VÌ SAO TỒN TẠI ─────────────────────────────────────────────────────────
// `updateQuote` lưu báo giá bằng cách XOÁ mọi sheet rồi TẠO LẠI. Số đo trên chính repo này
// (`scripts/bench/quote-save-bench.mjs`, Postgres cục bộ, 5 lần mỗi kích cỡ):
//
//     dòng    |  LƯU hiện tại  |  phần nằm ở ghi CSDL  |  đọc lại để so
//     100     |      85 ms     |         98%           |    2,8 ms
//     2 000   |     671 ms     |         98%           |   16,9 ms
//     10 000  |   3 940 ms     |         98%           |   94,7 ms
//
// Sửa MỘT ô trong báo giá 10.000 dòng tốn gần 4 giây, và gần như toàn bộ là ghi lại những dòng
// KHÔNG ĐỔI. Lần đọc để biết "có đổi hay không" thì rẻ hơn hai bậc độ lớn. Đó là toàn bộ lý lẽ.
//
// ── VÌ SAO SO Ở MỨC SHEET, KHÔNG PHẢI MỨC DÒNG ─────────────────────────────
// Trần của validator là 1000 dòng mỗi trang, 60 trang mỗi báo giá (src/validators.ts). Nên
// "10.000 dòng" trong đời thật là 10 TRANG. Bỏ qua các trang không đổi lấy được phần lớn khoản
// tiết kiệm mà KHÔNG phải dò danh tính từng dòng — thứ kéo theo id bền cho QuoteItem, luật ghép
// dòng mới với dòng cũ, và một tầng lỗi mới đặt ngay giữa đường tiền bạc.
//
// ── NGUYÊN TẮC AN TOÀN: SAI THÌ PHẢI SAI VỀ PHÍA "KHÁC NHAU" ────────────────
// Kết luận "giống nhau" mà sai = sheet KHÔNG được ghi = mất phần người dùng vừa sửa, im lặng, vẫn
// trả 200. Đó là hạng rủi ro số 1 của §54. Nên hàm này:
//   1. so trên ĐÚNG tập trường mà lệnh ghi sẽ đặt;
//   2. gặp BẤT KỲ khoá lạ nào (ai đó thêm trường vào `buildSheetsCreate` mà quên chỗ này) thì trả
//      NGAY `false`. Thêm trường mới thì hệ quả tệ nhất là mất phần tăng tốc, không phải mất dữ liệu;
//   3. không có `cu` thì trả `false`.
import { Prisma } from "@prisma/client";
import { SHEET_CARRY_FIELDS } from "./quoteUtils.js";

/** Khoá mà `buildSheetsCreate` đặt ở MỨC SHEET (ngoài các trường carry). */
export const KHOA_SHEET = [
  "templateId",
  "name",
  "order",
  "groupSubtotal",
  "showImages",
  "subtotal",
  "items",
  "extraTables",
] as const;

/** Khoá mà `buildSheetsCreate` đặt ở MỨC DÒNG. */
export const KHOA_DONG = [
  "order",
  "productId",
  "kind",
  "label",
  "name",
  "detail",
  "unit",
  "quantity",
  "quantityExact",
  "unitPrice",
  "days",
  "notes",
  "internalNote",
  "formulas",
  "images",
] as const;

const CHO_PHEP_SHEET = new Set<string>([...KHOA_SHEET, ...SHEET_CARRY_FIELDS]);
const CHO_PHEP_DONG = new Set<string>(KHOA_DONG);

/**
 * Số tiền / số lượng: so theo GIÁ TRỊ, không theo cách viết. `Decimal(18,4)` từ CSDL đọc lên là
 * "2.0000", còn payload dựng bằng `D(2)` là "2" — cùng một số, khác chuỗi.
 */
function bangSo(a: unknown, b: unknown): boolean {
  const rong = (x: unknown) => x === null || x === undefined;
  if (rong(a) && rong(b)) return true;
  if (rong(a) || rong(b)) return false;
  try {
    return new Prisma.Decimal(a as never).equals(new Prisma.Decimal(b as never));
  } catch {
    return false; // không dựng được số thì coi là khác — đúng chiều an toàn
  }
}

/**
 * JSON tự do (`formulas`, `images`, `extraTables`): so sau khi CHUẨN HOÁ THỨ TỰ KHOÁ.
 * `JSON.stringify` giữ thứ tự chèn, mà hai đường (payload và cột Json đọc lên) không cùng thứ tự.
 */
function chuanJson(x: unknown): string {
  const di = (v: unknown): unknown => {
    if (v === undefined) return null;
    if (v === null || typeof v !== "object") return v;
    if (Array.isArray(v)) return v.map(di);
    const o = v as Record<string, unknown>;
    const ra: Record<string, unknown> = {};
    for (const k of Object.keys(o).sort()) ra[k] = di(o[k]);
    return ra;
  };
  try {
    return JSON.stringify(di(x));
  } catch {
    return "@khong-doc-duoc"; // vòng tham chiếu — coi là khác
  }
}

function bangChuoi(a: unknown, b: unknown): boolean {
  const chuan = (x: unknown) => (x === undefined || x === null ? null : String(x));
  return chuan(a) === chuan(b);
}

function bangLuc(a: unknown, b: unknown): boolean {
  const t = (x: unknown) =>
    x === undefined || x === null ? null : x instanceof Date ? x.getTime() : new Date(String(x)).getTime();
  const ta = t(a);
  const tb = t(b);
  if (ta === null && tb === null) return true;
  if (ta === null || tb === null) return false;
  return Number.isFinite(ta) && Number.isFinite(tb) && ta === tb;
}

type BanGhiSheet = Record<string, unknown> & { items?: { create?: Record<string, unknown>[] } };
type HangSheet = Record<string, unknown> & { items?: Record<string, unknown>[] };

function bangDong(moi: Record<string, unknown>, cu: Record<string, unknown>): boolean {
  for (const k of Object.keys(moi)) if (!CHO_PHEP_DONG.has(k)) return false;
  return (
    bangChuoi(moi.order, cu.order) &&
    bangChuoi(moi.productId, cu.productId) &&
    bangChuoi(moi.kind, cu.kind) &&
    bangChuoi(moi.label, cu.label) &&
    bangChuoi(moi.name, cu.name) &&
    bangChuoi(moi.detail, cu.detail) &&
    bangChuoi(moi.unit, cu.unit) &&
    bangSo(moi.quantity, cu.quantity) &&
    !!moi.quantityExact === !!cu.quantityExact &&
    bangSo(moi.unitPrice, cu.unitPrice) &&
    bangSo(moi.days, cu.days) &&
    bangChuoi(moi.notes, cu.notes) &&
    bangChuoi(moi.internalNote, cu.internalNote) &&
    chuanJson(moi.formulas ?? null) === chuanJson(cu.formulas ?? null) &&
    chuanJson(moi.images ?? null) === chuanJson(cu.images ?? null)
  );
}

/**
 * `true` khi và chỉ khi ghi `taoMoi` đè lên `cu` sẽ KHÔNG đổi một byte nào.
 *
 * `taoMoi` là một phần tử của `buildSheetsCreate(...)`; `cu` là hàng `QuoteSheet` đọc từ CSDL KÈM
 * `items` (đủ mọi cột, kể cả `images`), và `items` PHẢI đọc với `orderBy: { order: "asc" }`.
 */
export function sheetKhongDoi(taoMoi: BanGhiSheet | null | undefined, cu: HangSheet | null | undefined): boolean {
  if (!taoMoi || !cu) return false;
  for (const k of Object.keys(taoMoi)) if (!CHO_PHEP_SHEET.has(k)) return false;

  if (!bangChuoi(taoMoi.templateId, cu.templateId)) return false;
  if (!bangChuoi(taoMoi.name, cu.name)) return false;
  if (!bangChuoi(taoMoi.order, cu.order)) return false;
  if (!!taoMoi.groupSubtotal !== !!cu.groupSubtotal) return false;
  if (!!taoMoi.showImages !== !!cu.showImages) return false;
  if (!bangSo(taoMoi.subtotal, cu.subtotal)) return false;
  if (chuanJson(taoMoi.extraTables ?? null) !== chuanJson(cu.extraTables ?? null)) return false;

  // Trường carry: `pickCarry` chỉ chép sang khi giá trị KHÁC null, nên khoá vắng mặt tương đương
  // null ở CSDL. Về nguyên tắc chúng bằng nhau theo cách dựng (payload lấy CHÍNH từ hàng này),
  // nhưng vẫn so — hàm này là chốt chặn, không phải lời hứa.
  for (const f of SHEET_CARRY_FIELDS) {
    const a = (taoMoi as Record<string, unknown>)[f];
    const b = cu[f];
    const laLuc = /At$/.test(f) || f === "invoiceDate";
    if (laLuc ? !bangLuc(a, b) : !bangChuoi(a, b)) return false;
  }

  const dongMoi = taoMoi.items?.create ?? [];
  const dongCu = Array.isArray(cu.items) ? cu.items : [];
  if (dongMoi.length !== dongCu.length) return false;
  for (let i = 0; i < dongMoi.length; i++) if (!bangDong(dongMoi[i], dongCu[i])) return false;
  return true;
}
