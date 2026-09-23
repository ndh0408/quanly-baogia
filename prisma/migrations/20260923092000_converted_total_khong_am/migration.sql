-- MONEY-01 — doanh thu chốt (`Quote.convertedTotal`) không được âm.
--
-- CHECK "Quote_money_check" (migration 20260613000001) chỉ phủ subtotal/vat/total/discount. Cột
-- convertedTotal (thêm 2026-09-17) thì không: trang giảm trừ có subtotal âm cộng với trang dương bị
-- khách từ chối cho ra net âm, và markConverted cũ ghi thẳng số đó. Mã nay kẹp ≥ 0
-- (src/money.ts tinhConvertedTotal); ràng buộc này là lớp chặn thứ hai ở CSDL.
--
-- NOT VALID, CỐ Ý KHÔNG VALIDATE: chỉ áp cho hàng GHI MỚI, không quét và không từ chối dữ liệu đã
-- có trên production (chưa rà được). Rà xong — `SELECT id FROM "Quote" WHERE "convertedTotal" < 0`
-- ra 0 hàng — thì mới VALIDATE ở một migration sau.
-- IDEMPOTENT: chỉ thêm khi chưa có ràng buộc cùng tên.
-- ROLLBACK: ALTER TABLE "Quote" DROP CONSTRAINT "Quote_convertedTotal_nonneg_check";
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Quote_convertedTotal_nonneg_check') THEN
    ALTER TABLE "Quote" ADD CONSTRAINT "Quote_convertedTotal_nonneg_check"
      CHECK ("convertedTotal" IS NULL OR "convertedTotal" >= 0) NOT VALID;
  END IF;
END $$;
