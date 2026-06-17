import { Router } from "express";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { prisma } from "../db.js";
import { asyncHandler, requireRole } from "../middleware.js";
import { validate } from "../validators.js";
import { audit } from "../audit.js";
import { EVENTS, assertPublicHttpUrl } from "../webhooks.js";

const router = Router();
router.use(requireRole("admin"));

const idParam = z.object({ id: z.coerce.number().int().positive() });

// The HMAC signing secret must not be echoed back on reads. Show only a masked
// hint (last 4 chars); the full secret is returned exactly once on create.
function maskSecret(s) {
  if (!s) return null;
  return s.length <= 4 ? "••••" : "••••" + s.slice(-4);
}
const present = (w) => ({ ...w, secret: maskSecret(w.secret), secretSet: !!w.secret });

const Create = z.object({
  url: z.string().url("Địa chỉ URL không hợp lệ"),
  events: z.array(z.enum(EVENTS)).min(1, "Vui lòng chọn ít nhất 1 sự kiện"),
  secret: z.string().min(16, "Khóa bí mật phải có ít nhất 16 ký tự").optional(),
  active: z.boolean().default(true),
});

router.get("/events", (_req, res) => res.json({ events: EVENTS }));

router.get("/", asyncHandler(async (_req, res) => {
  const rows = await prisma.webhook.findMany({ orderBy: { id: "asc" } });
  res.json(rows.map(present));
}));

router.post(
  "/",
  validate({ body: Create }),
  asyncHandler(async (req, res) => {
    await assertPublicHttpUrl(req.body.url); // reject internal/private targets up front
    const secret = req.body.secret || randomBytes(24).toString("hex");
    const row = await prisma.webhook.create({ data: { ...req.body, secret } });
    await audit(req, "webhook.create", { resource: "webhook", resourceId: row.id });
    res.status(201).json(row);
  })
);

router.put(
  "/:id",
  validate({ params: idParam, body: Create.partial() }),
  asyncHandler(async (req, res) => {
    if (req.body.url) await assertPublicHttpUrl(req.body.url);
    const row = await prisma.webhook.update({ where: { id: req.params.id }, data: req.body });
    await audit(req, "webhook.update", { resource: "webhook", resourceId: row.id });
    res.json(present(row));
  })
);

router.delete(
  "/:id",
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    await prisma.webhook.delete({ where: { id: req.params.id } });
    await audit(req, "webhook.delete", { resource: "webhook", resourceId: req.params.id });
    res.json({ ok: true });
  })
);

router.get(
  "/:id/deliveries",
  validate({ params: idParam, query: z.object({ size: z.coerce.number().int().min(1).max(200).default(50) }) }),
  asyncHandler(async (req, res) => {
    const rows = await prisma.webhookDelivery.findMany({
      where: { webhookId: req.params.id },
      orderBy: { createdAt: "desc" },
      take: req.query.size,
    });
    res.json({ data: rows.map((r) => ({ ...r, id: r.id.toString() })) });
  })
);

export default router;
