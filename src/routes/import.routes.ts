// NHẬP file Excel vào báo giá — endpoint CHỈ ĐỌC (parse + xem trước), KHÔNG ghi DB.
//
// Vì sao không ghi thẳng: người dùng phải XEM TRƯỚC "trước/sau" rồi mới quyết định. Sau khi bấm
// "Nạp vào báo giá", dữ liệu chảy qua ĐÚNG đường lưu cũ (PUT /api/quotes/:id) nên giữ nguyên mọi
// lớp: kiểm dữ liệu (zod), phân quyền, khoá lạc quan (baseUpdatedAt), lưu phiên bản (QuoteVersion),
// tính lại tổng ở server. Không đẻ thêm đường ghi nào để hở.

import { Router } from "express";
import type { Request, Response } from "express";
import multer from "multer";
import { prisma } from "../db.js";
import { asyncHandler, requireAuth } from "../middleware.js";
import { canOnQuote, requirePermission, can, PERMISSIONS as P } from "../permissions.js";
import { createLimiter } from "../rateLimit.js";
import { parseQuoteWorkbook } from "../excelImport.js";
import { inspectXlsx } from "../zipSafety.js";
import { audit } from "../audit.js";

const router = Router();
router.use(requireAuth);

// Đọc xlsx = giải nén + duyệt XML → tốn CPU/RAM. Giới hạn riêng, chặt hơn API thường.
const importLimiter = createLimiter("import-excel", { windowMs: 60_000, max: 12 });

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: 1, fields: 4 },
  fileFilter: (_req, file, cb) => {
    const ok = file.mimetype === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      || file.mimetype === "application/vnd.ms-excel.sheet.macroEnabled.12"
      || file.mimetype === "application/octet-stream"        // trình duyệt/OS đôi khi gửi kiểu này
      || /\.xlsx?$/i.test(file.originalname || "");
    cb(null, ok);
  },
});

/** xlsx là file zip: PK\x03\x04. KHÔNG tin phần mở rộng/MIME do trình duyệt khai. */
const looksXlsx = (b: Buffer) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;

/**
 * POST /api/quotes/import-excel   (multipart: file=<.xlsx>, quoteId=<id> tuỳ chọn)
 * → { sheets: [...], warnings: [...] }  — dữ liệu lưới đọc từ file, KHÔNG đụng DB.
 *
 * Quyền: có `quote:create` (dựng báo giá mới) HOẶC sửa được đúng báo giá đích (quoteId).
 */
router.post(
  "/import-excel",
  importLimiter,
  requirePermission(P.QUOTE_CREATE),
  upload.single("file"),
  asyncHandler(async (req: Request, res: Response) => {
    // account_hn chỉ được điền bảng Hà Nội — không nạp đè lưới báo giá chính (khớp PUT /:id).
    if (req.session.role === "account_hn") {
      return res.status(403).json({ error: "Account Hà Nội không được nhập file vào báo giá chính." });
    }
    if (!req.file) return res.status(400).json({ error: "Vui lòng chọn file Excel (.xlsx)" });
    if (!looksXlsx(req.file.buffer)) {
      return res.status(415).json({ error: "File không phải .xlsx. Nếu đang dùng .xls cũ, hãy mở bằng Excel rồi 'Lưu thành' .xlsx." });
    }
    // ĐÂY là chỗ nguy hiểm nhất trong toàn hệ: buffer do người ngoài đưa vào sắp được GIẢI NÉN và
    // phân tích XML ngay trong tiến trình ứng dụng. `PK\x03\x04` chỉ chứng minh "là zip" — nó khớp
    // với cả bom giải nén (4 GB số 0 nén còn vài KB) lẫn zip 200.000 mục. Soi mục lục trước, không
    // giải nén một byte nào (src/zipSafety.ts).
    const zip = inspectXlsx(req.file.buffer);
    if (!zip.ok) {
      await audit(req, "quote.import.rejected", {
        resource: "quote", resourceId: Number(req.body?.quoteId) || undefined,
        after: { reason: zip.reason, file: String(req.file.originalname || "").slice(0, 120), size: req.file.size },
      });
      return res.status(415).json({ error: `Tệp Excel không hợp lệ: ${zip.reason}` });
    }

    // Nạp vào báo giá CÓ SẴN → phải sửa được chính báo giá đó (chặn IDOR: người không liên quan
    // không được dùng endpoint này để dò dữ liệu báo giá khác).
    const quoteId = Number(req.body?.quoteId) || 0;
    if (quoteId) {
      const quote = await prisma.quote.findFirst({
        where: { id: quoteId },
        select: { id: true, createdById: true, status: true, members: { select: { id: true } } },
      });
      if (!quote) return res.status(404).json({ error: "Không tìm thấy báo giá" });
      if (!canOnQuote(req.session, "update", quote)) {
        return res.status(403).json({ error: "Bạn không có quyền sửa báo giá này" });
      }
      // Đã chốt / không chốt là TRẠNG THÁI CUỐI — khớp `editable` ở editor + canEdit ở service.
      const terminal = quote.status === "converted" || quote.status === "lost";
      if (terminal && !can(req.session, P.QUOTE_SEND)) {
        return res.status(409).json({ error: "Báo giá đã chốt/không chốt — không nhập đè được nữa." });
      }
    }

    let result;
    try {
      result = await parseQuoteWorkbook(req.file.buffer);
    } catch (e) {
      return res.status(422).json({
        error: `Không đọc được file Excel: ${e instanceof Error ? e.message : "file hỏng hoặc sai định dạng"}`,
      });
    }

    await audit(req, "quote.import.preview", {
      resource: "quote",
      resourceId: quoteId || undefined,
      after: {
        file: String(req.file.originalname || "").slice(0, 120),
        size: req.file.size,
        sheets: result.sheets.map((s) => ({ name: s.name, rows: s.items.length, skipped: s.skipped || undefined })),
      },
    });
    res.json(result);
  })
);

// Lỗi từ multer (file quá lớn / sai loại) → thông báo tiếng Việt thay vì 500.
router.use((err: unknown, _req: Request, res: Response, next: (e?: unknown) => void) => {
  const e = err as { code?: string; message?: string };
  if (e?.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: "File quá lớn (tối đa 10 MB)" });
  if (e?.code === "LIMIT_UNEXPECTED_FILE") return res.status(400).json({ error: "Chỉ nhận 1 file .xlsx" });
  return next(err);
});

export default router;
