/** @vitest-environment jsdom */
// SỐ LƯỢNG NHỎ HƠN 0,05 KHÔNG ĐƯỢC LÀM TRÒN THÀNH 0 — chủ repo báo 2026-11-09 (production, báo giá #101 FP_A26_049):
// gõ "=0.3*0.15" vào ô Số Lượng, app lưu đúng 0,045 nhưng ô Thành Tiền TRỐNG. Luật "làm tròn SL 1 số lẻ" cho 0,0
// → 0 × 2.200.000 = 0. Quyết định: phép tính ra < 0,05 thì làm tròn thành 0,1 (shared/quote-math.ts qtyRound).
// Bài này gõ trên LƯỚI THẬT: ô SL phải hiện 0,1 và ô Thành Tiền 220.000; số lưu vẫn là số thô 0,045.
import { describe, it, expect, afterEach, vi } from "vitest";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { GridTable } from "./GridTable";
import { nextK, type ItemK } from "../lib/gridShared";

vi.mock("../lib/venueCatalog", async (nhapGoc) => {
  const goc = await nhapGoc<typeof import("../lib/venueCatalog")>();
  return { ...goc, loadCatalog: () => Promise.resolve({ entries: [], venues: [] }) };
});
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let hop: HTMLDivElement | null = null;
afterEach(() => { if (root) act(() => root!.unmount()); root = null; hop?.remove(); hop = null; document.body.innerHTML = ""; });

function Vo({ items }: { items: ItemK[] }) {
  const [, buoc] = useState(0);
  return <GridTable items={items} usesDays={false} showDetail={false} numberSubs={false} editable internalNote={false}
    groupSubtotal={false} onChange={() => buoc((v) => v + 1)} />;
}
function moLuoi(items: ItemK[]) {
  hop = document.createElement("div");
  document.body.appendChild(hop);
  root = createRoot(hop);
  act(() => root!.render(<Vo items={items} />));
  return items;
}
const o = (f: string) => hop!.querySelector(`tr[data-row="0"] [data-f="${f}"]`) as HTMLInputElement;
const thanhTien = () => (hop!.querySelector('tr[data-row="0"] td.col-amount') as HTMLElement).textContent;
/** Vào ô, gõ, RỜI ô — rời ô là lúc lưới chốt (commitCell) và tính lại công thức. */
function goRoiChot(el: HTMLInputElement, chu: string) {
  act(() => { el.focus(); });
  act(() => { el.value = chu; el.dispatchEvent(new Event("input", { bubbles: true })); });
  act(() => { el.blur(); });
}
const hang = (o2: Partial<ItemK> = {}): ItemK[] => [{ _k: nextK(), kind: "item", name: "Decal", unit: "m2", quantity: 0, days: null, unitPrice: 2_200_000, notes: "", ...o2 } as ItemK];

describe("SL công thức ra số nhỏ hơn 0,05", () => {
  it('gõ "=0.3*0.15" với Đơn Giá 2.200.000 → ô SL hiện 0,1, Thành Tiền 220.000, số lưu 0,045', () => {
    const items = moLuoi(hang());
    goRoiChot(o("quantity"), "=0.3*0.15");
    expect(items[0].formulas?.quantity).toBe("=0.3*0.15");
    expect(items[0].quantity).toBeCloseTo(0.045, 10);
    expect(o("quantity").value).toBe("0,1");
    expect(thanhTien(), "Thành Tiền trống — SL 0,045 bị làm tròn thành 0").toBe("220.000");
  });

  it('gõ số "0,03" → Thành Tiền 220.000; gõ "0" → ô Thành Tiền trống như cũ', () => {
    const items = moLuoi(hang());
    goRoiChot(o("quantity"), "0,03");
    expect(items[0].quantity).toBe(0.03);
    expect(thanhTien()).toBe("220.000");
    goRoiChot(o("quantity"), "0");
    expect(items[0].quantity).toBe(0);
    expect(thanhTien()).toBe("");
  });
});
