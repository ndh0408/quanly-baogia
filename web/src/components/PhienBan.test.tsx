/** @vitest-environment jsdom */
// Dải "Hệ thống vừa được cập nhật — [Tải bản mới]" và dòng phiên bản ở chân menu.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";

const h = vi.hoisted(() => ({ taiBanMoi: null as unknown as ReturnType<typeof vi.fn>, luuRoiBao: null as unknown as ReturnType<typeof vi.fn> }));
vi.mock("../lib/phienBan", async (goc) => {
  const that = await goc<typeof import("../lib/phienBan")>();
  h.taiBanMoi = vi.fn(async () => true);
  h.luuRoiBao = vi.fn(async () => true);
  return { ...that, batDauTheoDoi: () => () => {}, taiBanMoi: h.taiBanMoi, luuRoiBao: h.luuRoiBao };
});
vi.mock("../lib/ui", async (goc) => ({ ...(await goc<typeof import("../lib/ui")>()), toast: vi.fn() }));
import * as ui from "../lib/ui";

import { ThongBaoBanMoi, PhienBanChanMenu } from "./PhienBan";
import { _datLai, dangKyTrangAnToan, batDauViecNen } from "../lib/phienBan";
import { setPreviewMode } from "../lib/api";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let hop: HTMLDivElement | null = null;
const ve = (el: ReactElement) => { hop = document.createElement("div"); document.body.appendChild(hop); root = createRoot(hop); act(() => root!.render(el)); };
const nut = (chu: string) => [...hop!.querySelectorAll("button")].find((b) => b.textContent?.includes(chu)) as HTMLButtonElement | undefined;
const dai = () => hop!.querySelector('[data-testid="thong-bao-ban-moi"]');
const BAN_MOI = { coBanMoi: true, cuaToi: "index-Cu", mayChu: { banGiaoDien: "index-Moi", sha: "9dd30dc", capNhatLuc: null } };
/** Có bản mới + trang đang mở tự khai "tải lại an toàn" (như Danh sách báo giá). */
const banMoiTrangAnToan = () => { _datLai(BAN_MOI); dangKyTrangAnToan(); };

beforeEach(() => { _datLai(); h.taiBanMoi.mockClear(); h.luuRoiBao.mockClear(); vi.mocked(ui.toast).mockClear(); (window as Window & { __editorDirty?: boolean }).__editorDirty = false; });
afterEach(() => { if (root) act(() => root!.unmount()); root = null; hop?.remove(); hop = null; document.body.innerHTML = ""; });

describe("dải thông báo bản mới", () => {
  it("không có bản mới → không hiện gì", () => {
    ve(<ThongBaoBanMoi />);
    expect(dai()).toBeNull();
  });

  it("có bản mới, trang an toàn, không dở gì → 'Tải bản mới' tải ngay", async () => {
    act(() => banMoiTrangAnToan());
    ve(<ThongBaoBanMoi />);
    expect(dai()?.textContent).toContain("Hệ thống vừa được cập nhật.");
    await act(async () => { nut("Tải bản mới")!.click(); });
    expect(h.taiBanMoi).toHaveBeenCalledTimes(1);
  });

  it("trang KHÔNG tự khai an toàn (wizard, Phân quyền, Hồ sơ…) → không nhắc gì thêm, nhưng bấm thì HỎI (Tải luôn / Hủy)", async () => {
    act(() => _datLai(BAN_MOI));
    ve(<ThongBaoBanMoi />);
    expect(dai()?.textContent?.trim()).toMatch(/Hệ thống vừa được cập nhật\.\s*Tải bản mới/);
    act(() => nut("Tải bản mới")!.click());
    expect(h.taiBanMoi).not.toHaveBeenCalled();
    expect(dai()?.textContent).toContain("có thể còn phần đang nhập chưa lưu");
    expect(nut("Lưu rồi tải bản mới")).toBeUndefined();
    await act(async () => { nut("Tải luôn")!.click(); });
    expect(h.taiBanMoi).toHaveBeenCalledTimes(1);
  });

  it("ĐANG GÕ (ô có chữ, có con trỏ): bấm chuột vào nút KHÔNG làm ô mất con trỏ → vẫn hỏi, không tải ngay", () => {
    act(() => banMoiTrangAnToan());
    document.body.insertAdjacentHTML("beforeend", '<input id="o" value="HĐ 0012">');
    (document.getElementById("o") as HTMLInputElement).focus();
    ve(<ThongBaoBanMoi />);
    const b = nut("Tải bản mới")!;
    const md = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    b.dispatchEvent(md);
    expect(md.defaultPrevented, "mousedown không bị chặn → trình duyệt chuyển con trỏ sang nút trước khi click chạy").toBe(true);
    act(() => b.click());
    expect(h.taiBanMoi).not.toHaveBeenCalled();
    expect(dai()?.textContent).toContain("Đang gõ dở.");
  });

  it("con trỏ đã rời ô ngay trước khi bấm (bàn phím) → vẫn hỏi theo trạng thái của lượt vẽ gần nhất", () => {
    act(() => banMoiTrangAnToan());
    document.body.insertAdjacentHTML("beforeend", '<input id="o" value="HĐ 0012">');
    (document.getElementById("o") as HTMLInputElement).focus();
    ve(<ThongBaoBanMoi />);
    (document.getElementById("o") as HTMLInputElement).blur();
    act(() => nut("Tải bản mới")!.click());
    expect(h.taiBanMoi).not.toHaveBeenCalled();
    expect(dai()?.textContent).toContain("Đang gõ dở.");
  });

  it("không tải được (mạng / máy chủ đang cập nhật) → báo lỗi, dải vẫn còn", async () => {
    act(() => banMoiTrangAnToan());
    h.taiBanMoi.mockResolvedValueOnce(false);
    ve(<ThongBaoBanMoi />);
    await act(async () => { nut("Tải bản mới")!.click(); });
    expect(ui.toast).toHaveBeenCalledWith(expect.stringContaining("Chưa tải được bản mới"), "error");
    expect(dai()).not.toBeNull();
  });

  it("còn thay đổi CHƯA LƯU → câu nhắc lưu trước; bấm Tải bản mới thì HỎI (Lưu rồi tải / Hủy) — KHÔNG có 'Tải luôn'", () => {
    (window as Window & { __editorDirty?: boolean }).__editorDirty = true;
    act(() => _datLai(BAN_MOI));
    ve(<ThongBaoBanMoi />);
    expect(dai()?.textContent).toContain("CHƯA LƯU");
    act(() => nut("Tải bản mới")!.click());
    expect(h.taiBanMoi).not.toHaveBeenCalled();
    expect(nut("Lưu rồi tải bản mới")).toBeDefined();
    expect(nut("Tải luôn"), "iPhone/iPad không có hộp 'Tải lại trang?' — tải luôn ở đó là mất ngay (soát vòng 3)").toBeUndefined();
    expect(dai()?.textContent).not.toContain("giữ tạm");
    expect(dai()?.textContent, "không hứa trình duyệt sẽ hỏi lại").not.toContain("trình duyệt sẽ hỏi");
    act(() => nut("Hủy")!.click());
    expect(nut("Lưu rồi tải bản mới")).toBeUndefined();
    expect(h.taiBanMoi).not.toHaveBeenCalled();
  });

  it("'Lưu rồi tải bản mới': lưu được → mới tải; lưu hỏng → KHÔNG tải", async () => {
    (window as Window & { __editorDirty?: boolean }).__editorDirty = true;
    act(() => _datLai(BAN_MOI));
    ve(<ThongBaoBanMoi />);
    act(() => nut("Tải bản mới")!.click());
    h.luuRoiBao.mockResolvedValueOnce(false);
    await act(async () => { nut("Lưu rồi tải bản mới")!.click(); });
    expect(h.taiBanMoi, "lưu hỏng mà vẫn tải lại → mất dữ liệu").not.toHaveBeenCalled();
    act(() => nut("Tải bản mới")!.click());
    h.luuRoiBao.mockResolvedValueOnce(true);
    await act(async () => { nut("Lưu rồi tải bản mới")!.click(); });
    expect(h.taiBanMoi).toHaveBeenCalledTimes(1);
  });

  it("đang mở form → câu nhắc đóng form; bấm thì hỏi (Tải luôn / Hủy), không có 'Lưu rồi tải'", () => {
    document.body.insertAdjacentHTML("beforeend", '<div class="modal-backdrop"></div>');
    act(() => _datLai(BAN_MOI));
    ve(<ThongBaoBanMoi />);
    expect(dai()?.textContent).toContain("form đang mở");
    act(() => nut("Tải bản mới")!.click());
    expect(nut("Lưu rồi tải bản mới")).toBeUndefined();
    expect(nut("Tải luôn")).toBeDefined();
  });

  it("admin đang XEM THỬ quyền → bấm thì HỎI (tải lại là thoát xem thử, sau đó mọi thao tác là thật)", () => {
    act(() => banMoiTrangAnToan());
    setPreviewMode(true);
    try {
      ve(<ThongBaoBanMoi />);
      act(() => nut("Tải bản mới")!.click());
      expect(h.taiBanMoi).not.toHaveBeenCalled();
      expect(dai()?.textContent).toContain("THOÁT chế độ xem thử");
    } finally { setPreviewMode(false); }
  });

  it("đang tạo file Excel/PDF → câu nhắc đợi tải xong; bấm thì HỎI", () => {
    act(() => banMoiTrangAnToan());
    const xong = batDauViecNen();
    try {
      ve(<ThongBaoBanMoi />);
      expect(dai()?.textContent).toContain("Đang tạo file — đợi tải xong");
      act(() => nut("Tải bản mới")!.click());
      expect(h.taiBanMoi).not.toHaveBeenCalled();
      expect(dai()?.textContent).toContain("lượt tạo file đang chạy bị huỷ");
    } finally { xong(); }
  });

  it("✕ ẩn dải (nhắc lại sau 30 phút)", () => {
    act(() => banMoiTrangAnToan());
    ve(<ThongBaoBanMoi />);
    act(() => (hop!.querySelector(".tbbm-dong") as HTMLButtonElement).click());
    expect(dai()).toBeNull();
  });
});

describe("chân menu", () => {
  it("cùng bản → 'Phiên bản <mã commit>'; có bản mới → 'Bạn đang dùng bản CŨ'", () => {
    act(() => _datLai({ cuaToi: "index-Moi", mayChu: { banGiaoDien: "index-Moi", sha: "9dd30dc", capNhatLuc: null } }));
    ve(<PhienBanChanMenu />);
    expect(hop!.textContent).toContain("Phiên bản 9dd30dc");
    expect(nut("Kiểm tra bản mới")).toBeDefined();
    act(() => _datLai(BAN_MOI));
    expect(hop!.textContent).toContain("Bạn đang dùng bản CŨ");
  });
});
