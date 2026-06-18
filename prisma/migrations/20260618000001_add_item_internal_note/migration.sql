-- Ghi chú nội bộ trên từng dòng báo giá (CHỈ xem/quản lý — KHÔNG xuất Excel/PDF).
ALTER TABLE "QuoteItem" ADD COLUMN "internalNote" TEXT;
