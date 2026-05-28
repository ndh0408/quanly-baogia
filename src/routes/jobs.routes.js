import { Router } from "express";
import { z } from "zod";
import { asyncHandler, requireAuth } from "../middleware.js";
import { validate } from "../validators.js";
import { getQueue, QUEUES, isQueueEnabled } from "../queue.js";

const router = Router();
router.use(requireAuth);

/** Async export: returns a jobId; client polls /api/jobs/:queue/:id */
router.post(
  "/quotes/:id/export",
  validate({
    params: z.object({ id: z.coerce.number().int().positive() }),
    body: z.object({ format: z.enum(["xlsx", "pdf"]).default("xlsx") }).default({}),
  }),
  asyncHandler(async (req, res) => {
    const q = getQueue(QUEUES.EXPORT);
    if (!q) return res.status(503).json({ error: "Queue chưa cấu hình (REDIS_URL trống). Dùng /api/export/:id.xlsx đồng bộ." });
    const job = await q.add(req.body.format, { quoteId: req.params.id, requestedBy: req.session.userId });
    res.status(202).json({ jobId: job.id, queue: QUEUES.EXPORT, format: req.body.format });
  })
);

router.get(
  "/jobs/:queue/:id",
  validate({ params: z.object({ queue: z.string().min(1).max(40), id: z.string().min(1).max(40) }) }),
  asyncHandler(async (req, res) => {
    if (!isQueueEnabled()) return res.status(503).json({ error: "Queue chưa cấu hình" });
    const q = getQueue(req.params.queue);
    if (!q) return res.status(404).json({ error: "Queue không tồn tại" });
    const job = await q.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: "Job không tồn tại" });
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
