-- SỐ THỨ TỰ MÃ SẢN XUẤT của từng sheet, ĐÓNG BĂNG lúc cấp.
--
-- Trước: mã sheet ("FP_A26_003_02") được dựng bằng `_${i+1}` theo CHỈ SỐ MẢNG, ở 5 chỗ chép tay
--        khác nhau. Xoá một sheet ở giữa hoặc đổi thứ tự làm mã của MỌI sheet phía sau dịch đi
--        một — kể cả sheet đã xuất hoá đơn mang mã cũ. Không có gì trong CSDL giữ mã đó cả.
-- Nay:   mỗi sheet mang một số riêng, cấp một lần rồi thôi. Xoá sheet 02 thì còn 01 và 03; sheet
--        thêm mới nhận số kế tiếp CHƯA AI DÙNG trong cùng báo giá.
--
-- ROLLBACK: ALTER TABLE "QuoteSheet" DROP COLUMN "codeNo";
--   (đường đọc có nhánh lùi về vị trí khi codeNo NULL nên bỏ cột không làm vỡ màn hình.)

ALTER TABLE "QuoteSheet" ADD COLUMN "codeNo" INTEGER;

-- Backfill = ĐÚNG thứ tự đang hiển thị hôm nay (`order asc`, hoà thì theo id) → không một mã nào
-- đổi ở lượt deploy này. Mọi thứ chỉ khác từ lần xoá/đổi thứ tự sheet KẾ TIẾP trở đi.
WITH s AS (
  SELECT "id", row_number() OVER (PARTITION BY "quoteId" ORDER BY "order", "id") AS n
  FROM "QuoteSheet"
)
UPDATE "QuoteSheet" t SET "codeNo" = s.n FROM s WHERE t."id" = s."id";
