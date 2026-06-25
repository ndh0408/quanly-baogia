// Central RBAC: a permission catalog + static role→permission map + a can() helper.
// Replaces ad-hoc `session.role === "admin"` checks scattered across routes.
//
// Permission format: "resource:action" or "resource:action:scope".
//   scope "own"  → only resources the user created
//   scope "all"  → any resource
// A role granted "quote:update:all" implicitly also has "own".

import type { Request, Response, NextFunction } from "express";

export const PERMISSIONS = {
  // Quotes
  QUOTE_CREATE:       "quote:create",
  QUOTE_READ_OWN:     "quote:read:own",
  QUOTE_READ_ALL:     "quote:read:all",
  QUOTE_UPDATE_OWN:   "quote:update:own",
  QUOTE_UPDATE_ALL:   "quote:update:all",
  QUOTE_DELETE_OWN:   "quote:delete:own",
  QUOTE_DELETE_ALL:   "quote:delete:all",
  // Luồng duyệt nội bộ (quote:submit/approve/approve:own/reject) ĐÃ BỎ 2026-06-22:
  // vòng đời mới draft → converted/lost; "duyệt" thật = quyết định của khách.
  QUOTE_SEND:         "quote:send",
  QUOTE_EXPORT:       "quote:export",
  // Customers (CRM)
  CUSTOMER_READ_OWN:   "customer:read:own",
  CUSTOMER_READ_ALL:   "customer:read:all",
  CUSTOMER_MANAGE_OWN: "customer:manage:own",
  CUSTOMER_MANAGE_ALL: "customer:manage:all",
  // Products / price book
  PRODUCT_READ:        "product:read",
  PRODUCT_READ_COST:   "product:read:cost", // see costPrice / margin
  PRODUCT_MANAGE:      "product:manage",
  // Admin / management
  USER_MANAGE:        "user:manage",
  ROLE_ASSIGN:        "role:assign",
  TEMPLATE_MANAGE:    "template:manage",
  COMPANY_MANAGE:     "company:manage",
  AUDIT_VIEW:         "audit:view",
  SETTINGS_MANAGE:    "settings:manage",
  // Nhân sự (hồ sơ nhân công — trang "Nhân sự"). Account tạo + sở hữu; hr/accountant chỉ đọc.
  PERSONNEL_CREATE:     "personnel:create",
  PERSONNEL_READ_OWN:   "personnel:read:own",
  PERSONNEL_READ_ALL:   "personnel:read:all",
  PERSONNEL_MANAGE_OWN: "personnel:manage:own",
  PERSONNEL_MANAGE_ALL: "personnel:manage:all",
  PERSONNEL_MARK_PAYMENT: "personnel:pay", // Kế toán bấm "đã thanh toán" (có ngày) — KHÔNG sửa hồ sơ
  PERSONNEL_CONFIRM:      "personnel:confirm", // ADMIN bấm xác nhận "đã ký" (có ngày) — chỉ admin
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
  [P.QUOTE_SEND]:       "Gửi cho khách",
  [P.QUOTE_EXPORT]:     "Xuất Excel/PDF",
  [P.CUSTOMER_READ_OWN]:   "Xem KH của mình",
  [P.CUSTOMER_READ_ALL]:   "Xem mọi khách hàng",
  [P.CUSTOMER_MANAGE_OWN]: "Quản lý KH của mình",
  [P.CUSTOMER_MANAGE_ALL]: "Quản lý mọi khách hàng",
  [P.PRODUCT_READ]:        "Xem sản phẩm",
  [P.PRODUCT_READ_COST]:   "Xem giá vốn / biên LN",
  [P.PRODUCT_MANAGE]:      "Quản lý sản phẩm",
  [P.USER_MANAGE]:      "Quản lý nhân viên",
  [P.ROLE_ASSIGN]:      "Phân vai trò",
  [P.TEMPLATE_MANAGE]:  "Quản lý mẫu",
  [P.COMPANY_MANAGE]:   "Quản lý công ty",
  [P.AUDIT_VIEW]:       "Xem nhật ký",
  [P.SETTINGS_MANAGE]:  "Cài đặt hệ thống",
  [P.PERSONNEL_CREATE]:     "Tạo hồ sơ nhân sự",
  [P.PERSONNEL_READ_OWN]:   "Xem hồ sơ mình tạo",
  [P.PERSONNEL_READ_ALL]:   "Xem mọi hồ sơ nhân sự",
  [P.PERSONNEL_MANAGE_OWN]: "Sửa/xóa hồ sơ mình tạo",
  [P.PERSONNEL_MANAGE_ALL]: "Sửa/xóa mọi hồ sơ nhân sự",
  [P.PERSONNEL_MARK_PAYMENT]: "Đánh dấu đã thanh toán",
  [P.PERSONNEL_CONFIRM]: "Xác nhận đã ký",
};

// Permission groups for nicer matrix rendering.
export const PERMISSION_GROUPS = [
  { key: "quote", label: "Báo giá", perms: [
    P.QUOTE_CREATE, P.QUOTE_READ_OWN, P.QUOTE_READ_ALL, P.QUOTE_UPDATE_OWN, P.QUOTE_UPDATE_ALL,
    P.QUOTE_DELETE_OWN, P.QUOTE_DELETE_ALL,
    P.QUOTE_SEND, P.QUOTE_EXPORT,
  ] },
  { key: "customer", label: "Khách hàng", perms: [
    P.CUSTOMER_READ_OWN, P.CUSTOMER_READ_ALL, P.CUSTOMER_MANAGE_OWN, P.CUSTOMER_MANAGE_ALL,
  ] },
  { key: "product", label: "Sản phẩm", perms: [
    P.PRODUCT_READ, P.PRODUCT_READ_COST, P.PRODUCT_MANAGE,
  ] },
  { key: "admin", label: "Quản trị", perms: [
    P.USER_MANAGE, P.ROLE_ASSIGN, P.TEMPLATE_MANAGE, P.COMPANY_MANAGE,
    P.AUDIT_VIEW, P.SETTINGS_MANAGE,
  ] },
  { key: "personnel", label: "Nhân sự", perms: [
    P.PERSONNEL_CREATE, P.PERSONNEL_READ_OWN, P.PERSONNEL_READ_ALL, P.PERSONNEL_MANAGE_OWN, P.PERSONNEL_MANAGE_ALL,
    P.PERSONNEL_MARK_PAYMENT, P.PERSONNEL_CONFIRM,
  ] },
];

const EMPLOYEE = [
  P.QUOTE_CREATE, P.QUOTE_READ_OWN, P.QUOTE_UPDATE_OWN, P.QUOTE_DELETE_OWN,
  P.QUOTE_EXPORT,
  // CRM: the customer-code list is a SHARED company directory — everyone can read/select any
  // customer code when making a quote; a salesperson still only manages (create/edit/delete)
  // the ones they own. Product catalog is read-only (selling price, no cost).
  P.CUSTOMER_READ_OWN, P.CUSTOMER_READ_ALL, P.CUSTOMER_MANAGE_OWN, P.PRODUCT_READ,
];

const MANAGER = [
  ...EMPLOYEE,
  // Manager sees/edits only the quotes THEY created (not everyone's).
  P.QUOTE_SEND,
  P.AUDIT_VIEW,
  // Manager sees all customers and the cost/margin, and owns the product catalog.
  P.CUSTOMER_READ_ALL, P.CUSTOMER_MANAGE_ALL, P.PRODUCT_READ_COST, P.PRODUCT_MANAGE,
  // Nhân sự: Account TẠO hồ sơ + chỉ thấy/sửa của MÌNH (owner-scoped).
  P.PERSONNEL_CREATE, P.PERSONNEL_READ_OWN, P.PERSONNEL_MANAGE_OWN,
];

const ADMIN = [
  ...MANAGER,
  // Director sees & edits & deletes ALL quotes.
  P.QUOTE_READ_ALL, P.QUOTE_UPDATE_ALL, P.QUOTE_DELETE_ALL,
  P.USER_MANAGE, P.ROLE_ASSIGN, P.TEMPLATE_MANAGE, P.COMPANY_MANAGE,
  P.SETTINGS_MANAGE,
  // Nhân sự: admin xem + sửa/xóa MỌI hồ sơ + đánh dấu thanh toán + xác nhận đã ký.
  P.PERSONNEL_READ_ALL, P.PERSONNEL_MANAGE_ALL, P.PERSONNEL_MARK_PAYMENT, P.PERSONNEL_CONFIRM,
];

// Nhân sự (hr) + Kế toán (accountant): CHỈ XEM mọi hồ sơ nhân sự (read-only). Không tạo/sửa/xóa,
// không thấy báo giá/khách/sản phẩm. (Kế toán cần xem lương/thuế/thanh toán; Nhân sự xem hồ sơ.)
const HR = [P.PERSONNEL_READ_ALL];
// Kế toán: xem mọi hồ sơ + ĐÁNH DẤU đã thanh toán (có ngày). KHÔNG sửa nội dung hồ sơ.
const ACCOUNTANT = [P.PERSONNEL_READ_ALL, P.PERSONNEL_MARK_PAYMENT];

// Account Hà Nội: quyền TỐI THIỂU. Chỉ với tay tới báo giá ĐƯỢC GIAO (là member) để
// đọc/sửa — nhưng presentQuote LƯỢC chỉ còn bảng nội bộ "hanoi" + route write-guard chỉ
// cho ghi đúng phần đó. KHÔNG tạo báo giá, KHÔNG thấy của người khác, KHÔNG export.
const ACCOUNT_HN = [
  P.QUOTE_READ_OWN,    // chỉ báo giá được giao (member); server lược chỉ còn phần HN
  P.QUOTE_UPDATE_OWN,  // chỉ ghi được bảng hanoi (write-guard ở route)
];

export const ROLE_PERMISSIONS: Record<string, Set<string>> = {
  admin: new Set(ADMIN),
  manager: new Set(MANAGER),
  account_hn: new Set(ACCOUNT_HN),
  hr: new Set(HR),
  accountant: new Set(ACCOUNTANT),
  // 'employee' role bỏ từ 2026-06-15 (chỉ còn admin + manager + account_hn). EMPLOYEE vẫn
  // giữ làm danh sách quyền NỀN mà MANAGER kế thừa (`...EMPLOYEE`), không phải vai trò gán được.
};

export const ROLE_LABELS = {
  admin: "Quản trị",
  manager: "Account",
  account_hn: "Account Hà Nội",
  hr: "Nhân sự",
  accountant: "Kế toán",
};

// ── PHÂN QUYỀN ĐỘNG (override từ DB) ──────────────────────────────────────────
// Cache trong tiến trình: role → tập quyền GHI ĐÈ. Nạp lúc khởi động + sau mỗi lần admin sửa
// (src/roleOverrides.ts). KHÔNG có override cho 1 role → dùng mặc định ROLE_PERMISSIONS (hành vi cũ).
const roleOverrides = new Map<string, Set<string>>();

// Vai trò admin LUÔN dùng mặc định (full) — chống tự khóa, KHÔNG cho ghi đè.
function effectiveRoleSet(role: string | undefined): Set<string> | undefined {
  if (role === "admin") return ROLE_PERMISSIONS.admin;
  return roleOverrides.get(role as string) ?? ROLE_PERMISSIONS[role as string];
}

/** Nạp TOÀN BỘ override từ DB vào cache (thay sạch). Bỏ qua 'admin' + role không tồn tại. */
export function loadRoleOverrides(rows: { role: string; permissions: string[] }[]) {
  roleOverrides.clear();
  for (const r of rows) if (r.role !== "admin" && ROLE_PERMISSIONS[r.role]) roleOverrides.set(r.role, new Set(r.permissions));
}
/** Cập nhật cache 1 role sau khi lưu/đặt lại. permissions=null → xóa override (về mặc định). */
export function setRoleOverrideCache(role: string, permissions: string[] | null) {
  if (role === "admin") return;
  if (permissions === null) roleOverrides.delete(role);
  else roleOverrides.set(role, new Set(permissions));
}
/** Role này có đang dùng override (khác mặc định) không. */
export function hasRoleOverride(role: string) { return roleOverrides.has(role); }
/** Vai trò ĐƯỢC PHÉP sửa quyền (mọi role trừ admin). */
export const EDITABLE_ROLES = Object.keys(ROLE_PERMISSIONS).filter((r) => r !== "admin");

// Hình dạng tối thiểu của req.session mà các hàm phân quyền cần (userId + role).
type SessionLike = { userId?: number; role?: string };

/** Does this role hold the given permission? (`:all` implies `:own`.) */
export function roleCan(role: string | undefined, permission: string) {
  const set = effectiveRoleSet(role);
  if (!set) return false;
  if (set.has(permission)) return true;
  // ":all" grants the matching ":own"
  if (permission.endsWith(":own")) {
    return set.has(permission.replace(/:own$/, ":all"));
  }
  return false;
}

/** can(session, permission) — session is req.session ({ role }). */
export function can(session: SessionLike, permission: string) {
  return roleCan(session?.role, permission);
}

/**
 * Resource-scoped check. For an action like "quote:update", returns true if the
 * role has ":all", OR has ":own" and owns the resource (createdById === userId).
 */
// Actions a non-admin gets on a quote merely by being a MEMBER (added to it).
// (Membership grants view + edit, but NOT delete.)
const QUOTE_MEMBER_ACTIONS = new Set(["read", "update"]);

export function canOnQuote(
  session: SessionLike,
  action: string,
  quote: { createdById?: number; members?: any[] } | null | undefined,
) {
  const role = session?.role;
  if (roleCan(role, `quote:${action}:all`)) return true; // admin
  if (roleCan(role, `quote:${action}:own`)) {
    if (!quote) return false;
    if (quote.createdById === session.userId) return true;
    // Managers AND employees also reach quotes they were added to as members.
    if (QUOTE_MEMBER_ACTIONS.has(action) && Array.isArray(quote.members)) {
      return quote.members.some((m: any) => (m.id ?? m) === session.userId);
    }
  }
  return false;
}

/**
 * Prisma `where` fragment limiting quotes to what the caller may SEE:
 *   admin             → all
 *   manager/employee  → quotes they created OR were added to as a member
 */
export function quoteScopeWhere(session: SessionLike) {
  if (roleCan(session?.role, "quote:read:all")) return {}; // admin (director)
  return { OR: [{ createdById: session.userId }, { members: { some: { id: session.userId } } }] };
}

/**
 * Generic resource-scoped check (e.g. customers). Returns true if the role has
 * `<resource>:<action>:all`, OR has `:own` and owns the row via `ownerField`.
 */
export function canScoped(session: SessionLike, resource: string, action: string, row: Record<string, any> | null | undefined, ownerField = "ownerId") {
  const role = session?.role;
  if (roleCan(role, `${resource}:${action}:all`)) return true;
  if (roleCan(role, `${resource}:${action}:own`)) {
    return row && row[ownerField] != null && row[ownerField] === session?.userId;
  }
  return false;
}

/** Express middleware factory: 403 unless the session holds the permission. */
export function requirePermission(permission: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.session?.userId) return res.status(401).json({ error: "Chưa đăng nhập" });
    if (!can(req.session, permission)) {
      return res.status(403).json({ error: "Không có quyền thực hiện thao tác này" });
    }
    next();
  };
}

/** Flat list of permissions a role holds (expanding :all → also :own) for the client matrix. */
export function permissionsForRole(role: string) {
  const set = effectiveRoleSet(role) || new Set();
  const out = new Set(set);
  for (const p of set) {
    if (p.endsWith(":all")) out.add(p.replace(/:all$/, ":own"));
  }
  return [...out];
}
