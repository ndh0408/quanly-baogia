-- Chứng từ thanh toán: base64 trong CSDL → kho object riêng tư. CHỈ CỘNG THÊM cột siêu dữ liệu.
--
-- Vì sao phải chuyển: ảnh base64 nằm trong bảng khiến MỌI bản sao lưu CSDL phải cõng toàn bộ ảnh,
-- mỗi lần đọc hàng kéo cả ảnh vào RAM, và ảnh đi theo mọi bản dump được sao chép ra ngoài.
--
-- Cột `paymentProof` (base64) GIỮ NGUYÊN — giai đoạn đọc-song-song cần nó. Việc bỏ cột cũ là một
-- migration RIÊNG, chạy sau khi đã xác minh 100% đã chuyển và đã có bản sao lưu.
-- ROLLBACK: DROP COLUMN từng cột dưới đây.

ALTER TABLE "PersonnelRecord"
  ADD COLUMN IF NOT EXISTS "paymentProofKey"        TEXT,
  ADD COLUMN IF NOT EXISTS "paymentProofMime"       TEXT,
  ADD COLUMN IF NOT EXISTS "paymentProofSize"       INTEGER,
  ADD COLUMN IF NOT EXISTS "paymentProofSha256"     TEXT,
  ADD COLUMN IF NOT EXISTS "paymentProofUploadedAt" TIMESTAMP(3);

-- Tìm nhanh các hàng còn tồn base64 chưa chuyển (dùng cho script migrate + báo cáo tiến độ).
CREATE INDEX IF NOT EXISTS "PersonnelRecord_paymentProofKey_idx" ON "PersonnelRecord" ("paymentProofKey");
