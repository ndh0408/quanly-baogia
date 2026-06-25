// GDPR compliance: data-subject access request (export) and right-to-erasure
// (delete account). Users hit these on themselves; admins can run them for any
// user.
//
// Route MỎNG: validate → gọi gdprService → res. Phần thao tác res TRỰC TIẾP
// (setHeader/end để stream file export, clearCookie, session.destroy) GIỮ NGUYÊN ở
// route — đó là controller HTTP, không phải logic thuần. Logic truy vấn/transaction/
// audit nằm ở src/services/gdprService.ts.

import { Router } from "express";
import { z } from "zod";
import { asyncHandler, requireAuth, requireRole } from "../middleware.js";
import { validate } from "../validators.js";
import { audit } from "../audit.js";
import * as svc from "../services/gdprService.js";

const router = Router();
router.use(requireAuth);

/** GET /api/gdpr/me/export — user exports their own data. */
router.get(
  "/me/export",
  asyncHandler(async (req, res) => {
    const data = await svc.exportUser(req.session.userId);
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
    const data = await svc.exportUser(req.params.id);
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
    await svc.deleteSelf(req);
    await new Promise<void>((resolve) => req.session.destroy(() => resolve()));
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
  asyncHandler(async (req, res) => res.json(await svc.deleteByAdmin(req)))
);

export default router;
