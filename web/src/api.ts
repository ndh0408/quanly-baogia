// Typed API client cho backend Express (cùng origin → cookie session tự gửi).
export type Me = {
  id: number;
  username: string;
  displayName: string;
  role: string;
  permissions: string[];
  email?: string;
  phone?: string | null;
  title?: string | null;
  senderName?: string | null;
  mfaEnabled?: boolean;
  canSign?: boolean;
};

export type Personnel = {
  id: number;
  createdById: number;
  fullName: string;
  createdBy?: { id: number; displayName: string; username?: string };
  [key: string]: unknown;
};

// Danh bạ nhân viên (10 trường cá nhân) — chọn khi tạo hồ sơ Nhân sự để tự điền.
export type Employee = {
  id: number;
  createdById: number;
  fullName: string;
  createdBy?: { id: number; displayName: string; username?: string };
  [key: string]: unknown;
};
export type EmployeeListResult = {
  data: Employee[];
  meta: { total: number; page: number; size: number; pageCount: number };
};

// Dự án ĐÃ CHỐT để chọn khi tạo hồ sơ Nhân sự (tự điền Tên dự án / Mã dự án / Account / CTY).
export type Project = {
  projectCode: string; projectName: string; projectNameContract: string;
  accountName: string; company: string; sheetName: string;
};

// Khách hàng (đang port admin sang React — increment 1).
export type Customer = { id: number; code: string; name: string; phone?: string | null; email?: string | null; [k: string]: unknown };
export type CustomerListResult = { data: Customer[]; meta: { total: number; page: number; size: number; pageCount: number } };

// Người dùng (Quản lý nhân viên — increment 2). /api/users trả MẢNG (không phân trang).
export type User = {
  id: number; username: string; displayName: string; role: string;
  phone?: string | null; projectCode?: string | null; email?: string | null;
  active: boolean; pending: boolean; canSign?: boolean;
};
export type InviteResult = { user: { email: string }; inviteUrl: string; emailSent: boolean };

// Nhật ký hoạt động (Audit — increment 3).
export type AuditEntry = { id: string; createdAt: string; action: string; resource: string; resourceId?: string | null; actor?: { displayName?: string; username?: string } | null };
export type AuditListResult = { data: AuditEntry[]; meta: { total: number; page: number; size: number; pageCount: number } };

// Thông báo (Notifications — increment 6).
export type Notif = { id: number; title: string; body: string; resource?: string | null; resourceId?: string | null; readAt?: string | null; createdAt: string };

// Danh sách báo giá (increment 8). Row linh hoạt (presentQuoteRow — thường + account_hn).
export type QuoteRow = {
  id: number; quoteNumber?: string; projectCode?: string | null; projectVersion?: number | null;
  title: string; status: string; quoteDate: string; createdById?: number;
  createdBy?: { id: number; displayName: string } | null;
  company?: { id: number; name: string; shortName?: string } | null;
  total?: number; toCompany?: string; customerCode?: string | null; sheetCount?: number;
  hnStatus?: string | null; hnSheetCount?: number; hnTotal?: number; _accountHnRow?: boolean;
};
export type QuoteListResult = { data: QuoteRow[]; meta: { total: number; page: number; size: number; pageCount: number } };

// Quản lý dự án (increment 9) — báo giá đã chốt, mỗi sheet 1 dòng theo dõi hoá đơn.
export type ProjectSheet = {
  id?: number; name?: string | null; subtotal?: number; hcm?: number; hanoi?: number; khach?: number; cty?: string | null;
  signedAt?: string | null; signedByName?: string | null; invoiceNo?: string | null; paidAt?: string | null;
  invStatus?: string; poNumber?: string | null; hnInvoiceNo?: string | null; invoiceLink?: string | null;
  docSentAt?: string | null; docReturnedAt?: string | null;
};
export type ProjectQuote = {
  id: number; title: string; status: string; vatPercent?: number; subtotal?: number; executionDate?: string | null;
  quoteNumber?: string; projectCode?: string | null; projectVersion?: number | null; customerCode?: string | null; hnStatus?: string | null;
  company?: { shortName?: string; name?: string } | null; createdBy?: { displayName?: string } | null; sheets?: ProjectSheet[];
};

// Editor báo giá (increment 10).
export type EditorCompany = { id: number; name: string; shortName?: string; address?: string };
export type EditorTemplate = { id: number; code?: string; name: string; companyId?: number; layout?: { hasDays?: boolean; hasDetail?: boolean; numberSubsections?: boolean } };
export type QuoteFull = {
  id: number; _new?: boolean; status: string; title?: string; quoteNumber?: string; projectCode?: string | null; projectVersion?: number | null;
  companyId?: number; city?: string; quoteDate?: string; executionDate?: string | null; vatPercent?: number; discount?: number; showTotals?: boolean;
  greeting?: string; notes?: string; toCompany?: string; toContact?: string; toEmail?: string; toPhone?: string; toAddress?: string;
  fromContact?: string; fromTitle?: string; fromPhone?: string; fromAddress?: string; createdById?: number;
  members?: { id: number; displayName?: string }[]; sheets?: unknown[]; hnStatus?: string | null; [k: string]: unknown;
};
export type QuoteVersion = { id: string; versionNo: number; total: number; createdAt: string; createdById?: number | null };
export type AssignableUser = { id: number; displayName: string; role?: string; title?: string | null; senderName?: string | null };

// Phân quyền (Permissions — increment 4).
export type PermCatalog = {
  groups: { label: string; perms: { key: string; label: string }[] }[];
  editableRoles: string[];
  roles: { key: string; label: string; permissions: string[]; overridden?: boolean; editable?: boolean }[];
};

export type Summary = { salary: number; pit: number; taxableIncome: number };
export type ListResult = {
  data: Personnel[];
  meta: { total: number; page: number; size: number; pageCount: number };
  summary: Summary;
};

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

async function req<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch("/api" + path, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(opts.headers ?? {}) },
    ...opts,
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    // Mất phiên giữa chừng → báo App quay về màn đăng nhập (App lắng nghe "auth:expired").
    if (res.status === 401) window.dispatchEvent(new Event("auth:expired"));
    const msg = (body && typeof body === "object" && "error" in body ? String((body as { error: unknown }).error) : null) ?? `Lỗi ${res.status}`;
    throw new ApiError(msg, res.status, body);
  }
  return body as T;
}

export const api = {
  me: () => req<Me>("/auth/me"),
  login: (username: string, password: string, mfaToken?: string) => req<Me>("/auth/login", { method: "POST", body: JSON.stringify({ username, password, ...(mfaToken ? { mfaToken } : {}) }) }),
  logout: () => req("/auth/logout", { method: "POST" }),
  forgotPassword: (email: string) => req<unknown>("/auth/forgot-password", { method: "POST", body: JSON.stringify({ email }) }),
  getInvite: (token: string) => req<{ email: string; displayName?: string }>(`/auth/invite/${encodeURIComponent(token)}`),
  acceptInvite: (data: { token: string; displayName: string; senderName?: string; phone?: string; title?: string; password: string }) => req<Me>("/auth/accept-invite", { method: "POST", body: JSON.stringify(data) }),
  searchQuotes: (q: string) => req<{ results: { quotes?: { id: number; quoteNumber?: string; projectCode?: string | null; title: string; status: string }[] } }>(`/search?q=${encodeURIComponent(q)}&types=quote&limit=8`),
  listPersonnel: (q = "", page = 1, size = 50, sort = "createdAt", order: "asc" | "desc" = "desc") =>
    req<ListResult>(`/personnel?${new URLSearchParams({ q, page: String(page), size: String(size), sort, order })}`),
  createPersonnel: (data: Record<string, unknown>) => req<Personnel>("/personnel", { method: "POST", body: JSON.stringify(data) }),
  updatePersonnel: (id: number, data: Record<string, unknown>) => req<Personnel>(`/personnel/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deletePersonnel: (id: number) => req<{ ok: boolean }>(`/personnel/${id}`, { method: "DELETE" }),
  // Kế toán đánh dấu đã/chưa thanh toán (lưu ngày)
  markPayment: (id: number, paid: boolean) => req<Personnel>(`/personnel/${id}/payment`, { method: "POST", body: JSON.stringify({ paid }) }),
  // Admin xác nhận đã/chưa ký (lưu ngày)
  markConfirm: (id: number, confirmed: boolean) => req<Personnel>(`/personnel/${id}/confirm`, { method: "POST", body: JSON.stringify({ confirmed }) }),
  // Danh bạ nhân viên
  listEmployees: (q = "", page = 1, size = 50, sort = "fullName", order: "asc" | "desc" = "asc") =>
    req<EmployeeListResult>(`/employees?${new URLSearchParams({ q, page: String(page), size: String(size), sort, order })}`),
  createEmployee: (data: Record<string, unknown>) => req<Employee>("/employees", { method: "POST", body: JSON.stringify(data) }),
  updateEmployee: (id: number, data: Record<string, unknown>) => req<Employee>(`/employees/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteEmployee: (id: number) => req<{ ok: boolean }>(`/employees/${id}`, { method: "DELETE" }),
  // Dự án đã chốt (của mình) — để chọn khi tạo hồ sơ Nhân sự
  listProjects: (q = "") => req<{ data: Project[] }>(`/personnel/projects?${new URLSearchParams({ q })}`),
  // Khách hàng (admin → React, increment 1). Server tự cô lập theo ownerId.
  listCustomers: (q = "", page = 1, size = 20, sort = "createdAt", order: "asc" | "desc" = "desc") =>
    req<CustomerListResult>(`/customers?${new URLSearchParams({ q, page: String(page), size: String(size), sort, order })}`),
  getCustomer: (id: number) => req<Customer>(`/customers/${id}`),
  createCustomer: (data: { name: string; code?: string }) => req<Customer>("/customers", { method: "POST", body: JSON.stringify(data) }),
  updateCustomer: (id: number, data: { name: string }) => req<Customer>(`/customers/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteCustomer: (id: number) => req<{ ok: boolean }>(`/customers/${id}`, { method: "DELETE" }),
  // Quản lý nhân viên (increment 2) — gate user:manage (Shell nav đã lọc).
  listUsers: () => req<User[]>("/users"),
  inviteUser: (data: { email: string; displayName: string; role: string; projectCode: string | null }) =>
    req<InviteResult>("/users/invite", { method: "POST", body: JSON.stringify(data) }),
  resendInvite: (id: number) => req<{ inviteUrl: string; emailSent: boolean }>(`/users/${id}/resend-invite`, { method: "POST" }),
  updateUser: (id: number, data: Record<string, unknown>) => req<User>(`/users/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteUser: (id: number) => req<{ ok: boolean }>(`/users/${id}`, { method: "DELETE" }),
  // Nhật ký hoạt động (increment 3) — gate audit:view (Shell nav + server).
  listAudit: (p: { action?: string; resource?: string; from?: string; to?: string; page?: number; size?: number }) => {
    const sp = new URLSearchParams();
    if (p.action) sp.set("action", p.action);
    if (p.resource) sp.set("resource", p.resource);
    if (p.from) sp.set("from", p.from);
    if (p.to) sp.set("to", p.to);
    sp.set("page", String(p.page ?? 1));
    sp.set("size", String(p.size ?? 50));
    return req<AuditListResult>(`/audit?${sp}`);
  },
  // Phân quyền (increment 4) — gate user:manage.
  permissionsCatalog: () => req<PermCatalog>("/permissions/catalog"),
  // Phân quyền động: đặt/đặt-lại quyền cho 1 vai trò (admin only; 'admin' không sửa được).
  setRolePermissions: (role: string, permissions: string[]) =>
    req<{ role: string; permissions: string[]; overridden: boolean }>(`/permissions/roles/${encodeURIComponent(role)}`, { method: "PUT", body: JSON.stringify({ permissions }) }),
  resetRolePermissions: (role: string) =>
    req<{ role: string; permissions: string[]; overridden: boolean }>(`/permissions/roles/${encodeURIComponent(role)}`, { method: "DELETE" }),
  // Tài khoản (Profile — increment 5).
  updateProfile: (data: { displayName: string; senderName: string; phone: string; title: string }) =>
    req<Me>("/auth/profile", { method: "POST", body: JSON.stringify(data) }),
  changePassword: (oldPassword: string, newPassword: string) =>
    req<unknown>("/auth/change-password", { method: "POST", body: JSON.stringify({ oldPassword, newPassword }) }),
  mfaSetup: () => req<{ qr: string; secret: string }>("/mfa/setup", { method: "POST" }),
  mfaEnable: (data: { secret: string; token: string; password: string }) =>
    req<{ backupCodes: string[] }>("/mfa/enable", { method: "POST", body: JSON.stringify(data) }),
  mfaDisable: (data: { password: string; token: string }) =>
    req<unknown>("/mfa/disable", { method: "POST", body: JSON.stringify(data) }),
  // Tổng quan / Analytics (increment 7).
  analyticsOverview: () => req<{ kpi: { totalQuotes: number; approvedAmount: number; avgDealSize: number; conversionRate: number } }>("/analytics/overview"),
  analyticsFunnel: () => req<{ data: { status: string; count: number }[] }>("/analytics/funnel"),
  analyticsTopSales: () => req<{ data: { user?: { displayName?: string } | null; count: number; amount: number }[] }>("/analytics/top-sales?limit=10"),
  // Danh sách báo giá (increment 8).
  listQuotes: (p: { q?: string; status?: string; sort?: string; order?: string; page?: number; size?: number }) => {
    const sp = new URLSearchParams();
    if (p.q) sp.set("q", p.q);
    if (p.status) sp.set("status", p.status);
    sp.set("sort", p.sort || "createdAt"); sp.set("order", p.order || "desc");
    sp.set("page", String(p.page ?? 1)); sp.set("size", String(p.size ?? 20));
    return req<QuoteListResult>(`/quotes?${sp}`);
  },
  duplicateQuote: (id: number, sameProject = false) =>
    req<QuoteRow>(`/quotes/${id}/duplicate`, { method: "POST", body: JSON.stringify(sameProject ? { sameProject: true } : {}) }),
  deleteQuote: (id: number) => req<{ ok: boolean }>(`/quotes/${id}`, { method: "DELETE" }),
  // Quản lý dự án (increment 9) — báo giá đã chốt + theo dõi hoá đơn/ký.
  quoteProjects: () => req<{ data: ProjectQuote[] }>("/quotes/projects"),
  updateSheetInvoice: (sheetId: number, field: string, val: string | null) =>
    req<unknown>(`/quotes/sheets/${sheetId}/invoice`, { method: "PUT", body: JSON.stringify({ [field]: val }) }),
  signSheet: (sheetId: number, signed: boolean) =>
    req<unknown>(`/quotes/sheets/${sheetId}/sign`, { method: "POST", body: JSON.stringify({ signed }) }),
  // Thông báo (increment 6).
  listNotifications: () => req<{ data: Notif[] }>("/notifications?size=50"),
  markNotifRead: (id: number) => req<unknown>(`/notifications/${id}/read`, { method: "POST" }),
  markAllNotifsRead: () => req<unknown>("/notifications/read-all", { method: "POST" }),
  unreadCount: () => req<{ count: number }>("/notifications/unread-count").catch(() => ({ count: 0 })),
  // Editor báo giá (increment 10) — catalog + CRUD + chuyển trạng thái + phiên bản + thành viên.
  metaCompanies: () => req<EditorCompany[]>("/meta/companies"),
  metaTemplates: () => req<EditorTemplate[]>("/meta/templates"),
  getQuote: (id: number) => req<QuoteFull>(`/quotes/${id}`),
  createQuote: (payload: unknown) => req<QuoteFull>("/quotes", { method: "POST", body: JSON.stringify(payload) }),
  updateQuote: (id: number, payload: unknown) => req<QuoteFull>(`/quotes/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  // Presence: báo editor đang mở/heartbeat/đóng 1 báo giá → trả danh sách người đang sửa (gồm cả mình).
  presence: (quoteId: number, action: "open" | "heartbeat" | "close") =>
    req<{ editing: { id: number; name: string }[] }>("/stream/presence", { method: "POST", body: JSON.stringify({ quoteId, action }) }),
  markConverted: (id: number) => req<QuoteFull>(`/quotes/${id}/mark-converted`, { method: "POST" }),
  markLost: (id: number, reason: string) => req<QuoteFull>(`/quotes/${id}/mark-lost`, { method: "POST", body: JSON.stringify({ reason }) }),
  quoteVersions: (id: number) => req<{ data: QuoteVersion[] }>(`/quotes/${id}/versions`),
  versionDiff: (id: number, a: number, b: number) => req<{ from: number; to: number; changes: { key: string; before: unknown; after: unknown }[] }>(`/quotes/${id}/versions/${a}/diff/${b}`),
  assignableUsers: () => req<{ data: AssignableUser[] }>("/quotes/assignable-users"),
  setMembers: (id: number, memberIds: number[]) => req<unknown>(`/quotes/${id}/members`, { method: "PUT", body: JSON.stringify({ memberIds }) }),
  // Luồng HN (giao/duyệt phần Hà Nội cho Account HN) — increment 10 stage 5.
  hnAccounts: () => req<{ data: { id: number; displayName?: string; username?: string }[] }>("/quotes/hn/accounts"),
  hnAssign: (id: number, accountId: number) => req<unknown>(`/quotes/${id}/hn/assign`, { method: "POST", body: JSON.stringify({ accountId }) }),
  hnReview: (id: number, decision: "approve" | "reject", note?: string) => req<unknown>(`/quotes/${id}/hn/review`, { method: "POST", body: JSON.stringify({ decision, note }) }),
  saveHn: (id: number, hnSheets: unknown[]) => req<unknown>(`/quotes/${id}/hn`, { method: "PUT", body: JSON.stringify({ hnSheets }) }),
  submitHn: (id: number) => req<unknown>(`/quotes/${id}/hn/submit`, { method: "POST" }),
};
