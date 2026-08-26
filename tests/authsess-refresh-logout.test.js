/**
 * CỤM auth-session — ba lỗi ở vòng đời refresh token (src/jwt.ts, src/routes/auth.routes.ts).
 *
 * ── LỖI 1: xoay refresh token BỎ QUA trạng thái khoá tài khoản ─────────────────────────
 * TÁI HIỆN: đặt lockedUntil ở tương lai rồi gọi rotateRefreshToken. Hàm chỉ kiểm
 * `if (!user || !user.active)` — trong khi bearerAuth (src/middleware.ts:38) và enforceActiveUser
 * (:96) đều kiểm cả lockedUntil.
 * HẬU QUẢ: tài khoản đang bị khoá vì dò mật khẩu vẫn tiếp tục làm mới được thông tin đăng nhập của
 * mình suốt cửa sổ khoá, nên khoá không cắt được chuỗi credential — nó chỉ hoãn.
 *
 * ── LỖI 2: HỌ token không có tuổi thọ tuyệt đối ────────────────────────────────────────
 * TÁI HIỆN: mỗi lần xoay, issueRefreshToken tính lại expiresAt từ Date.now() và TÁI DÙNG cùng
 * `family`; RefreshToken.createdAt không được dùng cho bất kỳ phép hết hạn nào.
 * HẬU QUẢ: một refresh token bị đánh cắp mà cứ được xoay đều thì sống VĨNH VIỄN — 7 ngày TTL chỉ
 * là thời hạn của từng mắt xích, không phải của cả chuỗi.
 *
 * ── LỖI 3: ĐĂNG XUẤT không thu hồi refresh token ───────────────────────────────────────
 * TÁI HIỆN: phát một refresh token cho tài khoản, đăng nhập bằng cookie rồi POST /api/auth/logout.
 * Handler chỉ destroy phiên + xoá cookie. Refresh token vẫn `revokedAt = null`.
 * HẬU QUẢ: "Đăng xuất" không đúng như tên gọi — mọi đường xoay credential khác (đổi mật khẩu, đặt
 * lại, admin sửa tài khoản) đều gọi revokeAllForUser, riêng chỗ này thì không.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import { prisma } from "../src/db.js";
import { issueRefreshToken, rotateRefreshToken } from "../src/jwt.js";
import { agentWithCsrf } from "./helpers/agent.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "RefreshToken" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") {
  throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres — test cụm auth-session không được skip trong CI");
}

const TAG = `asxRef${Date.now()}`;
const PW = "MatKhau123";
const ctx = { ip: "127.0.0.1", userAgent: "vitest" };

describe.runIf(dbAvailable)("refresh token — khoá, tuổi thọ họ, và đăng xuất", () => {
  let app, userId;

  beforeAll(async () => {
    const { createApp } = await import("../src/app.js");
    app = createApp();
    const u = await prisma.user.create({
      data: { username: `${TAG}u`, displayName: "Refresh Test", passwordHash: bcrypt.hashSync(PW, 4), active: true },
    });
    userId = u.id;
  });

  afterAll(async () => {
    await prisma.refreshToken.deleteMany({ where: { userId } }).catch(() => {});
    await prisma.loginAttempt.deleteMany({ where: { username: `${TAG}u` } }).catch(() => {});
    await prisma.auditEvent.deleteMany({ where: { actorId: userId } }).catch(() => {});
    await prisma.user.delete({ where: { id: userId }, includeDeleted: true }).catch(() => {});
  });

  it("tài khoản ĐANG KHOÁ không xoay được refresh token", async () => {
    const { token } = await issueRefreshToken(userId, ctx);
    await prisma.user.update({ where: { id: userId }, data: { lockedUntil: new Date(Date.now() + 15 * 60_000) } });
    try {
      await expect(rotateRefreshToken(token, ctx)).rejects.toThrow();
    } finally {
      await prisma.user.update({ where: { id: userId }, data: { lockedUntil: null } });
    }
  });

  it("khoá ĐÃ HẾT HẠN thì xoay lại bình thường", async () => {
    const { token } = await issueRefreshToken(userId, ctx);
    await prisma.user.update({ where: { id: userId }, data: { lockedUntil: new Date(Date.now() - 60_000) } });
    try {
      const { refresh } = await rotateRefreshToken(token, ctx);
      expect(refresh.token).toBeTruthy();
    } finally {
      await prisma.user.update({ where: { id: userId }, data: { lockedUntil: null } });
    }
  });

  it("họ token quá GIÀ thì bị đốt cả họ, không xoay được nữa", async () => {
    const { token, family } = await issueRefreshToken(userId, ctx);
    // Lùi ngày sinh của cả họ về quá xa (mọi trần hợp lý đều < 400 ngày).
    await prisma.refreshToken.updateMany({
      where: { family },
      data: { createdAt: new Date(Date.now() - 400 * 86400_000) },
    });
    await expect(rotateRefreshToken(token, ctx)).rejects.toThrow();
    const song = await prisma.refreshToken.count({ where: { family, revokedAt: null } });
    expect(song).toBe(0);
  });

  it("ĐĂNG XUẤT thu hồi mọi refresh token còn sống của tài khoản", async () => {
    await prisma.refreshToken.deleteMany({ where: { userId } });
    await issueRefreshToken(userId, ctx);
    await issueRefreshToken(userId, ctx);
    expect(await prisma.refreshToken.count({ where: { userId, revokedAt: null } })).toBe(2);

    const agent = agentWithCsrf(app);
    const dn = await agent.post("/api/auth/login").send({ username: `${TAG}u`, password: PW });
    expect(dn.status).toBe(200);
    const dx = await agent.post("/api/auth/logout").send({});
    expect(dx.status).toBe(200);

    expect(await prisma.refreshToken.count({ where: { userId, revokedAt: null } })).toBe(0);
  });
});
