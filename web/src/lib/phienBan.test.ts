/** @vitest-environment jsdom */
// Báo có bản mới sau deploy — phần LOGIC (../lib/phienBan.ts). Giao diện: ../components/PhienBan.test.tsx.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Lệnh ghi đang bay (api.ts) — điều khiển được từ test.
const h = vi.hoisted(() => ({ ghi: 0, xemThu: false }));
vi.mock("./api", () => ({ soLenhGhiDangBay: () => h.ghi, isPreviewMode: () => h.xemThu }));

import {
  banCuaToi, khacBan, dangDo, kiemTraBanMoi, nenTuTai, luuRoiBao, nhanPhienBan, layTrangThai, _datLai, anTam, hienLai, AN_TAM_MS,
  dangKyTrangAnToan, laTrangAnToan, taiBanMoi, taiLaiTrang, batDauTheoDoi, batDauViecNen, KET_LUAN_MOI_MS, NAM_NEN_TOI_THIEU_MS, CHU_KY_MS,
  type TrangThai,
} from "./phienBan";

type WinDirty = Window & { __editorDirty?: boolean };
const traVe = (body: unknown, ok = true) => vi.fn(async () => ({ ok, json: async () => body }) as unknown as Response);
const datVisibility = (v: "visible" | "hidden") => Object.defineProperty(document, "visibilityState", { configurable: true, get: () => v });
const BAN_MOI = { banGiaoDien: "index-MoiBBB22", sha: "9dd30dc", capNhatLuc: null };
/** Trạng thái "vừa hỏi thành công, có bản mới, tab đã nằm nền đủ lâu". */
const coBanMoi = (p: Partial<TrangThai> = {}) => _datLai({ coBanMoi: true, cuaToi: "index-CuAAA111", mayChu: BAN_MOI, hoiLuc: Date.now(), anTuLuc: Date.now() - NAM_NEN_TOI_THIEU_MS - 1000, ...p });

/** Cửa sổ giả cho taiBanMoi / taiLaiTrang: đếm gỡ SW, xoá cache, tải lại, sự kiện bắn ra. */
function cuaSoGia() {
  const reload = vi.fn();
  const unregister = vi.fn(async () => true);
  const xoaCache = vi.fn(async () => true);
  const suKien: string[] = [];
  const nghe = new Map<string, Set<() => void>>();
  const w = {
    document,
    navigator: { onLine: true, serviceWorker: { getRegistrations: async () => [{ unregister }] } },
    caches: { keys: async () => ["workbox-precache-v2"], delete: xoaCache },
    location: { reload },
    sessionStorage: window.sessionStorage,
    setTimeout: (f: () => void, ms: number) => window.setTimeout(f, ms),
    setInterval: (f: () => void, ms: number) => window.setInterval(f, ms),
    clearInterval: (t: number) => window.clearInterval(t),
    addEventListener: (loai: string, f: () => void) => { if (!nghe.has(loai)) nghe.set(loai, new Set()); nghe.get(loai)!.add(f); },
    removeEventListener: (loai: string, f: () => void) => { nghe.get(loai)?.delete(f); },
    dispatchEvent: (e: Event) => { suKien.push(e.type); return true; },
    __editorDirty: false,
  } as unknown as Window;
  /** Trang thật sự rời đi (trình duyệt bắn pagehide). */
  const roiTrang = () => { for (const f of [...(nghe.get("pagehide") ?? [])]) f(); };
  const soNghe = (loai: string) => nghe.get(loai)?.size ?? 0;
  return { w, reload, unregister, xoaCache, suKien, roiTrang, soNghe };
}

beforeEach(() => {
  _datLai();
  h.ghi = 0;
  h.xemThu = false;
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
    const HOI = 10_000_000;   // mốc giả; tab đã nằm nền đủ lâu trước đó
    coBanMoi({ hoiLuc: HOI, anTuLuc: HOI - NAM_NEN_TOI_THIEU_MS }); dangKyTrangAnToan(); datVisibility("hidden");
    expect(nenTuTai(document, window, HOI + KET_LUAN_MOI_MS + 1)).toBe(false);
    expect(nenTuTai(document, window, HOI + KET_LUAN_MOI_MS - 1)).toBe(true);
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
  it("MỚI rời tab vài giây (Alt+Tab chép một con số) → KHÔNG tự tải — quay lại mà thấy trang đang tải lại là tự tải trước mắt", () => {
    coBanMoi({ anTuLuc: 10_000, hoiLuc: 13_000 }); dangKyTrangAnToan(); datVisibility("hidden");
    expect(nenTuTai(document, window, 13_000)).toBe(false);
    expect(nenTuTai(document, window, 10_000 + NAM_NEN_TOI_THIEU_MS - 1)).toBe(false);
    coBanMoi({ anTuLuc: 10_000, hoiLuc: 10_000 + NAM_NEN_TOI_THIEU_MS }); dangKyTrangAnToan();
    expect(nenTuTai(document, window, 10_000 + NAM_NEN_TOI_THIEU_MS)).toBe(true);
  });
  it("chưa ghi được mốc nằm nền (anTuLuc = 0) → không tự tải", () => {
    coBanMoi({ anTuLuc: 0 }); dangKyTrangAnToan(); datVisibility("hidden");
    expect(nenTuTai()).toBe(false);
  });
  it("trang chỉ cho BẤM TAY (trình soạn / Account HN đã lưu sạch: tuTai=false) → bấm tay khỏi hỏi, nhưng KHÔNG tự tải", () => {
    coBanMoi(); dangKyTrangAnToan(() => true, { tuTai: false }); datVisibility("hidden");
    expect(dangDo(), "bấm tay: không có gì dở").toBeNull();
    expect(laTrangAnToan(true)).toBe(false);
    expect(nenTuTai()).toBe(false);
  });
  it("admin đang XEM THỬ quyền → không tự tải (tải lại là rớt về quyền THẬT); bấm tay thì hỏi 'xem-thu'", () => {
    coBanMoi(); dangKyTrangAnToan(); datVisibility("hidden");
    h.xemThu = true;
    expect(dangDo()).toBe("xem-thu");
    expect(nenTuTai()).toBe(false);
  });
  it("xem thử được xét TRƯỚC chưa-lưu / form / đang gõ — câu hỏi phải nói 'sẽ thoát xem thử', không mời 'Lưu rồi tải' (lưu lúc xem thử là giả)", () => {
    dangKyTrangAnToan();
    h.xemThu = true;
    (window as WinDirty).__editorDirty = true;
    expect(dangDo()).toBe("xem-thu");
    (window as WinDirty).__editorDirty = false;
    document.body.innerHTML = '<div class="modal-backdrop"></div>';
    expect(dangDo()).toBe("xem-thu");
  });
  it("lượt tạo file Excel/PDF đang chạy → 'dang-tao-file', không tự tải; xong (gọi hai lần vô hại) thì hết", () => {
    coBanMoi(); dangKyTrangAnToan(); datVisibility("hidden");
    const xong = batDauViecNen();
    expect(dangDo()).toBe("dang-tao-file");
    expect(nenTuTai()).toBe(false);
    xong(); xong();
    expect(dangDo()).toBeNull();
    expect(nenTuTai()).toBe(true);
  });
});

describe("taiBanMoi", () => {
  beforeEach(() => { vi.stubGlobal("fetch", traVe(BAN_MOI)); });
  it("máy chủ phát bản mới → gỡ SW + xoá cache rồi tải lại; không bắn sự kiện nào bảo màn soạn hạ chốt", async () => {
    coBanMoi();
    const g = cuaSoGia();
    expect(await taiBanMoi(g.w)).toBe(true);
    expect(g.unregister).toHaveBeenCalled();
    expect(g.xoaCache).toHaveBeenCalledWith("workbox-precache-v2");
    expect(g.suKien, "không còn sự kiện nào bảo màn soạn hạ chốt beforeunload (soát vòng 2)").toEqual([]);
    expect(g.reload).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem("quanly:phien-ban:da-tai-lai-toi"), "chưa rời trang thật thì chưa ghi khoá").toBeNull();
    g.roiTrang();
    expect(sessionStorage.getItem("quanly:phien-ban:da-tai-lai-toi")).toBe("index-MoiBBB22");
  });
  it("còn thay đổi chưa lưu → KHÔNG tải (không gỡ SW, không reload) — iPhone/iPad không có hộp 'Tải lại trang?' để đỡ", async () => {
    coBanMoi();
    const g = cuaSoGia();
    (g.w as WinDirty).__editorDirty = true;
    expect(await taiBanMoi(g.w)).toBe(false);
    expect(g.unregister).not.toHaveBeenCalled();
    expect(g.reload).not.toHaveBeenCalled();
    expect(layTrangThai().dangTai).toBe(false);
  });
  it("gõ tiếp TRONG LÚC chờ hỏi máy chủ → dừng ngay trước reload", async () => {
    coBanMoi();
    let traLoi: ((r: Response) => void) | null = null;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((r) => { traLoi = r; })));
    const g = cuaSoGia();
    const hua = taiBanMoi(g.w);
    await new Promise((r) => setTimeout(r, 10));
    (g.w as WinDirty).__editorDirty = true;   // người dùng gõ tiếp
    traLoi!({ ok: true, json: async () => BAN_MOI } as unknown as Response);
    expect(await hua).toBe(false);
    expect(g.reload).not.toHaveBeenCalled();
    expect(layTrangThai().dangTai).toBe(false);
  });
  it("đang xem thử quyền: 'chưa lưu' là lưu giả → không chặn tải (dải đã hỏi 'sẽ thoát xem thử')", async () => {
    coBanMoi();
    h.xemThu = true;
    const g = cuaSoGia();
    (g.w as WinDirty).__editorDirty = true;
    expect(await taiBanMoi(g.w)).toBe(true);
    expect(g.reload).toHaveBeenCalledTimes(1);
  });
  it("hộp 'Tải lại trang?' bị Hủy (không có pagehide) → KHÔNG để lại khoá chống vòng tròn — tab đó vẫn tự lên bản này được về sau", async () => {
    vi.useFakeTimers();
    coBanMoi();
    const g = cuaSoGia();
    expect(await taiBanMoi(g.w)).toBe(true);
    expect(g.soNghe("pagehide")).toBe(1);
    await vi.advanceTimersByTimeAsync(3_100);
    expect(g.soNghe("pagehide"), "trình ghi khoá phải được gỡ").toBe(0);
    g.roiTrang();   // rời trang về sau (không phải do lần tải này)
    expect(sessionStorage.getItem("quanly:phien-ban:da-tai-lai-toi")).toBeNull();
    expect(layTrangThai().dangTai).toBe(false);
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
  it("máy chủ nhận kết nối mà KHÔNG trả lời → hết hạn giờ thì tải lại thường, không treo nút; bấm dồn lúc đang hỏi thì bỏ qua", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_u: unknown, init?: RequestInit) => new Promise((_ok, loi) => {
      init?.signal?.addEventListener("abort", () => loi(new DOMException("hết giờ", "AbortError")));
    })));
    const g = cuaSoGia();
    const lan1 = taiLaiTrang(g.w);
    const lan2 = taiLaiTrang(g.w);
    await vi.advanceTimersByTimeAsync(4_100);
    await Promise.all([lan1, lan2]);
    expect(g.unregister).not.toHaveBeenCalled();
    expect(g.reload, "bấm dồn chỉ tải lại MỘT lần").toHaveBeenCalledTimes(1);
  });
});

describe("kiemTraBanMoi — hạn giờ", () => {
  it("không trả lời quá hạn → null như mất mạng (dải không kẹt 'Đang tải bản mới…')", async () => {
    const treo = vi.fn((_u: unknown, init?: RequestInit) => new Promise<Response>((_ok, loi) => {
      init?.signal?.addEventListener("abort", () => loi(new DOMException("hết giờ", "AbortError")));
    })) as unknown as typeof fetch;
    expect(await kiemTraBanMoi(treo, 30)).toBeNull();
    expect(layTrangThai().hoiHong).toBe(true);
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
  it("tab vừa nằm nền thấy bản mới → CHƯA tải; nằm nền đủ 5 phút thì lần hỏi định kỳ tự tải", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", traVe(BAN_MOI));
    dangKyTrangAnToan(); datVisibility("hidden");
    const g = cuaSoGia();
    const go = batDauTheoDoi(g.w, document);
    try {
      await vi.advanceTimersByTimeAsync(50);
      expect(layTrangThai().coBanMoi).toBe(true);
      expect(g.reload, "mới nằm nền — người dùng có thể quay lại ngay").not.toHaveBeenCalled();
      document.dispatchEvent(new Event("visibilitychange"));   // vẫn hidden
      await vi.advanceTimersByTimeAsync(50);
      expect(g.reload).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(CHU_KY_MS);
      expect(g.reload).toHaveBeenCalledTimes(1);
    } finally { go(); }
  });
  it("quay lại tab thì mốc nằm nền xoá — rời lại thì đếm lại từ đầu", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", traVe({ banGiaoDien: "index-CuAAA111", sha: null, capNhatLuc: null }));
    datVisibility("hidden");
    const g = cuaSoGia();
    const go = batDauTheoDoi(g.w, document);
    try {
      await vi.advanceTimersByTimeAsync(10);
      const luc1 = layTrangThai().anTuLuc;
      expect(luc1).toBeGreaterThan(0);
      datVisibility("visible"); document.dispatchEvent(new Event("visibilitychange"));
      expect(layTrangThai().anTuLuc).toBe(0);
      await vi.advanceTimersByTimeAsync(1000);
      datVisibility("hidden"); document.dispatchEvent(new Event("visibilitychange"));
      expect(layTrangThai().anTuLuc).toBeGreaterThan(luc1);
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
