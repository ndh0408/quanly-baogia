/** @vitest-environment jsdom */
//
// SOÁT TOÀN DIỆN (nhóm soạn báo giá) — các lỗi của trình soạn KHÔNG thuộc chuyện xoá sheet
// (xoá sheet ở QuoteEditor.xoaSheet.test.tsx):
//   L56 — Discount / Ghi chú / Hiện tổng còn sửa được trong lúc PUT đang bay → mất im lặng.
//   L61 — hộp lý do "Khách không chốt" / "↩ Trả lại" / "Khách không duyệt" còn treo sau khi rời báo giá.
//   L62 — Lưu báo giá MỚI rồi rời trang trước khi máy chủ trả lời: instance đã gỡ kéo hash, tắt cờ.
//   L63 — chế độ "Xem thử quyền" đọc/ghi/xoá bản nháp THẬT của admin.
//   L64 — đổi mẫu có ngày → không ngày → có ngày làm mất số Ngày.
//   X2  — hộp thanh toán nhận mốc updatedAt mới mà không kiểm người khác đã lưu chen vào.
// Cùng giàn dựng createRoot + act với QuoteEditor.soatCheo.test.tsx.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const MAU = [
  { id: 1, code: "gn", name: "GN (không ngày)", companyId: 7, layout: { hasDays: false } },
  { id: 2, code: "gnd", name: "GN (có ngày)", companyId: 7, layout: { hasDays: true } },
  // Công ty 8 chỉ có mẫu CÓ ngày — để mẫu dự phòng (mẫu đầu của công ty) của bảng nội bộ có ngày (đợt 4).
  { id: 3, code: "clfd", name: "CLF (có ngày)", companyId: 8, layout: { hasDays: true } },
];
const CTY = [{ id: 7, name: "Gia Nguyễn" }];
const MOC_CU = "2026-09-20T00:00:00.000Z";

const trang = (id: number, over: Record<string, unknown> = {}) => ({
  id, templateId: 1, name: `Trang ${id}`, groupSubtotal: false, extraTables: [], discount: 0,
  items: [{ kind: "item", name: "Backdrop", unit: "cái", quantity: 1, unitPrice: 10_000_000 }], ...over,
});
const baoGia = (over: Record<string, unknown> = {}) => ({
  id: 11, quoteNumber: "GN26011", title: "Sự kiện", status: "sent", companyId: 7, createdById: 1,
  toCompany: "Khách cũ", vatPercent: 0, discount: 0, showTotals: true, quoteDate: "2026-09-20", notes: "",
  updatedAt: MOC_CU, hnStatus: "submitted", hnTables: [], members: [],
  sheets: [trang(101)],
  ...over,
});

const h = vi.hoisted(() => ({
  updateQuote: null as unknown as ReturnType<typeof vi.fn>,
  createQuote: null as unknown as ReturnType<typeof vi.fn>,
  getQuote: null as unknown as ReturnType<typeof vi.fn>,
}));

vi.mock("../lib/api", async (goc) => {
  const that = await goc<typeof import("../lib/api")>();
  const fns: Record<string, ReturnType<typeof vi.fn>> = {
    metaCompanies: vi.fn(async () => CTY),
    metaTemplates: vi.fn(async () => MAU),
    getQuote: vi.fn(async () => baoGia()),
    presence: vi.fn(async () => ({ editing: [] })),
    hnAccounts: vi.fn(async () => ({ data: [] })),
    updateQuote: vi.fn(async (_id: number, p: Record<string, unknown>) => ({ ...baoGia(), ...JSON.parse(JSON.stringify(p)), updatedAt: "2026-09-21T00:00:00.000Z" })),
    createQuote: vi.fn(async () => ({ id: 99 })),
    markLost: vi.fn(async () => baoGia({ status: "lost" })),
    hnReview: vi.fn(async () => ({})),
    sheetCustomerDecision: vi.fn(async () => ({ custStatus: "rejected" })),
  };
  h.updateQuote = fns.updateQuote;
  h.createQuote = fns.createQuote;
  h.getQuote = fns.getQuote;
  const api = new Proxy(fns, { get: (t, k: string) => t[k] ?? (t[k] = vi.fn(async () => ({}))) });
  return { ...that, api };
});
vi.mock("../lib/ui", async (goc) => ({
  ...(await goc<typeof import("../lib/ui")>()),
  toast: vi.fn(),
  confirmModal: vi.fn(async () => true),
  promptModal: vi.fn(async () => "lý do"),
  modalChotBaoGia: vi.fn(async () => []),
}));
vi.mock("../lib/venueCatalog", async (goc) => ({ ...(await goc<typeof import("../lib/venueCatalog")>()), loadCatalog: () => Promise.resolve({ entries: [], venues: [] }) }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { QuoteEditorPage } from "./QuoteEditor";
import { api, setPreviewMode } from "../lib/api";
import * as ui from "../lib/ui";
import { khoaBanNhap, ghiBanNhap, docBanNhap } from "../lib/localDraft";
import { setPendingNewQuote } from "../lib/pendingQuote";

const ME = { id: 1, username: "a", displayName: "A", role: "admin", permissions: ["quote:send", "quote:update:all", "quote:hn:manage", "quote:read:all", "quote:internal:pay"] };
type WinDirty = Window & { __editorDirty?: boolean };

let root: Root | null = null;
let hop: HTMLDivElement | null = null;
const cho = async (ms = 0) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };

async function moEditor(quoteId: number | undefined = 11, isNew = false) {
  hop = document.createElement("div");
  document.body.appendChild(hop);
  root = createRoot(hop);
  await act(async () => { root!.render(<QuoteEditorPage me={ME} quoteId={quoteId} isNew={isNew} />); });
  await cho(10);
}
function dongEditor() { act(() => root!.unmount()); root = null; hop?.remove(); hop = null; }
const nut = (chu: string) => {
  const b = [...hop!.querySelectorAll("button")].find((x) => x.textContent?.includes(chu));
  if (!b) throw new Error("không thấy nút " + chu);
  return b as HTMLButtonElement;
};
const oTenKhach = () => hop!.querySelector('input[placeholder="Tên công ty khách"]') as HTMLInputElement;
function go(el: HTMLInputElement | HTMLTextAreaElement, chu: string) {
  act(() => { el.value = chu; el.dispatchEvent(new Event("input", { bubbles: true })); });
}
const bam = async (b: HTMLElement) => { await act(async () => { b.click(); }); await cho(10); };
const hopCheckbox = (chu: string) => [...hop!.querySelectorAll("label.toggle-totals")].find((l) => l.textContent?.includes(chu))!.querySelector("input") as HTMLInputElement;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  (window as WinDirty).__editorDirty = false;
  location.hash = "";
});
afterEach(async () => {
  setPreviewMode(false);
  await cho(1300);
  if (root) act(() => root!.unmount());
  root = null; hop?.remove(); hop = null; document.body.innerHTML = "";
});

// L56: GRID-07 + app#15 đã khoá ô meta, lưới, thêm/xoá sheet, Nhập Excel theo `saving`, nhưng còn sót
// ô Discount, hai checkbox Hiện tổng / Ghi chú, ô Ghi chú (và nút ý kiến khách theo sheet). Sửa chúng
// lúc PUT đang bay → qRef bị thay bằng bản máy chủ, cờ bẩn tắt, ô vẫn hiện số mới → lần Lưu sau gửi 0.
describe("L56 — khoá Discount / Ghi chú / Hiện tổng trong lúc đang Lưu", () => {
  it("updateQuote treo: ô Discount, checkbox Hiện tổng + Ghi chú, ô Ghi chú, nút ý kiến khách đều bị khoá", async () => {
    h.getQuote.mockImplementationOnce(async () => baoGia({ notes: "Ghi chú cũ" }));
    await moEditor();
    go(oTenKhach(), "Khách MỚI");
    let xong!: () => void;
    h.updateQuote.mockImplementationOnce((_id: number, p: Record<string, unknown>) => new Promise((r) => { xong = () => r({ ...baoGia(), ...JSON.parse(JSON.stringify(p)), updatedAt: "2026-09-21T00:00:00.000Z" }); }));
    await bam(nut("Lưu"));
    const disc = hop!.querySelector(".sheet-discount-input") as HTMLInputElement;
    const ghiChu = hop!.querySelector('textarea[placeholder^="VD: Tất cả"]') as HTMLTextAreaElement;
    const trangThai = {
      discount: disc.disabled,
      hienTong: hopCheckbox("Hiển thị bảng").disabled,
      coGhiChu: hopCheckbox("Ghi chú").disabled,
      oGhiChu: ghiChu.disabled,
      khachDuyet: nut("✓ Khách duyệt").disabled,
    };
    expect(trangThai).toEqual({ discount: true, hienTong: true, coGhiChu: true, oGhiChu: true, khachDuyet: true });
    await act(async () => { xong(); });
    await cho(10);
    expect(disc.disabled).toBe(false);
    expect(hopCheckbox("Hiển thị bảng").disabled).toBe(false);
  });
});

// L61: promptModal / confirmModal là DOM gắn thẳng vào body, không tự đóng khi Back đổi hash. Shell gỡ
// editor #11 (đổi `key`), dựng #12 phía sau hộp; người dùng trả lời hộp tưởng là cho #12.
describe("L61 — hộp lý do còn treo sau khi rời báo giá không được chạy thao tác lên báo giá cũ", () => {
  const promptMock = () => ui.promptModal as unknown as ReturnType<typeof vi.fn>;
  async function roiSang12() {
    dongEditor();
    h.getQuote.mockImplementationOnce(async () => baoGia({ id: 12, quoteNumber: "GN26012" }));
    await moEditor(12);
  }
  const treo = () => {
    let traLoi!: (v: string | null) => void;
    promptMock().mockImplementationOnce(() => new Promise<string | null>((r) => { traLoi = r; }));
    return async (v: string | null) => { await act(async () => { traLoi(v); }); await cho(10); };
  };

  it("'✗ Khách không chốt' của #11 còn treo khi đã sang #12: xác nhận KHÔNG gọi markLost(11)", async () => {
    await moEditor();
    const traLoi = treo();
    await bam(nut("Khách không chốt"));
    expect(String(promptMock().mock.calls[0][0]), "hộp không nói báo giá nào").toContain("GN26011");
    await roiSang12();
    await traLoi("lý do");
    expect(api.markLost).not.toHaveBeenCalled();
  });

  it("'↩ Trả lại' phần HN của #11 còn treo: xác nhận KHÔNG gọi hnReview(11, reject)", async () => {
    await moEditor();
    const traLoi = treo();
    await bam(nut("↩ Trả lại"));
    await roiSang12();
    await traLoi("thiếu giá");
    expect(api.hnReview).not.toHaveBeenCalled();
  });

  it("'✗ Không duyệt' sheet của #11 còn treo: xác nhận KHÔNG ghi ý kiến khách cho sheet của #11", async () => {
    await moEditor();
    const traLoi = treo();
    await bam(nut("✗ Không duyệt"));
    await roiSang12();
    await traLoi("giá cao");
    expect(api.sheetCustomerDecision).not.toHaveBeenCalled();
  });

  it("'✕' xoá sheet của #11 còn treo: xác nhận KHÔNG bật cờ 'chưa lưu' của #12 đang sạch", async () => {
    h.getQuote.mockImplementationOnce(async () => baoGia({ sheets: [trang(101), trang(102)] }));
    await moEditor();
    let traLoi!: (v: boolean) => void;
    (ui.confirmModal as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(() => new Promise<boolean>((r) => { traLoi = r; }));
    await bam(hop!.querySelector('button[aria-label="Xóa sheet 1"]') as HTMLButtonElement);
    await roiSang12();
    expect((window as WinDirty).__editorDirty).toBe(false);
    await act(async () => { traLoi(true); });
    await cho(10);
    expect((window as WinDirty).__editorDirty, "hộp treo của #11 bật cờ chặn rời trang trên #12").toBe(false);
  });

  // Đợt 3: hộp hỏi nằm trong component CON (lưới "Xóa nhiều hàng", "Xoá sheet nội bộ/Hà Nội") gọi ngược
  // mark() của editor. Editor đã gỡ mà mark() vẫn chạy thì bật cờ `__editorDirty` DÙNG CHUNG của #12 và hẹn
  // giờ ghi bản nháp #11 (sau khi cleanup đã huỷ hẹn giờ) — lần mở #11 sau bị mời khôi phục phần đã bỏ.
  it("'Xóa nhiều hàng' trong lưới #11 còn treo khi đã sang #12: xác nhận KHÔNG bật cờ 'chưa lưu' của #12, KHÔNG ghi bản nháp #11", async () => {
    const hai = [{ kind: "item", name: "Backdrop", unit: "cái", quantity: 1, unitPrice: 1000 }, { kind: "item", name: "Standee", unit: "cái", quantity: 1, unitPrice: 2000 }];
    h.getQuote.mockImplementationOnce(async () => baoGia({ sheets: [trang(101, { items: hai })] }));
    await moEditor();
    let traLoi!: (v: boolean) => void;
    (ui.confirmModal as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(() => new Promise<boolean>((r) => { traLoi = r; }));
    const phim = (init: KeyboardEventInit) => act(() => { document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init })); });
    act(() => { (hop!.querySelector('.editor tr[data-row="0"] [data-f="name"]') as HTMLElement).focus(); });
    phim({ key: "ArrowDown", shiftKey: true });
    phim({ key: " ", code: "Space", shiftKey: true });
    phim({ key: "-", ctrlKey: true });
    expect(ui.confirmModal).toHaveBeenCalledWith("Xóa nhiều hàng", expect.any(String), expect.anything());
    await roiSang12();
    expect((window as WinDirty).__editorDirty).toBe(false);
    await act(async () => { traLoi(true); });
    await cho(1300);
    expect((window as WinDirty).__editorDirty, "hộp treo của lưới #11 bật cờ chặn rời trang trên #12").toBe(false);
    expect(docBanNhap(khoaBanNhap(11, 1), 1), "hộp treo của lưới #11 ghi bản nháp #11 sau khi editor đã gỡ").toBeNull();
  });

  it("đối chứng: không rời trang → xác nhận 'Khách không chốt' vẫn gọi markLost(11)", async () => {
    await moEditor();
    await bam(nut("Khách không chốt"));
    expect(api.markLost).toHaveBeenCalledWith(11, "lý do");
  });

  // Cùng họ, sót ở back(): trả lời hộp treo từng hạ cờ bẩn DÙNG CHUNG, bắn editor:discard (editor đang mở
  // nghe thấy và xoá bản nháp CỦA NÓ) rồi kéo hash về #/list mà không hỏi.
  it("'Rời khỏi mà chưa lưu?' của nút ← Quay lại (#11) còn treo khi đã sang #12: trả lời KHÔNG xoá bản nháp #12, không kéo về #/list", async () => {
    await moEditor();
    go(oTenKhach(), "Sửa 11");
    let traLoi!: (v: boolean) => void;
    (ui.confirmModal as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(() => new Promise<boolean>((r) => { traLoi = r; }));
    await bam(nut("← Quay lại"));
    // Back của trình duyệt: Shell.guardLeave hỏi, người dùng chọn rời → hạ cờ, bắn editor:discard, gỡ #11.
    (window as WinDirty).__editorDirty = false;
    await act(async () => { window.dispatchEvent(new Event("editor:discard")); });
    dongEditor();
    location.hash = "#/quotes/12";
    const KHOA12 = khoaBanNhap(12, 1);
    ghiBanNhap(KHOA12, baoGia({ id: 12, toCompany: "Khách #12 CHƯA LƯU" }), MOC_CU, 1);
    h.getQuote.mockImplementationOnce(async () => baoGia({ id: 12 }));
    await moEditor(12);                                             // hộp "Khôi phục?" của #12 → Khôi phục
    expect(oTenKhach().value).toBe("Khách #12 CHƯA LƯU");
    await act(async () => { traLoi(true); });                       // "Rời, bỏ thay đổi" trên hộp treo của #11
    await cho(10);
    expect(location.hash, "hộp treo của #11 kéo người dùng về danh sách").toBe("#/quotes/12");
    expect((window as WinDirty).__editorDirty, "hộp treo của #11 tắt cờ chặn rời trang của #12").toBe(true);
    expect(docBanNhap(KHOA12, 1), "hộp treo của #11 xoá bản nháp của #12").not.toBeNull();
  });
});

// L62: save() của instance ĐÃ GỠ chạy tiếp sau khi máy chủ trả lời: tắt cờ chặn rời trang của editor
// đang mở và (báo giá mới) kéo hash sang báo giá vừa tạo mà người dùng đã chọn bỏ.
describe("L62 — Lưu xong sau khi editor đã bị gỡ không được đụng trang đang mở", () => {
  it("báo giá MỚI: POST trả về sau khi đã sang #12 và gõ dở → hash giữ #/quotes/12, cờ bẩn của #12 còn", async () => {
    let xong!: (v: unknown) => void;
    h.createQuote.mockImplementationOnce(() => new Promise((r) => { xong = r; }));
    await moEditor(undefined, true);
    go(oTenKhach(), "Khách báo giá mới");
    await bam(nut("Lưu"));
    dongEditor();                                                   // "Rời, bỏ thay đổi" → Shell gỡ editor
    location.hash = "#/quotes/12";
    h.getQuote.mockImplementationOnce(async () => baoGia({ id: 12 }));
    await moEditor(12);
    go(oTenKhach(), "Đang sửa 12");
    expect((window as WinDirty).__editorDirty).toBe(true);
    await act(async () => { xong({ id: 99 }); });
    await cho(10);
    expect(location.hash, "instance đã gỡ kéo người dùng sang báo giá vừa tạo").toBe("#/quotes/12");
    expect((window as WinDirty).__editorDirty, "instance đã gỡ tắt cờ chặn rời trang của #12").toBe(true);
  });

  it("báo giá CŨ: PUT trả về sau khi đã sang #12 và gõ dở → cờ bẩn của #12 còn", async () => {
    let xong!: (v: unknown) => void;
    h.updateQuote.mockImplementationOnce(() => new Promise((r) => { xong = r; }));
    await moEditor();
    go(oTenKhach(), "Sửa 11");
    await bam(nut("Lưu"));
    dongEditor();
    h.getQuote.mockImplementationOnce(async () => baoGia({ id: 12 }));
    await moEditor(12);
    go(oTenKhach(), "Đang sửa 12");
    await act(async () => { xong(baoGia({ updatedAt: "2026-09-21T00:00:00.000Z" })); });
    await cho(10);
    expect((window as WinDirty).__editorDirty).toBe(true);
  });
});

// L63: xem thử quyền → api.req trả "thành công giả" cho mọi lệnh ghi, nhưng khoá bản nháp vẫn theo id
// admin THẬT. Lưu giả rồi xoá bản nháp thật; Hủy ở hộp Khôi phục xoá bản nháp thật; gõ thử ghi rác vào
// khoá thật và lần mở sau (hết xem thử) bị mời khôi phục đúng phần rác đó.
describe("L63 — chế độ Xem thử quyền không đọc / ghi / xoá bản nháp thật", () => {
  const KHOA = khoaBanNhap(11, 1);
  const nhapThat = () => ghiBanNhap(KHOA, baoGia({ toCompany: "Phần CHƯA LƯU thật" }), MOC_CU, 1);
  const tenTrongNhap = () => (docBanNhap(KHOA, 1)?.quote as { toCompany?: string } | undefined)?.toCompany;

  it("có bản nháp thật: vào xem thử, mở #11 → KHÔNG hỏi khôi phục; Lưu (giả) không xoá bản nháp thật", async () => {
    nhapThat();
    setPreviewMode(true);
    await moEditor();
    expect(ui.confirmModal).not.toHaveBeenCalledWith("Có thay đổi chưa lưu từ lần trước", expect.anything(), expect.anything());
    go(oTenKhach(), "gõ thử");
    await bam(nut("Lưu"));
    expect(tenTrongNhap(), "Lưu giả đã xoá bản nháp thật").toBe("Phần CHƯA LƯU thật");
  });

  it("Hủy hộp Khôi phục (nếu có hỏi) trong lúc xem thử không xoá bản nháp thật", async () => {
    nhapThat();
    setPreviewMode(true);
    (ui.confirmModal as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => false);
    await moEditor();
    expect(tenTrongNhap()).toBe("Phần CHƯA LƯU thật");
  });

  it("gõ thử lúc xem thử KHÔNG ghi vào khoá bản nháp thật (kể cả khi rời trang)", async () => {
    setPreviewMode(true);
    await moEditor();
    go(oTenKhach(), "gõ thử quyền — rác");
    await cho(1300);
    await act(async () => { window.dispatchEvent(new Event("pagehide")); });
    expect(docBanNhap(KHOA, 1), "phần gõ thử bị ghi vào bản nháp thật").toBeNull();
  });

  it("đối chứng: KHÔNG xem thử thì vẫn hỏi khôi phục bản nháp thật như cũ", async () => {
    nhapThat();
    await moEditor();
    expect(ui.confirmModal).toHaveBeenCalledWith("Có thay đổi chưa lưu từ lần trước", expect.any(String), expect.anything());
  });

  /** "✕ Thoát xem thử" của App: setPreviewMode(false) rồi setPreview(null) → Shell nhận `me` MỚI (bỏ bộ
   *  quyền xem thử) và vẽ lại editor TẠI CHỖ — cùng `key` route nên KHÔNG gắn lại. */
  async function thoatXemThu(quoteId: number | undefined = 11, isNew = false) {
    setPreviewMode(false);
    await act(async () => { root!.render(<QuoteEditorPage me={{ ...ME }} quoteId={quoteId} isNew={isNew} />); });
    await cho(10);
  }

  it("thoát xem thử ngay trên trình soạn → sửa THẬT sau đó vẫn có bản nháp cục bộ", async () => {
    setPreviewMode(true);
    await moEditor();
    await thoatXemThu();
    go(oTenKhach(), "Sửa thật sau xem thử");
    await cho(1300);
    expect(tenTrongNhap(), "thoát xem thử xong bản nháp vẫn tắt tới khi rời trang").toBe("Sửa thật sau xem thử");
  });

  it("bản nháp thật KHÔNG được hỏi lúc xem thử → thoát xem thử trên trình soạn thì được hỏi khôi phục (không bị sửa thật ghi đè im lặng)", async () => {
    nhapThat();
    setPreviewMode(true);
    await moEditor();
    go(oTenKhach(), "gõ thử quyền — rác");
    await thoatXemThu();
    expect(ui.confirmModal).toHaveBeenCalledWith("Có thay đổi chưa lưu từ lần trước", expect.any(String), expect.anything());
    expect(oTenKhach().value).toBe("Phần CHƯA LƯU thật");
  });

  it("báo giá MỚI dựng từ wizard lúc xem thử, thoát xem thử trên #/rnew → bản nháp 'moi' THẬT không bị nhánh 'đến từ wizard' xoá", async () => {
    const KHOA_MOI = khoaBanNhap("moi", 1);
    ghiBanNhap(KHOA_MOI, baoGia({ id: 0, _new: true, updatedAt: undefined, toCompany: "Báo giá mới CHƯA LƯU thật" }), null, 1);
    setPreviewMode(true);
    setPendingNewQuote(baoGia({ id: 0, _new: true, updatedAt: undefined, toCompany: "Khách chọn lúc xem thử" }) as never);
    await moEditor(undefined, true);
    expect(oTenKhach().value).toBe("Khách chọn lúc xem thử");
    await thoatXemThu(undefined, true);
    expect(docBanNhap(KHOA_MOI, 1), "thoát xem thử xoá bản nháp báo giá mới THẬT").not.toBeNull();
    expect(ui.confirmModal).toHaveBeenCalledWith("Có thay đổi chưa lưu từ lần trước", expect.any(String), expect.anything());
    expect(oTenKhach().value).toBe("Báo giá mới CHƯA LƯU thật");
  });
});

// L64: onChange của ô Template null hoá `days` MỌI dòng ngay khi chọn mẫu không ngày; chọn lại mẫu có
// ngày thì số Ngày đã mất, Thành tiền rơi từ 30 triệu về 10 triệu, lưới gắn lại nên Ctrl+Z không cứu.
describe("L64 — đổi mẫu qua lại không được xoá số Ngày", () => {
  const chonMau = (id: number) => act(() => {
    const sel = [...hop!.querySelectorAll(".sheet-meta label")].find((l) => l.textContent?.includes("Template"))!.querySelector("select") as HTMLSelectElement;
    sel.value = String(id); sel.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const oNgay = () => hop!.querySelector('.editor tr[data-row="0"] [data-f="days"]') as HTMLInputElement | null;
  const thanhTien = () => [...hop!.querySelectorAll(".sheet-total-box tr")].at(-1)!.textContent || "";

  it("có ngày (10 × 3 ngày × 1.000.000) → không ngày → có ngày: vẫn 3 ngày, 30.000.000", async () => {
    h.getQuote.mockImplementationOnce(async () => baoGia({ sheets: [trang(101, { templateId: 2, items: [{ kind: "item", name: "Sàn", unit: "m2", quantity: 10, days: 3, unitPrice: 1_000_000 }] })] }));
    await moEditor();
    expect(oNgay()!.value).toBe("3");
    expect(thanhTien()).toContain("30.000.000");
    chonMau(1);
    await cho(10);
    expect(oNgay()).toBeNull();                                     // mẫu không ngày: không có cột Ngày
    expect(thanhTien()).toContain("10.000.000");                    // và tiền không nhân ngày
    chonMau(2);
    await cho(10);
    expect(oNgay()!.value, "số Ngày bị xoá khi đổi mẫu qua lại").toBe("3");
    expect(thanhTien()).toContain("30.000.000");
  });

  it("Lưu khi đang ở mẫu KHÔNG ngày vẫn gửi days: null (máy chủ không nhận số Ngày cũ)", async () => {
    h.getQuote.mockImplementationOnce(async () => baoGia({ sheets: [trang(101, { templateId: 2, items: [{ kind: "item", name: "Sàn", unit: "m2", quantity: 10, days: 3, unitPrice: 1_000_000 }] })] }));
    await moEditor();
    chonMau(1);
    await cho(10);
    await bam(nut("Lưu"));
    const p = h.updateQuote.mock.calls.at(-1)![1] as { sheets: { templateId: number; items: { days: unknown }[] }[] };
    expect(p.sheets[0].templateId).toBe(1);
    expect(p.sheets[0].items[0].days).toBeNull();
  });

  // Đợt 3 — phần bảng nội bộ / Hà Nội: bước dọn `days` lúc VẼ (ExtraTables / HnTables) đã bỏ để đổi mẫu qua
  // lại không mất số Ngày. Máy chủ (extraTableSum, tổng đổ sang Quản lý dự án) nhân days bất kể mẫu, nên
  // Lưu PHẢI tự gửi days: null cho bảng dùng mẫu không ngày — cả bảng HN lẫn bảng nội bộ.
  it("Lưu: bảng HN và bảng nội bộ dùng mẫu KHÔNG ngày còn days cũ → gửi days: null; mẫu có ngày giữ days", async () => {
    const hangNgay = (over: Record<string, unknown> = {}) => ({ kind: "item", name: "Khung", unit: "bộ", quantity: 2, days: 3, unitPrice: 1000, rid: "x", ...over });
    h.getQuote.mockImplementationOnce(async () => baoGia({
      hnTables: [{ name: "HN không ngày", templateId: 1, groupSubtotal: false, items: [hangNgay({ rid: "h1" })] }, { name: "HN có ngày", templateId: 2, groupSubtotal: false, items: [hangNgay({ rid: "h2" })] }],
      sheets: [trang(101, { extraTables: [{ category: "hcm", name: "HCM", templateId: 1, groupSubtotal: false, items: [hangNgay({ rid: "e1", approved: true })] }, { category: "khach", name: "KH", templateId: 2, groupSubtotal: false, items: [hangNgay({ rid: "e2", approved: true })] }] })],
    }));
    await moEditor();
    go(oTenKhach(), "Khách MỚI");
    await bam(nut("Lưu"));
    const p = h.updateQuote.mock.calls.at(-1)![1] as { hnTables: { items: { days: unknown }[] }[]; sheets: { extraTables: { items: { days: unknown }[] }[] }[] };
    expect(p.hnTables.map((t) => t.items[0].days), "bảng HN").toEqual([null, 3]);
    expect(p.sheets[0].extraTables.map((t) => t.items[0].days), "bảng nội bộ").toEqual([null, 3]);
  });

  // Đợt 4: save() chọn mẫu cho bảng nội bộ bằng `templates.find(id === templateId)` KHÔNG dự phòng, còn lưới
  // (ExtraTables.tplOf) dự phòng về mẫu đầu của công ty. Bảng cũ thiếu templateId (hoặc trỏ mẫu đã ngừng dùng)
  // mà mẫu dự phòng CÓ ngày: lưới hiện cột Số Ngày và nhân ngày, Lưu lại xoá days → tiền rơi về một ngày.
  it("Lưu: bảng nội bộ THIẾU templateId / trỏ mẫu không còn, mẫu dự phòng CÓ ngày → giữ days như lưới đang hiện", async () => {
    const hang = (rid: string) => ({ kind: "item", name: "Khung", unit: "bộ", quantity: 2, days: 3, unitPrice: 1000, rid, approved: true });
    h.getQuote.mockImplementationOnce(async () => baoGia({ companyId: 8, sheets: [trang(101, { templateId: 3, extraTables: [
      { category: "hcm", name: "HCM", groupSubtotal: false, items: [hang("e1")] },
      { category: "khach", name: "KH", templateId: 99, groupSubtotal: false, items: [hang("e2")] },
    ] })] }));
    await moEditor();
    go(oTenKhach(), "Khách MỚI");
    await bam(nut("Lưu"));
    const p = h.updateQuote.mock.calls.at(-1)![1] as { sheets: { extraTables: { items: { days: unknown }[] }[] }[] };
    expect(p.sheets[0].extraTables.map((t) => t.items[0].days), "Lưu xoá số Ngày mà lưới đang hiện và nhân").toEqual([3, 3]);
  });

  it("phần HN đã chốt mà người mở KHÔNG quản phần HN → Lưu gửi bảng HN NGUYÊN VĂN (máy chủ so với CSDL — dọn days là 409 cả lần Lưu)", async () => {
    h.getQuote.mockImplementationOnce(async () => baoGia({ hnStatus: "submitted", hnTables: [{ name: "HN không ngày", templateId: 1, groupSubtotal: false, items: [{ kind: "item", name: "Khung", unit: "bộ", quantity: 2, days: 3, unitPrice: 1000, rid: "h1" }] }] }));
    hop = document.createElement("div"); document.body.appendChild(hop);
    root = createRoot(hop);
    const khongQuanHn = { ...ME, permissions: ME.permissions.filter((x) => x !== "quote:hn:manage") };
    await act(async () => { root!.render(<QuoteEditorPage me={khongQuanHn} quoteId={11} isNew={false} />); });
    await cho(10);
    go(oTenKhach(), "Khách MỚI");
    await bam(nut("Lưu"));
    const p = h.updateQuote.mock.calls.at(-1)![1] as { hnTables: { items: { days: unknown }[] }[] };
    expect(p.hnTables[0].items[0].days).toBe(3);
  });
});

// X2: hộp thanh toán (route /pay bump updatedAt) gọi onQuoteTouched(mốc MỚI) và editor nhận thẳng mốc đó.
// Người khác đã lưu chen vào giữa lần nạp và cú tích thanh toán thì mốc mới đã bao lượt lưu của họ —
// nhận là vô hiệu khoá lạc quan, lần Lưu kế ĐÈ IM LẶNG bản người kia. Cùng dạng app#11 (napLaiSauHn).
describe("X2 — nhận mốc updatedAt sau khi tích thanh toán chỉ khi không ai khác lưu chen", () => {
  const MOC_TT = "2026-09-21T08:00:00.000Z";
  const hnCo = (over: Record<string, unknown> = {}) => [{ name: "HN", templateId: 1, groupSubtotal: false, items: [{ kind: "item", name: "Khung", unit: "cái", quantity: 1, unitPrice: 5000, rid: "r1", ...over }] }];
  async function tichThanhToan() {
    (api.markHnPay as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => ({ ok: true, rid: "r1", paid: true, updatedAt: MOC_TT }));
    await bam(hop!.querySelector('button[data-xl="thanh-toan"]') as HTMLButtonElement);
    act(() => { (hop!.querySelector(".modal input[type=checkbox]") as HTMLInputElement).click(); });
    await bam(hop!.querySelector(".modal .btn-primary") as HTMLButtonElement);
    await cho(10);
  }
  async function luuRoiDocMoc() {
    go(oTenKhach(), "Khách MỚI");
    await bam(nut("Lưu"));
    return (h.updateQuote.mock.calls.at(-1)![1] as Record<string, unknown>).baseUpdatedAt;
  }

  it("người khác đã lưu phần chính (id trang đổi) trước cú tích → lần Lưu kế vẫn gửi mốc CŨ (để nhận 409)", async () => {
    h.getQuote.mockImplementationOnce(async () => baoGia({ hnTables: hnCo() }));
    await moEditor();
    h.getQuote.mockImplementation(async () => baoGia({ hnTables: hnCo({ paid: true }), updatedAt: MOC_TT, sheets: [trang(202)] }));
    await tichThanhToan();
    expect(api.markHnPay).toHaveBeenCalled();
    expect(await luuRoiDocMoc()).toBe(MOC_CU);
  });

  it("account HN đã lưu bảng Hà Nội chen vào → vẫn gửi mốc CŨ", async () => {
    h.getQuote.mockImplementationOnce(async () => baoGia({ hnTables: hnCo() }));
    await moEditor();
    h.getQuote.mockImplementation(async () => baoGia({ hnTables: hnCo({ paid: true, unitPrice: 9000 }), updatedAt: MOC_TT }));
    await tichThanhToan();
    expect(await luuRoiDocMoc()).toBe(MOC_CU);
  });

  it("đối chứng: không ai khác lưu (chỉ thanh toán đổi) → nhận mốc MỚI, không tự đâm 409", async () => {
    h.getQuote.mockImplementationOnce(async () => baoGia({ hnTables: hnCo() }));
    await moEditor();
    h.getQuote.mockImplementation(async () => baoGia({ hnTables: hnCo({ paid: true, paidAt: MOC_TT, paidById: 1 }), updatedAt: MOC_TT }));
    await tichThanhToan();
    expect(await luuRoiDocMoc()).toBe(MOC_TT);
  });

  // Đợt 3 — kẽ hở X2: vanTayMain không gồm extraTables. Account phụ (phạm vi riêng) lưu bảng nội bộ đi qua
  // ghiVungNoiBoDuocGiao: chỉ ghi extraTables, GIỮ id trang, bump updatedAt → cả hai vân tay vẫn trùng và
  // mốc mới (tích thanh toán đến sau) nuốt luôn lượt lưu của người kia.
  const noiBo = (over: Record<string, unknown> = {}) => [{ category: "hcm", name: "HCM", templateId: 1, groupSubtotal: false, items: [{ kind: "item", name: "Xe", unit: "chuyến", quantity: 1, unitPrice: 1000, rid: "e1", approved: true, paid: false, hasPaidProof: false, ...over }] }];
  it("account phụ lưu bảng nội bộ chen vào (id trang giữ nguyên, chỉ extraTables đổi) → vẫn gửi mốc CŨ", async () => {
    h.getQuote.mockImplementationOnce(async () => baoGia({ hnTables: hnCo(), sheets: [trang(101, { extraTables: noiBo() })] }));
    await moEditor();
    h.getQuote.mockImplementation(async () => baoGia({ hnTables: hnCo({ paid: true }), updatedAt: MOC_TT, sheets: [trang(101, { extraTables: noiBo({ unitPrice: 9000 }) })] }));
    await tichThanhToan();
    expect(await luuRoiDocMoc(), "mốc mới nuốt lượt lưu bảng nội bộ của account phụ").toBe(MOC_CU);
  });

  it("đối chứng: bảng nội bộ chỉ đổi trường THANH TOÁN (paid / paidAt / paidById / hasPaidProof) → nhận mốc MỚI", async () => {
    h.getQuote.mockImplementationOnce(async () => baoGia({ hnTables: hnCo(), sheets: [trang(101, { extraTables: noiBo() })] }));
    await moEditor();
    h.getQuote.mockImplementation(async () => baoGia({ hnTables: hnCo({ paid: true }), updatedAt: MOC_TT, sheets: [trang(101, { extraTables: noiBo({ paid: true, paidAt: MOC_TT, paidById: 3, hasPaidProof: true }) })] }));
    await tichThanhToan();
    expect(await luuRoiDocMoc()).toBe(MOC_TT);
  });

  // Báo giá CŨ lưu quoteDate là thời điểm đầy đủ (excel#10): đường nạp đổi nó sang ngày VN (+7h, qua ngày
  // khi ≥17:00 UTC). Vân tay lúc nạp mà tính SAU bước đó thì ra 14/06, còn bản GET kiểm tra cắt ra 13/06 →
  // lần nào cũng tưởng người khác đã lưu, không nhận mốc, lần Lưu kế tự đâm 409.
  it("báo giá cũ có quoteDate là mốc giờ ≥17:00 UTC, chỉ thanh toán đổi → vẫn nhận mốc MỚI", async () => {
    const NGAY_CU = "2026-06-13T20:00:00.000Z";
    h.getQuote.mockImplementationOnce(async () => baoGia({ hnTables: hnCo(), quoteDate: NGAY_CU }));
    await moEditor();
    h.getQuote.mockImplementation(async () => baoGia({ hnTables: hnCo({ paid: true, paidAt: MOC_TT, paidById: 1 }), updatedAt: MOC_TT, quoteDate: NGAY_CU }));
    await tichThanhToan();
    expect(await luuRoiDocMoc(), "quoteDate cũ làm vân tay lúc nạp lệch bản GET → 409 giả").toBe(MOC_TT);
  });

  afterEach(() => { h.getQuote.mockReset(); h.getQuote.mockImplementation(async () => baoGia()); });
});
