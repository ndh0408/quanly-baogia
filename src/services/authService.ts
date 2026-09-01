// Tầng SERVICE cho domain Xác thực (auth) — bê NGUYÊN logic từ auth.routes.ts (giữ hành vi y hệt):
// hồ sơ cá nhân, đổi mật khẩu, quên mật khẩu, lời mời (invite) + thiết lập session sau đăng nhập.
// Phần kiểm credentials/lockout/MFA đã ở authCore.ts, token JWT ở jwt.ts — service này KHÔNG lặp lại,
// route gọi thẳng 2 module đó cho các endpoint /login /token* (chúng chính là tầng service của auth).
import type { Request } from "express";
import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { audit } from "../audit.js";
import { logger } from "../logger.js";
import { httpError } from "../httpError.js";
import { revokeAllForUser } from "../jwt.js";
import { findLoginUser, verifyMfaChallenge } from "../authCore.js";
import { destroyAllSessions } from "../sessions.js";
import { permissionsForUser, resolveUserPermissions } from "../permissions.js";
import { sendEmail, brandedEmailHtml } from "../email.js";

type SessionSeed = { id: number; username: string; role: string; displayName: string; permissions?: string[]; canSign?: boolean };

// Thiết lập session sau xác thực thành công: regenerate (chống session fixation) → gán → save.
// Dùng chung cho /login và /accept-invite.
export async function establishSession(req: Request, user: SessionSeed) {
  await new Promise<void>((resolve, reject) =>
    req.session.regenerate((err: unknown) => (err ? reject(err) : resolve()))
  );
  req.session.userId = user.id;
  req.session.role = user.role;
  req.session.displayName = user.displayName;
  req.session.username = user.username;
  req.session.permissions = resolveUserPermissions(user.role, user.permissions, user.canSign);
  // Mốc thiết lập phiên — middleware so với User.passwordChangedAt để giết phiên cũ sau khi
  // đổi mật khẩu, độc lập với việc kho phiên có xoá được hàng hay không.
  req.session.authAt = Date.now();
  await new Promise<void>((resolve, reject) =>
    req.session.save((err: unknown) => (err ? reject(err) : resolve()))
  );
}

export async function meProfile(req: Request) {
  const user = await prisma.user.findUnique({
    where: { id: req.session.userId },
    select: { id: true, username: true, email: true, displayName: true, role: true, phone: true, title: true, senderName: true, canSign: true, mfaEnabled: true, lastLoginAt: true, permissions: true },
  });
  if (!user) throw httpError(404, "Không tìm thấy tài khoản");
  // Ship the authoritative capability list so the SPA gates UI from the server catalog.
  return { ...user, permissions: permissionsForUser(user.role, user.permissions, user.canSign) };
}

export async function updateProfile(req: Request) {
  const user = await prisma.user.update({
    where: { id: req.session.userId },
    data: {
      displayName: req.body.displayName,
      phone: req.body.phone || null,
      ...(req.body.title !== undefined ? { title: req.body.title } : {}),
      ...(req.body.senderName !== undefined ? { senderName: req.body.senderName } : {}),
    },
    select: { id: true, username: true, email: true, displayName: true, role: true, phone: true, title: true, mfaEnabled: true, permissions: true, canSign: true },
  });
  req.session.displayName = user.displayName;
  await audit(req, "user.profile.update", { resource: "user", resourceId: user.id, actorId: user.id });
  return { ...user, permissions: permissionsForUser(user.role, user.permissions, user.canSign) };
}

export async function changePassword(req: Request) {
  const { oldPassword, newPassword } = req.body;
  const user = await prisma.user.findUnique({ where: { id: req.session.userId } });
  if (!user) throw httpError(404, "Không tìm thấy tài khoản");
  const ok = await bcrypt.compare(oldPassword, user.passwordHash);
  if (!ok) {
    await audit(req, "password.change.failed", { resource: "user", resourceId: user.id, actorId: user.id });
    throw httpError(401, "Mật khẩu cũ không đúng");
  }
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await bcrypt.hash(newPassword, config.BCRYPT_COST), passwordChangedAt: new Date() },
  });
  // Thu hồi mọi refresh token — chúng sống độc lập với cookie nên không tự chết theo phiên.
  await revokeAllForUser(user.id);

  // XOAY ĐỊNH DANH PHIÊN của chính người vừa đổi mật khẩu.
  //
  // Trước đây phiên gọi lệnh GIỮ NGUYÊN session ID cũ. Đổi mật khẩu là lúc người dùng tuyên bố
  // "thông tin xác thực cũ không còn đáng tin" — thường vì họ NGHI BỊ LỘ. Nếu chính chuỗi session ID
  // đã lộ từ trước (rò qua log, qua Referer, qua một lỗ XSS đã vá), giữ lại nó nghĩa là kẻ tấn công
  // vẫn còn đường vào sau khi nạn nhân vừa làm đúng việc cần làm. `regenerate()` huỷ hàng phiên cũ
  // trong kho và cấp định danh mới, nên chuỗi cũ chết ngay.
  //
  // THỨ TỰ QUAN TRỌNG: xoay TRƯỚC rồi mới dọn các phiên khác, và giữ lại đúng định danh MỚI. Làm
  // ngược lại sẽ giữ nhầm sid cũ (sắp bị huỷ) và phiên mới lại lọt vào diện bị xoá → người dùng bị
  // đá ra ngay khi vừa đổi mật khẩu thành công.
  await establishSession(req, updated as SessionSeed);
  await destroyAllSessions(user.id, req.sessionID);

  await audit(req, "password.change.success", { resource: "user", resourceId: user.id, actorId: user.id });
  return { ok: true };
}

// === Email-invite onboarding ===
const hashInvite = (t: string) => createHash("sha256").update(String(t)).digest("hex");

async function findInvitee(token: string) {
  if (!token) return null;
  // Same token mechanism powers both new-user invites and password resets.
  const user = await prisma.user.findFirst({ where: { inviteTokenHash: hashInvite(token) } });
  if (!user) return null;
  if (user.inviteExpiresAt && user.inviteExpiresAt < new Date()) return null;
  return user;
}

/**
 * Quên mật khẩu — chạy NỀN sau khi route đã trả 200 (chống timing-oracle dò tài khoản:
 * status lẫn thời gian phản hồi giống hệt nhau dù email có tồn tại hay không).
 * Route gọi hàm này SAU res.json({ok:true}); lỗi được nuốt + log, không nổi lên response.
 */
export function sendPasswordReset(req: Request) {
  const email = (req.body.email as string).trim();
  (async () => {
    // Dùng CHUNG hàm tra cứu của đường đăng nhập: nếu chỗ này còn so byte-for-byte thì người gõ
    // email viết thường (bàn phím điện thoại tự hạ chữ) sẽ không được cấp token nào — mà endpoint
    // luôn trả 200 để chống dò tài khoản, nên họ ngồi chờ một email không bao giờ tới. Đường tự
    // phục hồi duy nhất hỏng theo đúng cách khó nhận ra nhất.
    const user = await findLoginUser(email);
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
}

// Validate an invite link and return prefill info for the onboarding form.
export async function inviteInfo(req: Request) {
  const user = await findInvitee(req.params.token);
  if (!user) throw httpError(404, "Lời mời không hợp lệ hoặc đã hết hạn");
  return { email: user.email, displayName: user.displayName, role: user.role };
}

// Accept an invite: set own password + phone, activate, then log in.
export async function acceptInvite(req: Request) {
  const { token, displayName, phone, title, senderName, password, mfaToken } = req.body;
  const user = await findInvitee(token);
  if (!user) throw httpError(404, "Lời mời không hợp lệ hoặc đã hết hạn");

  // CỔNG MFA cho đường ĐẶT LẠI MẬT KHẨU.
  //
  // Endpoint này kiêm luôn "Quên mật khẩu", tức nó là một đường CẤP PHIÊN ĐẦY ĐỦ mà đầu vào duy
  // nhất là một token trong hộp thư. Cổng MFA duy nhất của hệ thống nằm trong
  // authenticateCredentials, và hàm đó chỉ được gọi từ /login và /token — nên trước bản vá này,
  // ai chiếm được hộp thư nạn nhân là vô hiệu hoá được lớp bảo vệ thứ hai mà nạn nhân đã CHỦ ĐỘNG
  // bật, trong khi mfaEnabled vẫn báo "đã bật 2FA" ở /me nên không có dấu hiệu gì để nghi ngờ.
  //
  // ĐẶT TRƯỚC prisma.user.update một cách CÓ CHỦ Ý: mã sai không được phép kịp xoay mật khẩu, nếu
  // không thì kẻ tấn công tuy không vào được vẫn khoá được nạn nhân ra khỏi chính tài khoản họ.
  if (user.mfaEnabled) {
    if (!mfaToken) throw Object.assign(httpError(401, "Cần mã MFA"), { mfaRequired: true });

    // ĐẾM MÃ SAI VÀO ĐÚNG BỘ ĐẾM KHOÁ CỦA ĐƯỜNG ĐĂNG NHẬP.
    //
    // Không có bước này thì cổng MFA ở đây là cổng DUY NHẤT của hệ thống không có trần thử: mã sai
    // ném lỗi TRƯỚC prisma.user.update nên token mời/đặt-lại KHÔNG bị tiêu thụ, tức cùng một token
    // thử lại được không giới hạn suốt vòng đời của nó (2 giờ với "quên mật khẩu", 7 ngày với lời
    // mời). Kẻ đã chiếm hộp thư nạn nhân — đúng mô hình đe doạ mà cổng này sinh ra để chặn — bắn
    // 120 request/phút (trần apiLimiter) với mã 6 số ngẫu nhiên là có xác suất thật sự đáng kể, và
    // nạn nhân không hề bị khoá nên không có tín hiệu nào để nhận ra.
    //
    // Dùng CHUNG failedAttempts/lockedUntil với /login (thay vì một bộ đếm riêng) để "khoá tài
    // khoản" chỉ có MỘT nghĩa duy nhất trong toàn hệ thống, và để admin gỡ ở một chỗ.
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await audit(req, "user.invite.mfa.locked", { resource: "user", resourceId: user.id });
      throw httpError(423, `Tài khoản đang tạm khóa, vui lòng thử lại sau ${config.LOGIN_LOCKOUT_MINUTES} phút`);
    }
    // Khoá đã HẾT HẠN thì xoá luôn bộ đếm — giống hệt authenticateCredentials. Để nó nằm lại ở
    // ngưỡng thì lần gõ sai kế tiếp, dù nhiều ngày sau, lập tức khoá thêm một chu kỳ nữa.
    if (user.lockedUntil) {
      await prisma.user.update({ where: { id: user.id }, data: { failedAttempts: 0, lockedUntil: null } });
      user.failedAttempts = 0;
      user.lockedUntil = null;
    }

    if (!(await verifyMfaChallenge(user, mfaToken))) {
      // Tăng NGUYÊN TỬ: nhiều request song song không được cùng đọc một giá trị cũ rồi lách ngưỡng.
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
      await audit(req, "user.invite.mfa.failed", {
        resource: "user",
        resourceId: user.id,
        after: { failedAttempts: updated.failedAttempts, locked: shouldLock },
      });
      throw httpError(
        shouldLock ? 423 : 401,
        shouldLock ? `Sai mã MFA nhiều lần, tài khoản tạm khóa ${config.LOGIN_LOCKOUT_MINUTES} phút` : "Mã MFA không đúng"
      );
    }
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await bcrypt.hash(password, config.BCRYPT_COST),
      // Đường này kiêm luôn ĐẶT LẠI mật khẩu → cũng phải đóng mốc, nếu không thì mọi phiên cũ của
      // tài khoản (kể cả phiên kẻ tấn công đang giữ) vẫn sống sau khi nạn nhân đặt lại mật khẩu.
      passwordChangedAt: new Date(),
      active: true,
      displayName: displayName?.trim() || user.displayName,
      phone: phone?.trim() || null,
      title: title?.trim() || null,
      senderName: senderName?.trim() || null,
      inviteTokenHash: null,
      inviteExpiresAt: null,
      // Đặt lại mật khẩu THÀNH CÔNG thì xoá bộ đếm khoá, y như đăng nhập thành công. Không xoá thì
      // người vừa chứng minh được quyền sở hữu hộp thư (và mã MFA, nếu có) vẫn bị chặn ở màn đăng
      // nhập cho hết chu kỳ khoá — họ vừa làm đúng mọi thứ mà vẫn không vào được.
      failedAttempts: 0,
      lockedUntil: null,
    },
  });
  await audit(req, "user.invite.accept", { resource: "user", resourceId: user.id, actorId: user.id });

  // This endpoint also serves password resets: the password just rotated, so
  // kill every pre-existing session/refresh token before issuing a new one.
  await revokeAllForUser(user.id);
  await destroyAllSessions(user.id);

  // Log the new user in immediately.
  await establishSession(req, updated as SessionSeed);

  return {
    id: updated.id,
    username: updated.username,
    displayName: updated.displayName,
    role: updated.role,
    senderName: updated.senderName,
    permissions: permissionsForUser(updated.role, (updated as { permissions?: string[] }).permissions, (updated as { canSign?: boolean }).canSign),
  };
}
