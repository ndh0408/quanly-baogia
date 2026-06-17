// Stripe billing wrapper. No-op when STRIPE_SECRET_KEY is unset so the app
// runs without a Stripe account in dev. The schema (Plan, Subscription,
// UsageRecord) is always present; only the external sync is gated.

import Stripe from "stripe";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { prisma } from "./db.js";

let stripe = null;
export function getStripe() {
  if (!config.STRIPE_SECRET_KEY) return null;
  if (stripe) return stripe;
  stripe = new Stripe(config.STRIPE_SECRET_KEY, { apiVersion: "2024-12-18.acacia" });
  return stripe;
}
export function isBillingEnabled() {
  return !!config.STRIPE_SECRET_KEY;
}

/**
 * Record a usage event. Cheap fire-and-forget; aggregation done in queries.
 */
export async function recordUsage(metric, value = 1) {
  try {
    await prisma.usageRecord.create({ data: { metric, value: BigInt(value) } });
  } catch (e) {
    logger.warn({ err: e.message, metric }, "usage record failed");
  }
}

/** Aggregate usage for a metric over a window (returns Number). */
export async function usageSum(metric, { from, to } = {}) {
  const fromTs = from ?? new Date(Date.now() - 30 * 86400_000);
  const toTs = to ?? new Date();
  const result = await prisma.$queryRaw`
    SELECT COALESCE(SUM("value"), 0)::bigint AS s
    FROM "UsageRecord"
    WHERE metric = ${metric} AND ts >= ${fromTs} AND ts <= ${toTs}`;
  return Number(result[0]?.s ?? 0);
}

/** Get the (single) active subscription + plan. App is single-tenant for now. */
export async function getActiveSubscription() {
  return prisma.subscription.findFirst({
    where: { status: { in: ["trialing", "active", "past_due"] } },
    orderBy: { createdAt: "desc" },
    include: { plan: true },
  });
}

/**
 * Check whether a quota would be exceeded. Returns {ok, used, limit}.
 * Pass null for unlimited.
 */
const QUOTA_COUNTERS = {
  maxUsers: () => prisma.user.count(),
  maxCustomers: () => prisma.customer.count(),
  maxQuotesPerMonth: () =>
    prisma.quote.count({ where: { createdAt: { gte: new Date(Date.now() - 30 * 86400_000) } } }),
};

export async function checkQuota(field) {
  // FAIL CLOSED on an unknown field: previously any unrecognized field fell through
  // to used=0 → ok:true, silently allowing the action. A typo'd/new quota name is a
  // bug, not a free pass.
  const counter = QUOTA_COUNTERS[field];
  if (!counter) {
    throw Object.assign(new Error(`Unknown quota field: ${field}`), { status: 500 });
  }
  const sub = await getActiveSubscription();
  // No subscription = billing not configured (single-tenant internal use) → unlimited.
  if (!sub) return { ok: true, used: 0, limit: null, plan: null };
  const limit = sub.plan?.[field];
  if (limit == null) return { ok: true, used: 0, limit: null, plan: sub.plan?.code };
  const used = await counter();
  return { ok: used < limit, used, limit, plan: sub.plan?.code };
}

/** Reconstruct local Subscription from a Stripe event. Idempotent. */
export async function applyStripeSubscription(stripeSub) {
  const planId = await mapPriceToPlan(stripeSub.items.data[0]?.price?.id);
  if (!planId) {
    logger.warn({ stripeSubId: stripeSub.id }, "no Plan matches Stripe price");
    return;
  }
  await prisma.subscription.upsert({
    where: { stripeSubscriptionId: stripeSub.id },
    create: {
      id: stripeSub.id,
      planId,
      stripeCustomerId: stripeSub.customer,
      stripeSubscriptionId: stripeSub.id,
      status: stripeSub.status,
      currentPeriodEnd: stripeSub.current_period_end
        ? new Date(stripeSub.current_period_end * 1000)
        : null,
      cancelAtPeriodEnd: !!stripeSub.cancel_at_period_end,
      trialEnd: stripeSub.trial_end ? new Date(stripeSub.trial_end * 1000) : null,
    },
    update: {
      planId,
      status: stripeSub.status,
      currentPeriodEnd: stripeSub.current_period_end
        ? new Date(stripeSub.current_period_end * 1000)
        : null,
      cancelAtPeriodEnd: !!stripeSub.cancel_at_period_end,
      trialEnd: stripeSub.trial_end ? new Date(stripeSub.trial_end * 1000) : null,
    },
  });
}

async function mapPriceToPlan(stripePriceId) {
  if (!stripePriceId) return null;
  const plan = await prisma.plan.findFirst({ where: { stripePriceId } });
  return plan?.id ?? null;
}
