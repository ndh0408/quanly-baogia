/** @vitest-environment jsdom */
/**
 * ============================================================================
 * Ô THÀNH TIỀN KẸT SỐ ĐÃ HUỶ khi Esc / Ctrl+Z trong vòng 180ms sau phím đầu — soát toàn diện L3.
 *
 * onNumInput ghi thẳng `amtTd.textContent` ở mỗi phím và hoãn lượt vẽ lại 180ms. Gõ SL "5" (Thành
 * Tiền nhảy 5.000) rồi Esc/Ctrl+Z trước khi lượt vẽ hoãn chạy: model về 1, nhưng lượt vẽ kế tiếp có
 * dữ liệu y hệt lần React vẽ gần nhất ("1.000") nên React không ghi gì — ô kẹt 5.000 trong khi SL
 * hiện 1 và tổng sheet đúng, tới khi chính dòng đó đổi dữ liệu.
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

const mk = (o: Partial<ItemK>): ItemK =>
  ({ _k: nextK(), kind: "item", name: "Hạng", detail: "", unit: "m2", quantity: 1, days: 1, unitPrice: 1000, notes: "", ...o }) as ItemK;

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
    <GridTable items={items} usesDays={false} showDetail={false} numberSubs={false} editable
      internalNote={false} groupSubtotal={false} fxBar onChange={() => buoc((v) => v + 1)} />
  );
}
function moLuoi(items: ItemK[]) {
  hop = document.createElement("div");
  document.body.appendChild(hop);
  root = createRoot(hop);
  act(() => root!.render(<Vo items={items} />));
}
const o = (row: number, f: string) => hop!.querySelector(`tr[data-row="${row}"] [data-f="${f}"]`) as HTMLInputElement;
const thanhTien = (row: number) => hop!.querySelector(`tr[data-row="${row}"] td.col-amount`)!.textContent;
const phim = (el: Element, init: KeyboardEventInit) => act(() => { el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init })); });
const cho = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

/** Gõ "5" vào ô SL đang chọn (gõ là đè) — đúng đường trình duyệt: keydown rồi input. */
function go5() {
  const el = o(0, "quantity");
  act(() => { el.focus(); });
  phim(el, { key: "5" });
  act(() => { el.value = "5"; el.dispatchEvent(new Event("input", { bubbles: true })); });
  expect(thanhTien(0)).toBe("5.000");
}

describe("L3 — Thành Tiền về đúng model khi huỷ ngay sau phím đầu", () => {
  it("gõ SL 5 rồi Esc NGAY → Thành Tiền về 1.000", async () => {
    const items = [mk({})];
    moLuoi(items);
    go5();
    phim(o(0, "quantity"), { key: "Escape" });
    await cho(300);
    expect(items[0].quantity).toBe(1);
    expect(o(0, "quantity").value).toBe("1");
    expect(thanhTien(0), "Thành Tiền còn số đã huỷ").toBe("1.000");
  });

  it("gõ SL 5 rồi Ctrl+Z NGAY → Thành Tiền về 1.000", async () => {
    const items = [mk({})];
    moLuoi(items);
    go5();
    phim(o(0, "quantity"), { key: "z", ctrlKey: true });
    await cho(300);
    expect(items[0].quantity).toBe(1);
    expect(thanhTien(0), "Thành Tiền còn số đã huỷ").toBe("1.000");
  });

  it("gõ bình thường (không huỷ) → Thành Tiền vẫn nhảy theo số mới", async () => {
    const items = [mk({})];
    moLuoi(items);
    go5();
    await cho(300);
    expect(items[0].quantity).toBe(5);
    expect(thanhTien(0)).toBe("5.000");
  });
});
