/** @vitest-environment jsdom */
/**
 * ============================================================================
 * DÁN KHỐI NHIỀU Ô — CẤU TRÚC HÀNG (nhóm / hạng mục / dòng thông tin) VÀ CỘT ĐÍCH PHẢI ĐÚNG.
 *
 * Các lỗi ở nhánh "khối nhiều ô" của onPaste mà soát toàn diện tìm ra (mỗi describe một lỗi).
 *
 * Sơ đồ địa chỉ (showDetail=false): A=STT B=Hạng Mục C=ĐVT D=Số Lượng E=Đơn Giá F=Thành Tiền G=Ghi Chú
 * ============================================================================
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { GridTable, type GridTableProps } from "./GridTable";
import * as M from "../lib/quoteMath";
import { nextK, type ItemK } from "../lib/gridShared";

vi.mock("../lib/venueCatalog", async (g) => ({ ...(await g<typeof import("../lib/venueCatalog")>()), loadCatalog: () => Promise.resolve({ entries: [], venues: [] }) }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mk = (o: Partial<ItemK>): ItemK =>
  ({ _k: nextK(), kind: "item", name: "", unit: "", quantity: 0, days: 1, unitPrice: 0, notes: "", ...o }) as ItemK;
const nhom = (o: Partial<ItemK>): ItemK => ({ ...mk(o), kind: "section" }) as ItemK;

const hops: HTMLDivElement[] = [];
const roots: Root[] = [];
afterEach(async () => {
  await act(async () => { await new Promise((r) => setTimeout(r, 220)); });
  for (const r of roots.splice(0)) act(() => r.unmount());
  for (const h of hops.splice(0)) h.remove();
  document.body.innerHTML = "";
});

function Vo({ items, them }: { items: ItemK[]; them: Partial<GridTableProps> }) {
  const [, b] = useState(0);
  return <GridTable items={items} usesDays={false} showDetail={false} numberSubs={false} editable internalNote={false}
    groupSubtotal={false} onChange={() => b((v) => v + 1)} {...them} />;
}
/** Dựng một lưới; trả hàm tìm ô của RIÊNG lưới đó (mở được hai lưới cùng lúc). */
function moLuoi(items: ItemK[], them: Partial<GridTableProps> = {}) {
  const hop = document.createElement("div"); document.body.appendChild(hop); hops.push(hop);
  const root = createRoot(hop); roots.push(root);
  act(() => root.render(<Vo items={items} them={them} />));
  return (row: number, f: string) => hop.querySelector(`tr[data-row="${row}"] [data-f="${f}"]`) as HTMLInputElement & HTMLTextAreaElement;
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
const dan = (kho: Kho | string) => act(() => { document.activeElement!.dispatchEvent(suKienClip("paste", typeof kho === "string" ? { "text/plain": kho } : kho)); });
/** Shift+mũi tên n lần từ ô đang focus. */
const moRong = (key: string, n: number) => { for (let k = 0; k < n; k++) phim(document.activeElement!, { key, shiftKey: true }); };

describe("L10 — khối KHÔNG phủ nguyên hàng không mang 'loại hàng' sang hàng đích", () => {
  it("dán cột SL chép từ [Nhóm G, X] vào SL của Y, Z: Y vẫn là hạng mục", () => {
    const items = [nhom({ name: "Nhóm G", quantity: 2 }), mk({ name: "X", quantity: 3, unitPrice: 100 }), mk({ name: "Y", quantity: 4, unitPrice: 200 }), mk({ name: "Z", quantity: 5, unitPrice: 300 })];
    const o = moLuoi(items, { groupSubtotal: true });
    vao(o(0, "quantity")); moRong("ArrowDown", 1);
    const kho = chep();
    vao(o(2, "quantity"));
    dan(kho);
    expect(items.map((x) => x.kind), "hạng mục Y bị đổi thành NHÓM").toEqual(["section", "item", "item", "item"]);
    expect([items[2].quantity, items[3].quantity]).toEqual([2, 3]);
    expect(M.lineAmount(items[2], false)).toBe(400);
  });

  it("khối CÓ cột Hạng Mục (chép từ Hạng Mục sang phải) vẫn mang cấu trúc nhóm như cũ", () => {
    const items = [nhom({ name: "Nhóm G", quantity: 1 }), mk({ name: "X", quantity: 3, unitPrice: 100 }), mk({ name: "Y" }), mk({ name: "Z" })];
    const o = moLuoi(items);
    vao(o(0, "name")); moRong("ArrowDown", 1); moRong("ArrowRight", 3);
    const kho = chep();
    vao(o(2, "name"));
    dan(kho);
    expect(items.map((x) => `${x.kind}:${x.name}`)).toEqual(["section:Nhóm G", "item:X", "section:Nhóm G", "item:X"]);
  });
});

describe("L14 — chép Hạng Mục → Ghi Chú sang báo giá KHÁC MẪU: ghép cột theo tên trường", () => {
  it("nguồn CÓ Số Ngày → đích KHÔNG ngày: Đơn Giá không nhận Số Ngày", () => {
    const nguon = [mk({ name: "Hallway", unit: "m2", quantity: 5.6, days: 2, unitPrice: 95000, notes: "giao 18/9" })];
    const dich = [mk({})];
    const oN = moLuoi(nguon, { usesDays: true });
    const oD = moLuoi(dich, { usesDays: false });
    vao(oN(0, "name")); moRong("ArrowRight", 5);   // name → notes
    const kho = chep();
    vao(oD(0, "name"));
    dan(kho);
    expect({ q: dich[0].quantity, p: dich[0].unitPrice, n: dich[0].notes }, "cột lệch: Số Ngày rơi vào Đơn Giá").toEqual({ q: 5.6, p: 95000, n: "giao 18/9" });
  });

  it("nguồn KHÔNG ngày → đích CÓ ngày: Số Ngày của đích giữ nguyên, Đơn Giá đúng cột", () => {
    const nguon = [mk({ name: "Hallway", unit: "m2", quantity: 5.6, unitPrice: 95000, notes: "giao 18/9" })];
    const dich = [mk({ days: 3 })];
    const oN = moLuoi(nguon, { usesDays: false });
    const oD = moLuoi(dich, { usesDays: true });
    vao(oN(0, "name")); moRong("ArrowRight", 4);
    const kho = chep();
    vao(oD(0, "name"));
    dan(kho);
    expect({ q: dich[0].quantity, d: dich[0].days, p: dich[0].unitPrice, n: dich[0].notes }).toEqual({ q: 5.6, d: 3, p: 95000, n: "giao 18/9" });
  });

  it("nguồn CÓ Chi Tiết → đích KHÔNG Chi Tiết: ĐVT/SL/ĐG vào đúng chỗ", () => {
    const nguon = [mk({ name: "Hallway", detail: "PP in KTS", unit: "m2", quantity: 5.6, unitPrice: 95000, notes: "ghi" })];
    const dich = [mk({})];
    const oN = moLuoi(nguon, { showDetail: true });
    const oD = moLuoi(dich, { showDetail: false });
    vao(oN(0, "name")); moRong("ArrowRight", 5);
    const kho = chep();
    vao(oD(0, "name"));
    dan(kho);
    expect({ u: dich[0].unit, q: dich[0].quantity, p: dich[0].unitPrice, n: dich[0].notes }).toEqual({ u: "m2", q: 5.6, p: 95000, n: "ghi" });
  });

  it("dán LỆCH cột có chủ ý (chép cột SL, dán vào cột Đơn Giá) vẫn ghép theo vị trí", () => {
    const items = [mk({ quantity: 7 }), mk({ quantity: 1, unitPrice: 5 })];
    const o = moLuoi(items);
    vao(o(0, "quantity")); moRong("ArrowDown", 1);
    const kho = chep();
    vao(o(0, "unitPrice"));
    dan(kho);
    expect([items[0].unitPrice, items[1].unitPrice]).toEqual([7, 1]);
  });
});
