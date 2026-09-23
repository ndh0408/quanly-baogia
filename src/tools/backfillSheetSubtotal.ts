// Sửa cột QuoteSheet.subtotal của sheet cũ còn mang 0 — xem src/sheetSubtotalBackfill.ts (DB-01).
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
if (!ghi) {
  console.log(`(chế độ khô) ${keHoach.length} sheet sẽ được ghi. Thêm --ghi để ghi thật — sau khi đã pg_dump.`);
} else {
  const n = await apDungBackfillSubtotal(keHoach);
  console.log(`✓ đã ghi ${n}/${keHoach.length} sheet.`);
}
await prisma.$disconnect().catch(() => {});
