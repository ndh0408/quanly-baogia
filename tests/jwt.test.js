// DB-backed tests for the refresh-token rotation/replay logic, including the
// compare-and-set fix that prevents a single valid token being double-spent.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../src/db.js";
import { issueRefreshToken, rotateRefreshToken } from "../src/jwt.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "RefreshToken" LIMIT 1')
  .then(() => true)
  .catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") {
  throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres/schema — jwt test không được skip trong CI");
}

const TAG = `jwt${Date.now()}`;

describe.runIf(dbAvailable)("rotateRefreshToken (rotation + replay + race)", () => {
  let userId;
  beforeAll(async () => {
    const u = await prisma.user.create({
      data: { username: TAG, passwordHash: "x", displayName: "JWT Test", active: true },
    });
    userId = u.id;
  });
  afterAll(async () => {
    await prisma.refreshToken.deleteMany({ where: { userId } }).catch(() => {});
    await prisma.user.delete({ where: { id: userId }, includeDeleted: true }).catch(() => {});
    await prisma.$disconnect();
  });

  const ctx = { ip: "127.0.0.1", userAgent: "vitest" };

  it("rotates: old token is consumed, a new working token is issued", async () => {
    const { token } = await issueRefreshToken(userId, ctx);
    const { refresh } = await rotateRefreshToken(token, ctx);
    expect(refresh.token).toBeTruthy();
    expect(refresh.token).not.toBe(token);
    // old token can no longer be rotated (it's revoked) → replay path throws
    await expect(rotateRefreshToken(token, ctx)).rejects.toThrow();
    // new token rotates fine
    const again = await rotateRefreshToken(refresh.token, ctx);
    expect(again.refresh.token).toBeTruthy();
  });

  it("replay of a revoked token burns the whole family", async () => {
    const { token, family } = await issueRefreshToken(userId, ctx);
    await rotateRefreshToken(token, ctx); // consumes `token`, issues a new one in the family
    // presenting the already-revoked `token` again = replay → burn family
    await expect(rotateRefreshToken(token, ctx)).rejects.toThrow();
    const live = await prisma.refreshToken.count({ where: { family, revokedAt: null } });
    expect(live).toBe(0);
  });

  it("double-spend race: two concurrent rotations of the SAME token → exactly one wins", async () => {
    const { token } = await issueRefreshToken(userId, ctx);
    const results = await Promise.allSettled([
      rotateRefreshToken(token, ctx),
      rotateRefreshToken(token, ctx),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.filter((r) => r.status === "rejected").length;
    expect(ok).toBe(1);
    expect(failed).toBe(1);
  });

  it("inactive account: rotation throws and does NOT leave a new valid token", async () => {
    const { token, family } = await issueRefreshToken(userId, ctx);
    await prisma.user.update({ where: { id: userId }, data: { active: false } });
    try {
      await expect(rotateRefreshToken(token, ctx)).rejects.toThrow();
      const live = await prisma.refreshToken.count({ where: { family, revokedAt: null } });
      expect(live).toBe(0); // no orphaned valid token created for a locked account
    } finally {
      await prisma.user.update({ where: { id: userId }, data: { active: true } });
    }
  });
});
