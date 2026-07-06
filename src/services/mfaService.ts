// Tầng SERVICE cho MFA (TOTP + backup codes) — bê NGUYÊN logic từ mfa.routes.ts, hành vi giữ y hệt.
// Route chỉ còn: limiter + validate → gọi service → res.json.
import type { Request } from "express";
import bcrypt from "bcryptjs";
import speakeasy from "speakeasy";
import qrcode from "qrcode";
import { prisma } from "../db.js";
import { audit } from "../audit.js";
import { httpError } from "../httpError.js";
import { encryptSecret, decryptSecret, generateBackupCodes, consumeBackupCode } from "../mfa.js";

async function loadUser(req: Request) {
  const user = await prisma.user.findUnique({ where: { id: req.session.userId } });
  if (!user) throw httpError(401, "Phiên không hợp lệ");
  return user;
}

/**
 * Step 1: server generates a secret and returns it (along with a QR data URL).
 * Secret is NOT persisted yet — only saved when user verifies a token in step 2.
 * Caller must keep the secret in client state until verification succeeds.
 */
export async function setupMfa(req: Request) {
  const user = await loadUser(req);
  if (user.mfaEnabled) throw httpError(400, "MFA đã được bật");

  const secret = speakeasy.generateSecret({
    length: 20,
    name: `QuanLyBaoGia (${user.username})`,
    issuer: "QuanLyBaoGia",
  });
  // otpauth_url là string|undefined trong type nhưng luôn có khi truyền `name`.
  // Guard để chắc chắn truyền string vào qrcode (không bao giờ chạy ở runtime).
  if (!secret.otpauth_url) throw httpError(500, "Không tạo được mã QR MFA");
  const qr = await qrcode.toDataURL(secret.otpauth_url);
  return { secret: secret.base32, otpauth: secret.otpauth_url, qr };
}

/**
 * Step 2: client posts the secret it received + a TOTP token to prove possession.
 * If verified, persist secret + generate 8 single-use backup codes.
 */
export async function enableMfa(req: Request) {
  const user = await loadUser(req);
  if (user.mfaEnabled) throw httpError(400, "MFA đã được bật");
  // Step-up: a stolen cookie alone must not be able to ENABLE MFA either — otherwise an
  // attacker could lock the victim out with an attacker-controlled secret. Mirror /disable.
  const pwOk = await bcrypt.compare(req.body.password, user.passwordHash || "");
  if (!pwOk) throw httpError(401, "Mật khẩu không đúng");

  const ok = speakeasy.totp.verify({
    secret: req.body.secret,
    encoding: "base32",
    token: req.body.token,
    window: 1,
  });
  if (!ok) throw httpError(401, "Mã xác thực không đúng");

  // Store the TOTP secret encrypted and only the HASHES of backup codes.
  // The plaintext codes are returned to the user exactly once, here.
  const { plain: backupCodes, hashed } = generateBackupCodes(8);
  await prisma.user.update({
    where: { id: user.id },
    data: { mfaEnabled: true, mfaSecret: encryptSecret(req.body.secret), mfaBackupCodes: hashed },
  });
  await audit(req, "mfa.enable", { resource: "user", resourceId: user.id });
  return { ok: true, backupCodes };
}

export async function disableMfa(req: Request) {
  const user = await loadUser(req);
  if (!user.mfaEnabled) throw httpError(400, "MFA chưa được bật");
  // Step-up: require the account password before allowing 2FA removal.
  const pwOk = await bcrypt.compare(req.body.password, user.passwordHash || "");
  if (!pwOk) throw httpError(401, "Mật khẩu không đúng");
  const secret = decryptSecret(user.mfaSecret);
  const totpOk = /^\d{6}$/.test(req.body.token)
    && !!secret
    && speakeasy.totp.verify({ secret, encoding: "base32", token: req.body.token, window: 1 });
  // Backup code works even when the secret can't be decrypted (key rotation).
  const backupOk = !totpOk && !!consumeBackupCode(user.mfaBackupCodes, req.body.token);
  if (!totpOk && !backupOk) throw httpError(401, "Mã xác thực hoặc mã dự phòng không đúng");
  await prisma.user.update({
    where: { id: user.id },
    data: { mfaEnabled: false, mfaSecret: null, mfaBackupCodes: [] },
  });
  await audit(req, "mfa.disable", { resource: "user", resourceId: user.id });
  return { ok: true };
}
