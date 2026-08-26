/**
 * CỤM auth-session — "QUÊN MẬT KHẨU" cũng phân biệt HOA/thường (src/services/authService.ts).
 *
 * ── LỖI ─────────────────────────────────────────────────────────────────────────────────
 * `sendPasswordReset` tra cứu bằng `findFirst({ OR: [{ email }, { username: email }] })` — so sánh
 * byte-for-byte y như đường đăng nhập, vì cột khai là String @unique thường (không citext).
 *
 * ── TÁI HIỆN ────────────────────────────────────────────────────────────────────────────
 * Tài khoản có email "An.Nguyen@Example.vn". Người dùng gõ "an.nguyen@example.vn" (bàn phím điện
 * thoại tự hạ chữ) vào ô Quên mật khẩu → không tìm thấy hàng nào → KHÔNG có token nào được cấp.
 *
 * ── HẬU QUẢ ─────────────────────────────────────────────────────────────────────────────
 * Endpoint LUÔN trả 200 để chống dò tài khoản, nên người dùng không hề biết là không có gì xảy ra:
 * họ ngồi chờ một email không bao giờ tới. Đây chính là mặt còn lại của lỗi đăng nhập hoa/thường —
 * đường tự phục hồi duy nhất cũng hỏng theo, buộc phải gọi admin.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import { prisma } from "../src/db.js";
import { sendPasswordReset } from "../src/services/authService.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "User" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") {
  throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres — test cụm auth-session không được skip trong CI");
}

const TAG = `asxFgt${Date.now()}`;
const EMAIL = `${TAG}.Hoa@Example.VN`;

describe.runIf(dbAvailable)("quên mật khẩu — không phân biệt hoa/thường", () => {
  let userId;

  beforeAll(async () => {
    const u = await prisma.user.create({
      data: { username: `${TAG}u`, email: EMAIL, displayName: "Forgot Case", passwordHash: bcrypt.hashSync("Abc12345", 4), active: true },
    });
    userId = u.id;
  });

  afterAll(async () => {
    await prisma.auditEvent.deleteMany({ where: { actorId: userId } }).catch(() => {});
    await prisma.user.delete({ where: { id: userId }, includeDeleted: true }).catch(() => {});
  });

  // sendPasswordReset chạy nền và tự nuốt lỗi (kể cả lỗi SMTP), nhưng nó GHI inviteTokenHash TRƯỚC
  // khi gửi mail — nên cột đó là bằng chứng đáng tin cho việc "có cấp token hay không".
  const doiCapToken = async () => {
    for (let i = 0; i < 60; i++) {
      const u = await prisma.user.findUnique({ where: { id: userId }, select: { inviteTokenHash: true } });
      if (u.inviteTokenHash) return u.inviteTokenHash;
      await new Promise((r) => setTimeout(r, 100));
    }
    return null;
  };

  it("email gõ VIẾT THƯỜNG vẫn cấp được token đặt lại", async () => {
    await prisma.user.update({ where: { id: userId }, data: { inviteTokenHash: null, inviteExpiresAt: null } });
    sendPasswordReset({ body: { email: EMAIL.toLowerCase() }, headers: {}, ip: "127.0.0.1" });
    expect(await doiCapToken()).toBeTruthy();
  });

  it("email KHÔNG tồn tại thì vẫn không cấp gì (không mở đường dò tài khoản)", async () => {
    await prisma.user.update({ where: { id: userId }, data: { inviteTokenHash: null, inviteExpiresAt: null } });
    sendPasswordReset({ body: { email: `khong-ton-tai-${TAG}@example.vn` }, headers: {}, ip: "127.0.0.1" });
    await new Promise((r) => setTimeout(r, 500));
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { inviteTokenHash: true } });
    expect(u.inviteTokenHash).toBeNull();
  });
});
