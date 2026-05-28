import { Router } from "express";
import { z } from "zod";
import multer from "multer";
import { randomBytes } from "node:crypto";
import { asyncHandler, requireAuth, requireRole } from "../middleware.js";
import { validate } from "../validators.js";
import { putObject, presignDownload, presignUpload, deleteObject, isStorageEnabled } from "../storage.js";
import { audit } from "../audit.js";

const router = Router();
router.use(requireAuth);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

/** POST /api/files - multipart upload, returns object key + signed download URL. */
router.post(
  "/",
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!isStorageEnabled()) return res.status(503).json({ error: "Storage chưa cấu hình" });
    if (!req.file) return res.status(400).json({ error: "Thiếu file" });
    const folder = (req.body.folder || "uploads").replace(/[^a-z0-9/_-]/gi, "");
    const ext = (req.file.originalname.match(/\.[^.]+$/)?.[0] || "").toLowerCase();
    const key = `${folder}/${Date.now()}-${randomBytes(6).toString("hex")}${ext}`;
    await putObject({
      key,
      body: req.file.buffer,
      contentType: req.file.mimetype,
      metadata: { originalName: encodeURIComponent(req.file.originalname), uploadedBy: String(req.session.userId) },
    });
    const url = await presignDownload(key, { expiresIn: 3600 });
    await audit(req, "file.upload", { resource: "file", resourceId: key, after: { size: req.file.size, ct: req.file.mimetype } });
    res.status(201).json({ key, url, size: req.file.size, contentType: req.file.mimetype });
  })
);

/** GET /api/files/sign-download?key=... → signed URL. */
router.get(
  "/sign-download",
  validate({ query: z.object({ key: z.string().min(1).max(500), expires: z.coerce.number().int().min(60).max(86400).default(3600) }) }),
  asyncHandler(async (req, res) => {
    if (!isStorageEnabled()) return res.status(503).json({ error: "Storage chưa cấu hình" });
    const url = await presignDownload(req.query.key, { expiresIn: req.query.expires });
    res.json({ url, expiresIn: req.query.expires });
  })
);

/** POST /api/files/sign-upload — client-side direct upload (mobile/SDK). */
router.post(
  "/sign-upload",
  validate({ body: z.object({
    key: z.string().min(1).max(500).optional(),
    folder: z.string().max(200).default("uploads"),
    contentType: z.string().max(120),
    expires: z.coerce.number().int().min(60).max(3600).default(900),
  }) }),
  asyncHandler(async (req, res) => {
    if (!isStorageEnabled()) return res.status(503).json({ error: "Storage chưa cấu hình" });
    const key = req.body.key || `${req.body.folder}/${Date.now()}-${randomBytes(8).toString("hex")}`;
    const url = await presignUpload({ key, contentType: req.body.contentType, expiresIn: req.body.expires });
    res.json({ key, url, expiresIn: req.body.expires });
  })
);

router.delete(
  "/",
  requireRole("admin"),
  validate({ query: z.object({ key: z.string().min(1).max(500) }) }),
  asyncHandler(async (req, res) => {
    await deleteObject(req.query.key);
    await audit(req, "file.delete", { resource: "file", resourceId: req.query.key });
    res.json({ ok: true });
  })
);

export default router;
