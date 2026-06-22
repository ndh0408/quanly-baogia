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
};
