// Tầng SERVICE cho tìm kiếm toàn cục đa thực thể — bê NGUYÊN logic từ search.routes.ts, hành vi y hệt.
// KHÔNG dấu / sai dấu: khớp trên cột searchText (chuẩn-hóa bởi normalizeSearch) có GIN trigram index
// (pg_trgm) → nhanh ở quy mô lớn. Product vẫn ILIKE (chưa có cột searchText).
import type { Request } from "express";
import { prisma } from "../db.js";
import { can, quoteScopeWhere, readScopeWhere, PERMISSIONS as P } from "../permissions.js";
import { searchTextFilter } from "../searchText.js";

/**
 * Tìm kiếm toàn cục — PHÂN QUYỀN THEO TỪNG DOMAIN ở SERVER.
 *
 * 🔒 Lọc ở frontend KHÔNG phải bảo mật. Mỗi nhóm kết quả chỉ được truy vấn khi phiên có quyền đọc
 * đúng domain đó; thiếu quyền thì nhóm ấy KHÔNG xuất hiện trong `results` (deny by default), kèm
 * tên nhóm trong `denied` để UI giải thích. Trước đây `product` KHÔNG có cổng quyền nào — mọi tài
 * khoản đăng nhập (kế toán/nhân sự/account HN) gõ `?types=product` là đọc được cả bảng giá kèm
 * `basePrice`; `customer` thì rơi thẳng xuống phạm vi own dù không có quyền khách hàng nào.
 */
export async function globalSearch(req: Request) {
  const query = req.query as { q?: string; types?: string; limit?: unknown };
  const q = String(query.q || "").trim();
  const types = (query.types || "quote,customer,product").split(",").map((s: string) => s.trim());
  const limit = Number(query.limit);

  const out: { query: string; results: Record<string, any>; denied: string[] } = { query: q, results: {}, denied: [] };

  // Phạm vi đọc từng domain (null = KHÔNG có quyền → bỏ nhóm khỏi kết quả).
  const quoteScope = quoteScopeWhere(req.session);
  const custScope = readScopeWhere(req.session, "customer");
  const canProduct = can(req.session, P.PRODUCT_READ);
  if (types.includes("quote") && !quoteScope) out.denied.push("quote");
  if (types.includes("customer") && !custScope) out.denied.push("customer");
  if (types.includes("product") && !canProduct) out.denied.push("product");

  const tasks: Promise<void>[] = [];
  if (types.includes("quote") && quoteScope) {
    // PHÂN QUYỀN THEO PROJECTION: các vai trò "chỉ nội bộ" (account_hn qua quote:hn:fill, tài khoản
    // chi phí qua quote:internal:view) TUYỆT ĐỐI không được thấy tên khách (toCompany) + giá bán (total).
    // Mọi route đọc quote khác đã lược 2 trường này qua presentQuote/presentQuoteRow; search PHẢI khớp,
    // nếu không sẽ rò đúng dữ liệu thương mại mà presentQuoteForAccountHn được xây để che.
    const hnOrInternal = can(req.session, P.QUOTE_HN_FILL) || can(req.session, P.QUOTE_INTERNAL_VIEW);
    tasks.push((async () => {
      const rows = await prisma.quote.findMany({
        where: {
          AND: [
            quoteScope,
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
  if (types.includes("customer") && custScope) {
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
  if (types.includes("product") && canProduct) {
    // Giá VỐN (costPrice) cần quyền riêng product:read:cost — search chỉ trả giá BÁN.
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
