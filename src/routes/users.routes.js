import { Router } from "express";
import bcrypt from "bcryptjs";
import { randomBytes, createHash } from "node:crypto";
import { z } from "zod";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { asyncHandler, requireRole } from "../middleware.js";
import { validate, UserCreateSchema, UserUpdateSchema, UserInviteSchema } from "../validators.js";
import { audit, diff } from "../audit.js";
import { sendEmail } from "../email.js";

const router = Router();
router.use(requireRole("admin"));

const idParam = z.object({ id: z.coerce.number().int().positive() });
const USER_SELECT = {
  id: true,
  username: true,
  email: true,
  displayName: true,
  role: true,
  phone: true,
  active: true,
  lastLoginAt: true,
  createdAt: true,
};

const hashInvite = (t) => createHash("sha256").update(String(t)).digest("hex");
const escHtml = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function inviteLink(req, token) {
  const base = req.headers.origin || `${req.protocol}://${req.get("host")}`;
  return `${base}/#/onboard?token=${token}`;
}
async function sendInviteEmail(to, displayName, url) {
  return sendEmail({
    to,
    subject: "Lời mời tham gia hệ thống Báo Giá – Gia Nguyễn",
    text: `Chào ${displayName}, bạn được mời tham gia hệ thống Quản lý Báo Giá. Mở liên kết để đặt mật khẩu và hoàn tất thông tin (hết hạn sau 7 ngày): ${url}`,
    html: `<p>Chào ${escHtml(displayName)},</p><p>Bạn được mời tham gia hệ thống <b>Quản lý Báo Giá – Gia Nguyễn</b>. Nhấn liên kết bên dưới để đặt mật khẩu và hoàn tất thông tin của bạn:</p><p><a href="${escHtml(url)}">${escHtml(url)}</a></p><p>Liên kết hết hạn sau 7 ngày.</p>`,
  });
}

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const users = await prisma.user.findMany({ orderBy: { id: "asc" }, select: { ...USER_SELECT, inviteTokenHash: true } });
    res.json(users.map(({ inviteTokenHash, ...u }) => ({ ...u, pending: !u.active && !!inviteTokenHash })));
  })
);

// Invite an employee by email — they self-onboard (set password + fill details).
router.post(
  "/invite",
  validate({ body: UserInviteSchema }),
  asyncHandler(async (req, res) => {
    const { email, displayName, role } = req.body;
    const exists = await prisma.user.findFirst({ where: { OR: [{ email }, { username: email }] } });
    if (exists) return res.status(409).json({ error: "Email này đã có tài khoản" });
    const token = randomBytes(24).toString("hex");
    const user = await prisma.user.create({
      data: {
        username: email,
        email,
        displayName,
        role,
        active: false,
        passwordHash: await bcrypt.hash(randomBytes(18).toString("hex"), config.BCRYPT_COST), // unusable until accept
        inviteTokenHash: hashInvite(token),
        inviteExpiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      },
      select: { id: true, email: true, displayName: true, role: true },
    });
    const url = inviteLink(req, token);
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
    if (!u) return res.status(404).json({ error: "Không tìm thấy" });
    if (u.active) return res.status(400).json({ error: "Tài khoản đã kích hoạt" });
    if (!u.email) return res.status(400).json({ error: "Tài khoản không có email" });
    const token = randomBytes(24).toString("hex");
    await prisma.user.update({
      where: { id: u.id },
      data: { inviteTokenHash: hashInvite(token), inviteExpiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000) },
    });
    const url = inviteLink(req, token);
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
    const exists = await prisma.user.findUnique({ where: { username } });
    if (exists) return res.status(409).json({ error: "Username đã tồn tại" });

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
    if (!before) return res.status(404).json({ error: "Không tìm thấy user" });

    const { password, ...rest } = req.body;
    const data = { ...rest };
    if (password) data.passwordHash = await bcrypt.hash(password, config.BCRYPT_COST);

    const user = await prisma.user.update({ where: { id }, data, select: USER_SELECT });
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
        error: `User đang gắn với ${count} báo giá. Hãy khóa (active=false) thay vì xóa.`,
      });
    }
    const before = await prisma.user.findUnique({ where: { id }, select: USER_SELECT });
    await prisma.user.delete({ where: { id } }); // soft-delete via middleware
    await audit(req, "user.delete", { resource: "user", resourceId: id, before });
    res.json({ ok: true });
  })
);

export default router;
