/**
 * CỤM auth-session — MÃ DỰ PHÒNG 20 KÝ TỰ PHẢI ĐI QUA ĐƯỢC LỚP ZOD CỦA MỌI ROUTE.
 *
 * ── VÌ SAO CÓ BÀI NÀY ───────────────────────────────────────────────────────────────────
 * Bản vá tăng entropy mã dự phòng (randomBytes(5) → randomBytes(10), src/mfa.ts) đổi ĐỘ DÀI mã từ
 * 10 lên 20 ký tự hex. Một nửa bản vá nằm ở chỗ khác hẳn: ba regex `^([0-9]{6}|[0-9A-Fa-f]{10,20})$`
 * ở src/routes/auth.routes.ts, src/routes/mfa.routes.ts và src/validators.ts. Nếu một trong ba bị
 * thu về `{10}` thì mọi mã dự phòng HIỆN TẠI ăn 400 "Dữ liệu không hợp lệ" — mà toàn bộ test MFA cũ
 * chỉ gọi hàm ở mức module (generateBackupCodes/consumeBackupCode) hoặc gửi mã 6 số, nên vẫn XANH.
 *
 * ── BÀI NÀY KHOÁ ────────────────────────────────────────────────────────────────────────
 * Ba bề mặt HTTP nhận mã dự phòng: POST /api/auth/login, POST /api/auth/accept-invite,
 * POST /api/mfa/disable. Cả ba phải chấp nhận mã 20 ký tự hiện tại VÀ mã 10 ký tự cũ (người dùng
 * đăng ký MFA trước bản vá vẫn phải phục hồi được).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "../src/db.js";
import { generateBackupCodes } from "../src/mfa.js";
import { agentWithCsrf } from "./helpers/agent.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "User" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") {
  throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres — test cụm auth-session không được skip trong CI");
}

const TAG = `asxBk${Date.now()}`;
const PW = "MatKhau123";
const NEW_PW = "MatKhauMoi123";
const SECRET = "JBSWY3DPEHPK3PXP";
const hashInvite = (t) => createHash("sha256").update(String(t)).digest("hex");
const sha256 = (s) => createHash("sha256").update(String(s)).digest("hex");
// Mã CŨ: 10 ký tự hex, băm SHA-256 trần — đúng định dạng còn nằm trong CSDL của người dùng cũ.
const MA_CU = "A1B2C3D4E5";
const MA_CU_2 = "F0E1D2C3B4";

describe.runIf(dbAvailable)("mã dự phòng 20 ký tự đi được qua mọi route HTTP", () => {
  let app, userId, username, plain;

  beforeAll(async () => {
    ({ createApp: app } = await import("../src/app.js"));
    app = app();
    username = `${TAG}u`;
    const bo = await generateBackupCodes(3);
    plain = bo.plain;
    // Mọi mã sinh mới phải dài 20 ký tự hex — nếu không thì bài test này không kiểm đúng thứ nó nói.
    for (const p of plain) expect(p).toMatch(/^[0-9A-F]{20}$/);
    const u = await prisma.user.create({
      data: {
        username,
        displayName: "Backup Code HTTP",
        passwordHash: bcrypt.hashSync(PW, 4),
        active: true,
        mfaEnabled: true,
        mfaSecret: SECRET,
        mfaBackupCodes: [...bo.hashed, sha256(MA_CU), sha256(MA_CU_2)],
      },
    });
    userId = u.id;
  });

  afterAll(async () => {
    await prisma.auditEvent.deleteMany({ where: { actorId: userId } }).catch(() => {});
    await prisma.loginAttempt.deleteMany({ where: { username } }).catch(() => {});
    await prisma.user.delete({ where: { id: userId }, includeDeleted: true }).catch(() => {});
  });

  it("POST /api/auth/login nhận mã dự phòng 20 ký tự", async () => {
    const r = await agentWithCsrf(app).post("/api/auth/login").send({ username, password: PW, mfaToken: plain[0] });
    expect(r.status).toBe(200);
    expect(r.body.id).toBe(userId);
  });

  it("POST /api/auth/login vẫn nhận mã CŨ 10 ký tự", async () => {
    const r = await agentWithCsrf(app).post("/api/auth/login").send({ username, password: PW, mfaToken: MA_CU });
    expect(r.status).toBe(200);
  });

  it("POST /api/auth/accept-invite nhận mã dự phòng 20 ký tự", async () => {
    const token = `${TAG}${Math.random().toString(16).slice(2)}`;
    await prisma.user.update({
      where: { id: userId },
      data: { inviteTokenHash: hashInvite(token), inviteExpiresAt: new Date(Date.now() + 3600_000) },
    });
    const r = await agentWithCsrf(app)
      .post("/api/auth/accept-invite")
      .send({ token, displayName: "X", password: NEW_PW, mfaToken: plain[1] });
    expect(r.status).toBe(200);
  });

  it("POST /api/mfa/disable nhận mã dự phòng 20 ký tự", async () => {
    const agent = agentWithCsrf(app);
    expect((await agent.post("/api/auth/login").send({ username, password: NEW_PW, mfaToken: plain[2] })).status).toBe(200);
    // Mã dự phòng dùng-một-lần: mọi mã đã dùng ở trên đều bị tiêu thụ, nên /disable dùng mã CŨ còn lại.
    const r = await agent.post("/api/mfa/disable").send({ password: NEW_PW, token: MA_CU_2 });
    expect(r.status).toBe(200);
    const sau = await prisma.user.findUnique({ where: { id: userId }, select: { mfaEnabled: true } });
    expect(sau.mfaEnabled).toBe(false);
  });
});
