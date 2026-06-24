import { Router } from "express";
import { asyncHandler, requireAuth } from "../middleware.js";
import { requirePermission } from "../permissions.js";
import {
  PERMISSION_GROUPS, PERMISSION_LABELS, ROLE_LABELS, ROLE_PERMISSIONS,
  permissionsForRole, PERMISSIONS,
} from "../permissions.js";

const router = Router();
router.use(requireAuth);

/**
 * Permission catalog + the role→permission matrix. Used by the admin "Phân quyền"
 * screen. Read-only: the map is static (code-defined), so this never mutates.
 */
router.get(
  "/catalog",
  requirePermission(PERMISSIONS.USER_MANAGE),
  asyncHandler(async (_req, res) => {
    const roles = Object.keys(ROLE_PERMISSIONS);
    res.json({
      groups: PERMISSION_GROUPS.map((g) => ({
        key: g.key,
        label: g.label,
        perms: g.perms.map((p) => ({ key: p, label: PERMISSION_LABELS[p] || p })),
      })),
      roles: roles.map((r) => ({
        key: r,
        label: ROLE_LABELS[r] || r,
        permissions: permissionsForRole(r),
      })),
    });
  })
);

/** The caller's own effective permissions (handy for the SPA to refresh). */
router.get(
  "/me",
  asyncHandler(async (req, res) => {
    res.json({ role: req.session.role, permissions: permissionsForRole(req.session.role) });
  })
);

export default router;
