// Shared credential authentication for both the cookie-session (/login) and the
// JWT (/token) flows. Consolidating them removes the copy-paste drift the audit
// found and applies the same hardening to both:
//   - constant-ish time: bcrypt runs even for unknown users (no enumeration oracle)
//   - atomic failedAttempts increment (no lockout bypass under concurrency)
//   - consistent LoginAttempt telemetry + audit on every branch
//   - single-use MFA backup codes consumed on success
import bcrypt from "bcryptjs";
import speakeasy from "speakeasy";
import { prisma } from "./db.js";
import { config } from "./config.js";
import { audit } from "./audit.js";
import { decryptSecret, consumeBackupCode } from "./mfa.js";

// A fixed bcrypt hash to compare against when the user doesn't exist, so the
// response time matches the real path (defeats username enumeration by timing).
const DUMMY_HASH = bcrypt.hashSync("timing-equalizer-not-a-real-password", config.BCRYPT_COST);

export function clientIp(req) {
  return (req.headers["x-forwarded-for"]?.split(",")[0]?.trim()) || req.ip || null;
}

/**
 * Authenticate username/password (+optional MFA).
 * Returns { ok:true, user } on success, or { ok:false, status, error, mfaRequired? }.
 * Records LoginAttempt + audit internally so callers stay thin.
 */
export async function authenticateCredentials(req, { username, password, mfaToken, flow }) {
  const ip = clientIp(req);
  const ua = req.headers["user-agent"] || null;
  const loginId = (username || "").trim();

  const recordAttempt = (success, reason) =>
    prisma.loginAttempt.create({ data: { username: loginId, ip, userAgent: ua, success, reason } }).catch(() => {});

  const user = await prisma.user.findFirst({ where: { OR: [{ username: loginId }, { email: loginId }] } });

  // Always run bcrypt (against a dummy hash if needed) BEFORE branching on
  // existence/active, so timing is uniform for unknown vs inactive vs wrong-pw.
  const passwordOk = await bcrypt.compare(password, user?.passwordHash || DUMMY_HASH);

  if (!user || !user.active) {
    await recordAttempt(false, !user ? "no_such_user" : "inactive");
    await audit(req, "login.failed", { resource: "user", resourceId: loginId, after: { reason: "no_such_user_or_inactive", flow } });
    return { ok: false, status: 401, error: "Tài khoản không tồn tại hoặc đã bị khóa" };
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    await recordAttempt(false, "locked");
    await audit(req, "login.locked", { resource: "user", resourceId: user.id, actorId: user.id, after: { flow } });
    return { ok: false, status: 423, error: `Tài khoản đang tạm khóa, vui lòng thử lại sau ${config.LOGIN_LOCKOUT_MINUTES} phút` };
  }

  if (!passwordOk) {
    // Atomic increment so concurrent wrong-password requests can't all read the
    // same pre-value and slip past the lockout threshold.
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { failedAttempts: { increment: 1 } },
      select: { failedAttempts: true },
    });
    const shouldLock = updated.failedAttempts >= config.LOGIN_MAX_ATTEMPTS;
    if (shouldLock) {
      await prisma.user.update({
        where: { id: user.id },
        data: { lockedUntil: new Date(Date.now() + config.LOGIN_LOCKOUT_MINUTES * 60_000) },
      });
    }
    await recordAttempt(false, "bad_password");
    await audit(req, "login.failed", { resource: "user", resourceId: user.id, actorId: user.id, after: { failedAttempts: updated.failedAttempts, locked: shouldLock, flow } });
    return {
      ok: false,
      status: 401,
      error: shouldLock
        ? `Sai mật khẩu nhiều lần, tài khoản tạm khóa ${config.LOGIN_LOCKOUT_MINUTES} phút`
        : "Sai mật khẩu",
    };
  }

  // MFA gate
  if (user.mfaEnabled) {
    if (!mfaToken) return { ok: false, status: 401, error: "Cần mã MFA", mfaRequired: true };
    const isTotp = /^\d{6}$/.test(mfaToken);
    let mfaOk = false;
    if (isTotp) {
      mfaOk = speakeasy.totp.verify({ secret: decryptSecret(user.mfaSecret), encoding: "base32", token: mfaToken, window: 1 });
    } else {
      const hit = consumeBackupCode(user.mfaBackupCodes, mfaToken);
      if (hit) {
        // Atomic single-use: only succeed if THIS request is the one that removes
        // the code. The `has: matched` guard means a concurrent request presenting
        // the same code finds it already gone (count 0) → cannot reuse it.
        const upd = await prisma.user.updateMany({
          where: { id: user.id, mfaBackupCodes: { has: hit.matched } },
          data: { mfaBackupCodes: { set: hit.remaining } },
        });
        mfaOk = upd.count > 0;
      }
    }
    if (!mfaOk) {
      await recordAttempt(false, "bad_mfa");
      await audit(req, "login.mfa.failed", { resource: "user", resourceId: user.id, actorId: user.id, after: { flow } });
      return { ok: false, status: 401, error: "Mã MFA không đúng", mfaRequired: true };
    }
  }

  // Success: reset counters + bookkeeping
  await prisma.user.update({
    where: { id: user.id },
    data: { failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date(), lastLoginIp: ip },
  });
  await recordAttempt(true, null);
  return { ok: true, user };
}
