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

// MFA token: 6-digit TOTP OR a hex backup code (20 chars now, 10 for codes issued before the
// entropy upgrade in src/mfa.ts — both must keep working or old users lose their recovery path).
const mfaTokenSchema = z.string().regex(/^([0-9]{6}|[0-9A-Fa-f]{10,20})$/).optional();

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

// /accept-invite là một đường CẤP PHIÊN ĐẦY ĐỦ y như /login (nó kiêm luôn "đặt lại mật khẩu"), và
// từ khi có cổng MFA thì nó cũng là chỗ đoán được mã 6 số. Nhưng nó KHÔNG đi qua loginLimiter, nên
// trần duy nhất từng có là apiLimiter 120 req/phút cho toàn API — đủ để dò mã trong vòng đời 2 giờ
// của một token đặt-lại. Trần theo IP ở đây là lớp chặn thứ hai, độc lập với bộ đếm khoá theo TÀI
// KHOẢN trong authService (kẻ tấn công xoay IP thì vướng bộ đếm kia; dò nhiều tài khoản một lúc để
// né bộ đếm kia thì vướng trần này). Rộng hơn loginLimiter một chút vì người dùng thật có thể gõ
// nhầm mật khẩu mới/mã MFA vài lần trong một lần kích hoạt.
const acceptInviteLimiter = createLimiter("accept-invite", {
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: "Quá nhiều lần thử, vui lòng thử lại sau 15 phút" },
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
  if (userId) {
    // Refresh token sống ĐỘC LẬP với cookie phiên: huỷ phiên không đụng gì tới chúng, nên trước bản
    // vá này "Đăng xuất" chỉ vứt cookie trong khi một thông tin đăng nhập KHÁC của cùng tài khoản
    // vẫn còn hiệu lực tới JWT_REFRESH_TTL_DAYS. Mọi đường xoay credential khác (đổi mật khẩu, đặt
    // lại, admin sửa tài khoản) đều đã gọi revokeAllForUser — chỗ này là ngoại lệ duy nhất còn sót.
    //
    // PHẠM VI KHÔNG ĐỐI XỨNG, GHI RÕ ĐỂ KHÔNG AI TƯỞNG NHẦM: cookie phiên thì chỉ huỷ phiên NÀY
    // (destroyAllSessions cố ý không được gọi — đăng xuất ở máy này không được đá người dùng ra
    // khỏi các trình duyệt khác của chính họ), nhưng refresh token thì thu hồi TOÀN BỘ tài khoản,
    // vì hiện không có gì gắn một refresh token với phiên cookie đã cấp ra nó. Hôm nay vô hại:
    // không client nào dùng /auth/token (web/src/lib/api.ts chỉ dùng cookie). Khi có client di
    // động thì phải lưu "họ" token vào req.session lúc cấp rồi thu hồi theo họ — đã ghi vào
    // docs/REMAINING_RISKS.md. Muốn dọn sạch mọi thiết bị ngay bây giờ thì dùng /token/revoke-all.
    await revokeAllForUser(userId).catch(() => {});
    await audit(req, "logout", { resource: "user", resourceId: userId, actorId: userId });
  }
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
  acceptInviteLimiter,
  validate({ body: AcceptInviteSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    try {
      res.json(await svc.acceptInvite(req));
    } catch (e) {
      // errorHandler chỉ chuyển tiếp `error` + `code`, không chuyển cờ tuỳ ý. Map ở đây để phản hồi
      // có ĐÚNG hình dạng của /login ({ error, mfaRequired }) — client dùng chung một nhánh xử lý.
      if (e && typeof e === "object" && "mfaRequired" in e) {
        return res.status(401).json({ error: e instanceof Error ? e.message : "Cần mã MFA", mfaRequired: true });
      }
      throw e;
    }
  })
);

export default router;
