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

describe("L21 — cắt rồi dán mà ảnh KHÔNG sang được đích: ảnh phải ở lại hàng nguồn", () => {
  it("cắt nguyên hàng có ảnh → TẮT cột Hình ảnh → dán: ảnh không mất", () => {
    const items = [mk({ name: "Backdrop", images: [ANH_A] }), mk({ name: "" })];
    const A = moLuoi(items, true);
    chonHang(A, 0, 0); const kho = chep("cut");
    A.datAnh(false);
    vao(A.o(1, "name"));
    dan(kho);
    expect(items[1].name).toBe("Backdrop");
    const conAnh = [...(items[0].images ?? []), ...(items[1].images ?? [])];
    expect(conAnh, "ảnh A không còn ở hàng nào").toEqual([ANH_A]);
  });

  it("cắt MỘT ô Hạng Mục (cột ảnh vẫn bật) rồi dán vào Hạng Mục hàng khác: ảnh nguồn không bị xoá", () => {
    const items = [mk({ name: "Backdrop", images: [ANH_A] }), mk({ name: "Standee" })];
    const A = moLuoi(items, true);
    vao(A.o(0, "name")); const kho = chep("cut");
    vao(A.o(1, "name"));
    dan(kho);
    expect([items[0].name, items[1].name]).toEqual(["", "Backdrop"]);
    const conAnh = [...(items[0].images ?? []), ...(items[1].images ?? [])];
    expect(conAnh, "ảnh A không còn ở hàng nào").toEqual([ANH_A]);
  });
});

describe("L22 — chép / cắt CHỈ cột Hạng Mục (≥ 2 hàng) là sửa tên, không mang ảnh", () => {
  it("chép tên 2 hàng rồi dán lên 2 hàng khác: ảnh của hàng đích giữ nguyên (như dán 1 ô)", () => {
    const items = [mk({ name: "Tên A", images: [ANH_A] }), mk({ name: "Tên B" }), mk({ name: "C", images: [ANH_C] }), mk({ name: "D", images: [ANH_D] })];
    const A = moLuoi(items, true);
    vao(A.o(0, "name")); phim(document.activeElement!, { key: "ArrowDown", shiftKey: true });
    const kho = chep();
    vao(A.o(2, "name"));
    dan(kho);
    expect([items[2].name, items[3].name]).toEqual(["Tên A", "Tên B"]);
    expect(items[2].images, "ảnh hàng đích bị thay").toEqual([ANH_C]);
    expect(items[3].images, "ảnh hàng đích bị xoá").toEqual([ANH_D]);
  });

  it("cắt tên 2 hàng rồi dán chỗ khác: ảnh ở lại hàng nguồn", () => {
    const items = [mk({ name: "Tên A", images: [ANH_A] }), mk({ name: "Tên B" }), mk({ name: "" }), mk({ name: "" })];
    const A = moLuoi(items, true);
    vao(A.o(0, "name")); phim(document.activeElement!, { key: "ArrowDown", shiftKey: true });
    const kho = chep("cut");
    vao(A.o(2, "name"));
    dan(kho);
    expect(items.map((x) => x.name)).toEqual(["", "", "Tên A", "Tên B"]);
    expect(items[0].images, "cắt chữ mà ảnh bị dời theo").toEqual([ANH_A]);
  });

  it("khối Hạng Mục → Ghi Chú (không kèm STT) vẫn là chép cả hạng mục: ảnh đi theo", () => {
    const items = [mk({ name: "Backdrop", images: [ANH_A] }), mk({ name: "Standee", images: [ANH_B] })];
    const A = moLuoi(items, true);
    vao(A.o(0, "name"));
    for (let k = 0; k < 6; k++) phim(document.activeElement!, { key: "ArrowRight", shiftKey: true });
    const kho = chep();
    vao(A.o(1, "name"));
    dan(kho);
    expect(items[1].name).toBe("Backdrop");
    expect(items[1].images).toEqual([ANH_A]);
  });
});
