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
//   · TÍNH LẠI `Quote.convertedTotal` của báo giá đã chốt có sheet vừa được sửa (soát chéo money#5).
//     markConverted tính cột đó bằng cách CỘNG cột subtotal này, nên báo giá lưu lần cuối trước
//     25/06 mà chốt sau 17/09 (không Lưu lại) mang doanh thu chốt = 0. Số 0 khác NULL nên không
//     COALESCE nào cứu: sửa subtotal mà bỏ cột dẫn xuất thì trang Hoá đơn đúng còn Doanh số đã chốt /
//     Top sales thiếu trọn báo giá. convertedTotal NULL (chốt trước khi có cột) thì GIỮ NULL — nơi
//     đọc đã COALESCE về total, đúng như updateQuote/setSheetCustomerDecision.
import { prisma } from "./db.js";
import { computeQuoteTotals, tinhConvertedTotal } from "./money.js";
import { chuanHoaSoNgayTheoMau } from "./quoteUtils.js";

/**
 * Một sheet sẽ được ghi. `convertedCu`/`convertedMoi` chỉ có khi báo giá ĐÃ CHỐT và convertedTotal
 * khác NULL — cùng giá trị trên mọi dòng của một báo giá, để chế độ khô in ra cho người vận hành soát.
 */
export type DongBackfill = { quoteId: number; sheetId: number; cu: string; moi: string; convertedCu?: string; convertedMoi?: string };

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
        id: true, vatPercent: true, status: true, convertedTotal: true,
        sheets: {
          select: {
            id: true, templateId: true, subtotal: true, groupSubtotal: true, discount: true, custStatus: true,
            items: { orderBy: { order: "asc" }, select: { kind: true, quantity: true, quantityExact: true, unitPrice: true, days: true } },
          },
        },
      },
    });
    if (!q) continue;
    await chuanHoaSoNgayTheoMau(q.sheets as any[]);
    const { sheetTotals } = computeQuoteTotals(q as any);
    const moiTheoId = new Map(sheetTotals.map((t) => [t.sheetId, t.subtotal]));
    const cuaBaoGia: DongBackfill[] = [];
    const seGhi = new Map<number, string>();   // sheetId → subtotal mới (chuỗi Decimal, không mất chính xác)
    for (const sh of q.sheets) {
      if (Number(sh.subtotal) > 0) continue;
      const moi = moiTheoId.get(sh.id);
      if (!moi || moi.equals(sh.subtotal)) continue;   // sheet rỗng thật / tổng thật = 0 → không đổi
      seGhi.set(sh.id, moi.toString());
      cuaBaoGia.push({ quoteId: q.id, sheetId: sh.id, cu: sh.subtotal.toString(), moi: moi.toString() });
    }
    if (cuaBaoGia.length && q.status === "converted" && q.convertedTotal != null) {
      // Sheet KHÔNG nằm trong kế hoạch giữ số cột hiện có — đúng thứ markConverted sẽ cộng.
      const convertedMoi = tinhConvertedTotal(q.sheets.map((sh) => ({ subtotal: seGhi.get(sh.id) ?? sh.subtotal, custStatus: sh.custStatus })), q.vatPercent);
      for (const d of cuaBaoGia) { d.convertedCu = q.convertedTotal.toString(); d.convertedMoi = convertedMoi.toString(); }
    }
    out.push(...cuaBaoGia);
  }
  return out;
}

/**
 * Ghi kế hoạch. Mỗi hàng chỉ ghi khi cột vẫn còn đúng giá trị đã đọc. Trả số hàng đã ghi.
 *
 * MỘT transaction cho mỗi báo giá, khoá QuoteSheet (ORDER BY id) TRƯỚC — cùng thứ tự khoá với
 * updateQuote/markConverted/setSheetCustomerDecision, nên không đẻ deadlock và không có lần chốt hay
 * lần Lưu nào chen vào giữa lúc sửa subtotal và lúc tính lại convertedTotal. Doanh thu chốt tính từ
 * số ĐỌC LẠI sau khi ghi (không lấy `convertedMoi` của kế hoạch — đó chỉ là số để soát), và ghi bằng
 * câu RAW như setSheetCustomerDecision: không bump `updatedAt`, editor đang mở không ăn 409 giả.
 */
export async function apDungBackfillSubtotal(keHoach: DongBackfill[]): Promise<number> {
  const theoBaoGia = new Map<number, DongBackfill[]>();
  for (const d of keHoach) theoBaoGia.set(d.quoteId, [...(theoBaoGia.get(d.quoteId) ?? []), d]);
  let n = 0;
  for (const [quoteId, dong] of theoBaoGia) {
    n += await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "QuoteSheet" WHERE "quoteId" = ${quoteId} ORDER BY id FOR UPDATE`;
      let ghi = 0;
      for (const d of dong) {
        ghi += (await tx.quoteSheet.updateMany({ where: { id: d.sheetId, subtotal: d.cu }, data: { subtotal: d.moi } })).count;
      }
      if (!ghi) return 0;   // mọi hàng đã bị một lần Lưu chen vào sửa — đường Lưu tự tính lại convertedTotal
      const [q] = await tx.$queryRaw<{ status: string; convertedTotal: unknown; vatPercent: unknown }[]>`SELECT status, "convertedTotal", "vatPercent" FROM "Quote" WHERE id = ${quoteId}`;
      if (q?.status === "converted" && q.convertedTotal != null) {
        const trang = await tx.quoteSheet.findMany({ where: { quoteId }, select: { subtotal: true, custStatus: true } });
        await tx.$executeRaw`UPDATE "Quote" SET "convertedTotal" = ${tinhConvertedTotal(trang, q.vatPercent as any)} WHERE id = ${quoteId}`;
      }
      return ghi;
    });
  }
  return n;
}
