// HÓA ĐƠN ĐẦU VÀO — dựng danh sách "mỗi hàng bảng nội bộ ĐÃ DUYỆT là một khoản chi cần hoá đơn đầu vào"
// (chủ repo 2026-09-30). Thuần: không Prisma, không HTTP — `listInputInvoices` (quoteService) lo truy vấn,
// hàm này lo LUẬT: hàng nào vào, tiền bao nhiêu, nhãn gì. Tách ra để test được không cần CSDL.
//
// ── "ĐÃ DUYỆT" Ở REPO NÀY CÓ HAI DẠNG ────────────────────────────────────────────────────────────
//   · Chi phí HCM / Phí khách hàng (`QuoteSheet.extraTables`): duyệt THEO HÀNG — `item.approved`, do người có
//     quote:internal:approve đặt và server giữ theo `rid` (reconcileExtraApprovals). Hàng chưa duyệt không cộng
//     vào tổng (`extraTableSum`), nên cũng không đòi hoá đơn.
//   · Báo giá Hà Nội (`Quote.hnTables`): duyệt ở MỨC BÁO GIÁ — `Quote.hnStatus = "approved"`. Cờ `approved*` của
//     từng hàng HN KHÔNG phải nguồn sự thật (reconcileHnApprovals chỉ bịt việc người điền tự đóng dấu), nên
//     khi báo giá đã duyệt phần HN thì MỌI hàng HN vào, bất kể cờ từng hàng.
//
// TIỀN dùng ĐÚNG `extraTableSum` (làm tròn từng dòng, `quantityExact`, days theo MẪU của bảng) — một bản tính
// thứ hai ở đây là cách có hai con số cho cùng một khoản chi. Không bao giờ mang `paidProof` (ảnh ủy nhiệm chi).
import { extraTableSum, bangNoiBoCoNgay, type MauBangNoiBo } from "./quoteUtils.js";
import { codeLabel, sheetCode, soMa } from "./quoteCode.js";

export type LoaiBangDauVao = "hcm" | "khach" | "hanoi";

export type HangDauVao = {
  /** Khoá ổn định cho React: báo giá + loại bảng + vị trí bảng + vị trí hàng (rid có thể trùng khi nhân bản). */
  key: string;
  quoteId: number; quoteCode: string; title: string; status: string;
  customerCode: string | null; customerName: string | null; companyName: string | null; createdByName: string | null;
  /** `null` ở hàng Hà Nội: bảng HN thuộc CẢ báo giá, không thuộc trang nào. */
  sheetId: number | null; sheetName: string | null; sheetCode: string | null;
  category: LoaiBangDauVao; tableName: string | null;
  rid: string | null; name: string; detail: string | null; unit: string | null;
  quantity: number; unitPrice: number; days: number | null; amount: number;
  ns: string | null; chungTu: "VAT" | "HDNS" | "TM" | null; luuKho: boolean;
  approvedAt: string | null; approvedByName: string | null;
  paid: boolean; paidAt: string | null;
};

export type BaoGiaDauVao = {
  id: number; companyId: number | null; status: string;
  projectCode?: string | null; projectVersion?: number | null; quoteNumber?: string | null;
  title: string; shortTitle?: string | null;
  hnStatus?: string | null; hnReviewedAt?: Date | string | null; hnReviewerId?: number | null;
  customer?: { code?: string | null; name?: string | null } | null;
  company?: { shortName?: string | null; name?: string | null } | null;
  createdBy?: { displayName?: string | null } | null;
};

const CAU_TRUC = new Set(["section", "subsection", "info"]);
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
}): HangDauVao[] {
  const { quote: q, sheets, sheetTables, bangHn, dsMau, tenNguoi } = p;
  const out: HangDauVao[] = [];
  const goc = {
    quoteId: q.id, quoteCode: codeLabel(q), title: tieuDe(q), status: String(q.status ?? ""),
    customerCode: chu(q.customer?.code), customerName: chu(q.customer?.name),
    companyName: chu(q.company?.shortName) ?? chu(q.company?.name), createdByName: chu(q.createdBy?.displayName),
  };

  const duyet = (tables: unknown[], nhan: (t: Record<string, any>) => LoaiBangDauVao | null, sheet: { id: number; ten: string | null; ma: string } | null,
    caHang: (it: Record<string, any>) => { at: string | null; by: string | null } | null) => {
    tables.forEach((t, ti) => {
      if (!laBang(t)) return;
      const loai = nhan(t);
      if (!loai || !Array.isArray(t.items)) return;
      const coNgay = bangNoiBoCoNgay(t, q.companyId, dsMau);
      let cha = "";   // tên hạng mục gần nhất — dòng CON (ô gộp) có tên trống và thừa hưởng nó
      t.items.forEach((it: unknown, ii: number) => {
        if (!laBang(it)) return;
        if (CAU_TRUC.has(String(it.kind))) return;
        const ten = chu(it.name);
        if (it.kind !== "sub" && ten) cha = ten;
        const dong = caHang(it);
        if (!dong) return;
        out.push({
          ...goc,
          key: `${q.id}:${loai}:${ti}:${ii}`,
          sheetId: sheet?.id ?? null, sheetName: sheet?.ten ?? null, sheetCode: sheet?.ma ?? null,
          category: loai, tableName: chu(t.name),
          rid: chu(it.rid), name: ten ?? cha, detail: chu(it.detail), unit: chu(it.unit),
          quantity: Number(it.quantity) || 0, unitPrice: Number(it.unitPrice) || 0,
          days: coNgay && it.days != null ? Number(it.days) : null,
          // Một dòng qua ĐÚNG hàm cộng bảng (category bỏ trống → không lọc "chỉ hàng đã duyệt": đã lọc ở đây rồi).
          amount: extraTableSum({ items: [it] }, coNgay),
          ns: chu(it.ns), chungTu: CHUNG_TU.has(String(it.chungTu)) ? (it.chungTu as "VAT" | "HDNS" | "TM") : null, luuKho: !!it.luuKho,
          approvedAt: dong.at, approvedByName: dong.by,
          paid: !!it.paid, paidAt: iso(it.paidAt),
        });
      });
    });
  };

  // 1) Chi phí HCM / Phí khách hàng — duyệt THEO HÀNG. Bảng loại khác (vd bản cũ của bảng HN còn nằm trong
  //    trang) bị bỏ: nó sẽ bị đếm hai lần cùng bảng ở `Quote.hnTables`.
  const thuTu = [...sheets];
  for (const { sheetId, tables } of sheetTables) {
    const i = thuTu.findIndex((s) => s.id === sheetId);
    const sh = i >= 0 ? thuTu[i] : null;
    duyet(
      Array.isArray(tables) ? tables : [],
      (t) => (t.category === "hcm" || t.category === "khach" ? t.category : null),
      { id: sheetId, ten: chu(sh?.name), ma: sh ? sheetCode(q, soMa(sh, i), thuTu.length) : codeLabel(q) },
      (it) => (it.approved === true
        ? { at: iso(it.approvedAt), by: typeof it.approvedBy === "number" ? tenNguoi.get(it.approvedBy) ?? null : null }
        : null),
    );
  }

  // 2) Báo giá Hà Nội — duyệt ở MỨC BÁO GIÁ. Chưa duyệt (assigned/submitted/rejected/null) thì chưa là khoản chi.
  if (q.hnStatus === "approved") {
    const dong = { at: iso(q.hnReviewedAt), by: q.hnReviewerId != null ? tenNguoi.get(q.hnReviewerId) ?? null : null };
    duyet(Array.isArray(bangHn) ? bangHn : [], () => "hanoi", null, () => dong);
  }
  return out;
}
