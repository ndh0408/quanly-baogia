/** @vitest-environment jsdom */
//
// BÀI KIỂM MỨC COMPONENT CHO CÁC PHÁT HIỆN AUDIT CỦA LƯỚI (GRID-xx).
//
// Tách khỏi GridTable.component.test.tsx vì tệp đó chuyên gác Ctrl+Z/Y và thứ tự pushUndo; các bài ở
// đây gác những lỗi làm SAI SỐ hoặc GHI NHẦM Ô mà audit đã đo trên lưới thật. Giàn dựng giữ đúng nếp
// của tệp kia (createRoot + act, bắn sự kiện GỐC, không @testing-library) — xem lý do ở đầu tệp đó.
import { describe, it, expect, afterEach, vi } from "vitest";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { GridTable, type GridTableProps } from "./GridTable";
import * as M from "../lib/quoteMath";
import { nextK, type ItemK } from "../lib/gridShared";

vi.mock("../lib/venueCatalog", async (nhapGoc) => {
  const goc = await nhapGoc<typeof import("../lib/venueCatalog")>();
  return { ...goc, loadCatalog: () => Promise.resolve({ entries: [], venues: [] }) };
});

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Vo({ items, them }: { items: ItemK[]; them: Partial<GridTableProps> }) {
  const [, buoc] = useState(0);
  return (
    <GridTable items={items} usesDays={false} showDetail={false} numberSubs={false} editable={true}
      internalNote={false} groupSubtotal={false} onChange={() => buoc((v) => v + 1)} {...them} />
  );
}

let root: Root | null = null;
let hop: HTMLDivElement | null = null;

function moLuoi(items: ItemK[], them: Partial<GridTableProps> = {}) {
  hop = document.createElement("div");
  document.body.appendChild(hop);
  root = createRoot(hop);
  act(() => root!.render(<Vo items={items} them={them} />));
}

function o(row: number, field: string): HTMLInputElement | HTMLTextAreaElement {
  const el = hop!.querySelector(`tr[data-row="${row}"] [data-f="${field}"]`);
  if (!el) throw new Error(`không thấy ô (${row}, ${field})`);
  return el as HTMLInputElement | HTMLTextAreaElement;
}

function phim(el: Element, key: string, mo: { ctrl?: boolean; shift?: boolean; keyCode?: number } = {}) {
  const init: KeyboardEventInit & { keyCode?: number } = { key, bubbles: true, cancelable: true, ctrlKey: !!mo.ctrl, shiftKey: !!mo.shift };
  if (mo.keyCode != null) init.keyCode = mo.keyCode;
  let ev!: KeyboardEvent;
  act(() => { ev = new KeyboardEvent("keydown", init); el.dispatchEvent(ev); });
  return ev;
}

const vaoO = (el: HTMLElement) => act(() => el.focus());

/** Kho clipboard giả: jsdom không có DataTransfer. Giữ MỌI kiểu dữ liệu mà lưới setData (kể cả
 *  application/x-quanly-grid) — đó chính là thứ phân biệt "chép trong app" với "dán từ Excel". */
type Kho = Record<string, string>;
function suKienClip(loai: "copy" | "paste", kho: Kho) {
  const ev = new Event(loai, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "clipboardData", {
    value: { getData: (k: string) => kho[k] ?? (k === "text" ? kho["text/plain"] ?? "" : ""), setData: (k: string, v: string) => { kho[k] = v; } },
  });
  return ev;
}
function chep(el: HTMLElement): Kho {
  const kho: Kho = {};
  act(() => { el.dispatchEvent(suKienClip("copy", kho)); });
  return kho;
}
function dan(el: HTMLElement, kho: Kho | string) {
  const k = typeof kho === "string" ? { "text/plain": kho } : kho;
  const ev = suKienClip("paste", k);
  act(() => { el.dispatchEvent(ev); });
  return ev;
}
async function xaHen() {
  await act(async () => { await new Promise((r) => setTimeout(r, 220)); });
}

const hang = (name: string, unit = "", quantity = 0, unitPrice = 0): ItemK =>
  ({ ...M.blankItem(false), name, unit, quantity, unitPrice, _k: nextK() }) as ItemK;

afterEach(async () => {
  await xaHen();
  if (root) act(() => root!.unmount());
  root = null;
  hop?.remove();
  hop = null;
  document.body.innerHTML = "";
});

// ── GRID-01 / MONEY-04: dán số có 3 chữ số lẻ vào SL bị nhân 1000 ─────────────────────────────
describe("GRID-01 — dán số vào cột SỐ LƯỢNG / ĐƠN GIÁ không được đoán nhầm nghìn", () => {
  it("chép-dán NGAY TRONG lưới: SL 2,675 sang hàng khác vẫn là 2,675 (không phải 2675)", () => {
    const items = [hang("Vách", "m2", 2.675, 100000), hang("Sàn", "m2", 1, 100000)];
    moLuoi(items);
    vaoO(o(0, "quantity"));
    const kho = chep(o(0, "quantity"));
    expect(kho["text/plain"]).toBe("2.675");            // số THÔ — đúng thứ mà bản cũ đọc thành 2675
    vaoO(o(1, "quantity"));
    dan(o(1, "quantity"), kho);
    expect(items[1].quantity).toBe(2.675);
    expect(M.lineAmount(items[1], false)).toBe(270000);
  });

  it("chép-dán trong lưới: SL 1500 và Đơn giá 1500000 giữ nguyên", () => {
    const items = [hang("A", "cái", 1500, 1500000), hang("B", "cái", 1, 1)];
    moLuoi(items);
    vaoO(o(0, "quantity"));
    phim(o(0, "quantity"), "ArrowRight", { shift: true });
    const kho = chep(o(0, "unitPrice"));
    vaoO(o(1, "quantity"));
    dan(o(1, "quantity"), kho);
    expect([items[1].quantity, items[1].unitPrice]).toEqual([1500, 1500000]);
  });

  it.each([
    ["2.675", 2.675],
    ["2,675", 2.675],
    ["0,125", 0.125],
    ["13.524", 13.524],
    ["1.500.000", 1500000],
  ])("dán từ NGUỒN NGOÀI vào SL: %s → %s", (chu, mong) => {
    const items = [hang("Vách", "m2", 1, 100000)];
    moLuoi(items);
    vaoO(o(0, "quantity"));
    dan(o(0, "quantity"), chu);
    expect(items[0].quantity).toBeCloseTo(mong, 6);
  });

  it("dán từ nguồn ngoài vào ĐƠN GIÁ: '1.500' vẫn là 1500 (tiền VND, nghìn)", () => {
    const items = [hang("Vách", "m2", 1, 0)];
    moLuoi(items);
    vaoO(o(0, "unitPrice"));
    dan(o(0, "unitPrice"), "1.500");
    expect(items[0].unitPrice).toBe(1500);
  });

  it("dán KHỐI từ Excel VN (SL | Đơn giá): SL thập phân, giá nghìn", () => {
    const items = [hang("Vách", "m2", 1, 1)];
    moLuoi(items);
    vaoO(o(0, "quantity"));
    dan(o(0, "quantity"), "0,125\t95.000");
    expect([items[0].quantity, items[0].unitPrice]).toEqual([0.125, 95000]);
  });

  it("GRID-13: dán '(1.500.000)' (âm kiểu kế toán) vào Đơn giá ra SỐ ÂM", () => {
    const items = [hang("Giảm giá", "gói", 1, 0)];
    moLuoi(items);
    vaoO(o(0, "unitPrice"));
    dan(o(0, "unitPrice"), "(1.500.000)");
    expect(items[0].unitPrice).toBe(-1500000);
  });
});

