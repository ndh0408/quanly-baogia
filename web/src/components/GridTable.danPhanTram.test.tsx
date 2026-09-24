/** @vitest-environment jsdom */
/**
 * ============================================================================
 * DÁN PHẦN TRĂM TỪ EXCEL ("10%") VÀO SL / ĐƠN GIÁ — soát toàn diện L15.
 *
 * Excel/Sheets chép ô định dạng % dưới dạng CHỮ "10%" (giá trị gốc 0,1). parseLooseNumber /
 * parseLooseDecimal / parseTheoQuyUoc bỏ ký tự "%" rồi đọc 10 → dòng "Phí quản lý | % | 10% |
 * 50.000.000" có Thành Tiền 500.000.000 thay vì 5.000.000. Nhánh công thức vốn đã hiểu "=10%" là 0,1.
 * ============================================================================
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { GridTable } from "./GridTable";
import * as M from "../lib/quoteMath";
import { nextK, type ItemK } from "../lib/gridShared";
import { parseLooseNumber, parseLooseDecimal, parseTheoQuyUoc } from "../lib/clipboard";

vi.mock("../lib/venueCatalog", async (g) => ({ ...(await g<typeof import("../lib/venueCatalog")>()), loadCatalog: () => Promise.resolve({ entries: [], venues: [] }) }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mk = (o: Partial<ItemK>): ItemK =>
  ({ _k: nextK(), kind: "item", name: "", detail: "", unit: "", quantity: 0, days: 1, unitPrice: 0, notes: "", ...o }) as ItemK;

let root: Root | null = null;
let hop: HTMLDivElement | null = null;
afterEach(async () => {
  await act(async () => { await new Promise((r) => setTimeout(r, 220)); });
  if (root) act(() => root!.unmount());
  hop?.remove(); root = null; hop = null; document.body.innerHTML = "";
});
function Vo({ items }: { items: ItemK[] }) {
  const [, b] = useState(0);
  return <GridTable items={items} usesDays={false} showDetail addrDetail numberSubs={false} editable internalNote={false}
    groupSubtotal={false} onChange={() => b((v) => v + 1)} />;
}
function moLuoi(items: ItemK[]) {
  hop = document.createElement("div"); document.body.appendChild(hop); root = createRoot(hop);
  act(() => root!.render(<Vo items={items} />));
}
const o = (row: number, f: string) => hop!.querySelector(`tr[data-row="${row}"] [data-f="${f}"]`) as HTMLInputElement & HTMLTextAreaElement;
function dan(row: number, f: string, text: string) {
  act(() => { o(row, f).focus(); });
  const ev = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "clipboardData", { value: { getData: (k: string) => (k === "text/plain" ? text : "") } });
  act(() => { o(row, f).dispatchEvent(ev); });
}

describe("L15 — hàm đọc số hiểu hậu tố %", () => {
  it.each([
    ["10%", 0.1], ["12,5%", 0.125], ["12.5%", 0.125], ["(10%)", -0.1], ["-8%", -0.08], ["100%", 1],
  ])("'%s' → %s", (chu, mong) => {
    expect(parseLooseNumber(chu)).toBeCloseTo(mong, 10);
    expect(parseLooseDecimal(chu)).toBeCloseTo(mong, 10);
  });
  it("theo quy ước khối: '12,5%' (vn) và '12.5%' (us) → 0,125", () => {
    expect(parseTheoQuyUoc("12,5%", "vn")).toBeCloseTo(0.125, 10);
    expect(parseTheoQuyUoc("12.5%", "us")).toBeCloseTo(0.125, 10);
  });
  it("'10% VAT' (chữ lẫn số) giữ cách đọc cũ", () => {
    expect(parseLooseNumber("10% VAT")).toBe(10);
  });
});

describe("L15 — dán ô phần trăm vào lưới", () => {
  it("dán '10%' vào ô SL → 0,1", () => {
    const items = [mk({ unitPrice: 50000000 })];
    moLuoi(items);
    dan(0, "quantity", "10%");
    expect(items[0].quantity).toBeCloseTo(0.1, 10);
    expect(M.lineAmount(items[0], false)).toBe(5000000);
  });

  it("khối 'Phí quản lý ⇥ ⇥ % ⇥ 10% ⇥ 50.000.000' → Thành Tiền 5.000.000 (không phải 500.000.000)", () => {
    const items = [mk({})];
    moLuoi(items);
    dan(0, "name", "Phí quản lý\t\t%\t10%\t50.000.000");
    expect([items[0].unit, items[0].unitPrice]).toEqual(["%", 50000000]);
    expect(M.lineAmount(items[0], false)).toBe(5000000);
  });

  it("'12,5%' vào SL: Thành Tiền theo đúng 12,5% như Excel (SL không bị làm tròn 1 số lẻ)", () => {
    const items = [mk({})];
    moLuoi(items);
    dan(0, "name", "Phí quản lý\t\t%\t12,5%\t50.000.000");
    expect(items[0].quantity).toBeCloseTo(0.125, 10);
    expect(M.lineAmount(items[0], false)).toBe(6250000);
  });
});

describe("L15 — khối báo giá app xuất (có STT) mang SL phần trăm", () => {
  it("'1 ⇥ Phí quản lý ⇥ ⇥ % ⇥ 12,5% ⇥ 50.000.000 ⇥ 6.250.000' dựng lại đúng Thành Tiền", () => {
    const items = [mk({})];
    moLuoi(items);
    dan(0, "name", "A\tNhóm\t\t\t\t\t\t\r\n1\tPhí quản lý\t\t%\t12,5%\t50.000.000\t6.250.000\t\r\n");
    const x = items.find((it) => it.name === "Phí quản lý")!;
    expect(x.quantity).toBeCloseTo(0.125, 10);
    expect(M.lineAmount(x, false)).toBe(6250000);
  });
});
