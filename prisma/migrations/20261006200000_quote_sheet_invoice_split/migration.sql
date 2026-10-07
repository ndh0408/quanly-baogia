-- CHIA SHEET THÀNH HÓA ĐƠN ở trang Hóa đơn đầu ra (chủ repo 2026-10-06: "cho chức năng chọn sheet nào là hóa đơn 1, sheet
-- nào hóa đơn 2, và có thể bỏ cái nào chưa muốn xuất để xuất sau hay là không làm").
--
-- THUẦN THÊM HAI CỘT NULL ĐƯỢC, không DEFAULT, không đụng dữ liệu nào đang có:
--   · "QuoteSheet"."invoiceGroup" — số hóa đơn (1, 2…) mà sheet thuộc về.
--   · "QuoteSheet"."invoiceHold"  — 'later' (Để sau) | 'skip' (Không xuất).
-- Mọi sheet hiện có mang NULL ở cả hai = "chưa chia": mỗi sheet là một hóa đơn, y như trước — số HĐ / ngày HĐ / thu tiền
-- vẫn đọc từ chính các cột cũ của sheet. Không cần UPDATE nào.
--
-- Mã CŨ chạy tiếp trên schema mới: không biết hai cột → coi mọi báo giá là "chưa chia" (mỗi sheet một dòng). Lưu báo
-- giá bằng mã cũ (xoá sheet rồi tạo lại) làm MẤT phép chia của báo giá đó — dữ liệu hóa đơn trên từng sheet thì còn.
--
-- ROLLBACK: ALTER TABLE "QuoteSheet" DROP COLUMN "invoiceHold"; ALTER TABLE "QuoteSheet" DROP COLUMN "invoiceGroup";
--   (mất phép chia, không mất số HĐ / ngày thu).

SET lock_timeout = '10s';

-- AlterTable
ALTER TABLE "QuoteSheet" ADD COLUMN "invoiceGroup" INTEGER,
ADD COLUMN "invoiceHold" TEXT;
