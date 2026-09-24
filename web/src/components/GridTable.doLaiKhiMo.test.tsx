/** @vitest-environment jsdom */
/**
 * ============================================================================
 * CHUYỂN SHEET KHÔNG ĐƯỢC ĐO CHIỀU CAO MỌI Ô HAI LẦN (soát toàn diện L70).
 *
 * Mỗi lần đổi sheet lưới được dựng lại (key theo sheet). Lúc dựng, từng textarea tự đo chiều cao
 * (ref={autoGrow}) với ĐÚNG bề ngang thật của bảng. Ngay sau đó ResizeObserver báo bề ngang lần đầu
 * → wrapW đi từ 0 lên → effect đo lại [wrapW, …] đo lại TOÀN BỘ textarea lần nữa, dù bố cục cột
 * không hề đổi. Đo nháp: lưới 150 textarea = 300 lượt đo sau MỘT lần đổi sheet.
 *
 * Cách đúng (phản biện chốt): chỉ bỏ lượt wrapW 0 → w ĐẦU TIÊN khi chữ ký bề rộng cột tính với
 * wrapW mới TRÙNG chữ ký lúc mount; màn hẹp (cột thật sự co lại) và mọi lần đổi cỡ cửa sổ về sau
 * vẫn đo lại — cột Hạng Mục `w: null` nở theo khung nên COLS không đổi mà chữ vẫn gấp dòng khác.
 *
 * jsdom không dàn trang: bài giả ResizeObserver + clientWidth của .tbl-scroll, và ĐẾM số lần đọc
 * `scrollHeight` của textarea — đúng chi phí thật (mỗi lần đọc là một lần đo).
 * ============================================================================
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { GridTable } from "./GridTable";
import { nextK, type ItemK } from "../lib/gridShared";

vi.mock("../lib/venueCatalog", async (g) => ({ ...(await g<typeof import("../lib/venueCatalog")>()), loadCatalog: () => Promise.resolve({ entries: [], venues: [] }) }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mk = (k: number): ItemK =>
  ({ _k: nextK(), kind: "item", name: `Hạng ${k}`, detail: "ct", unit: "m2", quantity: 1, days: 1, unitPrice: 1000, notes: "gc" }) as ItemK;

let root: Root | null = null;
let hop: HTMLDivElement | null = null;
let beNgang = 1600;
let soLanDo = 0;
const baoRO: Array<() => void> = [];

beforeEach(() => {
  soLanDo = 0; baoRO.length = 0; beNgang = 1600;
  vi.stubGlobal("ResizeObserver", class { constructor(cb: () => void) { baoRO.push(cb); } observe() {} unobserve() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) { return this.classList.contains("tbl-scroll") ? beNgang : 0; });
  vi.spyOn(Element.prototype, "scrollHeight", "get").mockImplementation(function (this: Element) { if (this.tagName === "TEXTAREA") soLanDo++; return 20; });
});
afterEach(async () => {
  await act(async () => { await new Promise((r) => setTimeout(r, 220)); });
  if (root) act(() => root!.unmount());
  hop?.remove(); root = null; hop = null; document.body.innerHTML = "";
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

const khungHinh = async (n = 4) => {
  for (let k = 0; k < n; k++) await act(async () => { await new Promise((r) => requestAnimationFrame(() => r(null))); });
};
/** Trình duyệt báo cỡ khung (lần đầu sau khi dựng, hoặc khi đổi cỡ cửa sổ) rồi chờ mọi lượt đo xong. */
const baoCo = async () => { act(() => { baoRO.forEach((cb) => cb()); }); await khungHinh(); };

function moLuoi(items: ItemK[]) {
  hop = document.createElement("div"); document.body.appendChild(hop); root = createRoot(hop);
  act(() => root!.render(<GridTable items={items} usesDays={false} showDetail addrDetail numberSubs={false} editable internalNote
    groupSubtotal={false} fxBar onChange={() => {}} />));
}

describe("Dựng lưới (đổi sheet): mỗi textarea chỉ đo MỘT lần", () => {
  it("màn rộng: bề ngang báo lần đầu không đổi bố cục cột → không đo lại cả lưới", async () => {
    moLuoi(Array.from({ length: 30 }, (_, k) => mk(k)));
    const soO = hop!.querySelectorAll("textarea").length;
    expect(soO).toBeGreaterThan(30);
    await khungHinh();
    await baoCo();
    expect(soLanDo, `đo ${soLanDo} lượt cho ${soO} ô`).toBe(soO);
  });

  it("đổi cỡ cửa sổ SAU đó vẫn đo lại toàn bộ (cột Hạng Mục nở theo khung)", async () => {
    moLuoi(Array.from({ length: 10 }, (_, k) => mk(k)));
    const soO = hop!.querySelectorAll("textarea").length;
    await khungHinh(); await baoCo();
    soLanDo = 0;
    beNgang = 1300;   // vẫn đủ rộng cho bề rộng lý tưởng → COLS y nguyên, nhưng Hạng Mục hẹp lại
    await baoCo();
    expect(soLanDo).toBe(soO);
  });

  it("màn hẹp: bề ngang báo lần đầu làm cột co lại → phải đo lại", async () => {
    beNgang = 700;
    moLuoi(Array.from({ length: 10 }, (_, k) => mk(k)));
    const soO = hop!.querySelectorAll("textarea").length;
    await khungHinh(); await baoCo();
    expect(soLanDo).toBe(2 * soO);
  });

  it("lưới dựng lúc khung bị ẩn (bề ngang 0) → khi hiện ra vẫn đo lại", async () => {
    beNgang = 0;
    moLuoi(Array.from({ length: 10 }, (_, k) => mk(k)));
    const soO = hop!.querySelectorAll("textarea").length;
    await khungHinh(); await baoCo();   // báo 0 → wrapW vẫn 0, không đo gì thêm
    beNgang = 1600;
    await baoCo();
    expect(soLanDo).toBe(2 * soO);
  });
});
