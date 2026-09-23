/** @vitest-environment jsdom */
/**
 * Soát toàn diện L17 — DÁN KHỐI GN CÓ NGÀY mà mọi SL = 1 ("1 người × N ngày") sang sheet CLF có ngày.
 * Bố cục "CLF/GN không ngày" hoà điểm với "GN có ngày" (Ngày bị đọc thành SL vẫn ra SL × ĐG = TT) và
 * thắng vì đứng trước → Chi Tiết "người", ĐVT "1", SL = số ngày, Ngày 1. Tổng tiền đúng, cột lệch.
 *   ĐÃ ĐO: [9] dán vào sheet CLF có ngày → {n:'MC', d:'người', u:'1', q:2, days:1}
 * Đi đúng đường người dùng: sự kiện `paste` trên ô Hạng Mục của lưới thật (xem GridTable.danKhacMau).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { GridTable } from "./GridTable";
import { nextK, type ItemK } from "../lib/gridShared";

vi.mock("../lib/venueCatalog", async (g) => ({ ...(await g<typeof import("../lib/venueCatalog")>()), loadCatalog: () => Promise.resolve({ entries: [], venues: [] }) }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// GN CÓ ngày: STT | Hạng Mục | ĐVT | SL | Số Ngày | Đơn Giá | Thành Tiền | Ghi Chú — mọi SL = 1.
const NHAN_SU = "A\tNhân sự\t\t\t\t\t\t\r\n1\tMC\tngười\t1\t2\t3,000,000\t6,000,000\t\r\n2\tKỹ thuật\tngười\t1\t3\t1,500,000\t4,500,000\t\r\n";

let root: Root | null = null;
let hop: HTMLDivElement | null = null;
afterEach(async () => {
  await act(async () => { await new Promise((r) => setTimeout(r, 220)); });
  if (root) act(() => root!.unmount());
  hop?.remove(); root = null; hop = null; document.body.innerHTML = "";
});

function Vo({ items }: { items: ItemK[] }) {
  const [, b] = useState(0);
  // Sheet CLF CÓ NGÀY: hiện Chi Tiết + Số Ngày.
  return <GridTable items={items} editable numberSubs={false} groupSubtotal={false} fxBar internalNote onChange={() => b((v) => v + 1)}
    usesDays showDetail addrDetail showImages={false} onShowImages={() => {}} />;
}

describe("L17: dán khối GN có ngày toàn SL = 1 vào sheet CLF có ngày", () => {
  it("ĐVT / SL / Ngày vào đúng cột, Chi Tiết không nhận nhầm ĐVT", () => {
    const items = [{ _k: nextK(), kind: "item", name: "", unit: "", quantity: 0, days: 1, unitPrice: 0, notes: "" } as ItemK];
    hop = document.createElement("div"); document.body.appendChild(hop); root = createRoot(hop);
    act(() => root!.render(<Vo items={items} />));
    const el = hop.querySelector('tr[data-row="0"] [data-f="name"]') as HTMLElement;
    act(() => { el.focus(); });
    const ev = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(ev, "clipboardData", { value: { getData: (k: string) => (k === "text/plain" ? NHAN_SU : "") } });
    act(() => { el.dispatchEvent(ev); });
    const mc = items.find((x) => x.name === "MC")!;
    expect(mc, "mất dòng MC").toBeTruthy();
    expect({ d: String(mc.detail ?? ""), u: mc.unit, q: Number(mc.quantity), days: Number(mc.days), p: Number(mc.unitPrice) })
      .toEqual({ d: "", u: "người", q: 1, days: 2, p: 3000000 });
  });
});
