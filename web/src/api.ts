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
};
