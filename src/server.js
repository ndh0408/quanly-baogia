// Entrypoint: process-level concerns only — Sentry, the HTTP listener,
// maintenance timers and graceful shutdown. The Express app itself is built in
// app.js (createApp) so integration tests can drive it without binding a port.
import { config } from "./config.js";
import { logger } from "./logger.js";
import { initSentry } from "./observability.js";
import { prisma } from "./db.js";
import { audit } from "./audit.js";
import { createApp } from "./app.js";

initSentry();

const app = createApp();

// Periodic sweep: move approved/sent quotes past their validity date to "expired".
// Every other status transition is audited; this one was a silent updateMany, so
// expirations left no audit trail. Capture the affected ids first, then write a
// per-quote AuditEvent so the history is consistent with manual transitions.
async function expireStaleQuotes() {
  try {
    const now = new Date();
    const stale = await prisma.quote.findMany({
      where: { deletedAt: null, status: { in: ["approved", "sent"] }, validUntil: { lt: now } },
      select: { id: true, quoteNumber: true, status: true },
    });
    if (!stale.length) return;
    await prisma.quote.updateMany({
      where: { id: { in: stale.map((q) => q.id) } },
      data: { status: "expired", expiredAt: now },
    });
    for (const q of stale) {
      await audit(null, "quote.expired", {
        resource: "quote", resourceId: q.id, actorId: null,
        before: { status: q.status }, after: { status: "expired", reason: "validUntil_passed" },
      });
    }
    logger.info({ count: stale.length }, "expired stale quotes");
  } catch (e) {
    logger.error({ err: e.message }, "expire sweep failed");
  }
}
if (config.NODE_ENV !== "test") {
  setTimeout(expireStaleQuotes, 30_000).unref();              // shortly after boot
  setInterval(expireStaleQuotes, 6 * 60 * 60 * 1000).unref(); // every 6h
}

const server = app.listen(config.PORT, () => {
  logger.info({ port: config.PORT, env: config.NODE_ENV }, `🚀 Server chạy tại http://localhost:${config.PORT}`);
});

function shutdown(sig) {
  logger.info({ sig }, "shutting down");
  server.close(async () => {
    await prisma.$disconnect().catch(() => {});
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("unhandledRejection", (err) => logger.error({ err }, "unhandledRejection"));
process.on("uncaughtException", (err) => logger.error({ err }, "uncaughtException"));
