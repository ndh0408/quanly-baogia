/** @vitest-environment jsdom */
// Báo có bản mới sau deploy — phần LOGIC (../lib/phienBan.ts). Giao diện: ../components/PhienBan.test.tsx.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Lệnh ghi đang bay (api.ts) — điều khiển được từ test.
const h = vi.hoisted(() => ({ ghi: 0 }));
vi.mock("./api", () => ({ soLenhGhiDangBay: () => h.ghi }));

import {
  banCuaToi, khacBan, dangDo, kiemTraBanMoi, nenTuTai, luuRoiBao, nhanPhienBan, layTrangThai, _datLai, anTam, hienLai, AN_TAM_MS,
  dangKyTrangAnToan, laTrangAnToan, taiBanMoi, taiLaiTrang, batDauTheoDoi, KET_LUAN_MOI_MS, type TrangThai,
} from "./phienBan";

type WinDirty = Window & { __editorDirty?: boolean };
const traVe = (body: unknown, ok = true) => vi.fn(async () => ({ ok, json: async () => body }) as unknown as Response);
const datVisibility = (v: "visible" | "hidden") => Object.defineProperty(document, "visibilityState", { configurable: true, get: () => v });
const BAN_MOI = { banGiaoDien: "index-MoiBBB22", sha: "9dd30dc", capNhatLuc: null };
/** Trạng thái "vừa hỏi thành công, có bản mới". */
const coBanMoi = (p: Partial<TrangThai> = {}) => _datLai({ coBanMoi: true, cuaToi: "index-CuAAA111", mayChu: BAN_MOI, hoiLuc: Date.now(), ...p });

/** Cửa sổ giả cho taiBanMoi / taiLaiTrang: đếm gỡ SW, xoá cache, tải lại, sự kiện bắn ra. */
function cuaSoGia() {
  const reload = vi.fn();
  const unregister = vi.fn(async () => true);
  const xoaCache = vi.fn(async () => true);
  const suKien: string[] = [];
  const w = {
    document,
    navigator: { onLine: true, serviceWorker: { getRegistrations: async () => [{ unregister }] } },
    caches: { keys: async () => ["workbox-precache-v2"], delete: xoaCache },
    location: { reload },
    sessionStorage: window.sessionStorage,
    setTimeout: (f: () => void, ms: number) => window.setTimeout(f, ms),
    setInterval: (f: () => void, ms: number) => window.setInterval(f, ms),
    clearInterval: (t: number) => window.clearInterval(t),
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: (e: Event) => { suKien.push(e.type); return true; },
    __editorDirty: false,
  } as unknown as Window;
  return { w, reload, unregister, xoaCache, suKien };
}

beforeEach(() => {
  _datLai();
  h.ghi = 0;
  document.head.innerHTML = '<script type="module" crossorigin src="/app2/assets/index-CuAAA111.js"></script>';
  document.body.innerHTML = "";
  (window as WinDirty).__editorDirty = false;
  sessionStorage.clear();
  datVisibility("visible");
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

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
  it("máy chủ phát bản khác → true, lưu vào kho kèm mốc hỏi thành công", async () => {
    expect(await kiemTraBanMoi(traVe({ banGiaoDien: "index-MoiBBB22", sha: "9dd30dc", capNhatLuc: "2026-09-24T14:00:00+07:00" }))).toBe(true);
    expect(layTrangThai().coBanMoi).toBe(true);
    expect(layTrangThai().mayChu?.sha).toBe("9dd30dc");
    expect(layTrangThai().hoiLuc).toBeGreaterThan(0);
    expect(layTrangThai().hoiHong).toBe(false);
  });
  it("cùng bản → false", async () => {
    expect(await kiemTraBanMoi(traVe({ banGiaoDien: "index-CuAAA111", sha: null, capNhatLuc: null }))).toBe(false);
  });
  it("mất mạng / máy chủ đang khởi động lại → null, KHÔNG xoá kết luận cũ, nhưng ghi nhận lần hỏi hỏng", async () => {
    await kiemTraBanMoi(traVe({ banGiaoDien: "index-MoiBBB22", sha: null, capNhatLuc: null }));
    expect(await kiemTraBanMoi(vi.fn(async () => { throw new TypeError("Failed to fetch"); }) as unknown as typeof fetch)).toBeNull();
    expect(await kiemTraBanMoi(traVe({}, false))).toBeNull();
    expect(layTrangThai().coBanMoi, "một lần hỏi hỏng không được làm mất dải thông báo").toBe(true);
    expect(layTrangThai().hoiHong).toBe(true);
  });
});

describe("trang tự khai 'tải lại an toàn'", () => {
  it("MẶC ĐỊNH không an toàn — chưa trang nào khai thì dangDo = chua-ro", () => {
    expect(laTrangAnToan()).toBe(false);
    expect(dangDo()).toBe("chua-ro");
  });
  it("trang khai an toàn → null; gỡ khai → lại chua-ro", () => {
    const go = dangKyTrangAnToan();
    expect(dangDo()).toBeNull();
    go();
    expect(dangDo()).toBe("chua-ro");
  });
  it("MỌI hàm đã khai đều phải nói an toàn (lớp phủ đăng nhập lại khai 'không' đè lên trang đang mở)", () => {
    dangKyTrangAnToan();
    dangKyTrangAnToan(() => false);
    expect(laTrangAnToan()).toBe(false);
  });
  it("hàm khai ném lỗi → coi là KHÔNG an toàn", () => {
    dangKyTrangAnToan(() => { throw new Error("x"); });
    expect(laTrangAnToan()).toBe(false);
  });
});

describe("dangDo — tải lại lúc này có làm mất gì không", () => {
  beforeEach(() => { dangKyTrangAnToan(); });
  it("không có gì dở → null", () => { expect(dangDo()).toBeNull(); });
  it("trình soạn / Account HN còn thay đổi chưa lưu → chua-luu", () => {
    (window as WinDirty).__editorDirty = true;
    expect(dangDo()).toBe("chua-luu");
  });
  it("đang mở form / hộp thoại → form-mo", () => {
    document.body.innerHTML = '<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true"></div></div>';
    expect(dangDo()).toBe("form-mo");
  });
  it("tiêu điểm ở ô nhập sửa được ĐÃ CÓ CHỮ → dang-go; ô chỉ-đọc / checkbox thì không", () => {
    document.body.innerHTML = '<input id="a" value="HĐ 0012"><input id="b" readonly value="x"><input id="c" type="checkbox"><textarea id="d">ghi chú</textarea>';
    (document.getElementById("a") as HTMLInputElement).focus();
    expect(dangDo()).toBe("dang-go");
    (document.getElementById("d") as HTMLTextAreaElement).focus();
    expect(dangDo()).toBe("dang-go");
    (document.getElementById("b") as HTMLInputElement).focus();
    expect(dangDo()).toBeNull();
    (document.getElementById("c") as HTMLInputElement).focus();
    expect(dangDo()).toBeNull();
  });
  it("ô TRỐNG có con trỏ (trang đăng nhập tự đặt con trỏ vào ô tên) → không tính là đang gõ — không mất gì", () => {
    document.body.innerHTML = '<input id="ten" autocomplete="username">';
    (document.getElementById("ten") as HTMLInputElement).focus();
    expect(dangDo()).toBeNull();
    (document.getElementById("ten") as HTMLInputElement).value = "huy";
    expect(dangDo(), "gõ được chữ rồi thì có thứ để mất").toBe("dang-go");
  });
});

describe("nenTuTai — chỉ tự tải khi AN TOÀN", () => {
  beforeEach(() => { dangKyTrangAnToan(); });
  it("có bản mới (vừa hỏi thành công) + tab nằm nền + trang an toàn + không dở gì → tự tải", () => {
    coBanMoi(); dangKyTrangAnToan(); datVisibility("hidden");
    expect(nenTuTai()).toBe(true);
  });
  it("người dùng ĐANG NHÌN màn hình → không bao giờ tự tải", () => {
    coBanMoi(); dangKyTrangAnToan(); datVisibility("visible");
    expect(nenTuTai()).toBe(false);
  });
  it("trang KHÔNG tự khai an toàn (wizard, báo giá mới, Phân quyền…) → không tự tải dù chẳng thấy gì dở", () => {
    coBanMoi(); datVisibility("hidden");   // _datLai trong coBanMoi đã xoá sổ khai
    expect(nenTuTai()).toBe(false);
  });
  it("tab nằm nền nhưng còn thay đổi chưa lưu / form đang mở → không tự tải", () => {
    coBanMoi(); dangKyTrangAnToan(); datVisibility("hidden");
    (window as WinDirty).__editorDirty = true;
    expect(nenTuTai()).toBe(false);
    (window as WinDirty).__editorDirty = false;
    document.body.innerHTML = '<div class="modal-backdrop"></div>';
    expect(nenTuTai()).toBe(false);
  });
  it("lệnh lưu đang chạy (ô Hóa đơn lưu khi blur — chính cú chuyển tab bắn nó) → không tự tải", () => {
    coBanMoi(); dangKyTrangAnToan(); datVisibility("hidden");
    h.ghi = 1;
    expect(nenTuTai()).toBe(false);
  });
  it("lần hỏi GẦN NHẤT hỏng (mất mạng / máy chủ đang khởi động lại) → không tự tải theo kết luận cũ", () => {
    coBanMoi({ hoiHong: true }); dangKyTrangAnToan(); datVisibility("hidden");
    expect(nenTuTai()).toBe(false);
  });
  it("kết luận CŨ (hỏi thành công lần cuối quá 2 phút) → không tự tải", () => {
    coBanMoi({ hoiLuc: 1_000 }); dangKyTrangAnToan(); datVisibility("hidden");
    expect(nenTuTai(document, window, 1_000 + KET_LUAN_MOI_MS + 1)).toBe(false);
    expect(nenTuTai(document, window, 1_000 + KET_LUAN_MOI_MS - 1)).toBe(true);
  });
  it("trình duyệt báo mất mạng → không tự tải (tải lại là ra trang lỗi)", () => {
    coBanMoi(); dangKyTrangAnToan(); datVisibility("hidden");
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    expect(nenTuTai()).toBe(false);
  });
  it("đã tự tải tới ĐÚNG bản này một lần (trang mở lại vẫn cũ) → không tải vòng tròn", () => {
    coBanMoi(); dangKyTrangAnToan(); datVisibility("hidden");
    sessionStorage.setItem("quanly:phien-ban:da-tai-lai-toi", "index-MoiBBB22");
    expect(nenTuTai()).toBe(false);
  });
  it("không có bản mới → không tự tải", () => {
    datVisibility("hidden");
    expect(nenTuTai()).toBe(false);
  });
});

describe("taiBanMoi", () => {
  beforeEach(() => { vi.stubGlobal("fetch", traVe(BAN_MOI)); });
  it("máy chủ phát bản mới → gỡ SW + xoá cache, báo màn soạn ghi bản nháp, rồi tải lại; KHÔNG tự hạ cờ chưa-lưu", async () => {
    coBanMoi();
    const g = cuaSoGia();
    (g.w as WinDirty).__editorDirty = true;
    expect(await taiBanMoi(g.w)).toBe(true);
    expect(g.unregister).toHaveBeenCalled();
    expect(g.xoaCache).toHaveBeenCalledWith("workbox-precache-v2");
    expect(g.suKien).toContain("phien-ban:truoc-tai");
    expect(g.reload).toHaveBeenCalledTimes(1);
    expect((g.w as WinDirty).__editorDirty, "hạ cờ ở đây = hết chặn rời trang nếu người dùng Hủy hộp của trình duyệt").toBe(true);
    expect(sessionStorage.getItem("quanly:phien-ban:da-tai-lai-toi")).toBe("index-MoiBBB22");
  });
  it("hỏi lại máy chủ KHÔNG được (mất mạng / đang khởi động lại) → không gỡ SW, không tải lại, trả dải về bình thường", async () => {
    coBanMoi();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    const g = cuaSoGia();
    expect(await taiBanMoi(g.w)).toBe(false);
    expect(g.unregister, "gỡ SW lúc mất mạng = mất luôn vỏ offline").not.toHaveBeenCalled();
    expect(g.reload).not.toHaveBeenCalled();
    expect(layTrangThai().dangTai).toBe(false);
  });
  it("máy chủ hoá ra đang phát ĐÚNG bản này (vừa lùi bản) → không tải gì, dải tự tắt", async () => {
    coBanMoi();
    vi.stubGlobal("fetch", traVe({ banGiaoDien: "index-CuAAA111", sha: null, capNhatLuc: null }));
    const g = cuaSoGia();
    expect(await taiBanMoi(g.w)).toBe(false);
    expect(g.reload).not.toHaveBeenCalled();
    expect(layTrangThai().coBanMoi).toBe(false);
  });
  it("lệnh lưu đang chạy → CHỜ nó xong rồi mới tải lại", async () => {
    coBanMoi();
    h.ghi = 1;
    const g = cuaSoGia();
    const hua = taiBanMoi(g.w);
    await new Promise((r) => setTimeout(r, 600));
    expect(g.reload, "lệnh lưu chưa xong").not.toHaveBeenCalled();
    h.ghi = 0;
    expect(await hua).toBe(true);
    expect(g.reload).toHaveBeenCalledTimes(1);
  });
  it("lệnh lưu treo quá 10 giây → bỏ, không tải lại", async () => {
    vi.useFakeTimers();
    coBanMoi();
    h.ghi = 1;
    const g = cuaSoGia();
    const hua = taiBanMoi(g.w);
    await vi.advanceTimersByTimeAsync(10_500);
    expect(await hua).toBe(false);
    expect(g.reload).not.toHaveBeenCalled();
    expect(layTrangThai().dangTai).toBe(false);
  });
  it("đường TỰ ĐỘNG: người dùng quay lại tab trong lúc đang gỡ SW → KHÔNG tải lại trước mắt họ", async () => {
    coBanMoi(); dangKyTrangAnToan(); datVisibility("hidden");
    const g = cuaSoGia();
    g.unregister.mockImplementation(async () => { datVisibility("visible"); return true; });
    expect(await taiBanMoi(g.w, { tuDong: true })).toBe(false);
    expect(g.reload).not.toHaveBeenCalled();
  });
  it("hộp 'Tải lại trang?' của trình duyệt bị Hủy (trang ở lại) → sau 3 giây dải hết kẹt 'Đang tải…'", async () => {
    vi.useFakeTimers();
    coBanMoi();
    const g = cuaSoGia();
    expect(await taiBanMoi(g.w)).toBe(true);
    expect(layTrangThai().dangTai).toBe(true);
    await vi.advanceTimersByTimeAsync(3_100);
    expect(layTrangThai().dangTai).toBe(false);
  });
});

describe("taiLaiTrang — nút 'Thử lại' / 'Tải lại trang' ở màn lỗi", () => {
  it("máy chủ đang phát bản khác → gỡ SW trước (khỏi phải tải hai lần)", async () => {
    vi.stubGlobal("fetch", traVe(BAN_MOI));
    const g = cuaSoGia();
    await taiLaiTrang(g.w);
    expect(g.unregister).toHaveBeenCalled();
    expect(g.reload).toHaveBeenCalledTimes(1);
  });
  it("máy chủ chưa lên → GIỮ SW (vỏ offline hiện được màn 'Không kết nối được máy chủ'), vẫn tải lại thường", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    const g = cuaSoGia();
    await taiLaiTrang(g.w);
    expect(g.unregister).not.toHaveBeenCalled();
    expect(g.reload).toHaveBeenCalledTimes(1);
  });
});

describe("batDauTheoDoi — lúc nào hỏi, lúc nào tự tải", () => {
  it("hỏi HỎNG thì không tự tải theo kết luận cũ, dù tab nằm nền", async () => {
    coBanMoi({ hoiLuc: 0 }); dangKyTrangAnToan(); datVisibility("hidden");
    const hoiHong = vi.fn(async () => { throw new TypeError("Failed to fetch"); });
    vi.stubGlobal("fetch", hoiHong);
    const g = cuaSoGia();
    const go = batDauTheoDoi(g.w, document);
    try {
      await new Promise((r) => setTimeout(r, 20));
      document.dispatchEvent(new Event("visibilitychange"));
      await new Promise((r) => setTimeout(r, 20));
      expect(hoiHong).toHaveBeenCalled();
      expect(g.reload).not.toHaveBeenCalled();
    } finally { go(); }
  });
  it("quay lại tab liên tục → không hỏi dồn (vừa hỏi thành công chưa tới 1 phút thì dùng luôn kết quả)", async () => {
    const f = traVe({ banGiaoDien: "index-CuAAA111", sha: null, capNhatLuc: null });
    vi.stubGlobal("fetch", f);
    const g = cuaSoGia();
    const go = batDauTheoDoi(g.w, document);
    try {
      await new Promise((r) => setTimeout(r, 20));
      expect(f).toHaveBeenCalledTimes(1);
      for (let i = 0; i < 5; i++) document.dispatchEvent(new Event("visibilitychange"));
      await new Promise((r) => setTimeout(r, 20));
      expect(f).toHaveBeenCalledTimes(1);
    } finally { go(); }
  });
  it("tab nằm nền, lần hỏi định kỳ thấy bản mới, trang an toàn → tự tải", async () => {
    vi.stubGlobal("fetch", traVe(BAN_MOI));
    dangKyTrangAnToan(); datVisibility("hidden");
    const g = cuaSoGia();
    const go = batDauTheoDoi(g.w, document);
    try {
      await new Promise((r) => setTimeout(r, 50));
      expect(g.reload).toHaveBeenCalledTimes(1);
    } finally { go(); }
  });
});

describe("luuRoiBao — 'Lưu rồi tải bản mới'", () => {
  it("màn đang mở lưu xong và hạ cờ chưa-lưu → true", async () => {
    (window as WinDirty).__editorDirty = true;
    const nghe = (e: Event) => (e as CustomEvent<{ hua: Promise<unknown>[] }>).detail.hua.push(
      Promise.resolve().then(() => { (window as WinDirty).__editorDirty = false; }));
    window.addEventListener("phien-ban:luu", nghe);
    try { expect(await luuRoiBao()).toBe(true); } finally { window.removeEventListener("phien-ban:luu", nghe); }
  });
  it("lưu hỏng / 409 (cờ vẫn bật) → false, KHÔNG được tải lại", async () => {
    (window as WinDirty).__editorDirty = true;
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
