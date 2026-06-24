// Typed API client cho backend Express (cùng origin → cookie session tự gửi).
export type Me = {
  id: number;
  username: string;
  displayName: string;
  role: string;
  permissions: string[];
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

// Phân quyền (Permissions — increment 4).
export type PermCatalog = {
  groups: { label: string; perms: { key: string; label: string }[] }[];
  roles: { key: string; label: string; permissions: string[] }[];
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
  login: (username: string, password: string) => req("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }),
  logout: () => req("/auth/logout", { method: "POST" }),
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
};
