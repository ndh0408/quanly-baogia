-- Hạn công nợ riêng từng khách hàng (ngày, tính từ Ngày HĐơn) — null = dùng ngưỡng mặc định trang Hóa đơn
ALTER TABLE "Customer" ADD COLUMN "debtDays" INTEGER;
