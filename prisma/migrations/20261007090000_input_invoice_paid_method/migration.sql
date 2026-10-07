-- HÌNH THỨC CHI của khoản chi (chủ repo 2026-10-07: "cái thanh toán hóa đơn đầu vào có khi là tiền mặt ấy nhen").
--
-- THUẦN THÊM CỘT, không đụng dữ liệu nào đang có:
--   · "InputInvoiceEntry"."paidMethod" — 'chuyen-khoan' | 'tien-mat', NULL được, KHÔNG DEFAULT. NULL = khoản tích trước
--     cột này (hoặc chưa chi): mã đọc coi là chuyển khoản, nên mọi khoản cũ hiện y như trước — không cần UPDATE nào.
--     Thêm cột NULL không DEFAULT chỉ ghi siêu dữ liệu (không viết lại bảng).
--
-- Mã CŨ chạy tiếp trên schema mới: nó không biết cột này. Khoản kế toán tích bằng app cũ nhận NULL (= chuyển khoản, đúng
-- nghĩa cũ); app cũ bỏ tích khoản tiền mặt thì cột còn 'tien-mat' trên khoản CHƯA chi — mọi nơi đọc chỉ xét hình thức khi
-- khoản ĐANG đã chi, nên vô hại (tích lại bằng app mới ghi đè).
--
-- ROLLBACK (chỉ khi chưa có khoản tiền mặt nào): ALTER TABLE "InputInvoiceEntry" DROP COLUMN "paidMethod";
--   — đã có dữ liệu thì KHÔNG lùi schema, chỉ lùi ảnh.

SET lock_timeout = '10s';

-- AlterTable
ALTER TABLE "InputInvoiceEntry" ADD COLUMN "paidMethod" TEXT;
