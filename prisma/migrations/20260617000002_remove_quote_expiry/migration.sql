-- Remove the quote auto-expiry feature entirely (by request).
-- 1) Un-expire any existing rows back to "approved" (they were approved/sent before
--    the sweep flipped them) so nothing is stuck on a status we're deleting.
-- 2) Narrow the QuoteStatus enum by dropping the "expired" value. Postgres can't
--    DROP a value in place, so rebuild the type (standard prod-safe pattern):
--    rename old → create new without "expired" → cast column → drop old.
-- 3) Drop the now-unused "expiredAt" column.
-- NOTE: only Quote.status uses QuoteStatus, so the type rebuild is self-contained.

UPDATE "Quote" SET "status" = 'approved' WHERE "status" = 'expired';

ALTER TABLE "Quote" ALTER COLUMN "status" DROP DEFAULT;
ALTER TYPE "QuoteStatus" RENAME TO "QuoteStatus_old";
CREATE TYPE "QuoteStatus" AS ENUM ('draft', 'pending', 'approved', 'rejected', 'sent', 'converted', 'lost');
ALTER TABLE "Quote" ALTER COLUMN "status" TYPE "QuoteStatus" USING ("status"::text::"QuoteStatus");
ALTER TABLE "Quote" ALTER COLUMN "status" SET DEFAULT 'draft';
DROP TYPE "QuoteStatus_old";

ALTER TABLE "Quote" DROP COLUMN IF EXISTS "expiredAt";

-- Also drop the validity window entirely (validUntil) — the whole expiry concept
-- is removed; it was only read by the (now-deleted) sweep and the expiring-soon KPI.
DROP INDEX IF EXISTS "Quote_validUntil_idx";
ALTER TABLE "Quote" DROP COLUMN IF EXISTS "validUntil";
