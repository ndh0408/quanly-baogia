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

  it("returns 423 when the account is locked", async () => {
    await prisma.user.update({ where: { id: userId }, data: { lockedUntil: new Date(Date.now() + 60_000) } });
    const r = await authenticateCredentials(fakeReq, { username: TAG, password: PW, flow: "login" });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(423);
  });

  it("gives a generic 401 for an unknown user (no enumeration)", async () => {
    const r = await authenticateCredentials(fakeReq, { username: "no-such-user-xyz", password: "whatever", flow: "login" });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(401);
    expect(r.error).toMatch(/không tồn tại hoặc đã bị khóa/i);
  });

  it("blocks an inactive account with the same generic 401", async () => {
    await prisma.user.update({ where: { id: userId }, data: { active: false } });
    const r = await authenticateCredentials(fakeReq, { username: TAG, password: PW, flow: "login" });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(401);
  });
});
