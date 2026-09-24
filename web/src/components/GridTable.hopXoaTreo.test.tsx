/** @vitest-environment jsdom */
/**
 * HỘP "XÓA NHIỀU HÀNG" CÒN TREO KHI LƯỚI ĐÃ GỠ / ĐỔI DỮ LIỆU (soát toàn diện đợt 3 L61).
 *
 * Ctrl+- trên vùng nhiều hàng mở hộp hỏi (confirmModal, gắn thẳng vào <body>, sống ngoài vòng đời
 * React). Trong lúc hộp còn mở mà trình soạn bị gỡ (Back, đổi báo giá, đổi sheet) hay lưới nhận mảng
 * items MỚI (nạp lại báo giá sau Lưu), bấm "Xóa n hàng" vẫn chạy closure cũ: xoá hàng trên mảng CŨ
 * và gọi onChange → mark() của trình soạn — cờ "chưa lưu" bật trên trang mới, bản nháp của báo giá
 * cũ được hẹn ghi. Nay kiểm lưới còn gắn và vẫn là CHÍNH mảng items lúc mở hộp rồi mới xoá.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { GridTable, type GridTableProps } from "./GridTable";
import { nextK, type ItemK } from "../lib/gridShared";

vi.mock("../lib/venueCatalog", async (g) => ({ ...(await g<typeof import("../lib/venueCatalog")>()), loadCatalog: () => Promise.resolve({ entries: [], venues: [] }) }));
let traLoi: ((ok: boolean) => void) | null = null;
vi.mock("../lib/ui", async (g) => ({ ...(await g<typeof import("../lib/ui")>()), toast: () => {}, confirmModal: () => new Promise<boolean>((r) => { traLoi = r; }) }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mk = (name: string): ItemK => ({ _k: nextK(), kind: "item", name, unit: "cái", quantity: 1, days: 1, unitPrice: 1000, notes: "" }) as ItemK;

let root: Root | null = null;
let hop: HTMLDivElement | null = null;
afterEach(() => { if (root) act(() => root!.unmount()); hop?.remove(); root = null; hop = null; traLoi = null; document.body.innerHTML = ""; });

const luoi = (items: ItemK[], onChange: () => void) => {
  const p: GridTableProps = { items, usesDays: false, showDetail: false, numberSubs: false, editable: true, internalNote: false, groupSubtotal: false, onChange };
  return <GridTable {...p} />;
};
const phim = (el: Element, init: KeyboardEventInit) => act(() => { el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init })); });
/** Chọn nguyên hàng 0–1 rồi Ctrl+- → hộp "Xóa nhiều hàng" mở, chờ trả lời. */
function moHopXoa(items: ItemK[], onChange: () => void) {
  hop = document.createElement("div"); document.body.appendChild(hop); root = createRoot(hop);
  act(() => root!.render(luoi(items, onChange)));
  act(() => { (hop!.querySelector('tr[data-row="0"] [data-f="name"]') as HTMLElement).focus(); });
  phim(document.activeElement!, { key: "ArrowDown", shiftKey: true });
  phim(document.activeElement!, { key: " ", code: "Space", shiftKey: true });
  phim(document.activeElement!, { key: "-", ctrlKey: true });
  expect(traLoi, "hộp Xóa nhiều hàng không mở").not.toBeNull();
}
const dongY = async () => { await act(async () => { traLoi!(true); await Promise.resolve(); }); };

describe("Hộp 'Xóa nhiều hàng' treo", () => {
  it("lưới còn nguyên → xác nhận là xoá (hành vi cũ giữ nguyên)", async () => {
    const items = [mk("A"), mk("B"), mk("C")];
    const doi = vi.fn();
    moHopXoa(items, doi);
    await dongY();
    expect(items.map((x) => x.name)).toEqual(["C"]);
    expect(doi).toHaveBeenCalled();
  });

  it("lưới đã gỡ (rời trình soạn) rồi mới xác nhận → không xoá, không báo đổi", async () => {
    const items = [mk("A"), mk("B"), mk("C")];
    const doi = vi.fn();
    moHopXoa(items, doi);
    act(() => root!.unmount()); root = null;
    doi.mockClear();
    await dongY();
    expect(items.map((x) => x.name), "xoá hàng trên lưới đã gỡ").toEqual(["A", "B", "C"]);
    expect(doi, "onChange của trình soạn đã gỡ vẫn bị gọi").not.toHaveBeenCalled();
  });

  it("lưới nhận mảng items MỚI (nạp lại báo giá) rồi mới xác nhận → không xoá mảng nào", async () => {
    const cu = [mk("A"), mk("B"), mk("C")];
    const doi = vi.fn();
    moHopXoa(cu, doi);
    const moi = [mk("X"), mk("Y"), mk("Z")];
    act(() => root!.render(luoi(moi, doi)));
    doi.mockClear();
    await dongY();
    expect(moi.map((x) => x.name)).toEqual(["X", "Y", "Z"]);
    expect(cu.map((x) => x.name)).toEqual(["A", "B", "C"]);
    expect(doi).not.toHaveBeenCalled();
  });
});
