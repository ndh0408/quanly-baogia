// Worker process. Run via `npm run worker` in its own container.
// Pulls jobs from BullMQ queues and executes them off the request thread.

import { config } from "./config.js";
import { logger } from "./logger.js";
import { prisma } from "./db.js";
import { createWorker, QUEUES, isQueueEnabled } from "./queue.js";
import { buildQuoteBuffer } from "./excel.js";
import { renderQuotePdf } from "./pdf.js";
import { putObject, presignDownload, isStorageEnabled } from "./storage.js";
import { sendEmail } from "./email.js";
import { sendTelegram } from "./telegram.js";
import { initSentry, captureError, flushSentry, exportJobsTotal } from "./observability.js";

// Increment the export_jobs_total metric around a generator (counts both the
// worker path and the inline fallback path in queue.js, so the metric is real).
async function withExportMetric(format, fn) {
  try {
    const result = await fn();
    exportJobsTotal.inc({ format, status: "success" });
    return result;
  } catch (err) {
    exportJobsTotal.inc({ format, status: "error" });
    throw err;
  }
}

// === Processors map. Used both by the worker process AND by the inline
// fallback in queue.js when REDIS_URL is not set (local dev).
export const processors = {
  [QUEUES.EXPORT]: {
    "xlsx": (job) => withExportMetric("xlsx", async () => {
      const { quoteId, requestedBy } = job.data;
      const quote = await prisma.quote.findFirst({
        where: { id: quoteId },
        include: {
          company: true,
          sheets: {
            orderBy: { order: "asc" },
            include: { template: true, items: { orderBy: { order: "asc" } } },
          },
        },
      });
      if (!quote) throw new Error("Không tìm thấy báo giá");
      const buf = await buildQuoteBuffer(quote);
      if (isStorageEnabled()) {
        const key = `exports/${quote.quoteNumber}-${Date.now()}.xlsx`;
        await putObject({
          key, body: buf,
          contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          metadata: { quoteId: String(quoteId), requestedBy: String(requestedBy || "") },
        } as any);
        const url = await presignDownload(key, { expiresIn: 24 * 3600 });
        return { key, url, size: buf.length };
      }
      return { size: buf.length, inline: buf.toString("base64") };
    }),
    "pdf": (job) => withExportMetric("pdf", async () => {
      const { quoteId, requestedBy } = job.data;
      const quote = await prisma.quote.findFirst({
        where: { id: quoteId },
        include: {
          company: true,
          sheets: { orderBy: { order: "asc" }, include: { template: true, items: { orderBy: { order: "asc" } } } },
        },
      });
      if (!quote) throw new Error("Không tìm thấy báo giá");
      const buf: any = await renderQuotePdf({
        ...quote,
        subtotal: Number(quote.subtotal),
        vat: Number(quote.vat),
        total: Number(quote.total),
        vatPercent: Number(quote.vatPercent),
      });
      if (isStorageEnabled()) {
        const key = `exports/${quote.quoteNumber}-${Date.now()}.pdf`;
        await putObject({
          key, body: buf, contentType: "application/pdf",
          metadata: { quoteId: String(quoteId), requestedBy: String(requestedBy || "") },
        } as any);
        const url = await presignDownload(key, { expiresIn: 24 * 3600 });
        return { key, url, size: buf.length };
      }
      return { size: buf.length, inline: buf.toString("base64") };
    }),
  },
  [QUEUES.EMAIL]: {
    "send": async (job) => sendEmail(job.data),
  },
  [QUEUES.WEBHOOK]: {
    "deliver": async (job) => {
      // Lazy import to avoid worker boot dependency cycles
      const { deliverWebhook } = await import("./webhooks.js");
      return deliverWebhook(job.data);
    },
  },
  [QUEUES.NOTIFY]: {
    "telegram": async (job) => sendTelegram(job.data),
  },
};

// === Standalone worker mode: spin up processors against Redis-backed queues
// ROBUST entry-check: tsx nạp worker.TS dù lệnh trỏ worker.JS (resolve .js→.ts) → so sánh phải BỎ
// đuôi .js/.ts, nếu không khối worker bị SKIP → thoát ngay, không nghe job. (Hoặc ép WORKER_MODE=true.)
const _entryUrl = process.argv[1] ? `file://${process.argv[1].replaceAll("\\", "/")}` : "";
const _stripExt = (s) => s.replace(/\.[cm]?[jt]s$/, "");
if (_stripExt(import.meta.url) === _stripExt(_entryUrl) || process.env.WORKER_MODE === "true") {
  // Worker errors were previously invisible — initialize Sentry here too so a
  // failing export/email/webhook/telegram job is reported, not just logged.
  initSentry();

  if (!isQueueEnabled()) {
    logger.error("REDIS_URL not set — worker has nothing to subscribe to");
    process.exit(1);
  }
  logger.info({ env: config.NODE_ENV }, "Worker starting");

  const workers = [];
  for (const [queueName, jobs] of Object.entries(processors)) {
    const w = createWorker(queueName, async (job) => {
      const handler = jobs[job.name];
      if (!handler) throw new Error(`Không xử lý được công việc (${queueName}/${job.name})`);
      try {
        return await handler(job);
      } catch (err) {
        // Report the failure to Sentry with job context, then rethrow so BullMQ
        // marks the job failed and applies its retry/backoff policy.
        captureError(err, { queue: queueName, jobName: job.name, jobId: job.id, data: job.data });
        logger.error({ queue: queueName, jobName: job.name, jobId: job.id, err: err.message }, "job failed");
        throw err;
      }
    }, Number(process.env.WORKER_CONCURRENCY || 4));
    if (w) workers.push(w);
    logger.info({ queue: queueName, jobs: Object.keys(jobs) }, "worker registered");
  }

  const shutdown = async (signal) => {
    logger.info({ signal }, "Worker shutting down");
    try {
      await Promise.all(workers.map((w) => w.close()));
    } finally {
      await flushSentry();
      process.exit(0);
    }
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  // A worker had no top-level crash handlers — an unexpected throw died silently.
  process.on("unhandledRejection", async (reason) => {
    logger.error({ err: reason instanceof Error ? reason.message : String(reason) }, "worker unhandledRejection");
    captureError(reason instanceof Error ? reason : new Error(String(reason)), { kind: "unhandledRejection" });
    await flushSentry();
  });
  process.on("uncaughtException", async (err) => {
    logger.error({ err: err.message, stack: err.stack }, "worker uncaughtException — exiting");
    captureError(err, { kind: "uncaughtException" });
    await flushSentry();
    process.exit(1);
  });
}
