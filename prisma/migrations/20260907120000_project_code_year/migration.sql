-- Mã dự án: NĂM do hệ thống tự thêm, không còn gõ tay vào `User.projectCode`.
--
-- Trước: quản trị gõ thẳng "FP_A26" vào mã nhân viên, và nextProjectCode nối "_001" vào sau
--        (bộ đếm khoá theo (prefix, year=0) — KHÔNG có khái niệm năm). Sang 2027 thì mã vẫn đẻ ra
--        "FP_A26_004": sai năm, và bộ đếm KHÔNG BAO GIỜ reset.
-- Nay:   `User.projectCode` chỉ còn phần chữ do người đặt ("FP_A"), năm lấy theo năm hiện tại
--        (2 số cuối) và bộ đếm khoá theo (prefix, năm) nên tự reset về 001 mỗi đầu năm:
--            FP_A + 2026 → FP_A26_001, FP_A26_002 …   sang 2027 → FP_A27_001
--
-- ROLLBACK: không cần SQL — cột không đổi hình dạng. Muốn quay lại thì nối 2 số năm vào
--   `User.projectCode` như cũ; các hàng QuoteCounter(year=0) vẫn còn nguyên (xem ghi chú dưới).

-- ── 1. BỘ ĐẾM SUY TỪ CHÍNH MÃ ĐÃ CẤP, KHÔNG TIN HÀNG ĐẾM CŨ ────────────────────────────────
-- Hàng đếm cũ khoá theo prefix CÓ SẴN NĂM ("FP_A26", year=0). Chuyển nó sang khoá mới bằng cách
-- cắt chuỗi thì phải TIN rằng nó đúng. An toàn hơn: đọc thẳng các `Quote.projectCode` ĐÃ CẤP và
-- lấy số lớn nhất của từng (prefix, năm). Dữ liệu là sự thật; bộ đếm chỉ là ảnh chụp của nó.
-- Thiếu bước này, lượt tạo báo giá đầu tiên sau khi deploy sẽ cấp lại "FP_A26_001" — đụng
-- @@unique([projectCode, projectVersion]) và người dùng nhận 409 cho một thao tác hợp lệ.
INSERT INTO "QuoteCounter" ("prefix", "year", "value")
SELECT t.p, t.y, MAX(t.n)
FROM (
  SELECT (regexp_match(q."projectCode", '^(.*)(\d{2})_(\d{3})$'))[1]              AS p,
         2000 + ((regexp_match(q."projectCode", '^(.*)(\d{2})_(\d{3})$'))[2])::int AS y,
         ((regexp_match(q."projectCode", '^(.*)(\d{2})_(\d{3})$'))[3])::int        AS n
  FROM "Quote" q
  WHERE q."projectCode" ~ '^(.*)(\d{2})_(\d{3})$'
) t
WHERE t.p IS NOT NULL AND t.p <> ''
GROUP BY t.p, t.y
ON CONFLICT ("prefix", "year") DO UPDATE
  SET "value" = GREATEST("QuoteCounter"."value", EXCLUDED."value");

-- ── 2. BỎ NĂM KHỎI MÃ NHÂN VIÊN ───────────────────────────────────────────────────────────
-- "FP_A26" → "FP_A". Chỉ cắt khi ĐÚNG hai chữ số ở cuối: đó là cái mà quản trị gõ nhầm vào, và
-- từ nay ô nhập cũng tự bóc (src/validators.ts) nên không tái diễn.
UPDATE "User"
SET "projectCode" = regexp_replace("projectCode", '\d{2}$', '')
WHERE "projectCode" ~ '\d{2}$';

-- CỐ Ý KHÔNG XOÁ các hàng QuoteCounter(year = 0) của quy ước cũ: chúng không còn được đọc (bộ đếm
-- mới khoá theo năm thật), giữ lại thì vẫn tra được "trước đây đã cấp tới đâu" nếu cần đối chiếu.
