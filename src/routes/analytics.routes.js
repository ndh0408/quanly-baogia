import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { asyncHandler, requireAuth } from "../middleware.js";
import { validate } from "../validators.js";
import { can, quoteScopeWhere, PERMISSIONS as P } from "../permissions.js";

const router = Router();
router.use(requireAuth);

const PeriodQuery = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

function defaultRange(q) {
  const to = q.to || new Date();
  const from = q.from || new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  return { from, to };
}

/**
 * Overview KPIs: total amount of approved+sent+converted, count by status,
 * conversion rate, average deal size, expiring soon, top performers.
 */
router.get(
  "/overview",
  validate({ query: PeriodQuery }),
  asyncHandler(async (req, res) => {
    const { from, to } = defaultRange(req.query);
    const scope = quoteScopeWhere(req.session); // admin=all, manager=own, employee=member

    const where = { createdAt: { gte: from, lte: to }, ...scope };

    const [byStatus, totalsApproved, expiringSoon] = await Promise.all([
      prisma.quote.groupBy({
        by: ["status"],
        where,
        _count: { _all: true },
        _sum: { total: true },
      }),
      prisma.quote.aggregate({
        where: { ...where, status: { in: ["approved", "sent", "converted"] } },
        _sum: { total: true },
        _count: { _all: true },
        _avg: { total: true },
      }),
      prisma.quote.count({
        where: {
          ...scope,
          status: { in: ["approved", "sent"] },
          validUntil: { gte: new Date(), lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
        },
      }),
    ]);

    const counts = Object.fromEntries(byStatus.map((b) => [b.status, b._count._all]));
    const sums = Object.fromEntries(byStatus.map((b) => [b.status, Number(b._sum.total ?? 0)]));
    const totalQuotes = byStatus.reduce((s, b) => s + b._count._all, 0);
    const converted = counts.converted || 0;
    const conversionRate = totalQuotes > 0 ? Number(((converted / totalQuotes) * 100).toFixed(2)) : 0;

    res.json({
      period: { from, to },
      counts,
      sums,
      kpi: {
        totalQuotes,
        approvedAmount: Number(totalsApproved._sum.total ?? 0),
        avgDealSize: Number(totalsApproved._avg.total ?? 0),
        conversionRate,
        expiringSoon,
      },
    });
  })
);

/** Revenue (approved+sent+converted) by day for chart. */
router.get(
  "/revenue-by-day",
  validate({ query: PeriodQuery }),
  asyncHandler(async (req, res) => {
    const { from, to } = defaultRange(req.query);
    // admin sees all; manager/employee scoped to their own created quotes for this chart.
    const allScope = can(req.session, P.QUOTE_READ_ALL);
    const scope = allScope ? "" : 'AND "createdById" = $3';
    const params = allScope ? [from, to] : [from, to, req.session.userId];

    const rows = await prisma.$queryRawUnsafe(
      `SELECT DATE("createdAt") AS d, COALESCE(SUM("total"), 0)::float AS amount, COUNT(*)::int AS n
       FROM "Quote"
       WHERE "createdAt" >= $1 AND "createdAt" <= $2
         AND "status" IN ('approved','sent','converted')
         AND "deletedAt" IS NULL ${scope}
       GROUP BY 1
       ORDER BY 1 ASC`,
      ...params
    );
    res.json({ data: rows });
  })
);

/** Top sales by approved amount. */
router.get(
  "/top-sales",
  validate({ query: PeriodQuery.extend({ limit: z.coerce.number().int().min(1).max(50).default(10) }) }),
  asyncHandler(async (req, res) => {
    const { from, to, limit } = { ...defaultRange(req.query), limit: req.query.limit };
    // Only admin sees the company-wide leaderboard; others see just their own row.
    const taScope = can(req.session, P.QUOTE_READ_ALL) ? {} : { createdById: req.session.userId };
    const rows = await prisma.quote.groupBy({
      by: ["createdById"],
      where: { ...taScope, createdAt: { gte: from, lte: to }, status: { in: ["approved", "sent", "converted"] } },
      _sum: { total: true },
      _count: { _all: true },
      orderBy: { _sum: { total: "desc" } },
      take: limit,
    });
    const userIds = rows.map((r) => r.createdById);
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, username: true, displayName: true },
    });
    const uMap = Object.fromEntries(users.map((u) => [u.id, u]));
    res.json({
      data: rows.map((r) => ({
        userId: r.createdById,
        user: uMap[r.createdById] || null,
        amount: Number(r._sum.total ?? 0),
        count: r._count._all,
      })),
    });
  })
);

/** Funnel: count of quotes at each status. */
router.get(
  "/funnel",
  asyncHandler(async (req, res) => {
    const scope = quoteScopeWhere(req.session); // admin=all, manager=own, employee=member
    const rows = await prisma.quote.groupBy({
      by: ["status"],
      where: scope,
      _count: { _all: true },
    });
    const order = ["draft", "pending", "approved", "sent", "converted", "rejected", "expired", "lost"];
    const map = Object.fromEntries(rows.map((r) => [r.status, r._count._all]));
    res.json({ data: order.map((s) => ({ status: s, count: map[s] || 0 })) });
  })
);

export default router;
