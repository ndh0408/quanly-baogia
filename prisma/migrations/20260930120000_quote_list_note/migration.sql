-- GHI CHÚ + MÀU ở dòng của Danh sách báo giá (chủ repo 2026-09-30: "thêm ghi chú cho họ đánh vào, cho chọn
-- màu, 5 màu chủ đạo, chọn theo kiểu Zalo").
--
-- THUẦN THÊM BẢNG — không đụng cột/dữ liệu nào đang có, nên mã CŨ chạy tiếp trên schema mới (không có cửa
-- sổ 500 như migration 20260915090000) và lùi ảnh không cần SQL kèm theo.
--
-- VÌ SAO BẢNG RIÊNG chứ không phải hai cột trên "Quote": "Quote"."updatedAt" là mốc khoá lạc quan của màn
-- soạn. Ghi lên "Quote" làm mốc nhảy → đá văng lần Lưu kế tiếp của người đang soạn báo giá đó. Xem chú
-- thích của model QuoteListNote trong prisma/schema.prisma.
--
-- Không CHECK cho "color": bảng màu kiểm ở lớp API (src/quoteListNote.ts) để thêm/đổi màu không phải
-- migration. Không FK tới "User": "updatedByName" là tên CHỤP lúc ghi (như "QuoteSheet"."signedByName").
--
-- ROLLBACK: DROP TABLE "QuoteListNote";   (mất ghi chú đã gõ; không ảnh hưởng báo giá)

-- Không để lệnh DDL xếp hàng sau một transaction dài của người đang dùng: thà migration dừng sớm
-- và deploy.sh `set -e` chặn lại, còn hơn khoá bảng "Quote" cho tới khi hết thời gian chờ.
SET lock_timeout = '10s';

CREATE TABLE "QuoteListNote" (
    "quoteId" INTEGER NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "searchText" TEXT NOT NULL DEFAULT '',
    "color" TEXT,
    "updatedByName" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuoteListNote_pkey" PRIMARY KEY ("quoteId")
);

ALTER TABLE "QuoteListNote" ADD CONSTRAINT "QuoteListNote_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;
