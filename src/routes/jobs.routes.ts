import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { asyncHandler, requireAuth } from "../middleware.js";
import { validate } from "../validators.js";
import type { Job } from "bullmq";
import { getQueue, QUEUES, isQueueEnabled, xepViecCoHan } from "../queue.js";
import { isStorageEnabled, getObjectStream } from "../storage.js";
import { pipeline } from "node:stream/promises";
import { can, canOnQuote, biLuocView, PERMISSIONS as P } from "../permissions.js";
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
      include: { members: { select: { userId: true, scopes: true } } },
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
    // Cùng chốt với xuất đồng bộ (RBAC-06).
    if (biLuocView(req.session)) return res.status(403).json({ error: "Bạn chỉ được xem phần được giao của báo giá này" });
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
    // TRẦN THỜI GIAN cho lệnh Redis — ultracode audit 2026-09-09 (finding H4): trước bản vá, bốn
    // lệnh Redis của route này (2 lần thêm việc, getState, remove) gọi THẲNG BullMQ, khác hẳn
    // notifications.ts/webhooks.ts đã dùng xepViecCoHan cho đúng lớp lỗi này. `getQueue` đặt
    // `maxRetriesPerRequest: null` (src/queue.ts) — đúng cấu hình khiến một lệnh Redis "TCP còn mở
    // nhưng không hồi đáp" TREO VÔ HẠN, không bao giờ tự thất bại. Không có trần thì y hệt lỗi đã
    // vá cho đường Lưu báo giá (f582296) tái diễn ở đây: request xuất/poll treo mãi, ăn một kết nối
    // trong pool tới khi client bỏ cuộc.
    let job = await xepViecCoHan<Job>(themViec, { queueName: QUEUES.EXPORT, jobName: req.body.format });
    if (!job) {
      return res.status(503).json({
        error: "Không xếp được lượt xuất vào hàng đợi (Redis chậm/mất kết nối). Hãy nhờ quản trị viên kiểm tra Redis, hoặc thử lại sau ít giây.",
        code: "export_async_unavailable",
      });
    }

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
    // `xepViecCoHan` không ném (trả null) nên không cần try/catch nữa — chỉ cần kiểm null: hỏng
    // hoặc quá hạn thì GIỮ NGUYÊN job cũ, đúng tinh thần "không xoá được thì vẫn tốt hơn 500".
    const trangThai = await xepViecCoHan<string>(() => job!.getState(), { queueName: QUEUES.EXPORT, jobName: "getState" });
    if (trangThai === "failed") {
      const daXoa = await xepViecCoHan<boolean>(() => job!.remove().then(() => true), { queueName: QUEUES.EXPORT, jobName: "remove" });
      if (daXoa) {
        const viecMoi = await xepViecCoHan<Job>(themViec, { queueName: QUEUES.EXPORT, jobName: req.body.format });
        if (viecMoi) job = viecMoi;
      }
    }

    res.status(202).json({ jobId: job.id, queue: QUEUES.EXPORT, format: req.body.format });
  })
);

/**
 * 503 TẠM THỜI "hàng đợi chậm một nhịp" (RT-03) — client (choJob trong web/src/lib/exportQuote.ts) nghỉ
 * theo Retry-After rồi hỏi lại, KHÔNG bỏ chờ. Một chỗ duy nhất cho cả hai lệnh Redis của một lượt poll
 * (getJob ở layJobXuat và getState ở route trạng thái), để hai nhánh không trôi khỏi nhau.
 */
function traHangDoiCham(res: Response): void {
  res.setHeader("Retry-After", "2");
  res.status(503).json({ error: "Hàng đợi đang chậm nên chưa hỏi được trạng thái tệp — hệ thống tự thử lại. Nếu kéo dài, hãy nhờ quản trị viên kiểm tra Redis.", code: "job_state_timeout" });
}

/**
 * Tìm job xuất và GÁC QUYỀN — dùng chung cho GET trạng thái và GET tệp. Trả null khi đã tự trả lời
 * (4xx/503). Hai đường phải gác Y HỆT nhau: đường tệp phát chính file đầy đủ giá mà `returnvalue`
 * của đường trạng thái trỏ tới.
 */
async function layJobXuat(req: Request, res: Response): Promise<Job | null> {
  // Nhánh này là lúc ĐANG HỎI kết quả, không phải lúc xếp việc — tức người dùng đã bấm Tải và
  // đang chờ. Redis chết giữa chừng thì việc của họ mất luôn, mà lời nhắn cũ chỉ nói "chưa được
  // cấu hình" như thể họ vừa gõ nhầm địa chỉ. Mang `code` giống hai nhánh kia để giao diện xử lý
  // một kiểu duy nhất, và nói rõ ai khắc phục được.
  if (!isQueueEnabled()) {
    res.status(503).json({
      error: "Hệ thống hàng đợi chưa được cấu hình (hoặc vừa mất kết nối Redis) nên không theo dõi được lượt tạo file. Hãy nhờ quản trị viên kiểm tra rồi bấm tải lại.",
      code: "export_async_unavailable",
    });
    return null;
  }
  // Only the export queue is user-pollable. Other queues (email/webhook/telegram)
  // carry recipient addresses, target URLs and secrets in job.data — never expose
  // them here, even to QUOTE_READ_ALL/admin callers.
  if (req.params.queue !== QUEUES.EXPORT) {
    res.status(404).json({ error: "Không tìm thấy hàng đợi" });
    return null;
  }
  const q = getQueue(req.params.queue);
  if (!q) { res.status(404).json({ error: "Không tìm thấy hàng đợi" }); return null; }
  // TRẦN THỜI GIAN — cùng lý do như nhánh POST ở trên: đây là lúc người dùng ĐANG POLL chờ kết
  // quả, một lệnh Redis treo vô hạn ở đây có nghĩa là mọi lượt bấm "Tải" sau đó cũng treo theo.
  const job = await xepViecCoHan<Job | undefined>(() => q.getJob(req.params.id), { queueName: req.params.queue, jobName: "getJob" });
  // HAI ca tách được (soát chéo files#3): BullMQ `getJob` → `Job.fromId` trả `undefined` khi hash của
  // job rỗng (không tồn tại / đã bị dọn), còn xepViecCoHan trả `null` khi quá trần hoặc lệnh lỗi.
  // Bản trước gộp cả hai thành 404 — mà getJob là lệnh ĐẦU của mỗi lượt poll nên Redis treo thì nó
  // chạm trần TRƯỚC getState: client nhận 404, bỏ chờ ngay trong khi worker vẫn đang sinh file.
  if (job === null) { traHangDoiCham(res); return null; }
  if (!job) { res.status(404).json({ error: "Không tìm thấy tác vụ (đã bị dọn hoặc hàng đợi vừa khởi động lại) — hãy bấm tải lại" }); return null; }
  // Only the user who requested the job (or a read-all holder) may read its
  // result — job.returnvalue trỏ tới file xuất đầy đủ giá.
  const requestedBy = job.data?.requestedBy;
  if (requestedBy !== req.session.userId && !can(req.session, P.QUOTE_READ_ALL)) {
    res.status(403).json({ error: "Bạn không có quyền xem tác vụ này" });
    return null;
  }
  // `returnvalue` của job xuất trỏ tới file Excel/PDF ĐẦY ĐỦ GIÁ. Người xem hộ (nhánh
  // QUOTE_READ_ALL ngay trên) vì thế phải có luôn năng lực XUẤT — đúng chốt mà cả ba đường tới
  // cùng tệp đó đang dùng: export.routes.ts mount requirePermission(QUOTE_EXPORT), nhánh xếp việc
  // ở CHÍNH file này cũng đòi nó, và canAccessKey của files.routes.ts vừa được siết cho khớp.
  // Thiếu chốt này, người chỉ có quote:read:all lấy được file của báo giá người khác mà không hề
  // có quyền xuất — job id của BullMQ là số tăng dần nên dò cạn được.
  // Người TỰ xếp việc (requestedBy === mình) không cần kiểm lại: nhánh xếp việc đã gác rồi.
  if (requestedBy !== req.session.userId && !can(req.session, P.QUOTE_EXPORT)) {
    res.status(403).json({ error: "Bạn không có quyền tải file xuất của báo giá này" });
    return null;
  }
  // VIEW BỊ LƯỢC (RBAC-06) không lấy được file đầy đủ giá qua đường nào — nay là BỐN đường tới cùng
  // một tệp: export.routes.ts, nhánh xếp việc ở file này, canAccessKey (files.routes.ts), và GET
  // /jobs/:queue/:id[/file] ở đây (hồi quy do gộp RBAC-06 × RT-02, soát chéo 2026-09-23: route /file
  // cùng origin biến job id tăng dần thành đường tải thật). Không điều kiện requestedBy: tài khoản
  // lược không tự xếp việc được, còn job xếp TRƯỚC khi bị gán internal:view vẫn sống tới 6 giờ.
  if (biLuocView(req.session)) {
    res.status(403).json({ error: "Bạn chỉ được xem phần được giao của báo giá này" });
    return null;
  }
  return job;
}

/** Đường tải CÙNG ORIGIN của một job xuất đã xong — thay cho URL đã ký trỏ vào kho nội bộ. */
const duongTaiFile = (queue: string, id: string | number | undefined) => `/api/jobs/${encodeURIComponent(queue)}/${encodeURIComponent(String(id))}/file`;

router.get(
  "/jobs/:queue/:id",
  requireAuth,
  validate({ params: z.object({ queue: z.string().min(1).max(40), id: z.string().min(1).max(40) }) }),
  asyncHandler(async (req: Request, res: Response) => {
    const job = await layJobXuat(req, res);
    if (!job) return;
    // Trần thời gian cho getState. Quá hạn thì trả 503 + mã RIÊNG (RT-03), KHÔNG trả "unknown":
    // client coi "unknown" là trạng thái KẾT THÚC (đúng nghĩa của BullMQ — job đã bị dọn) và bỏ chờ
    // với lời nhắn "không còn tồn tại", trong khi job vẫn đang chạy. 503 job_state_timeout thì
    // client (web/src/lib/exportQuote.ts) nghỉ một nhịp rồi hỏi lại.
    const state = await xepViecCoHan<string>(() => job.getState(), { queueName: req.params.queue, jobName: "getState" });
    if (state == null) return traHangDoiCham(res);
    // URL tải là đường CÙNG ORIGIN qua app (RT-02/FILE-08). URL đã ký cũ mang host của S3_ENDPOINT
    // (`http://minio:9000` ở production) — trình duyệt không phân giải được. Job cũ còn trong Redis
    // có `url` đã ký thì cũng bị thay: chỉ `key` là dùng được.
    const rv = job.returnvalue as { key?: string; size?: number; filename?: string; url?: string } | null | undefined;
    const returnvalue = rv && typeof rv === "object" && rv.key
      ? { key: rv.key, size: rv.size, filename: rv.filename, url: duongTaiFile(req.params.queue, job.id) }
      : rv ?? null;
    res.json({
      id: job.id,
      name: job.name,
      state,
      progress: job.progress,
      data: job.data,
      returnvalue,
      failedReason: job.failedReason,
      attemptsMade: job.attemptsMade,
      createdAt: job.timestamp ? new Date(job.timestamp) : null,
      finishedAt: job.finishedOn ? new Date(job.finishedOn) : null,
    });
  })
);

// PHÁT FILE XUẤT NỀN QUA APP (proxy), không đưa URL đã ký của kho cho trình duyệt.
//
// Kho object ở production chỉ nằm trong mạng docker `internal` (không publish cổng 9000), nên URL
// đã ký theo S3_ENDPOINT không mở được từ Internet — đường xuất nền, lối thoát DUY NHẤT cho báo giá
// quá 20.000 dòng, sinh file đủ mà người dùng không tải được. Proxy giữ kho đóng kín, không cần
// biến môi trường mới, và gác quyền bằng CHÍNH hàm của đường trạng thái.
router.get(
  "/jobs/:queue/:id/file",
  requireAuth,
  validate({ params: z.object({ queue: z.string().min(1).max(40), id: z.string().min(1).max(40) }) }),
  asyncHandler(async (req: Request, res: Response) => {
    const job = await layJobXuat(req, res);
    if (!job) return;
    const rv = job.returnvalue as { key?: string; filename?: string } | null | undefined;
    // Chỉ phát khoá dưới exports/ — returnvalue nằm trong Redis, không để nó trỏ sang chứng từ.
    if (!rv?.key || !/^exports\/[^/]+$/.test(rv.key)) {
      return res.status(404).json({ error: "Tác vụ chưa có file để tải (chưa xong hoặc đã hỏng)" });
    }
    const obj = await getObjectStream(rv.key);
    if (!obj) return res.status(404).json({ error: "File xuất đã hết hạn hoặc bị dọn — hãy bấm tải lại" });
    // Cùng bộ lọc hẹp như tenFileXuat: tên đi thẳng vào header, mọi nháy/chấm phẩy phải chết.
    const ten = String(rv.filename || rv.key.split("/").pop() || "download").replace(/[^A-Za-z0-9._-]/g, "_");
    res.setHeader("Content-Type", obj.contentType || "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${ten}"`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (obj.contentLength != null) res.setHeader("Content-Length", String(obj.contentLength));
    await pipeline(obj.body, res).catch((e: unknown) => {
      // Header đã gửi → không trả JSON được nữa; cắt kết nối để trình duyệt báo tải hỏng.
      res.destroy(e instanceof Error ? e : new Error(String(e)));
    });
  })
);

export default router;
