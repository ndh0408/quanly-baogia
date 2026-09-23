// Backfill QuoteSheet.subtotal cho sheet CŨ còn mang 0 (DB-01).
//
// Bản cũ của file này ghi đè MỌI sheet của MỌI báo giá, không có chế độ khô, không dọn Số Ngày theo
// mẫu và không nạp hàng theo thứ tự. Logic nay nằm ở src/sheetSubtotalBackfill.ts và được biên dịch
// vào image production — file này chỉ còn là lối gọi tiện cho máy dev:
//
//   node --import tsx prisma/backfill-sheet-subtotal.mjs          # chế độ khô (mặc định)
//   node --import tsx prisma/backfill-sheet-subtotal.mjs --ghi    # ghi thật, sau khi đã pg_dump
//
// Trong image production: node dist/tools/backfillSheetSubtotal.js [--ghi]
import "dotenv/config";
await import("../src/tools/backfillSheetSubtotal.js");
