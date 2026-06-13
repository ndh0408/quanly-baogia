import { Router } from "express";
import { z } from "zod";
import { spawn } from "node:child_process";
import { prisma } from "../db.js";
import { asyncHandler, requireRole } from "../middleware.js";
import { validate } from "../validators.js";
import { audit } from "../audit.js";
import { logger } from "../logger.js";
import { config } from "../config.js";

const router = Router();
router.use(requireRole("admin"));

/**
 * Stream a pg_dump archive of the application database as the HTTP response.
 *
 * Requires `pg_dump` on PATH. Compatible with the postgres-alpine image
 * (which doesn't ship client tools) so deploy this from a sidecar OR use
 * a managed-DB snapshot mechanism instead.
 */
router.get(
  "/backup.dump",
  asyncHandler(async (req, res) => {
    const url = new URL(config.DATABASE_URL);
    const dbName = url.pathname.replace(/^\//, "");
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="quanly-${new Date().toISOString().replace(/[:.]/g, "-")}.dump"`);

    const env = {
      ...process.env,
      PGHOST: url.hostname,
      PGPORT: url.port || "5432",
      PGUSER: decodeURIComponent(url.username),
      PGPASSWORD: decodeURIComponent(url.password),
      PGDATABASE: dbName,
    };
    const proc = spawn("pg_dump", ["-Fc", "--no-owner", "--no-acl"], { env });

    proc.stdout.pipe(res);
    let err = "";
    proc.stderr.on("data", (b) => (err += b.toString()));
    proc.on("close", (code) => {
      if (code !== 0) {
        logger.error({ code, err }, "pg_dump failed");
        if (!res.headersSent) res.status(500).json({ error: "pg_dump failed: " + err });
      }
    });
    proc.on("error", (e) => {
      logger.error({ err: e.message }, "pg_dump spawn error");
      if (!res.headersSent) res.status(500).json({ error: "pg_dump not available: " + e.message });
    });

    await audit(req, "admin.backup", { resource: "system", resourceId: "db" });
  })
);

/** Storage stats — counts per table. Useful for capacity planning. */
router.get(
  "/stats",
  asyncHandler(async (_req, res) => {
    const [users, customers, products, quotes, items, audits, sessions] = await Promise.all([
      prisma.user.count(),
      prisma.customer.count(),
      prisma.product.count(),
      prisma.quote.count(),
      prisma.quoteItem.count(),
      prisma.auditEvent.count(),
      prisma.$queryRaw`SELECT COUNT(*)::int AS n FROM user_sessions`.catch(() => [{ n: 0 }]),
    ]);
    res.json({
      users, customers, products, quotes, items,
      auditEvents: audits,
      sessions: sessions[0]?.n ?? 0,
    });
  })
);

/** Hard-delete soft-deleted rows older than N days. */
router.post(
  "/purge-soft-deleted",
  validate({ body: z.object({ days: z.coerce.number().int().min(0).max(3650).default(30) }).default({}) }),
  asyncHandler(async (req, res) => {
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
    const result = {};
    const steps = [
      ["quote", base],
      ["quoteTemplate", { ...base, sheets: { none: {} } }],
      ["customer", { ...base, quotes: { none: {} } }],
      ["company", { ...base, quotes: { none: {} }, templates: { none: {} } }],
      ["user", { ...base, createdQuotes: { none: {} }, approvedQuotes: { none: {} }, ownedCustomers: { none: {} }, memberQuotes: { none: {} } }],
    ];
    for (const [model, where] of steps) {
      // Let errors propagate to the global handler (500 + logged) instead of being
      // hidden — a failed purge must be visible, not reported as "done".
      const r = await prisma[model].deleteMany({ where, hardDelete: true });
      result[model] = r?.count ?? 0;
    }
    await audit(req, "admin.purge", { resource: "system", after: { cutoff, result } });
    res.json({ cutoff, result });
  })
);

export default router;
