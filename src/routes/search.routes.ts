// Cross-entity search KHÔNG dấu / sai dấu: khớp trên cột searchText (chuẩn-hóa bởi normalizeSearch)
// có GIN trigram index (pg_trgm) → nhanh ở quy mô lớn. Product vẫn ILIKE (chưa có cột searchText).

import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { asyncHandler, requireAuth } from "../middleware.js";
import { validate } from "../validators.js";
import { can, quoteScopeWhere, PERMISSIONS as P } from "../permissions.js";
import { normalizeSearch } from "../searchText.js";

const router = Router();
router.use(requireAuth);

const Query = z.object({
  q: z.string().min(1, "Vui lòng nhập từ khóa tìm kiếm").max(200, "Từ khóa tối đa 200 ký tự"),
  types: z.string().max(120).optional(),     // csv: quote,customer,product
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

router.get(
  "/",
  validate({ query: Query }),
  asyncHandler(async (req: Request, res: Response) => {
    const q = (req.query as unknown as z.infer<typeof Query>).q.trim();
    const types = ((req.query as unknown as z.infer<typeof Query>).types || "quote,customer,product").split(",").map((s: string) => s.trim());
    const limit = (req.query as unknown as z.infer<typeof Query>).limit;

    const out: { query: string; results: Record<string, any> } = { query: q, results: {} };

    const tasks: Promise<void>[] = [];
    if (types.includes("quote")) {
      tasks.push((async () => {
        const rows = await prisma.quote.findMany({
          where: {
            AND: [
              quoteScopeWhere(req.session),
              { searchText: { contains: normalizeSearch(q) } },
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
              { searchText: { contains: normalizeSearch(q) } },
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
