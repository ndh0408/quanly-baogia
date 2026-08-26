// Retention/prune cho các bảng APPEND-ONLY phình vô hạn (AuditEvent/LoginAttempt/WebhookDelivery)
// + giới hạn số QuoteVersion/báo giá. Chạy qua repeatable BullMQ job (worker) hằng ngày.
// Mặc định RỘNG TAY (không xoá gì trong thời gian dài) + cấu hình được qua env → an toàn bật mặc định.
// LƯU Ý: các bảng này KHÔNG soft-delete (không nằm trong SOFT_DELETE_MODELS của db.ts) → deleteMany là
// HARD delete đúng ý. AuditEvent được GIỮ 2 năm theo nghĩa vụ truy vết.
import { prisma } from "./db.js";
import { logger } from "./logger.js";
import { deleteObject, listObjects, isStorageEnabled } from "./storage.js";

const days = (n: number) => new Date(Date.now() - n * 86_400_000);
const AUDIT_DAYS = Number(process.env.RETAIN_AUDIT_DAYS) || 730; // 2 năm
const LOGIN_DAYS = Number(process.env.RETAIN_LOGIN_DAYS) || 365; // 1 năm
const WEBHOOK_DAYS = Number(process.env.RETAIN_WEBHOOK_DAYS) || 90; // 90 ngày
const VERSION_KEEP = Number(process.env.RETAIN_VERSION_KEEP) || 100; // giữ N bản mới nhất / báo giá
const EXPORT_DAYS = Number(process.env.RETAIN_EXPORT_DAYS) || 30; // file xuất trong kho object

/** Xoá object nhưng KHÔNG cho một khoá hỏng làm gãy cả lượt prune (job này còn nhiều việc khác). */
async function dropObject(key: string) {
  if (!key) return false;
  try {
    await deleteObject(key);
    return true;
  } catch (e) {
    logger.warn({ key, err: e instanceof Error ? e.message : String(e) }, "retention: không xoá được object");
    return false;
  }
}

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
  // File XUẤT RA (exports/): src/worker.ts đặt khoá kèm Date.now() nên mỗi lượt xuất đẻ một object
  // MỚI, không ghi đè — bucket phình vô hạn trong khi link tải đã hết hạn sau 24h. Rác này còn được
  // `mc mirror` (cố ý không --remove) nhân bản sang bản gương rồi vào mọi tarball off-host, đẩy
  // tarball vượt trần kích thước và làm bản sao off-host của CHỨNG TỪ THANH TOÁN bị bỏ lại.
  // Chỉ đụng đúng tiền tố exports/ — logos/, uploads/, chứng từ đều KHÔNG nằm trong diện dọn.
  let exportsPruned = 0;
  if (isStorageEnabled()) {
    const cutoff = days(EXPORT_DAYS);
    for (const o of await listObjects("exports/")) {
      if (o.lastModified && o.lastModified < cutoff && (await dropObject(o.key))) exportsPruned++;
    }
  }
  // Phiên tải lên treo: ký URL rồi không bao giờ /finalize. Hàng `pending` quá hạn là rác thuần —
  // object tương ứng (nếu client có PUT lên) chưa qua xác minh nên KHÔNG dùng được, và cũng không
  // ai tải được. Xoá hàng để bảng không phình và để hạn mức MAX_PENDING_UPLOADS không kẹt oan.
  // Bản ghi `rejected` giữ lâu hơn (30 ngày) vì đó là dấu vết ai đó đẩy nội dung không hợp lệ.
  //
  // XOÁ OBJECT TRƯỚC, XOÁ HÀNG SAU. Hàng UploadObject là MANH MỐI DUY NHẤT dẫn tới `stagingKey`;
  // xoá hàng trước thì object tạm nằm lại vĩnh viễn, không còn cách nào tìm ra để dọn.
  // CHỈ xoá `stagingKey`, KHÔNG đụng `key`: /finalize copy từ staging sang `key` rồi mới đổi trạng
  // thái, nên giữa lúc ta liệt kê và lúc ta xoá, `key` có thể vừa nhận file THẬT — xoá nhầm là mất
  // dữ liệu người dùng vừa tải lên. Object ở `stagingKey` thì xoá thừa cũng vô hại (/finalize tự xoá).
  const pendingWhere = { status: "pending", expiresAt: { lt: days(1) } } as const;
  const rejectedWhere = { status: "rejected", createdAt: { lt: days(30) } } as const;
  let staleObjects = 0;
  for (const where of [pendingWhere, rejectedWhere] as const) {
    const rows = await prisma.uploadObject.findMany({ where, select: { key: true, stagingKey: true } });
    for (const u of rows) if (await dropObject(u.stagingKey)) staleObjects++;
  }
  const staleUploads = await prisma.uploadObject.deleteMany({ where: pendingWhere });
  const oldRejects = await prisma.uploadObject.deleteMany({ where: rejectedWhere });
  const result = { audit: audit.count, login: login.count, webhook: webhook.count, quoteVersion: ver, staleUploads: staleUploads.count, rejectedUploads: oldRejects.count, exports: exportsPruned, staleObjects };
  logger.info(result, "retention prune done");
  return result;
}
