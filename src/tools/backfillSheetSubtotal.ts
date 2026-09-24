// Sửa cột QuoteSheet.subtotal của sheet cũ còn mang 0 — xem src/sheetSubtotalBackfill.ts (DB-01) —
// kèm Quote.convertedTotal của báo giá đã chốt có sheet được sửa (soát chéo money#5).
//
//   node dist/tools/backfillSheetSubtotal.js          # CHẾ ĐỘ KHÔ (mặc định): chỉ in, không ghi
//   node dist/tools/backfillSheetSubtotal.js --ghi    # ghi thật — CHỈ sau khi đã pg_dump
//
// Chạy được TỪ TRONG image production (đã biên dịch vào dist/). Thoát 0 = xong.
import { prisma } from "../db.js";
import { keHoachBackfillSubtotal, apDungBackfillSubtotal } from "../sheetSubtotalBackfill.js";

const ghi = process.argv.slice(2).includes("--ghi");
const keHoach = await keHoachBackfillSubtotal();
for (const d of keHoach) console.log(JSON.stringify(d));
// Báo giá đã chốt có doanh thu chốt (convertedTotal) tính lại cùng lượt — xem sheetSubtotalBackfill.ts.
const soBaoGiaChot = new Set(keHoach.filter((d) => d.convertedMoi !== undefined && d.convertedMoi !== d.convertedCu).map((d) => d.quoteId)).size;
if (!ghi) {
  console.log(`(chế độ khô) ${keHoach.length} sheet sẽ được ghi; ${soBaoGiaChot} báo giá đã chốt đổi doanh thu chốt (convertedCu → convertedMoi). Thêm --ghi để ghi thật — sau khi đã pg_dump.`);
} else {
  const n = await apDungBackfillSubtotal(keHoach);
  console.log(`✓ đã ghi ${n}/${keHoach.length} sheet; doanh thu chốt tính lại cho báo giá đã chốt có sheet được ghi.`);
}
await prisma.$disconnect().catch(() => {});
