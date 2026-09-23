/** @vitest-environment jsdom */
/**
 * ============================================================================
 * Ctrl+Z / Ctrl+Y ĐỔI SANG ẢNH KHÁC CÙNG ĐỘ DÀI — dòng phải vẽ lại ảnh — soát toàn diện L4.
 *
 * Chữ ký dòng (DongNho) đưa ảnh vào bằng `images.map(x => x.length)`, còn imgVer chỉ tăng khi
 * thêm/xoá/dán ảnh, KHÔNG tăng ở restore(). Hàng 0 có ảnh P, chép nguyên hàng 1 (ảnh Q dài bằng P,
 * mọi ô khác giống nhau) dán sang hàng 0, rồi Ctrl+Z: model trả về P nhưng chữ ký không đổi nên
 * DongNho bỏ qua — <img> vẫn hiện Q, bấm phóng ảnh (đọc model) lại ra P.
 * ============================================================================
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { GridTable } from "./GridTable";
import { nextK, type ItemK } from "../lib/gridShared";

vi.mock("../lib/venueCatalog", async (nhapGoc) => {
  const goc = await nhapGoc<typeof import("../lib/venueCatalog")>();
  return { ...goc, loadCatalog: () => Promise.resolve({ entries: [], venues: [] }) };
});
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const P = "data:image/png;base64,QUFBQUFB";
const Q = "data:image/png;base64,QkJCQkJC";   // cùng độ dài với P
const mk = (o: Partial<ItemK>): ItemK =>
  ({ _k: nextK(), kind: "item", name: "X", detail: "", unit: "m2", quantity: 1, days: 1, unitPrice: 1000, notes: "", ...o }) as ItemK;

let root: Root | null = null;
let hop: HTMLDivElement | null = null;
afterEach(async () => {
  await act(async () => { await new Promise((r) => setTimeout(r, 220)); });
  if (root) act(() => root!.unmount());
  hop?.remove(); root = null; hop = null; document.body.innerHTML = "";
});

function Vo({ items }: { items: ItemK[] }) {
  const [, buoc] = useState(0);
  return (
    <GridTable items={items} usesDays={false} showDetail addrDetail numberSubs={false} editable
      internalNote={false} groupSubtotal={false} showImages onShowImages={() => {}} onChange={() => buoc((v) => v + 1)} />
  );
}
function moLuoi(items: ItemK[]) {
  hop = document.createElement("div");
  document.body.appendChild(hop);
  root = createRoot(hop);
  act(() => root!.render(<Vo items={items} />));
}
const o = (row: number, f: string) => hop!.querySelector(`tr[data-row="${row}"] [data-f="${f}"]`) as HTMLTextAreaElement;
const anh = (row: number) => (hop!.querySelector(`tr[data-row="${row}"] .cell-img img`) as HTMLImageElement | null)?.getAttribute("src");
const phim = (el: Element, init: KeyboardEventInit) => act(() => { el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init })); });
function clipGia() {
  const kho: Record<string, string> = {};
  return { setData: (k: string, v: string) => { kho[k] = v; }, getData: (k: string) => kho[k] ?? "" };
}
function suKien(loai: string, cb: ReturnType<typeof clipGia>) {
  const ev = new Event(loai, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "clipboardData", { value: cb });
  return ev;
}

describe("L4 — ảnh cùng độ dài vẫn vẽ lại sau Ctrl+Z / Ctrl+Y", () => {
  it("dán nguyên hàng ảnh Q đè hàng ảnh P rồi Ctrl+Z → hàng 0 hiện lại P; Ctrl+Y → Q", () => {
    expect(P.length).toBe(Q.length);
    const items = [mk({ images: [P] }), mk({ images: [Q] })];
    moLuoi(items);
    act(() => { o(1, "name").focus(); });
    phim(o(1, "name"), { key: " ", code: "Space", shiftKey: true });
    const cb = clipGia();
    act(() => { o(1, "name").dispatchEvent(suKien("copy", cb)); });
    act(() => { o(0, "name").focus(); });
    act(() => { o(0, "name").dispatchEvent(suKien("paste", cb)); });
    expect(items[0].images).toEqual([Q]);
    expect(anh(0)).toBe(Q);

    phim(o(0, "name"), { key: "z", ctrlKey: true });
    expect(items[0].images).toEqual([P]);
    expect(anh(0), "hàng 0 còn hiện ảnh Q trong khi model đã về P").toBe(P);

    phim(o(0, "name"), { key: "y", ctrlKey: true });
    expect(items[0].images).toEqual([Q]);
    expect(anh(0)).toBe(Q);
  });
});
