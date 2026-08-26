// Cụm quote-concurrency — transaction dùng TIMEOUT MẶC ĐỊNH 5s của Prisma.
//
// ── LỖI ─────────────────────────────────────────────────────────────────────
// `src/db.ts` khởi tạo PrismaClient chỉ với `adapter` + `log`, KHÔNG có `transactionOptions`.
// Prisma mặc định `timeout: 5s` / `maxWait: 2s` cho MỌI `$transaction` tương tác, và không chỗ nào
// trong repo truyền options riêng (`grep -rn "timeout:" src/` chỉ ra src/webhooks.ts).
//
// ── TÁI HIỆN ────────────────────────────────────────────────────────────────
// Một transaction chạy quá 5 giây bị Prisma CẮT NGANG và rollback (P2028). Bài dưới dùng
// `pg_sleep(6)` cho rẻ và tất định; ngoài đời chỗ chạm trần là đường LƯU báo giá
// (`updateQuote`): trong MỘT transaction nó xoá sạch sheet → tạo lại toàn bộ item → đọc lại cả báo
// giá qua QUOTE_INCLUDE (kèm cột `images` base64) → `snapshotQuoteVersion` đọc THÊM lần nữa rồi ghi
// một khối jsonb chứa mọi item. Trần payload cho phép 60 trang × 1000 dòng.
//
// ── HẬU QUẢ ─────────────────────────────────────────────────────────────────
// Báo giá đủ lớn thì KHÔNG LƯU ĐƯỢC NỮA: rollback toàn bộ, người dùng mất trắng lần sửa, và
// `src/middleware.ts` chưa map P2028 nên giao diện chỉ hiện "Lỗi server" 500 — không manh mối gì.
import { describe, it, expect } from "vitest";
import { prisma } from "../src/db.js";

const dbAvailable = await prisma.$queryRawUnsafe("SELECT 1").then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");

describe.runIf(dbAvailable)("cấu hình transaction của PrismaClient (src/db.ts)", () => {
  it("transaction chạy 6 giây KHÔNG bị cắt (trần mặc định 5s đã được nâng)", async () => {
    const chay = prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe("SELECT 1 AS ok FROM pg_sleep(6)");
      return "xong";
    });
    await expect(chay, "trần 5s mặc định của Prisma cắt ngang → P2028, lần Lưu mất trắng").resolves.toBe("xong");
  }, 30_000);
});
