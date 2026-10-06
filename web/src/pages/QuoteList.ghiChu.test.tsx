/** @vitest-environment jsdom */
//
// Cột GHI CHÚ + MÀU ở Danh sách báo giá (chủ repo 2026-09-30: "thêm cuối hàng, trước mấy cái nút, thêm cái ghi
// chú cho họ đánh vào, cho chọn màu"). Kiểm phần NỐI giữa danh sách và ô ghi chú: cột nằm đúng chỗ, bảng mang lớp
// xen kẽ trắng/xám, lưu đi đúng API với đúng trường, cập nhật TẠM thấy ngay, bấm vào ô không mở báo giá, lỗi thì
// báo + nạp lại, và người xem view lược (account HN / tài khoản chi phí) KHÔNG có cột này.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  listQuotes: null as unknown as ReturnType<typeof vi.fn>,
  setQuoteListNote: null as unknown as ReturnType<typeof vi.fn>,
  toast: null as unknown as ReturnType<typeof vi.fn>,
}));
vi.mock("../lib/api", async (goc) => {
  const that = await goc<typeof import("../lib/api")>();
  h.listQuotes = vi.fn(async () => ({ data: JSON.parse(JSON.stringify(h.rows)), meta: { total: h.rows.length, page: 1, size: 20, pageCount: 1 } }));
  h.setQuoteListNote = vi.fn(async (id: number, p: { note?: string; color?: string | null }) => ({ quoteId: id, note: p.note ?? "", color: p.color ?? null, updatedByName: "A", updatedAt: "2026-09-30T03:00:00.000Z" }));
  return { ...that, api: new Proxy({ listQuotes: h.listQuotes, setQuoteListNote: h.setQuoteListNote } as Record<string, unknown>, { get: (t, k: string) => t[k] ?? vi.fn(async () => ({})) }) };
});
vi.mock("../lib/ui", async (goc) => {
  const that = await goc<typeof import("../lib/ui")>();
  h.toast = vi.fn();
  return { ...that, toast: h.toast };
});

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { QuoteListPage } from "./QuoteList";
import { ApiError } from "../lib/api";

const QUYEN_DAY_DU = ["quote:read:own", "quote:update:own", "quote:create"];
const me = (permissions: string[]) => ({ id: 1, username: "a", displayName: "A", role: "manager", permissions });
const dong = (id: number, over: Record<string, unknown> = {}) => ({ id, quoteNumber: `GN${id}`, projectCode: `FP_A26_00${id}`, title: `Báo giá ${id}`, status: "draft", createdById: 1, sheetCount: 1, total: 1000 * id, quoteDate: "2026-09-20", ...over });

let root: Root | null = null;
let hop: HTMLDivElement;
const cho = (ms = 20) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
let mobile = false;

beforeEach(() => {
  h.rows = [
    dong(1, { listNote: { note: "Chờ khách duyệt", color: "orange", updatedByName: "Lan", updatedAt: "2026-09-29T02:00:00.000Z" } }),
    dong(2, { listNote: null }),
  ];
  h.listQuotes.mockClear?.(); h.setQuoteListNote.mockClear?.(); h.toast.mockClear?.();
  mobile = false;
  window.matchMedia = ((q: string) => ({ matches: mobile, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
});
afterEach(() => { if (root) act(() => root!.unmount()); root = null; document.body.innerHTML = ""; location.hash = ""; });

async function mo(permissions = QUYEN_DAY_DU) {
  location.hash = "#/list";
  hop = document.createElement("div"); document.body.appendChild(hop);
  root = createRoot(hop);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => { root!.render(<QueryClientProvider client={qc}><QuoteListPage me={me(permissions)} /></QueryClientProvider>); });
  await cho();
}
const hang = (i: number) => hop.querySelectorAll("tbody tr.qrow")[i] as HTMLElement;
const oGhiChu = (i: number) => hang(i).querySelector("td.ql-note-cell") as HTMLElement;
const chuGhiChu = (i: number) => oGhiChu(i).querySelector("button.qn-text") as HTMLButtonElement;
function go(el: HTMLInputElement | HTMLTextAreaElement, v: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")!.set!;
  act(() => { setter.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true })); });
}
// Khung sửa ghi chú là PORTAL ở document.body (không nằm trong `hop`).
const oNhap = () => document.querySelector("textarea.qn-area") as HTMLTextAreaElement;
const enter = () => act(async () => { oNhap().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); });

describe("Danh sách báo giá — cột Ghi chú", () => {
  it("cột 'Ghi chú' nằm SAU Trạng thái và TRƯỚC cột nút thao tác; bảng mang lớp ql-table (hàng trắng/xám)", async () => {
    await mo();
    const tieuDe = [...hop.querySelectorAll("thead th")].map((t) => t.textContent?.trim() || t.getAttribute("aria-label") || "");
    const iTT = tieuDe.indexOf("Trạng thái"), iGC = tieuDe.indexOf("Ghi chú");
    expect(iTT).toBeGreaterThan(0);
    expect(iGC, "Ghi chú phải ngay sau Trạng thái").toBe(iTT + 1);
    expect(tieuDe[iGC + 1], "sau Ghi chú là cột nút thao tác").toBe("Thao tác");
    expect(hop.querySelector("table")!.className).toContain("ql-table");
    // Mỗi hàng: ô ghi chú đứng ngay trước ô thao tác.
    expect(oGhiChu(0).nextElementSibling!.className).toContain("row-actions");
  });

  it("hiện đúng ghi chú + màu của từng dòng; dòng chưa có thì hiện gợi ý 'Ghi chú…'", async () => {
    await mo();
    expect(chuGhiChu(0).textContent).toBe("Chờ khách duyệt");
    expect(oGhiChu(0).querySelector(".qn")!.className).toContain("qn-c-orange");
    expect(chuGhiChu(1).textContent).toBe("Ghi chú…");
    expect(oGhiChu(1).querySelector(".qn")!.className).not.toContain("qn-c-");
  });

  it("gõ ghi chú + Enter → gọi ĐÚNG api (id dòng, CHỈ trường note), thấy chữ mới NGAY trước khi máy chủ trả lời, và KHÔNG mở báo giá", async () => {
    let xong!: (v: unknown) => void;
    h.setQuoteListNote.mockImplementationOnce(() => new Promise((r) => { xong = r; }));
    await mo();
    await act(async () => { chuGhiChu(1).click(); });
    expect(location.hash, "bấm vào ô ghi chú không được mở báo giá").toBe("#/list");
    const o = oNhap();
    // Bấm vào CHÍNH ô nhập (nằm trong khung nổi, nhưng sự kiện React vẫn nổi bọt lên <tr> qua portal) cũng không được mở báo giá.
    await act(async () => { o.click(); });
    expect(location.hash).toBe("#/list");
    go(o, "Gọi lại thứ Hai");
    await enter();
    expect(h.setQuoteListNote).toHaveBeenCalledTimes(1);
    expect(h.setQuoteListNote).toHaveBeenCalledWith(2, { note: "Gọi lại thứ Hai" });
    expect(chuGhiChu(1).textContent, "cập nhật tạm: chữ phải hiện trước khi máy chủ trả lời").toBe("Gọi lại thứ Hai");
    await act(async () => { xong({ quoteId: 2, note: "Gọi lại thứ Hai", color: null, updatedByName: "A", updatedAt: "2026-09-30T03:00:00.000Z" }); });
    await cho();
    expect(chuGhiChu(1).textContent).toBe("Gọi lại thứ Hai");
    expect(h.toast).not.toHaveBeenCalled();
  });

  it("chọn màu → api nhận CHỈ {color}; chữ đang có vẫn hiện (cập nhật tạm trộn, không xoá chữ)", async () => {
    await mo();
    await act(async () => { (oGhiChu(0).querySelector("button.qn-dot") as HTMLButtonElement).click(); });
    const tim = [...document.querySelectorAll<HTMLButtonElement>(".qn-swatch")].find((b) => b.getAttribute("aria-label") === "Tím")!;
    await act(async () => { tim.click(); });
    expect(h.setQuoteListNote).toHaveBeenCalledWith(1, { color: "purple" });
    await cho();
    expect(chuGhiChu(0).textContent).toBe("Chờ khách duyệt");
    expect(oGhiChu(0).querySelector(".qn")!.className).toContain("qn-c-purple");
    expect(oGhiChu(0).querySelector(".qn")!.className).not.toContain("qn-c-orange");
  });

  it("máy chủ từ chối (403…) → báo lỗi bằng toast VÀ nạp lại danh sách từ máy chủ (không giữ chữ tạm sai)", async () => {
    await mo();
    h.setQuoteListNote.mockRejectedValueOnce(new ApiError("Bạn không có quyền với báo giá này", 403, null));
    const soLanNap = h.listQuotes.mock.calls.length;
    await act(async () => { chuGhiChu(1).click(); });
    go(oNhap(), "Bị chặn");
    await enter();
    await cho(50);
    expect(h.toast).toHaveBeenCalled();
    expect(String(h.toast.mock.calls[0][0])).toContain("Bạn không có quyền");
    expect(h.toast.mock.calls[0][1]).toBe("error");
    expect(h.listQuotes.mock.calls.length, "phải nạp lại để bỏ chữ tạm").toBeGreaterThan(soLanNap);
    expect(chuGhiChu(1).textContent, "sau khi nạp lại dòng này lại chưa có ghi chú").toBe("Ghi chú…");
  });

  it("người chỉ có quote:read:own (không quote:update:*) thấy ghi chú, ĐỌC đủ chữ khi bấm, nhưng KHÔNG sửa được: không chấm bấm được, không ô nhập", async () => {
    await mo(["quote:read:own"]);
    expect(oGhiChu(0).textContent).toContain("Chờ khách duyệt");
    expect(oGhiChu(0).querySelector("button.qn-dot"), "chấm đổi màu chỉ dành cho người sửa được").toBeNull();
    expect(oGhiChu(0).querySelectorAll("button").length, "chỉ còn nút chữ để ĐỌC đủ").toBe(1);
    expect(oGhiChu(1).querySelectorAll("button").length, "dòng chưa có ghi chú: không có gì để mở").toBe(0);
    await act(async () => { chuGhiChu(0).click(); });
    expect(document.querySelector("textarea.qn-area"), "người chỉ đọc không được có ô nhập").toBeNull();
    expect(document.querySelector(".qn-doc")!.textContent).toBe("Chờ khách duyệt");
    expect(location.hash, "bấm ghi chú ở chế độ đọc không được mở báo giá").toBe("#/list");
    expect(h.setQuoteListNote).not.toHaveBeenCalled();
  });

  it("view LƯỢC (account HN / tài khoản chi phí): KHÔNG có cột Ghi chú, và không gọi api ghi chú", async () => {
    h.rows = [dong(1, { _accountHnRow: true, hnStatus: "assigned", hnSheetCount: 1, hnTotal: 5000 })];
    await mo(["quote:read:own", "quote:update:own", "quote:hn:fill"]);
    expect([...hop.querySelectorAll("thead th")].map((t) => t.textContent?.trim())).not.toContain("Ghi chú");
    expect(hop.querySelector(".qn"), "view lược không được có ô ghi chú").toBeNull();
    expect(hop.querySelector("td.ql-note-cell")).toBeNull();
  });

  it("MOBILE: thẻ có ô ghi chú; sửa ghi chú trong thẻ không mở báo giá", async () => {
    mobile = true;
    await mo();
    const the = hop.querySelectorAll(".ql-card")[1] as HTMLElement;
    const nut = the.querySelector(".ql-card-note button.qn-text") as HTMLButtonElement;
    expect(nut.textContent).toBe("Ghi chú…");
    await act(async () => { nut.click(); });
    expect(location.hash, "bấm ô ghi chú trong thẻ mở nhầm báo giá").toBe("#/list");
    const o = oNhap();
    await act(async () => { o.click(); });
    expect(location.hash).toBe("#/list");
    go(o, "Từ điện thoại");
    await enter();
    expect(h.setQuoteListNote).toHaveBeenCalledWith(2, { note: "Từ điện thoại" });
  });
});
