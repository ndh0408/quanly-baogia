/** @vitest-environment jsdom */
/**
 * ============================================================================
 * MODAL "SỬA NHÂN VIÊN" PHẢI CÓ Ô EMAIL — VÀ Ô ĐÓ PHẢI NẠP SẴN.
 *
 * ── THIẾU SÓT ──────────────────────────────────────────────────────────────
 * `email` là ảnh gương của ca `title`: `USER_SELECT` trả cột này về (giao diện ĐỌC được từ lâu) mà
 * KHÔNG schema quản trị nào NHẬN nó, nên email đặt được ĐÚNG MỘT LẦN lúc mời rồi khoá cứng. Một
 * địa chỉ gõ sai một ký tự là một tài khoản không ai sửa nổi: người đó không nhận được lời mời,
 * không đặt lại được mật khẩu, không nhận được thông báo — và `email` còn là MỘT TRONG HAI ĐỊNH DANH
 * ĐĂNG NHẬP (`findLoginUser` khớp `username` HOẶC `email`).
 *
 * ── VÌ SAO PHẢI KIỂM Ở TẦNG GIAO DIỆN ──────────────────────────────────────
 * Backend đã thông cả hai chiều (tests/em-quan-tri-sua-email.test.js), nhưng đường ghi chỉ có ích
 * khi form THẬT SỰ dựng ô và gửi khoá đó lên. Và chiều ĐỌC quan trọng hơn: thêm khoá `email` vào
 * `UserUpdateSchema` mà ô không nạp sẵn là đẻ ra một đường XOÁ TRẮNG mới — ô hiện rỗng dù CSDL đang
 * có địa chỉ, rồi mỗi lần bấm Lưu (payload gửi `null` theo luật "ô nạp sẵn ⇒ rỗng là xoá") quét sạch
 * định danh đăng nhập của người ta. Đây là biến thể NẶNG NHẤT của sự cố đã xoá trắng hồ sơ 5/10 tài
 * khoản trên production, vì mất email là mất luôn đường tự lấy lại tài khoản.
 *
 * Đó chính là lý do THỨ TỰ VÁ bắt buộc (src/validators.ts đã chốt sẵn cho `title`): USER_SELECT trả
 * cột → ô NẠP SẴN trong modal → rồi mới cho schema nhận khoá. Bài này là mắt giữa.
 *
 * ── BÀI NÀY KHOÁ ───────────────────────────────────────────────────────────
 * Ô có mặt, NẠP SẴN từ `user.email`, gửi đúng khoá `email`, xoá trắng thì gửi `null` (không phải ""
 * và không phải bỏ khoá), và nhãn ô PHẢI NÓI RA hệ quả của việc để trống — ba ô hồ sơ kia xoá đi chỉ
 * mất một dòng in trên báo giá, còn ô này xoá đi làm chết âm thầm ba đường, nên im lặng là để admin
 * tự bắn vào chân mình.
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
/** Khớp theo TIỀN TỐ của nhãn: nhãn ô Email mang thêm một `<em class="unit">` giải thích, nên
 *  `textContent` không còn bằng đúng "Email" — khớp tuyệt đối ở đây là khớp vào định dạng, không
 *  phải vào trường. */
const oTheoTienTo = (tt: string): HTMLInputElement => {
  const l = [...document.querySelectorAll("label")].find((x) => (x.querySelector("span")?.textContent ?? "").startsWith(tt));
  const i = l?.querySelector("input");
  if (!i) throw new Error(`không có ô bắt đầu bằng "${tt}" — đang có: ${nhan().join(" | ")}`);
  return i;
};
const timNut = (chu: string) => [...document.querySelectorAll("button")].find((x) => x.textContent?.trim() === chu);
const nutTheoChu = (chu: string): HTMLButtonElement => {
  const b = timNut(chu);
  if (!b) throw new Error(`không có nút "${chu}"`);
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

describe("Quản lý nhân viên — ô Email", () => {
  it("SỬA: ô NẠP SẴN email đang có, gõ mới thì GỬI đúng khoá email", async () => {
    // Khẳng định ĐẦU nguy hiểm hơn khẳng định sau: ô hiện rỗng trong khi CSDL có địa chỉ thì chính
    // việc thêm ô này biến mỗi lượt Lưu thành một lệnh xoá định danh đăng nhập.
    await dung();
    await bam("Sửa");
    expect(oTheoTienTo("Email").value, "modal Sửa không pre-fill email đang có — mỗi lần bấm Lưu sẽ XOÁ nó").toBe("lan@gianguyen.vn");

    go(oTheoTienTo("Email"), "lan.moi@gianguyen.vn");
    await bam("Lưu");

    expect(updateUser).toHaveBeenCalledTimes(1);
    const [id, gui] = updateUser.mock.calls[0];
    expect(id).toBe(NHAN_VIEN.id);
    expect(gui.email, "modal Sửa không gửi email lên máy chủ — ô câm").toBe("lan.moi@gianguyen.vn");
  });

  it("SỬA: ô Email là ô BẮT BUỘC — không xoá trắng được", async () => {
    /* NGOẠI LỆ CÓ CHỦ Ý so với ba ô hồ sơ bên cạnh (chúng theo luật "có nạp sẵn ⇒ rỗng = xoá").

       Email là đường phục hồi DUY NHẤT, mà endpoint quên-mật-khẩu luôn trả 200 để chống dò tài
       khoản — nên email rỗng làm đường đó chết IM LẶNG. Máy chủ chặn 400; `required` ở đây để
       người dùng biết TRƯỚC khi bấm Lưu, thay vì nhận lỗi sau. */
    await dung();
    await bam("Sửa");
    const o = oTheoTienTo("Email");
    expect(o.required, "ô Email không đánh dấu bắt buộc — người dùng chỉ biết sau khi bấm Lưu").toBe(true);
  });

  it("SỬA: giá trị dán kèm khoảng trắng được trim TRƯỚC khi gửi", async () => {
    await dung();
    await bam("Sửa");
    go(oTheoTienTo("Email"), "  moi@vd.test  ");
    await bam("Lưu");
    const gui = updateUser.mock.calls.at(-1)![1];
    expect(gui.email, "khoảng trắng đi kèm sẽ thành một địa chỉ khác trong CSDL").toBe("moi@vd.test");
  });

  it("nhãn ô PHẢI nói rõ đây là địa chỉ nhận thư mời / đặt lại mật khẩu", async () => {
    // Không phải trang trí: admin cần biết ô này là đường phục hồi, không phải một ô thông tin.
    await dung();
    await bam("Sửa");
    const l = [...document.querySelectorAll(".modal label")].find((x) => x.querySelector("span")?.textContent?.startsWith("Email"));
    expect(l?.textContent, "nhãn ô Email không nói ra đây là đường nhận thư mời / đặt lại mật khẩu").toMatch(/đặt lại mật khẩu/iu);
  });

  it("vế đối trọng: các ô khác vẫn gửi như trước — bản vá không làm rơi trường nào", async () => {
    // Thêm một khoá vào payload dễ vô tình đẩy một khoá khác ra (nhất là khi chèn vào giữa khối
    // object). Ca này đo lại cả cụm trong một lượt Lưu.
    await dung();
    await bam("Sửa");
    go(oTheoTienTo("SĐT"), "0911222333");
    await bam("Lưu");

    const gui = updateUser.mock.calls.at(-1)![1];
    expect(gui.phone).toBe("0911222333");
    expect(gui.title, "ô Chức danh không còn được gửi").toBe("Account");
    expect(gui.senderName).toBe("Chị Lan");
    expect(gui.email, "ô Email nạp sẵn phải được gửi lại y nguyên khi admin chỉ đổi SĐT").toBe("lan@gianguyen.vn");
    expect("username" in gui, "payload kèm username dù ô đó bị disabled").toBe(false);
  });

  it("vế đối trọng: modal MỜI vẫn dùng nhãn RIÊNG của nó (\"Email cá nhân\", có dấu bắt buộc)", async () => {
    // Hai ô cùng trường nhưng hai ngữ cảnh khác nhau: ở lời mời email là BẮT BUỘC và là nơi nhận thư
    // kích hoạt; ở modal Sửa nó là định danh đang có và ĐƯỢC PHÉP xoá. Gộp chữ làm một sẽ nói sai một
    // trong hai chỗ. Ca này chỉ khoá việc đừng lẫn hai ô khi ai đó dọn dẹp nhãn.
    await dung();
    await bam("+ Thêm nhân viên");
    expect(nhan().some((t) => t.startsWith("Email cá nhân")), "modal Mời mất ô Email cá nhân").toBe(true);
  });
});
