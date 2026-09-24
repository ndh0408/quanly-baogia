/** @vitest-environment jsdom */
/**
 * ============================================================================
 * SOÁT CHÉO rbac#10 — ĐƯỜNG ĐƯA MỘT TÀI KHOẢN "TÙY CHỈNH" VỀ "THEO VAI TRÒ".
 *
 * ── LỖI ────────────────────────────────────────────────────────────────────
 * RBAC-01 đổi nghĩa `permissions: []` thành TƯỚC HẾT QUYỀN (máy chủ ghi phần tử canh gác
 * `__none__`), và thêm `permissions: null` = BỎ TUỲ BIẾN, quay về bộ mặc định của vai trò. Nhưng
 * web không nút nào gửi `null`: "Bỏ hết" rồi Lưu nay là tước quyền, "Điền nhanh" là một bản chụp
 * mới (vẫn Tùy chỉnh), đổi vai trò ở trang Phân quyền không đụng cột permissions. Trang Phân quyền
 * (FE-08) báo "đổi quyền vai trò KHÔNG có tác dụng với họ" mà không có nút nào để sửa — muốn đưa
 * 3 tài khoản bản chụp cứng trên production về theo vai trò chỉ còn cách gọi API tay hoặc SQL.
 *
 * ── BÀI NÀY KHOÁ ───────────────────────────────────────────────────────────
 * - Tài khoản Tùy chỉnh có nút "Về theo vai trò"; bấm rồi Lưu gửi ĐÚNG `permissions: null`.
 * - Cờ Ký chứng từ cũ (`canSign`) KHÔNG còn lọt lại như một quyền ngoài vai trò: mặc định gửi
 *   `canSign: false`, chỉ giữ khi quản trị tích "Giữ quyền Ký chứng từ riêng".
 * - Bấm nút xong mà tích tay / "Bỏ hết" / bật Toàn quyền thì payload quay về dạng cũ (mảng).
 * - Tài khoản theo vai trò sẵn thì KHÔNG có nút (không có gì để bỏ).
 * ============================================================================
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

type GoiGui = Record<string, unknown>;

// An: manager đã tuỳ biến — bản chụp có quyền Ký (canSign đồng bộ = true) nhưng thiếu quyền khách hàng.
const AN = {
  id: 2, username: "an@gianguyen.vn", displayName: "An", role: "manager", email: "an@gianguyen.vn",
  active: true, pending: false, canSign: true, permCustom: true,
  permissions: ["quote:read:own", "quote:sign:own"], effectivePermissions: ["quote:read:own", "quote:sign:own"],
};
// Bình: manager theo vai trò sẵn.
const BINH = {
  id: 3, username: "binh@gianguyen.vn", displayName: "Bình", role: "manager", email: "binh@gianguyen.vn",
  active: true, pending: false, canSign: false, permCustom: false,
  permissions: [], effectivePermissions: ["quote:read:own", "customer:read:all", "customer:read:own"],
};
// Cường: vai trò admin nhưng cột permissions còn bản chụp cũ (nâng quyền qua trang Phân quyền).
const CUONG = {
  id: 4, username: "cuong@gianguyen.vn", displayName: "Cường", role: "admin", email: "cuong@gianguyen.vn",
  active: true, pending: false, canSign: false, permCustom: true,
  permissions: ["quote:read:own"], effectivePermissions: ["quote:read:own", "quote:sign:own", "customer:read:all", "customer:read:own", "user:manage"],
};

const CAT = {
  groups: [
    { key: "quote", label: "Báo giá", perms: [
      { key: "quote:read:own", label: "Xem báo giá của mình" },
      { key: "quote:sign:own", label: "Ký chứng từ" },
    ] },
    { key: "customer", label: "Khách hàng", perms: [
      { key: "customer:read:own", label: "Xem khách của mình" },
      { key: "customer:read:all", label: "Xem mọi khách" },
    ] },
    { key: "admin", label: "Quản trị", perms: [{ key: "user:manage", label: "Quản lý tài khoản" }] },
  ],
  editableRoles: ["manager", "hr"],
  adminOnlyPermissions: ["user:manage"],
  roles: [
    { key: "admin", label: "Quản trị", permissions: ["quote:read:own", "quote:sign:own", "customer:read:all", "user:manage"] },
    { key: "manager", label: "Account", permissions: ["quote:read:own", "customer:read:all"] },
    { key: "hr", label: "Nhân sự", permissions: [] },
  ],
};

const listUsers = vi.fn(async () => [AN, BINH, CUONG]);
const updateUser = vi.fn(async (_id: number, _d: GoiGui) => AN);
const permissionsCatalog = vi.fn(async () => CAT);

vi.mock("../lib/api", () => {
  class ApiError extends Error {
    body: unknown;
    constructor(m: string, body?: unknown) { super(m); this.body = body; }
  }
  return {
    ApiError,
    api: {
      listUsers: () => listUsers(),
      permissionsCatalog: () => permissionsCatalog(),
      updateUser: (id: number, d: GoiGui) => updateUser(id, d),
    },
  };
});
vi.mock("../lib/ui", () => ({
  toast: () => {},
  confirmModal: async () => true,
  fieldErrorsFrom: () => ({}),
  useEscClose: () => {},
}));

import { UsersPage } from "./Users";

let thung: HTMLDivElement;
let goc: Root;

beforeEach(() => {
  listUsers.mockClear(); updateUser.mockClear();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  thung = document.createElement("div");
  document.body.appendChild(thung);
  goc = createRoot(thung);
});
afterEach(() => {
  act(() => goc.unmount());
  thung.remove();
  document.body.innerHTML = "";
});

async function choTa(xong: () => boolean, viec: string) {
  for (let i = 0; i < 50; i++) {
    if (xong()) return;
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }
  throw new Error(`chờ mãi vẫn không thấy ${viec}`);
}

const cacNut = () => [...document.querySelectorAll("button")];
const timNut = (chu: string | RegExp) => cacNut().find((x) => {
  const t = x.textContent?.trim() ?? "";
  return typeof chu === "string" ? t === chu : chu.test(t);
});
const NUT_VE = /Về theo vai trò/;

/** Dựng trang, chờ danh mục quyền về, rồi mở modal Sửa của đúng một nhân viên. */
async function moSua(ten: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await act(async () => {
    goc.render(<QueryClientProvider client={qc}><UsersPage me={{ id: 1 } as never} /></QueryClientProvider>);
  });
  const hang = () => [...document.querySelectorAll("tbody tr")].find((tr) => tr.querySelectorAll("td")[1]?.textContent === ten);
  await choTa(() => !!hang(), `hàng của "${ten}"`);
  await choTa(() => permissionsCatalog.mock.calls.length > 0, "danh mục quyền");
  const sua = [...hang()!.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Sửa")!;
  await act(async () => { sua.click(); });
  // Ma trận chỉ dựng khi `cat` đã về — chờ theo điều kiện.
  await choTa(() => !!document.querySelector(".perm-section") && !document.querySelector(".perm-section")!.textContent!.includes("Đang tải danh mục quyền"), "ma trận quyền");
}

const bamNut = async (chu: string | RegExp) => {
  const b = timNut(chu);
  if (!b) throw new Error(`không có nút ${String(chu)} — đang có: ${cacNut().map((x) => x.textContent?.trim()).join(" | ")}`);
  await act(async () => { b.click(); });
};
const oTich = (nhan: string): HTMLInputElement => {
  const l = [...document.querySelectorAll("label")].find((x) => x.textContent?.includes(nhan));
  const i = l?.querySelector<HTMLInputElement>("input[type=checkbox]");
  if (!i) throw new Error(`không có ô tích "${nhan}"`);
  return i;
};
// Ô trong MA TRẬN: khớp ĐÚNG nhãn quyền (ô "Giữ quyền Ký chứng từ riêng" cũng chứa chữ "Ký chứng từ").
const oQuyen = (nhan: string): HTMLInputElement => {
  const l = [...document.querySelectorAll("label.perm-item")].find((x) => x.querySelector(".perm-item-label")?.textContent?.replace(" 🔒", "") === nhan);
  const i = l?.querySelector<HTMLInputElement>("input[type=checkbox]");
  if (!i) throw new Error(`không có ô quyền "${nhan}" trong ma trận`);
  return i;
};
const tich = async (nhan: string) => { await act(async () => { oTich(nhan).click(); }); };
const tichQuyen = async (nhan: string) => { await act(async () => { oQuyen(nhan).click(); }); };
const THEO_VAI_TRO = (vaiTro: string) => new RegExp(`theo ma trận vai trò\\s*${vaiTro}`);
const guiCuoi = () => updateUser.mock.calls.at(-1)![1];

describe("rbac#10 — modal Sửa: đưa tài khoản Tùy chỉnh về theo vai trò", () => {
  it("bấm 'Về theo vai trò' rồi Lưu → gửi permissions: null (không phải [] = tước hết quyền)", async () => {
    await moSua("An");
    await bamNut(NUT_VE);
    await bamNut("Lưu");
    expect(updateUser).toHaveBeenCalledTimes(1);
    const [id, gui] = updateUser.mock.calls[0];
    expect(id).toBe(AN.id);
    expect(Object.hasOwn(gui, "permissions"), "payload bỏ mất khoá permissions — máy chủ giữ nguyên bản chụp").toBe(true);
    expect(gui.permissions, "không gửi null thì tài khoản vẫn Tùy chỉnh (hoặc bị TƯỚC HẾT QUYỀN nếu là [])").toBe(null);
    expect("role" in gui, "không đổi cờ Quản trị thì không được gửi role").toBe(false);
  });

  it("xem trước hiện ĐÚNG bộ quyền của vai trò + câu nói rõ sẽ theo ma trận vai trò", async () => {
    await moSua("An");
    await bamNut(NUT_VE);
    const sec = document.querySelector(".perm-section")!.textContent!;
    expect(sec).toMatch(THEO_VAI_TRO("Account"));       // nói rõ sẽ theo vai trò nào
    expect(document.querySelector(".perm-preview")!.textContent).toContain("Xem mọi khách"); // quyền của vai trò mà bản chụp không có
    expect(oQuyen("Xem mọi khách").checked).toBe(true);
    expect(oQuyen("Ký chứng từ").checked, "quyền Ký nằm ngoài vai trò manager — không được hiện như vẫn còn").toBe(false);
  });

  it("cờ Ký chứng từ cũ: mặc định gửi canSign: false; tích 'Giữ quyền Ký' thì gửi canSign: true", async () => {
    // Nhánh `null` ở máy chủ cố ý không đụng canSign, mà resolveUserPermissions bắc cầu canSign → quote:sign:own.
    // Không gửi kèm canSign thì người "đã về theo vai trò" vẫn ký được ngoài bộ quyền của vai trò.
    await moSua("An");
    await bamNut(NUT_VE);
    await bamNut("Lưu");
    expect(guiCuoi().permissions).toBe(null);
    expect(guiCuoi().canSign, "bỏ tuỳ biến mà canSign vẫn true → quyền Ký lọt lại ngoài vai trò").toBe(false);

    act(() => goc.unmount()); document.body.innerHTML = ""; thung = document.createElement("div"); document.body.appendChild(thung); goc = createRoot(thung);
    updateUser.mockClear();
    await moSua("An");
    await bamNut(NUT_VE);
    await tich("Giữ quyền Ký chứng từ");
    expect(oQuyen("Ký chứng từ").checked, "xem trước phải hiện quyền Ký khi chọn giữ").toBe(true);
    await bamNut("Lưu");
    expect(guiCuoi().permissions).toBe(null);
    expect(guiCuoi().canSign).toBe(true);
  });

  it("bấm 'Về theo vai trò' rồi TÍCH TAY một ô → payload quay lại mảng (vẫn là Tùy chỉnh)", async () => {
    await moSua("An");
    await bamNut(NUT_VE);
    // Tích một quyền NGOÀI bộ của vai trò (Ký chứng từ) — ma trận lúc này là bộ vai trò + 1 ô.
    await tichQuyen("Ký chứng từ");
    await bamNut("Lưu");
    const gui = guiCuoi();
    expect(Array.isArray(gui.permissions), "đã tích tay mà vẫn gửi null → thao tác tích bị nuốt").toBe(true);
    expect(gui.permissions).toEqual(expect.arrayContaining(["quote:sign:own", "customer:read:all", "quote:read:own"]));
    expect("canSign" in gui, "đường mảng để máy chủ tự đồng bộ canSign như cũ").toBe(false);
  });

  it("bấm 'Về theo vai trò' rồi 'Bỏ hết' → gửi [] như cũ (tước hết quyền), không phải null", async () => {
    await moSua("An");
    await bamNut(NUT_VE);
    await bamNut("Bỏ hết");
    await bamNut("Lưu");
    expect(guiCuoi().permissions).toEqual([]);
  });

  it("bấm 'Về theo vai trò' rồi bật Toàn quyền quản trị → gửi role admin + [] (không phải null)", async () => {
    await moSua("An");
    await bamNut(NUT_VE);
    await tich("Toàn quyền quản trị");
    await bamNut("Lưu");
    expect(guiCuoi().role).toBe("admin");
    expect(guiCuoi().permissions).toEqual([]);
  });

  it("tài khoản ĐANG theo vai trò thì KHÔNG có nút (không có gì để bỏ)", async () => {
    await moSua("Bình");
    expect(timNut(NUT_VE), "hiện nút cho người không Tùy chỉnh — bấm vào là gửi null vô nghĩa").toBeUndefined();
  });

  it("admin còn bản chụp cũ: bỏ Toàn quyền rồi 'Về theo vai trò' → theo vai trò Account, gửi role manager + null", async () => {
    await moSua("Cường");
    expect(timNut(NUT_VE), "đang là Quản trị (toàn quyền) — nút vô nghĩa").toBeUndefined();
    await tich("Toàn quyền quản trị");
    await bamNut(NUT_VE);
    expect(document.querySelector(".perm-section")!.textContent).toMatch(THEO_VAI_TRO("Account"));
    await bamNut("Lưu");
    expect(guiCuoi().role).toBe("manager");
    expect(guiCuoi().permissions).toBe(null);
  });
});
