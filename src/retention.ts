// Retention/prune cho các bảng APPEND-ONLY phình vô hạn (AuditEvent/LoginAttempt/WebhookDelivery)
// + giới hạn số QuoteVersion/báo giá. Chạy qua repeatable BullMQ job (worker) hằng ngày.
// Mặc định RỘNG TAY (không xoá gì trong thời gian dài) + cấu hình được qua env → an toàn bật mặc định.
// LƯU Ý: các bảng này KHÔNG soft-delete (không nằm trong SOFT_DELETE_MODELS của db.ts) → deleteMany là
// HARD delete đúng ý. AuditEvent được GIỮ 2 năm theo nghĩa vụ truy vết.
import { prisma } from "./db.js";
import { logger } from "./logger.js";

const days = (n: number) => new Date(Date.now() - n * 86_400_000);
const AUDIT_DAYS = Number(process.env.RETAIN_AUDIT_DAYS) || 730; // 2 năm
const LOGIN_DAYS = Number(process.env.RETAIN_LOGIN_DAYS) || 365; // 1 năm
const WEBHOOK_DAYS = Number(process.env.RETAIN_WEBHOOK_DAYS) || 90; // 90 ngày
const VERSION_KEEP = Number(process.env.RETAIN_VERSION_KEEP) || 100; // giữ N bản mới nhất / báo giá

export async function pruneOldRecords() {
  const audit = await prisma.auditEvent.deleteMany({ where: { createdAt: { lt: days(AUDIT_DAYS) } } });
  const login = await prisma.loginAttempt.deleteMany({ where: { createdAt: { lt: days(LOGIN_DAYS) } } });
  const webhook = await prisma.webhookDelivery.deleteMany({ where: { createdAt: { lt: days(WEBHOOK_DAYS) } } });
  // QuoteVersion: giữ VERSION_KEEP bản MỚI NHẤT mỗi quote, xoá bản cũ hơn (raw — keep-top-N theo partition).
  const ver = await prisma.$executeRawUnsafe(
    `DELETE FROM "QuoteVersion" WHERE id IN (
       SELECT id FROM (
         SELECT id, row_number() OVER (PARTITION BY "quoteId" ORDER BY "createdAt" DESC, id DESC) AS rn
         FROM "QuoteVersion"
       ) t WHERE rn > $1)`,
    VERSION_KEEP
  );
  const result = { audit: audit.count, login: login.count, webhook: webhook.count, quoteVersion: ver };
  logger.info(result, "retention prune done");
  return result;
}
