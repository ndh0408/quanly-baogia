/** @vitest-environment jsdom */
/**
 * ============================================================================
 * MẤT ĐIỆN THOẠI + HẾT MÃ DỰ PHÒNG = TÀI KHOẢN KHOÁ CỨNG, NẾU ADMIN KHÔNG CÓ NÚT NÀY.
 *
 * ── CA CÓ THẬT, VÀ KHÔNG CÓ ĐƯỜNG THOÁT NÀO KHÁC ───────────────────────────
 * Người dùng bật bảo mật 2 lớp, rồi đổi/mất điện thoại hoặc xoá app Authenticator, và đã dùng hết
 * mã dự phòng. Từ lúc đó:
 *   · họ không đăng nhập được  → nên cũng không thể tự vào Hồ sơ mà tắt MFA;
 *   · "Quên mật khẩu" KHÔNG cứu được, vì đặt lại mật khẩu xong vẫn phải qua bước nhập mã 6 số;
 *   · admin "Khóa" rồi "Mở khóa" cũng vô nghĩa — cờ `mfaEnabled` không đổi.
 * Backend đã có `resetMfa` (POST /api/users/:id/mfa-reset) từ trước, nhưng giao diện KHÔNG có nút
 * nào gọi tới nó. Tức đường thoát tồn tại trong code mà không tồn tại với người dùng: muốn cứu
 * phải người biết chạy SQL tay vào cột `mfaEnabled` trên production.
 *
 * ── NÚT NÀY HẠ MỘT LỚP BẢO MẬT, NÊN BÀI KHOÁ CẢ HAI CHIỀU ──────────────────
 * 1. Có nút khi `mfaEnabled: true` — nếu không thì ca trên vẫn không có đường thoát.
 * 2. KHÔNG có nút khi MFA vốn đã tắt — nút bấm được mà backend trả 400 là mời admin đi vào lỗi;
 *    và một nút "hạ bảo mật" hiện ở mọi hàng thì lần nào cũng phải đọc kỹ mới dám bấm đúng hàng.
 * 3. Phải qua `confirmModal` và huỷ xác nhận thì KHÔNG gọi API — đây là hành động một chiều
 *    (backend tắt cờ rồi thu hồi mọi phiên của người đó), lỡ tay là người ta bị đá khỏi phiên và
 *    tài khoản đứng trần cho tới khi họ tự bật lại.
 *
 * `mfaEnabled` phải có trong `USER_SELECT` của userService, nếu không `u.mfaEnabled` luôn
 * `undefined` và nút không bao giờ hiện — tests/gx-gdpr-xoa-sot-cot-pii.test.js gác phần cột.
 * ============================================================================
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PermCatalog } from "../lib/api";

const CHUNG = {
  role: "manager", phone: "0909123456", projectCode: "FE_A",
  active: true, pending: false, permissions: [], effectivePermissions: [],
};
const CO_MFA = { ...CHUNG, id: 7, username: "lan@gianguyen.vn", displayName: "Nguyễn Thị Lan", email: "lan@gianguyen.vn", mfaEnabled: true };
const KHONG_MFA = { ...CHUNG, id: 8, username: "hoa@gianguyen.vn", displayName: "Trần Thị Hoa", email: "hoa@gianguyen.vn", mfaEnabled: false };

const listUsers = vi.fn(async () => [CO_MFA, KHONG_MFA]);
const resetMfa = vi.fn(async (_id: number) => ({ ok: true as const }));
// Kiểu khai TƯỜNG MINH: để TS suy ra từ `groups: []` thì nó ra `never[]`, và ca nào
// `mockResolvedValueOnce` một danh mục quyền THẬT sẽ đỏ ở `tsc` (vitest chạy qua esbuild,
// không typecheck — nên lỗi chỉ nổ ở cổng dựng image, xa chỗ gây ra nó).
const permissionsCatalog = vi.fn(async (): Promise<PermCatalog> => ({ groups: [], editableRoles: [], adminOnlyPermissions: [], roles: [] }));

vi.mock("../lib/api", () => {
  class ApiError extends Error {}
  return {
    ApiError,
    api: {
      listUsers: () => listUsers(),
      permissionsCatalog: () => permissionsCatalog(),
      resetMfa: (id: number) => resetMfa(id),
      updateUser: async () => CO_MFA,
      inviteUser: async () => ({ user: { email: "" }, inviteUrl: "", emailSent: true }),
    },
  };
});

/** `confirmModal` điều khiển được: ca "huỷ xác nhận" phải cho nó trả `false`. */
let dongY = true;
const confirmModal = vi.fn(async () => dongY);
vi.mock("../lib/ui", () => ({
  toast: () => {},
  confirmModal: () => confirmModal(),
  fieldErrorsFrom: () => ({}),
  useEscClose: () => {},
}));

import { UsersPage } from "./Users";

let thung: HTMLDivElement;
let goc: Root;

beforeEach(() => {
  listUsers.mockClear(); resetMfa.mockClear(); confirmModal.mockClear();
  dongY = true;
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

const cacNut = () => [...document.querySelectorAll("button")];
const nutMfa = () => cacNut().filter((b) => b.textContent?.trim() === "Đặt lại MFA");

async function dung() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await act(async () => {
    goc.render(
      <QueryClientProvider client={qc}>
        <UsersPage me={{ id: 1 } as never} />
      </QueryClientProvider>
    );
  });
  // Chờ theo ĐIỀU KIỆN, không đếm nhịp (react-query cần bao nhiêu vòng micro-task là chuyện của nó).
  for (let i = 0; i < 50; i++) {
    if (cacNut().some((b) => b.textContent?.trim() === "Sửa")) return;
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }
  throw new Error("chờ mãi vẫn không thấy hàng nhân viên nào");
}

describe("Quản lý nhân viên — nút Đặt lại MFA", () => {
  it("hiện ĐÚNG ở hàng đang bật MFA, và KHÔNG hiện ở hàng đã tắt", async () => {
    await dung();
    const nut = nutMfa();
    expect(nut.length, `số nút "Đặt lại MFA" phải bằng số hàng đang bật MFA (1) — đang có ${nut.length}`).toBe(1);

    // Đúng HÀNG nào mới là điều quan trọng: một nút hạ bảo mật đặt sai hàng thì tệ hơn là không có.
    const hang = nut[0].closest("tr");
    expect(hang?.textContent, 'nút "Đặt lại MFA" nằm ở hàng của người KHÔNG bật MFA').toContain("Nguyễn Thị Lan");
    expect(hang?.textContent).not.toContain("Trần Thị Hoa");
  });

  it("bấm → xác nhận → gọi api.resetMfa đúng id", async () => {
    await dung();
    await act(async () => { nutMfa()[0].click(); });
    expect(confirmModal, "gọi thẳng API mà không hỏi — đây là hành động hạ bảo mật một chiều").toHaveBeenCalledTimes(1);
    expect(resetMfa).toHaveBeenCalledTimes(1);
    expect(resetMfa.mock.calls[0][0], "reset MFA cho SAI người").toBe(CO_MFA.id);
  });

  it("huỷ hộp xác nhận thì KHÔNG gọi API", async () => {
    dongY = false;
    await dung();
    await act(async () => { nutMfa()[0].click(); });
    expect(confirmModal).toHaveBeenCalledTimes(1);
    expect(resetMfa, "bấm Huỷ mà MFA vẫn bị tắt — hộp xác nhận chỉ để trang trí").not.toHaveBeenCalled();
  });
});
