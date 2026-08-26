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
import { Worker } from "node:worker_threads";
import { inspectXlsx } from "../zipSafety.js";
import { audit } from "../audit.js";

const router = Router();
router.use(requireAuth);

// Đọc xlsx = giải nén + duyệt XML → tốn CPU/RAM. Giới hạn riêng, chặt hơn API thường.
const importLimiter = createLimiter("import-excel", { windowMs: 60_000, max: 12 });

const MAX_FILE_BYTES = 10 * 1024 * 1024;

// ─── Đọc workbook TRONG WORKER THREAD ──────────────────────────────────────
//
// `parseQuoteWorkbook` gọi `workbook.xlsx.load()` của exceljs — giải nén và dựng TOÀN BỘ workbook
// trong bộ nhớ TRƯỚC khi bất kỳ trần nào của app (MAX_SHEETS, MAX_SCAN_ROWS) có tác dụng. Trần tải
// lên là 10MB, nhưng .xlsx là ZIP: XML thưa nén cực tốt, 10MB nén bung ra hàng trăm MB. Chạy trên
// luồng chính thì CẢ SERVER ĐỨNG (event loop bị chiếm — mọi request khác, mọi SSE, mọi nhịp tim
// xếp hàng sau nó), và vượt RAM là V8 giết TIẾN TRÌNH chứ không phải một request.
//
// CỐ Ý KHÔNG có đường rơi về nội tuyến (khác `runExportJob`): nội tuyến CHÍNH LÀ thứ đang bỏ đi.
// Worker hỏng thì trả lỗi cho người dùng, không kéo việc nặng về luồng chính đúng lúc đang tải cao.
const IMPORT_WORKER_URL = new URL("../importWorker.js", import.meta.url);
const IMPORT_TIMEOUT_MS = Math.max(5_000, Number(process.env.IMPORT_TIMEOUT_MS) || 30_000);
// Trần heap của worker.
//
// ⚠️ ĐÃ ĐO: `maxOldGenerationSizeMb` KHÔNG chặn được thứ tốn kém nhất ở đây. Thử với trần 32MB,
// một worker vẫn cấp phát thoải mái `Buffer.alloc(300MB)` và ba triệu object. Buffer là bộ nhớ
// NGOÀI heap V8, còn old-space thì V8 co giãn theo cách riêng. Nên ĐỪNG coi đây là hàng rào.
//
// Hàng rào THẬT ở đường này là hai thứ khác: trần tải lên 10MB (multer, ngay trên) và
// IMPORT_TIMEOUT_MS. Trần heap giữ lại như một lớp phòng khi V8 đổi hành vi, không phải như một
// bảo đảm. Lợi ích ĐÃ CHỨNG MINH của worker là tách việc đọc file khỏi EVENT LOOP —
// tests/import-worker-thread.test.js đo độ trễ event loop để chốt điều đó.
//
// Việc còn lại: giới hạn bộ nhớ thật sự cần đọc theo luồng (exceljs WorkbookReader) thay vì
// `.load()` cả workbook. Xem docs/REMAINING_RISKS.md.
const IMPORT_HEAP_MB = Math.max(128, Number(process.env.IMPORT_HEAP_MB) || 512);

class LoiNhap extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

function docWorkbookTrongWorker(buffer: Buffer): Promise<any> {
  return new Promise((resolve, reject) => {
    let xong = false;
    const w = new Worker(IMPORT_WORKER_URL, {
      workerData: { buffer },
      resourceLimits: { maxOldGenerationSizeMb: IMPORT_HEAP_MB },
    });
    const ket = (fn: (a: any) => void, a: any) => { if (xong) return; xong = true; clearTimeout(dongHo); void w.terminate(); fn(a); };
    const dongHo = setTimeout(
      () => ket(reject, new LoiNhap("File Excel quá nặng để đọc trong thời gian cho phép. Hãy tách bớt sheet rồi thử lại.", 413)),
      IMPORT_TIMEOUT_MS,
    );
    w.once("message", (m: any) => {
      if (m?.ok) return ket(resolve, m.result);
      // `quaNang` = worker chạm trần heap. Đó là 413 (file quá lớn), không phải 422 (file hỏng) —
      // lời khuyên cho người dùng khác hẳn nhau.
      ket(reject, m?.quaNang
        ? new LoiNhap("File Excel quá lớn để xử lý. Hãy tách bớt sheet hoặc bớt dòng rồi thử lại.", 413)
        : new LoiNhap(`Không đọc được file Excel: ${m?.error || "file hỏng hoặc sai định dạng"}`, 422));
    });
    w.once("error", (e) => ket(reject, e));
    // Chạm trần heap thì worker CHẾT HẲN, không kịp gửi message nào — bắt ở đây mới thấy.
    w.once("exit", (code) => {
      if (!xong && code !== 0) ket(reject, new LoiNhap("File Excel quá lớn để xử lý. Hãy tách bớt sheet hoặc bớt dòng rồi thử lại.", 413));
    });
  });
}
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
    // Người điền HN chỉ được điền bảng Hà Nội — không nạp đè lưới báo giá chính (khớp PUT /:id).
    // Theo QUYỀN chứ không theo chuỗi role: quote:hn:fill cấp được per-user. Xem quotes.routes.ts.
    if (can(req.session, P.QUOTE_HN_FILL)) {
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
      result = await docWorkbookTrongWorker(req.file.buffer);
    } catch (e) {
      const st = e instanceof LoiNhap ? e.status : 422;
      const msg = e instanceof LoiNhap
        ? e.message
        : `Không đọc được file Excel: ${e instanceof Error ? e.message : "file hỏng hoặc sai định dạng"}`;
      return res.status(st).json({ error: msg });
    }

    await audit(req, "quote.import.preview", {
      resource: "quote",
      resourceId: quoteId || undefined,
      after: {
        file: String(req.file.originalname || "").slice(0, 120),
        size: req.file.size,
        sheets: result.sheets.map((s: any) => ({ name: s.name, rows: s.items.length, skipped: s.skipped || undefined })),
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
