-- Luồng hoá đơn ở trang Quản lý dự án: thêm Số hoá đơn + Ngày thanh toán cho TỪNG SHEET.
-- Trạng thái suy ra (chỉ báo giá đã chốt): có invoiceNo → "Thanh toán"; có paidAt → "Done".
-- Additive + nullable → an toàn, không ảnh hưởng dữ liệu cũ.
ALTER TABLE "QuoteSheet" ADD COLUMN "invoiceNo" TEXT;
ALTER TABLE "QuoteSheet" ADD COLUMN "paidAt" TIMESTAMP(3);
