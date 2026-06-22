// GDPR compliance: data-subject access request (export) and right-to-erasure
// (delete account). Users hit these on themselves; admins can run them for any
// user.

import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { asyncHandler, requireAuth, requireRole } from "../middleware.js";
import { validate } from "../validators.js";
import { audit } from "../audit.js";

const router = Router();
router.use(requireAuth);

function bigIntToString(obj) {
  return JSON.parse(JSON.stringify(obj, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
}

/**
 * Prisma ops that erase a user's OWN personal data and lock the account.
 * Returns an array to be passed to prisma.$transaction([...]) so token revocation
 * and PII anonymization commit atomically. Shared by self-delete and admin-delete.
 *
 * Note: quotes/customers owned by the user are intentionally NOT touched here —
 * they are business records (and customer rows are other people's personal data),
 * so they are retained with their ownership link, not anonymized.
 */
function anonymizeUserOps(id) {
  return [
    prisma.refreshToken.updateMany({ where: { userId: id }, data: { revokedAt: new Date() } }),
    prisma.user.update({
      where: { id },
      data: {
        username: `deleted-${id}-${Date.now()}`,
        passwordHash: "DELETED",
        displayName: "(deleted user)",
        email: null,
        phone: null,
        title: null,
        mfaSecret: null,
        mfaBackupCodes: [],
        mfaEnabled: false,
        active: false,
        deletedAt: new Date(),
      },
    }),
  ];
}

async function exportUser(userId) {
  const [user, quotes, customers, auditEvents, refreshTokens, notifications] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, username: true, displayName: true, email: true, phone: true,
        title: true, role: true, active: true,
        lastLoginAt: true, lastLoginIp: true, createdAt: true,
      },
    }),
    prisma.quote.findMany({
      where: { createdById: userId },
      include: { sheets: { include: { items: true } } },
      take: 1000,
    }),
    prisma.customer.findMany({ where: { ownerId: userId }, take: 5000 }),
    prisma.auditEvent.findMany({
      where: { actorId: userId },
      orderBy: { createdAt: "desc" },
      take: 5000,
    }),
    prisma.refreshToken.findMany({
      where: { userId },
      select: { id: true, family: true, ip: true, userAgent: true, expiresAt: true, revokedAt: true, createdAt: true },
    }),
    prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 5000,
    }),
  ]);

  return bigIntToString({
    exportedAt: new Date(),
    format: "qly-gdpr-export/1.0",
    user,
    quotes,
    customers,
    auditEvents,
    refreshTokens,
    notifications,
  });
}

/** GET /api/gdpr/me/export — user exports their own data. */
router.get(
  "/me/export",
  asyncHandler(async (req, res) => {
    const data = await exportUser(req.session.userId);
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="user-${req.session.userId}-export.json"`);
    res.end(JSON.stringify(data, null, 2));
    await audit(req, "gdpr.export", { resource: "user", resourceId: req.session.userId });
  })
);

/** GET /api/gdpr/users/:id/export — admin exports another user's data. */
router.get(
  "/users/:id/export",
  requireRole("admin"),
  validate({ params: z.object({ id: z.coerce.number().int().positive() }) }),
  asyncHandler(async (req, res) => {
    const data = await exportUser(req.params.id);
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="user-${req.params.id}-export.json"`);
    res.end(JSON.stringify(data, null, 2));
    await audit(req, "gdpr.export.by_admin", { resource: "user", resourceId: req.params.id });
  })
);

/**
 * POST /api/gdpr/me/delete — user requests account deletion (right-to-erasure).
 * In one transaction: revokes all refresh tokens and anonymizes the user's OWN
 * PII (username/email/phone/title/MFA), then soft-deletes + deactivates the row.
 * Quotes and customers owned by the user are RETAINED as business records with
 * their ownership link intact — they are not the deleting user's personal data
 * (customer rows belong to other data subjects). The audit log is also retained
 * for legal obligation.
 */
router.post(
  "/me/delete",
  validate({ body: z.object({ confirm: z.literal("DELETE-MY-ACCOUNT", { error: "Vui lòng nhập chính xác DELETE-MY-ACCOUNT để xác nhận" }) }) }),
  asyncHandler(async (req, res) => {
    const id = req.session.userId;
    await prisma.$transaction(anonymizeUserOps(id));
    await audit(req, "gdpr.delete.self", { resource: "user", resourceId: id, actorId: id });
    await new Promise((resolve) => req.session.destroy(() => resolve()));
    res.clearCookie("qly.sid");
    res.json({ ok: true, message: "Tài khoản đã được xóa. Nhật ký kiểm toán được giữ lại theo nghĩa vụ pháp lý." });
  })
);

router.post(
  "/users/:id/delete",
  requireRole("admin"),
  validate({
    params: z.object({ id: z.coerce.number().int().positive() }),
    body: z.object({ confirm: z.literal("DELETE-USER", { error: "Vui lòng nhập chính xác DELETE-USER để xác nhận" }) }),
  }),
  asyncHandler(async (req, res) => {
    if (req.params.id === req.session.userId) {
      return res.status(400).json({ error: "Không thể tự xóa chính mình ở đây. Vui lòng dùng chức năng \"Xóa tài khoản của tôi\"." });
    }
    const target = await prisma.user.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!target) return res.status(404).json({ error: "Không tìm thấy người dùng" });
    await prisma.$transaction(anonymizeUserOps(req.params.id));
    await audit(req, "gdpr.delete.by_admin", { resource: "user", resourceId: req.params.id });
    res.json({ ok: true });
  })
);

export default router;
