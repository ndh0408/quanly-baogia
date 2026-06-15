-- Ngày Thi Công (ngày lắp đặt) cho báo giá — chỉ phục vụ quản lý nội bộ + trang
-- "Quản lý dự án", KHÔNG xuất ra Excel. Nullable, additive, không ảnh hưởng dữ liệu cũ.
ALTER TABLE "Quote" ADD COLUMN "executionDate" TIMESTAMP(3);
