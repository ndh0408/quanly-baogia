-- Tìm KHÔNG dấu cho Nhân sự: cột searchText + GIN trigram (pg_trgm đã CREATE EXTENSION ở migration add_search_text).
-- Additive, KHÔNG đụng data cũ. App ghi searchText khi create/update; rows cũ backfill bằng backfill-searchtext.mjs.
ALTER TABLE "PersonnelRecord" ADD COLUMN "searchText" TEXT NOT NULL DEFAULT '';
CREATE INDEX "PersonnelRecord_searchText_trgm_idx" ON "PersonnelRecord" USING gin ("searchText" gin_trgm_ops);
