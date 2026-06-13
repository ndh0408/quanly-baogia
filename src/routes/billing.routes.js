import { Router } from "express";
import express from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { asyncHandler, requireAuth, requireRole } from "../middleware.js";
import { validate } from "../validators.js";
import { audit } from "../audit.js";
import { getStripe, getActiveSubscription, applyStripeSubscription, isBillingEnabled, usageSum, checkQuota } from "../billing.js";
import { logger } from "../logger.js";

const router = Router();

// === Public plan catalog (no auth) ===
router.get(
  "/plans",
  asyncHandler(async (_req, res) => {
    const rows = await prisma.plan.findMany({
      where: { active: true },
      orderBy: { priceMonth: "asc" },
    });
    res.json(rows.map((p) => ({
      ...p,
      priceMonth: Number(p.priceMonth),
      priceYear: Number(p.priceYear),
    })));
  })
);

// === Plan CRUD (admin) ===
router.post(
  "/plans",
  requireAuth, requireRole("admin"),
  validate({ body: z.object({
    code: z.string().min(1).max(40),
    name: z.string().min(1).max(80),
    priceMonth: z.coerce.number().nonnegative(),
    priceYear: z.coerce.number().nonnegative(),
    stripePriceId: z.string().optional().nullable(),
    maxUsers: z.coerce.number().int().nullable().optional(),
    maxQuotesPerMonth: z.coerce.number().int().nullable().optional(),
    maxCustomers: z.coerce.number().int().nullable().optional(),
    maxStorageGB: z.coerce.number().int().nullable().optional(),
    features: z.record(z.string(), z.boolean()).default({}),
  })}),
  asyncHandler(async (req, res) => {
    const p = await prisma.plan.create({ data: req.body });
    await audit(req, "plan.create", { resource: "plan", resourceId: p.id });
    res.status(201).json(p);
  })
);

// === Current subscription ===
router.get(
  "/subscription",
  requireAuth,
  asyncHandler(async (_req, res) => {
    const sub = await getActiveSubscription();
    if (!sub) {
      return res.json({ subscription: null, plan: null, status: "none" });
    }
    res.json({
      subscription: sub,
      plan: { ...sub.plan, priceMonth: Number(sub.plan.priceMonth), priceYear: Number(sub.plan.priceYear) },
    });
  })
);

// === Usage / quota ===
router.get(
  "/usage",
  requireAuth, requireRole("admin", "manager"),
  asyncHandler(async (_req, res) => {
    const [users, customers, quotes30d, exports30d] = await Promise.all([
      prisma.user.count(),
      prisma.customer.count(),
      prisma.quote.count({ where: { createdAt: { gte: new Date(Date.now() - 30 * 86400_000) } } }),
      usageSum("exports.run"),
    ]);
    const sub = await getActiveSubscription();
    const plan = sub?.plan;
    res.json({
      plan: plan?.code || "free",
      used: { users, customers, quotesPerMonth: quotes30d, exportsPerMonth: exports30d },
      limits: plan ? {
        maxUsers: plan.maxUsers,
        maxCustomers: plan.maxCustomers,
        maxQuotesPerMonth: plan.maxQuotesPerMonth,
        maxStorageGB: plan.maxStorageGB,
      } : null,
    });
  })
);

// === Checkout (creates Stripe Checkout Session) ===
router.post(
  "/checkout",
  requireAuth, requireRole("admin"),
  validate({ body: z.object({
    planCode: z.string().min(1, "Vui lòng chọn gói dịch vụ"),
    successUrl: z.string().url("Địa chỉ URL không hợp lệ"),
    cancelUrl: z.string().url("Địa chỉ URL không hợp lệ"),
  })}),
  asyncHandler(async (req, res) => {
    const stripe = getStripe();
    if (!stripe) return res.status(503).json({ error: "Chưa cấu hình Stripe. Vui lòng thiết lập khóa Stripe trước khi thanh toán." });
    const plan = await prisma.plan.findUnique({ where: { code: req.body.planCode } });
    if (!plan || !plan.stripePriceId) return res.status(400).json({ error: "Gói cước này chưa được liên kết với giá Stripe (thiếu Stripe Price ID)" });

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: plan.stripePriceId, quantity: 1 }],
      success_url: req.body.successUrl,
      cancel_url: req.body.cancelUrl,
      client_reference_id: String(req.session.userId),
    });
    await audit(req, "billing.checkout.create", { resource: "plan", resourceId: plan.id });
    res.json({ url: session.url, sessionId: session.id });
  })
);

// === Stripe webhook (raw body) ===
// Mounted separately in server.js so it gets the raw body (signature verify).
export const webhookRouter = Router();
webhookRouter.post(
  "/stripe",
  express.raw({ type: "application/json" }),
  asyncHandler(async (req, res) => {
    const stripe = getStripe();
    if (!stripe || !config.STRIPE_WEBHOOK_SECRET) {
      return res.status(503).json({ error: "Chưa cấu hình Stripe webhook (thiếu STRIPE_WEBHOOK_SECRET)." });
    }
    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, req.headers["stripe-signature"], config.STRIPE_WEBHOOK_SECRET);
    } catch (e) {
      logger.warn({ err: e.message }, "stripe signature verify failed");
      return res.status(400).json({ error: "bad signature" });
    }
    try {
      switch (event.type) {
        case "checkout.session.completed":
        case "customer.subscription.created":
        case "customer.subscription.updated":
        case "customer.subscription.deleted": {
          const sub = event.type === "checkout.session.completed"
            ? await stripe.subscriptions.retrieve(event.data.object.subscription)
            : event.data.object;
          await applyStripeSubscription(sub);
          break;
        }
        default:
          break;
      }
      res.json({ received: true });
    } catch (e) {
      logger.error({ err: e.message, type: event.type }, "stripe webhook handler failed");
      res.status(500).json({ error: "handler failed" });
    }
  })
);

router.get(
  "/status",
  requireAuth,
  asyncHandler(async (_req, res) => {
    res.json({
      enabled: isBillingEnabled(),
      webhookConfigured: !!config.STRIPE_WEBHOOK_SECRET,
    });
  })
);

export default router;
