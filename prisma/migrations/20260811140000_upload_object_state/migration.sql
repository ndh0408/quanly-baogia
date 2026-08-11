-- Trạng thái THẬT cho object tải lên trực tiếp (presigned PUT).
--
-- Trước migration này, hai bước /sign-upload → /finalize chỉ là quy ước: không có gì lưu lại việc
-- object đã được xác minh hay chưa, nên /finalize là TUỲ CHỌN — bỏ qua nó rồi gọi /sign-download vẫn
-- tải được object chưa hề kiểm nội dung.
--
-- CHỈ CỘNG THÊM: bảng mới + enum mới. Không đụng bảng nào đang có.
-- ROLLBACK: DROP TABLE "UploadObject"; DROP TYPE "UploadStatus";
--
-- Tương thích ngược: object đã tồn tại trên kho TRƯỚC migration này không có hàng tương ứng ở đây.
-- Mã nguồn xử lý ca đó tường minh (xem src/routes/files.routes.ts — "không có hàng = di sản").

CREATE TYPE "UploadStatus" AS ENUM ('pending', 'finalized', 'rejected');

CREATE TABLE "UploadObject" (
  "id"           SERIAL       PRIMARY KEY,
  "key"          TEXT         NOT NULL,
  "status"       "UploadStatus" NOT NULL DEFAULT 'pending',
  "ownerId"      INTEGER      NOT NULL,
  "expectedMime" TEXT         NOT NULL,
  "expectedSize" INTEGER      NOT NULL,
  "actualMime"   TEXT,
  "actualSize"   INTEGER,
  "sha256"       TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt"    TIMESTAMP(3) NOT NULL,
  "finalizedAt"  TIMESTAMP(3),
  "rejectReason" TEXT,
  CONSTRAINT "UploadObject_ownerId_fkey" FOREIGN KEY ("ownerId")
    REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- key là DUY NHẤT: đây là thứ biến chuyển-trạng-thái thành thao tác nguyên tử (UPDATE … WHERE
-- key = ? AND status = 'pending' → count 1 thì mới thắng), chống hai request finalize cùng lúc.
CREATE UNIQUE INDEX "UploadObject_key_key" ON "UploadObject"("key");
CREATE INDEX "UploadObject_ownerId_status_idx" ON "UploadObject"("ownerId", "status");
CREATE INDEX "UploadObject_status_expiresAt_idx" ON "UploadObject"("status", "expiresAt");
