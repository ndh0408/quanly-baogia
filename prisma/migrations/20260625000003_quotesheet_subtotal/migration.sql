-- Materialize per-sheet subtotal (= computeQuoteTotals.sheetTotals) để trang Quản lý dự án không phải
-- kéo TẤT CẢ items vào RAM. Additive (default 0). App ghi lúc save; rows cũ backfill bằng
-- prisma/backfill-sheet-subtotal.mjs (tính LẠI bằng computeQuoteTotals → giá trị Y HỆT cách tính cũ).
ALTER TABLE "QuoteSheet" ADD COLUMN "subtotal" DECIMAL(18,2) NOT NULL DEFAULT 0;
