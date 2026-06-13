-- Integrity + performance hardening (DB architect audit).
-- Hand-authored (not `migrate dev`) so it is PROD-SAFE on the existing db-push
-- database: orphan rows are cleaned before FKs are added, FKs are added NOT VALID
-- then VALIDATEd separately (no full-table exclusive lock), and indexes are plain
-- (for very large tables, create them CONCURRENTLY by hand outside this migration).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) updatedAt / createdAt on config models (audit: cache-invalidation + trace)
-- ─────────────────────────────────────────────────────────────────────────────
-- createdAt keeps its default (matches @default(now())). updatedAt is added WITH a
-- default only to backfill existing rows, then the default is DROPPED so the column
-- matches Prisma's @updatedAt (which manages the value in the app, no DB default) —
-- avoids future `migrate dev` drift.
ALTER TABLE "Company"        ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "QuoteTemplate"  ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Company"        ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "QuoteTemplate"  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Webhook"        ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "ApprovalMatrix" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Company"        ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "QuoteTemplate"  ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "Webhook"        ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "ApprovalMatrix" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Clean orphan references BEFORE adding FK constraints (prevents prod failure)
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE "CustomerNote" SET "authorId"=NULL    WHERE "authorId" IS NOT NULL    AND "authorId" NOT IN (SELECT "id" FROM "User");
UPDATE "FollowUp"     SET "assigneeId"=NULL  WHERE "assigneeId" IS NOT NULL  AND "assigneeId" NOT IN (SELECT "id" FROM "User");
UPDATE "QuoteVersion" SET "createdById"=NULL WHERE "createdById" IS NOT NULL AND "createdById" NOT IN (SELECT "id" FROM "User");
UPDATE "ApiKey"       SET "createdById"=NULL WHERE "createdById" IS NOT NULL AND "createdById" NOT IN (SELECT "id" FROM "User");
UPDATE "QuoteItem"    SET "productId"=NULL   WHERE "productId" IS NOT NULL   AND "productId" NOT IN (SELECT "id" FROM "Product");

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Add the previously-missing FK constraints (NOT VALID = no blocking scan now)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "CustomerNote" ADD CONSTRAINT "CustomerNote_authorId_fkey"    FOREIGN KEY ("authorId")    REFERENCES "User"("id")    ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
ALTER TABLE "FollowUp"     ADD CONSTRAINT "FollowUp_assigneeId_fkey"      FOREIGN KEY ("assigneeId")  REFERENCES "User"("id")    ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
ALTER TABLE "QuoteVersion" ADD CONSTRAINT "QuoteVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id")    ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
ALTER TABLE "ApiKey"       ADD CONSTRAINT "ApiKey_createdById_fkey"       FOREIGN KEY ("createdById") REFERENCES "User"("id")    ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
ALTER TABLE "QuoteItem"    ADD CONSTRAINT "QuoteItem_productId_fkey"      FOREIGN KEY ("productId")   REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;

-- Validate separately: scans the table to confirm no violations, but only takes a
-- SHARE UPDATE EXCLUSIVE lock (concurrent reads/writes continue).
ALTER TABLE "CustomerNote" VALIDATE CONSTRAINT "CustomerNote_authorId_fkey";
ALTER TABLE "FollowUp"     VALIDATE CONSTRAINT "FollowUp_assigneeId_fkey";
ALTER TABLE "QuoteVersion" VALIDATE CONSTRAINT "QuoteVersion_createdById_fkey";
ALTER TABLE "ApiKey"       VALIDATE CONSTRAINT "ApiKey_createdById_fkey";
ALTER TABLE "QuoteItem"    VALIDATE CONSTRAINT "QuoteItem_productId_fkey";

-- Index the new FK columns (helps JOINs/reports by author/version-author/api-key).
-- (FollowUp.assigneeId is already covered by the composite @@index([assigneeId,...]);
--  QuoteItem already has @@index([productId].)
CREATE INDEX IF NOT EXISTS "CustomerNote_authorId_idx"    ON "CustomerNote"("authorId");
CREATE INDEX IF NOT EXISTS "QuoteVersion_createdById_idx" ON "QuoteVersion"("createdById");
CREATE INDEX IF NOT EXISTS "ApiKey_createdById_idx"       ON "ApiKey"("createdById");

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) CHECK constraints for business invariants (DB rejects bad rows from any path)
-- ─────────────────────────────────────────────────────────────────────────────
-- Clamp any pre-existing bad data first so the NOT VALID->VALIDATE succeeds.
UPDATE "QuoteItem" SET "kind"='item' WHERE "kind" NOT IN ('item','sub','info','section');
ALTER TABLE "QuoteItem" ADD CONSTRAINT "QuoteItem_kind_check"
  CHECK ("kind" IN ('item','sub','info','section')) NOT VALID;
ALTER TABLE "QuoteItem" VALIDATE CONSTRAINT "QuoteItem_kind_check";

ALTER TABLE "Quote" ADD CONSTRAINT "Quote_money_check"
  CHECK ("vatPercent" BETWEEN 0 AND 100 AND "discount" >= 0 AND "subtotal" >= 0 AND "vat" >= 0 AND "total" >= 0) NOT VALID;
ALTER TABLE "Quote" VALIDATE CONSTRAINT "Quote_money_check";

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) Performance indexes (audit: sort/aggregate gaps). Plain CREATE INDEX (brief
--    lock — fine at current scale). For a very large table, run the equivalent
--    CREATE INDEX CONCURRENTLY by hand instead.
--    (Trigram search indexes are in the NEXT migration — they need the pg_trgm
--     extension which requires superuser, so they are isolated so a missing
--     extension can't roll back these integrity fixes.)
-- ─────────────────────────────────────────────────────────────────────────────
-- Sort/aggregate gaps (partial: matches the deletedAt IS NULL the app always applies)
CREATE INDEX IF NOT EXISTS "Quote_quoteDate_live_idx"   ON "Quote" ("quoteDate" DESC) WHERE "deletedAt" IS NULL;
CREATE INDEX IF NOT EXISTS "Quote_total_live_idx"       ON "Quote" ("total" DESC)     WHERE "deletedAt" IS NULL;
CREATE INDEX IF NOT EXISTS "Quote_projectCode_live_idx" ON "Quote" ("projectCode")    WHERE "deletedAt" IS NULL;
-- Approval queue (decision='pending' is a tiny hot subset)
CREATE INDEX IF NOT EXISTS "Approval_pending_queue_idx" ON "Approval" ("quoteId","level") WHERE "decision" = 'pending';

-- Dedup support for customer tax code (app enforces; index speeds the check + search)
CREATE INDEX IF NOT EXISTS "Customer_taxCode_idx" ON "Customer"("taxCode") WHERE "taxCode" IS NOT NULL;
