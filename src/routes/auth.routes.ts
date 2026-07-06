import { Router } from "express";
import type { Request, Response } from "express";
import { createLimiter } from "../rateLimit.js";
import { z } from "zod";
import { config } from "../config.js";
import { asyncHandler, requireAuth } from "../middleware.js";
import { validate, LoginSchema, ChangePasswordSchema, AcceptInviteSchema } from "../validators.js";
import { audit } from "../audit.js";
import { logger } from "../logger.js";
import { signAccessToken, issueRefreshToken, rotateRefreshToken, revokeRefreshToken, revokeAllForUser } from "../jwt.js";
import { authenticateCredentials, clientIp } from "../authCore.js";
import { permissionsForUser } from "../permissions.js";
import * as svc from "../services/authService.js";

// MFA token: 6-digit TOTP OR a 10-char hex backup code.
const mfaTokenSchema = z.string().regex(/^([0-9]{6}|[0-9A-Fa-f]{10})$/).optional();

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

// Đăng nhập/token KHÔNG bê được hết vào service: body lỗi cần thêm cờ `mfaRequired` (khác shape
// errorHandler) → route giữ phần map kết quả → response; credentials/lockout đã ở authCore.ts.
router.post(
  "/login",
  loginLimiter,
  validate({ body: LoginSchema.extend({ mfaToken: mfaTokenSchema }) }),
  asyncHandler(async (req: Request, res: Response) => {
    const { username, password, mfaToken } = req.body;
    const ip = clientIp(req);

    const result = await authenticateCredentials(req, { username, password, mfaToken, flow: "login" });
    if (!result.ok) {
      // status luôn được set ở mọi nhánh ok:false của authenticateCredentials; ?? 401
      // chỉ để TS hài lòng (union làm status thành number|undefined), không bao giờ chạy.
      return res.status(result.status ?? 401).json({ error: result.error, ...(result.mfaRequired ? { mfaRequired: true } : {}) });
    }
    const user = result.user;
    if (!user) return res.status(401).json({ error: "Tài khoản không tồn tại hoặc đã bị khóa" });

    // Regenerate session ID to defeat session fixation (in establishSession).
    await svc.establishSession(req, user);

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
      permissions: permissionsForUser(user.role, (user as { permissions?: string[] }).permissions, (user as { canSign?: boolean }).canSign),
    });
  })
);

router.post("/logout", asyncHandler(async (req: Request, res: Response) => {
  const userId = req.session?.userId;
  await new Promise<void>((resolve) => req.session.destroy(() => resolve()));
  res.clearCookie("qly.sid");
  if (userId) await audit(req, "logout", { resource: "user", resourceId: userId, actorId: userId });
  res.json({ ok: true });
}));

// Route MỎNG: validate → gọi tầng service (logic ở authService.ts).
router.get("/me", requireAuth, asyncHandler(async (req: Request, res: Response) => res.json(await svc.meProfile(req))));

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
  asyncHandler(async (req: Request, res: Response) => res.json(await svc.updateProfile(req)))
);

router.post(
  "/change-password",
  requireAuth,
  validate({ body: ChangePasswordSchema }),
  asyncHandler(async (req: Request, res: Response) => res.json(await svc.changePassword(req)))
);

// === JWT API surface (for mobile / SDK / public API clients) ===

router.post(
  "/token",
  loginLimiter,
  validate({ body: LoginSchema.extend({ mfaToken: mfaTokenSchema }) }),
  asyncHandler(async (req: Request, res: Response) => {
    // Same credentials path as /login (shared authCore — same lockout, telemetry,
    // single-use backup codes) but issues a JWT pair instead of a cookie session.
    const { username, password, mfaToken } = req.body;
    const ip = clientIp(req);
    const ua = req.headers["user-agent"] || null;

    const result = await authenticateCredentials(req, { username, password, mfaToken, flow: "token" });
    if (!result.ok) {
      // status luôn được set ở mọi nhánh ok:false; ?? 401 chỉ thỏa TS, không chạy runtime.
      return res.status(result.status ?? 401).json({ error: result.error, ...(result.mfaRequired ? { mfaRequired: true } : {}) });
    }
    const user = result.user;
    if (!user) return res.status(401).json({ error: "Tài khoản không tồn tại hoặc đã bị khóa" });

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
  asyncHandler(async (req: Request, res: Response) => {
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
      const status = typeof e === "object" && e !== null && "status" in e && typeof e.status === "number" ? e.status : 0;
      res.status(status || 401).json({ error: e instanceof Error ? e.message : String(e) });
    }
  })
);

router.post(
  "/token/revoke",
  validate({ body: z.object({ refreshToken: z.string().min(20, "Phiên đăng nhập không hợp lệ") }) }),
  asyncHandler(async (req: Request, res: Response) => {
    await revokeRefreshToken(req.body.refreshToken);
    res.json({ ok: true });
  })
);

router.post(
  "/token/revoke-all",
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    // Route nằm sau requireAuth nên userId chắc chắn có; guard khớp đúng 401 của requireAuth.
    const userId = req.session.userId;
    if (userId === undefined) return res.status(401).json({ error: "Chưa đăng nhập" });
    await revokeAllForUser(userId);
    await audit(req, "token.revoke-all", { resource: "user", resourceId: userId });
    res.json({ ok: true });
  })
);

// === Email-invite onboarding (public) ===

// Forgot password: email a reset link (same onboarding page). Always 200 (no enumeration).
// Respond immediately and identically for every email so neither the status nor the
// RESPONSE TIME reveals whether the account exists — the DB write + SMTP send run in
// background AFTER res.json (sendPasswordReset tự nuốt + log lỗi).
router.post(
  "/forgot-password",
  forgotLimiter,
  validate({ body: z.object({ email: z.string().email("Email không hợp lệ").max(160, "Email tối đa 160 ký tự") }) }),
  asyncHandler(async (req: Request, res: Response) => {
    res.json({ ok: true });
    svc.sendPasswordReset(req);
  })
);

// Validate an invite link and return prefill info for the onboarding form.
router.get("/invite/:token", asyncHandler(async (req: Request, res: Response) => res.json(await svc.inviteInfo(req))));

// Accept an invite: set own password + phone, activate, then log in.
router.post(
  "/accept-invite",
  validate({ body: AcceptInviteSchema }),
  asyncHandler(async (req: Request, res: Response) => res.json(await svc.acceptInvite(req)))
);

export default router;
