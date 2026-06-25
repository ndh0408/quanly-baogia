import { Router } from "express";
import type { Request, Response } from "express";
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
  asyncHandler(async (req: Request, res: Response) => {
    const { actorId, action, resource, resourceId, from, to } = req.query;
    // page/size đã được validate() coerce sang number runtime (z.coerce.number().default).
    // Number() giữ nguyên giá trị + giữ default cũ (1 / 50) nếu thiếu.
    const page = Number(req.query.page) || 1;
    const size = Number(req.query.size) || 50;
    const where: Record<string, any> = {};
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

    // Least-privilege: the before/after snapshots (and IP/UA) can contain full PII
    // of other users/customers. Only admins see the raw payload; managers get the
    // who/what/when trail with PII stripped.
    const isAdmin = req.session.role === "admin";
    const data = rows.map((r) => {
      if (!isAdmin) {
        // Strip PII-bearing fields for non-admins via destructuring (these props
        // are required on the row type, so `delete` is not permitted under strict).
        const { before, after, ip, userAgent, ...rest } = r;
        return { ...rest, id: r.id.toString() }; // BigInt id → string for JSON
      }
      return { ...r, id: r.id.toString() }; // BigInt id → string for JSON
    });
    res.json({ data, meta: { total, page, size, pageCount: Math.ceil(total / size) } });
  })
);

export default router;
