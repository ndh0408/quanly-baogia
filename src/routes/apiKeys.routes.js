import { Router } from "express";
import { z } from "zod";
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "../db.js";
import { asyncHandler, requireRole } from "../middleware.js";
import { validate } from "../validators.js";
import { audit } from "../audit.js";

const router = Router();
router.use(requireRole("admin"));

const SCOPES = [
  "quotes:read", "quotes:write",
  "customers:read", "customers:write",
  "products:read", "products:write",
  "analytics:read",
];

const Create = z.object({
  name: z.string().min(1).max(80),
  scopes: z.array(z.enum(SCOPES)).min(1),
  expiresAt: z.coerce.date().optional().nullable(),
});

router.get("/scopes", (_req, res) => res.json({ scopes: SCOPES }));

router.get("/", asyncHandler(async (_req, res) => {
  const rows = await prisma.apiKey.findMany({
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, prefix: true, scopes: true, active: true, lastUsedAt: true, expiresAt: true, createdAt: true },
  });
  res.json(rows);
}));

router.post(
  "/",
  validate({ body: Create }),
  asyncHandler(async (req, res) => {
    const plain = "qly_" + randomBytes(24).toString("base64url");
    const prefix = plain.slice(0, 12);
    const keyHash = createHash("sha256").update(plain).digest("hex");
    const row = await prisma.apiKey.create({
      data: {
        name: req.body.name,
        prefix,
        keyHash,
        scopes: req.body.scopes,
        expiresAt: req.body.expiresAt || null,
        createdById: req.session.userId,
      },
    });
    await audit(req, "apikey.create", { resource: "apikey", resourceId: row.id, after: { name: row.name, scopes: row.scopes } });
    // Return plain key ONCE. Caller must store it; server only has the hash from now on.
    res.status(201).json({ id: row.id, name: row.name, prefix, scopes: row.scopes, key: plain });
  })
);

router.delete(
  "/:id",
  validate({ params: z.object({ id: z.coerce.number().int().positive() }) }),
  asyncHandler(async (req, res) => {
    await prisma.apiKey.update({ where: { id: req.params.id }, data: { active: false } });
    await audit(req, "apikey.revoke", { resource: "apikey", resourceId: req.params.id });
    res.json({ ok: true });
  })
);

export default router;
