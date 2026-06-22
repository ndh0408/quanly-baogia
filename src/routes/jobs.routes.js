import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { asyncHandler, requireAuth } from "../middleware.js";
import { validate } from "../validators.js";
import { getQueue, QUEUES, isQueueEnabled } from "../queue.js";
import { can, canOnQuote, PERMISSIONS as P } from "../permissions.js";

const router = Router();
// requireAuth is applied PER ROUTE, not router-wide: this router is mounted at
// the /api root, so a router-wide guard would swallow every unmatched /api/*
// path (incl. /api/health and the 404 handler) with a 401.

/** Async export: returns a jobId; client polls /api/jobs/:queue/:id */
router.post(
  "/quotes/:id/export",
  requireAuth,
  validate({
    params: z.object({ id: z.coerce.number().int().positive() }),
    body: z.object({ format: z.enum(["xlsx", "pdf"]).default("xlsx") }).default({}),
  }),
  asyncHandler(async (req, res) => {
    // Authorize the EXPORT by quote ownership before enqueuing — mirrors the
    // synchronous /api/export/:id route so this path is not an IDOR bypass.
    const quote = await prisma.quote.findFirst({
      where: { id: req.params.id },
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
    if (!q) return res.status(503).json({ error: "Hệ thống hàng đợi chưa được cấu hình. Vui lòng dùng chức năng xuất file trực tiếp." });
    const job = await q.add(req.body.format, { quoteId: req.params.id, requestedBy: req.session.userId });
    res.status(202).json({ jobId: job.id, queue: QUEUES.EXPORT, format: req.body.format });
  })
);

router.get(
  "/jobs/:queue/:id",
  requireAuth,
  validate({ params: z.object({ queue: z.string().min(1).max(40), id: z.string().min(1).max(40) }) }),
  asyncHandler(async (req, res) => {
    if (!isQueueEnabled()) return res.status(503).json({ error: "Hệ thống hàng đợi chưa được cấu hình" });
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
