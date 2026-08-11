-- Tách vùng TẠM khỏi vùng TẢI VỀ cho object upload — chống ghi đè sau khi đã xác minh (TOCTOU).
--
-- URL presigned PUT còn hiệu lực tới `expires` giây. Nếu URL đó trỏ thẳng vào khoá cuối cùng thì sau
-- khi /finalize xác minh xong, người dùng vẫn PUT đè nội dung khác lên đúng khoá ấy bằng chính URL cũ
-- — bản ghi vẫn ghi 'finalized' trong khi nội dung đã bị thay. Nay URL chỉ trỏ vào `uploads/staging/`,
-- và server tự sao chép sang khoá cuối sau khi kiểm xong; không có URL PUT nào từng được ký cho khoá cuối.
--
-- Bảng UploadObject vừa thêm ở migration trước và CHƯA có dữ liệu thật trên bất kỳ môi trường nào
-- (đường presigned chưa có client nào dùng), nên đặt NOT NULL trực tiếp là an toàn.
-- ROLLBACK: ALTER TABLE "UploadObject" DROP COLUMN "stagingKey";

ALTER TABLE "UploadObject" ADD COLUMN IF NOT EXISTS "stagingKey" TEXT;
UPDATE "UploadObject" SET "stagingKey" = "key" WHERE "stagingKey" IS NULL;
ALTER TABLE "UploadObject" ALTER COLUMN "stagingKey" SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "UploadObject_stagingKey_key" ON "UploadObject"("stagingKey");
