// KHOẢN CHI — luật THUẦN của dữ liệu kế toán từng hàng bảng nội bộ (đã chi + ảnh chứng từ, Ngày hóa đơn, Ghi chú
// kế toán), chủ repo 2026-10-06: "cái thanh toán bên đó là cho kế toán, không nằm trong kia nữa".
//
// Dữ liệu nằm ở bảng RIÊNG `InputInvoiceEntry` / `InputInvoiceProof` (vì sao: chú thích model ở prisma/schema.prisma).
// Tệp này không chạm Prisma và không chạm HTTP — để ba nơi cùng dùng MỘT luật mà không đẻ vòng import [K4]
// (scripts/ci/check-architecture.mjs): đường Lưu báo giá (src/services/quoteService.ts, src/hnWorkflow.ts), dịch vụ
// kế toán (src/services/inputInvoiceService.ts) và công cụ chuyển dữ liệu (src/khoanChiBackfill.ts).
//
// ── BẤT BIẾN MÀ CÁC HÀM DƯỚI ĐÂY GIỮ ─────────────────────────────────────────────────────────────────────
//   KT-2  Bốn cờ cũ `paid/paidAt/paidById/paidProof` trong JSON hàng ĐÓNG BĂNG: payload không đổi được chúng.
//   KT-3  Trạng thái HIỆU LỰC = khoản (nếu có) thắng, không thì cờ JSON cũ — một hàm duy nhất `trangThaiHieuLuc`.
//   KT-4  Hàng hiệu lực ĐÃ CHI không biến mất được qua đường Lưu (`hangDaChiBiMat` → `loiHangDaChi`, 400).
//   KT-6  Khoản định vị bằng (báo giá, PHÍA, rid); rid duy nhất trong (báo giá, phía) — `tachRidTrung`.
import { randomUUID } from "node:crypto";
import { extraTableSum } from "./quoteUtils.js";
import { httpError } from "./httpError.js";
import { laNgayLich } from "./vnTime.js";

/**
 * PHÍA của một hàng: "sheet" = Chi phí HCM + Phí khách hàng của MỌI trang (`QuoteSheet.extraTables`), "hn" = bảng Hà
 * Nội cấp báo giá (`Quote.hnTables`). Gộp hcm + khach làm một phía là CỐ Ý: thao tác "Chuyển loại" ở màn soạn
 * (web/src/components/ExtraTables.tsx) chỉ đổi `category` của bảng và giữ nguyên `rid` từng hàng — khoá theo loại bảng
 * thì một cú bấm làm mọi khoản của bảng thành mồ côi.
 */
export type PhiaKhoanChi = "sheet" | "hn";
export const PHIA_KHOAN_CHI: readonly PhiaKhoanChi[] = ["sheet", "hn"];
export const laPhiaKhoanChi = (s: unknown): s is PhiaKhoanChi => s === "sheet" || s === "hn";

/** Khoá của khoản trong MỘT báo giá. */
export const khoaKhoanChi = (side: string, rid: string) => `${side}:${rid}`;
/** Bảng "hanoi" (bản HN) → phía "hn"; mọi loại khác → "sheet". */
export const phiaCuaLoai = (category: unknown): PhiaKhoanChi => (category === "hanoi" ? "hn" : "sheet");

/** Lý do rút một ảnh khỏi khoản — ảnh KHÔNG BAO GIỜ bị xoá, chỉ rút vào lịch sử (KT-7). */
export type LyDoRutAnh = "thay" | "go-anh" | "bo-danh-dau";

/**
 * Một khoản như dịch vụ đọc từ CSDL — đủ cho luật trạng thái hiệu lực, lớp phủ và DTO. Không bao giờ mang `dataUrl`.
 */
export type KhoanChiNap = {
  id: number;
  quoteId: number;
  side: string;
  rid: string;
  paid: boolean;
  paidAt: Date | string | null;
  paidById: number | null;
  paidByName: string | null;
  paidSnapshot: unknown;
  currentProofId: number | null;
  invoiceDate: Date | string | null;
  accountingNote: string | null;
  rowSnapshot: unknown;
  legacySeed: unknown;
  source: string;
  version: number;
  updatedAt: Date | string | null;
  updatedByName: string | null;
};

/** Siêu dữ liệu một ảnh chứng từ (KHÔNG có `dataUrl` — ảnh chỉ tải theo yêu cầu, người có `invoice:input:pay`). */
export type AnhChungTuNap = {
  id: number;
  entryId: number;
  uploadedAt: Date | string;
  uploadedByName: string | null;
  retiredAt: Date | string | null;
  retiredReason: string | null;
  source: string;
};

const LOAI_SHEET = new Set(["hcm", "khach"]);
const CAU_TRUC = new Set(["section", "subsection", "info"]);
const laObj = (x: unknown): x is Record<string, any> => !!x && typeof x === "object" && !Array.isArray(x);
const chu = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const isoHoacNull = (v: unknown): string | null => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/**
 * Duyệt các HÀNG (không phải nhóm / nhóm con / dòng thông tin) của MỘT phía, kèm tên hiển thị: dòng con ("sub",
 * ô gộp) có tên trống thì thừa hưởng tên hạng mục gần nhất — cùng luật với src/inputInvoices.ts.
 *
 * Phía "sheet" chỉ lấy bảng hcm/khach: bản cũ của bảng Hà Nội còn nằm lại trong trang (migration 20260915140000 là
 * EXPAND-ONLY) không thuộc phía nào — khoản HN định vị trên `Quote.hnTables`. Cột JSON là jsonb tự do nên phòng mọi
 * phần tử không phải object.
 */
export function* hangCuaPhia(side: string, tables: unknown): Generator<{ t: Record<string, any>; it: Record<string, any>; ten: string; ti: number; ii: number }> {
  const ds = Array.isArray(tables) ? tables : [];
  for (let ti = 0; ti < ds.length; ti++) {
    const t = ds[ti];
    if (!laObj(t)) continue;
    if (side === "sheet" && !LOAI_SHEET.has(t.category)) continue;
    const items = Array.isArray(t.items) ? t.items : [];
    let cha = "";
    for (let ii = 0; ii < items.length; ii++) {
      const it = items[ii];
      if (!laObj(it) || CAU_TRUC.has(String(it.kind))) continue;
      const ten = chu(it.name);
      if (it.kind !== "sub" && ten) cha = ten;
      yield { t, it, ten: ten ?? cha, ti, ii };
    }
  }
}

/** Gộp `extraTables` của mọi trang thành MỘT mảng bảng — hình dạng của phía "sheet". */
export function bangCuaSheets(sheets: unknown): any[] {
  return (Array.isArray(sheets) ? sheets : []).flatMap((s: any) => (laObj(s) && Array.isArray(s.extraTables) ? s.extraTables : []));
}

export type NguonKeToan = "bang" | "json-cu" | "khong";
export type TrangThaiHieuLuc = {
  paid: boolean;
  paidAt: string | null;
  paidById: number | null;
  paidByName: string | null;
  hasPaidProof: boolean;
  nguon: NguonKeToan;
};

/**
 * KT-3 — HÀM DUY NHẤT trả lời "hàng này đã chi chưa": có khoản thì khoản thắng (kể cả khoản đã BỎ tích — cờ JSON cũ
 * `paid:true` khi đó không còn nghĩa gì); không có khoản thì cờ JSON cũ (đóng băng từ ngày chuyển).
 *
 * `hasPaidProof` của nhánh JSON đọc cả `paidProof` (hàng thô) lẫn `hasPaidProof` (hàng đã cắt ảnh ở SQL hoặc đã qua
 * `stripExtraProofs`).
 */
export function trangThaiHieuLuc(entry?: Pick<KhoanChiNap, "paid" | "paidAt" | "paidById" | "paidByName" | "currentProofId"> | null, it?: Record<string, any> | null): TrangThaiHieuLuc {
  if (entry) {
    return {
      paid: !!entry.paid,
      paidAt: isoHoacNull(entry.paidAt),
      paidById: entry.paidById ?? null,
      paidByName: entry.paidByName ?? null,
      hasPaidProof: entry.currentProofId != null,
      nguon: "bang",
    };
  }
  const coAnh = (typeof it?.paidProof === "string" && it.paidProof !== "") || it?.hasPaidProof === true;
  const paid = it?.paid === true;
  return {
    paid,
    paidAt: paid ? isoHoacNull(it?.paidAt) : null,
    paidById: paid && typeof it?.paidById === "number" ? it.paidById : null,
    paidByName: null,
    hasPaidProof: coAnh,
    nguon: paid || coAnh ? "json-cu" : "khong",
  };
}

/** Tập `rid` ĐANG hiệu lực "đã chi" của một phía (bảng ĐỌC TỪ CSDL + khoản của báo giá). */
export function tapDaChi(side: string, tables: unknown, khoan: Map<string, Pick<KhoanChiNap, "paid" | "paidAt" | "paidById" | "paidByName" | "currentProofId">>): Set<string> {
  const out = new Set<string>();
  for (const { it } of hangCuaPhia(side, tables)) {
    const rid = chu(it.rid);
    if (!rid) continue;
    if (trangThaiHieuLuc(khoan.get(khoaKhoanChi(side, rid)), it).paid) out.add(rid);
  }
  return out;
}

/**
 * KT-4 — tên các hàng ĐÃ CHI có ở bản CSDL (`truoc`) mà `rid` vắng mặt ở bản sắp ghi (`sau`).
 *
 * So TẬP rid của CẢ PHÍA, không so theo bảng / trang: chuyển hàng sang bảng khác, "Chuyển loại" hcm↔khach, kéo đổi
 * thứ tự trang… đều giữ rid nên không bị chặn oan. Chỉ hàng thật sự biến mất — xoá dòng, xoá bảng, xoá trang, hay
 * một client cũ gửi `extraTables: []` — mới bị chặn.
 */
export function hangDaChiBiMat(side: string, truoc: unknown, sau: unknown, daChi: Set<string>): string[] {
  if (!daChi.size) return [];
  const conSau = new Set<string>();
  for (const { it } of hangCuaPhia(side, sau)) { const r = chu(it.rid); if (r) conSau.add(r); }
  const mat: string[] = [];
  const daBao = new Set<string>();
  for (const { it, ten } of hangCuaPhia(side, truoc)) {
    const rid = chu(it.rid);
    if (!rid || !daChi.has(rid) || conSau.has(rid) || daBao.has(rid)) continue;
    daBao.add(rid);
    mat.push(ten || "(không tên)");
  }
  return mat;
}

/**
 * Tên mọi hàng ĐANG hiệu lực đã chi của một phía — kể cả khoản đã chi mà hàng không còn trong JSON (mồ côi: lấy tên
 * từ `rowSnapshot`). Dùng cho chốt xoá mềm báo giá (KT-4).
 *
 * Rid TRÙNG (dữ liệu cũ): khoản kế toán chỉ thuộc bản ĐẦU của rid (theo thứ tự `tables` — người gọi đưa vào theo thứ
 * tự hiển thị), các bản sau vẫn có thể mang cờ "đã trả" JSON cũ của riêng chúng — xét cả chúng, nếu không báo giá còn
 * hàng đã trả vẫn xoá mềm được. Hàng thiếu rid mang cờ cũ cũng tính.
 */
export function tenHangDaChi(side: string, tables: unknown, khoan: Map<string, Pick<KhoanChiNap, "side" | "rid" | "paid" | "paidAt" | "paidById" | "paidByName" | "currentProofId" | "rowSnapshot">>): string[] {
  const out: string[] = [];
  const thay = new Set<string>();
  for (const { it, ten } of hangCuaPhia(side, tables)) {
    const rid = chu(it.rid);
    const dau = !!rid && !thay.has(rid);
    if (rid) thay.add(rid);
    const tt = dau ? trangThaiHieuLuc(khoan.get(khoaKhoanChi(side, rid!)), it) : trangThaiHieuLuc(undefined, it);
    if (tt.paid) out.push(ten || "(không tên)");
  }
  for (const e of khoan.values()) {
    if (e.side === side && e.paid && !thay.has(e.rid)) out.push(docAnhChup(e.rowSnapshot)?.name || "(không tên)");
  }
  return out;
}

/** Các trang theo THỨ TỰ HIỂN THỊ (`order` rồi `id`) — cùng thứ tự với danh sách Hóa đơn đầu vào và công cụ chuyển dữ liệu. */
export function sapTheoThuTu<T extends { order?: number | null; id?: number | null }>(sheets: T[]): T[] {
  return [...(Array.isArray(sheets) ? sheets : [])].sort((a, b) => (Number(a?.order) || 0) - (Number(b?.order) || 0) || (Number(a?.id) || 0) - (Number(b?.id) || 0));
}

/**
 * CHUẨN HOÁ RID TRÙNG CÓ SẴN TRONG CSDL trước mọi lần reconcile của một đường Lưu (KT-2, KT-4, KT-6).
 *
 * Dữ liệu cũ có thể mang hai hàng cùng `rid` trong một phía (nhân bản trang / chép hàng ở bản cũ). Mọi luật kế thừa
 * (reconcileExtraApprovals / reconcileExtraPayments / reconcileHnApprovals) khoá theo rid, nên với hai bản trùng thì cờ
 * duyệt / đã trả / ảnh của bản này rơi sang bản kia, hoặc mất hẳn — và chốt "hàng đã chi không được biến mất" (so tập
 * rid) không thấy vì rid vẫn còn. Đã tái hiện được (soát 2026-10-06, ATDL-1).
 *
 * Cách chữa: trong `dbTables` (đọc TRONG giao dịch, theo THỨ TỰ HIỂN THỊ), bản ĐẦU của mỗi rid trùng giữ rid — nó là chủ
 * của khoản kế toán (công cụ chuyển dữ liệu và danh sách cũng lấy bản đầu); bản thứ k ≥ 2 nhận rid MỚI ngay trên đối tượng
 * CSDL. Bản ở payload ghép theo THỨ TỰ với các bản CSDL mà payload thay thế: lần xuất hiện thứ j ↔ bản thứ j, nhận đúng rid
 * của bản đó — nên reconcile kế thừa ĐÚNG cờ của chính hàng ấy. Payload nhiều bản hơn CSDL → phần dư là bản sao, nhận rid
 * mới (không kế thừa gì). Payload ít hơn → bản CSDL không được ghép giữ rid của riêng nó trong `dbTables`, và nếu đang ĐÃ
 * CHI thì hangDaChiBiMat thấy nó biến mất → 400.
 *
 * Đối tượng DÙNG CHUNG (bảng giữ nguyên của đường account phụ — cùng một đối tượng nằm ở cả hai phía): đổi rid ở CSDL là đổi
 * luôn ở bản ghi xuống, cờ đi theo nguyên vẹn, nên không ghép. Mutate tại chỗ cả hai phía; trả số hàng đã đổi rid.
 *
 * rid CSDL dính khoảng trắng ("w1 " — payload tự chế ở bản cũ, khi zod/sanitize chưa cắt) được cắt về "w1" NGAY TRÊN bản
 * CSDL: payload giờ luôn cắt, mà các bản đồ `prior` của reconcile tra bằng rid THÔ — không cắt thì "w1" ≠ "w1 ", cờ + ảnh
 * rơi im, còn hangDaChiBiMat (so bằng rid đã cắt) không thấy gì.
 */
export function chuanHoaRidTrung(side: string, dbTables: unknown, plTables: unknown, sinh: () => string = randomUUID): number {
  const tapPl = new Set<object>();
  for (const { it } of hangCuaPhia(side, plTables)) tapPl.add(it);
  const db = new Map<string, Record<string, any>[]>();
  const tapDb = new Set<object>();
  let n = 0;
  for (const { it } of hangCuaPhia(side, dbTables)) {
    tapDb.add(it);
    const r = chu(it.rid);
    if (r && it.rid !== r) { it.rid = r; n++; }
    if (r) (db.get(r) ?? db.set(r, []).get(r)!).push(it);
  }
  const pl = new Map<string, Record<string, any>[]>();
  for (const { it } of hangCuaPhia(side, plTables)) {
    if (tapDb.has(it)) continue;
    const r = chu(it.rid);
    if (r) (pl.get(r) ?? pl.set(r, []).get(r)!).push(it);
  }
  for (const [r, ds] of db) {
    if (ds.length < 2) continue;
    // Bản thứ 2 trở đi trong CSDL: rid MỚI ngay trên đối tượng CSDL (bản đầu giữ rid — chủ của khoản kế toán).
    for (let k = 1; k < ds.length; k++) { ds[k].rid = sinh(); n++; }
    // Payload ghép theo thứ tự với các bản CSDL mà nó THAY THẾ (không phải đối tượng dùng chung).
    const thay = ds.filter((x) => !tapPl.has(x));
    const pls = pl.get(r) ?? [];
    for (let j = 0; j < pls.length; j++) {
      const moi = j < thay.length ? thay[j].rid : sinh();
      if (pls[j].rid !== moi) { pls[j].rid = moi; n++; }
    }
  }
  return n;
}

/**
 * Hàng mang dấu vết kế toán CŨ trong JSON (đã trả / có ảnh) mà THIẾU rid — không định vị được: đường Lưu cấp rid MỚI
 * cho hàng thiếu rid SAU reconcile (src/quoteUtils.ts sanitizeExtraTables), tức lần Lưu kế xoá im cờ + ảnh (bản base64
 * DUY NHẤT). Route /pay cũ luôn đòi rid nên dữ liệu này gần như không có — nhưng có thì đường Lưu phải TỪ CHỐI (400) cho
 * tới khi quản trị chuẩn hoá mã bằng công cụ (backfillKhoanChi --sua-rid, giữ nguyên cờ). Trả tên các hàng đó.
 */
export function hangVetThieuRid(side: string, tables: unknown): string[] {
  const out: string[] = [];
  for (const { it, ten } of hangCuaPhia(side, tables)) if (!chu(it.rid) && coDauVetJsonCu(it)) out.push(ten || "(không tên)");
  return out;
}

/** Lỗi khi đường Lưu gặp hàng đã trả (cũ) thiếu rid — xem hangVetThieuRid. 400, code 'hang-da-chi-thieu-ma'. */
export function loiVetThieuRid(tenHang: string[]) {
  const nhan = tenHang.slice(0, 5).map((t) => `"${String(t).slice(0, 80)}"`).join(", ") + (tenHang.length > 5 ? "…" : "");
  return Object.assign(
    httpError(
      400,
      `Không lưu được: ${tenHang.length} dòng đã đánh dấu đã trả (dữ liệu cũ) chưa có mã nội bộ: ${nhan} — lưu lúc này sẽ làm mất dấu đã trả và ảnh chứng từ của chúng. ` +
        "Nhờ quản trị chạy công cụ chuẩn hoá mã (backfillKhoanChi --sua-rid) rồi lưu lại.",
    ),
    { code: "hang-da-chi-thieu-ma" },
  );
}

/**
 * KT-6 — trong MỘT phía, hàng thứ hai trở đi mang trùng `rid` nhận rid MỚI; hàng đầu giữ. Khớp luật "mỗi rid chỉ kế
 * thừa MỘT lần" của reconcileExtraApprovals / reconcileExtraPayments (src/services/quoteService.ts), nên gọi TRƯỚC hai
 * hàm đó không đổi kết quả của chúng — chỉ làm cho khoản kế toán (khoá theo rid) không bao giờ trỏ vào hai hàng.
 * Trả số hàng đã đổi rid. Mutate tại chỗ.
 */
export function tachRidTrung(side: string, tables: unknown, sinh: () => string = randomUUID): number {
  const da = new Set<string>();
  let n = 0;
  for (const { it } of hangCuaPhia(side, tables)) {
    const rid = chu(it.rid);
    if (!rid) continue;
    if (da.has(rid)) { it.rid = sinh(); n++; } else da.add(rid);
  }
  return n;
}

export type AnhChupHang = {
  name: string;
  unit: string | null;
  quantity: number;
  unitPrice: number;
  days: number | null;
  amount: number;
  category: string | null;
  tableName: string | null;
};

/**
 * Ảnh chụp một hàng — dùng cho `paidSnapshot` (lúc TÍCH: "chi cho cái gì, bao nhiêu") và `rowSnapshot` (lần ghi gần
 * nhất: để còn hiện được khi hàng đã rời báo giá). Tiền qua ĐÚNG `extraTableSum` (làm tròn từng dòng, quantityExact,
 * days theo mẫu của bảng) — một phép tính thứ hai là cách có hai con số cho cùng một khoản chi.
 */
export function chupHang(p: { it: Record<string, any>; ten: string; t: Record<string, any> }, coNgay: boolean, side: string): AnhChupHang {
  const { it, ten, t } = p;
  return {
    name: ten || "",
    unit: chu(it.unit),
    quantity: Number(it.quantity) || 0,
    unitPrice: Number(it.unitPrice) || 0,
    days: coNgay && it.days != null ? Number(it.days) : null,
    // Một dòng, `category` bỏ trống → không lọc "chỉ hàng đã duyệt" (người gọi tự quyết hàng nào được chụp).
    amount: extraTableSum({ items: [it] }, coNgay),
    category: side === "hn" ? "hanoi" : chu(t.category),
    tableName: chu(t.name),
  };
}

/**
 * Lớp phủ trình bày: đè `paid/paidAt/paidById/hasPaidProof` theo khoản lên một mảng bảng ĐÃ dựng cho client (hoặc hàng
 * thô của danh sách). Hàng không có khoản giữ nguyên — tức cờ JSON cũ (KT-3). Mutate tại chỗ.
 */
export function apCoKeToan(side: string, tables: unknown, khoan: Map<string, Pick<KhoanChiNap, "paid" | "paidAt" | "paidById" | "paidByName" | "currentProofId">>): void {
  if (!khoan.size) return;
  for (const { it } of hangCuaPhia(side, tables)) {
    const rid = chu(it.rid);
    const e = rid ? khoan.get(khoaKhoanChi(side, rid)) : undefined;
    if (!e) continue;
    const tt = trangThaiHieuLuc(e, it);
    it.paid = tt.paid;
    it.paidAt = tt.paidAt;
    it.paidById = tt.paidById;
    it.hasPaidProof = tt.hasPaidProof;
  }
}

/**
 * Lớp phủ cho BA hình dạng phản hồi báo giá (src/quoteUtils.ts): presentQuote (`sheets[].extraTables` + `hnTables`),
 * presentQuoteForInternal (`internalSheets[].tables` + `hnTables`), account Hà Nội (`hnTables`) — và hàng thô của
 * listQuotes (`sheets[].extraTables` + `hnTables`). Không có khoản thì trả nguyên.
 */
export function phuKeToan<T>(out: T, khoan: Map<string, Pick<KhoanChiNap, "paid" | "paidAt" | "paidById" | "paidByName" | "currentProofId">>): T {
  if (!laObj(out) || !khoan.size) return out;
  const o = out as Record<string, any>;
  for (const s of Array.isArray(o.sheets) ? o.sheets : []) if (laObj(s)) apCoKeToan("sheet", s.extraTables, khoan);
  for (const s of Array.isArray(o.internalSheets) ? o.internalSheets : []) if (laObj(s)) apCoKeToan("sheet", s.tables, khoan);
  apCoKeToan("hn", o.hnTables, khoan);
  return out;
}

/** Cờ JSON cũ đúng lúc tạo khoản — `legacySeed` (để `backfillKhoanChi --kiem` bắt bản app cũ còn ghi JSON). */
export type HatGiongJson = { paid: boolean; paidAt: string | null; paidById: number | null; hasProof: boolean };
export function hatGiongJson(it: Record<string, any> | null | undefined): HatGiongJson {
  const coAnh = (typeof it?.paidProof === "string" && it.paidProof !== "") || it?.hasPaidProof === true;
  return {
    paid: it?.paid === true,
    paidAt: it?.paid === true ? isoHoacNull(it?.paidAt) : null,
    paidById: it?.paid === true && typeof it?.paidById === "number" ? it.paidById : null,
    hasProof: coAnh,
  };
}

/** Hàng JSON có dấu vết kế toán cũ (đã trả / có ảnh) — thứ mà công cụ chuyển dữ liệu phải chép sang bảng. */
export const coDauVetJsonCu = (it: Record<string, any> | null | undefined) => {
  const h = hatGiongJson(it);
  return h.paid || h.hasProof;
};

/** 'YYYY-MM-DD' là ngày lịch có thật (src/vnTime.ts — validators.ts dùng chung, khỏi phải kéo cả tệp này). */
export { laNgayLich };
/** 'YYYY-MM-DD' → Date nửa đêm UTC của ĐÚNG ngày đó (cột @db.Date: Prisma cắt phần giờ theo UTC). */
export const ngayTuChuoi = (s: string) => new Date(`${s}T00:00:00.000Z`);
/** Date của cột @db.Date → 'YYYY-MM-DD' (đọc theo UTC — cùng chiều với lúc ghi, không lệch múi giờ). */
export function ngayRaChuoi(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  const v = d instanceof Date ? d : new Date(String(d));
  return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
}

/** Số tiền lúc tích (paidSnapshot.amount) — null khi khoản gieo từ cờ JSON cũ (không biết số lúc trả). */
export function tienLucChi(entry: Pick<KhoanChiNap, "paid" | "paidSnapshot"> | null | undefined): number | null {
  if (!entry?.paid || !laObj(entry.paidSnapshot)) return null;
  const a = Number((entry.paidSnapshot as Record<string, unknown>).amount);
  return Number.isFinite(a) ? a : null;
}

/**
 * KT-4 — lỗi khi một lần Lưu làm biến mất hàng ĐÃ CHI. 400 chứ KHÔNG 409: ở màn soạn 409 mở hộp "người khác vừa lưu"
 * và gợi ý tải lại (mất phần đang soạn), còn mọi lỗi khác chỉ toast và GIỮ phần đang soạn
 * (web/src/pages/QuoteEditor.tsx). Xoá DÒNG thì Ctrl+Z cứu được; bảng / trang đã xoá thì tải lại trang.
 */
export function loiHangDaChi(tenHang: string[]) {
  const nhan = tenHang.slice(0, 5).map((t) => `"${String(t).slice(0, 80)}"`).join(", ") + (tenHang.length > 5 ? "…" : "");
  return Object.assign(
    httpError(
      400,
      `Không lưu được: ${tenHang.length} khoản kế toán đã đánh dấu ĐÃ CHI sẽ bị xoá: ${nhan}. ` +
        "Bấm Ctrl+Z để khôi phục hàng (bảng / trang đã xoá thì tải lại trang), hoặc nhờ kế toán bỏ đánh dấu ở trang Hóa đơn đầu vào trước.",
    ),
    { code: "hang-da-chi" },
  );
}

/** Lỗi có `code` máy đọc được — errorHandler (src/middleware.ts) trả `{ error, code }` cho mọi lỗi < 500. */
export const loiCoMa = (status: number, code: string, message: string) => Object.assign(httpError(status, message), { code });

export type AnhChungTuDto = {
  id: number;
  uploadedAt: string | null;
  uploadedByName: string | null;
  retiredAt: string | null;
  retiredReason: string | null;
  source: string;
  /** Ảnh HIỆN TẠI của khoản (các ảnh còn lại đã rút vào lịch sử). */
  hienTai: boolean;
};

/**
 * Phần KẾ TOÁN của một dòng Hóa đơn đầu vào — cùng hình dạng cho phản hồi PUT khoản chi và cho từng dòng của
 * GET /input-invoices, để web vá bộ nhớ đệm bằng đúng thứ máy chủ trả. KHÔNG BAO GIỜ mang ảnh (`dataUrl`), tổng tiền
 * báo giá hay thông tin khách.
 */
export type KhoanChiDto = {
  key: string;
  quoteId: number;
  side: PhiaKhoanChi;
  rid: string;
  /** Mốc khoá lạc quan của khoản — 0 khi chưa có khoản (gửi lại làm `baseVersion`). */
  version: number;
  paid: boolean;
  paidAt: string | null;
  paidByName: string | null;
  hasPaidProof: boolean;
  proofs: AnhChungTuDto[];
  /** Số tiền LÚC TÍCH (null: chưa chi, hoặc khoản gieo từ cờ JSON cũ — không biết số lúc trả). */
  paidAmount: number | null;
  /** Đã chi mà số tiền hiện tại khác số lúc tích — "Số tiền đã đổi sau khi chi". */
  tienDoi: boolean;
  invoiceDate: string | null;
  accountingNote: string | null;
  keToanCapNhatLuc: string | null;
  keToanCapNhatBoi: string | null;
  nguon: NguonKeToan;
};

/** Khoá ổn định của một dòng Hóa đơn đầu vào có `rid`: báo giá + phía + rid (không đổi khi trang được tạo lại). */
export const khoaDongDauVao = (quoteId: number, side: string, rid: string) => `${quoteId}:${side}:${rid}`;

export function dtoKhoanChi(p: {
  quoteId: number;
  side: PhiaKhoanChi;
  rid: string;
  entry?: KhoanChiNap | null;
  anh?: AnhChungTuNap[];
  /** Hàng JSON (đã cắt ảnh) — nguồn dự phòng khi chưa có khoản. */
  itJson?: Record<string, any> | null;
  /** Số tiền hiện tại của hàng (null: hàng không còn trong báo giá). */
  tienHienTai?: number | null;
  /** id → tên, cho `paidById` của cờ JSON cũ (khoản thì đã chụp sẵn tên). */
  tenNguoi?: Map<number, string>;
}): KhoanChiDto {
  const { quoteId, side, rid, entry } = p;
  const tt = trangThaiHieuLuc(entry, p.itJson);
  const paidAmount = entry ? tienLucChi(entry) : null;
  return {
    key: khoaDongDauVao(quoteId, side, rid),
    quoteId,
    side,
    rid,
    version: entry?.version ?? 0,
    paid: tt.paid,
    paidAt: tt.paidAt,
    paidByName: tt.paidByName ?? (tt.paidById != null ? p.tenNguoi?.get(tt.paidById) ?? null : null),
    hasPaidProof: tt.hasPaidProof,
    proofs: (p.anh ?? [])
      .slice()
      .sort((a, b) => b.id - a.id)
      .map((a) => ({
        id: a.id,
        uploadedAt: isoHoacNull(a.uploadedAt),
        uploadedByName: a.uploadedByName ?? null,
        retiredAt: isoHoacNull(a.retiredAt),
        retiredReason: a.retiredReason ?? null,
        source: a.source,
        hienTai: entry?.currentProofId === a.id,
      })),
    paidAmount,
    tienDoi: tt.paid && paidAmount != null && p.tienHienTai != null && paidAmount !== p.tienHienTai,
    invoiceDate: entry ? ngayRaChuoi(entry.invoiceDate) : null,
    accountingNote: entry?.accountingNote ?? null,
    keToanCapNhatLuc: entry ? isoHoacNull(entry.updatedAt) : null,
    keToanCapNhatBoi: entry?.updatedByName ?? null,
    nguon: tt.nguon,
  };
}

/** Ảnh chụp hàng (`rowSnapshot`/`paidSnapshot`) đọc lại an toàn từ cột Json. */
export function docAnhChup(v: unknown): AnhChupHang | null {
  if (!laObj(v)) return null;
  return {
    name: typeof v.name === "string" ? v.name : "",
    unit: chu(v.unit),
    quantity: Number(v.quantity) || 0,
    unitPrice: Number(v.unitPrice) || 0,
    days: v.days != null && Number.isFinite(Number(v.days)) ? Number(v.days) : null,
    amount: Number(v.amount) || 0,
    category: chu(v.category),
    tableName: chu(v.tableName),
  };
}
