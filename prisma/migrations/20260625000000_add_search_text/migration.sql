-- Tìm kiếm KHÔNG dấu / sai dấu: cột searchText (chuẩn-hóa bởi normalizeSearch ở app) + GIN trigram index.
-- App ghi searchText khi create/update (Customer/Quote); backfill rows cũ bằng prisma/backfill-searchtext.mjs.

ALTER TABLE "Customer" ADD COLUMN "searchText" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Quote" ADD COLUMN "searchText" TEXT NOT NULL DEFAULT '';

-- pg_trgm: index trigram cho LIKE '%...%' nhanh ở quy mô lớn (substring + gần đúng).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "Customer_searchText_trgm_idx" ON "Customer" USING gin ("searchText" gin_trgm_ops);
CREATE INDEX "Quote_searchText_trgm_idx" ON "Quote" USING gin ("searchText" gin_trgm_ops);
