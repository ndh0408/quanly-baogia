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

// === Processors map. Used both by the worker process AND by the inline
// fallback in queue.js when REDIS_URL is not set (local dev).
export const processors = {
  [QUEUES.EXPORT]: {
    "xlsx": async (job) => {
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
      if (!quote) throw new Error("Quote not found");
      const buf = await buildQuoteBuffer(quote);
      if (isStorageEnabled()) {
        const key = `exports/${quote.quoteNumber}-${Date.now()}.xlsx`;
        await putObject({
          key, body: buf,
          contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          metadata: { quoteId: String(quoteId), requestedBy: String(requestedBy || "") },
        });
        const url = await presignDownload(key, { expiresIn: 24 * 3600 });
        return { key, url, size: buf.length };
      }
      return { size: buf.length, inline: buf.toString("base64") };
    },
    "pdf": async (job) => {
      const { quoteId, requestedBy } = job.data;
      const quote = await prisma.quote.findFirst({
        where: { id: quoteId },
        include: {
          company: true,
          sheets: { orderBy: { order: "asc" }, include: { template: true, items: { orderBy: { order: "asc" } } } },
        },
      });
      if (!quote) throw new Error("Quote not found");
      const buf = await renderQuotePdf({
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
        });
        const url = await presignDownload(key, { expiresIn: 24 * 3600 });
        return { key, url, size: buf.length };
      }
      return { size: buf.length, inline: buf.toString("base64") };
    },
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
if (import.meta.url === `file://${process.argv[1]?.replaceAll("\\", "/")}` || process.env.WORKER_MODE === "true") {
  if (!isQueueEnabled()) {
    logger.error("REDIS_URL not set — worker has nothing to subscribe to");
    process.exit(1);
  }
  logger.info({ env: config.NODE_ENV }, "Worker starting");

  const workers = [];
  for (const [queueName, jobs] of Object.entries(processors)) {
    const w = createWorker(queueName, async (job) => {
      const handler = jobs[job.name];
      if (!handler) throw new Error(`no handler for ${queueName}/${job.name}`);
      return handler(job);
    }, Number(process.env.WORKER_CONCURRENCY || 4));
    if (w) workers.push(w);
    logger.info({ queue: queueName, jobs: Object.keys(jobs) }, "worker registered");
  }

  process.on("SIGTERM", async () => {
    logger.info("Worker shutting down");
    await Promise.all(workers.map((w) => w.close()));
    process.exit(0);
  });
}
