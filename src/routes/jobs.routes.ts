import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { asyncHandler, requireAuth } from "../middleware.js";
import { validate } from "../validators.js";
import { getQueue, QUEUES, isQueueEnabled } from "../queue.js";
import { isStorageEnabled } from "../storage.js";
import { can, canOnQuote, PERMISSIONS as P } from "../permissions.js";
import { createLimiter } from "../rateLimit.js";

const router = Router();
// requireAuth is applied PER ROUTE, not router-wide: this router is mounted at
// the /api root, so a router-wide guard would swallow every unmatched /api/*
// path (incl. /api/health and the 404 handler) with a 401.

// Trần RIÊNG cho đường xuất NỀN. Đường xuất ĐỒNG BỘ đã có `createLimiter("export", 30/phút)` ở
// src/routes/export.routes.ts, còn đường này trước đó chỉ nằm dưới limiter chung của /api/ — mà mỗi
// lượt ở đây là một job nặng CPU trong tiến trình worker. 10/phút rộng hơn nhiều nhịp làm việc thật
// (một người xuất vài báo giá mỗi giờ) nhưng chặn được vòng lặp gọi liên tục.
//
// CHƯA KIỂM CHỨNG BẰNG TEST: `createLimiter` trả middleware RỖNG khi NODE_ENV=test (xem chú thích ở
// src/rateLimit.ts — bộ đếm Redis dùng chung giữa các tiến trình vitest gây 429 giả), nên không có
// cách nào lái con số 10 này qua HTTP trong bộ test. Chỉ đường mã là kiểm được, không phải hành vi.
const asyncExportLimiter = createLimiter("export-async", {
  windowMs: 60_000,
  max: 10,
  message: { error: "Bạn đang tạo quá nhiều lượt xuất nền, vui lòng chờ một phút" },
});

/** Async export: returns a jobId; client polls /api/jobs/:queue/:id */
router.post(
  "/quotes/:id/export",
  requireAuth,
  asyncExportLimiter,
  validate({
    params: z.object({ id: z.coerce.number().int().positive() }),
    body: z.object({ format: z.enum(["xlsx", "pdf"]).default("xlsx") }).default({} as any),
  }),
  asyncHandler(async (req: Request, res: Response) => {
    // Authorize the EXPORT by quote ownership before enqueuing — mirrors the
    // synchronous /api/export/:id route so this path is not an IDOR bypass.
    const quote = await prisma.quote.findFirst({
      where: { id: req.params.id as unknown as number },
      include: { members: { select: { id: true } } },
    });
    if (!quote) return res.status(404).json({ error: "Không tìm thấy báo giá" });
    if (!canOnQuote(req.session, "read", quote)) {
      return res.status(403).json({ error: "Bạn không có quyền xuất báo giá này" });
    }
    // Export capability gate (mirrors the synchronous /api/export route): a reader
    // who lacks quote:export (e.g. account_hn) must not exfiltrate full pricing.
    if (!can(req.session, P.QUOTE_EXPORT)) {
      return res.status(403).json({ error: "Bạn không có quyền xuất báo giá" });
    }
    const q = getQueue(QUEUES.EXPORT);
    // LỜI NHẮN CŨ LÀ MỘT VÒNG CỤT. Nó bảo "vui lòng dùng chức năng xuất file trực tiếp" — mà người
    // dùng tới được đây CHÍNH VÌ đường trực tiếp vừa từ chối họ bằng 413 (báo giá quá lớn).
    // Bảo họ quay lại thứ vừa thất bại là bỏ họ đứng giữa đường.
    //
    // Và thiếu `code` là thiếu thứ DUY NHẤT mà client dùng để phân biệt "xuất nền chưa bật" với
    // một lỗi 503 bất kỳ — nhánh dưới (thiếu kho object) có `code`, nhánh này thì không, nên cùng
    // một nguyên nhân "chưa bật xuất nền" lại cho ra hai hành vi khác nhau ở giao diện.
    // Hai nhánh nay dùng CHUNG một `code`; khác nhau ở phần nói rõ THIẾU CÁI GÌ.
    if (!q) {
      return res.status(503).json({
        error: "Xuất nền chưa dùng được (chưa cấu hình hàng đợi/Redis). Báo giá này quá lớn để tải trực tiếp — hãy nhờ quản trị viên bật hàng đợi, hoặc tách bớt sheet rồi tải lại.",
        code: "export_async_unavailable",
      });
    }
    // Xuất NỀN trả về một ĐƯỜNG TẢI từ kho object. Không có kho thì worker không có gì để trả —
    // và bản trước nhồi luôn cả file dưới dạng base64 vào giá trị trả về của job, tức là vào REDIS.
    // Chặn ngay ở đây để người dùng biết liền, thay vì chờ poll rồi nhận lỗi.
    if (!isStorageEnabled()) {
      return res.status(503).json({
        error: "Xuất nền chưa dùng được (chưa cấu hình kho lưu trữ tệp). Báo giá này quá lớn để tải trực tiếp — hãy nhờ quản trị viên bật kho lưu trữ, hoặc tách bớt sheet rồi tải lại.",
        code: "export_async_unavailable",
      });
    }
    // CHỐNG NHẤN TRÙNG. Nút "Xuất" không bị vô hiệu trong lúc chờ và route chỉ trả 202 rồi để client
    // poll, nên nhấn hai lần tạo hai job y hệt: hai lần đọc cả báo giá kèm mọi sheet/dòng, hai lần
    // sinh file, hai object rác trong kho — gấp đôi việc nặng nhất của hệ cho một kết quả duy nhất.
    //
    // DÙNG `deduplication` CHỨ KHÔNG PHẢI `jobId`. Trùng `jobId` thì BullMQ bỏ qua lượt add suốt
    // thời gian job còn được GIỮ LẠI, mà hàng đợi export giữ job đã xong tới 6 GIỜ (src/queue.ts).
    //
    // Khoá gộp có `userId`: hai người cùng xuất một báo giá vẫn là hai lượt tải riêng, và ai poll
    // job của người kia thì đã bị chặn ở kiểm quyền của GET /api/jobs/:queue/:id.
    //
    // ── VÌ SAO CÓ `updatedAt` TRONG KHOÁ ──────────────────────────────────────
    // TTL KHÔNG tự hết hiệu lực khi job xong. Đã đo trên bullmq 5.77.6: `moveToFinished` chỉ `DEL`
    // khoá `de:` khi `PTTL` là 0 hoặc -1; với `ttl: 30000` thì PTTL luôn > 0, nên khoá SỐNG SÓT qua
    // lúc job completed. Nghĩa là trong 30 giây sau khi xuất xong, một lượt xuất lại HỢP LỆ (người
    // dùng vừa sửa báo giá) bị gộp vào job cũ và nhận về ĐÚNG FILE CŨ — chính cái mà chú thích
    // trước đó nói là đã tránh được.
    //
    // Đưa mốc sửa đổi vào khoá làm nó TỰ hết hiệu lực đúng lúc cần: sửa báo giá là đổi
    // `Quote.updatedAt` là đổi khoá là không gộp nữa. Nhấn hai lần liên tiếp trên báo giá KHÔNG
    // đổi thì vẫn gộp — đó mới là thứ cần gộp.
    const DEDUP_TTL_MS = Number(process.env.EXPORT_DEDUP_TTL_MS) || 30_000;
    const dauThoiGian = +new Date(quote.updatedAt);
    const khoaGop = `export:${req.params.id}:${req.body.format}:${req.session.userId}:${dauThoiGian}`;
    const themViec = () =>
      q.add(
        req.body.format,
        { quoteId: req.params.id, requestedBy: req.session.userId },
        { deduplication: { id: khoaGop, ttl: DEDUP_TTL_MS } }
      );
    let job = await themViec();

    // THỬ LẠI SAU KHI JOB HỎNG PHẢI CHẠY THẬT.
    //
    // Khoá gộp SỐNG SÓT qua lúc job chuyển sang `failed`: BullMQ chỉ xoá khoá `de:` khi TTL của nó
    // là 0 hoặc -1 (removeDeduplicationKeyIfNeededOnFinalization.lua), mà ở đây TTL là 30 giây.
    // Nên nếu job vừa hỏng vì lý do NHẤT THỜI — kho object chớp mất kết nối, worker vừa restart
    // giữa lượt deploy — thì người dùng bấm "Tải lại" nhận lại ĐÚNG job cũ đó: không job mới nào
    // được tạo, không lượt chạy nào diễn ra, và họ nhận lại nguyên `failedReason` cũ tức thì. Bấm
    // bao nhiêu lần trong 30 giây cũng vậy. Đường xuất nền chỉ mới được nối vào giao diện ở nhánh
    // này (trước đó không nút nào gọi tới), nên đây là lần đầu có người thật đi qua chỗ đó.
    //
    // Chốt: gặp job đã `failed` thì XOÁ nó — `job.remove()` dọn luôn khoá gộp — rồi xếp việc mới.
    // Bọc try/catch vì `remove()` có thể đua với worker đang dọn (removeOnFail); hỏng thì cứ trả
    // job cũ, đúng như trước, không làm request chết theo.
    try {
      if ((await job.getState()) === "failed") {
        await job.remove();
        job = await themViec();
      }
    } catch { /* không xoá được thì giữ nguyên job cũ — vẫn tốt hơn 500 */ }

    res.status(202).json({ jobId: job.id, queue: QUEUES.EXPORT, format: req.body.format });
  })
);

router.get(
  "/jobs/:queue/:id",
  requireAuth,
  validate({ params: z.object({ queue: z.string().min(1).max(40), id: z.string().min(1).max(40) }) }),
  asyncHandler(async (req: Request, res: Response) => {
    // Nhánh này là lúc ĐANG HỎI kết quả, không phải lúc xếp việc — tức người dùng đã bấm Tải và
    // đang chờ. Redis chết giữa chừng thì việc của họ mất luôn, mà lời nhắn cũ chỉ nói "chưa được
    // cấu hình" như thể họ vừa gõ nhầm địa chỉ. Mang `code` giống hai nhánh kia để giao diện xử lý
    // một kiểu duy nhất, và nói rõ ai khắc phục được.
    if (!isQueueEnabled()) {
      return res.status(503).json({
        error: "Hệ thống hàng đợi chưa được cấu hình (hoặc vừa mất kết nối Redis) nên không theo dõi được lượt tạo file. Hãy nhờ quản trị viên kiểm tra rồi bấm tải lại.",
        code: "export_async_unavailable",
      });
    }
    // Only the export queue is user-pollable. Other queues (email/webhook/telegram)
    // carry recipient addresses, target URLs and secrets in job.data — never expose
    // them here, even to QUOTE_READ_ALL/admin callers.
    if (req.params.queue !== QUEUES.EXPORT) {
      return res.status(404).json({ error: "Không tìm thấy hàng đợi" });
    }
    const q = getQueue(req.params.queue);
    if (!q) return res.status(404).json({ error: "Không tìm thấy hàng đợi" });
    const job = await q.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: "Không tìm thấy tác vụ" });
    // Only the user who requested the job (or a read-all holder) may read its
    // result — job.returnvalue contains a presigned download URL / document.
    const requestedBy = job.data?.requestedBy;
    if (requestedBy !== req.session.userId && !can(req.session, P.QUOTE_READ_ALL)) {
      return res.status(403).json({ error: "Bạn không có quyền xem tác vụ này" });
    }
    const state = await job.getState();
    res.json({
      id: job.id,
      name: job.name,
      state,
      progress: job.progress,
      data: job.data,
      returnvalue: job.returnvalue,
      failedReason: job.failedReason,
      attemptsMade: job.attemptsMade,
      createdAt: job.timestamp ? new Date(job.timestamp) : null,
      finishedAt: job.finishedOn ? new Date(job.finishedOn) : null,
    });
  })
);

export default router;
