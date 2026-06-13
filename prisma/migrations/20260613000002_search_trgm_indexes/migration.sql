-- Trigram search indexes — isolated from the integrity migration because
-- CREATE EXTENSION requires elevated privileges. If the app DB role is NOT a
-- superuser, a DBA must run `CREATE EXTENSION pg_trgm;` once as a superuser
-- FIRST; this migration is then a no-op for the extension and creates the indexes.
--
-- Why: every search/autocomplete uses ILIKE '%q%' (leading wildcard), which a
-- plain btree cannot serve — Postgres falls back to a full sequential scan. GIN
-- trigram indexes make ILIKE '%q%' index-accelerated.
--
-- NOTE: these GIN indexes are not expressible in the Prisma schema, so `prisma
-- migrate dev` will report them as drift. That is expected — do not drop them.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "Quote_title_trgm"       ON "Quote"    USING gin ("title" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Quote_toCompany_trgm"   ON "Quote"    USING gin ("toCompany" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Quote_quoteNumber_trgm" ON "Quote"    USING gin ("quoteNumber" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Customer_name_trgm"     ON "Customer" USING gin ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Customer_taxCode_trgm"  ON "Customer" USING gin ("taxCode" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Product_name_trgm"      ON "Product"  USING gin ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Product_sku_trgm"       ON "Product"  USING gin ("sku" gin_trgm_ops);
