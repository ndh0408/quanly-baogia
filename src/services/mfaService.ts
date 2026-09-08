// Tầng SERVICE cho MFA (TOTP + backup codes) — bê NGUYÊN logic từ mfa.routes.ts, hành vi giữ y hệt.
// Route chỉ còn: limiter + validate → gọi service → res.json.
import type { Request } from "express";
import bcrypt from "bcryptjs";
import speakeasy from "speakeasy";
import qrcode from "qrcode";
import { prisma } from "../db.js";
import { audit } from "../audit.js";
import { httpError } from "../httpError.js";
import { encryptSecret, generateBackupCodes } from "../mfa.js";
import { verifyMfaChallenge } from "../authCore.js";
import { revokeAllForUser } from "../jwt.js";
import { destroyAllSessions } from "../sessions.js";

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

  const ok = speakeasy.totp.verifyDelta({
    secret: req.body.secret,
    encoding: "base32",
    token: req.body.token,
    window: 1,
  });
  if (!ok) throw httpError(401, "Mã xác thực không đúng");

  // Store the TOTP secret encrypted and only the HASHES of backup codes.
  // The plaintext codes are returned to the user exactly once, here.
  const { plain: backupCodes, hashed } = await generateBackupCodes(8);
  await prisma.user.update({
    where: { id: user.id },
    data: {
      mfaEnabled: true,
      mfaSecret: encryptSecret(req.body.secret),
      mfaBackupCodes: hashed,
      // TIÊU THỤ LUÔN mã vừa dùng để BẬT — cùng chốt chống replay như /login và /disable.
      //
      // Trước đây chỗ này gọi `speakeasy.totp.verify` trần, không đụng tới `mfaLastStep`. Nghĩa là
      // mã X mà người dùng gõ vào lúc 10:00:05 để bật MFA còn nguyên giá trị trong 25 giây còn lại
      // của cửa sổ: ai nhìn thấy nó (đang chia sẻ màn hình, người đứng sau, ảnh chụp form) trình
      // lại được chính X ở màn đăng nhập, và `claimTotpStep` thấy `mfaLastStep` là null nên nhận.
      // Đúng lớp lỗi đã vá ở `disableMfa`, chỉ khác là nó nằm ở nơi mã ĐẦU TIÊN của bí mật xuất hiện.
      //
      // KHÔNG gọi được `claimTotpStep` ở đây: bí mật chưa nằm trong CSDL lúc kiểm (đó là ý đồ của
      // luồng hai bước), nên ghi thẳng step vừa khớp — `verifyDelta` cho biết mã rơi vào step nào.
      mfaLastStep: Math.floor(Date.now() / 1000 / 30) + ok.delta,
    },
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
  // Mã TOTP/dự phòng phải được TIÊU THỤ qua ĐÚNG MỘT chốt dùng chung với đường đăng nhập
  // (`verifyMfaChallenge`, authCore.ts) — ultracode audit 2026-09-09 (finding F2) bắt được: bản
  // trước tự gọi `claimTotpStep` + `consumeBackupCode` riêng, và nhánh backup-code KHÔNG qua chốt
  // nguyên tử `array_remove` mà authCore.ts đã có cho đường đăng nhập — TOCTOU hẹp: mã vừa bị một
  // request khác (vd một lần đăng nhập) tiêu thụ đúng lúc này vẫn được coi là hợp lệ ở đây, vì hàm
  // cũ chỉ so trên bản mảng đã đọc, không xác nhận lại tại thời điểm ghi. Gọi thẳng
  // `verifyMfaChallenge` vừa đơn giản hơn vừa THỪA HƯỞNG chốt nguyên tử đó, không cần chép lại.
  const mfaOk = await verifyMfaChallenge(user, req.body.token);
  if (!mfaOk) throw httpError(401, "Mã xác thực hoặc mã dự phòng không đúng");
  await prisma.user.update({
    where: { id: user.id },
    // mfaLastStep về null: mốc đó chỉ có nghĩa với bí mật vừa bị xoá. Giữ lại thì lần BẬT MFA kế
    // tiếp sẽ từ chối mã hợp lệ đầu tiên của bí mật MỚI chỉ vì step của nó nhỏ hơn mốc cũ.
    data: { mfaEnabled: false, mfaSecret: null, mfaBackupCodes: [], mfaLastStep: null },
  });
  // THU HỒI PHIÊN/REFRESH TOKEN KHÁC — ultracode audit 2026-09-09 (finding F1). Cùng bất biến mà
  // `resetMfa` (admin gỡ MFA hộ, userService.ts) và `changePassword` đã áp dụng: đổi trạng thái xác
  // thực thì mọi phiên cấp TRƯỚC đó không còn phản ánh đúng trạng thái hiện tại. Giữ lại phiên HIỆN
  // TẠI (`keepSid`) — người vừa tự gỡ MFA không nên tự đăng xuất chính mình.
  await revokeAllForUser(user.id);
  await destroyAllSessions(user.id, req.sessionID ?? null);
  await audit(req, "mfa.disable", { resource: "user", resourceId: user.id });
  return { ok: true };
}
