// Tra cứu dữ liệu HỢP ĐỒNG/THANH TOÁN cho bảng Nhân sự — các cột HỒNG (tham chiếu) được
// LẤY TỪ module Dự án (báo giá ĐÃ CHỐT) theo "mã sản xuất", KHÔNG nhập tay, KHÔNG lưu.
//
// "Mã sản xuất" được dựng GIỐNG HỆT trang Quản lý dự án:
//   base = projectCode || quoteNumber  (+ "_v{N}" nếu projectVersion > 1)   [public/app.js codeLabel]
//   nếu báo giá nhiều sheet → mỗi sheet thêm hậu tố "_{i+1}"                  [admin.js renderProjects]
// Khớp ĐÚNG 1 mã sản xuất (gồm hậu tố). Không khớp → không có entry → UI hiện "—" (giống #N/A trong Excel).
import { prisma } from "../db.js";
import { computeQuoteTotals } from "../money.js";

/** Dựng "base" mã dự án y như client codeLabel() để mã sản xuất khớp tuyệt đối. */
export function codeLabel(q: { projectCode?: string | null; quoteNumber?: string | null; projectVersion?: number | null }): string {
  const c = q.projectCode || q.quoteNumber || "";
  return q.projectVersion && q.projectVersion > 1 ? `${c}_v${q.projectVersion}` : c;
}

export type ProjectRef = {
  salesContractNo: string | null;     // Số HĐ bán    ← QuoteSheet.invoiceNo
  salesContractDate: Date | null;     // Ngày HĐ bán  ← QuoteSheet.signedAt
  purchaseOrder: string | null;       // Đơn đặt hàng ← QuoteSheet.poNumber
  preTaxAmount: number | null;        // Tiền trước thuế ← subtotal theo sheet
  // (Thanh toán KHÔNG còn suy từ dự án — nay là hành động của KẾ TOÁN trên từng hồ sơ: PersonnelRecord.paidAt)
};

/**
 * Trả về Map[mã sản xuất → dữ liệu tham chiếu] cho TẬP mã đang cần (các projectCode ở trang hiện tại).
 * Truy vấn hẹp: chỉ lấy báo giá đã chốt có projectCode/quoteNumber khớp ứng viên (đã bỏ hậu tố _sheet/_vN).
 */
export async function buildProjectRef(codes: Array<string | null | undefined>): Promise<Map<string, ProjectRef>> {
  const wanted = new Set<string>();
  for (const raw of codes) {
    const c = (raw ?? "").toString().trim();
    if (c) wanted.add(c);
  }
  const out = new Map<string, ProjectRef>();
  if (!wanted.size) return out;

  // Ứng viên để truy vấn hẹp: mã đầy đủ + bỏ hậu tố sheet (_1/_2) + bỏ version (_vN).
  const candidates = new Set<string>();
  for (const c of wanted) {
    candidates.add(c);
    const noSheet = c.replace(/_\d+$/, "");
    candidates.add(noSheet);
    candidates.add(noSheet.replace(/_v\d+$/, ""));
    candidates.add(c.replace(/_v\d+$/, ""));
  }
  const arr = [...candidates];

  const quotes = await prisma.quote.findMany({
    where: { status: "converted", deletedAt: null, OR: [{ projectCode: { in: arr } }, { quoteNumber: { in: arr } }] },
    take: 1000,
    select: {
      quoteNumber: true, projectCode: true, projectVersion: true,
      vatPercent: true, discount: true, subtotal: true,
      sheets: {
        orderBy: { order: "asc" },
        select: {
          id: true, order: true, name: true, groupSubtotal: true,
          signedAt: true, invoiceNo: true, paidAt: true, poNumber: true,
          items: { select: { kind: true, quantity: true, unitPrice: true, days: true } },
        },
      },
    },
  });

  for (const q of quotes) {
    const base = codeLabel(q);
    const { sheetTotals } = computeQuoteTotals(q as any);
    const byId = new Map<number, number>((sheetTotals as Array<{ sheetId: number; subtotal: unknown }>).map((s) => [s.sheetId, Number(s.subtotal)]));
    // Báo giá không có sheet → coi như 1 dòng dùng subtotal tổng (giống admin.js fallback).
    const sheets = q.sheets.length ? q.sheets : [{ id: -1, poNumber: null, invoiceNo: null, signedAt: null, paidAt: null } as any];
    const multi = sheets.length > 1;
    sheets.forEach((sh: any, i: number) => {
      const code = base + (multi ? `_${i + 1}` : "");
      if (!wanted.has(code)) return; // chỉ giữ mã đang cần — khớp đúng 1 mã sản xuất
      // `|| 0` (không phải ??): Number() trả NaN chứ không bao giờ nullish — subtotal thiếu/hỏng phải về 0.
      const baoGia = byId.get(sh.id) ?? (Number(q.subtotal) || 0);
      out.set(code, {
        salesContractNo: sh.invoiceNo ?? null,
        salesContractDate: sh.signedAt ?? null,
        purchaseOrder: sh.poNumber ?? null,
        preTaxAmount: baoGia,
      });
    });
  }
  return out;
}

/** Công thức thuế (chốt với chủ dự án): Thuế TNCN = Lương/9; Thu nhập chịu thuế = Lương×10/9. */
export function computeTax(salary: number | null | undefined): { pit: number | null; taxableIncome: number | null } {
  const s = salary == null ? null : Number(salary);
  if (s == null || !isFinite(s)) return { pit: null, taxableIncome: null };
  const pit = Math.round(s / 9);
  return { pit, taxableIncome: s + pit };
}
