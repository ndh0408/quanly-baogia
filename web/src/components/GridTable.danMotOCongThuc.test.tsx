/** @vitest-environment jsdom */
/**
 * ============================================================================
 * CHÉP MỘT Ô CÔNG THỨC RỒI DÁN — THAM CHIẾU PHẢI DỊCH NHƯ EXCEL — soát toàn diện L9.
 *
 * Nhánh "1 giá trị đơn lẻ" của onPaste luôn gọi pasteCellVal(…, dRow = 0, dCol = 0) dù payload chép
 * trong app có r0/c0/fields; chỉ nhánh khối (≥ 2 ô) mới dịch tham chiếu. Chép Đơn giá "=D1*1000"
 * rồi dán xuống cột: mọi ô đích trỏ về hàng NGUỒN, Thành Tiền sai mà không báo gì (Ctrl+D thì đúng).
 *
 * Sơ đồ địa chỉ (showDetail=false): A=STT B=Hạng Mục C=ĐVT D=Số Lượng E=Đơn Giá F=Thành Tiền G=Ghi Chú
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
    groupSubtotal={false} fxBar onChange={() => b((v) => v + 1)} />;
}
function moLuoi(items: ItemK[]) {
  hop = document.createElement("div"); document.body.appendChild(hop); root = createRoot(hop);
  act(() => root!.render(<Vo items={items} />));
}
const o = (row: number, f: string) => hop!.querySelector(`tr[data-row="${row}"] [data-f="${f}"]`) as HTMLInputElement & HTMLTextAreaElement;
const phim = (el: Element, init: KeyboardEventInit) => act(() => { el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init })); });
const chon = (row: number, f: string) => act(() => { o(row, f).focus(); });

type Kho = Record<string, string>;
function suKienClip(loai: "copy" | "cut" | "paste", kho: Kho) {
  const ev = new Event(loai, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "clipboardData", { value: { getData: (k: string) => kho[k] ?? "", setData: (k: string, v: string) => { kho[k] = v; } } });
  return ev;
}
const chep = (loai: "copy" | "cut" = "copy"): Kho => { const kho: Kho = {}; act(() => { document.activeElement!.dispatchEvent(suKienClip(loai, kho)); }); return kho; };
const dan = (kho: Kho) => act(() => { document.activeElement!.dispatchEvent(suKienClip("paste", kho)); });

describe("L9 — dán một ô công thức chép trong app: tham chiếu dịch theo ô đích", () => {
  it("1 ô → VÙNG 2 ô: mỗi ô đích trỏ hàng của chính nó (=D2*1000, =D3*1000)", () => {
    const items = [mk({ quantity: 2, unitPrice: 2000, formulas: { unitPrice: "=D1*1000" } }), mk({ quantity: 3 }), mk({ quantity: 4 })];
    moLuoi(items);
    chon(0, "unitPrice");
    const kho = chep();
    chon(1, "unitPrice");
    phim(document.activeElement!, { key: "ArrowDown", shiftKey: true });
    dan(kho);
    expect([items[1].formulas?.unitPrice, items[2].formulas?.unitPrice], "ô đích vẫn trỏ về hàng nguồn").toEqual(["=D2*1000", "=D3*1000"]);
    expect([items[1].unitPrice, items[2].unitPrice]).toEqual([3000, 4000]);
  });

  it("1 ô → 1 ô: dịch theo hàng, rời ô vẫn giữ công thức đã dịch", () => {
    const items = [mk({ quantity: 2, unitPrice: 2000, formulas: { unitPrice: "=D1*1000" } }), mk({ quantity: 3 })];
    moLuoi(items);
    chon(0, "unitPrice");
    const kho = chep();
    chon(1, "unitPrice");
    dan(kho);
    chon(0, "name");
    expect(items[1].formulas?.unitPrice).toBe("=D2*1000");
    expect(items[1].unitPrice).toBe(3000);
  });

  it("dán sang CỘT khác: cột cũng dời (Số Lượng '=C1' → Đơn Giá '=D1')", () => {
    const items = [mk({ unit: "5", quantity: 5, formulas: { quantity: "=C1" } }), mk({ quantity: 7 })];
    moLuoi(items);
    chon(0, "quantity");
    const kho = chep();
    chon(0, "unitPrice");
    dan(kho);
    expect(items[0].formulas?.unitPrice).toBe("=D1");
    expect(items[0].unitPrice).toBe(5);
  });

  it("khoá $ giữ nguyên; dịch ra ngoài bảng thì giữ công thức gốc + ô ĐỎ", () => {
    const items = [mk({ quantity: 2, unitPrice: 20, formulas: { unitPrice: "=$D$1*10" } }), mk({ quantity: 3, formulas: { quantity: "=D1+1" } }), mk({ quantity: 4 })];
    moLuoi(items);
    chon(0, "unitPrice");
    const kho = chep();
    chon(2, "unitPrice");
    dan(kho);
    expect(items[2].formulas?.unitPrice).toBe("=$D$1*10");
    chon(1, "quantity");
    const kho2 = chep();
    chon(0, "quantity");
    dan(kho2);   // =D1+1 dời lên 1 hàng → D0: ngoài bảng
    expect(items[0].formulas?.quantity).toBe("=D1+1");
    expect((items[0] as unknown as { _fxWarn?: Record<string, boolean> })._fxWarn?.quantity).toBe(true);
  });

  it("CẮT một ô công thức rồi dán = DI CHUYỂN: công thức giữ nguyên tham chiếu (như Excel)", () => {
    const items = [mk({ quantity: 2, unitPrice: 2000, formulas: { unitPrice: "=D1*1000" } }), mk({ quantity: 3 })];
    moLuoi(items);
    chon(0, "unitPrice");
    const kho = chep("cut");
    chon(1, "unitPrice");
    dan(kho);
    expect(items[1].formulas?.unitPrice).toBe("=D1*1000");
    expect(items[0].formulas?.unitPrice).toBeUndefined();
  });
});
