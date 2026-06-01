import { Router } from "express";
import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";
import rateLimit from "express-rate-limit";
import speakeasy from "speakeasy";
import { z } from "zod";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { asyncHandler, requireAuth } from "../middleware.js";
import { validate, LoginSchema, ChangePasswordSchema, AcceptInviteSchema } from "../validators.js";
import { audit } from "../audit.js";
import { logger } from "../logger.js";
import { signAccessToken, issueRefreshToken, rotateRefreshToken, revokeRefreshToken, revokeAllForUser } from "../jwt.js";
import { permissionsForRole } from "../permissions.js";
import { sendEmail } from "../email.js";

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

    // Login by email OR username (employees invited by email log in with their email).
    const loginId = (username || "").trim();
    const user = await prisma.user.findFirst({ where: { OR: [{ username: loginId }, { email: loginId }] } });

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
      select: { id: true, username: true, email: true, displayName: true, role: true, phone: true, mfaEnabled: true, lastLoginAt: true },
    });
    if (!user) return res.status(404).json({ error: "Không tìm thấy" });
    // Ship the authoritative capability list so the SPA gates UI from the server catalog.
    res.json({ ...user, permissions: permissionsForRole(user.role) });
  })
);

// Update own profile (display name + phone). Self-service for any logged-in user.
router.post(
  "/profile",
  requireAuth,
  validate({ body: z.object({
    displayName: z.string().min(1).max(120).trim(),
    phone: z.string().max(40).trim().optional().or(z.literal("").transform(() => null)),
  }) }),
  asyncHandler(async (req, res) => {
    const user = await prisma.user.update({
      where: { id: req.session.userId },
      data: { displayName: req.body.displayName, phone: req.body.phone || null },
      select: { id: true, username: true, email: true, displayName: true, role: true, phone: true, mfaEnabled: true },
    });
    req.session.displayName = user.displayName;
    await audit(req, "user.profile.update", { resource: "user", resourceId: user.id, actorId: user.id });
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
    // Invalidate outstanding refresh tokens so a stolen token can't survive a
    // password change (containment for the "I think I'm compromised" case).
    await revokeAllForUser(user.id);
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

    const user = await prisma.user.findFirst({ where: { OR: [{ username: (username || "").trim() }, { email: (username || "").trim() }] } });
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

// === Email-invite onboarding (public) ===
const hashInvite = (t) => createHash("sha256").update(String(t)).digest("hex");

async function findInvitee(token) {
  if (!token) return null;
  // Same token mechanism powers both new-user invites and password resets.
  const user = await prisma.user.findFirst({ where: { inviteTokenHash: hashInvite(token) } });
  if (!user) return null;
  if (user.inviteExpiresAt && user.inviteExpiresAt < new Date()) return null;
  return user;
}

// Forgot password: email a reset link (same onboarding page). Always 200 (no enumeration).
router.post(
  "/forgot-password",
  validate({ body: z.object({ email: z.string().email().max(160) }) }),
  asyncHandler(async (req, res) => {
    const email = req.body.email.trim();
    const user = await prisma.user.findFirst({ where: { OR: [{ email }, { username: email }] } });
    if (user && user.active) {
      const token = randomBytes(24).toString("hex");
      await prisma.user.update({
        where: { id: user.id },
        data: { inviteTokenHash: hashInvite(token), inviteExpiresAt: new Date(Date.now() + 2 * 3600 * 1000) },
      });
      const base = req.headers.origin || `${req.protocol}://${req.get("host")}`;
      const url = `${base}/#/onboard?token=${token}`;
      await sendEmail({
        to: user.email || email,
        subject: "Đặt lại mật khẩu – Báo Giá Gia Nguyễn",
        text: `Bạn yêu cầu đặt lại mật khẩu. Mở liên kết (hết hạn sau 2 giờ): ${url}`,
        html: `<p>Bạn yêu cầu đặt lại mật khẩu cho hệ thống Báo Giá. Nhấn liên kết bên dưới (hết hạn sau 2 giờ):</p><p><a href="${url}">${url}</a></p><p>Nếu không phải bạn, hãy bỏ qua email này.</p>`,
      });
      await audit(req, "password.forgot", { resource: "user", resourceId: user.id });
    }
    res.json({ ok: true });
  })
);

// Validate an invite link and return prefill info for the onboarding form.
router.get(
  "/invite/:token",
  asyncHandler(async (req, res) => {
    const user = await findInvitee(req.params.token);
    if (!user) return res.status(404).json({ error: "Lời mời không hợp lệ hoặc đã hết hạn" });
    res.json({ email: user.email, displayName: user.displayName, role: user.role });
  })
);

// Accept an invite: set own password + phone, activate, then log in.
router.post(
  "/accept-invite",
  validate({ body: AcceptInviteSchema }),
  asyncHandler(async (req, res) => {
    const { token, displayName, phone, password } = req.body;
    const user = await findInvitee(token);
    if (!user) return res.status(404).json({ error: "Lời mời không hợp lệ hoặc đã hết hạn" });

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await bcrypt.hash(password, config.BCRYPT_COST),
        active: true,
        displayName: displayName?.trim() || user.displayName,
        phone: phone?.trim() || null,
        inviteTokenHash: null,
        inviteExpiresAt: null,
      },
    });
    await audit(req, "user.invite.accept", { resource: "user", resourceId: user.id, actorId: user.id });

    // Log the new user in immediately.
    await new Promise((resolve, reject) => req.session.regenerate((e) => (e ? reject(e) : resolve())));
    req.session.userId = updated.id;
    req.session.role = updated.role;
    req.session.displayName = updated.displayName;
    req.session.username = updated.username;
    await new Promise((resolve, reject) => req.session.save((e) => (e ? reject(e) : resolve())));

    res.json({ id: updated.id, username: updated.username, displayName: updated.displayName, role: updated.role, permissions: permissionsForRole(updated.role) });
  })
);

export default router;
