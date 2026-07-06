// Tầng SERVICE cho tìm kiếm toàn cục đa thực thể — bê NGUYÊN logic từ search.routes.ts, hành vi y hệt.
// KHÔNG dấu / sai dấu: khớp trên cột searchText (chuẩn-hóa bởi normalizeSearch) có GIN trigram index
// (pg_trgm) → nhanh ở quy mô lớn. Product vẫn ILIKE (chưa có cột searchText).
import type { Request } from "express";
import { prisma } from "../db.js";
import { can, quoteScopeWhere, PERMISSIONS as P } from "../permissions.js";
import { searchTextFilter } from "../searchText.js";

export async function globalSearch(req: Request) {
  const query = req.query as { q?: string; types?: string; limit?: unknown };
  const q = String(query.q || "").trim();
  const types = (query.types || "quote,customer,product").split(",").map((s: string) => s.trim());
  const limit = Number(query.limit);

  const out: { query: string; results: Record<string, any> } = { query: q, results: {} };

  const tasks: Promise<void>[] = [];
  if (types.includes("quote")) {
    // PHÂN QUYỀN THEO PROJECTION: các vai trò "chỉ nội bộ" (account_hn qua quote:hn:fill, tài khoản
    // chi phí qua quote:internal:view) TUYỆT ĐỐI không được thấy tên khách (toCompany) + giá bán (total).
    // Mọi route đọc quote khác đã lược 2 trường này qua presentQuote/presentQuoteRow; search PHẢI khớp,
    // nếu không sẽ rò đúng dữ liệu thương mại mà presentQuoteForAccountHn được xây để che.
    const hnOrInternal = can(req.session, P.QUOTE_HN_FILL) || can(req.session, P.QUOTE_INTERNAL_VIEW);
    tasks.push((async () => {
      const rows = await prisma.quote.findMany({
        where: {
          AND: [
            quoteScopeWhere(req.session),
            { searchText: searchTextFilter(q) },
          ],
        },
        select: hnOrInternal
          ? { id: true, quoteNumber: true, projectCode: true, title: true, status: true, createdAt: true }
          : { id: true, quoteNumber: true, projectCode: true, title: true, toCompany: true, status: true, total: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: limit,
      });
      out.results.quotes = rows.map((r) => ("total" in r ? { ...r, total: Number(r.total) } : r));
    })());
  }
  if (types.includes("customer")) {
    const custScope = can(req.session, P.CUSTOMER_READ_ALL) ? {} : { ownerId: req.session.userId };
    tasks.push((async () => {
      const rows = await prisma.customer.findMany({
        where: {
          AND: [
            custScope,
            { searchText: searchTextFilter(q) },
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
  return out;
}
