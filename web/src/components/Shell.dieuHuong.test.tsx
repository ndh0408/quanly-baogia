/** @vitest-environment jsdom */
//
// FE-14: hash lạ (#/abc) rơi vào trang Nhân sự mà KHÔNG qua cổng quyền (key không có trong NAV nên
// `denied` = false) → tài khoản không có quyền nhân sự nhận lỗi 403 từ API thay vì một trang rõ nghĩa.
import { describe, it, expect, vi, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

// Trang con thay bằng dấu hiệu — bài này chỉ hỏi Shell CHỌN trang nào.
const { trang } = vi.hoisted(() => ({
  trang: (ten: string, xuat: string) => async () => {
    const { createElement } = await import("react");
    return { [xuat]: () => createElement("div", { "data-trang": ten }) };
  },
}));
vi.mock("../pages/Personnel", trang("personnel", "PersonnelPage"));
vi.mock("../pages/Employees", trang("employees", "EmployeesPage"));
vi.mock("../pages/Customers", trang("customers", "CustomersPage"));
vi.mock("../pages/Venues", trang("venues", "VenuesPage"));
vi.mock("../pages/Users", trang("users", "UsersPage"));
vi.mock("../pages/Audit", trang("audit", "AuditPage"));
vi.mock("../pages/Permissions", trang("permissions", "PermissionsPage"));
vi.mock("../pages/Profile", trang("profile", "ProfilePage"));
vi.mock("../pages/Notifications", trang("notifications", "NotificationsPage"));
// Trang Tổng quan HỎNG khi render — cho bài FE-16.
vi.mock("../pages/Dashboard", () => ({ DashboardPage: () => { throw new Error("hỏng render"); } }));
vi.mock("../pages/QuoteList", trang("list", "QuoteListPage"));
vi.mock("../pages/Projects", trang("projects", "ProjectsPage"));
vi.mock("../pages/Invoices", trang("invoices", "InvoicesPage"));
vi.mock("../lib/api", async (goc) => {
  const that = await goc<typeof import("../lib/api")>();
  return { ...that, api: new Proxy({}, { get: () => vi.fn(async () => ({ count: 0, data: [] })) }) };
});

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { Shell } from "./Shell";

let root: Root | null = null;
afterEach(() => { if (root) act(() => root!.unmount()); root = null; document.body.innerHTML = ""; location.hash = ""; });

async function mo(hash: string, permissions: string[]) {
  location.hash = hash;
  const hop = document.createElement("div"); document.body.appendChild(hop);
  root = createRoot(hop);
  const me = { id: 1, username: "a", displayName: "A", role: "manager", permissions };
  await act(async () => { root!.render(<Shell me={me} onMe={() => {}} onPreview={() => {}} />); });
  return hop;
}

describe("FE-16 — lỗi render của một trang không khoá cả phiên", () => {
  it("trang A hỏng → báo lỗi ngay trong khung; đổi sang trang B thì B hiện bình thường", async () => {
    const loi = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const hop = await mo("#/dashboard", ["quote:create", "quote:read:own"]);
      expect(hop.textContent).toContain("Không tải được trang");
      expect(hop.querySelector(".sidebar"), "menu vẫn còn — lỗi không thay cả app").not.toBeNull();
      await act(async () => { location.hash = "#/list"; await new Promise((r) => setTimeout(r, 20)); });
      expect(hop.querySelector('[data-trang="list"]')).not.toBeNull();
    } finally { loi.mockRestore(); }
  });
});

describe("FE-14 — hash lạ", () => {
  it("#/abc → trang 'Không tìm thấy', KHÔNG rơi vào trang Nhân sự", async () => {
    const hop = await mo("#/abc", ["quote:read:own", "quote:create"]);
    expect(hop.querySelector('[data-trang="personnel"]')).toBeNull();
    expect(hop.textContent).toContain("Không tìm thấy trang");
  });
  it("#/personnel vẫn là trang Nhân sự (có quyền) / bị chặn (không quyền)", async () => {
    const hop = await mo("#/personnel", ["personnel:read:own"]);
    expect(hop.querySelector('[data-trang="personnel"]')).not.toBeNull();
    act(() => root!.unmount()); root = null;
    const hop2 = await mo("#/personnel", ["quote:read:own"]);
    expect(hop2.querySelector('[data-trang="personnel"]')).toBeNull();
    expect(hop2.textContent).toContain("Không có quyền truy cập");
  });
});
