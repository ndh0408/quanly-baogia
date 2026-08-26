// Entrypoint: process-level concerns only — Sentry, the HTTP listener,
// maintenance timers and graceful shutdown. The Express app itself is built in
// app.js (createApp) so integration tests can drive it without binding a port.
import { config, featureStatus } from "./config.js";
import { logger } from "./logger.js";
import { initSentry } from "./observability.js";
import { prisma } from "./db.js";
import { createApp } from "./app.js";
import { reloadRoleOverrides } from "./roleOverrides.js";
import { ensureBucket, isStorageEnabled } from "./storage.js";

initSentry();

const app = createApp();

// (Quote expiry was removed entirely by request — no auto-expiry sweep, no
// "expired" status, and no validUntil field. Quotes stay in their last status
// until a user transitions them.)

const server = app.listen(config.PORT, () => {
  logger.info({ port: config.PORT, env: config.NODE_ENV }, `🚀 Server chạy tại http://localhost:${config.PORT}`);
  // Trạng thái tính năng NẰM NGAY TRONG LOG khởi động. Trước đây muốn biết "production có đang mã
  // hoá PII không", "email có thật sự gửi không" thì phải đi đọc mã nguồn hoặc so biến môi trường
  // bằng tay. Nay một dòng log trả lời hết.
  logger.info({ features: featureStatus() }, "cấu hình tính năng");
  void reloadRoleOverrides(); // phân quyền động: nạp quyền ghi-đè vai trò từ DB (lỗi → dùng mặc định)

  // KIỂM KHO OBJECT NGAY LÚC KHỞI ĐỘNG.
  //
  // `ensureBucket()` vốn đã tồn tại nhưng KHÔNG có chỗ nào gọi. Hậu quả trên một lần triển khai
  // mới (hoặc sau khi đổi S3_BUCKET): mọi thứ trông bình thường cho tới khi kế toán bấm lưu ảnh
  // chứng từ đầu tiên — lúc đó AWS SDK ném `NoSuchBucket` và người dùng nhận đúng một cục
  // "Lỗi server" 500, không manh mối. Kiểm lúc khởi động biến một lỗi lúc-đang-dùng thành một
  // dòng log rõ ràng lúc-mới-lên.
  //
  // CỐ Ý KHÔNG cho sập tiến trình: khoá S3 của production có thể bị giới hạn quyền (không được
  // CreateBucket, vd R2 với khoá phạm vi hẹp). Cả ứng dụng không nên chết vì một tính năng phụ,
  // nhưng cũng không được im lặng.
  if (isStorageEnabled()) {
    void ensureBucket()
      .then((ok) => {
        if (ok) logger.info("kho object sẵn sàng");
        else logger.error("KHO OBJECT KHÔNG SẴN SÀNG — tải ảnh chứng từ / xuất file ra kho sẽ hỏng. Kiểm tra S3_BUCKET và quyền của khoá.");
      })
      .catch((e) => logger.error({ err: e instanceof Error ? e.message : String(e) }, "kiểm kho object thất bại"));
  } else {
    logger.warn("S3_* chưa cấu hình — ảnh chứng từ thanh toán sẽ KHÔNG lưu được (trả 503).");
  }
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
