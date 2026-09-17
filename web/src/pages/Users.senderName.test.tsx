/** @vitest-environment jsdom */
/**
 * ============================================================================
 * TRANG "QUẢN LÝ NHÂN VIÊN" PHẢI GỬI ĐƯỢC TÊN NGƯỜI GỬI — VÀ PRE-FILL LẠI ĐÚNG.
 *
 * ── THIẾU SÓT ──────────────────────────────────────────────────────────────
 * Hai modal của trang này trước đây KHÔNG hề nhắc tới `senderName`:
 *
 *     InviteModal  → api.inviteUser({ email, displayName, projectCode, role, permissions })
 *     EditUserModal→ api.updateUser(id, { username, displayName, phone, projectCode, role, permissions })
 *
 * Trường này lại là thứ wizard tạo báo giá in vào ô "Người gửi". Admin lập tài khoản hộ nhân viên
 * mới không đặt được, nên đến lượt mình mỗi người phải tự vào Hồ sơ cá nhân gõ lại.
 *
 * ── VÌ SAO PHẢI KIỂM Ở TẦNG GIAO DIỆN ──────────────────────────────────────
 * Backend nhận được trường này rồi (tests/sn-quan-tri-dat-ten-nguoi-gui.test.js), nhưng đường ghi
 * chỉ thông khi form THẬT SỰ gửi khoá đó lên. Và chiều ngược lại cũng phải thông: modal "Sửa" dựng
 * ô từ `user.senderName` trong danh sách — API không trả về thì ô luôn rỗng, admin tưởng chưa ai
 * đặt rồi gõ đè lên tên đang có.
 *
 * ── BÀI NÀY KHOÁ ───────────────────────────────────────────────────────────
 * Cả hai modal có ô "Tên người gửi trên báo giá" (đúng câu chữ của trang Hồ sơ cá nhân và màn
 * #/onboard — một trường thì phải một cách gọi tên), gửi đúng khoá `senderName`, và ô ở modal Sửa
 * pre-fill từ giá trị đang có.
 *
 * ── VẾ ĐỐI TRỌNG: HAI MODAL, HAI LUẬT NGƯỢC NHAU CHO Ô RỖNG ────────────────
 * Ranh giới là "form có nhìn thấy giá trị cũ không", chứ không phải "modal nào":
 *
 *   Sửa  — ô NẠP SẴN từ danh sách ⇒ xoá trắng là ý định XOÁ ⇒ gửi khoá với giá trị `null`.
 *          Gửi "" (như bản trước) thì máy chủ quy về "không đổi": admin xoá ô, bấm Lưu, thấy toast
 *          "Đã lưu" mà cột vẫn nguyên — lưu mà không ăn.
 *   Mời  — tài khoản chưa tồn tại, không có gì để nạp sẵn ⇒ ô rỗng KHÔNG mang ý định nào ⇒ BỎ HẲN
 *          khoá khỏi payload. Đây là hình mẫu của màn #/onboard dạng Quên mật khẩu, nơi gửi "" từ
 *          một ô luôn rỗng đã xoá trắng hồ sơ 5/10 tài khoản trên production.
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
  senderName: "Chị Lan", active: true, pending: false, permissions: [], effectivePermissions: [],
};

const listUsers = vi.fn(async () => [NHAN_VIEN]);
const updateUser = vi.fn(async (_id: number, _d: GoiGui) => NHAN_VIEN);
const inviteUser = vi.fn(async (_d: GoiGui) => ({ user: { email: "moi@gianguyen.vn" }, inviteUrl: "http://x/#/onboard?token=abc", emailSent: true }));
// Trả danh mục quyền RỖNG: ma trận quyền không phải việc của bài này, và để nó rỗng thì
// PermSection chỉ in "Đang tải danh mục quyền…" — không kéo theo nội thất của PermMatrix.
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

/** Dựng trang rồi chờ react-query nạp xong danh sách. */
async function dung() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await act(async () => {
    goc.render(
      <QueryClientProvider client={qc}>
        <UsersPage me={{ id: 1 } as never} />
      </QueryClientProvider>
    );
  });
  // Chờ theo ĐIỀU KIỆN, không đếm nhịp: react-query cần bao nhiêu vòng micro-task mới đổi từ "đang
  // tải" sang "có dữ liệu" là chuyện của nó, đếm cứng thì bài lúc xanh lúc đỏ (đã dính đúng vậy).
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

/** Gõ vào ô theo đúng đường React nghe (setter gốc + sự kiện `input`). */
function go(o: HTMLInputElement, v: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(o, v);
    o.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("Quản lý nhân viên — ô Tên người gửi trên báo giá", () => {
  it("SỬA: ô pre-fill từ giá trị đang có, gõ tên mới thì GỬI đúng khoá senderName", async () => {
    await dung();
    await bam("Sửa");
    expect(oTheoNhan("Tên người gửi trên báo giá").value, "modal Sửa không pre-fill tên người gửi đang có").toBe("Chị Lan");

    go(oTheoNhan("Tên người gửi trên báo giá"), "Nguyễn Thị Lan Anh");
    await bam("Lưu");

    expect(updateUser).toHaveBeenCalledTimes(1);
    const [id, gui] = updateUser.mock.calls[0];
    expect(id).toBe(NHAN_VIEN.id);
    expect(gui.senderName, "modal Sửa không gửi senderName lên máy chủ").toBe("Nguyễn Thị Lan Anh");
  });

  it("SỬA: xoá trắng ô NẠP SẴN thì gửi `null` — xoá là xoá, không phải 'không đổi'", async () => {
    // Ô này pre-fill giá trị đang có, nên admin xoá trắng là một ý định rõ ràng: phải gửi khoá lên
    // (bỏ hẳn khoá là giấu mất ý định đó), và gửi `null` để nói thẳng "xoá" ngay ở tầng payload.
    // Bản trước gửi "" và máy chủ quy "" về "không đổi" — admin bấm Lưu, thấy toast "Đã lưu", mà
    // cột vẫn nguyên. Luật "rỗng = không đổi" chỉ dành cho ô KHÔNG nạp sẵn (màn Quên mật khẩu).
    await dung();
    await bam("Sửa");
    go(oTheoNhan("Tên người gửi trên báo giá"), "");
    await bam("Lưu");

    const gui = updateUser.mock.calls[0][1];
    expect(Object.hasOwn(gui, "senderName"), "xoá trắng ô thì modal bỏ luôn khoá senderName").toBe(true);
    expect(gui.senderName, "gửi chuỗi rỗng thay vì null → ý định xoá bị nuốt").toBe(null);
  });

  it("SỬA: xoá trắng ô SĐT cũng gửi `null` — cùng luật với ô Tên người gửi", async () => {
    // SĐT cũng pre-fill từ danh sách (USER_SELECT có `phone`). Hai ô cùng điều kiện thì phải cùng
    // luật; để lệch nhau là đúng cái bất đối xứng đã có ở POST /api/auth/profile.
    await dung();
    await bam("Sửa");
    expect(oTheoNhan("SĐT").value, "modal Sửa không pre-fill SĐT đang có").toBe("0909123456");
    go(oTheoNhan("SĐT"), "");
    await bam("Lưu");

    const gui = updateUser.mock.calls[0][1];
    expect(gui.phone, "xoá trắng ô SĐT mà payload không nói xoá").toBe(null);
  });

  it("MỜI: ô có mặt và gửi kèm senderName khi lập tài khoản mới", async () => {
    await dung();
    await bam("+ Thêm nhân viên");
    go(oTheoNhan("Họ tên *"), "Trần Văn Mới");
    go(oTheoNhan("Email cá nhân *"), "moi@gianguyen.vn");
    go(oTheoNhan("Tên người gửi trên báo giá"), "Trần Văn Mời");
    await bam("Gửi lời mời");

    expect(inviteUser).toHaveBeenCalledTimes(1);
    expect(inviteUser.mock.calls[0][0].senderName, "form Mời không gửi senderName").toBe("Trần Văn Mời");
  });

  it("MỜI: để trống ô thì BỎ HẲN khoá — ô không nạp sẵn thì rỗng không mang ý định gì", async () => {
    // Hôm nay vô hại vì `inviteUser` là `prisma.user.create` và ném 409 nếu email đã có — không có
    // giá trị cũ nào để xoá. Ca này khoá để luật là MỘT luật chứ không phải một danh sách ngoại lệ:
    // ngày nào ai đó đổi create thành upsert, một cái "" gửi từ ô luôn rỗng là đường xoá dữ liệu.
    await dung();
    await bam("+ Thêm nhân viên");
    go(oTheoNhan("Họ tên *"), "Trần Văn Mới");
    go(oTheoNhan("Email cá nhân *"), "moi@gianguyen.vn");
    await bam("Gửi lời mời");

    const gui = inviteUser.mock.calls[0][0];
    expect(Object.hasOwn(gui, "senderName"), "ô rỗng mà vẫn gửi khoá senderName lên").toBe(false);
  });

  it("câu chữ TRÙNG trang Hồ sơ cá nhân: nhãn và gợi ý để trống", async () => {
    // Ba nơi cùng một trường (Hồ sơ, #/onboard, Quản lý nhân viên) phải cùng một cách gọi tên —
    // lệch chữ là người dùng tưởng ba trường khác nhau.
    await dung();
    await bam("Sửa");
    const o = oTheoNhan("Tên người gửi trên báo giá");
    expect(o.placeholder).toBe("Để trống = dùng Họ tên");
  });
});

describe("Quản lý nhân viên — trường form KHÔNG hiện thì KHÔNG được gửi", () => {
  /* ── VÌ SAO ───────────────────────────────────────────────────────────────────────────────
     Cùng một luật đã áp cho SĐT / chức danh / tên người gửi, nay áp cho VAI TRÒ. Modal "Sửa"
     không có ô chọn vai trò — chỉ có một ô tích "Quản trị" — nhưng bản cũ lần nào Lưu cũng gửi
     `role: isAdmin ? "admin" : "manager"`. Nghĩa là admin vào sửa mỗi số điện thoại của một tài
     khoản `hr` / `accountant` / `account_hn` là ÂM THẦM hạ họ xuống `manager`. Không có 400 nào
     chặn: "manager" là giá trị hợp lệ của enum.

     Hậu quả thật: `hnWorkflow.ts` và `quoteService.ts` lọc người theo `role: "account_hn"`, nên
     người bị hạ vai trò rơi khỏi danh sách "người điền Hà Nội" mà không ai hiểu vì sao. */

  it("sửa SĐT của tài khoản KẾ TOÁN → KHÔNG gửi `role` (không âm thầm hạ vai trò)", async () => {
    NHAN_VIEN.role = "accountant";
    try {
      await dung();
      await bam("Sửa");
      go(oTheoNhan("SĐT"), "0911222333");
      await bam("Lưu");
      const gui = updateUser.mock.calls.at(-1)![1];
      expect("role" in gui, `payload có kèm role=${JSON.stringify(gui.role)} — tài khoản accountant vừa bị hạ xuống manager`).toBe(false);
      expect(gui.phone).toBe("0911222333");
    } finally {
      NHAN_VIEN.role = "manager";
    }
  });

  it("tích/bỏ tích ô Quản trị thì VẪN gửi `role` — đó mới là ý định rõ ràng", async () => {
    // Vế đối trọng: bỏ hẳn `role` khỏi payload thì không ai phong/gỡ quyền quản trị được nữa.
    await dung();
    await bam("Sửa");
    // Bám theo CLASS của ô tích, không theo câu chữ: nhãn là "Toàn quyền quản trị" và đó là loại
    // chữ hay được viết lại, còn `.perm-admin-toggle` thì CSS đang dùng nên không tự dưng biến mất.
    const tick = document.querySelector<HTMLInputElement>('.perm-admin-toggle input[type="checkbox"]');
    expect(tick, "không tìm thấy ô tích Toàn quyền quản trị").toBeTruthy();
    act(() => { tick!.click(); });
    await bam("Lưu");
    const gui = updateUser.mock.calls.at(-1)![1];
    expect(gui.role, "tích ô Quản trị mà payload không mang role").toBe("admin");
  });
});
