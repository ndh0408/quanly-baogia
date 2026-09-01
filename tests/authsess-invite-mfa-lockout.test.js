/**
 * CỤM auth-session — CỔNG MFA CỦA /accept-invite KHÔNG CÓ BỘ ĐẾM KHOÁ (src/services/authService.ts).
 *
 * ── LỖI ─────────────────────────────────────────────────────────────────────────────────
 * Cổng MFA ở đường ĐĂNG NHẬP (src/authCore.ts) đếm mã sai vào `failedAttempts` và khoá tài khoản khi
 * chạm `LOGIN_MAX_ATTEMPTS`. Cổng MFA MỚI ở `acceptInvite` thì chỉ ghi một dòng audit rồi ném lỗi —
 * và vì nó ném TRƯỚC `prisma.user.update`, token mời/đặt-lại KHÔNG bị tiêu thụ, nên cùng một token
 * thử lại được không giới hạn suốt vòng đời của nó.
 *
 * ── TÁI HIỆN ────────────────────────────────────────────────────────────────────────────
 * Bắn liên tiếp LOGIN_MAX_ATTEMPTS + 1 request POST /api/auth/accept-invite với `mfaToken` 6 số bịa,
 * dùng ĐÚNG MỘT token. Trước bản vá: `failedAttempts` vẫn 0, `lockedUntil` vẫn null, request thứ N
 * vẫn được cổng MFA phục vụ như request đầu.
 *
 * ── HẬU QUẢ ─────────────────────────────────────────────────────────────────────────────
 * Kẻ đã chiếm hộp thư nạn nhân (đúng mô hình đe doạ mà cổng MFA này sinh ra để chặn) dò được cả
 * không gian 10^6 mã TOTP bằng nhiều IP, trong khi nạn nhân KHÔNG hề bị khoá và không có tín hiệu
 * nào để nhận ra. Chốt duy nhất còn lại là apiLimiter 120 request/phút chung cho cả API.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import speakeasy from "speakeasy";
import bcrypt from "bcryptjs";
import { prisma } from "../src/db.js";
import { config } from "../src/config.js";
import { agentWithCsrf } from "./helpers/agent.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "User" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") {
  throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres — test cụm auth-session không được skip trong CI");
}

const TAG = `asxInvLock${Date.now()}`;
const NEW_PW = "MatKhauMoi123";
const SECRET = "JBSWY3DPEHPK3PXP";
const hashInvite = (t) => createHash("sha256").update(String(t)).digest("hex");

describe.runIf(dbAvailable)("cổng MFA của /accept-invite phải có bộ đếm khoá", () => {
  let app, userId;

  beforeAll(async () => {
    ({ createApp: app } = await import("../src/app.js"));
    app = app();
    const u = await prisma.user.create({
      data: {
        username: `${TAG}u`,
        displayName: "Invite MFA Lockout",
        passwordHash: bcrypt.hashSync("CuKy123", 4),
        active: true,
        mfaEnabled: true,
        mfaSecret: SECRET,
      },
    });
    userId = u.id;
  });

  afterAll(async () => {
    await prisma.auditEvent.deleteMany({ where: { actorId: userId } }).catch(() => {});
    await prisma.user.delete({ where: { id: userId }, includeDeleted: true }).catch(() => {});
  });

  const capToken = async () => {
    const token = `${TAG}${Math.random().toString(16).slice(2)}`;
    await prisma.user.update({
      where: { id: userId },
      data: {
        inviteTokenHash: hashInvite(token),
        inviteExpiresAt: new Date(Date.now() + 3600_000),
        mfaLastStep: null,
        failedAttempts: 0,
        lockedUntil: null,
      },
    });
    return token;
  };

  it("mã MFA sai liên tiếp làm tăng failedAttempts rồi KHOÁ tài khoản", async () => {
    const token = await capToken();

    for (let i = 1; i <= config.LOGIN_MAX_ATTEMPTS; i++) {
      const r = await agentWithCsrf(app)
        .post("/api/auth/accept-invite")
        .send({ token, displayName: "X", password: NEW_PW, mfaToken: "000000" });
      expect([401, 423]).toContain(r.status);
      const u = await prisma.user.findUnique({ where: { id: userId }, select: { failedAttempts: true } });
      // Bộ đếm phải nhích theo TỪNG lần sai — nếu không thì không có gì chặn vòng lặp dò mã.
      expect(u.failedAttempts).toBe(i);
    }

    const daKhoa = await prisma.user.findUnique({ where: { id: userId }, select: { lockedUntil: true } });
    expect(daKhoa.lockedUntil).not.toBeNull();
    expect(daKhoa.lockedUntil.getTime()).toBeGreaterThan(Date.now());
  });

  it("khi đã khoá thì mã TOTP ĐÚNG cũng không đổi được mật khẩu", async () => {
    // Cố ý KHÔNG gọi capToken (nó xoá khoá): tái dùng token cũ, chỉ cấp lại hạn.
    const token = `${TAG}${Math.random().toString(16).slice(2)}`;
    await prisma.user.update({
      where: { id: userId },
      data: { inviteTokenHash: hashInvite(token), inviteExpiresAt: new Date(Date.now() + 3600_000), mfaLastStep: null },
    });
    const truoc = await prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });

    const r = await agentWithCsrf(app)
      .post("/api/auth/accept-invite")
      .send({ token, displayName: "X", password: NEW_PW, mfaToken: speakeasy.totp({ secret: SECRET, encoding: "base32" }) });

    expect(r.status).toBe(423);
    const sau = await prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
    expect(sau.passwordHash).toBe(truoc.passwordHash);
  });

  it("mã ĐÚNG sau khi khoá HẾT HẠN thì xoá bộ đếm và đặt lại được mật khẩu", async () => {
    const token = `${TAG}${Math.random().toString(16).slice(2)}`;
    await prisma.user.update({
      where: { id: userId },
      data: {
        inviteTokenHash: hashInvite(token),
        inviteExpiresAt: new Date(Date.now() + 3600_000),
        mfaLastStep: null,
        // Khoá đã qua: người dùng thật quay lại sau 15 phút phải vào được, và bộ đếm phải về 0 —
        // nếu để nó nằm ở ngưỡng thì lần gõ sai kế tiếp (dù nhiều ngày sau) khoá tiếp một chu kỳ.
        lockedUntil: new Date(Date.now() - 60_000),
        failedAttempts: config.LOGIN_MAX_ATTEMPTS,
      },
    });

    const r = await agentWithCsrf(app)
      .post("/api/auth/accept-invite")
      .send({ token, displayName: "X", password: NEW_PW, mfaToken: speakeasy.totp({ secret: SECRET, encoding: "base32" }) });

    expect(r.status).toBe(200);
    const sau = await prisma.user.findUnique({ where: { id: userId }, select: { failedAttempts: true, lockedUntil: true } });
    expect(sau.failedAttempts).toBe(0);
    expect(sau.lockedUntil).toBeNull();
  });

  // Limiter theo IP KHÔNG kiểm được bằng request thật: createLimiter (src/rateLimit.ts:21) trả
  // middleware rỗng khi NODE_ENV=test, cố ý, để bộ đếm Redis dùng chung không gây 429 giả. Nên chốt
  // ở đây kiểm THEO CẤU TRÚC: route /accept-invite phải được gắn một limiter riêng, đúng như /login
  // và /forgot-password — không có nó thì trần duy nhất là apiLimiter 120 req/phút cho cả API.
  it("route /accept-invite được gắn limiter riêng", () => {
    const src = readFileSync(new URL("../src/routes/auth.routes.ts", import.meta.url), "utf8");
    const khoi = src.slice(src.indexOf('"/accept-invite"'), src.indexOf('"/accept-invite"') + 400);
    expect(khoi).toMatch(/Limiter/);
    expect(src).toMatch(/createLimiter\(\s*"accept-invite"/);
  });
});
