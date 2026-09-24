/** @vitest-environment jsdom */
/**
 * L35 phần lưới — công thức trỏ vào ô SỐ NGÀY TRỐNG (lưu 0 / null) phải đọc 1 (soát toàn diện đợt 3).
 *
 * Cùng một ô mà hai quy ước: Thành Tiền của chính hàng đó (lineAmount), excel.ts (ghi ô Số Ngày là
 * days||1) và bộ tự kiểm máy chủ (editorCellNum, days||1) đều coi Số Ngày trống là 1; riêng lưới
 * (cellNum) đọc 0 → "=E1*50000" ra 0 trên app, còn tệp Excel phải ghi SỐ 0 thay cho công thức sống
 * (tests/ct-so-ngay-trong.test.js). Nay lưới đọc 1 → app ra 50.000 và máy chủ giữ được công thức sống.
 *
 * Sơ đồ địa chỉ (usesDays bật, addrDetail tắt): A=STT B=Hạng Mục C=ĐVT D=Số Lượng E=Số Ngày
 * F=Đơn Giá G=Thành Tiền H=Ghi Chú.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { GridTable } from "./GridTable";
import { nextK, type ItemK } from "../lib/gridShared";

vi.mock("../lib/venueCatalog", async (g) => ({ ...(await g<typeof import("../lib/venueCatalog")>()), loadCatalog: () => Promise.resolve({ entries: [], venues: [] }) }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mk = (o: Partial<ItemK>): ItemK => ({ _k: nextK(), kind: "item", name: "", unit: "bộ", quantity: 1, days: 1, unitPrice: 0, notes: "", ...o }) as ItemK;

let root: Root | null = null;
let hop: HTMLDivElement | null = null;
afterEach(() => { if (root) act(() => root!.unmount()); hop?.remove(); root = null; hop = null; document.body.innerHTML = ""; });

function Vo({ items }: { items: ItemK[] }) {
  const [, b] = useState(0);
  return <GridTable items={items} usesDays showDetail={false} addrDetail={false} numberSubs={false} editable internalNote={false}
    groupSubtotal={false} fxBar onChange={() => b((v) => v + 1)} />;
}
function moLuoi(items: ItemK[]) {
  hop = document.createElement("div"); document.body.appendChild(hop); root = createRoot(hop);
  act(() => root!.render(<Vo items={items} />));
}
const o = (row: number, f: string) => hop!.querySelector(`tr[data-row="${row}"] [data-f="${f}"]`) as HTMLInputElement;
function goRoiChot(el: HTMLInputElement, chu: string) {
  act(() => { el.focus(); });
  act(() => { el.value = chu; el.dispatchEvent(new Event("input", { bubbles: true })); });
  act(() => { el.blur(); });
}

describe("L35 — tham chiếu tới ô Số Ngày trống", () => {
  it.each([0, null])("days = %s → =E1*50000 ra 50.000 (bản cũ ra 0)", (days) => {
    const items = [mk({ name: "A", days: days as number }), mk({ name: "B" })];
    moLuoi(items);
    goRoiChot(o(1, "unitPrice"), "=E1*50000");
    expect(items[1].unitPrice).toBe(50_000);
  });

  it("Số Ngày có số thì vẫn đọc đúng số đó; Đơn giá trống vẫn là 0", () => {
    const items = [mk({ name: "A", days: 3, unitPrice: 0 }), mk({ name: "B" }), mk({ name: "C" })];
    moLuoi(items);
    goRoiChot(o(1, "unitPrice"), "=E1*50000");
    goRoiChot(o(2, "unitPrice"), "=F1+7");
    expect(items[1].unitPrice).toBe(150_000);
    expect(items[2].unitPrice).toBe(7);
  });
});
