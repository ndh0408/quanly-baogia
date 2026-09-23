/** @vitest-environment jsdom */
//
// GRID-16 / FE-13: màn Account Hà Nội (nơi gõ giá hàng loạt) không có bản nháp cục bộ — tab sập hay
// mất điện là mất trắng; 409 chỉ là một toast. Cùng khuôn giàn dựng với AccountHnView.tongdongbo.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const MAU = [{ id: 1, code: "gn", name: "GN (có ngày)", companyId: 7, layout: { hasDays: true } }];
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
import { ApiError, api } from "../lib/api";
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
