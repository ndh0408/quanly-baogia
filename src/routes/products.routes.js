import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { asyncHandler, requireAuth } from "../middleware.js";
import { validate } from "../validators.js";
import { audit } from "../audit.js";
import { D } from "../money.js";
import { can, requirePermission, PERMISSIONS as P } from "../permissions.js";

const router = Router();
router.use(requireAuth);

const idParam = z.object({ id: z.coerce.number().int().positive() });

const PriceTier = z.object({
  name: z.string().min(1).max(40),
  minQty: z.coerce.number().int().min(0).default(0),
  price: z.coerce.number().nonnegative(),
});

const Create = z.object({
  sku: z.string().min(1).max(60),
  name: z.string().min(1).max(200),
  category: z.string().max(80).optional().nullable(),
  unit: z.string().max(40).optional().nullable(),
  costPrice: z.coerce.number().nonnegative().default(0),
  basePrice: z.coerce.number().nonnegative().default(0),
  description: z.string().max(2000).optional().nullable(),
  active: z.boolean().default(true),
  priceTiers: z.array(PriceTier).max(10).default([]),
});

const Update = Create.partial();

const ListQuery = z.object({
  q: z.string().max(200).optional(),
  category: z.string().max(80).optional(),
  active: z.coerce.boolean().optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(config.MAX_PAGE_SIZE).default(20),
  sort: z.enum(["name", "sku", "createdAt", "basePrice"]).default("name"),
  order: z.enum(["asc", "desc"]).default("asc"),
});

function present(p, { showCost = false } = {}) {
  const out = {
    ...p,
    basePrice: Number(p.basePrice),
    priceTiers: (p.priceTiers || []).map((t) => ({ ...t, price: Number(t.price) })),
  };
  // Cost price & margin are confidential — only expose to product:read:cost holders.
  if (showCost) {
    out.costPrice = Number(p.costPrice);
    out.margin = p.basePrice && p.costPrice
      ? Number(((p.basePrice - p.costPrice) / p.basePrice * 100).toFixed(2))
      : null;
  } else {
    delete out.costPrice;
  }
  return out;
}

router.get(
  "/",
  validate({ query: ListQuery }),
  asyncHandler(async (req, res) => {
    const { q, category, active, page, size, sort, order } = req.query;
    const where = {};
    if (category) where.category = category;
    if (active !== undefined) where.active = active;
    if (q) {
      where.OR = [
        { sku: { contains: q, mode: "insensitive" } },
        { name: { contains: q, mode: "insensitive" } },
      ];
    }
    const [total, data] = await Promise.all([
      prisma.product.count({ where }),
      prisma.product.findMany({
        where,
        orderBy: { [sort]: order },
        skip: (page - 1) * size,
        take: size,
        include: { priceTiers: { orderBy: { minQty: "asc" } } },
      }),
    ]);
    const showCost = can(req.session, P.PRODUCT_READ_COST);
    res.json({ data: data.map((p) => present(p, { showCost })), meta: { total, page, size, pageCount: Math.ceil(total / size) } });
  })
);

router.get("/categories", asyncHandler(async (_req, res) => {
  const rows = await prisma.product.findMany({
    where: { category: { not: null } },
    select: { category: true },
    distinct: ["category"],
  });
  res.json(rows.map((r) => r.category).filter(Boolean).sort());
}));

router.post(
  "/",
  requirePermission(P.PRODUCT_MANAGE),
  validate({ body: Create }),
  asyncHandler(async (req, res) => {
    const { priceTiers, ...rest } = req.body;
    // includeDeleted: sku is unique across soft-deleted rows too, so a plain check
    // would miss a deleted holder and surface the DB constraint as a 500.
    const dup = await prisma.product.findFirst({ where: { sku: rest.sku }, includeDeleted: true });
    if (dup) return res.status(409).json({ error: dup.deletedAt ? "SKU thuộc sản phẩm đã xoá" : "SKU đã tồn tại" });

    const product = await prisma.product.create({
      data: {
        ...rest,
        costPrice: D(rest.costPrice),
        basePrice: D(rest.basePrice),
        priceTiers: { create: priceTiers.map((t) => ({ name: t.name, minQty: t.minQty, price: D(t.price) })) },
      },
      include: { priceTiers: true },
    });
    await audit(req, "product.create", { resource: "product", resourceId: product.id, after: present(product, { showCost: true }) });
    res.status(201).json(present(product, { showCost: true }));
  })
);

router.get(
  "/:id",
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const p = await prisma.product.findFirst({
      where: { id: req.params.id },
      include: { priceTiers: { orderBy: { minQty: "asc" } } },
    });
    if (!p) return res.status(404).json({ error: "Không tìm thấy" });
    res.json(present(p, { showCost: can(req.session, P.PRODUCT_READ_COST) }));
  })
);

router.put(
  "/:id",
  requirePermission(P.PRODUCT_MANAGE),
  validate({ params: idParam, body: Update }),
  asyncHandler(async (req, res) => {
    const { priceTiers, ...rest } = req.body;
    const before = await prisma.product.findFirst({ where: { id: req.params.id } });
    if (!before) return res.status(404).json({ error: "Không tìm thấy" });

    const data = { ...rest };
    if (rest.costPrice !== undefined) data.costPrice = D(rest.costPrice);
    if (rest.basePrice !== undefined) data.basePrice = D(rest.basePrice);

    const product = await prisma.$transaction(async (tx) => {
      if (priceTiers !== undefined) {
        await tx.productPriceTier.deleteMany({ where: { productId: req.params.id } });
      }
      return tx.product.update({
        where: { id: req.params.id },
        data: {
          ...data,
          ...(priceTiers !== undefined
            ? { priceTiers: { create: priceTiers.map((t) => ({ name: t.name, minQty: t.minQty, price: D(t.price) })) } }
            : {}),
        },
        include: { priceTiers: { orderBy: { minQty: "asc" } } },
      });
    });
    await audit(req, "product.update", { resource: "product", resourceId: product.id });
    res.json(present(product, { showCost: true }));
  })
);

router.delete(
  "/:id",
  requirePermission(P.PRODUCT_MANAGE),
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const before = await prisma.product.findFirst({ where: { id: req.params.id } });
    if (!before) return res.status(404).json({ error: "Không tìm thấy" });
    await prisma.product.delete({ where: { id: req.params.id } }); // soft delete (db.js middleware)
    await audit(req, "product.delete", { resource: "product", resourceId: req.params.id });
    res.json({ ok: true });
  })
);

export default router;
