-- Remove the Stripe/SaaS billing scaffold: Subscription, Plan, UsageRecord + SubscriptionStatus enum.
-- The usage/quota layer (recordUsage/checkQuota in src/billing.js) was scaffolded but NEVER wired
-- into any create/export flow (no callers), billing was disabled in prod (no STRIPE_SECRET_KEY),
-- and there was no billing UI. This is an internal single-org tool with no plans to sell, so the
-- whole layer (models, /api/billing routes, Stripe dep) is dead surface. Removing it.
-- Drop Subscription first — it has a FK (planId) to Plan.
DROP TABLE IF EXISTS "Subscription";
DROP TABLE IF EXISTS "Plan";
DROP TABLE IF EXISTS "UsageRecord";
DROP TYPE IF EXISTS "SubscriptionStatus";
