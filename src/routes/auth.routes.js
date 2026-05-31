import { Router } from "express";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import speakeasy from "speakeasy";
import { z } from "zod";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { asyncHandler, requireAuth } from "../middleware.js";
import { validate, LoginSchema, ChangePasswordSchema } from "../validators.js";
import { audit } from "../audit.js";
import { logger } from "../logger.js";
import { signAccessToken, issueRefreshToken, rotateRefreshToken, revokeRefreshToken, revokeAllForUser } from "../jwt.js";
import { permissionsForRole } from "../permissions.js";

const router = Router();

// Strict per-IP limit on login: blunt brute force at the network edge.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: config.RATE_LIMIT_LOGIN_PER_15M,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: "Quá nhiều lần đăng nhập sai, thử lại sau 15 phút" },
});

function clientIp(req) {
  return (req.headers["x-forwarded-for"]?.split(",")[0]?.trim()) || req.ip || null;
}

router.post(
  "/login",
  loginLimiter,
  validate({ body: LoginSchema.extend({ mfaToken: z.string().regex(/^\d{6,8}$/).optional() }) }),
  asyncHandler(async (req, res) => {
    const { username, password, mfaToken } = req.body;
    const ip = clientIp(req);
    const ua = req.headers["user-agent"] || null;

    const recordAttempt = (success, reason) =>
      prisma.loginAttempt.create({ data: { username, ip, userAgent: ua, success, reason } }).catch(() => {});

    const user = await prisma.user.findUnique({ where: { username } });

    if (!user || !user.active) {
      await recordAttempt(false, !user ? "no_such_user" : "inactive");
      await audit(req, "login.failed", { resource: "user", resourceId: username, after: { reason: "no_such_user_or_inactive" } });
      return res.status(401).json({ error: "Tài khoản không tồn tại hoặc đã bị khóa" });
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await recordAttempt(false, "locked");
      await audit(req, "login.locked", { resource: "user", resourceId: user.id, actorId: user.id });
      return res.status(423).json({
        error: `Tài khoản tạm khóa đến ${user.lockedUntil.toISOString()}`,
      });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      const next = (user.failedAttempts || 0) + 1;
      const shouldLock = next >= config.LOGIN_MAX_ATTEMPTS;
      await prisma.user.update({
        where: { id: user.id },
        data: {
          failedAttempts: next,
          lockedUntil: shouldLock
            ? new Date(Date.now() + config.LOGIN_LOCKOUT_MINUTES * 60_000)
            : null,
        },
      });
      await recordAttempt(false, "bad_password");
      await audit(req, "login.failed", {
        resource: "user",
        resourceId: user.id,
        actorId: user.id,
        after: { failedAttempts: next, locked: shouldLock },
      });
      return res.status(401).json({
        error: shouldLock
          ? `Sai mật khẩu nhiều lần, tài khoản tạm khóa ${config.LOGIN_LOCKOUT_MINUTES} phút`
          : "Sai mật khẩu",
      });
    }

    // MFA gate: if enabled, require valid TOTP or backup code before issuing session
    if (user.mfaEnabled) {
      if (!mfaToken) {
        return res.status(401).json({ error: "Cần mã MFA", mfaRequired: true });
      }
      // 6 digits = TOTP, 10 hex chars = backup code
      const isTotp = /^\d{6}$/.test(mfaToken);
      let mfaOk = false;
      if (isTotp) {
        mfaOk = speakeasy.totp.verify({ secret: user.mfaSecret, encoding: "base32", token: mfaToken, window: 1 });
      } else {
        const idx = (user.mfaBackupCodes || []).indexOf(mfaToken.toUpperCase());
        if (idx >= 0) {
          const remaining = [...user.mfaBackupCodes];
          remaining.splice(idx, 1);
          await prisma.user.update({ where: { id: user.id }, data: { mfaBackupCodes: remaining } });
          mfaOk = true;
        }
      }
      if (!mfaOk) {
        await recordAttempt(false, "bad_mfa");
        await audit(req, "login.mfa.failed", { resource: "user", resourceId: user.id, actorId: user.id });
        return res.status(401).json({ error: "Mã MFA không đúng", mfaRequired: true });
      }
    }

    // Reset lockout counters + bookkeeping
    await prisma.user.update({
      where: { id: user.id },
      data: { failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date(), lastLoginIp: ip },
    });

    // Regenerate session ID to defeat session fixation
    await new Promise((resolve, reject) =>
      req.session.regenerate((err) => (err ? reject(err) : resolve()))
    );
    req.session.userId = user.id;
    req.session.role = user.role;
    req.session.displayName = user.displayName;
    req.session.username = user.username;
    await new Promise((resolve, reject) =>
      req.session.save((err) => (err ? reject(err) : resolve()))
    );

    await recordAttempt(true, null);
    await audit(req, "login.success", { resource: "user", resourceId: user.id, actorId: user.id });
    logger.info({ userId: user.id, ip }, "login success");

    res.json({
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      phone: user.phone,
      title: user.title,
      permissions: permissionsForRole(user.role),
    });
  })
);

router.post("/logout", asyncHandler(async (req, res) => {
  const userId = req.session?.userId;
  await new Promise((resolve) => req.session.destroy(() => resolve()));
  res.clearCookie("qly.sid");
  if (userId) await audit(req, "logout", { resource: "user", resourceId: userId, actorId: userId });
  res.json({ ok: true });
}));

router.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.session.userId },
      select: { id: true, username: true, displayName: true, role: true, phone: true, title: true, lastLoginAt: true },
    });
    if (!user) return res.status(404).json({ error: "Không tìm thấy" });
    // Ship the authoritative capability list so the SPA gates UI from the server catalog.
    res.json({ ...user, permissions: permissionsForRole(user.role) });
  })
);

router.post(
  "/change-password",
  requireAuth,
  validate({ body: ChangePasswordSchema }),
  asyncHandler(async (req, res) => {
    const { oldPassword, newPassword } = req.body;
    const user = await prisma.user.findUnique({ where: { id: req.session.userId } });
    const ok = await bcrypt.compare(oldPassword, user.passwordHash);
    if (!ok) {
      await audit(req, "password.change.failed", { resource: "user", resourceId: user.id, actorId: user.id });
      return res.status(401).json({ error: "Mật khẩu cũ không đúng" });
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(newPassword, config.BCRYPT_COST) },
    });
    await audit(req, "password.change.success", { resource: "user", resourceId: user.id, actorId: user.id });
    res.json({ ok: true });
  })
);

// === JWT API surface (for mobile / SDK / public API clients) ===

router.post(
  "/token",
  loginLimiter,
  validate({ body: LoginSchema.extend({ mfaToken: z.string().regex(/^\d{6,8}$/).optional() }) }),
  asyncHandler(async (req, res) => {
    // Same shape as /login but issues JWT pair instead of setting session.
    const { username, password, mfaToken } = req.body;
    const ip = clientIp(req);
    const ua = req.headers["user-agent"] || null;

    const user = await prisma.user.findUnique({ where: { username } });
    if (!user || !user.active) return res.status(401).json({ error: "Tài khoản không tồn tại hoặc đã bị khóa" });
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      return res.status(423).json({ error: `Tài khoản tạm khóa đến ${user.lockedUntil.toISOString()}` });
    }
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      const next = (user.failedAttempts || 0) + 1;
      const lock = next >= config.LOGIN_MAX_ATTEMPTS;
      await prisma.user.update({
        where: { id: user.id },
        data: { failedAttempts: next, lockedUntil: lock ? new Date(Date.now() + config.LOGIN_LOCKOUT_MINUTES * 60_000) : null },
      });
      return res.status(401).json({ error: lock ? "Khoá tạm" : "Sai mật khẩu" });
    }

    if (user.mfaEnabled) {
      if (!mfaToken) return res.status(401).json({ error: "Cần MFA", mfaRequired: true });
      const okMfa = speakeasy.totp.verify({ secret: user.mfaSecret, encoding: "base32", token: mfaToken, window: 1 })
        || (user.mfaBackupCodes || []).includes(mfaToken.toUpperCase());
      if (!okMfa) return res.status(401).json({ error: "MFA sai", mfaRequired: true });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date(), lastLoginIp: ip },
    });

    const access = signAccessToken(user);
    const refresh = await issueRefreshToken(user.id, { ip, userAgent: ua });
    await audit(req, "login.token", { resource: "user", resourceId: user.id, actorId: user.id });
    res.json({
      tokenType: "Bearer",
      accessToken: access,
      refreshToken: refresh.token,
      refreshExpiresAt: refresh.expiresAt,
      user: { id: user.id, username: user.username, displayName: user.displayName, role: user.role },
    });
  })
);

router.post(
  "/token/refresh",
  validate({ body: z.object({ refreshToken: z.string().min(20) }) }),
  asyncHandler(async (req, res) => {
    try {
      const { user, refresh } = await rotateRefreshToken(req.body.refreshToken, {
        ip: clientIp(req),
        userAgent: req.headers["user-agent"] || null,
      });
      const access = signAccessToken(user);
      res.json({
        tokenType: "Bearer",
        accessToken: access,
        refreshToken: refresh.token,
        refreshExpiresAt: refresh.expiresAt,
      });
    } catch (e) {
      res.status(e.status || 401).json({ error: e.message });
    }
  })
);

router.post(
  "/token/revoke",
  validate({ body: z.object({ refreshToken: z.string().min(20) }) }),
  asyncHandler(async (req, res) => {
    await revokeRefreshToken(req.body.refreshToken);
    res.json({ ok: true });
  })
);

router.post(
  "/token/revoke-all",
  requireAuth,
  asyncHandler(async (req, res) => {
    await revokeAllForUser(req.session.userId);
    await audit(req, "token.revoke-all", { resource: "user", resourceId: req.session.userId });
    res.json({ ok: true });
  })
);

export default router;
