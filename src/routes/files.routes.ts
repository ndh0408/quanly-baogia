import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import multer from "multer";
import { randomBytes } from "node:crypto";
import { prisma } from "../db.js";
import { asyncHandler, requireAuth, requireRole } from "../middleware.js";
import { validate } from "../validators.js";
import { putObject, presignDownload, presignUpload, deleteObject, isStorageEnabled, headObject, getObjectHeadBytes, getObjectBytes, copyObject } from "../storage.js";
import { audit } from "../audit.js";
import { canOnQuote, requirePermission, PERMISSIONS as P } from "../permissions.js";
import { createLimiter } from "../rateLimit.js";
import { inspectXlsx } from "../zipSafety.js";

const router = Router();
router.use(requireAuth);
// requireAuth là XÁC THỰC, không phải PHÂN QUYỀN. Ba đường GHI bên dưới thêm `file:upload`; đường
// ĐỌC (`GET /sign-download`) CỐ Ý không thêm, vì ở đó `canAccessKey` mới là chốt phạm vi đúng —
// người xem hợp lệ (vd kế toán mở chứng từ) không có nghiệp vụ tải lên nào.

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // giữ CÙNG trần với đường multipart bên dưới
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
// Số phiên tải lên CHƯA hoàn tất tối đa cho mỗi tài khoản. Chặn kiểu lạm dụng: ký hàng nghìn URL
// rồi bỏ đó — vừa phình bảng vừa chiếm chỗ bucket bằng object không ai xác minh.
const MAX_PENDING_UPLOADS = 20;

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
/**
 * Object trong `uploads/` đã QUA XÁC MINH chưa.
 *
 * Đây là chốt biến hai bước /sign-upload → /finalize từ QUY ƯỚC thành RÀNG BUỘC. Không có nó, bỏ qua
 * /finalize rồi gọi thẳng /sign-download là tải được nội dung chưa ai kiểm.
 *
 * DI SẢN: object tải lên TRƯỚC khi có bảng UploadObject không có hàng tương ứng. Chặn chúng là làm
 * hỏng dữ liệu đang chạy, nên "không có hàng" được coi là hợp lệ — đường multipart vốn đã kiểm magic
 * bytes ngay lúc nhận nên object cũ vẫn là object đã-được-kiểm. Chỉ hàng CÓ TỒN TẠI mà chưa
 * `finalized` mới bị chặn; từ nay mọi object presigned đều có hàng.
 */
async function isUploadUsable(key: string) {
  // Vùng tạm KHÔNG BAO GIỜ tải về được — đó là chỗ URL đã ký trỏ tới, nội dung ở đây chưa qua kiểm.
  if (key.startsWith("uploads/staging/")) return false;
  const row = await prisma.uploadObject.findUnique({ where: { key }, select: { status: true } });
  if (!row) return true; // di sản — xem giải thích ở trên
  return row.status === "finalized";
}

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
  // Object tải lên: quyền theo namespace, NHƯNG trạng thái xác minh áp cho MỌI người — kể cả admin.
  // "Là admin" không biến một file chưa kiểm nội dung thành file đã kiểm; nếu cho admin vượt thì chỉ
  // cần lừa được một admin bấm link là bypass sạch lớp xác minh.
  if (key.startsWith("uploads/")) {
    if (!(await isUploadUsable(key))) return false;
    if (session.role === "admin") return true;
    return key.startsWith(`uploads/u${session.userId}/`);
  }
  if (session.role === "admin") return true;
  if (key.startsWith("logos/")) return true;
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
// Vùng TẠM cho upload trực tiếp. URL đã ký CHỈ trỏ vào đây; `canAccessKey` từ chối thẳng mọi khoá
// dưới `uploads/staging/` nên không ai tải được nội dung chưa xác minh, kể cả admin.
function stagingUploadKey(session: Request["session"], ext = "") {
  return `uploads/staging/u${session.userId}/${Date.now()}-${randomBytes(6).toString("hex")}${ext}`;
}

/** POST /api/files - multipart upload, returns object key + signed download URL. */
router.post(
  "/",
  requirePermission(P.FILE_UPLOAD),
  upload.single("file"),
  asyncHandler(async (req: Request, res: Response) => {
    if (!isStorageEnabled()) return res.status(503).json({ error: "Chưa cấu hình lưu trữ tệp" });
    if (!req.file) return res.status(400).json({ error: "Vui lòng chọn tệp để tải lên" });
    // Verify content by magic bytes — never trust the client MIME/extension.
    const sniffed = sniffType(req.file.buffer, req.file.mimetype);
    if (!sniffed) {
      return res.status(415).json({ error: "Loại file không được phép (chỉ PNG/JPG/WEBP/PDF/XLSX)" });
    }
    // .xlsx là zip — magic bytes chỉ nói "là zip". Kiểm cấu trúc trước khi cất giữ (xem src/zipSafety.ts).
    if (sniffed.mime === XLSX_MIME) {
      const verdict = inspectXlsx(req.file.buffer);
      if (!verdict.ok) return res.status(415).json({ error: `Tệp Excel không hợp lệ: ${verdict.reason}` });
    }
    const key = userUploadKey(req.session, sniffed.ext);
    await putObject({
      key,
      body: req.file.buffer,
      contentType: sniffed.mime,          // allowlisted type, not the client's
      contentDisposition: "attachment",    // never render inline
      metadata: { originalName: encodeURIComponent(req.file.originalname).slice(0, 200), uploadedBy: String(req.session.userId) },
    });
    // Đường multipart đã kiểm nội dung NGAY lúc nhận → ghi thẳng trạng thái `finalized`. Nhờ vậy
    // isUploadUsable() có một quy tắc duy nhất cho mọi object mới, không phải phân biệt đường vào.
    await prisma.uploadObject.create({
      data: {
        key, stagingKey: key,   // đường multipart không ký URL nào → không có cửa sổ ghi đè
        ownerId: req.session.userId as number,
        expectedMime: sniffed.mime, expectedSize: req.file.size,
        actualMime: sniffed.mime, actualSize: req.file.size,
        status: "finalized", finalizedAt: new Date(),
        expiresAt: new Date(Date.now() + 3600_000),
      },
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
    // PHÂN QUYỀN TRƯỚC, cấu hình sau. Đảo thứ tự thì người KHÔNG có quyền với key này vẫn dò được
    // trạng thái hạ tầng ("đã bật lưu trữ chưa") — và tệ hơn, lớp kiểm quyền không hề chạy. Mẫu chuẩn
    // là xác thực → quyền năng lực → quyền tài nguyên → trạng thái.
    if (!(await canAccessKey(req.session, req.query.key))) {
      return res.status(403).json({ error: "Bạn không có quyền với file này" });
    }
    if (!isStorageEnabled()) return res.status(503).json({ error: "Chưa cấu hình lưu trữ tệp" });
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
 *   • một hàng `UploadObject` ở trạng thái `pending` được tạo TRƯỚC khi ký; `canAccessKey` từ chối
 *     mọi khoá `uploads/` chưa `finalized` — kể cả cho admin. Đây là RÀNG BUỘC kiểm tra được trong
 *     CSDL, không phải quy ước trong chú thích (bản đầu chỉ ghi "pending=1" mà không có gì đánh dấu,
 *     nên bỏ qua /finalize rồi gọi thẳng /sign-download là tải được nội dung chưa ai kiểm);
 *   • URL đã ký CHỈ trỏ vào `uploads/staging/` — vùng KHÔNG BAO GIỜ tải về được. Sau khi xác minh,
 *     server tự sao chép sang khoá cuối. Nhờ vậy URL còn hạn cũng không ghi đè được thứ đã kiểm.
 */
router.post(
  "/sign-upload",
  // Quyền TRƯỚC limiter: người không được phép ghi thì không nên tiêu ô hạn mức của ai cả.
  requirePermission(P.FILE_UPLOAD),
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
    // HẠN MỨC: chặn một tài khoản ký hàng loạt URL rồi bỏ đó, làm phình bảng + phình bucket.
    const pending = await prisma.uploadObject.count({
      where: { ownerId: req.session.userId, status: "pending", expiresAt: { gt: new Date() } },
    });
    if (pending >= MAX_PENDING_UPLOADS) {
      return res.status(429).json({ error: `Đang có ${pending} tệp chờ xác minh — hoàn tất hoặc đợi hết hạn rồi thử lại.` });
    }
    const key = userUploadKey(req.session, spec.ext);              // khoá CUỐI — không ký PUT bao giờ
    const stagingKey = stagingUploadKey(req.session, spec.ext);   // khoá TẠM — URL đã ký trỏ vào đây
    // GHI BẢN GHI TRƯỚC KHI KÝ. Ngược lại thì có cửa sổ ký-xong-mà-chưa-có-hàng, và trong cửa sổ đó
    // object vừa PUT lên sẽ rơi vào nhánh "di sản" của isUploadUsable → dùng được mà chưa xác minh.
    await prisma.uploadObject.create({
      data: {
        key, stagingKey,
        ownerId: req.session.userId as number,
        expectedMime: req.body.contentType,
        expectedSize: req.body.size,
        expiresAt: new Date(Date.now() + req.body.expires * 1000),
      },
    });
    const url = await presignUpload({
      key: stagingKey,
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
  requirePermission(P.FILE_UPLOAD),
  signLimiter,
  validate({ body: z.object({ key: z.string().min(1).max(500) }) }),
  asyncHandler(async (req: Request, res: Response) => {
    const key = String(req.body.key);
    // PHÂN QUYỀN TRƯỚC, cấu hình sau (xem ghi chú ở /sign-download). Chỉ finalize được object trong
    // namespace của CHÍNH mình — admin cũng không ngoại lệ, vì key luôn do /sign-upload sinh nên
    // không có ca dùng hợp lệ nào cần vượt namespace.
    if (!key.startsWith(`uploads/u${req.session.userId}/`)) {
      return res.status(403).json({ error: "Bạn không có quyền với file này" });
    }
    if (!isStorageEnabled()) return res.status(503).json({ error: "Chưa cấu hình lưu trữ tệp" });

    const rec = await prisma.uploadObject.findUnique({ where: { key } });
    if (!rec || rec.ownerId !== req.session.userId) return res.status(404).json({ error: "Không tìm thấy phiên tải lên" });
    if (rec.status === "finalized") {
      // Bấm lại nút / mạng chập chờn gửi hai lần → coi như thành công, không đổi trạng thái. Idempotent.
      const url = await presignDownload(key, { expiresIn: 3600 });
      return res.json({ key, url, size: rec.actualSize, contentType: rec.actualMime, finalized: true });
    }
    if (rec.status === "rejected") return res.status(409).json({ error: "Tệp đã bị từ chối trước đó, vui lòng tải lại" });
    if (rec.expiresAt < new Date()) return res.status(410).json({ error: "Phiên tải lên đã hết hạn, vui lòng ký lại" });

    /** Đánh dấu bị từ chối + XOÁ object khỏi kho (không để lại rác chưa xác minh trong bucket). */
    const reject = async (reason: string, status: number, message: string) => {
      await deleteObject(rec.stagingKey).catch(() => {});
      await prisma.uploadObject.updateMany({ where: { key, status: "pending" }, data: { status: "rejected", rejectReason: reason } });
      await audit(req, "file.finalize.rejected", { resource: "file", resourceId: key, after: { reason } });
      return res.status(status).json({ error: message });
    };

    // MỌI phép kiểm chạy trên khoá TẠM — đó mới là nơi client vừa PUT nội dung lên.
    const head = await headObject(rec.stagingKey);
    if (!head) return res.status(404).json({ error: "Chưa thấy tệp trên kho lưu trữ" });
    // Kích thước THẬT phải khớp cái đã ký. Chữ ký đã ghim Content-Length nên lệch là bất thường —
    // hoặc kho lưu trữ không cưỡng chế, hoặc có người ghi đè. Đối chiếu lại chứ không tin một lớp.
    if (head.size !== rec.expectedSize) {
      return reject(`kích thước lệch: ký ${rec.expectedSize}, thực tế ${head.size}`, 400, "Kích thước tệp không khớp với lúc đăng ký.");
    }
    if (head.size <= 0 || head.size > MAX_UPLOAD_BYTES) return reject(`kích thước ngoài giới hạn: ${head.size}`, 413, "Tệp quá lớn (tối đa 10MB)");

    const magic = await getObjectHeadBytes(rec.stagingKey, 16);
    const sniffed = magic ? sniffType(magic, head.contentType) : null;
    if (!sniffed) return reject("magic bytes không khớp allowlist", 415, "Nội dung tệp không hợp lệ (chỉ PNG/JPG/WEBP/PDF/XLSX)");
    // Nội dung thật phải khớp KIỂU ĐÃ KÝ, không chỉ "nằm trong allowlist": ký image/png rồi đẩy PDF
    // lên là đã nói dối, dù PDF vốn được phép.
    if (sniffed.mime !== rec.expectedMime) {
      return reject(`kiểu lệch: ký ${rec.expectedMime}, nội dung là ${sniffed.mime}`, 415, "Nội dung tệp không khớp định dạng đã đăng ký.");
    }
    // XLSX = tệp zip; magic bytes chỉ chứng minh "là zip". Kiểm cấu trúc thật (xem src/zipSafety.ts).
    if (sniffed.mime === XLSX_MIME) {
      const body = await getObjectBytes(rec.stagingKey, MAX_UPLOAD_BYTES);
      const verdict = body ? inspectXlsx(body) : { ok: false as const, reason: "không đọc được nội dung" };
      if (!verdict.ok) return reject(`xlsx không hợp lệ: ${verdict.reason}`, 415, `Tệp Excel không hợp lệ: ${verdict.reason}`);
    }

    // CHUYỂN TRẠNG THÁI NGUYÊN TỬ: chỉ request nào lật được pending → finalized mới thắng. Hai
    // request finalize đồng thời thì đúng một cái count===1, cái kia thấy 0 và đọc lại trạng thái.
    // Đặt TRƯỚC bước sao chép để hai request không cùng copy; kẻ thua không đụng gì tới kho lưu trữ.
    const claimed = await prisma.uploadObject.updateMany({
      where: { key, status: "pending" },
      data: { status: "finalized", actualMime: sniffed.mime, actualSize: head.size, finalizedAt: new Date() },
    });
    if (claimed.count !== 1) return res.status(409).json({ error: "Tệp vừa được xử lý bởi yêu cầu khác, vui lòng tải lại trang." });

    // SAO CHÉP sang khoá cuối rồi XOÁ bản tạm. Đây là chốt chống ghi đè sau xác minh: URL đã ký chỉ
    // trỏ vào khoá tạm, nên dù nó còn hiệu lực thêm vài phút, đè lên đó cũng không chạm được thứ mà
    // /sign-download phục vụ. Copy thất bại → trả bản ghi về `pending` để lần sau finalize lại được,
    // thay vì để trạng thái nói "xong" mà khoá cuối rỗng.
    try {
      await copyObject(rec.stagingKey, key, { contentType: sniffed.mime });
    } catch (e) {
      await prisma.uploadObject.updateMany({ where: { key }, data: { status: "pending", finalizedAt: null } });
      throw e;
    }
    await deleteObject(rec.stagingKey).catch(() => {});

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
