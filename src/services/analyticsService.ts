// Tầng SERVICE cho domain Analytics (KPI báo giá). Bê NGUYÊN logic từ analytics.routes.ts ra đây:
// phạm vi quyền (quoteScopeWhere / QUOTE_READ_ALL), groupBy/aggregate/$queryRaw, gom map kết quả.
// Route chỉ còn: requirePermission (ở router) + validate → gọi service → res.json. Mẫu theo quoteService.ts.
import type { Request } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { can, quoteScopeWhere, PERMISSIONS as P } from "../permissions.js";

function defaultRange(q: { from?: Date; to?: Date }) {
  const to = q.to || new Date();
  const from = q.from || new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  return { from, to };
}

/**
 * Overview KPIs: total amount of approved+sent+converted, count by status,
 * conversion rate, average deal size, expiring soon, top performers.
 */
export async function overview(req: Request) {
  const { from, to } = defaultRange(req.query);
  const scope = quoteScopeWhere(req.session); // admin=all, manager=own, employee=member

  const where = { createdAt: { gte: from, lte: to }, ...scope };

  const [byStatus, totalsApproved] = await Promise.all([
    prisma.quote.groupBy({
      by: ["status"],
      where,
      _count: { _all: true },
      _sum: { total: true },
    }),
    prisma.quote.aggregate({
      where: { ...where, status: { in: ["converted"] } },
      _sum: { total: true },
      _count: { _all: true },
      _avg: { total: true },
    }),
  ]);

  const counts = Object.fromEntries(byStatus.map((b) => [b.status, b._count._all]));
  const sums = Object.fromEntries(byStatus.map((b) => [b.status, Number(b._sum.total ?? 0)]));
  const totalQuotes = byStatus.reduce((s, b) => s + b._count._all, 0);
  const converted = counts.converted || 0;
  const conversionRate = totalQuotes > 0 ? Number(((converted / totalQuotes) * 100).toFixed(2)) : 0;

  return {
    period: { from, to },
    counts,
    sums,
    kpi: {
      totalQuotes,
      approvedAmount: Number(totalsApproved._sum.total ?? 0),
      avgDealSize: Number(totalsApproved._avg.total ?? 0),
      conversionRate,
    },
  };
}

/** Revenue (approved+sent+converted) by day for chart. */
export async function revenueByDay(req: Request) {
  const { from, to } = defaultRange(req.query);
  // admin sees all; manager/employee scoped to their own created quotes for this chart.
  const allScope = can(req.session, P.QUOTE_READ_ALL);
  // Conditional fragment via Prisma.sql so the value stays parameterized.
  const scope = allScope ? Prisma.empty : Prisma.sql`AND "createdById" = ${req.session.userId}`;

  const rows = await prisma.$queryRaw`
      SELECT DATE("createdAt") AS d, COALESCE(SUM("total"), 0)::float AS amount, COUNT(*)::int AS n
      FROM "Quote"
      WHERE "createdAt" >= ${from} AND "createdAt" <= ${to}
        AND "status" IN ('approved','sent','converted')
        AND "deletedAt" IS NULL ${scope}
      GROUP BY 1
      ORDER BY 1 ASC`;
  return { data: rows };
}

/** Top sales by approved amount. */
export async function topSales(req: Request) {
  const { from, to, limit } = { ...defaultRange(req.query), limit: (req.query as any).limit };
  // Only admin sees the company-wide leaderboard; others see just their own row.
  const taScope = can(req.session, P.QUOTE_READ_ALL) ? {} : { createdById: req.session.userId };
  const rows = await prisma.quote.groupBy({
    by: ["createdById"],
    where: { ...taScope, createdAt: { gte: from, lte: to }, status: { in: ["converted"] } },
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
  return {
    data: rows.map((r) => ({
      userId: r.createdById,
      user: uMap[r.createdById] || null,
      amount: Number(r._sum.total ?? 0),
      count: r._count._all,
    })),
  };
}

/** Funnel: count of quotes at each status. */
export async function funnel(req: Request) {
  const scope = quoteScopeWhere(req.session); // admin=all, manager=own, employee=member
  const rows = await prisma.quote.groupBy({
    by: ["status"],
    where: scope,
    _count: { _all: true },
  });
  const order = ["draft", "pending", "approved", "sent", "converted", "rejected", "lost"];
  const map = Object.fromEntries(rows.map((r) => [r.status, r._count._all]));
  return { data: order.map((s) => ({ status: s, count: map[s] || 0 })) };
}
