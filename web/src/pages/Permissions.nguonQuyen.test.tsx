/** @vitest-environment jsdom */
//
// FE-08: máy chủ (src/permissions.ts resolveUserPermissions) BỎ QUA vai trò khi tài khoản có bộ quyền
// riêng. Trang Phân quyền trước đây không cho thấy ai đang "Tùy chỉnh" → admin bỏ quyền khỏi vai trò,
// tưởng đã thu hồi, người đó vẫn giữ nguyên.
import { describe, it, expect, vi, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("../lib/api", async (goc) => {
  const that = await goc<typeof import("../lib/api")>();
  return {
    ...that,
    api: {
      ...that.api,
      permissionsCatalog: vi.fn(async () => ({
        roles: [{ key: "admin", label: "Quản trị", permissions: [] }, { key: "manager", label: "Quản lý", permissions: ["quote:send"] }],
        groups: [{ label: "Báo giá", perms: [{ key: "quote:send", label: "Gửi khách" }] }],
        editableRoles: ["manager"], adminOnlyPermissions: [],
      })),
      listUsers: vi.fn(async () => [
        { id: 1, username: "admin", displayName: "Admin", role: "admin", active: true },
        { id: 2, username: "an", displayName: "An", role: "manager", active: true, permCustom: true },
        { id: 3, username: "binh", displayName: "Bình", role: "manager", active: true, permCustom: false },
      ]),
    },
  };
});

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { PermissionsPage } from "./Permissions";

let root: Root | null = null;
afterEach(() => { if (root) act(() => root!.unmount()); root = null; document.body.innerHTML = ""; });

describe("FE-08 — trang Phân quyền nói rõ ai KHÔNG theo vai trò", () => {
  it("người permCustom hiện nhãn 'Tùy chỉnh', người thường 'Theo vai trò'; có cảnh báo + đếm theo vai trò", async () => {
    const hop = document.createElement("div"); document.body.appendChild(hop);
    root = createRoot(hop);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const me = { id: 1, username: "admin", displayName: "Admin", role: "admin", permissions: ["user:manage"] };
    await act(async () => { root!.render(<QueryClientProvider client={qc}><PermissionsPage me={me} /></QueryClientProvider>); });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    const hang = (ten: string) => [...hop.querySelectorAll("tbody tr")].find((tr) => tr.textContent?.includes(ten))!;
    expect(hang("An").textContent).toContain("Tùy chỉnh — không theo vai trò");
    expect(hang("Bình").textContent).toContain("Theo vai trò");
    expect(hop.textContent).toContain("1 tài khoản đang dùng quyền Tùy chỉnh");
    expect(hop.textContent).toContain("1 theo vai trò · 1 tùy chỉnh");
  });
});
