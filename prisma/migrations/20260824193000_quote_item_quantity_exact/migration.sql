-- Báo giá cũ giữ nguyên cách làm tròn Số Lượng 1 chữ số. Chỉ dòng import từ Excel ngoài
-- được đánh dấu true khi Thành Tiền trong file chứng minh đang dùng số lượng chính xác.
ALTER TABLE "QuoteItem"
ADD COLUMN "quantityExact" BOOLEAN NOT NULL DEFAULT false;
