-- Giảm giá chuyển từ MỨC BÁO GIÁ xuống MỨC SHEET.
--
-- Trước: `Quote.discount` là một số duy nhất, trừ SAU khi cộng VAT (total = subtotal + vat − discount).
-- Nay:   mỗi sheet có Discount riêng, trừ TRƯỚC khi tính VAT — đúng bố cục file khách đang dùng:
--            Cộng → Discount → Tổng Cộng → VAT(Tổng Cộng) → Thành Tiền
--        `Quote.discount` vẫn còn, nhưng nay là TỔNG các `QuoteSheet.discount` (suy ra, để trang
--        danh sách / lịch sử phiên bản / diff không phải đổi).
--
-- ⚠️ CHẠY LẠI LÀ TRỪ HAI LẦN. Khối backfill dưới đây KHÔNG idempotent: nó ghi
--    `Quote.subtotal = Quote.subtotal − Σ giảm giá`, nên lượt chạy thứ hai trừ tiếp một lần nữa.
--    Đường lùi ĐÚNG là khôi phục từ bản dump tiền-deploy (deploy.sh bước [1/6] tự tạo, giữ 7 bản
--    ở ~/quanly-backups), KHÔNG phải "DROP COLUMN rồi chạy lại".
-- ROLLBACK (chỉ phần lược đồ — số tiền phải lấy lại từ dump):
--   ALTER TABLE "QuoteSheet" DROP CONSTRAINT "QuoteSheet_discount_check";
--   ALTER TABLE "QuoteSheet" DROP COLUMN "discount";

ALTER TABLE "QuoteSheet"
ADD COLUMN "discount" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- ── RÓT GIẢM GIÁ CŨ XUỐNG CÁC SHEET ─────────────────────────────────────────────────────────
-- Nồi rót = giảm giá cũ, kẹp ở `Quote.subtotal` (giảm giá cũ được kẹp theo GỘP subtotal+VAT nên
-- có thể lớn hơn phần chưa VAT). Rót theo thứ tự hiển thị, mỗi sheet nhận tối đa bằng cột
-- `QuoteSheet.subtotal` của nó.
--
-- PHẦN DƯ PHẢI ĐI ĐÂU ĐÓ. Cột `QuoteSheet.subtotal` KHÔNG đáng tin cho dữ liệu cũ: nó được thêm
-- bởi migration 20260625000003 với NOT NULL DEFAULT 0, và mọi sheet lưu trước ngày đó mang 0 cho
-- tới khi ai đó chạy prisma/backfill-sheet-subtotal.mjs (src/services/projectRef.ts có hẳn một
-- đường lùi vì chuyện này — đo được trên production 2026-09-07: 10/14 sheet đang mang 0).
-- Rót "tối đa bằng cột đó" mà không xử lý phần dư thì với một báo giá toàn sheet mang 0, KHÔNG
-- sheet nào nhận được đồng nào ⇒ giảm giá BIẾN MẤT và `Quote.total` TỰ TĂNG đúng bằng khoản giảm
-- giá, im lặng. Nên phần dư được dồn vào sheet ĐẦU: Σ giảm giá các sheet LUÔN bằng nồi, không
-- đồng nào bốc hơi, và nếu sheet đầu nhận nhiều hơn tổng thật của nó thì con số đó HIỆN RA trên
-- màn hình (computeQuoteTotals kẹp lại lúc đọc) chứ không mất lặng lẽ.
WITH noi AS (
  SELECT q."id" AS quote_id, LEAST(q."discount", GREATEST(0, q."subtotal")) AS pot
  FROM "Quote" q
  WHERE q."discount" > 0
), s AS (
  SELECT qs."id",
         row_number()                     OVER w                                                     AS rn,
         GREATEST(0, qs."subtotal")                                                                  AS cap,
         COALESCE(SUM(GREATEST(0, qs."subtotal")) OVER (w ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS truoc,
         SUM(GREATEST(0, qs."subtotal"))  OVER (PARTITION BY qs."quoteId")                           AS tong_cap,
         n.pot
  FROM "QuoteSheet" qs
  JOIN noi n ON n.quote_id = qs."quoteId"
  WINDOW w AS (PARTITION BY qs."quoteId" ORDER BY qs."order", qs."id")
)
UPDATE "QuoteSheet" t
SET "discount" = GREATEST(0, LEAST(s.cap, s.pot - s.truoc))
                 + CASE WHEN s.rn = 1 THEN GREATEST(0, s.pot - LEAST(s.pot, s.tong_cap)) ELSE 0 END
FROM s
WHERE t."id" = s."id";

-- Cột materialized `QuoteSheet.subtotal` nay mang nghĩa "tổng sheet ĐÃ TRỪ Discount" — trang
-- Quản lý dự án / Hoá đơn / Tổng quan / Nhân sự đọc THẲNG cột này chứ không tính lại từ hàng.
-- GREATEST(0, …) vì sheet cũ có thể đang mang 0 mà vẫn được rót phần dư ở trên: không bao giờ
-- ghi số ÂM vào một cột mà giao diện đọc ra thành tiền.
UPDATE "QuoteSheet" SET "subtotal" = GREATEST(0, "subtotal" - "discount") WHERE "discount" > 0;

-- Số đã chốt trên báo giá phải khớp chính sách mới, nếu không trang Danh sách (đọc cột đã lưu,
-- KHÔNG tính lại) sẽ hiện tổng cũ cho tới lần bấm Lưu kế tiếp.
--   subtotal(mới) = Σ tổng sheet ĐÃ trừ discount   ·   vat = ROUND(subtotal × vatPercent%)
-- COALESCE + LEFT JOIN: báo giá KHÔNG có sheet nào vẫn phải được dọn về `discount = 0`, nếu không
-- nó ở lại vi phạm bất biến mới ("discount = Σ các sheet") và tổng đã lưu lệch với tổng tính lại.
UPDATE "Quote" q
SET "discount" = COALESCE(d."tong", 0),
    "subtotal" = q."subtotal" - COALESCE(d."tong", 0),
    "vat"      = ROUND((q."subtotal" - COALESCE(d."tong", 0)) * q."vatPercent" / 100),
    "total"    = (q."subtotal" - COALESCE(d."tong", 0))
               + ROUND((q."subtotal" - COALESCE(d."tong", 0)) * q."vatPercent" / 100)
FROM (SELECT "id" FROM "Quote" WHERE "discount" > 0) t
LEFT JOIN (SELECT "quoteId", SUM("discount") AS "tong" FROM "QuoteSheet" GROUP BY "quoteId") d
       ON d."quoteId" = t."id"
WHERE q."id" = t."id";

-- Cùng luật với "Quote_money_check": tiền không âm.
ALTER TABLE "QuoteSheet"
ADD CONSTRAINT "QuoteSheet_discount_check" CHECK ("discount" >= 0) NOT VALID;
ALTER TABLE "QuoteSheet" VALIDATE CONSTRAINT "QuoteSheet_discount_check";
