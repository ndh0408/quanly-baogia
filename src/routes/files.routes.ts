import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import multer from "multer";
import { randomBytes } from "node:crypto";
import { prisma } from "../db.js";
import { asyncHandler, requireAuth, requireRole } from "../middleware.js";
import { validate } from "../validators.js";
import { putObject, presignDownload, presignUpload, deleteObject, isStorageEnabled, headObject, getObjectHeadBytes } from "../storage.js";
import { audit } from "../audit.js";
import { canOnQuote } from "../permissions.js";
import { createLimiter } from "../rateLimit.js";

const router = Router();
router.use(requireAuth);

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // giữ CÙNG trần với đường multipart bên dưới

// Ký URL upload là thao tác rẻ với server nhưng mỗi chữ ký = một chỗ ghi vào bucket. Giới hạn riêng
// theo TÀI KHOẢN (không phải IP) để một phiên bị chiếm không xin được hàng nghìn chữ ký rồi bơm đầy
// kho lưu trữ. Đường multipart đã bị chặn bởi limiter API chung + trần 10 MB của multer.
const signLimiter = createLimiter("file-sign", {
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: (req: Request) => `sign:${req.session?.userId}`,
  message: { error: "Quá nhiều yêu cầu tải lên, vui lòng thử lại sau ít phút" },
});

// Allowlist of accepted upload types. The client-supplied MIME/extension is NOT
// trusted — we verify the file's magic bytes and derive a safe extension here.
const ALLOWED_TYPES = new Map([
  ["image/png", { ext: ".png", sniff: (b: Buffer) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 }],
  ["image/jpeg", { ext: ".jpg", sniff: (b: Buffer) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff }],
  ["image/webp", { ext: ".webp", sniff: (b: Buffer) => b.length > 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP" }],
  ["application/pdf", { ext: ".pdf", sniff: (b: Buffer) => b.length > 4 && b.toString("ascii", 0, 5) === "%PDF-" }],
  // xlsx/docx are zip containers (PK\x03\x04)
  ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", { ext: ".xlsx", sniff: (b: Buffer) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04 }],
]);
const ALLOWED_MIME_VALUES = [...ALLOWED_TYPES.keys()];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 }, // 10 MB, single file
  fileFilter: (_req, file, cb) => cb(null, ALLOWED_TYPES.has(file.mimetype)),
});

/** Resolve the real type by magic bytes; returns the allowlisted MIME+ext or null. */
function sniffType(buffer: Buffer, declaredMime: string) {
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
async function canAccessKey(session: Request["session"], key: unknown) {
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

function userUploadKey(session: Request["session"], ext = "") {
  return `uploads/u${session.userId}/${Date.now()}-${randomBytes(6).toString("hex")}${ext}`;
}

/** POST /api/files - multipart upload, returns object key + signed download URL. */
router.post(
  "/",
  upload.single("file"),
  asyncHandler(async (req: Request, res: Response) => {
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
  asyncHandler(async (req: Request, res: Response) => {
    if (!isStorageEnabled()) return res.status(503).json({ error: "Chưa cấu hình lưu trữ tệp" });
    if (!(await canAccessKey(req.session, req.query.key))) {
      return res.status(403).json({ error: "Bạn không có quyền với file này" });
    }
    const url = await presignDownload(req.query.key as string, { expiresIn: (req.query as any).expires });
    res.json({ url, expiresIn: req.query.expires });
  })
);

/**
 * POST /api/files/sign-upload — upload trực tiếp từ client (mobile/SDK). BƯỚC 1/2.
 *
 * Key LUÔN do server sinh trong namespace của chính người gọi — nhận key do client chọn thì ai
 * cũng ghi đè được object của người khác.
 *
 * Đường presigned trước đây BỎ QUA mọi lớp kiểm mà đường multipart có: không trần kích thước, không
 * dò magic bytes, không giới hạn tần suất, và object nằm sẵn trong bucket ngay khi PUT xong. Nay:
 *   • `size` bắt buộc, ≤ 10 MB, và được ĐƯA VÀO CHỮ KÝ (Content-Length) → kho lưu trữ tự từ chối
 *     request khác kích thước, không phụ thuộc thiện chí của client;
 *   • `contentType` nằm trong chữ ký (chỉ kiểu trong allowlist);
 *   • object được đánh dấu `pending=1` và CHƯA DÙNG ĐƯỢC cho tới khi qua /finalize (HEAD + dò
 *     magic bytes). Object chưa finalize không được gắn vào bất kỳ tài nguyên nghiệp vụ nào.
 */
router.post(
  "/sign-upload",
  signLimiter,
  validate({ body: z.object({
    // Only allowlisted, display-safe content types — never text/html or svg.
    contentType: z.enum(ALLOWED_MIME_VALUES, { error: "Định dạng tệp không được hỗ trợ" }),
    size: z.coerce.number().int().positive("Kích thước tệp không hợp lệ").max(MAX_UPLOAD_BYTES, "Tệp quá lớn (tối đa 10MB)"),
    expires: z.coerce.number().int().min(60).max(3600).default(900),
  }) }),
  asyncHandler(async (req: Request, res: Response) => {
    if (!isStorageEnabled()) return res.status(503).json({ error: "Chưa cấu hình lưu trữ tệp" });
    const spec = ALLOWED_TYPES.get(req.body.contentType);
    if (!spec) return res.status(400).json({ error: "Định dạng tệp không được hỗ trợ" });
    const key = userUploadKey(req.session, spec.ext);
    const url = await presignUpload({
      key,
      contentType: req.body.contentType,
      contentLength: req.body.size,   // ghim kích thước vào chữ ký → S3 từ chối nếu khác
      expiresIn: req.body.expires,
    });
    await audit(req, "file.sign-upload", { resource: "file", resourceId: key, after: { size: req.body.size, ct: req.body.contentType } });
    res.json({ key, url, expiresIn: req.body.expires, size: req.body.size, contentType: req.body.contentType, finalizeRequired: true });
  })
);

/**
 * POST /api/files/finalize — BƯỚC 2/2 của upload trực tiếp: XÁC MINH rồi mới cho dùng.
 *
 * Chữ ký chỉ ràng buộc được kích thước và nhãn kiểu; nó KHÔNG biết bên trong file là gì. Ở đây
 * server HEAD object (kích thước/kiểu thật) rồi đọc 16 byte đầu để dò magic bytes theo đúng
 * allowlist của đường multipart. Không khớp → XOÁ object và 415. Chỉ object qua được bước này mới
 * được coi là dùng được.
 */
router.post(
  "/finalize",
  signLimiter,
  validate({ body: z.object({ key: z.string().min(1).max(500) }) }),
  asyncHandler(async (req: Request, res: Response) => {
    if (!isStorageEnabled()) return res.status(503).json({ error: "Chưa cấu hình lưu trữ tệp" });
    const key = String(req.body.key);
    // Chỉ finalize được object trong namespace của CHÍNH mình (admin không ngoại lệ ở đây — key
    // luôn do /sign-upload sinh, nên không có ca dùng hợp lệ nào cần vượt namespace).
    if (!key.startsWith(`uploads/u${req.session.userId}/`)) {
      return res.status(403).json({ error: "Bạn không có quyền với file này" });
    }
    const head = await headObject(key);
    if (!head) return res.status(404).json({ error: "Chưa thấy tệp trên kho lưu trữ" });
    if (head.size <= 0 || head.size > MAX_UPLOAD_BYTES) {
      await deleteObject(key);
      return res.status(413).json({ error: "Tệp quá lớn (tối đa 10MB)" });
    }
    const magic = await getObjectHeadBytes(key, 16);
    const sniffed = magic ? sniffType(magic, head.contentType) : null;
    if (!sniffed) {
      await deleteObject(key);   // nội dung không khớp allowlist → không để lại rác trong bucket
      await audit(req, "file.finalize.rejected", { resource: "file", resourceId: key, after: { ct: head.contentType, size: head.size } });
      return res.status(415).json({ error: "Nội dung tệp không hợp lệ (chỉ PNG/JPG/WEBP/PDF/XLSX)" });
    }
    await audit(req, "file.finalize", { resource: "file", resourceId: key, after: { size: head.size, ct: sniffed.mime } });
    const url = await presignDownload(key, { expiresIn: 3600 });
    res.json({ key, url, size: head.size, contentType: sniffed.mime, finalized: true });
  })
);

router.delete(
  "/",
  requireRole("admin"),
  validate({ query: z.object({ key: z.string().min(1).max(500) }) }),
  asyncHandler(async (req: Request, res: Response) => {
    await deleteObject(req.query.key as string);
    await audit(req, "file.delete", { resource: "file", resourceId: req.query.key });
    res.json({ ok: true });
  })
);

export default router;
