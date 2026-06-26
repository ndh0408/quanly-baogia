import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { asyncHandler } from "../middleware.js";
import { requirePermission, PERMISSIONS } from "../permissions.js";
import { validate } from "../validators.js";
import { audit } from "../audit.js";
import { logger } from "../logger.js";
import { config } from "../config.js";
import { createLimiter } from "../rateLimit.js";
import * as svc from "../services/adminService.js";

const router = Router();
// Sao lưu/dọn dữ liệu (thao tác hệ thống nhạy cảm) = quyền settings:manage (per-user; admin luôn có).
router.use(requirePermission(PERMISSIONS.SETTINGS_MANAGE));

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
  asyncHandler(async (req: Request, res: Response) => {
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
      let exit: number | null = null, closed = false, flushed = false;
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
router.get("/stats", asyncHandler(async (req: Request, res: Response) => res.json(await svc.storageStats(req))));

/** Hard-delete soft-deleted rows older than N days. */
router.post(
  "/purge-soft-deleted",
  validate({ body: z.object({ days: z.coerce.number().int().min(0).max(3650).default(30) }).default({} as any) }),
  asyncHandler(async (req: Request, res: Response) => res.json(await svc.purgeSoftDeleted(req)))
);

export default router;
