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
}

// Validate an invite link and return prefill info for the onboarding form.
export async function inviteInfo(req: Request) {
  const user = await findInvitee(req.params.token);
  if (!user) throw httpError(404, "Lời mời không hợp lệ hoặc đã hết hạn");
  return { email: user.email, displayName: user.displayName, role: user.role };
}

// Accept an invite: set own password + phone, activate, then log in.
export async function acceptInvite(req: Request) {
  const { token, displayName, phone, title, senderName, password } = req.body;
  const user = await findInvitee(token);
  if (!user) throw httpError(404, "Lời mời không hợp lệ hoặc đã hết hạn");

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
