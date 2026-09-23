// SỬA DỮ LIỆU MỘT LẦN: cột QuoteSheet.subtotal của sheet CŨ còn mang 0 (DB-01, audit 2026-09-23).
//
// ── VÌ SAO ──────────────────────────────────────────────────────────────────
// Migration 20260625000003 thêm cột `subtotal NOT NULL DEFAULT 0` mà không backfill. Trang Hoá đơn,
// Quản lý dự án và Dashboard đọc THẲNG cột này (quoteService.listProjects), nên sheet lưu trước ngày
// đó hiện 0 đ cho tới khi ai đó mở ra bấm Lưu — mà báo giá đã chốt hiếm khi được mở lại. Mọi đường
// ghi từ sau ngày đó đều materialize cột, nên đây là một tập dữ liệu cũ HỮU HẠN: sửa dữ liệu một lần
// thay vì nhân bản đường lùi tính lại vào mã nóng (fixPB của DB-01).
//
// ── KHÁC GÌ prisma/backfill-sheet-subtotal.mjs BẢN CŨ ──────────────────────
//   · CHỈ đụng sheet có cột `!(> 0)` — bản cũ ghi đè MỌI sheet của MỌI báo giá, kể cả sheet đúng.
//   · Có CHẾ ĐỘ KHÔ (mặc định): in {sheetId, cũ, mới} để người vận hành soát trước khi ghi.
//   · Dọn Số Ngày theo mẫu (chuanHoaSoNgayTheoMau) TRƯỚC khi tính, đúng như đường Lưu — sheet dùng
//     mẫu không có cột ngày mà hàng còn mang days>0 sẽ không bị nhân days.
//   · Nạp hàng THEO THỨ TỰ `order`: dòng nhóm đặt hệ số cho các dòng ĐỨNG SAU nó.
//   · Ghi có điều kiện (`subtotal` vẫn bằng giá trị đã đọc) — một lần Lưu chen giữa thắng, không bị đè.
//   · Nằm trong src/ nên được biên dịch vào dist/ và CHẠY ĐƯỢC TRONG IMAGE PRODUCTION (không cần tsx).
import { prisma } from "./db.js";
import { computeQuoteTotals } from "./money.js";
import { chuanHoaSoNgayTheoMau } from "./quoteUtils.js";

export type DongBackfill = { quoteId: number; sheetId: number; cu: string; moi: string };

/** Lập kế hoạch: những sheet sẽ được ghi và số mới. KHÔNG ghi gì. */
export async function keHoachBackfillSubtotal(opts: { quoteIds?: number[] } = {}): Promise<DongBackfill[]> {
  const sheetsCanXet = await prisma.quoteSheet.findMany({
    where: { subtotal: { lte: 0 }, quote: { deletedAt: null, ...(opts.quoteIds ? { id: { in: opts.quoteIds } } : {}) } },
    select: { quoteId: true },
  });
  const quoteIds = [...new Set(sheetsCanXet.map((s) => s.quoteId))];
  const out: DongBackfill[] = [];
  for (const quoteId of quoteIds) {
    const q = await prisma.quote.findFirst({
      where: { id: quoteId },
      select: {
        id: true, vatPercent: true,
        sheets: {
          select: {
            id: true, templateId: true, subtotal: true, groupSubtotal: true, discount: true,
            items: { orderBy: { order: "asc" }, select: { kind: true, quantity: true, quantityExact: true, unitPrice: true, days: true } },
          },
        },
      },
    });
    if (!q) continue;
    await chuanHoaSoNgayTheoMau(q.sheets as any[]);
    const { sheetTotals } = computeQuoteTotals(q as any);
    const moiTheoId = new Map(sheetTotals.map((t) => [t.sheetId, t.subtotal]));
    for (const sh of q.sheets) {
      if (Number(sh.subtotal) > 0) continue;
      const moi = moiTheoId.get(sh.id);
      if (!moi || moi.equals(sh.subtotal)) continue;   // sheet rỗng thật / tổng thật = 0 → không đổi
      out.push({ quoteId: q.id, sheetId: sh.id, cu: sh.subtotal.toString(), moi: moi.toString() });
    }
  }
  return out;
}

/** Ghi kế hoạch. Mỗi hàng chỉ ghi khi cột vẫn còn đúng giá trị đã đọc. Trả số hàng đã ghi. */
export async function apDungBackfillSubtotal(keHoach: DongBackfill[]): Promise<number> {
  let n = 0;
  for (const d of keHoach) {
    const r = await prisma.quoteSheet.updateMany({ where: { id: d.sheetId, subtotal: d.cu }, data: { subtotal: d.moi } });
    n += r.count;
  }
  return n;
}
