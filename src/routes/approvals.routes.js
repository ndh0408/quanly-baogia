import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { asyncHandler, requireAuth, requireRole } from "../middleware.js";
import { validate } from "../validators.js";
import { audit } from "../audit.js";
import { D } from "../money.js";

const router = Router();
router.use(requireAuth);

const idParam = z.object({ id: z.coerce.number().int().positive() });

// === Matrix management (admin) ===
const MatrixCreate = z.object({
  name: z.string().min(1).max(80),
  minAmount: z.coerce.number().nonnegative(),
  maxAmount: z.coerce.number().nonnegative().optional().nullable(),
  levels: z.array(
    z.object({
      level: z.coerce.number().int().min(1),
      roles: z.array(z.enum(["admin", "manager", "employee"])).min(1),
      any: z.coerce.number().int().min(1).default(1),
    })
  ).min(1),
  active: z.boolean().default(true),
});

router.get(
  "/matrix",
  asyncHandler(async (_req, res) => {
    const rows = await prisma.approvalMatrix.findMany({ orderBy: { minAmount: "asc" } });
    res.json(rows.map((r) => ({
      ...r,
      minAmount: Number(r.minAmount),
      maxAmount: r.maxAmount != null ? Number(r.maxAmount) : null,
    })));
  })
);

router.post(
  "/matrix",
  requireRole("admin"),
  validate({ body: MatrixCreate }),
  asyncHandler(async (req, res) => {
    const row = await prisma.approvalMatrix.create({
      data: {
        ...req.body,
        minAmount: D(req.body.minAmount),
        maxAmount: req.body.maxAmount != null ? D(req.body.maxAmount) : null,
      },
    });
    await audit(req, "approval.matrix.create", { resource: "approvalMatrix", resourceId: row.id });
    res.status(201).json(row);
  })
);

router.put(
  "/matrix/:id",
  requireRole("admin"),
  validate({ params: idParam, body: MatrixCreate.partial() }),
  asyncHandler(async (req, res) => {
    const data = { ...req.body };
    if (data.minAmount !== undefined) data.minAmount = D(data.minAmount);
    if (data.maxAmount !== undefined && data.maxAmount !== null) data.maxAmount = D(data.maxAmount);
    const row = await prisma.approvalMatrix.update({ where: { id: req.params.id }, data });
    await audit(req, "approval.matrix.update", { resource: "approvalMatrix", resourceId: row.id });
    res.json(row);
  })
);

router.delete(
  "/matrix/:id",
  requireRole("admin"),
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    await prisma.approvalMatrix.delete({ where: { id: req.params.id } });
    await audit(req, "approval.matrix.delete", { resource: "approvalMatrix", resourceId: req.params.id });
    res.json({ ok: true });
  })
);

// === Queue: pending approvals visible to the current user ===
router.get(
  "/queue",
  asyncHandler(async (req, res) => {
    // Show pending approvals where the user's role matches the level's roles config.
    // For simplicity: show all pending if user is admin/manager.
    if (!["admin", "manager"].includes(req.session.role)) {
      return res.json({ data: [], meta: { total: 0 } });
    }
    const rows = await prisma.approval.findMany({
      where: { decision: "pending" },
      orderBy: [{ quoteId: "asc" }, { level: "asc" }],
      take: 100,
      include: { quote: { include: { company: true, createdBy: { select: { displayName: true } } } } },
    });
    res.json({
      data: rows.map((r) => ({
        ...r,
        quote: r.quote ? {
          ...r.quote,
          subtotal: Number(r.quote.subtotal),
          vat: Number(r.quote.vat),
          total: Number(r.quote.total),
          vatPercent: Number(r.quote.vatPercent),
        } : null,
      })),
      meta: { total: rows.length },
    });
  })
);

export default router;
