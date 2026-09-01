/**
 * CỤM auth-session — hai lỗi ở src/authCore.ts (đường đăng nhập dùng chung cho /login và /token).
 *
 * ── LỖI 1: bộ đếm đăng nhập sai KHÔNG BAO GIỜ được xoá khi khoá hết hạn ────────────────────
 * TÁI HIỆN: đặt failedAttempts = LOGIN_MAX_ATTEMPTS và lockedUntil = một mốc ĐÃ QUA, rồi gửi
 * đúng MỘT mật khẩu sai. Nhánh "còn đang khoá" ở authCore.ts chỉ `return` khi khoá còn hiệu lực,
 * không có nhánh nào xoá bộ đếm khi khoá đã hết. Nhánh sai mật khẩu increment tiếp từ 5 → 6 → lại
 * chạm ngưỡng → khoá thêm 15 phút NGAY LẬP TỨC.
 * HẬU QUẢ: sau lần khoá đầu tiên, tài khoản vĩnh viễn ở trạng thái "gõ sai 1 lần = khoá 15 phút".
 * Bộ đếm chỉ được đặt về 0 ở nhánh ĐĂNG NHẬP THÀNH CÔNG, mà muốn thành công thì phải hết khoá đã.
 * Admin cũng không gỡ được: UserUpdateSchema không có failedAttempts/lockedUntil. Kẻ tấn công khoá
 * vĩnh viễn một tài khoản bằng 4 request/giờ — dưới hẳn trần 10 request/15 phút của limiter.
 *
 * ── LỖI 2: tra cứu tài khoản phân biệt HOA/thường ─────────────────────────────────────────
 * TÁI HIỆN: tạo tài khoản username có chữ hoa, đăng nhập bằng đúng chuỗi đó viết thường.
 * findFirst so sánh byte-for-byte (Postgres không dùng citext) → không thấy tài khoản → trả về
 * thông báo mờ GENERIC_AUTH_ERROR.
 * HẬU QUẢ: người dùng gõ email viết thường (hành vi mặc định của mọi trình duyệt/điện thoại) không
 * đăng nhập được và KHÔNG được nói lý do. Mặt còn lại nguy hiểm hơn: cột @unique cũng so byte nên
 * "An@x.vn" và "an@x.vn" cùng tồn tại được — một con người thành hai tài khoản với hai tập quyền.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import bcrypt from "bcryptjs";
import { prisma } from "../src/db.js";
import { config } from "../src/config.js";
import { authenticateCredentials } from "../src/authCore.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "User" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") {
  throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres — test cụm auth-session không được skip trong CI");
}

// Tiền tố riêng của cụm auth-session để không đụng dữ liệu của bộ test chạy song song.
const TAG = `asxLock${Date.now()}`;
const PW = "Correct1!";
const fakeReq = { ip: "127.0.0.1", headers: { "user-agent": "vitest" } };

describe.runIf(dbAvailable)("authCore — khoá hết hạn & hoa/thường", () => {
  let userId;

  beforeAll(async () => {
    const u = await prisma.user.create({
      // CỐ Ý để chữ hoa trong username: đây chính là điều kiện tái hiện LỖI 2.
      data: { username: TAG, passwordHash: bcrypt.hashSync(PW, 4), displayName: "Auth Session Test", active: true },
    });
    userId = u.id;
  });

  afterAll(async () => {
    await prisma.loginAttempt.deleteMany({ where: { username: { startsWith: "asxLock" } } }).catch(() => {});
    await prisma.auditEvent.deleteMany({ where: { actorId: userId } }).catch(() => {});
    await prisma.user.delete({ where: { id: userId }, includeDeleted: true }).catch(() => {});
  });

  beforeEach(async () => {
    await prisma.user.update({ where: { id: userId }, data: { failedAttempts: 0, lockedUntil: null, active: true } });
  });

  it("khoá ĐÃ HẾT HẠN + mật khẩu sai → bộ đếm bắt đầu lại từ 1, KHÔNG khoá lại", async () => {
    await prisma.user.update({
      where: { id: userId },
      data: { failedAttempts: config.LOGIN_MAX_ATTEMPTS, lockedUntil: new Date(Date.now() - 60_000) },
    });

    const r = await authenticateCredentials(fakeReq, { username: TAG, password: "sai-mat-khau", flow: "login" });
    expect(r.ok).toBe(false);

    const u = await prisma.user.findUnique({ where: { id: userId }, select: { failedAttempts: true, lockedUntil: true } });
    expect(u.failedAttempts).toBe(1);
    expect(u.lockedUntil).toBeNull();
  });

  it("khoá ĐÃ HẾT HẠN + mật khẩu ĐÚNG → vào được (không bị khoá nối tiếp)", async () => {
    await prisma.user.update({
      where: { id: userId },
      data: { failedAttempts: config.LOGIN_MAX_ATTEMPTS, lockedUntil: new Date(Date.now() - 60_000) },
    });
    const r = await authenticateCredentials(fakeReq, { username: TAG, password: PW, flow: "login" });
    expect(r.ok).toBe(true);
  });

  it("đăng nhập bằng username viết thường vẫn nhận đúng tài khoản", async () => {
    const r = await authenticateCredentials(fakeReq, { username: TAG.toLowerCase(), password: PW, flow: "login" });
    expect(r.ok).toBe(true);
    expect(r.user.id).toBe(userId);
  });

  it("khớp CHÍNH XÁC vẫn được ưu tiên khi có hai tài khoản chỉ khác hoa/thường", async () => {
    // Bảo vệ chống hồi quy của chính bản vá: chuyển sang `mode: "insensitive"` một cách ngây thơ
    // sẽ khiến findFirst chọn NGẪU NHIÊN một trong hai hàng — tức đăng nhập vào NHẦM tài khoản.
    const other = await prisma.user.create({
      data: { username: TAG.toLowerCase(), passwordHash: bcrypt.hashSync(PW, 4), displayName: "Trùng hoa/thường", active: true },
    });
    try {
      const r = await authenticateCredentials(fakeReq, { username: TAG.toLowerCase(), password: PW, flow: "login" });
      expect(r.ok).toBe(true);
      expect(r.user.id).toBe(other.id); // khớp chính xác thắng
      const r2 = await authenticateCredentials(fakeReq, { username: TAG, password: PW, flow: "login" });
      expect(r2.ok).toBe(true);
      expect(r2.user.id).toBe(userId);
    } finally {
      await prisma.loginAttempt.deleteMany({ where: { username: TAG.toLowerCase() } }).catch(() => {});
      await prisma.auditEvent.deleteMany({ where: { actorId: other.id } }).catch(() => {});
      await prisma.user.delete({ where: { id: other.id }, includeDeleted: true }).catch(() => {});
    }
  });
});
