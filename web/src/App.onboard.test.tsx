/** @vitest-environment jsdom */
/**
 * ============================================================================
 * "QUÊN MẬT KHẨU" CHỈ ĐƯỢC HỎI MẬT KHẨU.
 *
 * ── NGƯỜI DÙNG BÁO ─────────────────────────────────────────────────────────
 * "quên mật khẩu thì cần gì điền mấy cái đó, form kỳ chả chuẩn gì cả".
 *
 * Đúng: `POST /api/auth/accept-invite` phục vụ HAI việc khác hẳn nhau trên cùng một token —
 * nhận lời mời LẦN ĐẦU (tài khoản chưa kích hoạt, phải khai hồ sơ) và ĐẶT LẠI MẬT KHẨU (tài khoản
 * đang chạy, hồ sơ đã có từ lâu). Màn này trước đây chỉ có một dạng: luôn hỏi đủ Họ tên / Tên người
 * gửi / SĐT / Chức danh, tiêu đề luôn là "Hoàn tất tài khoản".
 *
 * ── KHÔNG CHỈ LÀ CHUYỆN THỪA Ô ─────────────────────────────────────────────
 * Form nạp sẵn mỗi `displayName`; ba ô còn lại luôn RỖNG. Người quên mật khẩu gõ mật khẩu rồi bấm
 * gửi là gửi kèm ba chuỗi rỗng. Ghép với lỗi `|| null` ở `authService.acceptInvite` (đã vá — xem
 * tests/dm-dat-lai-mat-khau-khong-xoa-ho-so.test.js) thì mỗi lần đặt lại mật khẩu XOÁ TRẮNG hồ sơ,
 * im lặng. Đó là vì sao 5/10 tài khoản trên production trống cả ba trường.
 *
 * Nên bài này khoá HAI vế, và vế thứ hai mới là vế chặn mất dữ liệu:
 *   1. đặt lại mật khẩu → KHÔNG hiện bốn ô hồ sơ;
 *   2. đặt lại mật khẩu → KHÔNG GỬI bốn khoá đó lên máy chủ (dù rỗng).
 * Cùng vế đối trọng: người nhận lời mời lần đầu vẫn phải khai và gửi được đủ.
 * ============================================================================
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

type GoiNhan = Record<string, unknown>;
const acceptInvite = vi.fn(async (_d: GoiNhan) => ({ id: 1, username: "u@x.vn", displayName: "U", role: "manager", permissions: [] }));
const getInvite = vi.fn(async (_t: string) => ({ email: "" }) as { email: string; displayName?: string; datLaiMatKhau?: boolean });

vi.mock("./lib/api", async () => {
  class ApiError extends Error {
    body: unknown;
    constructor(m: string, body?: unknown) { super(m); this.body = body; }
  }
  return { api: { getInvite: (t: string) => getInvite(t), acceptInvite: (d: GoiNhan) => acceptInvite(d) }, ApiError, setPreviewMode: () => {} };
});
vi.mock("./lib/ui", () => ({ toast: () => {}, promptModal: async () => null }));
vi.mock("./lib/localDraft", () => ({ xoaMoiBanNhap: () => {}, ghiNhanNguoiDung: () => false }));
vi.mock("./components/Shell", () => ({ Shell: () => null }));

import { OnboardPage } from "./App";

let thung: HTMLDivElement;
let goc: Root;

beforeEach(() => {
  acceptInvite.mockClear();
  getInvite.mockReset();
  location.hash = "#/onboard?token=abcdefghijklmnop";
  thung = document.createElement("div");
  document.body.appendChild(thung);
  goc = createRoot(thung);
});
afterEach(() => {
  act(() => goc.unmount());
  thung.remove();
  document.body.innerHTML = "";
});

/** Dựng màn với câu trả lời `GET /auth/invite/:token` cho trước, rồi chờ nó nạp xong. */
async function dung(info: { email: string; displayName?: string; datLaiMatKhau?: boolean }) {
  getInvite.mockResolvedValue(info);
  await act(async () => { goc.render(<OnboardPage onLogin={() => {}} />); });
  await act(async () => {});
}

const nhan = () => [...document.querySelectorAll("label span")].map((s) => s.textContent ?? "");
const tieuDe = () => document.querySelector("h1")?.textContent ?? "";
const oTheoNhan = (ten: string): HTMLInputElement => {
  const l = [...document.querySelectorAll("label")].find((x) => x.querySelector("span")?.textContent === ten);
  const i = l?.querySelector("input");
  if (!i) throw new Error(`không có ô "${ten}" — đang có: ${nhan().join(", ")}`);
  return i;
};

/** Gõ vào ô theo đúng đường React nghe (setter gốc + sự kiện `input`). */
function go(o: HTMLInputElement, v: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(o, v);
    o.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function guiForm(mk = "MatKhau123") {
  go(oTheoNhan("Mật khẩu mới"), mk);
  go(oTheoNhan("Nhập lại mật khẩu"), mk);
  const f = document.querySelector<HTMLFormElement>("#ob-form");
  if (!f) throw new Error("không thấy form");
  await act(async () => { f.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  await act(async () => {});
}

describe("Màn #/onboard — đặt lại mật khẩu vs nhận lời mời", () => {
  it("ĐẶT LẠI MẬT KHẨU: chỉ còn hai ô mật khẩu, tiêu đề đúng việc", async () => {
    await dung({ email: "huy@gianguyen.vn", displayName: "Huy", datLaiMatKhau: true });
    expect(tieuDe()).toBe("Đặt lại mật khẩu");
    const ns = nhan();
    for (const thua of ["Họ tên", "Tên người gửi trên báo giá", "Số điện thoại", "Chức danh"]) {
      expect(ns, `còn hỏi "${thua}" khi người dùng chỉ quên mật khẩu`).not.toContain(thua);
    }
    expect(ns).toContain("Mật khẩu mới");
    expect(ns).toContain("Nhập lại mật khẩu");
  });

  it("ĐẶT LẠI MẬT KHẨU: KHÔNG gửi kèm hồ sơ — đây là vế chặn mất dữ liệu", async () => {
    // Vế quan trọng nhất tệp này. Ẩn ô mà vẫn gửi `phone: ""` thì máy chủ vẫn nhận chuỗi rỗng, và
    // mọi lớp phòng thủ chỉ còn trông vào một chỗ duy nhất bên backend.
    await dung({ email: "huy@gianguyen.vn", displayName: "Huy", datLaiMatKhau: true });
    await guiForm();
    expect(acceptInvite).toHaveBeenCalledTimes(1);
    const gui = acceptInvite.mock.calls[0][0];
    for (const k of ["displayName", "senderName", "phone", "title"]) {
      expect(Object.hasOwn(gui, k), `vẫn gửi khoá "${k}" (=${JSON.stringify(gui[k])}) khi đặt lại mật khẩu`).toBe(false);
    }
    expect(gui.password).toBe("MatKhau123");
    expect(gui.token).toBe("abcdefghijklmnop");
  });

  it("NHẬN LỜI MỜI lần đầu: vẫn hỏi và vẫn GỬI đủ hồ sơ", async () => {
    // Vế đối trọng: ẩn nhầm cho cả hai đường thì người mới không khai được gì, và wizard tạo báo giá
    // sau đó không có người gửi để tự điền.
    await dung({ email: "moi@gianguyen.vn", displayName: "Người Mới" });
    expect(tieuDe()).toBe("Hoàn tất tài khoản");
    expect(nhan()).toEqual(expect.arrayContaining(["Họ tên", "Tên người gửi trên báo giá", "Số điện thoại", "Chức danh"]));

    go(oTheoNhan("Số điện thoại"), "0909123456");
    go(oTheoNhan("Chức danh"), "Account");
    await guiForm();

    const gui = acceptInvite.mock.calls[0][0];
    expect(gui.displayName).toBe("Người Mới");
    expect(gui.phone).toBe("0909123456");
    expect(gui.title).toBe("Account");
  });

  it("NHẬN LỜI MỜI: ô để trống thì BỎ HẲN khoá — admin có thể đã điền hộ", async () => {
    // Ba ô này KHÔNG nạp sẵn: `getInvite` chỉ trả email/displayName/role/datLaiMatKhau, nên chúng
    // rỗng bất kể CSDL đang có gì — mà admin hoàn toàn có thể đã đặt hộ "Tên người gửi" ngay từ lời
    // mời. Gửi "" từ một ô luôn rỗng là xoá thứ người khác vừa điền hộ. `displayName` thì ngược lại:
    // CÓ nạp sẵn (và đang `required`) nên vẫn gửi.
    await dung({ email: "moi@gianguyen.vn", displayName: "Người Mới" });
    await guiForm();

    const gui = acceptInvite.mock.calls[0][0];
    expect(gui.displayName).toBe("Người Mới");
    for (const k of ["senderName", "phone", "title"]) {
      expect(Object.hasOwn(gui, k), `ô "${k}" để trống mà vẫn gửi khoá lên`).toBe(false);
    }
  });

  it("thiếu cờ trong câu trả lời cũ → coi như NHẬN LỜI MỜI, không ẩn nhầm", async () => {
    // Máy chủ cũ (chưa có `datLaiMatKhau`) trả về thiếu khoá. Mặc định phải là đường an toàn: hỏi
    // đủ còn hơn ẩn mất ô của người đang cần khai.
    await dung({ email: "cu@gianguyen.vn" });
    expect(tieuDe()).toBe("Hoàn tất tài khoản");
    expect(nhan()).toContain("Họ tên");
  });
});
