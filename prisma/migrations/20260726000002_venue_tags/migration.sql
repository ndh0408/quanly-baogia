-- TỪ KHÓA NHANH cho rạp: gõ/bấm 1 từ khóa là lọc ra đúng nhóm rạp hay báo giá cùng nhau.
ALTER TABLE "Venue" ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Khởi tạo từ khu vực đang có ("HCM", "Hà Nội"…) để bấm được ngay, không phải gắn tay 245 rạp.
UPDATE "Venue" SET "tags" = ARRAY["region"] WHERE "region" <> '';

-- Lọc theo từ khóa = phép chứa trên mảng → GIN là index đúng loại.
CREATE INDEX "Venue_tags_idx" ON "Venue" USING GIN ("tags");
