/** @vitest-environment jsdom */
/**
 * ============================================================================
 * SOÁT CHÉO rbac#12 — FE-08 GẮN NHÃN "TÙY CHỈNH" CHO TÀI KHOẢN QUẢN TRỊ.
 *
 * ── LỖI ────────────────────────────────────────────────────────────────────
 * `listUsers` tính `permCustom = permissions.length > 0` BẤT KỂ vai trò, còn ô chọn vai trò ở trang
 * Phân quyền chỉ gửi `{ role }` — nâng một manager đã tuỳ biến lên admin là để lại cột permissions
 * cũ. Trang Phân quyền (chỉ xét `u.permCustom`) khi đó hiện người này "Tùy chỉnh — không theo vai
 * trò" ngay cạnh ô "Quản trị", đếm họ vào banner "đổi vai trò KHÔNG có tác dụng với họ", và cột
 * Quản trị ghi "0 theo vai trò · 1 tùy chỉnh". Thực tế resolveUserPermissions trả TOÀN QUYỀN cho
 * admin, bỏ qua permissions; trang Quản lý nhân viên thì ghi "Quản trị". Hai trang nói ngược nhau.
 *
 * ── BÀI NÀY KHOÁ ───────────────────────────────────────────────────────────
 * - Tài khoản vai trò admin KHÔNG bao giờ là "Tùy chỉnh" ở trang này (nhãn, banner, đếm cột).
 * - Nâng lên Quản trị ở đây gửi kèm `permissions: []` (như modal Sửa) — không đẻ thêm admin mang
 *   bản chụp cũ, và bảng cập nhật tại chỗ thôi hiện "Tùy chỉnh" cho người vừa nâng.
 * - Đổi giữa các vai trò thường vẫn CHỈ gửi `{ role }` (không đụng quyền đã tuỳ biến).
 * ============================================================================
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

type GoiGui = Record<string, unknown>;
const NGUOI = () => [
  { id: 1, username: "admin", displayName: "Admin", role: "admin", active: true, permCustom: false },
  // Nâng lên admin qua ô chọn vai trò từ trước bản vá → cột permissions còn bản chụp cũ.
  { id: 2, username: "cuong", displayName: "Cường", role: "admin", active: true, permCustom: true },
  { id: 3, username: "an", displayName: "An", role: "manager", active: true, permCustom: true },
  { id: 4, username: "binh", displayName: "Bình", role: "manager", active: true, permCustom: false },
];
const updateUser = vi.fn(async (_id: number, _d: GoiGui) => ({}));

vi.mock("../lib/api", async (goc) => {
  const that = await goc<typeof import("../lib/api")>();
  return {
    ...that,
    api: {
      ...that.api,
      permissionsCatalog: vi.fn(async () => ({
        roles: [
          { key: "admin", label: "Quản trị", permissions: [] },
          { key: "manager", label: "Account", permissions: ["quote:send"] },
          { key: "hr", label: "Nhân sự", permissions: [] },
        ],
        groups: [{ label: "Báo giá", perms: [{ key: "quote:send", label: "Gửi khách" }] }],
        editableRoles: ["manager", "hr"], adminOnlyPermissions: [],
      })),
      listUsers: vi.fn(async () => NGUOI()),
      updateUser: (id: number, d: GoiGui) => updateUser(id, d),
    },
  };
});
vi.mock("../lib/ui", () => ({ toast: () => {}, confirmModal: async () => true }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { PermissionsPage } from "./Permissions";

let root: Root | null = null;
let hop: HTMLDivElement;
beforeEach(() => { updateUser.mockClear(); });
afterEach(() => { if (root) act(() => root!.unmount()); root = null; document.body.innerHTML = ""; });

async function dung() {
  hop = document.createElement("div"); document.body.appendChild(hop);
  root = createRoot(hop);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const me = { id: 1, username: "admin", displayName: "Admin", role: "admin", permissions: ["user:manage"] };
  await act(async () => { root!.render(<QueryClientProvider client={qc}><PermissionsPage me={me} /></QueryClientProvider>); });
  for (let i = 0; i < 50 && !hop.querySelector(".list-table"); i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
const hang = (ten: string) => [...hop.querySelectorAll(".list-table tbody tr")].find((tr) => tr.querySelectorAll("td")[0]?.textContent === ten)!;
const oNguon = (ten: string) => hang(ten).querySelectorAll("td")[3].textContent ?? "";
const demCot = (nhanVaiTro: string) => [...hop.querySelectorAll(".perm-matrix thead th")].find((th) => th.textContent?.startsWith(nhanVaiTro))?.textContent ?? "";
async function doiVaiTro(ten: string, role: string) {
  const sel = hang(ten).querySelector("select")!;
  await act(async () => { sel.value = role; sel.dispatchEvent(new Event("change", { bubbles: true })); });
  for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

describe("rbac#12 — tài khoản vai trò Quản trị không bao giờ là 'Tùy chỉnh' ở trang Phân quyền", () => {
  it("admin còn permissions cũ: nhãn Nguồn quyền là Toàn quyền, KHÔNG đếm vào banner, cột Quản trị không có 'tùy chỉnh'", async () => {
    await dung();
    expect(oNguon("Cường"), "trang Nhân viên ghi 'Quản trị' mà trang này ghi 'Tùy chỉnh' — hai trang nói ngược nhau").not.toContain("Tùy chỉnh");
    expect(oNguon("Cường")).toContain("Toàn quyền");
    expect(oNguon("Admin")).toContain("Toàn quyền");
    expect(oNguon("An")).toContain("Tùy chỉnh — không theo vai trò");
    expect(oNguon("Bình")).toContain("Theo vai trò");
    expect(hop.textContent, "banner đếm cả admin — admin luôn toàn quyền, không phải 'đổi vai trò không có tác dụng'").toContain("1 tài khoản đang dùng quyền Tùy chỉnh");
    expect(demCot("Quản trị")).toContain("2 theo vai trò · 0 tùy chỉnh");
    expect(demCot("Account")).toContain("1 theo vai trò · 1 tùy chỉnh");
  });

  it("banner KHÔNG còn nói 'đổi vai trò … không có tác dụng' trơn — nâng lên Quản trị là cấp toàn quyền", async () => {
    await dung();
    const banner = hop.querySelector("[role=note]")!.textContent!;
    expect(banner).not.toMatch(/đổi quyền vai trò hay đổi vai trò ở đây KHÔNG có tác dụng/);
    expect(banner).toMatch(/Quản trị/);
  });

  it("nâng một tài khoản Tùy chỉnh lên Quản trị → gửi role admin + permissions: [], và hàng thôi hiện 'Tùy chỉnh'", async () => {
    await dung();
    await doiVaiTro("An", "admin");
    expect(updateUser).toHaveBeenCalledTimes(1);
    const [id, gui] = updateUser.mock.calls[0];
    expect(id).toBe(3);
    expect(gui.role).toBe("admin");
    expect(gui.permissions, "chỉ gửi {role} là để lại bản chụp cũ trên một tài khoản admin").toEqual([]);
    expect(oNguon("An")).not.toContain("Tùy chỉnh");
    expect(hop.querySelector("[role=note]"), "không còn ai Tùy chỉnh (không tính admin) mà banner vẫn hiện").toBeNull();
  });

  it("vế đối trọng: đổi giữa hai vai trò thường vẫn CHỈ gửi { role } — không xoá bộ quyền đã tuỳ biến", async () => {
    await dung();
    await doiVaiTro("An", "hr");
    expect(updateUser).toHaveBeenCalledTimes(1);
    const gui = updateUser.mock.calls[0][1];
    expect(gui).toEqual({ role: "hr" });
    expect(oNguon("An")).toContain("Tùy chỉnh — không theo vai trò");
  });
});
