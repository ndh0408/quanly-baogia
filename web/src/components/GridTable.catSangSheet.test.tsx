/** @vitest-environment jsdom */
/**
 * ============================================================================
 * CẮT Ở LƯỚI NÀY, DÁN Ở LƯỚI KHÁC — soát toàn diện L20.
 *
 * Trạng thái cắt (cutPendingRef) là ref CỤC BỘ của một GridTable. QuoteEditor dựng lại lưới khi đổi
 * sheet (key main-${ai}-…) nên dấu cắt mất; payload trên clipboard vẫn đủ nên dán ở sheet 2 ra đủ
 * hàng (kèm ảnh) nhưng nguồn ở sheet 1 KHÔNG bị xoá — CẮT lặng lẽ thành CHÉP, viền nét đứt đã biến
 * mất nên người dùng tưởng đã di chuyển, tiền bị tính hai lần. Sửa: báo rõ đây là CHÉP.
 *
 * Kèm: token chép là bộ đếm RIÊNG của từng lưới (bắt đầu từ 0) — token của lưới khác trùng token
 * cắt đang chờ của lưới này thì dán khối của lưới kia lại xoá vùng cắt của lưới này.
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

const hops: HTMLDivElement[] = [];
const roots: Root[] = [];
afterEach(async () => {
  await act(async () => { await new Promise((r) => setTimeout(r, 220)); });
  for (const r of roots.splice(0)) act(() => r.unmount());
  for (const h of hops.splice(0)) h.remove();
  document.body.innerHTML = "";
});

function Vo({ items }: { items: ItemK[] }) {
  const [, b] = useState(0);
  return <GridTable items={items} usesDays={false} showDetail={false} numberSubs={false} editable internalNote={false}
    groupSubtotal={false} onChange={() => b((v) => v + 1)} />;
}
function moLuoi(items: ItemK[]) {
  const hop = document.createElement("div"); document.body.appendChild(hop); hops.push(hop);
  const root = createRoot(hop); roots.push(root);
  act(() => root.render(<Vo items={items} />));
  return {
    o: (row: number, f: string) => hop.querySelector(`tr[data-row="${row}"] [data-f="${f}"]`) as HTMLInputElement & HTMLTextAreaElement,
    go: () => { act(() => root.unmount()); roots.splice(roots.indexOf(root), 1); },
  };
}
const phim = (el: Element, init: KeyboardEventInit) => act(() => { el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init })); });
type Kho = Record<string, string>;
function suKienClip(loai: "copy" | "cut" | "paste", kho: Kho) {
  const ev = new Event(loai, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "clipboardData", { value: { getData: (k: string) => kho[k] ?? "", setData: (k: string, v: string) => { kho[k] = v; } } });
  return ev;
}
function layHang(o: (row: number, f: string) => HTMLElement, row: number, loai: "copy" | "cut"): Kho {
  act(() => { o(row, "name").focus(); });
  phim(o(row, "name"), { key: " ", code: "Space", shiftKey: true });
  const kho: Kho = {};
  act(() => { o(row, "name").dispatchEvent(suKienClip(loai, kho)); });
  return kho;
}
function dan(o: (row: number, f: string) => HTMLElement, row: number, kho: Kho) {
  act(() => { o(row, "name").focus(); });
  act(() => { o(row, "name").dispatchEvent(suKienClip("paste", kho)); });
}
const toastChu = () => document.getElementById("toast-host")?.textContent ?? "";

describe("L20 — cắt rồi dán ở lưới khác (đổi sheet): không lặng lẽ thành chép", () => {
  it("cắt ở sheet 1, đổi sheet (lưới dựng lại), dán ở sheet 2: báo rõ là CHÉP, nguồn giữ nguyên", () => {
    const s1 = [mk({ name: "Backdrop", quantity: 1, unitPrice: 1000000 })];
    const L1 = moLuoi(s1);
    const kho = layHang(L1.o, 0, "cut");
    L1.go();
    const s2 = [mk({})];
    const L2 = moLuoi(s2);
    dan(L2.o, 0, kho);
    expect(s2[0].name).toBe("Backdrop");
    expect(s1[0].name, "nguồn không được đụng tới (lưới đã gỡ)").toBe("Backdrop");
    expect(toastChu(), "cắt lặng lẽ thành chép — không có cảnh báo").toMatch(/CHÉP/);
  });

  it("cắt–dán trong cùng lưới vẫn là di chuyển, không cảnh báo; dán lần nữa cũng không cảnh báo sai", () => {
    const items = [mk({ name: "A", quantity: 1 }), mk({}), mk({})];
    const L = moLuoi(items);
    const kho = layHang(L.o, 0, "cut");
    dan(L.o, 1, kho);
    expect(items.map((x) => x.name)).toEqual(["", "A", ""]);
    dan(L.o, 2, kho);
    expect(toastChu()).not.toMatch(/CHÉP/);
  });

  it("lưới B đang chờ cắt; dán khối CHÉP từ lưới A (token trùng) vào B: vùng cắt của B không bị xoá", () => {
    const itemsB = [mk({ name: "B nguồn cắt", quantity: 5 }), mk({}), mk({})];
    const itemsA = [mk({ name: "A chép", quantity: 1 })];
    const B = moLuoi(itemsB);
    const A = moLuoi(itemsA);
    layHang(B.o, 0, "cut");                 // B: token 1, đang chờ dán
    const khoA = layHang(A.o, 0, "copy");   // A: token 1 — trùng
    dan(B.o, 2, khoA);
    expect(itemsB[2].name).toBe("A chép");
    expect(itemsB[0].name, "dán khối của lưới A lại xoá vùng cắt của lưới B").toBe("B nguồn cắt");
  });
});
