/**
 * AUTH-02 — KHOÁ TẠM DO GÕ SAI (`lockedUntil`) KHÔNG ĐƯỢC GIẾT PHIÊN ĐANG MỞ.
 *
 * ── LỖI ─────────────────────────────────────────────────────────────────────────────────
 * enforceActiveUser (và bearerAuth) coi `lockedUntil > now` y như `active = false`: huỷ phiên, trả
 * 401 session_revoked. Mà lockedUntil do NGƯỜI LẠ đặt được — 5 lần POST /api/auth/login ẩn danh với
 * mật khẩu bừa. Kết quả: chủ tài khoản đang soạn báo giá bị đá ra, đăng nhập lại thì nhận 423,
 * và kẻ tấn công lặp lại mỗi 15 phút.
 *
 * ── HÀNH VI ĐÚNG ────────────────────────────────────────────────────────────────────────
 *   · phiên đã xác thực tiếp tục làm việc được trong cửa sổ khoá;
 *   · /login với mật khẩu ĐÚNG vẫn 423 trong cửa sổ khoá (lockout vẫn chặn cấp phiên MỚI);
 *   · active=false vẫn huỷ phiên ngay (đường off-boarding không bị nới).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import { agentWithCsrf } from "./helpers/agent.js";
import { prisma } from "../src/db.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "User" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") {
  throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");
}

const TAG = `aukt${Date.now()}`;
const MAT_KHAU = "KhoaTam1234!ok";

describe.runIf(dbAvailable)("AUTH-02 — lockedUntil chặn cấp phiên mới, không đá phiên đang mở", () => {
  let app, user;

  beforeAll(async () => {
    app = (await import("../src/app.js")).createApp();
    user = await prisma.user.create({
      data: { username: `${TAG}-u`, displayName: "Khoa tam", role: "manager", passwordHash: await bcrypt.hash(MAT_KHAU, 4), active: true },
    });
  }, 60_000);

  afterAll(async () => {
    await prisma.auditEvent.deleteMany({ where: { OR: [{ actorId: user?.id }, { resourceId: String(user?.id) }] } }).catch(() => {});
    await prisma.loginAttempt.deleteMany({ where: { username: { startsWith: TAG } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true, includeDeleted: true }).catch(() => {});
  });

  it("5 lần gõ sai từ nơi khác → phiên đang mở VẪN 200; đăng nhập mới vẫn 423; khoá tài khoản thì phiên chết", async () => {
    const chuTaiKhoan = agentWithCsrf(app);
    const l = await chuTaiKhoan.post("/api/auth/login").send({ username: user.username, password: MAT_KHAU });
    expect(l.status).toBe(200);
    expect((await chuTaiKhoan.get("/api/auth/me")).status).toBe(200);

    // Kẻ lạ, không cookie, bắn mật khẩu bừa cho tới khi tài khoản bị khoá tạm.
    for (let i = 0; i < 5; i++) {
      await agentWithCsrf(app).post("/api/auth/login").send({ username: user.username, password: `Sai${i}xyz123` });
    }
    const hang = await prisma.user.findUnique({ where: { id: user.id }, select: { lockedUntil: true } });
    expect(hang.lockedUntil && hang.lockedUntil > new Date(), "tiền đề: tài khoản phải đang bị khoá tạm").toBe(true);

    const me = await chuTaiKhoan.get("/api/auth/me");
    expect(me.status, `phiên đã xác thực bị đá ra vì người lạ gõ sai: ${JSON.stringify(me.body)}`).toBe(200);

    // Lockout vẫn giữ nguyên tác dụng ở đường CẤP phiên mới.
    const moi = await agentWithCsrf(app).post("/api/auth/login").send({ username: user.username, password: MAT_KHAU });
    expect(moi.status).toBe(423);

    // Đối trọng: off-boarding vẫn cắt phiên ngay.
    await prisma.user.update({ where: { id: user.id }, data: { active: false } });
    const sauKhoa = await chuTaiKhoan.get("/api/auth/me");
    expect(sauKhoa.status).toBe(401);
    expect(sauKhoa.body.code).toBe("session_revoked");
  }, 60_000);
});
