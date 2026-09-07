-- Tiêu đề RÚT GỌN của báo giá (tuỳ chọn).
--
-- Dùng để đặt TÊN FILE tải về: <Mã khách hàng>_<tiêu đề rút gọn>_<MMDD tải>.xlsx — tên đầy đủ
-- thường quá dài và đầy dấu, không hợp làm tên tệp. Trống thì lùi về `title`.
--
-- ROLLBACK: ALTER TABLE "Quote" DROP COLUMN "shortTitle";
ALTER TABLE "Quote" ADD COLUMN "shortTitle" TEXT;
