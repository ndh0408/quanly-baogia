-- Ảnh chứng từ thanh toán (base64 data URL, nén client-side) — kế toán up khi đánh dấu thanh toán.
-- S3 chưa bật trên prod → lưu base64 trong DB; KHÔNG select ở list (nặng), chỉ lấy on-demand.
ALTER TABLE "PersonnelRecord" ADD COLUMN "paymentProof" TEXT;
