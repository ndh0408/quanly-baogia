-- Performance indexes for the two hottest read paths the earlier migration missed:
--   * Analytics (overview / revenue-by-day / top-sales) filter on createdAt range +
--     GROUP BY DATE(createdAt) — needs a createdAt index (the existing composite
--     leads with status, so a pure createdAt-range scan couldn't use it).
--   * Quote LIST sorts createdAt DESC scoped by createdById — needs (createdById,
--     createdAt) so the sort is served by the index instead of an in-memory sort.
-- Partial (deletedAt IS NULL) to match the soft-delete middleware that injects it
-- on every find/aggregate/groupBy. Additive, idempotent, no schema change.
CREATE INDEX IF NOT EXISTS "Quote_createdAt_live_idx"
  ON "Quote" ("createdAt" DESC) WHERE "deletedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "Quote_createdById_createdAt_live_idx"
  ON "Quote" ("createdById", "createdAt" DESC) WHERE "deletedAt" IS NULL;
