// Cross-entity search using Postgres ILIKE + simple_unaccent normalization.
// For larger scale, swap to Meilisearch / Postgres tsvector with GIN index;
// this module is the API contract that those backends would implement.

import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { asyncHandler, requireAuth } from "../middleware.js";
import { validate } from "../validators.js";
import { can, quoteScopeWhere, PERMISSIONS as P } from "../permissions.js";

const router = Router();
router.use(requireAuth);

const Query = z.object({
  q: z.string().min(1).max(200),
  types: z.string().max(120).optional(),     // csv: quote,customer,product
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

router.get(
  "/",
  validate({ query: Query }),
  asyncHandler(async (req, res) => {
    const q = req.query.q.trim();
    const types = (req.query.types || "quote,customer,product").split(",").map((s) => s.trim());
    const limit = req.query.limit;

    const out = { query: q, results: {} };

    const tasks = [];
    if (types.includes("quote")) {
      tasks.push((async () => {
        const rows = await prisma.quote.findMany({
          where: {
            AND: [
              quoteScopeWhere(req.session),
              { OR: [
                { quoteNumber: { contains: q, mode: "insensitive" } },
                { projectCode: { contains: q, mode: "insensitive" } },
                { title: { contains: q, mode: "insensitive" } },
                { toCompany: { contains: q, mode: "insensitive" } },
                { toContact: { contains: q, mode: "insensitive" } },
              ] },
            ],
          },
          select: { id: true, quoteNumber: true, projectCode: true, title: true, toCompany: true, status: true, total: true, createdAt: true },
          orderBy: { createdAt: "desc" },
          take: limit,
        });
        out.results.quotes = rows.map((r) => ({ ...r, total: Number(r.total) }));
      })());
    }
    if (types.includes("customer")) {
      const custScope = can(req.session, P.CUSTOMER_READ_ALL) ? {} : { ownerId: req.session.userId };
      tasks.push((async () => {
        const rows = await prisma.customer.findMany({
          where: {
            AND: [
              custScope,
              { OR: [
                { code: { contains: q, mode: "insensitive" } },
                { name: { contains: q, mode: "insensitive" } },
                { phone: { contains: q } },
                { email: { contains: q, mode: "insensitive" } },
                { taxCode: { contains: q } },
                { contactName: { contains: q, mode: "insensitive" } },
              ] },
            ],
          },
          select: { id: true, code: true, name: true, phone: true, email: true, status: true },
          take: limit,
        });
        out.results.customers = rows;
      })());
    }
    if (types.includes("product")) {
      tasks.push((async () => {
        const rows = await prisma.product.findMany({
          where: {
            OR: [
              { sku: { contains: q, mode: "insensitive" } },
              { name: { contains: q, mode: "insensitive" } },
              { category: { contains: q, mode: "insensitive" } },
            ],
          },
          select: { id: true, sku: true, name: true, category: true, basePrice: true, unit: true },
          take: limit,
        });
        out.results.products = rows.map((r) => ({ ...r, basePrice: Number(r.basePrice) }));
      })());
    }

    await Promise.all(tasks);
    res.json(out);
  })
);

export default router;
