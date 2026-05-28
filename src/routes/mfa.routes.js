import { Router } from "express";
import { z } from "zod";
import speakeasy from "speakeasy";
import qrcode from "qrcode";
import { randomBytes } from "node:crypto";
import { prisma } from "../db.js";
import { asyncHandler, requireAuth } from "../middleware.js";
import { validate } from "../validators.js";
import { audit } from "../audit.js";

const router = Router();
router.use(requireAuth);

const VerifyBody = z.object({ token: z.string().regex(/^\d{6}$/, "Mã 6 chữ số") });

/**
 * Step 1: server generates a secret and returns it (along with a QR data URL).
 * Secret is NOT persisted yet — only saved when user verifies a token in step 2.
 * Caller must keep the secret in client state until verification succeeds.
 */
router.post(
  "/setup",
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.session.userId } });
    if (user.mfaEnabled) return res.status(400).json({ error: "MFA đã bật" });

    const secret = speakeasy.generateSecret({
      length: 20,
      name: `QuanLyBaoGia (${user.username})`,
      issuer: "QuanLyBaoGia",
    });
    const qr = await qrcode.toDataURL(secret.otpauth_url);
    res.json({ secret: secret.base32, otpauth: secret.otpauth_url, qr });
  })
);

/**
 * Step 2: client posts the secret it received + a TOTP token to prove possession.
 * If verified, persist secret + generate 8 single-use backup codes.
 */
router.post(
  "/enable",
  validate({ body: z.object({ secret: z.string().min(8), token: z.string().regex(/^\d{6}$/) }) }),
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.session.userId } });
    if (user.mfaEnabled) return res.status(400).json({ error: "MFA đã bật" });

    const ok = speakeasy.totp.verify({
      secret: req.body.secret,
      encoding: "base32",
      token: req.body.token,
      window: 1,
    });
    if (!ok) return res.status(401).json({ error: "Mã không đúng" });

    const backupCodes = Array.from({ length: 8 }, () =>
      randomBytes(5).toString("hex").toUpperCase()
    );
    await prisma.user.update({
      where: { id: user.id },
      data: { mfaEnabled: true, mfaSecret: req.body.secret, mfaBackupCodes: backupCodes },
    });
    await audit(req, "mfa.enable", { resource: "user", resourceId: user.id });
    res.json({ ok: true, backupCodes });
  })
);

router.post(
  "/disable",
  validate({ body: VerifyBody }),
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.session.userId } });
    if (!user.mfaEnabled) return res.status(400).json({ error: "MFA chưa bật" });
    const ok = speakeasy.totp.verify({ secret: user.mfaSecret, encoding: "base32", token: req.body.token, window: 1 });
    if (!ok) return res.status(401).json({ error: "Mã không đúng" });
    await prisma.user.update({
      where: { id: user.id },
      data: { mfaEnabled: false, mfaSecret: null, mfaBackupCodes: [] },
    });
    await audit(req, "mfa.disable", { resource: "user", resourceId: user.id });
    res.json({ ok: true });
  })
);

export default router;
