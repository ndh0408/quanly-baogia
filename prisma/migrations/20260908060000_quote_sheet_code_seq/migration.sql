-- MỐC NƯỚC số mã sản xuất đã cấp của MỘT báo giá — chống CẤP LẠI mã đã phát hành.
--
-- LỖI (ultracode audit vòng 2, 2026-09-08): `capSoMaSheet` (src/quoteUtils.ts) tính số kế tiếp bằng
-- `max(codeNo của các sheet ĐANG CÒN) + 1`. Nhưng QuoteSheet KHÔNG nằm trong SOFT_DELETE_MODELS
-- (src/db.ts) — lưu báo giá là XOÁ CỨNG rồi tạo lại — nên khi sheet mang số CAO NHẤT bị xoá, số đó
-- biến mất khỏi CSDL và lượt thêm sheet kế tiếp CẤP LẠI đúng số ấy:
--     lưu 1: sheet A,B,C → 01,02,03      (mã _03 đã in lên hoá đơn / đã gửi khách)
--     lưu 2: xoá C       → còn 01,02
--     lưu 3: thêm D      → max(01,02)+1 = 03  ← D mang ĐÚNG mã của C
-- Hai chứng từ khác nhau cùng mang "FD_A26_001_03". Chính migration 20260907130000 đã hứa "sheet
-- thêm mới nhận số kế tiếp CHƯA AI DÙNG trong cùng báo giá" — cột này là thứ giữ được lời hứa đó.
--
-- ROLLBACK: ALTER TABLE "Quote" DROP COLUMN "sheetCodeSeq";
--   (capSoMaSheet có nhánh lùi về max(carry)+1 khi không nhận được mốc, tức hành vi y như trước.)

ALTER TABLE "Quote" ADD COLUMN "sheetCodeSeq" INTEGER NOT NULL DEFAULT 0;

-- Backfill = số cao nhất ĐANG CÓ của từng báo giá. Không mã nào đổi ở lượt deploy này; khác biệt
-- chỉ bắt đầu từ lần XOÁ sheet cuối + thêm sheet mới kế tiếp.
UPDATE "Quote" q
SET "sheetCodeSeq" = COALESCE((SELECT MAX(s."codeNo") FROM "QuoteSheet" s WHERE s."quoteId" = q."id"), 0);
