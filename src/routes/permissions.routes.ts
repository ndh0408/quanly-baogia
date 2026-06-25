import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import { asyncHandler, requireAuth } from "../middleware.js";
import {
  PERMISSION_GROUPS, PERMISSION_LABELS, ROLE_LABELS, ROLE_PERMISSIONS,
  permissionsForRole, PERMISSIONS, requirePermission, EDITABLE_ROLES, hasRoleOverride,
} from "../permissions.js";
import { saveRoleOverride, resetRoleOverride } from "../roleOverrides.js";
import { audit } from "../audit.js";
import { prisma } from "../db.js";
import { refreshSession } from "../sse.js";

const router = Router();
router.use(requireAuth);

const VALID_PERMS = new Set<string>(Object.values(PERMISSIONS));

// Sau khi quyền 1 vai trò đổi → đẩy refresh cho MỌI user đang đăng nhập có vai trò đó (quyền đổi LIVE,
// không cần đăng xuất). Best-effort.
async function refreshRoleUsers(role: string) {
  try {
    const users = await prisma.user.findMany({ where: { role: role as never }, select: { id: true } });
    for (const u of users) refreshSession(u.id);
  } catch { /* refresh không critical */ }
}

/**
 * Permission catalog + ma trận role→quyền (đã tính override). Trang admin "Phân quyền".
 * permissions = quyền HIỆU LỰC (override nếu có, ngược lại mặc định); overridden = đang khác mặc định.
 */
router.get(
  "/catalog",
  requirePermission(PERMISSIONS.USER_MANAGE),
  asyncHandler(async (_req: Request, res: Response) => {
    const roles = Object.keys(ROLE_PERMISSIONS);
    res.json({
      groups: PERMISSION_GROUPS.map((g) => ({
        key: g.key,
        label: g.label,
        perms: g.perms.map((p) => ({ key: p, label: PERMISSION_LABELS[p] || p })),
      })),
      editableRoles: EDITABLE_ROLES,
      roles: roles.map((r) => ({
        key: r,
        label: ROLE_LABELS[r as keyof typeof ROLE_LABELS] || r,
        permissions: permissionsForRole(r),
        overridden: hasRoleOverride(r),
        editable: EDITABLE_ROLES.includes(r), // admin = false (luôn full, khóa sửa)
      })),
    });
  })
);

const RoleBody = z.object({ permissions: z.array(z.string()).max(100) });

/** Đặt quyền cho 1 vai trò (ghi đè). Admin only. KHÔNG sửa 'admin'. Quyền phải có trong danh mục. */
router.put(
  "/roles/:role",
  requirePermission(PERMISSIONS.USER_MANAGE),
  asyncHandler(async (req: Request, res: Response) => {
    const role = String(req.params.role);
    if (!EDITABLE_ROLES.includes(role)) {
      return res.status(400).json({ error: "Vai trò không hợp lệ hoặc không được sửa (admin luôn đủ quyền)" });
    }
    const parsed = RoleBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Dữ liệu quyền không hợp lệ" });
    const wanted = [...new Set(parsed.data.permissions)];
    const perms = wanted.filter((p) => VALID_PERMS.has(p));
    if (perms.length !== wanted.length) return res.status(400).json({ error: "Có quyền không tồn tại trong danh mục" });

    const before = permissionsForRole(role);
    await saveRoleOverride(role, perms, req.session.userId);
    const after = permissionsForRole(role);
    await audit(req, "role.permissions.update", { resource: "role", resourceId: role, before: { permissions: before }, after: { permissions: after } });
    await refreshRoleUsers(role);
    res.json({ role, permissions: after, overridden: true });
  })
);

/** Đặt lại 1 vai trò về MẶC ĐỊNH (xóa override). Admin only. */
router.delete(
  "/roles/:role",
  requirePermission(PERMISSIONS.USER_MANAGE),
  asyncHandler(async (req: Request, res: Response) => {
    const role = String(req.params.role);
    if (!EDITABLE_ROLES.includes(role)) return res.status(400).json({ error: "Vai trò không hợp lệ" });
    const before = permissionsForRole(role);
    await resetRoleOverride(role);
    const after = permissionsForRole(role);
    await audit(req, "role.permissions.reset", { resource: "role", resourceId: role, before: { permissions: before }, after: { permissions: after } });
    await refreshRoleUsers(role);
    res.json({ role, permissions: after, overridden: false });
  })
);

/** The caller's own effective permissions (handy for the SPA to refresh). */
router.get(
  "/me",
  asyncHandler(async (req: Request, res: Response) => {
    res.json({ role: req.session.role, permissions: permissionsForRole(req.session.role!) });
  })
);

export default router;
