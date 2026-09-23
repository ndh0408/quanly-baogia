/** @vitest-environment jsdom */
/**
 * ============================================================================
 * ẢNH KHI CHÉP / CẮT / DÁN KHỐI — không gắn ảnh lạ, không làm mất ảnh (soát toàn diện L11, L21, L22).
 *
 * Nối tiếp GridTable.anhTheoHang.test.tsx (ảnh đi theo hàng khi chép/cắt nguyên hàng). Các bài ở đây
 * gác những ca soát toàn diện tìm ra mà tệp kia không phủ.
 * ============================================================================
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { GridTable, type GridTableProps } from "./GridTable";
import { nextK, type ItemK } from "../lib/gridShared";

vi.mock("../lib/venueCatalog", async (g) => ({ ...(await g<typeof import("../lib/venueCatalog")>()), loadCatalog: () => Promise.resolve({ entries: [], venues: [] }) }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ANH_A = "data:image/png;base64,QUFB";
const ANH_B = "data:image/png;base64,QkJC";
const ANH_C = "data:image/png;base64,Q0ND";
const ANH_D = "data:image/png;base64,RERE";
const mk = (o: Partial<ItemK>): ItemK =>
  ({ _k: nextK(), kind: "item", name: "", detail: "", unit: "m2", quantity: 1, days: 1, unitPrice: 0, notes: "", ...o }) as ItemK;

const hops: HTMLDivElement[] = [];
const roots: Root[] = [];
afterEach(async () => {
  await act(async () => { await new Promise((r) => setTimeout(r, 220)); });
  for (const r of roots.splice(0)) act(() => r.unmount());
  for (const h of hops.splice(0)) h.remove();
  document.body.innerHTML = "";
});

type Luoi = { o: (row: number, f: string) => HTMLInputElement & HTMLTextAreaElement; datAnh: (v: boolean) => void };
function moLuoi(items: ItemK[], showImages: boolean, them: Partial<GridTableProps> = {}): Luoi {
  let datAnh: (v: boolean) => void = () => {};
  function Vo() {
    const [anh, setAnh] = useState(showImages);
    const [, b] = useState(0);
    datAnh = setAnh;
    return <GridTable items={items} usesDays={false} showDetail addrDetail numberSubs={false} editable internalNote={false}
      groupSubtotal={false} showImages={anh} onShowImages={setAnh} onChange={() => b((v) => v + 1)} {...them} />;
  }
  const hop = document.createElement("div"); document.body.appendChild(hop); hops.push(hop);
  const root = createRoot(hop); roots.push(root);
  act(() => root.render(<Vo />));
  return { o: (row, f) => hop.querySelector(`tr[data-row="${row}"] [data-f="${f}"]`) as HTMLInputElement & HTMLTextAreaElement, datAnh: (v) => act(() => datAnh(v)) };
}
const phim = (el: Element, init: KeyboardEventInit) => act(() => { el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init })); });
const vao = (el: HTMLElement) => act(() => { el.focus(); });

type Kho = Record<string, string>;
function suKienClip(loai: "copy" | "cut" | "paste", kho: Kho) {
  const ev = new Event(loai, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "clipboardData", { value: { getData: (k: string) => kho[k] ?? "", setData: (k: string, v: string) => { kho[k] = v; } } });
  return ev;
}
const chep = (loai: "copy" | "cut" = "copy"): Kho => { const kho: Kho = {}; act(() => { document.activeElement!.dispatchEvent(suKienClip(loai, kho)); }); return kho; };
const dan = (kho: Kho) => act(() => { document.activeElement!.dispatchEvent(suKienClip("paste", kho)); });
/** Chọn nguyên các hàng [r0..r1] của một lưới (Shift+↓ rồi Shift+Space). */
function chonHang(l: Luoi, r0: number, r1: number) {
  vao(l.o(r0, "name"));
  for (let r = r0; r < r1; r++) phim(document.activeElement!, { key: "ArrowDown", shiftKey: true });
  phim(document.activeElement!, { key: " ", code: "Space", shiftKey: true });
}

describe("L11 — dán khối từ lưới KHÔNG mang ảnh: không gắn ảnh cũ, không xoá ảnh đích", () => {
  it("chép hàng ở A (có ảnh), rồi chép 2 hàng ở lưới B (tắt ảnh) dán vào A: ảnh đích giữ nguyên", () => {
    const itemsA = [mk({ name: "Backdrop", images: [ANH_A] }), mk({ name: "Đích 1", images: [ANH_B] }), mk({ name: "Đích 2", images: [ANH_C] })];
    const itemsB = [mk({ name: "Nội bộ 1" }), mk({ name: "Nội bộ 2" })];
    const A = moLuoi(itemsA, true);
    const B = moLuoi(itemsB, false);
    chonHang(A, 0, 0); chep();                 // bộ đệm chép của A giờ mang ảnh A
    chonHang(B, 0, 1); const kho = chep();     // payload của B không có ảnh
    vao(A.o(1, "name"));
    dan(kho);
    expect([itemsA[1].name, itemsA[2].name]).toEqual(["Nội bộ 1", "Nội bộ 2"]);
    expect(itemsA[1].images, "hàng đích bị gắn ảnh của lần chép TRƯỚC").toEqual([ANH_B]);
    expect(itemsA[2].images, "ảnh của hàng đích bị xoá").toEqual([ANH_C]);
  });
});
