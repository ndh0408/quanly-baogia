import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { asyncHandler, requireAuth, requireRole } from "../middleware.js";
import { validate } from "../validators.js";
import { audit } from "../audit.js";

const router = Router();
router.use(requireAuth);

// Settings can hold sensitive integration config (tokens, channels). Only a small
// allowlist of UI-tunable keys is readable by non-admins; the full dump + any other
// key is admin-only — prevents leaking config to every logged-in user.
const PUBLIC_SETTING_KEYS = new Set(["notif.channels"]);

// Full dump = admin only.
router.get(
  "/",
  requireRole("admin"),
  asyncHandler(async (_req, res) => {
    const rows = await prisma.setting.findMany();
    res.json(Object.fromEntries(rows.map((r) => [r.key, r.value])));
  })
);

router.get(
  "/:key",
  validate({ params: z.object({ key: z.string().min(1).max(80) }) }),
  asyncHandler(async (req, res) => {
    if (!PUBLIC_SETTING_KEYS.has(req.params.key) && req.session.role !== "admin") {
      return res.status(403).json({ error: "Không có quyền đọc cấu hình này" });
    }
    const row = await prisma.setting.findUnique({ where: { key: req.params.key } });
    if (!row) return res.status(404).json({ error: "Not found" });
    res.json(row.value);
  })
);

// Write: admin only
router.put(
  "/:key",
  requireRole("admin"),
  validate({ params: z.object({ key: z.string().min(1).max(80) }), body: z.any() }),
  asyncHandler(async (req, res) => {
    const value = req.body;
    const row = await prisma.setting.upsert({
      where: { key: req.params.key },
      create: { key: req.params.key, value },
      update: { value },
    });
    await audit(req, "settings.update", { resource: "setting", resourceId: req.params.key, after: { value } });
    res.json(row.value);
  })
);

router.delete(
  "/:key",
  requireRole("admin"),
  validate({ params: z.object({ key: z.string().min(1).max(80) }) }),
  asyncHandler(async (req, res) => {
    await prisma.setting.delete({ where: { key: req.params.key } }).catch(() => {});
    await audit(req, "settings.delete", { resource: "setting", resourceId: req.params.key });
    res.json({ ok: true });
  })
);

export default router;
