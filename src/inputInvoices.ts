// HÓA ĐƠN ĐẦU VÀO — dựng danh sách "mỗi hàng bảng nội bộ ĐÃ DUYỆT là một khoản chi cần hoá đơn đầu vào"
// (chủ repo 2026-09-30). Thuần: không Prisma, không HTTP — `listInputInvoices` (quoteService) lo truy vấn,
// hàm này lo LUẬT: hàng nào vào, tiền bao nhiêu, nhãn gì. Tách ra để test được không cần CSDL.
//
// ── "ĐÃ DUYỆT" Ở REPO NÀY CÓ HAI DẠNG ────────────────────────────────────────────────────────────
//   · Chi phí HCM / Phí khách hàng (`QuoteSheet.extraTables`): duyệt THEO HÀNG — `item.approved`, do người có
//     quote:internal:approve đặt và server giữ theo `rid` (reconcileExtraApprovals). Hàng chưa duyệt không cộng
//     vào tổng (`extraTableSum`), nên cũng không đòi hoá đơn.
//   · Báo giá Hà Nội (`Quote.hnTables`): từ 2026-10-06 cũng duyệt THEO HÀNG — `it.trangThaiDuyet = "da-duyet"` (src/
//     hnDuyetHang.ts), vào NGAY khi hàng được duyệt, không chờ cả phần. Hàng CŨ chưa có trạng thái riêng suy từ cả phần
//     (`Quote.hnStatus = "approved"` → đã duyệt, ngày / người duyệt theo `hnReviewedAt` / `hnReviewerId`) — báo giá đã
//     duyệt cả phần trước bản này (có thể đã có khoản ĐÃ CHI) giữ nguyên mọi dòng, không cần migration dữ liệu.
//
// ── PHẦN KẾ TOÁN (2026-10-06) ─────────────────────────────────────────────────────────────────────
// Mỗi dòng mang thêm dữ liệu kế toán của khoản (bảng InputInvoiceEntry — src/khoanChi.ts): đã chi + ảnh, ngày HĐ,
// ghi chú. Danh sách là HỢP ba nhóm, để kế toán (không có quote:read:*, không mở được báo giá) không bao giờ gặp
// ngõ cụt khi người soạn bỏ duyệt / xoá hàng / xoá báo giá sau khi khoản đã có dữ liệu:
//   · "binh-thuong"     — hàng đủ điều kiện như trước;
//   · "chua-duyet" / "hn-chua-duyet" — hàng CÓ dữ liệu kế toán (khoản, hoặc cờ / ảnh JSON cũ) mà nay chưa đủ điều kiện;
//   · "khong-con-hang"  — khoản mà hàng của nó không còn trong báo giá (dựng từ ảnh chụp `rowSnapshot`);
//   · "bao-gia-da-xoa"  — khoản của báo giá đã xoá mềm (chỉ xem) — xem `hangKhoanBaoGiaDaXoa`.
//
// TIỀN dùng ĐÚNG `extraTableSum` (làm tròn từng dòng, `quantityExact`, days theo MẪU của bảng) — một bản tính
// thứ hai ở đây là cách có hai con số cho cùng một khoản chi. Không bao giờ mang `paidProof` (ảnh ủy nhiệm chi).
import { extraTableSum, bangNoiBoCoNgay, type MauBangNoiBo } from "./quoteUtils.js";
import { codeLabel, sheetCode, soMa } from "./quoteCode.js";
import { daDuyetHangHn, dauDuyetHangHn } from "./hnDuyetHang.js";
import {
  hangCuaPhia,
  khoaKhoanChi,
  khoaDongDauVao,
  coDauVetJsonCu,
  dtoKhoanChi,
  docAnhChup,
  type PhiaKhoanChi,
  type KhoanChiNap,
  type AnhChungTuNap,
  type KhoanChiDto,
} from "./khoanChi.js";

export type LoaiBangDauVao = "hcm" | "khach" | "hanoi";
export type TrangThaiHangDauVao = "binh-thuong" | "chua-duyet" | "hn-chua-duyet" | "khong-con-hang" | "bao-gia-da-xoa";

export type HangDauVao = Omit<KhoanChiDto, "key" | "rid" | "quoteId" | "side"> & {
  /**
   * Khoá ổn định của dòng: `quoteId:side:rid` khi hàng có `rid` DUY NHẤT trong phía (không đổi khi trang được tạo lại
   * sau mỗi lần Lưu). Hàng thiếu rid / rid trùng: khoá theo vị trí (gồm cả trang) và `coTheGhi = false`.
   */
  key: string;
  quoteId: number; quoteCode: string; title: string; status: string;
  customerCode: string | null; customerName: string | null; companyName: string | null; createdByName: string | null;
  /** `null` ở hàng Hà Nội: bảng HN thuộc CẢ báo giá, không thuộc trang nào. */
  sheetId: number | null; sheetName: string | null; sheetCode: string | null;
  side: PhiaKhoanChi;
  category: LoaiBangDauVao; tableName: string | null;
  rid: string | null; name: string; detail: string | null; unit: string | null;
  quantity: number; unitPrice: number; days: number | null; amount: number;
  ns: string | null; chungTu: "VAT" | "HDNS" | "TM" | null; luuKho: boolean;
  approvedAt: string | null; approvedByName: string | null;
  trangThaiHang: TrangThaiHangDauVao;
  /** Ghi được phần kế toán của dòng này không (máy chủ vẫn kiểm lại từng thao tác). */
  coTheGhi: boolean;
  /** Vì sao không ghi được — hiện ở `title` của ô Kế toán. */
  lyDoKhoa: string | null;
};

export type BaoGiaDauVao = {
  id: number; companyId: number | null; status: string;
  projectCode?: string | null; projectVersion?: number | null; quoteNumber?: string | null;
  title: string; shortTitle?: string | null;
  hnStatus?: string | null; hnReviewedAt?: Date | string | null; hnReviewerId?: number | null; hnRejectNote?: string | null;
  customer?: { code?: string | null; name?: string | null } | null;
  company?: { shortName?: string | null; name?: string | null } | null;
  createdBy?: { displayName?: string | null } | null;
};

// KHÔNG bảo "bấm Lưu": đường Lưu cấp rid SAU reconcile, nên hàng thiếu rid mất dấu duyệt (người không có quyền duyệt)
// hoặc bị đóng dấu duyệt lại (người có quyền) — công cụ chuẩn hoá mã giữ nguyên mọi cờ.
export const LY_DO_THIEU_RID = "Hàng cũ chưa có mã nội bộ — nhờ quản trị chạy công cụ chuẩn hoá mã (backfillKhoanChi --sua-rid), rồi tải lại trang này.";
// Hàng thiếu mã MÀ còn cờ "đã trả" / ảnh cũ: đường Lưu TỪ CHỐI (lưu sẽ xoá im cờ — src/khoanChi.ts hangVetThieuRid), nên
// "bấm Lưu" không phải lối ra — quản trị chuẩn hoá mã bằng công cụ (giữ nguyên cờ + ảnh).
export const LY_DO_THIEU_RID_CO_VET = "Hàng cũ đã trả nhưng chưa có mã nội bộ — nhờ quản trị chạy công cụ chuẩn hoá mã (backfillKhoanChi --sua-rid), rồi tải lại trang này.";
export const LY_DO_TRUNG_RID = "Có hai dòng cùng mã nội bộ trong báo giá — nhờ người soạn mở báo giá và bấm Lưu một lần (máy tự tách mã, mỗi dòng giữ dấu của chính nó), rồi tải lại trang này.";
export const LY_DO_DA_XOA = "Báo giá đã xoá — chỉ xem.";

const CHUNG_TU = new Set(["VAT", "HDNS", "TM"]);
const laBang = (t: unknown): t is Record<string, any> => !!t && typeof t === "object" && !Array.isArray(t);
const chu = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const iso = (v: unknown): string | null => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/** Tiêu đề hiển thị: tiêu đề rút gọn người dùng đặt, không có thì tiêu đề chính (cùng luật `tieuDeHienThi` của web). */
const tieuDe = (q: BaoGiaDauVao) => chu(q.shortTitle) ?? ((q.title || "").replace(/^\s*bảng\s+báo\s+giá\s*[-–—:|·]*\s*/i, "").trim() || q.title || "");

const thongTinBaoGia = (q: BaoGiaDauVao) => ({
  quoteId: q.id, quoteCode: codeLabel(q), title: tieuDe(q), status: String(q.status ?? ""),
  customerCode: chu(q.customer?.code), customerName: chu(q.customer?.name),
  companyName: chu(q.company?.shortName) ?? chu(q.company?.name), createdByName: chu(q.createdBy?.displayName),
});

/** Phần kế toán (DTO) bỏ bốn trường định danh — HangDauVao tự đặt khoá / rid / phía của nó. */
function phanKeToan(dto: KhoanChiDto) {
  const { key: _k, rid: _r, quoteId: _q, side: _s, ...con } = dto;
  return con;
}

/** Dòng dựng từ ẢNH CHỤP của khoản (hàng không còn trong báo giá, hoặc báo giá đã xoá). */
function dongTuAnhChup(p: {
  quote: BaoGiaDauVao; e: KhoanChiNap; anh: AnhChungTuNap[]; trangThai: "khong-con-hang" | "bao-gia-da-xoa"; tenNguoi?: Map<number, string>;
}): HangDauVao {
  const { quote: q, e } = p;
  const side: PhiaKhoanChi = e.side === "hn" ? "hn" : "sheet";
  const chup = docAnhChup(e.rowSnapshot);
  const loai: LoaiBangDauVao = side === "hn" ? "hanoi" : chup?.category === "khach" ? "khach" : "hcm";
  const dto = dtoKhoanChi({ quoteId: q.id, side, rid: e.rid, entry: e, anh: p.anh, tienHienTai: null, tenNguoi: p.tenNguoi });
  const daXoa = p.trangThai === "bao-gia-da-xoa";
  return {
    ...thongTinBaoGia(q),
    ...phanKeToan(dto),
    key: khoaDongDauVao(q.id, side, e.rid),
    sheetId: null, sheetName: null, sheetCode: side === "hn" ? null : codeLabel(q),
    side, category: loai, tableName: chup?.tableName ?? null,
    rid: e.rid, name: chup?.name || "(không rõ tên)", detail: null, unit: chup?.unit ?? null,
    quantity: chup?.quantity ?? 0, unitPrice: chup?.unitPrice ?? 0, days: chup?.days ?? null, amount: chup?.amount ?? 0,
    ns: null, chungTu: null, luuKho: false,
    approvedAt: null, approvedByName: null,
    trangThaiHang: p.trangThai,
    coTheGhi: !daXoa,
    lyDoKhoa: daXoa ? LY_DO_DA_XOA : null,
  };
}

export function hangHoaDonDauVao(p: {
  quote: BaoGiaDauVao;
  /** MỌI trang của báo giá, theo thứ tự — để đánh mã `_01/_02` đúng như trang Hoá đơn (đầu ra). */
  sheets: { id: number; order?: number; name?: string | null; codeNo?: number | null }[];
  /** Bảng nội bộ theo trang (đã cắt ảnh ở SQL). */
  sheetTables: { sheetId: number; tables: unknown[] }[];
  /** `Quote.hnTables` (đã cắt ảnh ở SQL). */
  bangHn: unknown[];
  dsMau: MauBangNoiBo[];
  tenNguoi: Map<number, string>;
  /** Khoản kế toán của báo giá này: khoá `${side}:${rid}` (src/khoanChi.ts khoaKhoanChi). */
  khoan?: Map<string, KhoanChiNap>;
  /** Siêu dữ liệu ảnh theo khoản: entryId → ảnh (không có dataUrl). */
  anh?: Map<number, AnhChungTuNap[]>;
}): HangDauVao[] {
  const { quote: q, sheets, sheetTables, bangHn, dsMau, tenNguoi } = p;
  const khoan = p.khoan ?? new Map<string, KhoanChiNap>();
  const anhCua = (e?: KhoanChiNap) => (e ? p.anh?.get(e.id) ?? [] : []);
  const out: HangDauVao[] = [];
  const goc = thongTinBaoGia(q);

  // rid TRÙNG phải đếm trên CẢ PHÍA (mọi trang gộp lại), đúng phạm vi khoá của khoản — đếm trước khi duyệt.
  const thuTu = [...sheets];
  const sheetTheoThuTu = sheetTables
    .map((st) => ({ ...st, i: thuTu.findIndex((s) => s.id === st.sheetId) }));
  const tatCaBangSheet = sheetTheoThuTu.flatMap((st) => (Array.isArray(st.tables) ? st.tables : []));
  const demRid = { sheet: new Map<string, number>(), hn: new Map<string, number>() };
  for (const [side, bang] of [["sheet", tatCaBangSheet], ["hn", Array.isArray(bangHn) ? bangHn : []]] as const) {
    for (const { it } of hangCuaPhia(side, bang)) {
      const r = chu(it.rid);
      if (r) demRid[side].set(r, (demRid[side].get(r) ?? 0) + 1);
    }
  }

  const duyet = (tables: unknown[], side: PhiaKhoanChi, nhan: (t: Record<string, any>) => LoaiBangDauVao | null,
    sheet: { id: number; ten: string | null; ma: string } | null,
    caHang: (it: Record<string, any>) => { at: string | null; by: string | null } | null) => {
    tables.forEach((t, ti) => {
      if (!laBang(t)) return;
      const loai = nhan(t);
      if (!loai || !Array.isArray(t.items)) return;
      const coNgay = bangNoiBoCoNgay(t, q.companyId, dsMau);
      let cha = "";   // tên hạng mục gần nhất — dòng CON (ô gộp) có tên trống và thừa hưởng nó
      t.items.forEach((it: unknown, ii: number) => {
        if (!laBang(it)) return;
        if (it.kind === "section" || it.kind === "subsection" || it.kind === "info") return;
        const ten = chu(it.name);
        if (it.kind !== "sub" && ten) cha = ten;
        const rid = chu(it.rid);
        const e = rid ? khoan.get(khoaKhoanChi(side, rid)) : undefined;
        const dong = caHang(it);
        // Hàng chưa đủ điều kiện chỉ vào danh sách khi đã có dữ liệu kế toán — nhóm "Cần chú ý".
        if (!dong && !e && !coDauVetJsonCu(it)) return;
        const trung = !!rid && (demRid[side].get(rid) ?? 0) > 1;
        const amount = extraTableSum({ items: [it] }, coNgay);
        const dto = dtoKhoanChi({ quoteId: q.id, side, rid: rid ?? "", entry: e, anh: anhCua(e), itJson: it, tienHienTai: amount, tenNguoi });
        out.push({
          ...goc,
          ...phanKeToan(dto),
          // Khoá theo vị trí PHẢI gồm cả trang: hai trang cùng có bảng hcm ở vị trí 0 thì (loại, bảng, hàng) trùng nhau.
          key: rid && !trung ? khoaDongDauVao(q.id, side, rid) : `${q.id}:${loai}:${sheet?.id ?? "hn"}:${ti}:${ii}`,
          sheetId: sheet?.id ?? null, sheetName: sheet?.ten ?? null, sheetCode: sheet?.ma ?? null,
          side, category: loai, tableName: chu(t.name),
          rid, name: ten ?? cha, detail: chu(it.detail), unit: chu(it.unit),
          quantity: Number(it.quantity) || 0, unitPrice: Number(it.unitPrice) || 0,
          days: coNgay && it.days != null ? Number(it.days) : null,
          // Một dòng qua ĐÚNG hàm cộng bảng (category bỏ trống → không lọc "chỉ hàng đã duyệt": đã lọc ở đây rồi).
          amount,
          ns: chu(it.ns), chungTu: CHUNG_TU.has(String(it.chungTu)) ? (it.chungTu as "VAT" | "HDNS" | "TM") : null, luuKho: !!it.luuKho,
          approvedAt: dong?.at ?? null, approvedByName: dong?.by ?? null,
          trangThaiHang: dong ? "binh-thuong" : side === "hn" ? "hn-chua-duyet" : "chua-duyet",
          coTheGhi: !!rid && !trung,
          lyDoKhoa: !rid ? (coDauVetJsonCu(it) ? LY_DO_THIEU_RID_CO_VET : LY_DO_THIEU_RID) : trung ? LY_DO_TRUNG_RID : null,
        });
      });
    });
  };

  // 1) Chi phí HCM / Phí khách hàng — duyệt THEO HÀNG. Bảng loại khác (vd bản cũ của bảng HN còn nằm trong
  //    trang) bị bỏ: nó sẽ bị đếm hai lần cùng bảng ở `Quote.hnTables`.
  for (const { sheetId, tables, i } of sheetTheoThuTu) {
    const sh = i >= 0 ? thuTu[i] : null;
    duyet(
      Array.isArray(tables) ? tables : [],
      "sheet",
      (t) => (t.category === "hcm" || t.category === "khach" ? t.category : null),
      { id: sheetId, ten: chu(sh?.name), ma: sh ? sheetCode(q, soMa(sh, i), thuTu.length) : codeLabel(q) },
      (it) => (it.approved === true
        ? { at: iso(it.approvedAt), by: typeof it.approvedBy === "number" ? tenNguoi.get(it.approvedBy) ?? null : null }
        : null),
    );
  }

  // 2) Báo giá Hà Nội — duyệt THEO HÀNG (hàng cũ suy từ cả phần). Hàng chưa duyệt chưa là khoản chi — trừ hàng đã có
  //    dữ liệu kế toán (nhóm "Cần chú ý").
  duyet(Array.isArray(bangHn) ? bangHn : [], "hn", () => "hanoi", null, (it) => {
    if (!daDuyetHangHn(it, q)) return null;
    const d = dauDuyetHangHn(it, q);
    return { at: d.approvedAt, by: d.approvedBy != null ? tenNguoi.get(d.approvedBy) ?? null : null };
  });

  // 3) Khoản mà hàng của nó KHÔNG CÒN trong báo giá (xoá hàng chỉ có ghi chú, hoặc dữ liệu ghi từ bản app cũ).
  for (const e of khoan.values()) {
    const side = e.side === "hn" ? "hn" : "sheet";
    if (demRid[side].has(e.rid)) continue;
    out.push(dongTuAnhChup({ quote: q, e, anh: anhCua(e), trangThai: "khong-con-hang", tenNguoi }));
  }
  return out;
}

/** Khoản của một báo giá ĐÃ XOÁ MỀM — chỉ xem (bằng chứng tiền đã chi không được biến khỏi trang kế toán). */
export function hangKhoanBaoGiaDaXoa(p: {
  quote: BaoGiaDauVao; khoan: Map<string, KhoanChiNap>; anh?: Map<number, AnhChungTuNap[]>; tenNguoi?: Map<number, string>;
}): HangDauVao[] {
  return [...p.khoan.values()].map((e) =>
    dongTuAnhChup({ quote: p.quote, e, anh: p.anh?.get(e.id) ?? [], trangThai: "bao-gia-da-xoa", tenNguoi: p.tenNguoi }));
}
