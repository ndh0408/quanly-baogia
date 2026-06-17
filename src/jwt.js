import jwt from "jsonwebtoken";
import { randomBytes, createHash } from "node:crypto";
import { prisma } from "./db.js";
import { config } from "./config.js";

/**
 * Access + refresh token strategy.
 *
 * - Access token: JWT, short-lived (15m), signed with JWT_SECRET, payload = {sub, role}.
 * - Refresh token: opaque 32-byte hex string, stored hashed in RefreshToken row.
 *   Each refresh issues a NEW token + revokes the old one (rotation).
 *   If a revoked token is presented again, the WHOLE family is revoked (replay attack).
 */

const JWT_ISSUER = "quanly";
const JWT_AUDIENCE = "quanly-api";

export function signAccessToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, username: user.username },
    config.JWT_SECRET,
    { expiresIn: config.JWT_ACCESS_TTL, algorithm: "HS256", issuer: JWT_ISSUER, audience: JWT_AUDIENCE }
  );
}

export function verifyAccessToken(token) {
  // Pin the algorithm (defence-in-depth against alg-confusion / alg:none) and
  // bind issuer/audience.
  return jwt.verify(token, config.JWT_SECRET, {
    algorithms: ["HS256"],
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  });
}

function hashToken(plain) {
  return createHash("sha256").update(plain).digest("hex");
}

export async function issueRefreshToken(userId, { ip, userAgent, family }) {
  const plain = randomBytes(32).toString("hex");
  const tokenHash = hashToken(plain);
  const fam = family || randomBytes(8).toString("hex");
  const expiresAt = new Date(Date.now() + config.JWT_REFRESH_TTL_DAYS * 86400_000);
  await prisma.refreshToken.create({
    data: { userId, tokenHash, family: fam, ip: ip || null, userAgent: userAgent || null, expiresAt },
  });
  return { token: plain, family: fam, expiresAt };
}

/**
 * Verify a refresh token, rotate it (issue a new one + revoke this one),
 * and return new pair. If the token is already revoked but valid, revoke the
 * entire family — this is a replay attack signal.
 */
export async function rotateRefreshToken(plain, { ip, userAgent }) {
  if (!plain) throw Object.assign(new Error("Thiếu refresh token"), { status: 401 });
  const tokenHash = hashToken(plain);
  const row = await prisma.refreshToken.findUnique({ where: { tokenHash } });
  if (!row) throw Object.assign(new Error("Refresh token không hợp lệ"), { status: 401 });

  if (row.revokedAt) {
    // Replay! Burn the entire family.
    await prisma.refreshToken.updateMany({
      where: { family: row.family, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    throw Object.assign(new Error("Refresh token không còn hợp lệ, vui lòng đăng nhập lại"), { status: 401 });
  }
  if (row.expiresAt < new Date()) {
    await prisma.refreshToken.update({ where: { id: row.id }, data: { revokedAt: new Date() } });
    throw Object.assign(new Error("Refresh token đã hết hạn, vui lòng đăng nhập lại"), { status: 401 });
  }

  // Atomic compare-and-set: flip revokedAt null -> now in a single statement.
  // Only ONE concurrent request can win (count === 1). If two requests race the
  // same valid token, the loser sees count === 0 — that is a double-spend/replay
  // signal, so we burn the whole family and reject. (Replaces the previous
  // non-atomic find-then-update which allowed both racers to rotate.)
  const claimed = await prisma.refreshToken.updateMany({
    where: { id: row.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (claimed.count !== 1) {
    await prisma.refreshToken.updateMany({
      where: { family: row.family, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    throw Object.assign(new Error("Refresh token không còn hợp lệ, vui lòng đăng nhập lại"), { status: 401 });
  }

  // Verify account state BEFORE issuing the new token so we never create an
  // orphaned, still-valid refresh token for a locked/deleted account.
  const user = await prisma.user.findUnique({ where: { id: row.userId } });
  if (!user || !user.active) {
    throw Object.assign(new Error("Tài khoản đã bị khóa"), { status: 401 });
  }
  const newPair = await issueRefreshToken(row.userId, { ip, userAgent, family: row.family });
  return { user, refresh: newPair };
}

export async function revokeRefreshToken(plain) {
  if (!plain) return;
  const tokenHash = hashToken(plain);
  await prisma.refreshToken.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  }).catch(() => {});
}

export async function revokeAllForUser(userId) {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
