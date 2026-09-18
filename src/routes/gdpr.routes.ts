// GDPR compliance: data-subject access request (export) and right-to-erasure
// (delete account). Users hit these on themselves; admins can run them for any
// user.
//
// Route MỎNG: validate → gọi gdprService → res. Phần thao tác res TRỰC TIẾP
// (setHeader/end để stream file export, clearCookie, session.destroy) GIỮ NGUYÊN ở
// route — đó là controller HTTP, không phải logic thuần. Logic truy vấn/transaction/
// audit nằm ở src/services/gdprService.ts.

import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import { asyncHandler, requireAuth } from "../middleware.js";
import { requirePermission, PERMISSIONS } from "../permissions.js";
import { validate } from "../validators.js";
import { audit } from "../audit.js";
import { createLimiter } from "../rateLimit.js";
import * as svc from "../services/gdprService.js";

const router = Router();

// Self-service GDPR (export TOÀN BỘ PII / xóa tài khoản) chỉ dùng vài lần đời người → siết 8 lần/giờ để
// một cookie bị đánh cắp KHÔNG kéo được full-PII hàng loạt hay spam xóa. KHÔNG ảnh hưởng dùng hợp lệ.
const gdprSelfLimiter = createLimiter("gdpr-self", {
  windowMs: 60 * 60 * 1000,
  max: 8,
  message: { error: "Thao tác GDPR bị giới hạn tần suất, vui lòng thử lại sau." },
});
router.use(requireAuth);

/**
 * Bản xuất GDPR là gói PII đầy đủ của một con người (email, điện thoại, IP đăng nhập, toàn bộ nhật
 * ký hoạt động). Phải chặn mọi tầng cache — Cloudflare/proxy nội bộ/trình duyệt — kẻo bản sao còn
 * nằm lại sau khi tab đóng, và chặn trình duyệt tự đoán kiểu để render thay vì tải về.
 */
function noStoreExport(res: Response, filename: string) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Cache-Control", "no-store, private, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("X-Content-Type-Options", "nosniff");
}

/** GET /api/gdpr/me/export — user exports their own data. */
router.get(
  "/me/export",
  gdprSelfLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const data = await svc.exportUser((req.session as any).userId, req.session);   // kẹp phạm vi quyền hiện tại
    noStoreExport(res, `user-${req.session.userId}-export.json`);
    res.end(svc.serializeExport(data));
    await audit(req, "gdpr.export", { resource: "user", resourceId: req.session.userId });
  })
);

/** GET /api/gdpr/users/:id/export — admin exports another user's data. */
router.get(
  "/users/:id/export",
  requirePermission(PERMISSIONS.USER_MANAGE),
  validate({ params: z.object({ id: z.coerce.number().int().positive() }) }),
  asyncHandler(async (req: Request, res: Response) => {
    const data = await svc.exportUser((req.params as any).id);
    noStoreExport(res, `user-${req.params.id}-export.json`);
    res.end(svc.serializeExport(data));
    await audit(req, "gdpr.export.by_admin", { resource: "user", resourceId: req.params.id });
  })
);

/**
 * POST /api/gdpr/me/delete — người dùng tự yêu cầu xoá tài khoản (quyền-được-quên).
 *
 * Danh sách cột thật sự bị xoá nằm ở MỘT chỗ: `anonymizeUserOps` trong src/services/gdprService.ts,
 * kèm cả phần "cố ý giữ lại". Ở đây CHỈ nói phạm vi, không chép lại danh sách — bản trước chép, rồi
 * bản chép trôi khỏi mã: nó ghi "anonymizes the user's OWN PII (username/email/phone/title/MFA)",
 * tức thiếu `displayName` (có xoá thật) và bỏ qua `senderName`/`projectCode`/`lastLoginIp` (lúc đó
 * KHÔNG xoá). Người đọc chú thích để rà tuân thủ sẽ kết luận sai theo đúng hướng trấn an.
 *
 * Trong một transaction: thu hồi + gỡ dấu vết định vị của refresh token, vô danh hoá dữ liệu cá
 * nhân của CHÍNH người đó ở bảng User và ở nhật ký đăng nhập (`LoginAttempt`, CHỈ hàng `success:
 * true` — hàng thất bại là dấu vết người khác gõ vào tài khoản này; lý do ở gdprService.ts), rồi
 * soft-delete + khoá hàng. Câu này ĐÚNG kể từ 2026-09-18: trước đó nó khẳng định có xoá
 * `LoginAttempt` trong khi mã KHÔNG làm thế — một chú thích sai theo hướng TRẤN AN người rà tuân
 * thủ, tức đúng lớp lỗi mà đoạn ngay trên vừa đặt luật để tránh. Ngay sau đó
 * huỷ mọi phiên cookie của người đó. Báo giá và khách hàng thì GIỮ như bản ghi nghiệp vụ (hàng
 * khách hàng là dữ liệu cá nhân của chủ thể khác), và nhật ký kiểm toán giữ theo nghĩa vụ pháp lý —
 * lưu ý nhật ký đó chứa bản chụp ĐẦY ĐỦ những cột vừa bị xoá (xem chú thích ở gdprService.ts).
 */
router.post(
  "/me/delete",
  gdprSelfLimiter,
  validate({ body: z.object({ confirm: z.literal("DELETE-MY-ACCOUNT", { error: "Vui lòng nhập chính xác DELETE-MY-ACCOUNT để xác nhận" }) }) }),
  asyncHandler(async (req: Request, res: Response) => {
    await svc.deleteSelf(req);
    await new Promise<void>((resolve) => req.session.destroy(() => resolve()));
    res.clearCookie("qly.sid");
    res.json({ ok: true, message: "Tài khoản đã được xóa. Nhật ký kiểm toán được giữ lại theo nghĩa vụ pháp lý." });
  })
);

router.post(
  "/users/:id/delete",
  requirePermission(PERMISSIONS.USER_MANAGE),
  validate({
    params: z.object({ id: z.coerce.number().int().positive() }),
    body: z.object({ confirm: z.literal("DELETE-USER", { error: "Vui lòng nhập chính xác DELETE-USER để xác nhận" }) }),
  }),
  asyncHandler(async (req: Request, res: Response) => res.json(await svc.deleteByAdmin(req)))
);

export default router;
