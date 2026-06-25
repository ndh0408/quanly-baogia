-- Theo dõi chứng từ ở trang Quản lý dự án (đèn đỏ = việc cần làm, trắng = đã xong).
-- Số PO/HĐ "kích hoạt" 4 việc: chứng từ gửi đi, chứng từ trả về, link hoá đơn, ký chứng từ.
-- Số HĐ HN tách riêng (đỏ khi báo giá Hà Nội đã duyệt mà chưa có số).
-- Additive + nullable → an toàn, không ảnh hưởng dữ liệu cũ.
ALTER TABLE "QuoteSheet" ADD COLUMN "poNumber" TEXT;
ALTER TABLE "QuoteSheet" ADD COLUMN "hnInvoiceNo" TEXT;
ALTER TABLE "QuoteSheet" ADD COLUMN "invoiceLink" TEXT;
ALTER TABLE "QuoteSheet" ADD COLUMN "docSentAt" TIMESTAMP(3);
ALTER TABLE "QuoteSheet" ADD COLUMN "docReturnedAt" TIMESTAMP(3);
