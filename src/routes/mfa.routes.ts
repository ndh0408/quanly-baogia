import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import { createLimiter } from "../rateLimit.js";
import { requireAuth, asyncHandler } from "../middleware.js";
import { validate } from "../validators.js";
import * as svc from "../services/mfaService.js";

const router = Router();
router.use(requireAuth);

// Per-account throttle for MFA mutations: caps online brute-force of the 6-digit
// TOTP / backup space on enable+disable. Keyed by user id (requireAuth guarantees
// it), so it's independent of IP. (In-memory; fine as a secondary control behind
// the password re-auth below.)
const mfaLimiter = createLimiter("mfa", {
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyGenerator: (req: Request) => `mfa:${req.session.userId}`,
  message: { error: "Quá nhiều lần thử MFA, vui lòng thử lại sau ít phút" },
});

// Disable requires the account password (step-up: a stolen cookie alone must not
// be able to strip 2FA) PLUS a TOTP code OR a backup code — the backup code is the
// recovery path if the TOTP secret can't be decrypted (e.g. MFA_ENC_KEY rotated).
const DisableBody = z.object({
  password: z.string().min(1, "Vui lòng nhập mật khẩu hiện tại"),
  token: z.string().regex(/^([0-9]{6}|[0-9A-Fa-f]{10})$/, "Mã TOTP 6 số hoặc mã dự phòng"),
});

const EnableBody = z.object({
  password: z.string().min(1, "Vui lòng nhập mật khẩu hiện tại"),
  secret: z.string().min(8, "Mã thiết lập không hợp lệ"),
  token: z.string().regex(/^\d{6}$/, "Mã xác thực phải gồm 6 chữ số"),
});

// Route MỎNG: limiter + validate → gọi tầng service (step-up password, TOTP, backup codes ở mfaService.ts).
router.post("/setup", mfaLimiter, asyncHandler(async (req: Request, res: Response) => res.json(await svc.setupMfa(req))));
router.post("/enable", mfaLimiter, validate({ body: EnableBody }), asyncHandler(async (req: Request, res: Response) => res.json(await svc.enableMfa(req))));
router.post("/disable", mfaLimiter, validate({ body: DisableBody }), asyncHandler(async (req: Request, res: Response) => res.json(await svc.disableMfa(req))));

export default router;
