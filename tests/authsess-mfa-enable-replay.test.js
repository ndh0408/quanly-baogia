/**
 * CỤM auth-session — MÃ TOTP DÙNG ĐỂ *BẬT* MFA CÒN DÙNG LẠI ĐƯỢC ĐỂ ĐĂNG NHẬP (src/services/mfaService.ts).
 *
 * ── LỖI ─────────────────────────────────────────────────────────────────────────────────
 * `enableMfa` xác thực mã 6 số bằng `speakeasy.totp.verify` TRẦN: không đọc, không tiến `mfaLastStep`.
 * Chốt chống replay (`claimTotpStep`, src/authCore.ts) đã được gắn vào /login và /mfa/disable, nhưng
 * bỏ sót đúng nơi mã đầu tiên của bí mật được trình ra.
 *
 * ── TÁI HIỆN ────────────────────────────────────────────────────────────────────────────
 * Bật MFA bằng mã X, rồi trong cùng cửa sổ 30 giây dùng LẠI chính X để POST /api/auth/login → 200.
 *
 * ── HẬU QUẢ ─────────────────────────────────────────────────────────────────────────────
 * Ai nhìn thấy mã X đúng lúc người dùng bật MFA (chia sẻ màn hình, người đứng sau, ảnh chụp) biến
 * được cái liếc đó thành một phiên đăng nhập đầy đủ — cùng lớp lỗi với mfa-disable-totp-replay đã vá.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import speakeasy from "speakeasy";
import bcrypt from "bcryptjs";
import { prisma } from "../src/db.js";
import { agentWithCsrf } from "./helpers/agent.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "User" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") {
  throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres — test cụm auth-session không được skip trong CI");
}

const TAG = `asxEnable${Date.now()}`;
const PW = "MatKhau123";
const SECRET = "JBSWY3DPEHPK3PXP";

describe.runIf(dbAvailable)("bật MFA phải TIÊU THỤ mã TOTP", () => {
  let app, userId, username;

  beforeAll(async () => {
    ({ createApp: app } = await import("../src/app.js"));
    app = app();
    username = `${TAG}u`;
    const u = await prisma.user.create({
      data: { username, displayName: "Enable Replay", passwordHash: bcrypt.hashSync(PW, 4), active: true },
    });
    userId = u.id;
  });

  afterAll(async () => {
    await prisma.auditEvent.deleteMany({ where: { actorId: userId } }).catch(() => {});
    await prisma.loginAttempt.deleteMany({ where: { username } }).catch(() => {});
    await prisma.user.delete({ where: { id: userId }, includeDeleted: true }).catch(() => {});
  });

  it("mã vừa dùng để BẬT MFA không đăng nhập lại được trong cùng cửa sổ", async () => {
    const agent = agentWithCsrf(app);
    expect((await agent.post("/api/auth/login").send({ username, password: PW })).status).toBe(200);

    const ma = speakeasy.totp({ secret: SECRET, encoding: "base32" });
    const bat = await agent.post("/api/mfa/enable").send({ password: PW, secret: SECRET, token: ma });
    expect(bat.status).toBe(200);

    // Mốc phải được đóng NGAY lúc bật: không có nó thì mã X còn giá trị suốt phần còn lại của cửa sổ.
    const sau = await prisma.user.findUnique({ where: { id: userId }, select: { mfaLastStep: true } });
    expect(sau.mfaLastStep).not.toBeNull();
    expect(sau.mfaLastStep).toBeGreaterThanOrEqual(Math.floor(Date.now() / 1000 / 30) - 1);

    // Trình lại CHÍNH mã đó ở một phiên khác (kẻ nhìn trộm) → phải bị từ chối.
    const ke = agentWithCsrf(app);
    const r = await ke.post("/api/auth/login").send({ username, password: PW, mfaToken: ma });
    expect(r.status).not.toBe(200);
  });
});
