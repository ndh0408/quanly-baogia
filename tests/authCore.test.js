// DB-backed tests for the shared credential authentication (lockout, wrong
// password counting, enumeration-safe unknown-user response).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import bcrypt from "bcryptjs";
import { prisma } from "../src/db.js";
import { authenticateCredentials } from "../src/authCore.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "User" LIMIT 1')
  .then(() => true)
  .catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") {
  throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres/schema — authCore test không được skip trong CI");
}

const TAG = `auth${Date.now()}`;
const PW = "Correct1!";
const fakeReq = { ip: "127.0.0.1", headers: { "user-agent": "vitest" } };

describe.runIf(dbAvailable)("authenticateCredentials", () => {
  let userId;
  beforeAll(async () => {
    const u = await prisma.user.create({
      data: { username: TAG, passwordHash: bcrypt.hashSync(PW, 4), displayName: "Auth Test", active: true },
    });
    userId = u.id;
  });
  afterAll(async () => {
    await prisma.loginAttempt.deleteMany({ where: { username: TAG } }).catch(() => {});
    await prisma.auditEvent.deleteMany({ where: { actorId: userId } }).catch(() => {});
    await prisma.user.delete({ where: { id: userId }, includeDeleted: true }).catch(() => {});
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    await prisma.user.update({ where: { id: userId }, data: { failedAttempts: 0, lockedUntil: null, active: true } });
  });

  it("accepts the correct password", async () => {
    const r = await authenticateCredentials(fakeReq, { username: TAG, password: PW, flow: "login" });
    expect(r.ok).toBe(true);
    expect(r.user.id).toBe(userId);
  });

  it("rejects a wrong password and increments failedAttempts", async () => {
    const r = await authenticateCredentials(fakeReq, { username: TAG, password: "wrong", flow: "login" });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(401);
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { failedAttempts: true } });
    expect(u.failedAttempts).toBe(1);
  });

  // Khoá 423 CHỈ dành cho người đã chứng minh biết mật khẩu — xem giải thích ở src/authCore.ts.
  // Với mật khẩu SAI, tài khoản đang khoá phải trả 401 chung, nếu không 423 thành đèn báo
  // "tài khoản này có thật" mà kẻ tấn công tự bật được bằng cách gõ sai 5 lần.
  it("tài khoản đang khoá + mật khẩu ĐÚNG → 423 (đã chứng minh danh tính)", async () => {
    await prisma.user.update({ where: { id: userId }, data: { lockedUntil: new Date(Date.now() + 60_000) } });
    const r = await authenticateCredentials(fakeReq, { username: TAG, password: PW, flow: "login" });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(423);
  });

  it("tài khoản đang khoá + mật khẩu SAI → 401 chung, không lộ là tài khoản có thật", async () => {
    await prisma.user.update({ where: { id: userId }, data: { lockedUntil: new Date(Date.now() + 60_000) } });
    const locked = await authenticateCredentials(fakeReq, { username: TAG, password: "sai-mat-khau", flow: "login" });
    const ghost = await authenticateCredentials(fakeReq, { username: "no-such-user-xyz", password: "sai-mat-khau", flow: "login" });
    expect(locked.status).toBe(401);
    expect(locked.error).toBe(ghost.error);
  });

  // TRƯỚC ĐÂY test này tự đặt tên "no enumeration" nhưng lại khẳng định ĐÚNG cái thông điệp gây rò:
  // "Tài khoản không tồn tại hoặc đã bị khóa" cho người lạ, còn "Sai mật khẩu" cho người có thật —
  // tức là nó khoá chặt lỗ hổng thay vì khoá tính chất an toàn. Nay kiểm đúng thứ cần kiểm: hai phản
  // hồi phải KHÔNG PHÂN BIỆT ĐƯỢC với nhau.
  it("người-không-tồn-tại và sai-mật-khẩu cho phản hồi giống hệt nhau (chống dò tài khoản)", async () => {
    await prisma.user.update({ where: { id: userId }, data: { lockedUntil: null, failedAttempts: 0 } });
    const ghost = await authenticateCredentials(fakeReq, { username: "no-such-user-xyz", password: "sai-mat-khau", flow: "login" });
    const real = await authenticateCredentials(fakeReq, { username: TAG, password: "sai-mat-khau", flow: "login" });
    expect(ghost.status).toBe(real.status);
    expect(ghost.error).toBe(real.error);
    // Và thông điệp không được chứa từ khoá phân loại nào.
    expect(real.error).not.toMatch(/sai mật khẩu/i);
    expect(real.error).not.toMatch(/không tồn tại/i);
  });

  it("blocks an inactive account with the same generic 401", async () => {
    await prisma.user.update({ where: { id: userId }, data: { active: false } });
    const r = await authenticateCredentials(fakeReq, { username: TAG, password: PW, flow: "login" });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(401);
  });
});
