-- Mã hoá PII khi lưu trữ — BƯỚC 1/6 (xem SECURITY_AUDIT_2026-08.md §6).
--
-- CHỈ CỘNG THÊM. Không đụng một byte dữ liệu nào đang có, không đổi kiểu, không thêm ràng buộc
-- NOT NULL. Sau migration này ứng dụng chạy y hệt trước: chưa đường ghi nào chạm các cột mới, và
-- src/piiBox.ts vẫn là no-op cho tới khi đặt PII_ENC_KEY.
--
-- ROLLBACK: DROP COLUMN từng cột dưới đây. An toàn vì cột thô vẫn là nguồn sự thật.
--
-- Vì sao tách cột thay vì mã hoá tại chỗ:
--   • migration không phải đọc/ghi lại dữ liệu → không có cửa sổ mất mát, chạy tức thì trên bảng lớn;
--   • giai đoạn đọc-song-song so đối chiếu được bản thô với bản mã trước khi tin bản mã;
--   • lỡ khoá bị mất ở bước 3-4 thì dữ liệu gốc vẫn nguyên vẹn.

ALTER TABLE "PersonnelRecord"
  ADD COLUMN IF NOT EXISTS "idCardEnc"      TEXT,
  ADD COLUMN IF NOT EXISTS "idCardIdx"      TEXT,
  ADD COLUMN IF NOT EXISTS "bankAccountEnc" TEXT,
  ADD COLUMN IF NOT EXISTS "salaryEnc"      TEXT,
  ADD COLUMN IF NOT EXISTS "piiVersion"     INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Employee"
  ADD COLUMN IF NOT EXISTS "idCardEnc"      TEXT,
  ADD COLUMN IF NOT EXISTS "idCardIdx"      TEXT,
  ADD COLUMN IF NOT EXISTS "bankAccountEnc" TEXT,
  ADD COLUMN IF NOT EXISTS "piiVersion"     INTEGER NOT NULL DEFAULT 0;

-- Chỉ mục cho tra cứu BẰNG-ĐÚNG qua chỉ mục mù (sau khi cột thô bị bỏ ở bước 6).
-- CONCURRENTLY không dùng được trong transaction của Prisma Migrate; bảng nhân sự ở quy mô này
-- (hàng nghìn dòng) tạo index thường chỉ mất mili-giây nên khoá ngắn là chấp nhận được.
CREATE INDEX IF NOT EXISTS "PersonnelRecord_idCardIdx_idx" ON "PersonnelRecord" ("idCardIdx");
CREATE INDEX IF NOT EXISTS "Employee_idCardIdx_idx"        ON "Employee" ("idCardIdx");
