-- Cột "HÌNH ẢNH" theo TỪNG HẠNG MỤC: mảng ảnh base64 (nhúng thật vào Excel) + công tắc bật/tắt theo sheet.
-- NULL / false = tương thích ngược HOÀN TOÀN: báo giá cũ không có ảnh, cột ẩn → không vỡ gì khi deploy.
ALTER TABLE "QuoteItem" ADD COLUMN "images" JSONB;
ALTER TABLE "QuoteSheet" ADD COLUMN "showImages" BOOLEAN NOT NULL DEFAULT false;
