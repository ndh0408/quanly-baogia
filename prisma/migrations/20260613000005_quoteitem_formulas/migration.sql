-- Store raw Excel-style formulas per quote-item numeric field (editor metadata),
-- e.g. {"unitPrice":"=2000+3000","quantity":"=5*3"}. Lets the editor re-show the
-- ORIGINAL formula when a cell is re-focused (the cell otherwise shows the result).
-- Not used in totals or export — purely for editing convenience. Additive/idempotent.
ALTER TABLE "QuoteItem" ADD COLUMN IF NOT EXISTS "formulas" JSONB;
