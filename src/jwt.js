import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
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

function ttlSeconds(s) {
  // jsonwebtoken accepts string "15m" but we want consistent expiresAt for refresh too
  if (typeof s !== "string") return Number(s);
  const m = s.match(/^(\d+)([smhd])$/);
  if (!m) return Number(s);
  const n = Number(m[1]);
  return { s: n, m: n * 60, h: n * 3600, d: n * 86400 }[m[2]];
}

export function signAccessToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, username: user.username },
    config.JWT_SECRET,
    { expiresIn: config.JWT_ACCESS_TTL }
  );
}

export function verifyAccessToken(token) {
  return jwt.verify(token, config.JWT_SECRET);
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
  if (!plain) throw Object.assign(new Error("Missing refresh token"), { status: 401 });
  const tokenHash = hashToken(plain);
  const row = await prisma.refreshToken.findUnique({ where: { tokenHash } });
  if (!row) throw Object.assign(new Error("Invalid refresh token"), { status: 401 });

  if (row.revokedAt) {
    // Replay! Burn the entire family.
    await prisma.refreshToken.updateMany({
      where: { family: row.family, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    throw Object.assign(new Error("Refresh token replay detected — family revoked"), { status: 401 });
  }
  if (row.expiresAt < new Date()) {
    await prisma.refreshToken.update({ where: { id: row.id }, data: { revokedAt: new Date() } });
    throw Object.assign(new Error("Refresh token expired"), { status: 401 });
  }

  // Mark used, issue new
  await prisma.refreshToken.update({ where: { id: row.id }, data: { revokedAt: new Date() } });
  const newPair = await issueRefreshToken(row.userId, { ip, userAgent, family: row.family });
  const user = await prisma.user.findUnique({ where: { id: row.userId } });
  if (!user || !user.active) {
    throw Object.assign(new Error("User inactive"), { status: 401 });
  }
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
