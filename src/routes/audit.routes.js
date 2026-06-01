import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { asyncHandler } from "../middleware.js";
import { validate } from "../validators.js";
import { requirePermission, PERMISSIONS } from "../permissions.js";

const router = Router();
// Honour the permission map (manager holds audit:view) instead of admin-only,
// so the nav gate (can('audit:view')) and the route agree.
router.use(requirePermission(PERMISSIONS.AUDIT_VIEW));

const Query = z.object({
  actorId: z.coerce.number().int().positive().optional(),
  action: z.string().max(80).optional(),
  resource: z.string().max(40).optional(),
  resourceId: z.string().max(80).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(config.MAX_PAGE_SIZE).default(50),
});

router.get(
  "/",
  validate({ query: Query }),
  asyncHandler(async (req, res) => {
    const { actorId, action, resource, resourceId, from, to, page, size } = req.query;
    const where = {};
    if (actorId) where.actorId = actorId;
    if (action) where.action = action;
    if (resource) where.resource = resource;
    if (resourceId) where.resourceId = resourceId;
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = from;
      if (to) where.createdAt.lte = to;
    }

    const [total, rows] = await Promise.all([
      prisma.auditEvent.count({ where }),
      prisma.auditEvent.findMany({
        where,
        orderBy: { createdAt: "desc" },
        include: { actor: { select: { id: true, username: true, displayName: true } } },
        skip: (page - 1) * size,
        take: size,
      }),
    ]);

    // BigInt ids cannot be JSON-serialized directly
    const data = rows.map((r) => ({ ...r, id: r.id.toString() }));
    res.json({ data, meta: { total, page, size, pageCount: Math.ceil(total / size) } });
  })
);

export default router;
