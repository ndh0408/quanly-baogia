/** @vitest-environment jsdom */
//
// FE-02: confirmModal và bàn phím.
//   (a) Tab sang "Hủy" rồi Enter trước đây vẫn resolve TRUE — tức Xoá/Khoá/Đặt lại MFA/"Rời, bỏ thay
//       đổi" chạy dù người dùng đã chọn Hủy.
//   (b) Hộp nguy hiểm (danger) phải để tiêu điểm mặc định ở "Hủy".
//   (c) Form bẩn nghe Esc ở document → Esc lần 1 mở "Bỏ thay đổi?", Esc lần 2 đóng hộp NHƯNG listener
//       của form cũng chạy và mở hộp MỚI → kẹt vô hạn. Esc phải đóng hộp và dừng ở đó.
import { describe, it, expect, afterEach } from "vitest";
import { confirmModal, promptModal } from "./ui";

const phim = (key: string, el: Element | Document = document.activeElement || document.body) =>
  el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
const soHop = () => document.querySelectorAll('[data-focus-trap="own"]').length;

afterEach(() => { document.body.innerHTML = ""; });

describe("FE-02 — confirmModal", () => {
  it("(a) tiêu điểm ở Hủy + Enter → false", async () => {
    const p = confirmModal("Xóa", "Xóa báo giá?", { danger: false });
    (document.querySelector("[data-no]") as HTMLElement).focus();
    phim("Enter");
    expect(await p).toBe(false);
  });

  it("tiêu điểm ở nút xác nhận + Enter → true (không phá luồng bình thường)", async () => {
    const p = confirmModal("Lưu", "Lưu rồi tiếp tục?");
    expect(document.activeElement?.hasAttribute("data-yes")).toBe(true);
    phim("Enter");
    expect(await p).toBe(true);
  });

  it("(b) danger → tiêu điểm mặc định ở Hủy; Enter ngay lập tức KHÔNG xoá", async () => {
    const p = confirmModal("Xóa", "Xóa báo giá?", { danger: true, confirmText: "Xóa" });
    expect(document.activeElement?.hasAttribute("data-no")).toBe(true);
    phim("Enter");
    expect(await p).toBe(false);
  });

  it("(c) form bẩn nghe Esc ở document: Esc ở hộp 'Bỏ thay đổi?' → 0 hộp mở, không mở lại", async () => {
    let soLanMo = 0;
    let dangCho: Promise<boolean> | null = null;
    const formEsc = (e: KeyboardEvent) => { if (e.key === "Escape") { soLanMo++; dangCho = confirmModal("Bỏ thay đổi?", "…", { danger: true }); } };
    document.addEventListener("keydown", formEsc);
    try {
      phim("Escape", document.body);          // Esc lần 1 trong form → mở hộp
      expect(soHop()).toBe(1);
      phim("Escape");                         // Esc lần 2 → đóng hộp, form KHÔNG được mở lại hộp
      expect(await dangCho).toBe(false);
      expect(soHop()).toBe(0);
      expect(soLanMo).toBe(1);
    } finally { document.removeEventListener("keydown", formEsc); }
  });

  it("promptModal: Esc cũng không lọt xuống listener bên dưới", async () => {
    let lot = 0;
    const duoi = (e: KeyboardEvent) => { if (e.key === "Escape") lot++; };
    document.addEventListener("keydown", duoi);
    try {
      const p = promptModal("Lý do", "…");
      phim("Escape");
      expect(await p).toBe(null);
      expect(lot).toBe(0);
    } finally { document.removeEventListener("keydown", duoi); }
  });
});
