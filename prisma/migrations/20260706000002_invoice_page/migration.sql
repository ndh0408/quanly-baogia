-- Trang HÓA ĐƠN cho kế toán (thay bảng Excel): 7 cột mới trên QuoteSheet — tất cả NULL → tương thích ngược.
ALTER TABLE "QuoteSheet" ADD COLUMN "invoiceDate" TIMESTAMP(3);
ALTER TABLE "QuoteSheet" ADD COLUMN "paymentMethod" TEXT;
ALTER TABLE "QuoteSheet" ADD COLUMN "orderClosedAt" TIMESTAMP(3);
ALTER TABLE "QuoteSheet" ADD COLUMN "invoiceYear" INTEGER;
ALTER TABLE "QuoteSheet" ADD COLUMN "invoiceCompany" TEXT;
ALTER TABLE "QuoteSheet" ADD COLUMN "invoiceDesc" TEXT;
ALTER TABLE "QuoteSheet" ADD COLUMN "invoiceNote" TEXT;

-- Quyền: kế toán chuyển từ trang "Quản lý dự án" (invoice:read) sang trang "Hóa đơn" (invoice:page).
-- User role=accountant có TẬP QUYỀN CUSTOM (permissions != rỗng): gỡ invoice:read + thêm invoice:page.
-- (Ai chưa custom thì dùng default theo role — đã đổi trong permissions.ts, không cần data ở đây.)
UPDATE "User"
SET "permissions" = array_append(array_remove("permissions", 'invoice:read'), 'invoice:page')
WHERE "role" = 'accountant'
  AND cardinality("permissions") > 0
  AND NOT ('invoice:page' = ANY("permissions"));
