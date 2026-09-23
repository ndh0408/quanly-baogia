/** @vitest-environment jsdom */
/**
 * ============================================================================
 * CHÉP / CẮT HÀNG CÓ SỐ LƯỢNG "CHÍNH XÁC" (quantityExact, nạp từ Excel) — soát toàn diện L19.
 *
 * quantityExact giữ SL tới 4 số lẻ khi tính Thành Tiền (máy chủ bật khi nhập Excel mà SL chính xác mới
 * khớp Thành Tiền của tệp). Cờ không đi theo khối chép/cắt: hàng dán dùng qtyRound 1 số lẻ, nên
 * 0,9075 × 1.000.000 = 907.500 thành 900.000 — sai tiền lặng lẽ, Lưu là lưu luôn.
 * ============================================================================
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { GridTable } from "./GridTable";
import * as M from "../lib/quoteMath";
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

type Kho = Record<string, string>;
function suKienClip(loai: "copy" | "cut" | "paste", kho: Kho) {
  const ev = new Event(loai, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "clipboardData", { value: { getData: (k: string) => kho[k] ?? "", setData: (k: string, v: string) => { kho[k] = v; } } });
  return ev;
}
const chep = (loai: "copy" | "cut" = "copy"): Kho => { const kho: Kho = {}; act(() => { document.activeElement!.dispatchEvent(suKienClip(loai, kho)); }); return kho; };
const dan = (kho: Kho) => act(() => { document.activeElement!.dispatchEvent(suKienClip("paste", kho)); });
const nguyenHang = () => phim(document.activeElement!, { key: " ", code: "Space", shiftKey: true });

describe("L19 — cờ SL chính xác đi theo khối chép / cắt", () => {
  it("chép nguyên hàng SL 0,9075 × 1.000.000 sang hàng khác: Thành Tiền vẫn 907.500", () => {
    const items = [mk({ name: "Vách", quantity: 0.9075, quantityExact: true, unitPrice: 1000000 }), mk({})];
    moLuoi(items);
    vao(0, "name"); nguyenHang();
    const kho = chep();
    vao(1, "name");
    dan(kho);
    expect(items[1].quantity).toBe(0.9075);
    expect(M.lineAmount(items[1], false), "hàng dán làm tròn SL 1 số lẻ").toBe(907500);
  });

  it("chép MỘT ô SL chính xác sang ô SL khác: giữ cờ", () => {
    const items = [mk({ quantity: 0.9075, quantityExact: true, unitPrice: 1000000 }), mk({ unitPrice: 1000000 })];
    moLuoi(items);
    vao(0, "quantity");
    const kho = chep();
    vao(1, "quantity");
    dan(kho);
    expect(M.lineAmount(items[1], false)).toBe(907500);
  });

  it("dán hàng THƯỜNG đè lên hàng đang có cờ: bỏ cờ theo nguồn", () => {
    const items = [mk({ name: "Thường", quantity: 0.9075, unitPrice: 1000000 }), mk({ quantity: 2.1234, quantityExact: true, unitPrice: 1000000 })];
    moLuoi(items);
    vao(0, "name"); nguyenHang();
    const kho = chep();
    vao(1, "name");
    dan(kho);
    expect(items[1].quantityExact ?? false).toBe(false);
    expect(M.lineAmount(items[1], false)).toBe(M.lineAmount(items[0], false));
  });

  it("CẮT hàng (di chuyển): đích giữ cờ, hàng nguồn đã xoá trắng không còn cờ", () => {
    const items = [mk({ name: "Vách", quantity: 0.9075, quantityExact: true, unitPrice: 1000000 }), mk({}), mk({})];
    moLuoi(items);
    vao(0, "name"); nguyenHang();
    const kho = chep("cut");
    vao(2, "name");
    dan(kho);
    expect(M.lineAmount(items[2], false)).toBe(907500);
    expect(items[0].quantity).toBe(0);
    expect(items[0].quantityExact ?? false, "hàng nguồn đã xoá vẫn giữ cờ SL chính xác").toBe(false);
  });
});
