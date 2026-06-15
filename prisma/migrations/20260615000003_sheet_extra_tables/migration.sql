-- Bảng nội bộ theo từng sheet (Chi Phí HCM / Báo Giá Hà Nội / Phí Khách Hàng) — CHỈ
-- để quản lý, KHÔNG xuất Excel & KHÔNG cộng vào tổng báo giá. Lưu dạng JSONB, nullable.
ALTER TABLE "QuoteSheet" ADD COLUMN "extraTables" JSONB;
