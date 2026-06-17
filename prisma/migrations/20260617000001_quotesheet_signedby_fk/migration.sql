-- Add the previously-missing FK on QuoteSheet.signedById (audit: a bare Int
-- reference broke referential integrity for per-sheet document signing — it could
-- point at a non-existent user). Hand-authored PROD-SAFE (matches the style of
-- 20260613000001): clean orphans first, add the FK NOT VALID then VALIDATE
-- separately (no long exclusive lock), and add the supporting index.
--
-- onDelete SET NULL: if the signer's user row is deleted we keep the sheet and the
-- snapshotted signedByName, only clearing the link — audit-safe.

-- 1) Clean orphan references before adding the constraint (prevents prod failure).
UPDATE "QuoteSheet" SET "signedById"=NULL
 WHERE "signedById" IS NOT NULL AND "signedById" NOT IN (SELECT "id" FROM "User");

-- 2) Add the FK NOT VALID (no blocking full-table scan now).
ALTER TABLE "QuoteSheet" ADD CONSTRAINT "QuoteSheet_signedById_fkey"
  FOREIGN KEY ("signedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;

-- 3) Validate separately (SHARE UPDATE EXCLUSIVE lock only; reads/writes continue).
ALTER TABLE "QuoteSheet" VALIDATE CONSTRAINT "QuoteSheet_signedById_fkey";

-- 4) Index the FK column (covers the cascade null-out + lookups by signer).
CREATE INDEX IF NOT EXISTS "QuoteSheet_signedById_idx" ON "QuoteSheet"("signedById");
