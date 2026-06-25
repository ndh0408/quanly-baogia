// Tầng SERVICE cho domain Admin (thống kê + dọn rác). Bê NGUYÊN logic THUẦN từ admin.routes.ts.
// LƯU Ý: handler `/backup.dump` GIỮ TRỌN ở route — nó spawn pg_dump + setHeader + pipe stream vào res
// (controller HTTP I/O, không phải logic thuần) nên KHÔNG tách. Service chỉ lo phần trả-dữ-liệu thuần.
// Mẫu theo customerService.ts.
import { prisma } from "../db.js";
import { audit } from "../audit.js";

/** Thống kê dung lượng — đếm theo từng bảng. Hữu ích cho hoạch định dung lượng. */
export async function storageStats(_req) {
  const [users, customers, products, quotes, items, audits, sessions] = await Promise.all([
    prisma.user.count(),
    prisma.customer.count(),
    prisma.product.count(),
    prisma.quote.count(),
    prisma.quoteItem.count(),
    prisma.auditEvent.count(),
    prisma.$queryRaw<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM user_sessions`.catch(() => [{ n: 0 }]),
  ]);
  return {
    users, customers, products, quotes, items,
    auditEvents: audits,
    sessions: sessions[0]?.n ?? 0,
  };
}

/** Hard-delete các bản xoá-mềm cũ hơn N ngày. */
export async function purgeSoftDeleted(req) {
  const { days } = req.body;
  const cutoff = new Date(Date.now() - days * 86_400_000);
  const base = { deletedAt: { lt: cutoff } };

  // Purge in FK-dependency order, and ONLY hard-delete rows that are no longer
  // referenced by any LIVE row. The relation `none` guards prevent two failure
  // modes the old loop had: (1) hard-deleting a soft-deleted Customer/Company/
  // User still referenced by a live Quote would SET NULL / RESTRICT, silently
  // corrupting or failing; (2) errors were swallowed into the result string so
  // a blocked purge looked successful. Quotes cascade (sheets/items/versions/
  // approvals) so they go first and free up the downstream references.
  const result: Record<string, any> = {};
  const steps: [string, any][] = [
    ["quote", base],
    ["quoteTemplate", { ...base, sheets: { none: {} } }],
    ["customer", { ...base, quotes: { none: {} } }],
    ["company", { ...base, quotes: { none: {} }, templates: { none: {} } }],
    ["user", { ...base, createdQuotes: { none: {} }, approvedQuotes: { none: {} }, ownedCustomers: { none: {} }, memberQuotes: { none: {} } }],
  ];
  for (const [model, where] of steps) {
    // Let errors propagate to the global handler (500 + logged) instead of being
    // hidden — a failed purge must be visible, not reported as "done".
    const r = await (prisma as any)[model].deleteMany({ where, hardDelete: true });
    result[model] = r?.count ?? 0;
  }
  await audit(req, "admin.purge", { resource: "system", after: { cutoff, result } });
  return { cutoff, result };
}
