// Central RBAC: a permission catalog + static role→permission map + a can() helper.
// Replaces ad-hoc `session.role === "admin"` checks scattered across routes.
//
// Permission format: "resource:action" or "resource:action:scope".
//   scope "own"  → only resources the user created
//   scope "all"  → any resource
// A role granted "quote:update:all" implicitly also has "own".

export const PERMISSIONS = {
  // Quotes
  QUOTE_CREATE:       "quote:create",
  QUOTE_READ_OWN:     "quote:read:own",
  QUOTE_READ_ALL:     "quote:read:all",
  QUOTE_UPDATE_OWN:   "quote:update:own",
  QUOTE_UPDATE_ALL:   "quote:update:all",
  QUOTE_DELETE_OWN:   "quote:delete:own",
  QUOTE_DELETE_ALL:   "quote:delete:all",
  QUOTE_SUBMIT:       "quote:submit",
  QUOTE_APPROVE:      "quote:approve",
  QUOTE_REJECT:       "quote:reject",
  QUOTE_SEND:         "quote:send",
  QUOTE_EXPORT:       "quote:export",
  // Admin / management
  USER_MANAGE:        "user:manage",
  ROLE_ASSIGN:        "role:assign",
  TEMPLATE_MANAGE:    "template:manage",
  COMPANY_MANAGE:     "company:manage",
  AUDIT_VIEW:         "audit:view",
  SETTINGS_MANAGE:    "settings:manage",
  APPROVAL_MATRIX:    "approval:matrix",
};

const P = PERMISSIONS;

// Human-readable labels (Vietnamese) for the permission-matrix UI.
export const PERMISSION_LABELS = {
  [P.QUOTE_CREATE]:     "Tạo báo giá",
  [P.QUOTE_READ_OWN]:   "Xem báo giá của mình",
  [P.QUOTE_READ_ALL]:   "Xem mọi báo giá",
  [P.QUOTE_UPDATE_OWN]: "Sửa báo giá của mình",
  [P.QUOTE_UPDATE_ALL]: "Sửa mọi báo giá",
  [P.QUOTE_DELETE_OWN]: "Xóa báo giá của mình",
  [P.QUOTE_DELETE_ALL]: "Xóa mọi báo giá",
  [P.QUOTE_SUBMIT]:     "Trình duyệt",
  [P.QUOTE_APPROVE]:    "Duyệt báo giá",
  [P.QUOTE_REJECT]:     "Từ chối báo giá",
  [P.QUOTE_SEND]:       "Gửi cho khách",
  [P.QUOTE_EXPORT]:     "Xuất Excel/PDF",
  [P.USER_MANAGE]:      "Quản lý nhân viên",
  [P.ROLE_ASSIGN]:      "Phân vai trò",
  [P.TEMPLATE_MANAGE]:  "Quản lý mẫu",
  [P.COMPANY_MANAGE]:   "Quản lý công ty",
  [P.AUDIT_VIEW]:       "Xem nhật ký",
  [P.SETTINGS_MANAGE]:  "Cài đặt hệ thống",
  [P.APPROVAL_MATRIX]:  "Cấu hình duyệt",
};

// Permission groups for nicer matrix rendering.
export const PERMISSION_GROUPS = [
  { key: "quote", label: "Báo giá", perms: [
    P.QUOTE_CREATE, P.QUOTE_READ_OWN, P.QUOTE_READ_ALL, P.QUOTE_UPDATE_OWN, P.QUOTE_UPDATE_ALL,
    P.QUOTE_DELETE_OWN, P.QUOTE_DELETE_ALL, P.QUOTE_SUBMIT, P.QUOTE_APPROVE, P.QUOTE_REJECT,
    P.QUOTE_SEND, P.QUOTE_EXPORT,
  ] },
  { key: "admin", label: "Quản trị", perms: [
    P.USER_MANAGE, P.ROLE_ASSIGN, P.TEMPLATE_MANAGE, P.COMPANY_MANAGE,
    P.AUDIT_VIEW, P.SETTINGS_MANAGE, P.APPROVAL_MATRIX,
  ] },
];

const EMPLOYEE = [
  P.QUOTE_CREATE, P.QUOTE_READ_OWN, P.QUOTE_UPDATE_OWN, P.QUOTE_DELETE_OWN,
  P.QUOTE_SUBMIT, P.QUOTE_EXPORT,
];

const MANAGER = [
  ...EMPLOYEE,
  P.QUOTE_READ_ALL, P.QUOTE_UPDATE_ALL,
  P.QUOTE_APPROVE, P.QUOTE_REJECT, P.QUOTE_SEND,
  P.AUDIT_VIEW,
];

const ADMIN = [
  ...MANAGER,
  P.QUOTE_DELETE_ALL,
  P.USER_MANAGE, P.ROLE_ASSIGN, P.TEMPLATE_MANAGE, P.COMPANY_MANAGE,
  P.SETTINGS_MANAGE, P.APPROVAL_MATRIX,
];

export const ROLE_PERMISSIONS = {
  admin: new Set(ADMIN),
  manager: new Set(MANAGER),
  employee: new Set(EMPLOYEE),
};

export const ROLE_LABELS = {
  admin: "Quản trị viên",
  manager: "Quản lý",
  employee: "Nhân viên",
};

/** Does this role hold the given permission? (`:all` implies `:own`.) */
export function roleCan(role, permission) {
  const set = ROLE_PERMISSIONS[role];
  if (!set) return false;
  if (set.has(permission)) return true;
  // ":all" grants the matching ":own"
  if (permission.endsWith(":own")) {
    return set.has(permission.replace(/:own$/, ":all"));
  }
  return false;
}

/** can(session, permission) — session is req.session ({ role }). */
export function can(session, permission) {
  return roleCan(session?.role, permission);
}

/**
 * Resource-scoped check. For an action like "quote:update", returns true if the
 * role has ":all", OR has ":own" and owns the resource (createdById === userId).
 */
export function canOnQuote(session, action, quote) {
  const role = session?.role;
  if (roleCan(role, `quote:${action}:all`)) return true;
  if (roleCan(role, `quote:${action}:own`)) {
    return quote && quote.createdById === session.userId;
  }
  return false;
}

/** Express middleware factory: 403 unless the session holds the permission. */
export function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.session?.userId) return res.status(401).json({ error: "Chưa đăng nhập" });
    if (!can(req.session, permission)) {
      return res.status(403).json({ error: "Không có quyền thực hiện thao tác này" });
    }
    next();
  };
}

/** Flat list of permissions a role holds (expanding :all → also :own) for the client matrix. */
export function permissionsForRole(role) {
  const set = ROLE_PERMISSIONS[role] || new Set();
  const out = new Set(set);
  for (const p of set) {
    if (p.endsWith(":all")) out.add(p.replace(/:all$/, ":own"));
  }
  return [...out];
}
