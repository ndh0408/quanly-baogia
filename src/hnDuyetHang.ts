// DUYỆT TỪNG HÀNG BẢNG HÀ NỘI — luật THUẦN (không Prisma, không HTTP ngoài lỗi), chủ repo 2026-10-06: "Thêm cột Duyệt
// từng hàng … gửi duyệt từng hàng hay trả lại gì cũng vậy, cái nào đã duyệt thì không cho sửa nhé, có sửa từng hàng và
// qua đầu vào nữa chứ".
//
// ── TRẠNG THÁI MỘT HÀNG (`it.trangThaiDuyet`, do MÁY CHỦ sở hữu) ─────────────────────────────────────────────
//   "dang-lam"  Account HN / người soạn đang làm — sửa được.
//   "cho-duyet" Account HN đã gửi — khoá với Account HN (và với người không có quyền duyệt) cho tới khi duyệt / trả.
//   "da-duyet"  Đã duyệt — KHOÁ với MỌI người (cả người có quyền duyệt): muốn sửa phải BỎ DUYỆT trước. Vào Hóa đơn
//               đầu vào ngay, không chờ cả phần.
//   "tra-lai"   Bị trả lại kèm lý do (`it.lyDoTra`) — mở cho Account HN sửa rồi gửi lại.
// Chỉ đổi qua các thao tác ở src/hnWorkflow.ts (gửi / duyệt / trả / bỏ duyệt). Mọi đường Lưu (saveHn, Lưu báo giá,
// tạo báo giá) LẤY LẠI trạng thái theo `rid` từ CSDL — payload không bao giờ đổi được nó (zod cũng không khai trường).
//
// ── DỮ LIỆU CŨ: KHÔNG MIGRATION, SUY RA LÚC ĐỌC ─────────────────────────────────────────────────────────────
// Trước bản này phần HN duyệt CẢ PHẦN (`Quote.hnStatus`). Hàng CHƯA có `trangThaiDuyet` thì suy từ trạng thái cả
// phần: approved → "da-duyet" (ngày / người duyệt = `hnReviewedAt` / `hnReviewerId`), submitted → "cho-duyet",
// rejected → "tra-lai" (lý do = `hnRejectNote`), còn lại → "dang-lam". Hàng ĐÃ có trạng thái riêng thì nó THẮNG —
// kể cả "dang-lam" sau khi bỏ duyệt tường minh trên một báo giá cũ đã duyệt cả phần. Mọi lần GHI bảng HN đều
// "vật chất hoá" trạng thái hiệu lực vào từng hàng (`vatChatHoaHn` / `reconcileTrangThaiHn`), nên sau lần ghi đầu
// `hnStatus` chỉ còn là TÓM TẮT (`tomTatHn`) cho danh sách / thẻ trạng thái — không còn quyết định hàng nào.
import { httpError } from "./httpError.js";

export type TrangThaiHangHn = "dang-lam" | "cho-duyet" | "da-duyet" | "tra-lai";
export const TRANG_THAI_HANG_HN: readonly TrangThaiHangHn[] = ["dang-lam", "cho-duyet", "da-duyet", "tra-lai"];
const laTrangThai = (v: unknown): v is TrangThaiHangHn => typeof v === "string" && (TRANG_THAI_HANG_HN as readonly string[]).includes(v);

/** Phần trạng thái CẢ PHẦN của báo giá cần để suy trạng thái hàng cũ. */
export type PhanHn = {
  hnStatus?: string | null;
  hnReviewedAt?: Date | string | null;
  hnReviewerId?: number | null;
  hnRejectNote?: string | null;
};

const CAU_TRUC = new Set(["section", "subsection", "info"]);
const laObj = (x: unknown): x is Record<string, any> => !!x && typeof x === "object" && !Array.isArray(x);
const chu = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const iso = (v: unknown): string | null => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/** Mọi hàng TIỀN của bảng HN (bỏ nhóm / nhóm con / dòng thông tin — chúng không có trạng thái duyệt), kèm vị trí và
 *  tên (dòng con thừa hưởng tên hạng mục đứng trước — cùng luật `hangCuaPhia` của src/khoanChi.ts). */
export function* hangTienHn(tables: unknown): Generator<{ t: Record<string, any>; it: Record<string, any>; ten: string; ti: number; ii: number }> {
  const ds = Array.isArray(tables) ? tables : [];
  for (let ti = 0; ti < ds.length; ti++) {
    const t = ds[ti];
    if (!laObj(t)) continue;
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

/** Trạng thái HIỆU LỰC của một hàng: trạng thái riêng thắng; vắng thì suy từ trạng thái cả phần (dữ liệu cũ). */
export function trangThaiHangHn(it: unknown, q: PhanHn | null | undefined): TrangThaiHangHn {
  if (laObj(it) && laTrangThai(it.trangThaiDuyet)) return it.trangThaiDuyet;
  switch (q?.hnStatus) {
    case "approved": return "da-duyet";
    case "submitted": return "cho-duyet";
    case "rejected": return "tra-lai";
    default: return "dang-lam";
  }
}

export const daDuyetHangHn = (it: unknown, q: PhanHn | null | undefined) => trangThaiHangHn(it, q) === "da-duyet";

/** Dấu duyệt HIỆU LỰC (ngày / người duyệt, lý do trả) — hàng cũ lấy theo cả phần. */
export function dauDuyetHangHn(it: unknown, q: PhanHn | null | undefined): { approvedAt: string | null; approvedBy: number | null; lyDoTra: string | null } {
  const tt = trangThaiHangHn(it, q);
  const r = laObj(it) ? it : {};
  if (laTrangThai(r.trangThaiDuyet)) {
    return {
      approvedAt: tt === "da-duyet" ? iso(r.approvedAt) : null,
      approvedBy: tt === "da-duyet" && typeof r.approvedBy === "number" ? r.approvedBy : null,
      lyDoTra: tt === "tra-lai" ? chu(r.lyDoTra) : null,
    };
  }
  return {
    approvedAt: tt === "da-duyet" ? iso(q?.hnReviewedAt) : null,
    approvedBy: tt === "da-duyet" && typeof q?.hnReviewerId === "number" ? q.hnReviewerId : null,
    lyDoTra: tt === "tra-lai" ? chu(q?.hnRejectNote) : null,
  };
}

/** Ghi trạng thái (và các cờ đi kèm) vào một hàng. `approved` giữ đồng bộ để mọi nơi đọc cờ cũ thấy đúng. */
function ganTrangThai(it: Record<string, any>, tt: TrangThaiHangHn, dau: { approvedAt: string | null; approvedBy: number | null; lyDoTra: string | null }) {
  it.trangThaiDuyet = tt;
  it.approved = tt === "da-duyet";
  it.approvedAt = tt === "da-duyet" ? dau.approvedAt : null;
  it.approvedBy = tt === "da-duyet" ? dau.approvedBy : null;
  it.lyDoTra = tt === "tra-lai" ? dau.lyDoTra : null;
}

/** Dòng cấu trúc (nhóm / thông tin) không mang trạng thái duyệt nào — dọn mọi thứ client có thể đã gửi. */
function donCauTruc(tables: unknown) {
  for (const t of Array.isArray(tables) ? tables : []) {
    if (!laObj(t) || !Array.isArray(t.items)) continue;
    for (const it of t.items) {
      if (!laObj(it) || !CAU_TRUC.has(String(it.kind))) continue;
      delete it.trangThaiDuyet; delete it.lyDoTra;
      it.approved = false; it.approvedAt = null; it.approvedBy = null;
    }
  }
}

/**
 * VÂN TAY NỘI DUNG của một hàng — thứ bị KHOÁ khi hàng đã duyệt. Cùng tập trường người dùng gõ với `vanTayHn`
 * (src/quoteUtils.ts) cộng TÊN + MẪU của bảng chứa nó (đổi mẫu là đổi luật nhân Số Ngày, tức đổi tiền; tên bảng
 * đi theo dòng ra trang Hóa đơn đầu vào). `coNgay` = mẫu của bảng có cột Số Ngày không: không có thì Số Ngày không
 * vào tiền, và web gửi `days: null` cho bảng đó — so nguyên văn là khoá oan một hàng cũ còn days trong CSDL.
 * Không gồm `rid`, `approved*`, `paid*`, công thức (kết quả công thức đã nằm trong số).
 */
export function vanTayHangHn(it: Record<string, any>, t: Record<string, any> | null | undefined, coNgay = true, boCotNoiBo = false): string {
  return JSON.stringify([
    t?.name ? String(t.name).trim() : null,
    t?.templateId != null && Number(t.templateId) ? Number(t.templateId) : null,
    it?.kind ?? null, it?.label ?? null, (it?.name || "").trim(), it?.detail ?? null, it?.unit ?? null,
    Number(it?.quantity) || 0, !!it?.quantityExact, Number(it?.unitPrice) || 0,
    coNgay && it?.days != null ? Number(it.days) : null,
    it?.notes ?? null,
    ...(boCotNoiBo ? [] : [it?.ns ?? null, !!it?.luuKho, it?.chungTu ?? null]),
  ]);
}

/** Bản sao để TRÌNH BÀY: mỗi hàng tiền mang trạng thái HIỆU LỰC (hàng cũ suy từ cả phần). Không đụng bản gốc. */
export function phuTrangThaiHn(tables: unknown, q: PhanHn | null | undefined): any[] {
  if (!Array.isArray(tables)) return [];
  return tables.map((t: any) => {
    if (!laObj(t) || !Array.isArray(t.items)) return t;
    return {
      ...t,
      items: t.items.map((it: any) => {
        if (!laObj(it) || CAU_TRUC.has(String(it.kind))) return it;
        const o = { ...it };
        ganTrangThai(o, trangThaiHangHn(it, q), dauDuyetHangHn(it, q));
        return o;
      }),
    };
  });
}

/** VẬT CHẤT HOÁ tại chỗ: mọi hàng tiền mang trạng thái riêng (hàng cũ lấy theo cả phần). Gọi trước mọi thao tác
 *  đổi trạng thái hàng / đổi `hnStatus`, để `hnStatus` mới không còn kéo theo hàng nào. */
export function vatChatHoaHn(tables: unknown, q: PhanHn | null | undefined) {
  for (const { it } of hangTienHn(tables)) ganTrangThai(it, trangThaiHangHn(it, q), dauDuyetHangHn(it, q));
  donCauTruc(tables);
}

/**
 * `hnStatus` TÓM TẮT từ các hàng (đã vật chất hoá): còn hàng chờ duyệt → "submitted"; không, còn hàng bị trả →
 * "rejected"; mọi hàng đã duyệt → "approved"; còn lại → "assigned" nếu có Account HN được giao, không thì null.
 * Phần chưa có hàng nào → `rong` (nơi gọi quyết).
 */
export function tomTatHn(tables: unknown, coNguoiGiao: boolean, rong: string | null): string | null {
  const ds = [...hangTienHn(tables)].map(({ it }) => trangThaiHangHn(it, null));
  if (!ds.length) return rong;
  if (ds.includes("cho-duyet")) return "submitted";
  if (ds.includes("tra-lai")) return "rejected";
  if (ds.every((x) => x === "da-duyet")) return "approved";
  return coNguoiGiao ? "assigned" : null;
}

const nhanHang = (ds: string[]) => ds.slice(0, 5).map((t) => `"${String(t || "(không tên)").slice(0, 80)}"`).join(", ") + (ds.length > 5 ? "…" : "");

/**
 * ĐƯỜNG LƯU (saveHn của Account HN, Lưu báo giá, tạo báo giá): lấy lại trạng thái từng hàng theo `rid` từ CSDL và
 * CHẶN sửa / xoá hàng đang khoá. Mutate `pl` tại chỗ (đối xứng reconcileExtra*). Gọi SAU chuanHoaRidTrung /
 * tachRidTrung (mỗi rid chỉ còn một hàng), TRƯỚC sanitizeHnTables.
 *
 * Khoá: "da-duyet" với mọi người; thêm "cho-duyet" khi `khoaChoDuyet` (Account HN — đã gửi thì chờ duyệt / trả;
 * người soạn KHÔNG có quyền duyệt — đúng chốt cũ của phần "đã gửi duyệt"). Người có quyền duyệt sửa được hàng đang
 * chờ (họ là người duyệt nó), nhưng KHÔNG sửa được hàng đã duyệt: bỏ duyệt trước, rồi sửa, rồi duyệt lại.
 *
 * 409 (không phải 400 như chốt duyệt hàng HCM): cùng mã với chốt cả phần cũ (chotHnTables) mà các màn soạn đã biết
 * xử lý — phần đang gõ được giữ lại trên máy rồi tải bản mới, đúng thứ cần khi ai đó vừa duyệt hàng mình đang sửa.
 *
 * `moCotNoiBo`: ba cột nội bộ NS · Chứng từ · Lưu kho của hàng đã khoá VẪN sửa được — chỉ cho người quản lý phần HN
 * (quote:hn:manage, không phải account phụ: đúng đặc quyền của chốt cả phần cũ). Chúng là việc theo dõi SAU duyệt (đã
 * hoàn ứng chưa, hàng đã vào kho chưa, loại chứng từ thật nhận được), không phải số tiền được duyệt.
 *
 * Hàng cũ THIẾU rid (chưa từng qua đường Lưu từ khi có rid) khớp theo VỊ TRÍ (bảng, hàng) với hàng cũng thiếu rid ở
 * payload — không vậy thì một hàng đã duyệt cả phần sẽ "mới" lại sau lần Lưu đầu (sanitize cấp rid mới) và rơi khỏi
 * Hóa đơn đầu vào.
 */
export function reconcileTrangThaiHn(
  pl: unknown,
  db: unknown,
  q: PhanHn | null | undefined,
  opts: { khoaChoDuyet?: boolean; moCotNoiBo?: boolean; coNgayDb?: (t: Record<string, any>) => boolean; coNgayPl?: (t: Record<string, any>) => boolean } = {},
) {
  const coNgayDb = opts.coNgayDb ?? (() => true);
  const coNgayPl = opts.coNgayPl ?? coNgayDb;
  type Truoc = { tt: TrangThaiHangHn; dau: ReturnType<typeof dauDuyetHangHn>; van: string; ten: string };
  const theoRid = new Map<string, Truoc>();
  const theoViTri = new Map<string, Truoc>();
  for (const { t, it, ten, ti, ii } of hangTienHn(db)) {
    const rec: Truoc = { tt: trangThaiHangHn(it, q), dau: dauDuyetHangHn(it, q), van: vanTayHangHn(it, t, coNgayDb(t), !!opts.moCotNoiBo), ten };
    const r = chu(it.rid);
    if (r) { if (!theoRid.has(r)) theoRid.set(r, rec); } else theoViTri.set(`${ti}:${ii}`, rec);
  }
  const khoa = (tt: TrangThaiHangHn) => tt === "da-duyet" || (!!opts.khoaChoDuyet && tt === "cho-duyet");
  const daDung = new Set<Truoc>();
  const biSua: string[] = [];
  for (const { t, it, ten, ti, ii } of hangTienHn(pl)) {
    const r = chu(it.rid);
    let p = r ? theoRid.get(r) : theoViTri.get(`${ti}:${ii}`);
    if (p && daDung.has(p)) p = undefined;          // bản sao thứ hai của cùng một hàng → hàng mới
    if (p) {
      daDung.add(p);
      if (khoa(p.tt) && vanTayHangHn(it, t, coNgayPl(t), !!opts.moCotNoiBo) !== p.van) biSua.push(ten || p.ten);
      ganTrangThai(it, p.tt, p.dau);
    } else {
      ganTrangThai(it, "dang-lam", { approvedAt: null, approvedBy: null, lyDoTra: null });
    }
  }
  const biXoa: string[] = [];
  for (const p of [...theoRid.values(), ...theoViTri.values()]) if (khoa(p.tt) && !daDung.has(p)) biXoa.push(p.ten);
  donCauTruc(pl);
  if (biSua.length || biXoa.length) {
    const chuDe = opts.khoaChoDuyet ? "đã gửi duyệt / đã duyệt" : "đã duyệt";
    const phan = [
      biSua.length ? `${biSua.length} hàng bị sửa: ${nhanHang(biSua)}` : "",
      biXoa.length ? `${biXoa.length} hàng bị xoá: ${nhanHang(biXoa)}` : "",
    ].filter(Boolean).join("; ");
    throw Object.assign(
      httpError(409, `Không lưu được: hàng Hà Nội ${chuDe} bị khoá — ${phan}. ` +
        "Hàng đã duyệt chỉ sửa được sau khi người có quyền duyệt BỎ DUYỆT. Hãy chép lại phần vừa gõ, tải lại trang rồi làm tiếp."),
      { code: "hang-hn-da-khoa" },
    );
  }
}

export type ThaoTacHangHn = "gui" | "duyet" | "tra" | "bo-duyet";

/**
 * Đổi trạng thái các hàng theo một thao tác (bảng ĐÃ vật chất hoá). `rids` vắng = thao tác hàng loạt trên mọi hàng
 * hợp lệ: gửi → mọi hàng đang làm / bị trả; duyệt / trả → mọi hàng đang chờ duyệt. `rids` có = đúng các hàng đó (hàng
 * không ở trạng thái hợp lệ bị bỏ qua — nơi gọi báo khi không còn hàng nào).
 *
 *   gui      dang-lam | tra-lai            → cho-duyet
 *   duyet    cho-duyet (+ dang-lam | tra-lai khi chọn hàng: người duyệt tự điền rồi duyệt thẳng) → da-duyet
 *   tra      cho-duyet (+ da-duyet khi chọn hàng)  → tra-lai, kèm lý do
 *   bo-duyet da-duyet                      → dang-lam (chỉ khi chọn hàng)
 *
 * Trả về tên các hàng đã đổi (cho thông báo / nhật ký).
 */
export function apThaoTacHangHn(tables: unknown, loai: ThaoTacHangHn, opt: { rids?: string[] | null; nguoi: number; luc: string; lyDo?: string | null }): { ten: string[]; rids: string[] } {
  const chon = opt.rids && opt.rids.length ? new Set(opt.rids.map((r) => String(r).trim())) : null;
  const hopLe = (tt: TrangThaiHangHn): boolean => {
    switch (loai) {
      case "gui": return tt === "dang-lam" || tt === "tra-lai";
      case "duyet": return chon ? tt !== "da-duyet" : tt === "cho-duyet";
      case "tra": return chon ? tt === "cho-duyet" || tt === "da-duyet" : tt === "cho-duyet";
      case "bo-duyet": return !!chon && tt === "da-duyet";
    }
  };
  const ten: string[] = [];
  const rids: string[] = [];
  for (const { it, ten: tenHang } of hangTienHn(tables)) {
    const r = chu(it.rid);
    if (chon && (!r || !chon.has(r))) continue;
    const tt = trangThaiHangHn(it, null);
    if (!hopLe(tt)) continue;
    const moi: TrangThaiHangHn = loai === "gui" ? "cho-duyet" : loai === "duyet" ? "da-duyet" : loai === "tra" ? "tra-lai" : "dang-lam";
    ganTrangThai(it, moi, {
      approvedAt: moi === "da-duyet" ? opt.luc : null,
      approvedBy: moi === "da-duyet" ? opt.nguoi : null,
      lyDoTra: moi === "tra-lai" ? (chu(opt.lyDo) ?? null) : null,
    });
    ten.push(tenHang || "(không tên)");
    if (r) rids.push(r);
  }
  return { ten, rids };
}
