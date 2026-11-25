-- SỐ CA cho mẫu báo giá CINETOUR (chủ repo 2026-11-25): Thành Tiền = SL × [Số Ngày] × Số Ca × Đơn Giá.
--
-- THUẦN THÊM CỘT, không đụng dữ liệu nào đang có:
--   · "QuoteItem"."shifts" — DECIMAL(10,2), NULL được, KHÔNG DEFAULT. Cùng kiểu với "days" vì cùng luật: trống /
--     0 = ×1 (src/money.ts), mẫu không có cột Số Ca thì máy chủ ép NULL trước khi tính và ghi
--     (chuanHoaSoCaTheoMau, src/quoteUtils.ts). NULL = mọi hạng mục cũ → tiền của mọi báo giá đang có không đổi
--     một đồng, nên không cần UPDATE nào. Thêm cột NULL không DEFAULT chỉ ghi siêu dữ liệu (không viết lại bảng).
--   · Bảng nội bộ / Hà Nội (jsonb `extraTables` / `hnTables`) không cần cột: khoá `shifts` nằm trong từng hàng JSON.
--
-- Mã CŨ chạy tiếp trên schema mới: nó không biết cột này, mọi đường đọc/ghi của nó để cột NULL — đúng nghĩa ×1.
--
-- ROLLBACK (chỉ khi chưa có hạng mục nào mang số ca): ALTER TABLE "QuoteItem" DROP COLUMN "shifts";
--   — đã có dữ liệu thì KHÔNG lùi schema (mất số ca = đổi tiền báo giá), chỉ lùi ảnh.

SET lock_timeout = '10s';

-- AlterTable
ALTER TABLE "QuoteItem" ADD COLUMN "shifts" DECIMAL(10,2);
