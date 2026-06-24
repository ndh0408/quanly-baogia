import { Router } from "express";
import { z } from "zod";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { prisma } from "../db.js";
import { asyncHandler, requireRole } from "../middleware.js";
import { validate } from "../validators.js";
import { audit } from "../audit.js";
import { logger } from "../logger.js";
import { config } from "../config.js";
import { createLimiter } from "../rateLimit.js";

const router = Router();
router.use(requireRole("admin"));

// Tight limiter on the full-DB dump — expensive + highly sensitive, kept separate
// from the generic API limiter (a stolen admin session shouldn't be able to pull
// the whole DB on a loop).
const backupLimiter = createLimiter("backup", { windowMs: 15 * 60 * 1000, max: 5 });

/**
 * Stream a pg_dump archive of the application database as the HTTP response.
 *
 * Requires `pg_dump` on PATH. Compatible with the postgres-alpine image
 * (which doesn't ship client tools) so deploy this from a sidecar OR use
 * a managed-DB snapshot mechanism instead.
 *
 * The dump is written to a temp file FIRST and only streamed (with 200 + download
 * headers) AFTER pg_dump exits 0. Streaming straight to the response flushed HTTP
 * 200 on the first chunk, so a mid-dump failure delivered a TRUNCATED archive as a
 * "successful" download — a silent-corrupt-backup hazard. On failure we return 500
 * and never record the audit success.
 */
router.get(
  "/backup.dump",
  backupLimiter,
  asyncHandler(async (req, res) => {
    const url = new URL(config.DATABASE_URL);
    const dbName = url.pathname.replace(/^\//, "");
    const env = {
      ...process.env,
      PGHOST: url.hostname,
      PGPORT: url.port || "5432",
      PGUSER: decodeURIComponent(url.username),
      PGPASSWORD: decodeURIComponent(url.password),
      PGDATABASE: dbName,
    };
    const tmp = path.join(os.tmpdir(), `quanly-backup-${Date.now()}-${process.pid}.dump`);
    const out = fs.createWriteStream(tmp);
    const cleanup = () => fs.promises.unlink(tmp).catch(() => {});

    const proc = spawn("pg_dump", ["-Fc", "--no-owner", "--no-acl"], { env });
    let err = "";
    proc.stderr.on("data", (b) => (err += b.toString()));
    proc.stdout.pipe(out);

    // Resolve with the exit code only after BOTH pg_dump closed AND the temp file
    // flushed; resolve -1 on any spawn/write error.
    const code = await new Promise((resolve) => {
      let exit = null, closed = false, flushed = false;
      const settle = () => { if (closed && flushed) resolve(exit); };
      proc.on("close", (c) => { exit = c; closed = true; settle(); });
      proc.on("error", (e) => { err = err || e.message; resolve(-1); });
      out.on("finish", () => { flushed = true; settle(); });
      out.on("error", (e) => { err = err || e.message; resolve(-1); });
    });

    if (code !== 0) {
      logger.error({ code, err }, "pg_dump failed");
      await cleanup();
      return res.status(500).json({ error: "Sao lưu thất bại (pg_dump)." });
    }

    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="quanly-${new Date().toISOString().replace(/[:.]/g, "-")}.dump"`);
    res.setHeader("Content-Length", (await fs.promises.stat(tmp)).size);
    await audit(req, "admin.backup", { resource: "system", resourceId: "db" });
    const stream = fs.createReadStream(tmp);
    stream.on("close", cleanup);
    stream.on("error", cleanup);
    stream.pipe(res);
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
  validate({ body: z.object({ days: z.coerce.number().int().min(0).max(3650).default(30) }).default({} as any) }),
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
    res.json({ cutoff, result });
  })
);

export default router;
