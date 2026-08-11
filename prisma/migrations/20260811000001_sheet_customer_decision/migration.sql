-- KHÁCH DUYỆT THEO TỪNG SHEET: báo giá nhiều sheet thì khách có thể chốt sheet này mà chưa
-- chốt sheet kia. Tách khỏi "Quote"."status" (trạng thái cả báo giá) — 2 thứ khác nhau.
-- NULL = chưa có ý kiến · 'approved' = khách duyệt · 'rejected' = khách không duyệt.
ALTER TABLE "QuoteSheet" ADD COLUMN "custStatus" TEXT;
ALTER TABLE "QuoteSheet" ADD COLUMN "custStatusAt" TIMESTAMP(3);
ALTER TABLE "QuoteSheet" ADD COLUMN "custStatusById" INTEGER;
ALTER TABLE "QuoteSheet" ADD COLUMN "custNote" TEXT;

-- Người ĐÁNH DẤU hộ khách (để truy vết). Xoá user thì giữ lại quyết định, chỉ bỏ liên kết.
ALTER TABLE "QuoteSheet" ADD CONSTRAINT "QuoteSheet_custStatusById_fkey"
  FOREIGN KEY ("custStatusById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- FK có RESTRICT/SET NULL → cần index để kiểm "user này còn sheet nào tham chiếu?" không seq-scan.
CREATE INDEX "QuoteSheet_custStatusById_idx" ON "QuoteSheet"("custStatusById");
