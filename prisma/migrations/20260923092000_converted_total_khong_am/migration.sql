-- MONEY-01 — doanh thu chốt (`Quote.convertedTotal`) không được âm.
--
-- CHECK "Quote_money_check" (migration 20260613000001) chỉ phủ subtotal/vat/total/discount. Cột
-- convertedTotal (thêm 2026-09-17) thì không: trang giảm trừ có subtotal âm cộng với trang dương bị
-- khách từ chối cho ra net âm, và markConverted cũ ghi thẳng số đó. Mã nay kẹp ≥ 0
-- (src/money.ts tinhConvertedTotal); ràng buộc này là lớp chặn thứ hai ở CSDL.
--
-- NOT VALID KHÔNG CÓ NGHĨA "chỉ áp cho hàng mới": Postgres vẫn kiểm MỌI bản hàng do UPDATE sinh ra,
-- kể cả UPDATE không đụng cột này (`SET "updatedAt" = "updatedAt"` của khoá lạc quan). Thêm ràng buộc
-- khi đã có hàng âm là KHOÁ CỨNG báo giá đó — Lưu, đánh dấu thanh toán, xoá mềm đều 500 (soát chéo
-- 2026-09-23). Nên: CÓ hàng âm thì KHÔNG thêm ràng buộc, chỉ RAISE NOTICE để người vận hành rà tay;
-- migration này KHÔNG sửa dữ liệu nào. Đo 2026-09-23 (chỉ đọc): production 0 hàng âm, dev 0 hàng âm.
-- Hàng âm sau này được kẹp về 0 ở lần ghi kế tiếp qua mã mới, rồi thêm ràng buộc ở một migration sau.
--
-- lock_timeout 5s (chỉ trong transaction của khối này): ADD CONSTRAINT cần khoá ACCESS EXCLUSIVE ngắn
-- trên "Quote". Không có trần thì nó xếp hàng sau một giao dịch dài của app đang chạy và chặn MỌI truy
-- vấn Quote phía sau nó. Quá 5s thì migration hỏng rõ ràng, deploy dừng, chạy lại lúc vắng.
-- IDEMPOTENT: chỉ thêm khi chưa có ràng buộc cùng tên.
-- ROLLBACK: ALTER TABLE "Quote" DROP CONSTRAINT IF EXISTS "Quote_convertedTotal_nonneg_check";
DO $$
DECLARE
  so_am bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Quote_convertedTotal_nonneg_check') THEN
    RETURN;
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  SELECT count(*) INTO so_am FROM "Quote" WHERE "convertedTotal" < 0;
  IF so_am > 0 THEN
    RAISE NOTICE 'MONEY-01: % báo giá có convertedTotal < 0 — CHƯA thêm Quote_convertedTotal_nonneg_check (rà: SELECT id FROM "Quote" WHERE "convertedTotal" < 0)', so_am;
    RETURN;
  END IF;
  ALTER TABLE "Quote" ADD CONSTRAINT "Quote_convertedTotal_nonneg_check"
    CHECK ("convertedTotal" IS NULL OR "convertedTotal" >= 0) NOT VALID;
END $$;
