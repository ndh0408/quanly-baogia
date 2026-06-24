import { Router } from "express";
import { z } from "zod";
import multer from "multer";
import { randomBytes } from "node:crypto";
import { prisma } from "../db.js";
import { asyncHandler, requireAuth, requireRole } from "../middleware.js";
import { validate } from "../validators.js";
import { putObject, presignDownload, presignUpload, deleteObject, isStorageEnabled } from "../storage.js";
import { audit } from "../audit.js";
import { canOnQuote } from "../permissions.js";

const router = Router();
router.use(requireAuth);

// Allowlist of accepted upload types. The client-supplied MIME/extension is NOT
// trusted — we verify the file's magic bytes and derive a safe extension here.
const ALLOWED_TYPES = new Map([
  ["image/png", { ext: ".png", sniff: (b) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 }],
  ["image/jpeg", { ext: ".jpg", sniff: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff }],
  ["image/webp", { ext: ".webp", sniff: (b) => b.length > 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP" }],
  ["application/pdf", { ext: ".pdf", sniff: (b) => b.length > 4 && b.toString("ascii", 0, 5) === "%PDF-" }],
  // xlsx/docx are zip containers (PK\x03\x04)
  ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", { ext: ".xlsx", sniff: (b) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04 }],
]);
const ALLOWED_MIME_VALUES = [...ALLOWED_TYPES.keys()];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 }, // 10 MB, single file
  fileFilter: (_req, file, cb) => cb(null, ALLOWED_TYPES.has(file.mimetype)),
});

/** Resolve the real type by magic bytes; returns the allowlisted MIME+ext or null. */
function sniffType(buffer, declaredMime) {
  const spec = ALLOWED_TYPES.get(declaredMime);
  if (spec && spec.sniff(buffer)) return { mime: declaredMime, ext: spec.ext };
  // declared type didn't match content — try every allowlisted sniffer
  for (const [mime, s] of ALLOWED_TYPES) {
    if (s.sniff(buffer)) return { mime, ext: s.ext };
  }
  return null;
}

/**
 * Key-namespace authorization. The bucket has no per-object owner model, so
 * access derives from the key's namespace:
 *   logos/...                 — company logos, rendered app-wide → any user may read
 *   exports/<quoteNumber>-... — quote exports → caller must be able to read that quote
 *   uploads/u<userId>/...     — user uploads → owner (or admin) only
 *   anything else             — admin only (legacy keys, infra objects)
 * Uploads are NEVER signed for arbitrary keys: the server generates the key
 * inside the caller's own namespace, so no one can overwrite foreign objects.
 */
async function canAccessKey(session, key) {
  // Canonicalize-guard FIRST: a key like "logos/../uploads/u2/secret" would pass
  // a naive startsWith("logos/") and leak another namespace. Reject any key with
  // traversal/confusing segments before the prefix checks below.
  if (
    typeof key !== "string" ||
    key.length === 0 ||
    key.startsWith("/") ||
    key.includes("..") ||
    key.includes("//") ||
    key.includes("\\") ||
    key.includes("\0")
  ) {
    return false;
  }
  if (session.role === "admin") return true;
  if (key.startsWith("logos/")) return true;
  if (key.startsWith(`uploads/u${session.userId}/`)) return true;
  if (key.startsWith("exports/")) {
    const m = key.match(/^exports\/(.+)-\d+\.(xlsx|pdf)$/);
    if (!m) return false;
    const quote = await prisma.quote.findFirst({
      where: { quoteNumber: m[1] },
      include: { members: { select: { id: true } } },
    });
    return !!quote && canOnQuote(session, "read", quote);
  }
  return false;
}

function userUploadKey(session, ext = "") {
  return `uploads/u${session.userId}/${Date.now()}-${randomBytes(6).toString("hex")}${ext}`;
}

/** POST /api/files - multipart upload, returns object key + signed download URL. */
router.post(
  "/",
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!isStorageEnabled()) return res.status(503).json({ error: "Chưa cấu hình lưu trữ tệp" });
    if (!req.file) return res.status(400).json({ error: "Vui lòng chọn tệp để tải lên" });
    // Verify content by magic bytes — never trust the client MIME/extension.
    const sniffed = sniffType(req.file.buffer, req.file.mimetype);
    if (!sniffed) {
      return res.status(415).json({ error: "Loại file không được phép (chỉ PNG/JPG/WEBP/PDF/XLSX)" });
    }
    const key = userUploadKey(req.session, sniffed.ext);
    await putObject({
      key,
      body: req.file.buffer,
      contentType: sniffed.mime,          // allowlisted type, not the client's
      contentDisposition: "attachment",    // never render inline
      metadata: { originalName: encodeURIComponent(req.file.originalname).slice(0, 200), uploadedBy: String(req.session.userId) },
    });
    const url = await presignDownload(key, { expiresIn: 3600 });
    await audit(req, "file.upload", { resource: "file", resourceId: key, after: { size: req.file.size, ct: sniffed.mime } });
    res.status(201).json({ key, url, size: req.file.size, contentType: sniffed.mime });
  })
);

/** GET /api/files/sign-download?key=... → signed URL (only for keys the caller may read). */
router.get(
  "/sign-download",
  validate({ query: z.object({ key: z.string().min(1).max(500), expires: z.coerce.number().int().min(60).max(86400).default(3600) }) }),
  asyncHandler(async (req, res) => {
    if (!isStorageEnabled()) return res.status(503).json({ error: "Chưa cấu hình lưu trữ tệp" });
    if (!(await canAccessKey(req.session, req.query.key))) {
      return res.status(403).json({ error: "Bạn không có quyền với file này" });
    }
    const url = await presignDownload(req.query.key, { expiresIn: req.query.expires });
    res.json({ url, expiresIn: req.query.expires });
  })
);

/**
 * POST /api/files/sign-upload — client-side direct upload (mobile/SDK).
 * The key is ALWAYS server-generated inside the caller's own namespace;
 * accepting a client-chosen key would let any user overwrite foreign objects.
 */
router.post(
  "/sign-upload",
  validate({ body: z.object({
    // Only allowlisted, display-safe content types — never text/html or svg.
    contentType: z.enum(ALLOWED_MIME_VALUES, { error: "Định dạng tệp không được hỗ trợ" }),
    expires: z.coerce.number().int().min(60).max(3600).default(900),
  }) }),
  asyncHandler(async (req, res) => {
    if (!isStorageEnabled()) return res.status(503).json({ error: "Chưa cấu hình lưu trữ tệp" });
    const ext = ALLOWED_TYPES.get(req.body.contentType).ext;
    const key = userUploadKey(req.session, ext);
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
