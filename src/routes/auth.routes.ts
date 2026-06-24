import { Router } from "express";
import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";
import { createLimiter } from "../rateLimit.js";
import { z } from "zod";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { asyncHandler, requireAuth } from "../middleware.js";
import { validate, LoginSchema, ChangePasswordSchema, AcceptInviteSchema } from "../validators.js";
import { audit } from "../audit.js";
import { logger } from "../logger.js";
import { signAccessToken, issueRefreshToken, rotateRefreshToken, revokeRefreshToken, revokeAllForUser } from "../jwt.js";
import { destroyAllSessions } from "../sessions.js";
import { authenticateCredentials, clientIp } from "../authCore.js";

// MFA token: 6-digit TOTP OR a 10-char hex backup code.
const mfaTokenSchema = z.string().regex(/^([0-9]{6}|[0-9A-Fa-f]{10})$/).optional();
import { permissionsForRole } from "../permissions.js";
import { sendEmail, brandedEmailHtml } from "../email.js";

const router = Router();

// Strict per-IP limit on login: blunt brute force at the network edge.
// Redis-backed when REDIS_URL is set so lockout holds across all instances.
const loginLimiter = createLimiter("login", {
  windowMs: 15 * 60 * 1000,
  max: config.RATE_LIMIT_LOGIN_PER_15M,
  skipSuccessfulRequests: true,
  message: { error: "Quá nhiều lần đăng nhập sai, thử lại sau 15 phút" },
});

// Per-IP cap on password-reset so the endpoint can't be abused to bomb a known
// inbox / burn SMTP reputation. Keyed by IP (not email), so it never reveals
// whether an account exists (anti-enumeration intact).
const forgotLimiter = createLimiter("forgot", {
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: "Quá nhiều yêu cầu đặt lại mật khẩu, thử lại sau 15 phút" },
});

router.post(
  "/login",
  loginLimiter,
  validate({ body: LoginSchema.extend({ mfaToken: mfaTokenSchema }) }),
  asyncHandler(async (req, res) => {
    const { username, password, mfaToken } = req.body;
    const ip = clientIp(req);

    const result = await authenticateCredentials(req, { username, password, mfaToken, flow: "login" });
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error, ...(result.mfaRequired ? { mfaRequired: true } : {}) });
    }
    const user = result.user;

    // Regenerate session ID to defeat session fixation
    await new Promise<void>((resolve, reject) =>
      req.session.regenerate((err) => (err ? reject(err) : resolve()))
    );
    req.session.userId = user.id;
    req.session.role = user.role;
    req.session.displayName = user.displayName;
    req.session.username = user.username;
    await new Promise<void>((resolve, reject) =>
      req.session.save((err) => (err ? reject(err) : resolve()))
    );

    await audit(req, "login.success", { resource: "user", resourceId: user.id, actorId: user.id });
    logger.info({ userId: user.id, ip }, "login success");

    res.json({
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      phone: user.phone,
      title: user.title,
      senderName: user.senderName,
      permissions: permissionsForRole(user.role),
    });
  })
);

router.post("/logout", asyncHandler(async (req, res) => {
  const userId = req.session?.userId;
  await new Promise<void>((resolve) => req.session.destroy(() => resolve()));
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
      select: { id: true, username: true, email: true, displayName: true, role: true, phone: true, title: true, senderName: true, canSign: true, mfaEnabled: true, lastLoginAt: true },
    });
    if (!user) return res.status(404).json({ error: "Không tìm thấy tài khoản" });
    // Ship the authoritative capability list so the SPA gates UI from the server catalog.
    res.json({ ...user, permissions: permissionsForRole(user.role) });
  })
);

// Update own profile (display name + phone). Self-service for any logged-in user.
router.post(
  "/profile",
  requireAuth,
  validate({ body: z.object({
    displayName: z.string().min(1, "Vui lòng nhập họ tên").max(120, "Họ tên tối đa 120 ký tự").trim(),
    phone: z.string().max(40, "Số điện thoại tối đa 40 ký tự").trim().optional().or(z.literal("").transform(() => null)),
    title: z.string().max(120, "Chức danh tối đa 120 ký tự").trim().optional().or(z.literal("").transform(() => null)),
    senderName: z.string().max(120, "Tên người gửi tối đa 120 ký tự").trim().optional().or(z.literal("").transform(() => null)),
  }) }),
  asyncHandler(async (req, res) => {
    const user = await prisma.user.update({
      where: { id: req.session.userId },
      data: {
        displayName: req.body.displayName,
        phone: req.body.phone || null,
        ...(req.body.title !== undefined ? { title: req.body.title } : {}),
        ...(req.body.senderName !== undefined ? { senderName: req.body.senderName } : {}),
      },
      select: { id: true, username: true, email: true, displayName: true, role: true, phone: true, title: true, mfaEnabled: true },
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
    // Invalidate outstanding refresh tokens AND every other cookie session so a
    // stolen credential can't survive a password change (containment for the
    // "I think I'm compromised" case). The caller's own session stays alive.
    await revokeAllForUser(user.id);
    await destroyAllSessions(user.id, req.sessionID);
    await audit(req, "password.change.success", { resource: "user", resourceId: user.id, actorId: user.id });
    res.json({ ok: true });
  })
);

// === JWT API surface (for mobile / SDK / public API clients) ===

router.post(
  "/token",
  loginLimiter,
  validate({ body: LoginSchema.extend({ mfaToken: mfaTokenSchema }) }),
  asyncHandler(async (req, res) => {
    // Same credentials path as /login (shared authCore — same lockout, telemetry,
    // single-use backup codes) but issues a JWT pair instead of a cookie session.
    const { username, password, mfaToken } = req.body;
    const ip = clientIp(req);
    const ua = req.headers["user-agent"] || null;

    const result = await authenticateCredentials(req, { username, password, mfaToken, flow: "token" });
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error, ...(result.mfaRequired ? { mfaRequired: true } : {}) });
    }
    const user = result.user;

    const access = signAccessToken(user);
    const refresh = await issueRefreshToken(user.id, { ip, userAgent: ua } as any);
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
  validate({ body: z.object({ refreshToken: z.string().min(20, "Phiên đăng nhập không hợp lệ") }) }),
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
  validate({ body: z.object({ refreshToken: z.string().min(20, "Phiên đăng nhập không hợp lệ") }) }),
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
  forgotLimiter,
  validate({ body: z.object({ email: z.string().email("Email không hợp lệ").max(160, "Email tối đa 160 ký tự") }) }),
  asyncHandler(async (req, res) => {
    const email = req.body.email.trim();
    // Respond immediately and identically for every email so neither the status
    // nor the RESPONSE TIME reveals whether the account exists (the DB write +
    // SMTP send below would otherwise leak existence via a timing oracle).
    res.json({ ok: true });

    (async () => {
      const user = await prisma.user.findFirst({ where: { OR: [{ email }, { username: email }] } });
      if (!user || !user.active) return;
      const token = randomBytes(24).toString("hex");
      await prisma.user.update({
        where: { id: user.id },
        data: { inviteTokenHash: hashInvite(token), inviteExpiresAt: new Date(Date.now() + 2 * 3600 * 1000) },
      });
      // Link base comes from configuration only — Origin/Host headers are
      // client-controlled and would allow reset-link poisoning (ATO).
      const url = `${config.APP_BASE_URL}/#/onboard?token=${token}`;
      await sendEmail({
        to: user.email || email,
        subject: "Đặt lại mật khẩu – Báo Giá Gia Nguyễn",
        text: `Chào ${user.displayName || ""},\n\nBạn vừa yêu cầu đặt lại mật khẩu cho hệ thống Quản lý Báo Giá – Gia Nguyễn. Mở liên kết bên dưới để tạo mật khẩu mới (hết hạn sau 2 giờ):\n${url}\n\nNếu không phải bạn yêu cầu, hãy bỏ qua email này.`,
        html: brandedEmailHtml({
          name: user.displayName,
          paragraphs: [
            { html: "Bạn vừa yêu cầu <b>đặt lại mật khẩu</b> cho hệ thống Quản lý Báo Giá – Gia Nguyễn. Nhấn nút bên dưới để tạo mật khẩu mới." },
            "Nếu không phải bạn yêu cầu, hãy bỏ qua email này — mật khẩu hiện tại vẫn an toàn.",
          ],
          button: { label: "Đặt lại mật khẩu", url },
          note: { html: "⏳ Liên kết hết hạn sau <b>2 giờ</b>." },
        } as any),
      } as any);
      await audit(req, "password.forgot", { resource: "user", resourceId: user.id });
    })().catch((e) => logger.error({ err: e.message }, "forgot-password background task failed"));
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
    const { token, displayName, phone, title, senderName, password } = req.body;
    const user = await findInvitee(token);
    if (!user) return res.status(404).json({ error: "Lời mời không hợp lệ hoặc đã hết hạn" });

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await bcrypt.hash(password, config.BCRYPT_COST),
        active: true,
        displayName: displayName?.trim() || user.displayName,
        phone: phone?.trim() || null,
        title: title?.trim() || null,
        senderName: senderName?.trim() || null,
        inviteTokenHash: null,
        inviteExpiresAt: null,
      },
    });
    await audit(req, "user.invite.accept", { resource: "user", resourceId: user.id, actorId: user.id });

    // This endpoint also serves password resets: the password just rotated, so
    // kill every pre-existing session/refresh token before issuing a new one.
    await revokeAllForUser(user.id);
    await destroyAllSessions(user.id);

    // Log the new user in immediately.
    await new Promise<void>((resolve, reject) => req.session.regenerate((e) => (e ? reject(e) : resolve())));
    req.session.userId = updated.id;
    req.session.role = updated.role;
    req.session.displayName = updated.displayName;
    req.session.username = updated.username;
    await new Promise<void>((resolve, reject) => req.session.save((e) => (e ? reject(e) : resolve())));

    res.json({ id: updated.id, username: updated.username, displayName: updated.displayName, role: updated.role, senderName: updated.senderName, permissions: permissionsForRole(updated.role) });
  })
);

export default router;
