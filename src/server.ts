// Entrypoint: process-level concerns only — Sentry, the HTTP listener,
// maintenance timers and graceful shutdown. The Express app itself is built in
// app.js (createApp) so integration tests can drive it without binding a port.
import { config, featureStatus } from "./config.js";
import { logger } from "./logger.js";
import { initSentry, dangKyChanSuCoTienTrinh, flushSentry } from "./observability.js";
import { prisma } from "./db.js";
import { createApp } from "./app.js";
import { reloadRoleOverrides } from "./roleOverrides.js";
import { ensureBucket, isStorageEnabled } from "./storage.js";
import { closeAllSse } from "./sse.js";

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
  // ĐÓNG SSE TRƯỚC. `server.close()` chờ mọi kết nối đang mở kết thúc, mà kết nối SSE thì theo
  // thiết kế không bao giờ kết thúc — không có bước này thì callback bên dưới KHÔNG BAO GIỜ chạy
  // và tiến trình chỉ thoát nhờ bộ đếm giờ cưỡng bức, với mã thoát 1. Tức mỗi lần deploy là một
  // lần tắt cứng: request đang dở bị cắt, và orchestrator đọc mã thoát 1 là container hỏng.
  const n = closeAllSse();
  if (n) logger.info({ sse: n }, "đã đóng kết nối SSE");

  server.close(async () => {
    await prisma.$disconnect().catch(() => {});
    // Đẩy nốt bộ đệm Sentry trước khi đi, y như src/worker.ts. Không có bước này thì lỗi ghi nhận
    // trong những giây cuối (thường là lỗi CỦA chính lần deploy) không bao giờ rời khỏi máy.
    await flushSentry();
    process.exit(0);
  });
  // Vẫn giữ lưới an toàn, nhưng nay nó là NGOẠI LỆ chứ không phải đường thoát thường ngày.
  setTimeout(() => {
    logger.error("tắt máy quá hạn 10s — thoát cưỡng bức (còn kết nối chưa đóng?)");
    process.exit(1);
  }, 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
// Sự cố cấp tiến trình: báo Sentry → flush → thoát (uncaughtException). Dùng CHUNG một chốt với
// tiến trình worker — xem khối chú thích ở src/observability.ts. Hai dòng chỉ-log trước đây vừa
// đánh mất sự kiện Sentry, vừa TẮT hành vi thoát mặc định của Node: tiến trình API ở lại phục vụ
// request sau một uncaughtException, còn /livez thì vẫn xanh.
dangKyChanSuCoTienTrinh();
