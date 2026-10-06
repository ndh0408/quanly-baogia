/** @vitest-environment jsdom */
//
// Menu "Hóa đơn" đổi thành HAI trang (chủ repo 2026-09-30): "hiện tại có 1 trang hóa đơn, cái đó thành hóa đơn
// đầu ra và thêm 1 trang hóa đơn đầu vào". Bài này khoá phần Shell: nhãn mới, đúng thứ tự, cùng cổng quyền
// `invoice:page`, link cũ #/invoices còn sống (dấu trang, thẻ "Cần xử lý" ở Tổng quan vẫn trỏ vào đó), và người
// không có quyền không thấy cả hai — kể cả gõ thẳng hash.
import { describe, it, expect, vi, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

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
vi.mock("../pages/Dashboard", trang("dashboard", "DashboardPage"));
vi.mock("../pages/QuoteList", trang("list", "QuoteListPage"));
vi.mock("../pages/Projects", trang("projects", "ProjectsPage"));
vi.mock("../pages/Invoices", trang("invoices", "InvoicesPage"));
vi.mock("../pages/InvoicesIn", trang("invoices-in", "InvoicesInPage"));
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
  const me = { id: 1, username: "a", displayName: "A", role: "accountant", permissions };
  await act(async () => { root!.render(<Shell me={me} onMe={() => {}} onPreview={() => {}} />); });
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  return hop;
}
const menu = (hop: HTMLElement) => [...hop.querySelectorAll(".sidebar nav.menu a")].map((a) => ({ chu: (a.querySelector("span")?.textContent ?? "").trim(), href: a.getAttribute("href") }));

describe("Menu Hóa đơn đầu ra / đầu vào", () => {
  it("người có invoice:page thấy HAI mục theo đúng thứ tự, nhãn mới, link đúng; nhãn cũ 'Hóa đơn' trơn biến mất", async () => {
    const hop = await mo("#/invoices", ["invoice:page"]);
    const m = menu(hop);
    const iRa = m.findIndex((x) => x.chu === "Hóa đơn đầu ra"), iVao = m.findIndex((x) => x.chu === "Hóa đơn đầu vào");
    expect(iRa, JSON.stringify(m)).toBeGreaterThanOrEqual(0);
    expect(iVao, "đầu vào đứng NGAY SAU đầu ra").toBe(iRa + 1);
    expect(m[iRa].href).toBe("#/invoices");          // khoá cũ giữ nguyên — dấu trang / thẻ Tổng quan không gãy
    expect(m[iVao].href).toBe("#/invoices-in");
    expect(m.map((x) => x.chu), "còn mục tên 'Hóa đơn' cũ").not.toContain("Hóa đơn");
  });

  it("#/invoices là Hóa đơn ĐẦU RA (trang cũ), #/invoices-in là trang ĐẦU VÀO; mục đang mở được đánh dấu", async () => {
    const hop = await mo("#/invoices", ["invoice:page"]);
    expect(hop.querySelector('[data-trang="invoices"]')).not.toBeNull();
    expect(hop.querySelector('[data-trang="invoices-in"]')).toBeNull();
    await act(async () => { location.hash = "#/invoices-in"; await new Promise((r) => setTimeout(r, 20)); });
    expect(hop.querySelector('[data-trang="invoices-in"]')).not.toBeNull();
    expect(hop.querySelector('[data-trang="invoices"]')).toBeNull();
    const dangMo = hop.querySelector('.sidebar nav.menu a[aria-current="page"]');
    expect(dangMo?.textContent).toContain("Hóa đơn đầu vào");
    // Tiêu đề thanh trên (mobile) lấy nhãn mục đang mở.
    expect(hop.querySelector(".mt-title")?.textContent).toBe("Hóa đơn đầu vào");
  });

  it("KHÔNG có invoice:page → không thấy mục nào, và gõ thẳng #/invoices-in hay #/invoices đều bị chặn", async () => {
    for (const hash of ["#/invoices-in", "#/invoices"]) {
      const hop = await mo(hash, ["quote:read:own", "quote:create"]);
      expect(menu(hop).map((x) => x.chu).filter((c) => c.startsWith("Hóa đơn")), hash).toEqual([]);
      expect(hop.querySelector('[data-trang="invoices-in"]'), hash).toBeNull();
      expect(hop.querySelector('[data-trang="invoices"]'), hash).toBeNull();
      expect(hop.textContent).toContain("Không có quyền truy cập");
      act(() => root!.unmount()); root = null;
    }
  });

  it("quyền xem Quản lý dự án (invoice:read) KHÔNG đủ để vào trang Hóa đơn đầu vào — đó là dữ liệu chi phí", async () => {
    const hop = await mo("#/invoices-in", ["invoice:read"]);
    expect(hop.querySelector('[data-trang="invoices-in"]')).toBeNull();
    expect(hop.textContent).toContain("Không có quyền truy cập");
  });
});
