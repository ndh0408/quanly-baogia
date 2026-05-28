import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { asyncHandler, requireAuth } from "../middleware.js";
import { validate } from "../validators.js";

const router = Router();
router.use(requireAuth);

router.get(
  "/",
  validate({ query: z.object({
    unread: z.coerce.boolean().optional(),
    page: z.coerce.number().int().min(1).default(1),
    size: z.coerce.number().int().min(1).max(100).default(20),
  })}),
  asyncHandler(async (req, res) => {
    const where = { userId: req.session.userId };
    if (req.query.unread) where.readAt = null;
    const [total, rows] = await Promise.all([
      prisma.notification.count({ where }),
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (req.query.page - 1) * req.query.size,
        take: req.query.size,
      }),
    ]);
    res.json({
      data: rows.map((r) => ({ ...r, id: r.id.toString() })),
      meta: { total, page: req.query.page, size: req.query.size, pageCount: Math.ceil(total / req.query.size) },
    });
  })
);

router.get(
  "/unread-count",
  asyncHandler(async (req, res) => {
    const count = await prisma.notification.count({ where: { userId: req.session.userId, readAt: null } });
    res.json({ count });
  })
);

router.post(
  "/:id/read",
  validate({ params: z.object({ id: z.coerce.bigint() }) }),
  asyncHandler(async (req, res) => {
    await prisma.notification.updateMany({
      where: { id: req.params.id, userId: req.session.userId },
      data: { readAt: new Date() },
    });
    res.json({ ok: true });
  })
);

router.post(
  "/read-all",
  asyncHandler(async (req, res) => {
    await prisma.notification.updateMany({
      where: { userId: req.session.userId, readAt: null },
      data: { readAt: new Date() },
    });
    res.json({ ok: true });
  })
);

export default router;
