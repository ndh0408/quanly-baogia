-- "Ký Chứng từ": ai được ký (User.canSign) + chữ ký theo từng sheet (QuoteSheet).
-- Chỉ phục vụ quản lý nội bộ, KHÔNG xuất Excel. Additive, an toàn dữ liệu cũ.
ALTER TABLE "User" ADD COLUMN "canSign" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "QuoteSheet" ADD COLUMN "signedAt" TIMESTAMP(3);
ALTER TABLE "QuoteSheet" ADD COLUMN "signedById" INTEGER;
ALTER TABLE "QuoteSheet" ADD COLUMN "signedByName" TEXT;
