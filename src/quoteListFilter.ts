// BỘ LỌC + TÌM THÔNG MINH của Danh sách báo giá (chủ repo 2026-09-30: "bộ lọc … chưa đầy đủ và thông minh").
// Thuần: không Prisma client, không HTTP — `listQuotes` / `listQuoteFacets` (quoteService) lo truy vấn, module này
// lo LUẬT: đọc tham số, dựng điều kiện Prisma theo từng CHIỀU lọc, chọn khoá sắp xếp. Tách ra để test được không
// cần CSDL, và để đếm facets bỏ được CHÍNH chiều đang đếm (xem `ghepLoc`).
import type { Prisma, QuoteStatus } from "@prisma/client";
import { normalizeSearch, searchTextFilter } from "./searchText.js";
import { MAU_GHI_CHU } from "./quoteListNote.js";

/** ⚠️ Khớp QUOTE_STATUSES (src/validators.ts) — tests/ql-loc-danh-sach.test.js khoá hai bản. Không import
 *  validators ở đây: validators cần module này để dựng schema, import ngược là vòng. */
export const TRANG_THAI_BAO_GIA = ["draft", "pending", "approved", "rejected", "sent", "converted", "lost"] as const;

/** Bốn cột sắp xếp CÓ TỪ TRƯỚC — mọi người (kể cả view lược) dùng được, một khoá như cũ. */
export const COT_SAP_XEP_CU = ["createdAt", "quoteDate", "total", "quoteNumber"] as const;
/** Cột sắp xếp MỚI (2026-09-30). View lược KHÔNG dùng được: sắp theo thứ họ không thấy là cách dò nó. */
export const COT_SAP_XEP_MOI = ["title", "toCompany", "status", "company", "creator", "customerCode"] as const;
export const COT_SAP_XEP = [...COT_SAP_XEP_CU, ...COT_SAP_XEP_MOI] as const;

/** Một chiều lọc = một điều kiện độc lập. Facets đếm nhóm X bằng mọi chiều TRỪ X. */
export const CHIEU_LOC = ["q", "status", "company", "creator", "date", "total", "note"] as const;
export type ChieuLoc = (typeof CHIEU_LOC)[number];

export type BoLoc = {
  q?: string;
  status?: string[];
  companyIds?: number[];
  creatorIds?: number[];
  from?: Date;
  to?: Date;
  minTotal?: number;
  maxTotal?: number;
  note?: "has" | "none";
  noteColors?: string[];
};

/** Tham số dạng "a,b" HOẶC khoá lặp (?x=a&x=b) HOẶC trộn cả hai → mảng chuỗi, bỏ rỗng + trùng. */
export function docCsv(v: unknown): string[] {
  const ds = Array.isArray(v) ? v : v === undefined || v === null ? [] : [v];
  return [...new Set(ds.flatMap((x) => String(x).split(",")).map((x) => x.trim()).filter(Boolean))];
}
const docSo = (v: unknown): number | undefined => {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};
const docNgay = (v: unknown): Date | undefined => {
  if (v === undefined || v === null || v === "") return undefined;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? undefined : d;
};
const docSoNguyenDuong = (v: unknown) => docCsv(v).map(Number).filter((n) => Number.isInteger(n) && n > 0);

/**
 * Query ĐÃ qua zod (route chặn rác bằng 400) → `BoLoc`. Vẫn tự phòng thủ: giá trị lạ bị BỎ chứ không ném — đây là
 * lớp cuối, và một tab cũ gửi tham số cũ không được làm cả danh sách sập.
 */
export function docBoLoc(query: Record<string, unknown>): BoLoc {
  const q = typeof query.q === "string" ? query.q.trim() : "";
  const note = query.note === "has" || query.note === "none" ? query.note : undefined;
  const loc: BoLoc = {
    ...(q ? { q } : {}),
    ...(docCsv(query.status).filter((s) => (TRANG_THAI_BAO_GIA as readonly string[]).includes(s)).length
      ? { status: docCsv(query.status).filter((s) => (TRANG_THAI_BAO_GIA as readonly string[]).includes(s)) } : {}),
    ...(docSoNguyenDuong(query.companyId).length ? { companyIds: docSoNguyenDuong(query.companyId) } : {}),
    ...(docSoNguyenDuong(query.creator).length ? { creatorIds: docSoNguyenDuong(query.creator) } : {}),
    ...(docNgay(query.from) ? { from: docNgay(query.from) } : {}),
    ...(docNgay(query.to) ? { to: docNgay(query.to) } : {}),
    ...(docSo(query.minTotal) !== undefined ? { minTotal: docSo(query.minTotal) } : {}),
    ...(docSo(query.maxTotal) !== undefined ? { maxTotal: docSo(query.maxTotal) } : {}),
    ...(note ? { note } : {}),
    ...(docCsv(query.noteColor).filter((c) => (MAU_GHI_CHU as readonly string[]).includes(c)).length
      ? { noteColors: docCsv(query.noteColor).filter((c) => (MAU_GHI_CHU as readonly string[]).includes(c)) } : {}),
  };
  return loc;
}

/** Từ khoá tìm: bỏ dấu, thường hoá, tách từ, bỏ trùng, tối đa 8 từ × 40 ký tự (chặn truy vấn nặng do chuỗi khổng lồ). */
export function tachTuKhoa(q: string): string[] {
  return [...new Set(normalizeSearch(q).split(" ").filter(Boolean).map((t) => t.slice(0, 40)))].slice(0, 8);
}

/** Người tạo / công ty đã chuẩn hoá tên — bảng nhỏ (vài chục dòng) nên khớp trong JS, không cần cột searchText. */
export type TenDaChuanHoa = { id: number; ten: string };
export type NguCanhLoc = { nguoi: TenDaChuanHoa[]; congTy: TenDaChuanHoa[]; bienLuoc: boolean };

type Dieu = Prisma.QuoteWhereInput;

/**
 * Điều kiện Prisma theo TỪNG chiều (`null` = chiều đó không lọc).
 *
 * TÌM THÔNG MINH (`q`): MỌI từ phải khớp (AND), mỗi từ khớp ở BẤT KỲ nơi nào trong: mã/tiêu đề/khách gõ tay
 * (`Quote.searchText`), khách TRONG DANH MỤC (`Customer.searchText`: tên, mã, SĐT, email, MST, người liên hệ),
 * người tạo, công ty, ghi chú dòng (`QuoteListNote.searchText`). Không dấu, không cần đúng thứ tự.
 *
 * `bienLuoc` (account HN / tài khoản chi phí): họ KHÔNG thấy khách danh mục, tổng tiền, ghi chú, người tạo nào
 * khác — nên `q` giữ NGUYÊN cách cũ (một chuỗi con trên searchText) và các bộ lọc chạm trường đó bị BỎ. Lọc/tìm
 * theo thứ người ta không được thấy là cách đọc trộm nó bằng cách dò.
 */
export function locTheoChieu(loc: BoLoc, ctx: NguCanhLoc): Record<ChieuLoc, Dieu | null> {
  const coKhoang = (min?: number, max?: number) => (min === undefined && max === undefined ? null : { ...(min !== undefined ? { gte: min } : {}), ...(max !== undefined ? { lte: max } : {}) });
  const tien = ctx.bienLuoc ? null : coKhoang(loc.minTotal, loc.maxTotal);
  const ghiChu: Dieu[] = [];
  if (!ctx.bienLuoc) {
    if (loc.note === "has") ghiChu.push({ listNote: { isNot: null } });
    if (loc.note === "none") ghiChu.push({ listNote: { is: null } });
    if (loc.noteColors?.length) ghiChu.push({ listNote: { is: { color: { in: loc.noteColors } } } });
  }
  const ngay = loc.from || loc.to ? { quoteDate: { ...(loc.from ? { gte: loc.from } : {}), ...(loc.to ? { lte: loc.to } : {}) } } : null;

  let q: Dieu | null = null;
  if (loc.q !== undefined) {
    const tu = ctx.bienLuoc ? [] : tachTuKhoa(loc.q);
    if (ctx.bienLuoc || tu.length === 0) {
      q = { searchText: searchTextFilter(loc.q) };   // cách cũ; q toàn ký tự lạ → token-không-khớp (0 kết quả), không nuốt cả danh sách
    } else {
      q = { AND: tu.map((t): Dieu => {
        const idNguoi = ctx.nguoi.filter((n) => n.ten.includes(t)).map((n) => n.id);
        const idCongTy = ctx.congTy.filter((c) => c.ten.includes(t)).map((c) => c.id);
        return { OR: [
          { searchText: { contains: t } },
          { customer: { is: { searchText: { contains: t } } } },
          ...(idNguoi.length ? [{ createdById: { in: idNguoi } }] : []),
          ...(idCongTy.length ? [{ companyId: { in: idCongTy } }] : []),
          { listNote: { is: { searchText: { contains: t } } } },
        ] };
      }) };
    }
  }
  return {
    q,
    status: loc.status?.length ? { status: { in: loc.status as QuoteStatus[] } } : null,
    company: loc.companyIds?.length ? { companyId: { in: loc.companyIds } } : null,
    creator: !ctx.bienLuoc && loc.creatorIds?.length ? { createdById: { in: loc.creatorIds } } : null,
    date: ngay,
    total: tien ? { total: tien } : null,
    note: ghiChu.length === 0 ? null : ghiChu.length === 1 ? ghiChu[0] : { AND: ghiChu },
  };
}

/** Các điều kiện đang có, TRỪ chiều `boQua` (facets: đếm nhóm X theo mọi bộ lọc khác). */
export function ghepLoc(parts: Record<ChieuLoc, Dieu | null>, boQua?: ChieuLoc): Dieu[] {
  return CHIEU_LOC.filter((k) => k !== boQua).map((k) => parts[k]).filter((d): d is Dieu => d !== null);
}

/**
 * Khoá sắp xếp SQL. Bốn cột cũ GIỮ đúng một khoá như trước (kế hoạch truy vấn đường nóng không đổi — xem
 * scripts/db/explain-hot-paths.mjs); cột mới thêm `id` làm khoá phụ: trạng thái / công ty / người tạo có hàng loạt
 * dòng bằng nhau, thiếu khoá phụ thì Postgres sắp các dòng bằng nhau tuỳ ý MỖI LẦN và phân trang trùng/sót dòng.
 *
 * "title" KHÔNG có ở đây — xem `sapIdTheoTieuDe`: SQL không sắp được đúng chữ mà ô danh sách hiện.
 */
export function orderByTheoCot(sort: string, order: "asc" | "desc" | string) {
  const dir = order === "asc" ? "asc" : "desc";
  if ((COT_SAP_XEP_CU as readonly string[]).includes(sort)) return { [sort]: dir } as Prisma.QuoteOrderByWithRelationInput;
  const chinh: Prisma.QuoteOrderByWithRelationInput | null =
    sort === "company" ? { company: { name: dir } }
    : sort === "creator" ? { createdBy: { displayName: dir } }
    : sort === "customerCode" ? { customer: { code: dir } }
    : sort === "toCompany" || sort === "status" ? ({ [sort]: dir } as Prisma.QuoteOrderByWithRelationInput)
    : null;
  return chinh ? [chinh, { id: "desc" as const }] : ({ createdAt: dir } as Prisma.QuoteOrderByWithRelationInput);
}

/**
 * Tiêu đề NHƯ Ô DANH SÁCH HIỆN: tiêu đề rút gọn người dùng tự đặt (nếu có), không thì tiêu đề chính đã cắt tiền tố
 * "Bảng báo giá –". ⚠️ Khớp `tieuDeHienThi` ở web/src/lib/format.tsx (và `tieuDe` ở inputInvoices.ts) — đổi một nơi
 * thì đổi cả ba, không thì cột sắp xếp và chữ hiện ra lệch nhau.
 */
export function tieuDeHienThi(q: { title?: string | null; shortTitle?: string | null }): string {
  const rutGon = String(q.shortTitle ?? "").trim();
  if (rutGon) return rutGon;
  const t = String(q.title ?? "");
  return t.replace(/^\s*bảng\s+báo\s+giá\s*[-–—:|·]*\s*/i, "").trim() || t;
}

const SO_SANH_TIENG_VIET = new Intl.Collator("vi", { numeric: true });

/**
 * Id sắp theo TIÊU ĐỀ HIỂN THỊ (cột "Tiêu đề"). Vì sao không để SQL sắp: ô hiện `tieuDeHienThi` = tiêu đề rút gọn HOẶC
 * tiêu đề chính cắt tiền tố, còn Prisma không cho ORDER BY một biểu thức; sắp theo cột gốc thì dòng có tiêu đề rút gọn
 * nằm sai chỗ (hiện "Alpha" mà đứng cuối vì tiêu đề chính bắt đầu bằng "Z…"). Nên quoteService nạp (id, title,
 * shortTitle) của đúng tập đã lọc, sắp ở đây, rồi chỉ nạp đủ dòng cho RIÊNG trang đang xem.
 * `Intl.Collator("vi", numeric)`: đúng thứ tự dấu + đ, và "Sự kiện 2" đứng trước "Sự kiện 10". Bằng nhau → id MỚI trước
 * (cùng khoá phụ với các cột khác, để phân trang không trùng/sót).
 */
export function sapIdTheoTieuDe(ds: { id: number; title?: string | null; shortTitle?: string | null }[], order: "asc" | "desc" | string): number[] {
  const dau = order === "asc" ? 1 : -1;
  return ds
    .map((d) => ({ id: d.id, khoa: tieuDeHienThi(d) }))
    .sort((a, b) => dau * SO_SANH_TIENG_VIET.compare(a.khoa, b.khoa) || b.id - a.id)
    .map((d) => d.id);
}
