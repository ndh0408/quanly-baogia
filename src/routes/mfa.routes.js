import { Router } from "express";
import { z } from "zod";
import speakeasy from "speakeasy";
import qrcode from "qrcode";
import { prisma } from "../db.js";
import { asyncHandler, requireAuth } from "../middleware.js";
import { validate } from "../validators.js";
import { audit } from "../audit.js";
import { encryptSecret, decryptSecret, generateBackupCodes, consumeBackupCode } from "../mfa.js";

const router = Router();
router.use(requireAuth);

// Disable accepts a TOTP code OR a backup code — the backup code is the recovery
// path if the TOTP secret can't be decrypted (e.g. MFA_ENC_KEY was rotated).
const DisableBody = z.object({ token: z.string().regex(/^([0-9]{6}|[0-9A-Fa-f]{10})$/, "Mã TOTP 6 số hoặc mã dự phòng") });

/**
 * Step 1: server generates a secret and returns it (along with a QR data URL).
 * Secret is NOT persisted yet — only saved when user verifies a token in step 2.
 * Caller must keep the secret in client state until verification succeeds.
 */
router.post(
  "/setup",
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.session.userId } });
    if (user.mfaEnabled) return res.status(400).json({ error: "MFA đã được bật" });

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
  validate({ body: z.object({ secret: z.string().min(8, "Mã thiết lập không hợp lệ"), token: z.string().regex(/^\d{6}$/, "Mã xác thực phải gồm 6 chữ số") }) }),
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.session.userId } });
    if (user.mfaEnabled) return res.status(400).json({ error: "MFA đã được bật" });

    const ok = speakeasy.totp.verify({
      secret: req.body.secret,
      encoding: "base32",
      token: req.body.token,
      window: 1,
    });
    if (!ok) return res.status(401).json({ error: "Mã xác thực không đúng" });

    // Store the TOTP secret encrypted and only the HASHES of backup codes.
    // The plaintext codes are returned to the user exactly once, here.
    const { plain: backupCodes, hashed } = generateBackupCodes(8);
    await prisma.user.update({
      where: { id: user.id },
      data: { mfaEnabled: true, mfaSecret: encryptSecret(req.body.secret), mfaBackupCodes: hashed },
    });
    await audit(req, "mfa.enable", { resource: "user", resourceId: user.id });
    res.json({ ok: true, backupCodes });
  })
);

router.post(
  "/disable",
  validate({ body: DisableBody }),
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.session.userId } });
    if (!user.mfaEnabled) return res.status(400).json({ error: "MFA chưa được bật" });
    const secret = decryptSecret(user.mfaSecret);
    const totpOk = /^\d{6}$/.test(req.body.token)
      && !!secret
      && speakeasy.totp.verify({ secret, encoding: "base32", token: req.body.token, window: 1 });
    // Backup code works even when the secret can't be decrypted (key rotation).
    const backupOk = !totpOk && !!consumeBackupCode(user.mfaBackupCodes, req.body.token);
    if (!totpOk && !backupOk) return res.status(401).json({ error: "Mã xác thực hoặc mã dự phòng không đúng" });
    await prisma.user.update({
      where: { id: user.id },
      data: { mfaEnabled: false, mfaSecret: null, mfaBackupCodes: [] },
    });
    await audit(req, "mfa.disable", { resource: "user", resourceId: user.id });
    res.json({ ok: true });
  })
);

export default router;
