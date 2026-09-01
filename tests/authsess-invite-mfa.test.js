/**
 * CỤM auth-session — ĐẶT LẠI MẬT KHẨU ĐI VÒNG QUA CỔNG MFA (src/services/authService.ts).
 *
 * ── LỖI ─────────────────────────────────────────────────────────────────────────────────
 * Cổng MFA duy nhất của hệ thống nằm trong `authenticateCredentials` (src/authCore.ts), và hàm đó
 * chỉ được gọi từ POST /api/auth/login và POST /api/auth/token. Nhưng `acceptInvite` — đường mà
 * "Quên mật khẩu" dùng chung — đặt mật khẩu mới rồi gọi thẳng `establishSession`, KHÔNG hề đọc
 * `user.mfaEnabled`.
 *
 * ── TÁI HIỆN ────────────────────────────────────────────────────────────────────────────
 * Tài khoản có mfaEnabled = true. Đưa một token mời/đặt-lại còn hạn cho POST /api/auth/accept-invite
 * kèm mật khẩu mới, KHÔNG kèm mã TOTP nào → 200 kèm cookie phiên đã đăng nhập đầy đủ.
 *
 * ── HẬU QUẢ ─────────────────────────────────────────────────────────────────────────────
 * Ai chiếm được hộp thư nạn nhân là vô hiệu hoá được lớp bảo vệ thứ hai mà nạn nhân đã CHỦ ĐỘNG
 * bật lên — đúng thứ MFA sinh ra để chặn. Tệ hơn: mfaSecret/mfaEnabled vẫn nguyên nên /me vẫn báo
 * "đã bật 2FA", nạn nhân không có dấu hiệu nào để nghi ngờ.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash } from "node:crypto";
import speakeasy from "speakeasy";
import bcrypt from "bcryptjs";
import { prisma } from "../src/db.js";
import { agentWithCsrf } from "./helpers/agent.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "User" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") {
  throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres — test cụm auth-session không được skip trong CI");
}

const TAG = `asxInv${Date.now()}`;
const NEW_PW = "MatKhauMoi123";
// Bí mật TOTP lưu dạng PLAINTEXT hợp lệ (decryptSecret trả nguyên chuỗi khi không có tiền tố
// "enc:v1:") — nhờ vậy bài test không phụ thuộc vào thời điểm nạp MFA_ENC_KEY của config.
const SECRET = "JBSWY3DPEHPK3PXP";
const hashInvite = (t) => createHash("sha256").update(String(t)).digest("hex");

describe.runIf(dbAvailable)("accept-invite phải qua cổng MFA", () => {
  let app, userId;

  beforeAll(async () => {
    ({ createApp: app } = await import("../src/app.js"));
    app = app();
    const u = await prisma.user.create({
      data: {
        username: `${TAG}u`,
        displayName: "Invite MFA Test",
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

  // Cấp một token đặt-lại mới cho mỗi kịch bản (acceptInvite xoá token sau khi dùng).
  const capToken = async () => {
    const token = `${TAG}${Math.random().toString(16).slice(2)}`;
    await prisma.user.update({
      where: { id: userId },
      data: { inviteTokenHash: hashInvite(token), inviteExpiresAt: new Date(Date.now() + 3600_000), mfaLastStep: null },
    });
    return token;
  };

  it("KHÔNG có mã MFA → 401 và mật khẩu KHÔNG bị xoay", async () => {
    const token = await capToken();
    const truoc = await prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });

    const r = await agentWithCsrf(app).post("/api/auth/accept-invite").send({ token, displayName: "X", password: NEW_PW });

    expect(r.status).toBe(401);
    expect(r.body.mfaRequired).toBe(true);
    // Chốt quan trọng: cổng phải đứng TRƯỚC prisma.user.update, nếu không thì một mã sai vẫn kịp
    // xoay mật khẩu của nạn nhân (khoá họ ra khỏi chính tài khoản mình).
    const sau = await prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
    expect(sau.passwordHash).toBe(truoc.passwordHash);
  });

  it("mã MFA SAI → 401, mật khẩu KHÔNG bị xoay", async () => {
    const token = await capToken();
    const truoc = await prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });

    const r = await agentWithCsrf(app)
      .post("/api/auth/accept-invite")
      .send({ token, displayName: "X", password: NEW_PW, mfaToken: "000000" });

    expect(r.status).toBe(401);
    const sau = await prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
    expect(sau.passwordHash).toBe(truoc.passwordHash);
  });

  it("mã TOTP ĐÚNG → đặt lại mật khẩu thành công", async () => {
    const token = await capToken();
    const mfaToken = speakeasy.totp({ secret: SECRET, encoding: "base32" });

    const r = await agentWithCsrf(app)
      .post("/api/auth/accept-invite")
      .send({ token, displayName: "X", password: NEW_PW, mfaToken });

    expect(r.status).toBe(200);
    expect(r.body.id).toBe(userId);
    const sau = await prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
    expect(bcrypt.compareSync(NEW_PW, sau.passwordHash)).toBe(true);
  });
});
