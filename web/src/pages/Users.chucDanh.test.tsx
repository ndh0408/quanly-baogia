/** @vitest-environment jsdom */
/**
 * ============================================================================
 * MODAL "SỬA NHÂN VIÊN" PHẢI CÓ Ô CHỨC DANH — VÀ Ô ĐÓ PHẢI NẠP SẴN.
 *
 * ── THIẾU SÓT ──────────────────────────────────────────────────────────────
 * `title` là cột GHI-ĐƯỢC-KHÔNG-ĐỌC-ĐƯỢC: hai schema quản trị đều nhận, service đều ghi, nhưng
 * `USER_SELECT` không trả về nên GET /api/users không có cột đó và modal không dựng nổi ô. Chức
 * danh lại là thứ IN LÊN BÁO GIÁ GỬI KHÁCH (dòng dưới tên người gửi). Nhân viên được mời qua email
 * mà bỏ trống ô Chức danh ở màn #/onboard thì trong ứng dụng KHÔNG ai nhìn thấy hay sửa hộ được —
 * chỉ chính người đó sửa được ở trang Hồ sơ cá nhân.
 *
 * ── VÌ SAO PHẢI KIỂM Ở TẦNG GIAO DIỆN ──────────────────────────────────────
 * Backend đã thông cả hai chiều (tests/cd-quan-tri-sua-chuc-danh.test.js), nhưng đường ghi chỉ có
 * ích khi form THẬT SỰ dựng ô và gửi khoá đó lên. Và chiều đọc còn quan trọng hơn: thêm ô mà quên
 * nạp sẵn `user.title` là đẻ ra một đường XOÁ TRẮNG mới — ô hiện rỗng dù CSDL đang có giá trị, rồi
 * lần Lưu kế tiếp (payload gửi `null` theo đúng luật "ô nạp sẵn ⇒ rỗng là xoá") quét sạch chức danh
 * của người ta. Đúng hình dạng sự cố đã xoá trắng hồ sơ 5/10 tài khoản trên production.
 *
 * ── BÀI NÀY KHOÁ ───────────────────────────────────────────────────────────
 * Ô có mặt, NẠP SẴN từ giá trị đang có, gửi đúng khoá `title`, và xoá trắng thì gửi `null` (không
 * phải "" và không phải bỏ khoá). Cộng hai vế đối trọng: câu chữ trùng trang Hồ sơ cá nhân, và
 * modal "Mời" KHÔNG có ô này — `UserInviteSchema` không nhận `title`, `inviteUser` không ghi, nên
 * thêm ô vào đó mà không vá hai chỗ kia chỉ tạo một ô CÂM (zod strip khoá lạ, không báo lỗi gì).
 * ============================================================================
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

type GoiGui = Record<string, unknown>;
const NHAN_VIEN = {
  id: 7, username: "lan@gianguyen.vn", displayName: "Nguyễn Thị Lan", role: "manager",
  phone: "0909123456", projectCode: "FE_A", email: "lan@gianguyen.vn",
  title: "Account", senderName: "Chị Lan",
  active: true, pending: false, permissions: [], effectivePermissions: [],
};

const listUsers = vi.fn(async () => [NHAN_VIEN]);
const updateUser = vi.fn(async (_id: number, _d: GoiGui) => NHAN_VIEN);
const inviteUser = vi.fn(async (_d: GoiGui) => ({ user: { email: "moi@gianguyen.vn" }, inviteUrl: "http://x/#/onboard?token=abc", emailSent: true }));
const permissionsCatalog = vi.fn(async () => ({ groups: [], editableRoles: [], adminOnlyPermissions: [], roles: [] }));

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
      inviteUser: (d: GoiGui) => inviteUser(d),
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
  listUsers.mockClear(); updateUser.mockClear(); inviteUser.mockClear();
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

async function dung() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await act(async () => {
    goc.render(
      <QueryClientProvider client={qc}>
        <UsersPage me={{ id: 1 } as never} />
      </QueryClientProvider>
    );
  });
  // Chờ theo ĐIỀU KIỆN, không đếm nhịp — react-query cần bao nhiêu vòng micro-task là chuyện của nó.
  await choTa(() => !!timNut("Sửa"), 'nút "Sửa" của hàng nhân viên');
}

async function choTa(xong: () => boolean, viec: string) {
  for (let i = 0; i < 50; i++) {
    if (xong()) return;
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }
  throw new Error(`chờ mãi vẫn không thấy ${viec}`);
}

const nhan = () => [...document.querySelectorAll("label span")].map((s) => s.textContent ?? "");
const coNhan = (ten: string) => nhan().includes(ten);
const oTheoNhan = (ten: string): HTMLInputElement => {
  const l = [...document.querySelectorAll("label")].find((x) => x.querySelector("span")?.textContent === ten);
  const i = l?.querySelector("input");
  if (!i) throw new Error(`không có ô "${ten}" — đang có: ${nhan().join(", ")}`);
  return i;
};
const timNut = (chu: string) => [...document.querySelectorAll("button")].find((x) => x.textContent?.trim() === chu);
const nutTheoChu = (chu: string): HTMLButtonElement => {
  const b = timNut(chu);
  if (!b) throw new Error(`không có nút "${chu}" — đang có: ${[...document.querySelectorAll("button")].map((x) => x.textContent?.trim()).join(" | ")}`);
  return b;
};
const bam = async (chu: string) => { await act(async () => { nutTheoChu(chu).click(); }); };

function go(o: HTMLInputElement, v: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(o, v);
    o.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("Quản lý nhân viên — ô Chức danh", () => {
  it("SỬA: ô NẠP SẴN chức danh đang có, gõ mới thì GỬI đúng khoá title", async () => {
    // Hai khẳng định là hai lỗi khác nhau, và cái đầu nguy hiểm hơn: ô hiện rỗng trong khi CSDL có
    // giá trị thì chính việc thêm ô này trở thành một đường xoá dữ liệu.
    await dung();
    await bam("Sửa");
    expect(oTheoNhan("Chức danh").value, "modal Sửa không pre-fill chức danh đang có — lần Lưu kế tiếp sẽ XOÁ nó").toBe("Account");

    go(oTheoNhan("Chức danh"), "Trưởng phòng KD");
    await bam("Lưu");

    expect(updateUser).toHaveBeenCalledTimes(1);
    const [id, gui] = updateUser.mock.calls[0];
    expect(id).toBe(NHAN_VIEN.id);
    expect(gui.title, "modal Sửa không gửi title lên máy chủ").toBe("Trưởng phòng KD");
  });

  it("SỬA: xoá trắng ô Chức danh thì gửi `null` — xoá là xoá, không phải 'không đổi'", async () => {
    // Ô nạp sẵn ⇒ admin nhìn thấy "Account" rồi mới xoá ⇒ phải gửi KHOÁ lên (bỏ khoá là giấu mất ý
    // định), và gửi `null` để nói thẳng "xoá" ngay ở tầng payload.
    await dung();
    await bam("Sửa");
    go(oTheoNhan("Chức danh"), "");
    await bam("Lưu");

    const gui = updateUser.mock.calls[0][1];
    expect(Object.hasOwn(gui, "title"), "xoá trắng ô thì modal bỏ luôn khoá title").toBe(true);
    expect(gui.title, "gửi chuỗi rỗng thay vì null → ý định xoá bị nuốt").toBe(null);
  });

  it("vế đối trọng: câu chữ TRÙNG trang Hồ sơ cá nhân", async () => {
    // Ba nơi cùng một trường (Hồ sơ, #/onboard, Quản lý nhân viên) phải cùng một cách gọi tên và
    // cùng một gợi ý — lệch chữ là người dùng tưởng ba trường khác nhau.
    await dung();
    await bam("Sửa");
    expect(oTheoNhan("Chức danh").placeholder).toBe("VD: Account, Sale…");
  });

  it("vế đối trọng: modal MỜI KHÔNG có ô Chức danh", async () => {
    // Quyết định có chủ ý, không phải bỏ sót: `UserInviteSchema` không nhận `title` và `inviteUser`
    // không ghi cột đó, nên một ô ở đây sẽ là ô CÂM — `validate()` dùng `z.object().parse()` nên zod
    // STRIP khoá lạ im lặng, admin gõ chức danh, bấm Gửi lời mời, và không gì được lưu, không lỗi nào
    // hiện ra. Màn #/onboard đã hỏi chức danh, và từ bản vá này admin sửa được ngay ở modal "Sửa".
    // Muốn thêm ô thì phải vá `UserInviteSchema` + `inviteUser` TRƯỚC, y hệt thứ tự của `title`.
    await dung();
    await bam("+ Thêm nhân viên");
    expect(coNhan("Chức danh"), "modal Mời có ô Chức danh nhưng lời mời không lưu được cột đó — ô câm").toBe(false);
  });
});

describe("Quản lý nhân viên — trường KHÔNG có ô điều khiển thì KHÔNG được gửi", () => {
  /* ── VÌ SAO ───────────────────────────────────────────────────────────────────────────────
     Cùng luật đã áp cho ba trường hồ sơ và cho vai trò, nay áp nốt cho TÊN ĐĂNG NHẬP. Ô username
     trong modal Sửa là `<input disabled>` — người dùng không điều khiển được — nhưng payload vẫn
     kèm `username: user.username` mỗi lần Lưu.

     Hôm nay vô hại vì `UserUpdateSchema` không khai khoá đó nên zod strip im lặng. Ngày nào ai đó
     thêm `username` vào schema (vd để cho đổi tên đăng nhập), dòng ấy lập tức thành lệnh ghi đè
     mỗi lần Lưu — và `updateUser` KHÔNG gọi `timTaiKhoanTrung`, nên không có chốt chống trùng nào
     chặn lại: lỗi sẽ nổ ra ở ràng buộc unique của Postgres, dạng 500. */

  it("payload của modal Sửa KHÔNG kèm `username`", async () => {
    await dung();
    await bam("Sửa");
    go(oTheoNhan("SĐT"), "0911222333");
    await bam("Lưu");

    const gui = updateUser.mock.calls.at(-1)![1];
    expect("username" in gui, "payload vẫn kèm username dù ô đó bị disabled — trường không điều khiển được thì không gửi").toBe(false);
    expect(gui.phone, "vế đối trọng: ô CÓ điều khiển được thì vẫn phải gửi").toBe("0911222333");
  });
});
