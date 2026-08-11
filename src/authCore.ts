// Shared credential authentication for both the cookie-session (/login) and the
// JWT (/token) flows. Consolidating them removes the copy-paste drift the audit
// found and applies the same hardening to both:
//   - constant-ish time: bcrypt runs even for unknown users (no enumeration oracle)
//   - atomic failedAttempts increment (no lockout bypass under concurrency)
//   - consistent LoginAttempt telemetry + audit on every branch
//   - single-use MFA backup codes consumed on success
import type { Request } from "express";
import bcrypt from "bcryptjs";
import speakeasy from "speakeasy";
import { prisma } from "./db.js";
import { config } from "./config.js";
import { audit } from "./audit.js";
import { decryptSecret, consumeBackupCode } from "./mfa.js";

// A fixed bcrypt hash to compare against when the user doesn't exist, so the
// response time matches the real path (defeats username enumeration by timing).
const DUMMY_HASH = bcrypt.hashSync("timing-equalizer-not-a-real-password", config.BCRYPT_COST);

/**
 * MỘT thông điệp duy nhất cho MỌI thất bại xác thực chưa chứng minh được danh tính.
 *
 * Trước đây phản hồi tự khai ra quá nhiều: "Sai mật khẩu" nghĩa là tài khoản CÓ TỒN TẠI, còn
 * "Tài khoản không tồn tại hoặc đã bị khóa" nghĩa là không. Chỉ cần gửi một mật khẩu bừa và đọc JSON
 * là dựng được danh sách email nhân viên có thật — nguyên liệu cho lừa đảo nhắm đích và nhồi mật khẩu.
 * Thời gian phản hồi đã được cân bằng bằng DUMMY_HASH từ trước; nhưng cân bằng thời gian mà nội dung
 * vẫn khác nhau thì vô nghĩa.
 *
 * Lý do thật (no_such_user / inactive / bad_password / locked) VẪN được ghi đầy đủ vào LoginAttempt
 * và nhật ký kiểm toán — người vận hành thấy hết, kẻ tấn công không thấy gì.
 */
const GENERIC_AUTH_ERROR = "Thông tin đăng nhập không đúng hoặc tài khoản không khả dụng.";

export function clientIp(req: Request) {
  // Use Express's trust-proxy-resolved req.ip. Do NOT read the raw X-Forwarded-For
  // first hop — it is fully client-controlled and would let an attacker forge the
  // source IP recorded in LoginAttempt telemetry / lastLoginIp. Configure the
  // number of trusted proxies via TRUST_PROXY so req.ip is the real client.
  return req.ip || null;
}

/**
 * Authenticate username/password (+optional MFA).
 * Returns { ok:true, user } on success, or { ok:false, status, error, mfaRequired? }.
 * Records LoginAttempt + audit internally so callers stay thin.
 */
export async function authenticateCredentials(
  req: Request,
  { username, password, mfaToken, flow }: { username: string; password: string; mfaToken?: string; flow: string }
) {
  const ip = clientIp(req);
  const ua = req.headers["user-agent"] || null;
  const loginId = (username || "").trim();

  const recordAttempt = (success: boolean, reason: string | null) =>
    prisma.loginAttempt.create({ data: { username: loginId, ip, userAgent: ua, success, reason } }).catch(() => {});

  const user = await prisma.user.findFirst({ where: { OR: [{ username: loginId }, { email: loginId }] } });

  // Always run bcrypt (against a dummy hash if needed) BEFORE branching on
  // existence/active, so timing is uniform for unknown vs inactive vs wrong-pw.
  const passwordOk = await bcrypt.compare(password, user?.passwordHash || DUMMY_HASH);

  if (!user || !user.active) {
    await recordAttempt(false, !user ? "no_such_user" : "inactive");
    await audit(req, "login.failed", { resource: "user", resourceId: loginId, after: { reason: !user ? "no_such_user" : "inactive", flow } });
    return { ok: false, status: 401, error: GENERIC_AUTH_ERROR };
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    await recordAttempt(false, "locked");
    await audit(req, "login.locked", { resource: "user", resourceId: user.id, actorId: user.id, after: { flow, passwordOk } });
    // CHỈ tiết lộ "đang tạm khoá" cho người ĐÃ CHỨNG MINH biết mật khẩu đúng.
    //
    // Khoá tài khoản là trạng thái mà người dùng thật CẦN biết — không nói thì họ gõ lại mãi rồi gọi
    // hỗ trợ. Nhưng nói cho mọi người thì 423 trở thành đèn báo "tài khoản này có thật": kẻ tấn công
    // chỉ cần gõ sai 5 lần để tự tạo ra tín hiệu đó. Chia theo việc biết mật khẩu là ranh giới đúng —
    // ai qua được cửa đó thì thông tin khoá không còn là thứ họ chưa biết.
    return passwordOk
      ? { ok: false, status: 423, error: `Tài khoản đang tạm khóa, vui lòng thử lại sau ${config.LOGIN_LOCKOUT_MINUTES} phút` }
      : { ok: false, status: 401, error: GENERIC_AUTH_ERROR };
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
    // Cùng một thông điệp với nhánh "không có tài khoản". Kể cả khi lần này chạm ngưỡng khoá cũng
    // KHÔNG báo "tạm khoá X phút": người gõ sai mật khẩu thì ta chưa biết họ là chủ tài khoản hay
    // người đang dò. Chủ tài khoản sẽ thấy thông báo khoá ở lần sau, khi gõ đúng mật khẩu.
    return { ok: false, status: 401, error: GENERIC_AUTH_ERROR };
  }

  // MFA gate
  if (user.mfaEnabled) {
    if (!mfaToken) return { ok: false, status: 401, error: "Cần mã MFA", mfaRequired: true };
    const isTotp = /^\d{6}$/.test(mfaToken);
    let mfaOk = false;
    if (isTotp) {
      // decryptSecret trả null khi không giải mã được (vd MFA_ENC_KEY xoay vòng); speakeasy
      // với secret rỗng/null đều cho false → guard !!secret trước khi verify.
      const secret = decryptSecret(user.mfaSecret);
      // CHỐNG REPLAY TRONG CỬA SỔ: verifyDelta cho biết mã khớp ở step nào (−1/0/+1 quanh hiện tại). Chỉ chấp
      // nhận nếu step đó MỚI HƠN mfaLastStep đã dùng, và ghi lại step bằng updateMany có điều kiện (nguyên tử)
      // → 2 request cùng trình lại 1 mã: chỉ 1 thắng, request sau thấy step ≤ mfaLastStep → trượt (không tái dùng).
      const delta = secret ? speakeasy.totp.verifyDelta({ secret, encoding: "base32", token: mfaToken, window: 1 }) : null;
      if (delta) {
        const step = Math.floor(Date.now() / 1000 / 30) + delta.delta;
        const claimed = await prisma.user.updateMany({
          where: { id: user.id, OR: [{ mfaLastStep: null }, { mfaLastStep: { lt: step } }] },
          data: { mfaLastStep: step },
        });
        mfaOk = claimed.count > 0;
      }
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
      // Count wrong-MFA toward the SAME per-account lockout as wrong-password. The
      // password was already correct here, so without this an attacker holding a
      // leaked/reused password could brute the 6-digit TOTP space with only the
      // per-IP limiter in the way (defeated by rotating source IPs). A correct MFA
      // on success (below) resets failedAttempts, so legit fat-finger is forgiven.
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
      await recordAttempt(false, "bad_mfa");
      await audit(req, "login.mfa.failed", { resource: "user", resourceId: user.id, actorId: user.id, after: { failedAttempts: updated.failedAttempts, locked: shouldLock, flow } });
      return {
        ok: false,
        status: shouldLock ? 423 : 401,
        error: shouldLock
          ? `Sai mã MFA nhiều lần, tài khoản tạm khóa ${config.LOGIN_LOCKOUT_MINUTES} phút`
          : "Mã MFA không đúng",
        mfaRequired: !shouldLock,
      };
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
