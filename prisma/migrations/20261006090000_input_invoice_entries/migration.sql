-- KHOẢN CHI của trang Hóa đơn đầu vào (chủ repo 2026-10-06: "cái thanh toán bên đó là cho kế toán, không nằm
-- trong kia nữa"): kế toán tích ĐÃ CHI + ảnh chứng từ, ghi Ngày hóa đơn + Ghi chú kế toán cho từng hàng bảng
-- nội bộ đã duyệt — ngay trên trang Hóa đơn đầu vào, không qua màn soạn báo giá.
--
-- THUẦN THÊM BẢNG — không đụng cột/dữ liệu nào đang có. Cờ cũ paid/paidAt/paidById/paidProof vẫn nằm nguyên
-- trong JSON hàng ("QuoteSheet"."extraTables", "Quote"."hnTables"); mã mới đóng băng chúng và đọc chúng làm
-- nguồn dự phòng, rồi công cụ dist/tools/backfillKhoanChi.js chép sang bảng mới (khô → --ghi → --kiem).
-- Mã CŨ chạy tiếp trên schema mới (không biết hai bảng này nên không đụng tới chúng).
--
-- VÌ SAO BẢNG RIÊNG chứ không phải trường mới trong JSON hàng: mọi đường Lưu báo giá viết lại cả JSON — bản
-- app cũ (khi lùi ảnh) lọc JSON theo danh sách trường được phép nên sẽ xoá im trường mới; ghi lên "Quote" làm
-- nhảy mốc khoá lạc quan của màn soạn (tiền lệ migration 20260930120000_quote_list_note); "Dọn rác" xoá cứng
-- báo giá thì cascade xuống "QuoteSheet". Xem chú thích model InputInvoiceEntry trong prisma/schema.prisma.
--
-- ON DELETE RESTRICT ở CẢ HAI khoá ngoại (không CASCADE): báo giá còn khoản kế toán thì không xoá cứng được,
-- khoản còn ảnh thì không xoá được. Ảnh là CHỈ THÊM — mã ứng dụng không có lệnh DELETE nào lên hai bảng này.
-- Không CHECK cho "side"/"source"/"retiredReason": kiểm ở lớp API (như "QuoteListNote"."color").
-- "currentProofId" KHÔNG có FK (tránh vòng FK hai chiều Entry ↔ Proof); dịch vụ giữ toàn vẹn.
--
-- ROLLBACK: chỉ được DROP hai bảng khi CẢ HAI ĐỀU RỖNG:
--   DROP TABLE "InputInvoiceProof"; DROP TABLE "InputInvoiceEntry";
-- Đã có dữ liệu thì KHÔNG lùi schema — lùi ẢNH là đủ (deploy.sh rollback chỉ lùi ảnh): app cũ không biết hai
-- bảng nên không xoá chúng, còn "Dọn rác" của app cũ gặp FK RESTRICT thì hỏng ồn ào (409), không xoá.

-- Không để lệnh DDL xếp hàng sau một transaction dài của người đang dùng: thà migration dừng sớm
-- và deploy.sh `set -e` chặn lại, còn hơn khoá bảng "Quote" cho tới khi hết thời gian chờ.
SET lock_timeout = '10s';

-- CreateTable
CREATE TABLE "InputInvoiceEntry" (
    "id" SERIAL NOT NULL,
    "quoteId" INTEGER NOT NULL,
    "side" TEXT NOT NULL,
    "rid" TEXT NOT NULL,
    "paid" BOOLEAN NOT NULL DEFAULT false,
    "paidAt" TIMESTAMP(3),
    "paidById" INTEGER,
    "paidByName" TEXT,
    "paidSnapshot" JSONB,
    "currentProofId" INTEGER,
    "invoiceDate" DATE,
    "accountingNote" TEXT,
    "rowSnapshot" JSONB NOT NULL,
    "legacySeed" JSONB,
    "source" TEXT NOT NULL DEFAULT 'trang',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" INTEGER,
    "updatedByName" TEXT,

    CONSTRAINT "InputInvoiceEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InputInvoiceProof" (
    "id" SERIAL NOT NULL,
    "entryId" INTEGER NOT NULL,
    "dataUrl" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT,
    "source" TEXT NOT NULL DEFAULT 'upload',
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploadedById" INTEGER,
    "uploadedByName" TEXT,
    "retiredAt" TIMESTAMP(3),
    "retiredById" INTEGER,
    "retiredByName" TEXT,
    "retiredReason" TEXT,

    CONSTRAINT "InputInvoiceProof_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InputInvoiceEntry_quoteId_side_rid_key" ON "InputInvoiceEntry"("quoteId", "side", "rid");

-- CreateIndex
CREATE INDEX "InputInvoiceProof_entryId_idx" ON "InputInvoiceProof"("entryId");

-- AddForeignKey
ALTER TABLE "InputInvoiceEntry" ADD CONSTRAINT "InputInvoiceEntry_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InputInvoiceProof" ADD CONSTRAINT "InputInvoiceProof_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "InputInvoiceEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
