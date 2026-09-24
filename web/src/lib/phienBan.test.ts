/** @vitest-environment jsdom */
// Báo có bản mới sau deploy — phần LOGIC (../lib/phienBan.ts). Giao diện: ../components/PhienBan.test.tsx.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  banCuaToi, khacBan, dangDo, kiemTraBanMoi, nenTuTai, luuRoiBao, nhanPhienBan, layTrangThai, _datLai, anTam, hienLai, AN_TAM_MS,
} from "./phienBan";

const traVe = (body: unknown, ok = true) => vi.fn(async () => ({ ok, json: async () => body }) as unknown as Response);
const datVisibility = (v: "visible" | "hidden") => Object.defineProperty(document, "visibilityState", { configurable: true, get: () => v });

beforeEach(() => {
  _datLai();
  document.head.innerHTML = '<script type="module" crossorigin src="/app2/assets/index-CuAAA111.js"></script>';
  document.body.innerHTML = "";
  (window as Window & { __editorDirty?: boolean }).__editorDirty = false;
  sessionStorage.clear();
  datVisibility("visible");
});
afterEach(() => { vi.restoreAllMocks(); });

describe("nhận ra bản", () => {
  it("đọc tên tệp JS chính của trang từ thẻ <script type=module>", () => {
    expect(banCuaToi()).toBe("index-CuAAA111");
  });
  it("chỉ báo khác bản khi CẢ HAI phía đều biết mình là bản nào (dev chạy vite → null thì không báo)", () => {
    expect(khacBan("index-A", "index-B")).toBe(true);
    expect(khacBan("index-A", "index-A")).toBe(false);
    expect(khacBan(null, "index-B")).toBe(false);
    expect(khacBan("index-A", null)).toBe(false);
  });
});

describe("kiemTraBanMoi", () => {
  it("máy chủ phát bản khác → true, lưu vào kho", async () => {
    expect(await kiemTraBanMoi(traVe({ banGiaoDien: "index-MoiBBB22", sha: "9dd30dc", capNhatLuc: "2026-09-24T14:00:00+07:00" }))).toBe(true);
    expect(layTrangThai().coBanMoi).toBe(true);
    expect(layTrangThai().mayChu?.sha).toBe("9dd30dc");
  });
  it("cùng bản → false", async () => {
    expect(await kiemTraBanMoi(traVe({ banGiaoDien: "index-CuAAA111", sha: null, capNhatLuc: null }))).toBe(false);
  });
  it("mất mạng / máy chủ đang khởi động lại → null, KHÔNG xoá kết luận cũ", async () => {
    await kiemTraBanMoi(traVe({ banGiaoDien: "index-MoiBBB22", sha: null, capNhatLuc: null }));
    expect(await kiemTraBanMoi(vi.fn(async () => { throw new TypeError("Failed to fetch"); }) as unknown as typeof fetch)).toBeNull();
    expect(await kiemTraBanMoi(traVe({}, false))).toBeNull();
    expect(layTrangThai().coBanMoi, "một lần hỏi hỏng không được làm mất dải thông báo").toBe(true);
  });
});

describe("dangDo — tải lại lúc này có làm mất gì không", () => {
  it("không có gì dở → null", () => { expect(dangDo()).toBeNull(); });
  it("trình soạn / Account HN còn thay đổi chưa lưu → chua-luu", () => {
    (window as Window & { __editorDirty?: boolean }).__editorDirty = true;
    expect(dangDo()).toBe("chua-luu");
  });
  it("đang mở form / hộp thoại → form-mo", () => {
    document.body.innerHTML = '<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true"></div></div>';
    expect(dangDo()).toBe("form-mo");
  });
  it("tiêu điểm ở ô nhập sửa được → dang-go; ô chỉ-đọc / checkbox thì không", () => {
    document.body.innerHTML = '<input id="a"><input id="b" readonly><input id="c" type="checkbox">';
    (document.getElementById("a") as HTMLInputElement).focus();
    expect(dangDo()).toBe("dang-go");
    (document.getElementById("b") as HTMLInputElement).focus();
    expect(dangDo()).toBeNull();
    (document.getElementById("c") as HTMLInputElement).focus();
    expect(dangDo()).toBeNull();
  });
});

describe("nenTuTai — chỉ tự tải khi AN TOÀN", () => {
  const coBanMoi = () => _datLai({ coBanMoi: true, cuaToi: "index-CuAAA111", mayChu: { banGiaoDien: "index-MoiBBB22", sha: null, capNhatLuc: null } });
  it("có bản mới + tab nằm nền + không dở gì → tự tải", () => {
    coBanMoi(); datVisibility("hidden");
    expect(nenTuTai()).toBe(true);
  });
  it("người dùng ĐANG NHÌN màn hình → không bao giờ tự tải", () => {
    coBanMoi(); datVisibility("visible");
    expect(nenTuTai()).toBe(false);
  });
  it("tab nằm nền nhưng còn thay đổi chưa lưu / form đang mở → không tự tải", () => {
    coBanMoi(); datVisibility("hidden");
    (window as Window & { __editorDirty?: boolean }).__editorDirty = true;
    expect(nenTuTai()).toBe(false);
    (window as Window & { __editorDirty?: boolean }).__editorDirty = false;
    document.body.innerHTML = '<div class="modal-backdrop"></div>';
    expect(nenTuTai()).toBe(false);
  });
  it("đã tự tải tới ĐÚNG bản này một lần (trang mở lại vẫn cũ) → không tải vòng tròn", () => {
    coBanMoi(); datVisibility("hidden");
    sessionStorage.setItem("quanly:phien-ban:da-tai-lai-toi", "index-MoiBBB22");
    expect(nenTuTai()).toBe(false);
  });
  it("không có bản mới → không tự tải", () => {
    datVisibility("hidden");
    expect(nenTuTai()).toBe(false);
  });
});

describe("luuRoiBao — 'Lưu rồi tải bản mới'", () => {
  it("màn đang mở lưu xong và hạ cờ chưa-lưu → true", async () => {
    (window as Window & { __editorDirty?: boolean }).__editorDirty = true;
    const nghe = (e: Event) => (e as CustomEvent<{ hua: Promise<unknown>[] }>).detail.hua.push(
      Promise.resolve().then(() => { (window as Window & { __editorDirty?: boolean }).__editorDirty = false; }));
    window.addEventListener("phien-ban:luu", nghe);
    try { expect(await luuRoiBao()).toBe(true); } finally { window.removeEventListener("phien-ban:luu", nghe); }
  });
  it("lưu hỏng / 409 (cờ vẫn bật) → false, KHÔNG được tải lại", async () => {
    (window as Window & { __editorDirty?: boolean }).__editorDirty = true;
    const nghe = (e: Event) => (e as CustomEvent<{ hua: Promise<unknown>[] }>).detail.hua.push(Promise.resolve(false));
    window.addEventListener("phien-ban:luu", nghe);
    try { expect(await luuRoiBao()).toBe(false); } finally { window.removeEventListener("phien-ban:luu", nghe); }
  });
  it("không màn nào nhận lưu → false", async () => { expect(await luuRoiBao()).toBe(false); });
});

describe("ẩn tạm / hiện lại", () => {
  it("✕ ẩn 30 phút; tự bấm 'Kiểm tra bản mới' thì hiện lại ngay", () => {
    anTam(1000);
    expect(layTrangThai().anDenLuc).toBe(1000 + AN_TAM_MS);
    hienLai();
    expect(layTrangThai().anDenLuc).toBe(0);
  });
});

describe("nhãn chân menu", () => {
  it("có mã commit + giờ → 'Phiên bản 9dd30dc' / 'Cập nhật 24/09 lúc 14:00' (giờ máy người xem)", () => {
    const luc = new Date(2026, 8, 24, 14, 0).toISOString();
    expect(nhanPhienBan({ banGiaoDien: "index-X", sha: "9dd30dc", capNhatLuc: luc }, "index-X")).toEqual({ dong1: "Phiên bản 9dd30dc", dong2: "Cập nhật 24/09 lúc 14:00" });
  });
  it("chưa có mã commit (chạy từ cây làm việc) → dùng mã tệp giao diện, không hiện giờ", () => {
    expect(nhanPhienBan({ banGiaoDien: "index-X", sha: null, capNhatLuc: null }, "index-CuAAA111")).toEqual({ dong1: "Phiên bản CuAAA111", dong2: null });
  });
  it("dev chạy vite (không biết gì) → 'Bản đang phát triển'", () => {
    expect(nhanPhienBan(null, null).dong1).toBe("Bản đang phát triển");
  });
});
