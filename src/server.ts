// Entrypoint: process-level concerns only — Sentry, the HTTP listener,
// maintenance timers and graceful shutdown. The Express app itself is built in
// app.js (createApp) so integration tests can drive it without binding a port.
import { config } from "./config.js";
import { logger } from "./logger.js";
import { initSentry } from "./observability.js";
import { prisma } from "./db.js";
import { createApp } from "./app.js";
import { reloadRoleOverrides } from "./roleOverrides.js";

initSentry();

const app = createApp();

// (Quote expiry was removed entirely by request — no auto-expiry sweep, no
// "expired" status, and no validUntil field. Quotes stay in their last status
// until a user transitions them.)

const server = app.listen(config.PORT, () => {
  logger.info({ port: config.PORT, env: config.NODE_ENV }, `🚀 Server chạy tại http://localhost:${config.PORT}`);
  void reloadRoleOverrides(); // phân quyền động: nạp quyền ghi-đè vai trò từ DB (lỗi → dùng mặc định)
});

function shutdown(sig: string) {
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
