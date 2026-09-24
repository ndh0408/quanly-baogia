/** @vitest-environment jsdom */
/**
 * ============================================================================
 * Ctrl+Z / Ctrl+Y MỘT LẦN CHÈN / XOÁ HÀNG KHI TIÊU ĐIỂM ĐANG Ở HÀNG BÊN DƯỚI.
 *
 * Phát hiện thêm khi sửa soát toàn diện L6 (cùng họ "ô đang focus lệch model, rời ô chốt đè"):
 * restore() gọi syncActiveCell NGAY sau khi thay model, lúc `data-row` của ô đang focus còn là chỉ số
 * CŨ. Lùi một lần chèn hàng làm hạng mục dời lên một hàng → ô của X nhận chữ của Y (hàng đang mang chỉ
 * số cũ của X), rời ô là "Y" bị chốt đè lên X — mất dữ liệu, không báo gì.
 * ============================================================================
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { GridTable } from "./GridTable";
import { nextK, type ItemK } from "../lib/gridShared";

vi.mock("../lib/venueCatalog", async (g) => ({ ...(await g<typeof import("../lib/venueCatalog")>()), loadCatalog: () => Promise.resolve({ entries: [], venues: [] }) }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mk = (o: Partial<ItemK>): ItemK =>
  ({ _k: nextK(), kind: "item", name: "", unit: "", quantity: 0, days: 1, unitPrice: 0, notes: "", ...o }) as ItemK;

let root: Root | null = null;
let hop: HTMLDivElement | null = null;
afterEach(async () => {
  await act(async () => { await new Promise((r) => setTimeout(r, 220)); });
  if (root) act(() => root!.unmount());
  hop?.remove(); root = null; hop = null; document.body.innerHTML = "";
});
function Vo({ items }: { items: ItemK[] }) {
  const [, b] = useState(0);
  return <GridTable items={items} usesDays={false} showDetail={false} numberSubs={false} editable internalNote={false}
    groupSubtotal={false} onChange={() => b((v) => v + 1)} />;
}
function moLuoi(items: ItemK[]) {
  hop = document.createElement("div"); document.body.appendChild(hop); root = createRoot(hop);
  act(() => root!.render(<Vo items={items} />));
}
const o = (row: number, f: string) => hop!.querySelector(`tr[data-row="${row}"] [data-f="${f}"]`) as HTMLInputElement & HTMLTextAreaElement;
const phim = (el: Element, init: KeyboardEventInit) => act(() => { el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init })); });
const vao = (row: number, f: string) => act(() => { o(row, f).focus(); });

describe("Hoàn tác chèn/xoá hàng khi tiêu điểm ở hàng bên dưới", () => {
  it("chèn hàng dưới A, bấm sang X, Ctrl+Z, rời ô: X giữ nguyên tên", () => {
    const items = [mk({ name: "A" }), mk({ name: "X" }), mk({ name: "Y" })];
    moLuoi(items);
    vao(0, "name");
    phim(o(0, "name"), { key: "+", ctrlKey: true, shiftKey: true });
    expect(items.map((x) => x.name)).toEqual(["A", "", "X", "Y"]);
    vao(2, "name");
    phim(o(2, "name"), { key: "z", ctrlKey: true });
    expect(items.map((x) => x.name)).toEqual(["A", "X", "Y"]);
    expect(o(1, "name").value).toBe("X");
    vao(0, "name");
    expect(items.map((x) => x.name), "rời ô chốt chữ của hạng mục khác đè lên X").toEqual(["A", "X", "Y"]);
  });

  it("xoá hàng A, bấm sang Y, Ctrl+Z, rời ô: Y giữ nguyên tên", () => {
    const items = [mk({ name: "A" }), mk({ name: "X" }), mk({ name: "Y" })];
    moLuoi(items);
    act(() => { (hop!.querySelector('tr[data-row="0"] .rm-row') as HTMLButtonElement).click(); });
    expect(items.map((x) => x.name)).toEqual(["X", "Y"]);
    vao(1, "name");
    phim(o(1, "name"), { key: "z", ctrlKey: true });
    expect(items.map((x) => x.name)).toEqual(["A", "X", "Y"]);
    vao(0, "name");
    expect(items.map((x) => x.name), "rời ô chốt chữ của hạng mục khác đè lên Y").toEqual(["A", "X", "Y"]);
  });
});
