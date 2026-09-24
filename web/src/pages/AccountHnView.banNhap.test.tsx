/** @vitest-environment jsdom */
//
// GRID-16 / FE-13: màn Account Hà Nội (nơi gõ giá hàng loạt) không có bản nháp cục bộ — tab sập hay
// mất điện là mất trắng; 409 chỉ là một toast. Cùng khuôn giàn dựng với AccountHnView.tongdongbo.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

// Mẫu 2 (không ngày) để kiểm L64 — mẫu mặc định (đầu danh sách) vẫn là mẫu 1 như các bài cũ.
const MAU = [{ id: 1, code: "gn", name: "GN (có ngày)", companyId: 7, layout: { hasDays: true } }, { id: 2, code: "gnk", name: "GN (không ngày)", companyId: 7, layout: { hasDays: false } }];
const baoGia = (over: Record<string, unknown> = {}) => ({
  id: 11, quoteNumber: "GN26D011", title: "Giao HN", companyId: 7, hnStatus: "assigned",
  updatedAt: "2026-09-16T00:00:00.000Z", hnRev: "a".repeat(32),
  hnTables: [{ name: "Giá thuê HN", templateId: 1, groupSubtotal: true, items: [{ kind: "item", name: "Khung backdrop", quantity: 1, unitPrice: 5_000_000, days: 1 }] }],
  ...over,
});
const h = vi.hoisted(() => ({ getQuote: null as unknown as () => Promise<unknown>, saveHn: null as unknown as () => Promise<unknown>, confirm: true }));
vi.mock("../lib/api", async (goc) => {
  const that = await goc<typeof import("../lib/api")>();
  return { ...that, api: { ...that.api, metaTemplates: vi.fn(async () => MAU), getQuote: vi.fn(() => h.getQuote()), saveHn: vi.fn(() => h.saveHn()), submitHn: vi.fn(async () => ({})) } };
});
vi.mock("../lib/ui", async (goc) => ({ ...(await goc<typeof import("../lib/ui")>()), toast: vi.fn(), confirmModal: vi.fn(async () => h.confirm) }));
vi.mock("../lib/venueCatalog", async (goc) => ({ ...(await goc<typeof import("../lib/venueCatalog")>()), loadCatalog: () => Promise.resolve({ entries: [], venues: [] }) }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { AccountHnView } from "./AccountHnView";
import { ApiError, api, setPreviewMode } from "../lib/api";
import { khoaBanNhap, docBanNhap, ghiBanNhap } from "../lib/localDraft";
import * as ui from "../lib/ui";

let root: Root | null = null;
let host: HTMLDivElement | null = null;
const cho = async (ms = 0) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
async function mo() {
  host = document.createElement("div"); document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(<AccountHnView quoteId={11} meId={5} />); });
  await cho(20);
}
/** Gõ đơn giá dòng đầu của bảng HN — đi đúng đường onNumInput của lưới thật. */
function goGia(v: string) {
  const o = host!.querySelector('tr[data-row="0"] [data-f="unitPrice"]') as HTMLInputElement;
  act(() => { o.focus(); o.value = v; o.dispatchEvent(new Event("input", { bubbles: true })); });
}
const KHOA = khoaBanNhap("hn11", 5);
const giaTrongNhap = (k: string) => ((docBanNhap(k, 5)?.quote as { hnTables?: { items: { unitPrice: number }[] }[] } | undefined)?.hnTables?.[0]?.items?.[0]?.unitPrice);

beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); h.confirm = true; h.getQuote = async () => baoGia(); h.saveHn = async () => ({}); });
afterEach(async () => { await cho(1300); if (root) act(() => root!.unmount()); root = null; host?.remove(); document.body.innerHTML = ""; });

describe("GRID-16 / FE-13 — bản nháp cục bộ cho màn Account Hà Nội", () => {
  it("gõ giá rồi rời trang (pagehide) TRƯỚC hẹn giờ 1,2s → bản nháp đã có", async () => {
    await mo();
    goGia("6000000");
    // Lưới báo "đã đổi" sau nhịp vẽ-hoãn 180ms của nó (trình duyệt thật còn blur ô khi rời tab).
    await cho(250);
    expect(docBanNhap(KHOA, 5)).toBeNull();                        // chưa tới hẹn giờ 1,2s
    await act(async () => { window.dispatchEvent(new Event("pagehide")); });
    expect(giaTrongNhap(KHOA)).toBe(6_000_000);
  });

  it("mở lại (cùng hnRev) → hỏi khôi phục, chọn khôi phục thì thấy giá chưa lưu", async () => {
    ghiBanNhap(KHOA, { hnTables: [{ ...baoGia().hnTables[0], items: [{ kind: "item", name: "Khung backdrop", quantity: 1, unitPrice: 7_700_000, days: 1 }] }] }, "a".repeat(32), 5);
    await mo();
    expect(ui.confirmModal).toHaveBeenCalledWith("Có giá Hà Nội chưa lưu từ lần trước", expect.any(String), expect.anything());
    expect(host!.textContent).toContain("7.700.000");
  });

  it("Lưu thành công → xoá bản nháp", async () => {
    await mo();
    goGia("6000000");
    await cho(1600);                                               // 180ms vẽ-hoãn + 1,2s hẹn giờ
    expect(docBanNhap(KHOA, 5)).not.toBeNull();
    const nut = [...host!.querySelectorAll("button")].find((b) => /Lưu/.test(b.textContent || "") && !/Gửi/.test(b.textContent || ""))!;
    await act(async () => { nut.click(); });
    await cho(20);
    expect(docBanNhap(KHOA, 5)).toBeNull();
  });

  it("409 → Tải lại: phần đang gõ được giữ; nạp lại thì hỏi mở bản của tôi", async () => {
    await mo();
    goGia("6000000");
    h.saveHn = async () => { throw new ApiError("Phần Hà Nội vừa được lưu ở nơi khác", 409, null); };
    h.getQuote = async () => baoGia({ hnRev: "b".repeat(32) });
    const nut = [...host!.querySelectorAll("button")].find((b) => /Lưu/.test(b.textContent || "") && !/Gửi/.test(b.textContent || ""))!;
    await act(async () => { nut.click(); });
    await cho(30);
    expect(ui.confirmModal).toHaveBeenCalledWith("Giá Hà Nội bạn gõ trước khi bị xung đột", expect.any(String), expect.anything());
    expect(host!.textContent).toContain("6.000.000");
  });
});

// Soát chéo app#12 (B), app#15, app#17 — cùng màn Account Hà Nội.
const nutLuu = () => [...host!.querySelectorAll("button")].find((b) => /Lưu/.test(b.textContent || "") && !/Gửi/.test(b.textContent || ""))!;
describe("soát chéo — màn Account Hà Nội", () => {
  it("app#12: 409 mà không ghi được bản giữ lại (bộ nhớ đầy) → KHÔNG tải lại, phần đang gõ còn nguyên, báo phải chép tay", async () => {
    await mo();
    goGia("6000000");
    await cho(250);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("đầy", "QuotaExceededError"); });
    h.saveHn = async () => { throw new ApiError("Phần Hà Nội vừa được lưu ở nơi khác", 409, null); };
    h.getQuote = async () => baoGia({ hnRev: "b".repeat(32) });
    const soLanTai = (api.getQuote as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
    await act(async () => { nutLuu().click(); });
    await cho(30);
    vi.restoreAllMocks();
    expect((api.getQuote as unknown as ReturnType<typeof vi.fn>).mock.calls.length, "không được tải lại").toBe(soLanTai);
    expect(host!.textContent).toContain("6.000.000");
    const loi = (ui.toast as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0])).join(" | ");
    expect(loi).toMatch(/chép/);
    expect(ui.confirmModal).not.toHaveBeenCalledWith("Phần Hà Nội đã thay đổi ở nơi khác", expect.stringMatching(/GIỮ LẠI/), expect.anything());
  });

  it("app#12: 409 rồi Hủy → không để lại khoá ':xungdot'", async () => {
    await mo();
    goGia("6000000");
    await cho(250);
    h.saveHn = async () => { throw new ApiError("Phần Hà Nội vừa được lưu ở nơi khác", 409, null); };
    h.confirm = false;
    await act(async () => { nutLuu().click(); });
    await cho(30);
    expect(docBanNhap(KHOA + ":xungdot", 5)).toBeNull();
    expect(host!.textContent).toContain("6.000.000");
  });

  it("app#15: trong lúc Lưu đang chờ máy chủ → nút 'Nhập từ Excel' bị khoá", async () => {
    await mo();
    goGia("6000000");
    await cho(250);
    let xong!: () => void;
    h.saveHn = () => new Promise((r) => { xong = () => r({}); });
    await act(async () => { nutLuu().click(); });
    await cho(10);
    const nhap = [...host!.querySelectorAll("button")].find((b) => /Nhập từ Excel/.test(b.textContent || "")) as HTMLButtonElement;
    expect(nhap.disabled).toBe(true);
    await act(async () => { xong(); });
    await cho(30);
  });

  it("app#17: chọn 'Rời, bỏ thay đổi' (editor:discard) → bản nháp HN bị xoá, không ghi lại khi pagehide", async () => {
    await mo();
    goGia("6000000");
    await cho(1600);
    expect(docBanNhap(KHOA, 5)).not.toBeNull();
    await act(async () => { window.dispatchEvent(new Event("editor:discard")); });
    expect(docBanNhap(KHOA, 5)).toBeNull();
    await act(async () => { window.dispatchEvent(new Event("pagehide")); });
    expect(docBanNhap(KHOA, 5)).toBeNull();
  });
});

// Soát toàn diện L58 + X1 — hộp hỏi ở đường nạp của màn Account Hà Nội.
describe("soát toàn diện — hộp hỏi ở đường nạp (Account Hà Nội)", () => {
  const confirmMock = () => ui.confirmModal as unknown as ReturnType<typeof vi.fn>;
  // clearAllMocks KHÔNG xoá hàng đợi mockImplementationOnce — bài trước dùng thiếu thì dư sang bài sau.
  beforeEach(() => { confirmMock().mockReset(); confirmMock().mockImplementation(async () => h.confirm); });
  const KHOA12 = khoaBanNhap("hn12", 5);
  const nhap12 = () => ghiBanNhap(KHOA12, { hnTables: [{ ...baoGia().hnTables[0], items: [{ kind: "item", name: "Khung backdrop", quantity: 1, unitPrice: 9_900_000, days: 1 }] }] }, "a".repeat(32), 5);
  /** Mở #12 (hộp "Khôi phục?" treo), rồi Back → Shell gỡ view #12, dựng #11 sạch phía sau hộp. */
  async function hopTreoCua12() {
    nhap12();
    let traLoi!: (v: boolean) => void;
    confirmMock().mockImplementationOnce(() => new Promise<boolean>((r) => { traLoi = r; }));
    h.getQuote = async () => baoGia({ id: 12 });
    host = document.createElement("div"); document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => { root!.render(<AccountHnView quoteId={12} meId={5} />); });
    await cho(20);
    expect(confirmMock()).toHaveBeenCalledWith("Có giá Hà Nội chưa lưu từ lần trước", expect.any(String), expect.anything());
    act(() => root!.unmount()); host.remove();
    h.getQuote = async () => baoGia();
    (window as Window & { __editorDirty?: boolean }).__editorDirty = false;
    await mo();
    return async (v: boolean) => { await act(async () => { traLoi(v); }); await cho(20); };
  }

  it("L58: hộp 'Khôi phục?' của #12 còn treo khi đã sang #11 — bấm Hủy KHÔNG xoá bản nháp giá HN của #12", async () => {
    const traLoi = await hopTreoCua12();
    await traLoi(false);
    expect(giaTrongNhap(KHOA12), "giá HN chưa lưu của #12 bị hộp treo xoá").toBe(9_900_000);
  });

  // Đợt 3 (cùng họ L58/L61): hộp "Gửi duyệt phần Hà Nội" cũng không tự đóng khi Back. Xác nhận nó sau khi
  // view #12 đã gỡ từng Lưu + GỬI DUYỆT báo giá CŨ (account không tự rút lại được) và hạ cờ bẩn của #11.
  it("hộp 'Gửi duyệt' của #12 còn treo khi đã sang #11 — xác nhận KHÔNG lưu, KHÔNG gửi duyệt #12", async () => {
    let traLoi!: (v: boolean) => void;
    h.getQuote = async () => baoGia({ id: 12 });
    await mo();
    confirmMock().mockImplementationOnce(() => new Promise<boolean>((r) => { traLoi = r; }));
    const nutGui = [...host!.querySelectorAll("button")].find((b) => /Gửi duyệt/.test(b.textContent || ""))!;
    await act(async () => { nutGui.click(); });
    expect(confirmMock()).toHaveBeenCalledWith("Gửi duyệt phần Hà Nội", expect.any(String), expect.anything());
    act(() => root!.unmount()); host!.remove();
    h.getQuote = async () => baoGia();
    await mo();
    (window as Window & { __editorDirty?: boolean }).__editorDirty = true;   // #11 đang có thay đổi chưa lưu
    await act(async () => { traLoi(true); });
    await cho(30);
    expect(api.saveHn, "hộp treo lưu phần HN của báo giá đã rời").not.toHaveBeenCalled();
    expect(api.submitHn, "hộp treo gửi duyệt báo giá đã rời").not.toHaveBeenCalled();
    expect((window as Window & { __editorDirty?: boolean }).__editorDirty, "cờ bẩn của #11 bị hạ").toBe(true);
  });

  // Đợt 3 (L61 phần component con): hộp "Xóa nhiều hàng" của lưới HN gọi ngược mark() của view. View đã gỡ
  // mà mark() vẫn chạy thì bật cờ `__editorDirty` DÙNG CHUNG của #11 và hẹn giờ ghi bản nháp giá HN #12.
  it("'Xóa nhiều hàng' trong lưới HN #12 còn treo khi đã sang #11: xác nhận KHÔNG bật cờ của #11, KHÔNG ghi bản nháp #12", async () => {
    let traLoi!: (v: boolean) => void;
    const hai = [{ kind: "item", name: "Khung backdrop", quantity: 1, unitPrice: 5_000_000, days: 1 }, { kind: "item", name: "Bạt", quantity: 1, unitPrice: 1_000_000, days: 1 }];
    h.getQuote = async () => baoGia({ id: 12, hnTables: [{ ...baoGia().hnTables[0], items: hai }] });
    await mo();
    confirmMock().mockImplementationOnce(() => new Promise<boolean>((r) => { traLoi = r; }));
    const phim = (init: KeyboardEventInit) => act(() => { document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init })); });
    act(() => { (host!.querySelector('tr[data-row="0"] [data-f="name"]') as HTMLElement).focus(); });
    phim({ key: "ArrowDown", shiftKey: true });
    phim({ key: " ", code: "Space", shiftKey: true });
    phim({ key: "-", ctrlKey: true });
    expect(confirmMock()).toHaveBeenCalledWith("Xóa nhiều hàng", expect.any(String), expect.anything());
    act(() => root!.unmount()); host!.remove();
    h.getQuote = async () => baoGia();
    await mo();
    (window as Window & { __editorDirty?: boolean }).__editorDirty = false;
    await act(async () => { traLoi(true); });
    await cho(1300);
    expect((window as Window & { __editorDirty?: boolean }).__editorDirty, "hộp treo của #12 bật cờ chặn rời trang trên #11").toBe(false);
    expect(docBanNhap(KHOA12, 5), "hộp treo của #12 ghi bản nháp giá HN #12 sau khi view đã gỡ").toBeNull();
  });

  it("đối chứng: view còn gắn, xác nhận 'Gửi duyệt' → lưu rồi gửi duyệt đúng báo giá đang mở", async () => {
    await mo();
    const nutGui = [...host!.querySelectorAll("button")].find((b) => /Gửi duyệt/.test(b.textContent || ""))!;
    await act(async () => { nutGui.click(); });
    await cho(30);
    expect((api.saveHn as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    expect(api.submitHn).toHaveBeenCalledWith(11);
  });

  it("L58: bấm Khôi phục trên hộp treo KHÔNG bật cờ 'chưa lưu' của trang #11 đang sạch", async () => {
    const traLoi = await hopTreoCua12();
    await traLoi(true);
    expect((window as Window & { __editorDirty?: boolean }).__editorDirty).toBe(false);
  });

  // X1 (cùng dạng app#13 bên QuoteEditor): tiêu điểm mặc định của hộp danger ở "Hủy" — Enter theo phản
  // xạ, Esc, bấm ra ngoài đều về Hủy, và nhánh đó từng XOÁ VĨNH VIỄN bản giữ lại lúc 409.
  const coXd = () => docBanNhap(KHOA + ":xungdot", 5) != null;
  const ghiXd = () => ghiBanNhap(KHOA + ":xungdot", { hnTables: [{ ...baoGia().hnTables[0], items: [{ kind: "item", name: "Khung backdrop", quantity: 1, unitPrice: 6_600_000, days: 1 }] }] }, "a".repeat(32), 5);

  it("X1: Hủy ở hộp 'Mở bản của tôi', rồi Hủy ở hộp 'Bỏ bản của bạn?' → bản giữ lại còn nguyên", async () => {
    ghiXd();
    confirmMock().mockImplementationOnce(async () => false).mockImplementationOnce(async () => false);
    await mo();
    expect(coXd(), "Hủy ở hộp mở lại đã xoá vĩnh viễn bản giữ lại").toBe(true);
    expect(host!.textContent).toContain("5.000.000");
  });

  it("X1: Hủy rồi xác nhận 'Xoá bản này' → bản giữ lại bị xoá", async () => {
    ghiXd();
    confirmMock().mockImplementationOnce(async () => false).mockImplementationOnce(async () => true);
    await mo();
    expect(confirmMock().mock.calls.map((c) => c[0])).toContain("Bỏ bản của bạn?");
    expect(coXd()).toBe(false);
  });

  it("X1: Mở bản của tôi → thấy giá đã giữ, khoá ':xungdot' bị xoá (bản nháp thường tiếp quản)", async () => {
    ghiXd();
    await mo();
    expect(host!.textContent).toContain("6.600.000");
    expect(coXd()).toBe(false);
  });

  it("X1: hộp 'Mở bản của tôi' treo rồi rời trang — trả lời hộp treo không xoá bản giữ lại", async () => {
    ghiXd();
    let traLoi!: (v: boolean) => void;
    confirmMock().mockImplementationOnce(() => new Promise<boolean>((r) => { traLoi = r; }));
    await mo();
    act(() => root!.unmount()); root = null; host?.remove();
    await act(async () => { traLoi(true); });
    await cho(20);
    expect(coXd()).toBe(true);
  });

  // X1 (hồi quy của chính bản sửa trên): bản giữ lại nay SỐNG qua nhiều phiên, mà đường nạp từng hỏi nó
  // TRƯỚC và `else if` chặn luôn bản nháp THƯỜNG — phần gõ mới hơn (mốc hnRev KHỚP máy chủ) không bao giờ
  // được đề nghị, và phím gõ đầu tiên của phiên sau ghi đè mất nó. Phiên 1 giữ bản ':xungdot', gõ 8.800.000
  // rồi rời trang; phiên 2 mở lại.
  async function phien1GiuXdRoiGo() {
    ghiXd();
    confirmMock().mockImplementationOnce(async () => false).mockImplementationOnce(async () => false);   // Hủy, Hủy → giữ
    await mo();
    goGia("8800000");
    await cho(250);
    await act(async () => { window.dispatchEvent(new Event("pagehide")); });
    act(() => root!.unmount()); root = null; host?.remove();
    expect(giaTrongNhap(KHOA)).toBe(8_800_000);
    expect(coXd()).toBe(true);
    confirmMock().mockClear();
  }

  it("X1: còn giữ bản ':xungdot' mà có bản nháp thường mới hơn (mốc khớp) → vẫn hỏi khôi phục bản nháp thường", async () => {
    await phien1GiuXdRoiGo();
    await mo();                                                      // h.confirm = true → Khôi phục
    expect(confirmMock().mock.calls.map((c) => c[0])[0], "bản nháp thường bị bản giữ lại che mất").toBe("Có giá Hà Nội chưa lưu từ lần trước");
    expect(host!.textContent).toContain("8.800.000");
    expect(coXd(), "đã khôi phục bản nháp thường thì chưa đụng tới bản giữ lại").toBe(true);
  });

  it("X1: Hủy bản nháp thường (đồng bộ QuoteEditor: nó bị bỏ) → mới hỏi tới bản ':xungdot'", async () => {
    await phien1GiuXdRoiGo();
    confirmMock().mockImplementationOnce(async () => false);          // Hủy bản nháp thường
    await mo();                                                      // rồi "Mở bản của tôi"
    expect(confirmMock().mock.calls.map((c) => c[0])).toEqual(["Có giá Hà Nội chưa lưu từ lần trước", "Giá Hà Nội bạn gõ trước khi bị xung đột"]);
    expect(host!.textContent).toContain("6.600.000");
  });

  // Đợt 3 X1 (hồi quy của chính bản sửa X1): Hủy không còn xoá bản giữ lại, mà save() nạp lại qua
  // load() — đường nạp hỏi bản ':xungdot' ở MỌI lượt → sau mỗi lần Lưu lại bật hai hộp danger. Lỡ bấm
  // "Mở bản của tôi" ngay sau Lưu là giá VỪA LƯU bị thay bằng giá cũ lúc xung đột, cờ bẩn bật.
  it("X1 đợt 3: giữ bản ':xungdot' (Hủy, Hủy) rồi Lưu hai lần → KHÔNG hỏi lại hộp nào, bản giữ lại vẫn còn", async () => {
    ghiXd();
    h.confirm = false;                                               // Hủy, Hủy → giữ
    await mo();
    expect(confirmMock().mock.calls.map((c) => c[0])).toEqual(["Giá Hà Nội bạn gõ trước khi bị xung đột", "Bỏ bản của bạn?"]);
    confirmMock().mockClear();
    goGia("7000000");
    await cho(250);
    await act(async () => { nutLuu().click(); });
    await cho(30);
    expect(confirmMock().mock.calls.map((c) => c[0]), "Lưu lần 1 bật lại hộp hỏi bản ':xungdot'").toEqual([]);
    await act(async () => { nutLuu().click(); });
    await cho(30);
    expect(confirmMock().mock.calls.map((c) => c[0]), "Lưu lần 2 bật lại hộp hỏi bản ':xungdot'").toEqual([]);
    expect(coXd(), "bản giữ lại vẫn phải còn — lần MỞ sau hỏi tiếp").toBe(true);
  });

  it("X1 đợt 3: Lưu xong, dù hộp (nếu có) được trả lời 'Mở bản của tôi' → màn vẫn là giá vừa lưu, không bẩn", async () => {
    ghiXd();
    confirmMock().mockImplementationOnce(async () => false).mockImplementationOnce(async () => false);   // lúc mở: Hủy, Hủy
    await mo();
    goGia("7000000");
    await cho(250);
    h.getQuote = async () => baoGia({ hnRev: "c".repeat(32), hnTables: [{ ...baoGia().hnTables[0], items: [{ kind: "item", name: "Khung backdrop", quantity: 1, unitPrice: 7_000_000, days: 1 }] }] });
    await act(async () => { nutLuu().click(); });                   // h.confirm = true → "Mở bản của tôi"
    await cho(30);
    expect(host!.textContent).toContain("7.000.000");
    expect(host!.textContent, "giá cũ lúc xung đột đè lên giá vừa lưu").not.toContain("6.600.000");
    expect((window as Window & { __editorDirty?: boolean }).__editorDirty).toBe(false);
  });

  // Đợt 4: bản ':xungdot' đã GIỮ (Hủy, Hủy) bị nhánh 409 lần hai ghi đè im lặng — cùng khoá; Hủy ở hộp 409 còn
  // xoá luôn bản mới → mất trắng phần giá gõ trước xung đột đầu.
  async function giuXdRoi409LanHai() {
    ghiXd();                                                         // bản đã giữ: 6.600.000
    confirmMock().mockImplementationOnce(async () => false).mockImplementationOnce(async () => false);   // lúc mở: Hủy, Hủy → giữ
    await mo();
    confirmMock().mockClear();
    goGia("7000000");
    await cho(250);
    h.saveHn = async () => { throw new ApiError("Phần Hà Nội vừa được lưu ở nơi khác", 409, null); };
  }

  it("đợt 4: 409 lần hai, giữ bản cũ (Hủy ở hộp hỏi thay) → bản đã giữ còn NGUYÊN, không tải lại, phần đang gõ còn trên màn", async () => {
    await giuXdRoi409LanHai();
    h.confirm = false;                                               // Hủy ở mọi hộp
    await act(async () => { nutLuu().click(); });
    await cho(30);
    expect(giaTrongNhap(KHOA + ":xungdot"), "bản đã giữ bị đè / bị xoá").toBe(6_600_000);
    expect(confirmMock().mock.calls.map((c) => c[0])).toEqual(["Đã có một bản giữ lại từ lần xung đột trước"]);
    expect(host!.textContent).toContain("7.000.000");
    expect((ui.toast as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0])).join(" | ")).toMatch(/chép/);
  });

  it("đợt 4: 409 lần hai, chọn 'Thay bằng bản đang gõ' → hỏi tải lại; bản giữ lại là giá đang gõ", async () => {
    await giuXdRoi409LanHai();
    h.confirm = false;                                               // sau đó: Hủy "Mở bản của tôi", Hủy "Bỏ bản?" → giữ
    confirmMock().mockImplementationOnce(async () => true).mockImplementationOnce(async () => true);    // Thay, Tải lại
    await act(async () => { nutLuu().click(); });
    await cho(30);
    expect(confirmMock().mock.calls.map((c) => c[0]).slice(0, 2)).toEqual(["Đã có một bản giữ lại từ lần xung đột trước", "Phần Hà Nội đã thay đổi ở nơi khác"]);
    expect(giaTrongNhap(KHOA + ":xungdot")).toBe(7_000_000);
  });

  it("X1 đợt 3: đã khôi phục bản nháp thường (bản ':xungdot' chưa hỏi) → Lưu KHÔNG hỏi bản ':xungdot' giữa chừng", async () => {
    await phien1GiuXdRoiGo();
    await mo();                                                      // Khôi phục bản nháp thường
    confirmMock().mockClear();
    await act(async () => { nutLuu().click(); });
    await cho(30);
    expect(confirmMock().mock.calls.map((c) => c[0])).toEqual([]);
    expect(coXd(), "lần mở sau hỏi tiếp").toBe(true);
  });
});

// Đợt 4 (họ L62 bên QuoteEditor): save() không kiểm view còn gắn sau `await api.saveHn(...)`. Back khi PUT đang
// bay → "Rời, bỏ thay đổi" → view gỡ; máy chủ trả lời sau đó thì instance đã gỡ hạ cờ `__editorDirty` DÙNG
// CHUNG của trang đang mở (mất lời nhắc chưa lưu ở đó), gửi duyệt tiếp, hoặc bật hộp 409 lên trang khác.
describe("L62 — Lưu phần HN xong sau khi view đã gỡ không được đụng trang đang mở", () => {
  const WD = window as Window & { __editorDirty?: boolean };
  async function luuTreoRoiRoiTrang(ketQua: () => Promise<unknown>, nut: () => HTMLButtonElement = nutLuu) {
    await mo();
    goGia("6000000");
    await cho(1600);                                                // bản nháp #11 đã ghi
    expect(docBanNhap(KHOA, 5)).not.toBeNull();
    let xong!: () => void;
    h.saveHn = () => new Promise((r, loi) => { xong = () => { ketQua().then(r, loi); }; });
    await act(async () => { nut().click(); });
    await cho(10);
    act(() => root!.unmount()); root = null; host?.remove();         // "Rời, bỏ thay đổi" → Shell gỡ view
    WD.__editorDirty = true;                                         // trang mới đang có thay đổi chưa lưu
    (ui.confirmModal as unknown as ReturnType<typeof vi.fn>).mockClear();
    await act(async () => { xong(); });
    await cho(30);
  }

  it("Lưu thành công sau khi đã rời → cờ bẩn của trang đang mở còn, bản nháp CỦA #11 được dọn", async () => {
    await luuTreoRoiRoiTrang(async () => ({}));
    expect(WD.__editorDirty, "instance đã gỡ hạ cờ chặn rời trang của trang đang mở").toBe(true);
    expect(docBanNhap(KHOA, 5), "đã lên máy chủ thì bản nháp #11 hết lý do tồn tại").toBeNull();
  });

  it("Lưu + Gửi duyệt: rời trang khi đang lưu → KHÔNG gửi duyệt báo giá đã rời", async () => {
    const nutGui = () => [...host!.querySelectorAll("button")].find((b) => /Gửi duyệt/.test(b.textContent || ""))! as HTMLButtonElement;
    await luuTreoRoiRoiTrang(async () => ({}), nutGui);
    expect(api.submitHn, "instance đã gỡ vẫn gửi duyệt").not.toHaveBeenCalled();
    expect(WD.__editorDirty).toBe(true);
  });

  it("409 sau khi đã rời → không bật hộp xung đột lên trang khác, không hạ cờ, không giữ bản đã chọn bỏ", async () => {
    await luuTreoRoiRoiTrang(async () => { throw new ApiError("Phần Hà Nội vừa được lưu ở nơi khác", 409, null); });
    expect(ui.confirmModal).not.toHaveBeenCalled();
    expect(WD.__editorDirty).toBe(true);
    expect(docBanNhap(KHOA + ":xungdot", 5)).toBeNull();
  });

  // Đợt 5 (d5-soan 3): khoá bản nháp `hn<quoteId>` DÙNG CHUNG cho mọi lần mở cùng báo giá. Rời ("Rời, bỏ thay
  // đổi") khi PUT đang bay, mở lại NGAY báo giá đó và gõ trước khi PUT cũ trả lời → nhánh L62 của instance
  // đã gỡ xoá luôn bản nháp của lần mở MỚI; tab sập sau đó là mất phần vừa gõ.
  it("PUT cũ trả lời SAU khi đã mở lại cùng báo giá và gõ → bản nháp của lần mở mới còn nguyên", async () => {
    await mo();
    goGia("6000000");
    await cho(1600);
    let xong!: () => void;
    h.saveHn = () => new Promise((r) => { xong = () => r({}); });
    await act(async () => { nutLuu().click(); });
    await cho(10);
    await act(async () => { window.dispatchEvent(new Event("editor:discard")); });   // Shell.guardLeave "Rời, bỏ thay đổi"
    act(() => root!.unmount()); root = null; host?.remove();
    h.saveHn = async () => ({});
    await mo();                                                      // mở lại #11 — instance MỚI
    goGia("7000000");
    await cho(1600);
    expect(giaTrongNhap(KHOA)).toBe(7_000_000);
    await act(async () => { xong(); });
    await cho(30);
    expect(giaTrongNhap(KHOA), "PUT cũ của instance đã gỡ xoá bản nháp của lần mở mới").toBe(7_000_000);
  });
});

// L63 (cùng gốc bên màn Account HN): xem thử quyền của một Account HN — lệnh ghi chỉ "thành công giả",
// còn khoá bản nháp vẫn theo id admin THẬT.
describe("L63 — xem thử quyền không đụng bản nháp giá HN thật", () => {
  afterEach(() => { setPreviewMode(false); });
  it("có bản nháp thật: xem thử → không hỏi khôi phục, Hủy/Lưu/gõ thử đều không xoá hay ghi đè nó", async () => {
    ghiBanNhap(KHOA, { hnTables: [{ ...baoGia().hnTables[0], items: [{ kind: "item", name: "Khung backdrop", quantity: 1, unitPrice: 7_700_000, days: 1 }] }] }, "a".repeat(32), 5);
    setPreviewMode(true);
    h.confirm = false;
    await mo();
    expect(ui.confirmModal).not.toHaveBeenCalledWith("Có giá Hà Nội chưa lưu từ lần trước", expect.anything(), expect.anything());
    goGia("1000");
    await cho(1600);
    await act(async () => { window.dispatchEvent(new Event("pagehide")); });
    await act(async () => { nutLuu().click(); });
    await cho(20);
    expect(giaTrongNhap(KHOA)).toBe(7_700_000);
  });
});

// L64 (đợt 3, phần bảng Hà Nội): HnTables từng xoá `days` LÚC VẼ khi bảng dùng mẫu không ngày — đổi mẫu qua
// lại là mất số Ngày. Bước dọn nay dời sang lúc Lưu (máy chủ nhân days bất kể mẫu), và tổng cuối màn chỉ
// nhân ngày khi mẫu CÓ ngày.
describe("L64 — bảng Hà Nội đổi mẫu qua lại không mất số Ngày", () => {
  const hang = () => ({ kind: "item", name: "Khung backdrop", quantity: 2, unitPrice: 1_000_000, days: 3 });   // MỚI mỗi bài: bản cũ bị dọn days tại chỗ
  const theCuoi = () => host!.querySelector(".ahn-grand-card")?.textContent || "";
  const chonMau = async (id: number) => {
    act(() => {
      const sel = host!.querySelector("select.extra-tpl") as HTMLSelectElement;
      sel.value = String(id); sel.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await cho(200);                                                  // mark() gom nhịp vẽ 120ms
  };

  it("có ngày (6.000.000) → không ngày (2.000.000) → có ngày: vẫn 3 ngày; Lưu lúc ở mẫu không ngày gửi days: null", async () => {
    h.getQuote = async () => baoGia({ hnTables: [{ name: "Giá thuê HN", templateId: 1, groupSubtotal: false, items: [hang()] }] });
    await mo();
    expect(theCuoi()).toContain("6.000.000");
    await chonMau(2);
    expect(theCuoi(), "mẫu không ngày mà tổng vẫn nhân ngày").toContain("2.000.000");
    await chonMau(1);
    expect(theCuoi(), "đổi mẫu qua lại làm mất số Ngày").toContain("6.000.000");
    await chonMau(2);
    await act(async () => { nutLuu().click(); });
    await cho(30);
    const goi = (api.saveHn as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)![1] as { templateId: number; items: { days: unknown }[] }[];
    expect(goi[0].templateId).toBe(2);
    expect(goi[0].items[0].days, "máy chủ nhân days bất kể mẫu — Lưu phải dọn").toBeNull();
  });

  it("mở bảng mẫu KHÔNG ngày còn days cũ → tổng không nhân ngày, không bị coi là đã sửa", async () => {
    h.getQuote = async () => baoGia({ hnTables: [{ name: "Giá thuê HN", templateId: 2, groupSubtotal: false, items: [hang()] }] });
    (window as Window & { __editorDirty?: boolean }).__editorDirty = false;
    await mo();
    await cho(200);
    expect(theCuoi()).toContain("2.000.000");
    expect((window as Window & { __editorDirty?: boolean }).__editorDirty, "mới mở đã bật cờ chưa lưu").toBe(false);
  });
});
