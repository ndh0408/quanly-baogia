/** @vitest-environment jsdom */
/**
 * L33 — trên LƯỚI THẬT: bảng 4 hàng, F2 = 58.000, F3 = 57.000, gõ "=SUM(F2:F50)" ở F1 (thói quen Excel:
 * lấy dải rộng cho các hàng thêm sau) → bản cũ ra 0, ô không đỏ; Excel ra 115.000. GridTable không bị sửa:
 * `range` của nó vẫn trả null khi một đầu dải ngoài bảng, và lib/formula nay tự bung dải qua `cell`
 * (ô ngoài bảng = 0 như ô trống Excel).
 * Sơ đồ địa chỉ (usesDays bật, addrDetail tắt): D=Số Lượng E=Số Ngày F=Đơn Giá G=Thành Tiền.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { GridTable, type GridTableProps } from "./GridTable";
import { nextK, type ItemK } from "../lib/gridShared";

vi.mock("../lib/venueCatalog", async (nhapGoc) => {
  const goc = await nhapGoc<typeof import("../lib/venueCatalog")>();
  return { ...goc, loadCatalog: () => Promise.resolve({ entries: [], venues: [] }) };
});
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mk = (o: Partial<ItemK>): ItemK =>
  ({ k: nextK(), kind: "item", name: "", unit: "bộ", quantity: 1, days: 1, unitPrice: 0, notes: "", ...o }) as ItemK;

let root: Root | null = null;
let hop: HTMLDivElement | null = null;
function Vo({ items, them }: { items: ItemK[]; them: Partial<GridTableProps> }) {
  const [, buoc] = useState(0);
  return (
    <GridTable items={items} usesDays showDetail={false} addrDetail={false} numberSubs={false} editable
      internalNote={false} groupSubtotal={false} fxBar onChange={() => buoc((v) => v + 1)} {...them} />
  );
}
function moLuoi(items: ItemK[]) {
  hop = document.createElement("div");
  document.body.appendChild(hop);
  root = createRoot(hop);
  act(() => root!.render(<Vo items={items} them={{}} />));
}
beforeEach(() => { root = null; hop = null; });
afterEach(() => { if (root) act(() => root!.unmount()); hop?.remove(); document.body.innerHTML = ""; });
const o = (row: number, f: string) => hop!.querySelector(`tr[data-row="${row}"] [data-f="${f}"]`) as HTMLInputElement;
function goRoiChot(el: HTMLInputElement, chu: string) {
  act(() => { el.focus(); });
  act(() => { el.value = chu; el.dispatchEvent(new Event("input", { bubbles: true })); });
  act(() => { el.blur(); });
}
// Ô đỏ = một trong hai cờ: `_fxWarn` (tham chiếu hỏng) hoặc `_fxLoi` (vòng lặp / không tính được) — soát toàn diện L8 tách hai cờ.
const canhBao = (it: ItemK, f: string) => { const c = it as unknown as { _fxWarn?: Record<string, boolean>; _fxLoi?: Record<string, boolean> }; return !!(c._fxWarn?.[f] || c._fxLoi?.[f]); };

describe("L33 — dải vượt số hàng trên lưới thật", () => {
  it.each(["=SUM(F2:F50)", "=SUM(F2:F5)", "=SUM(F50:F2)"])("%s trên bảng 4 hàng = 115.000, không đỏ (bản cũ 0)", (fx) => {
    const items = [mk({}), mk({ unitPrice: 58_000 }), mk({ unitPrice: 57_000 }), mk({})];
    moLuoi(items);
    goRoiChot(o(0, "unitPrice"), fx);
    expect(items[0].unitPrice).toBe(115_000);
    expect(canhBao(items[0], "unitPrice")).toBe(false);
  });

  it("dải vượt bảng mà ôm cả CHÍNH ô đang gõ (=SUM(F1:F50) ở F4) → tham chiếu vòng, ô ĐỎ như Excel (bản cũ: 0, không đỏ)", () => {
    const items = [mk({ unitPrice: 58_000 }), mk({ unitPrice: 57_000 }), mk({}), mk({})];
    moLuoi(items);
    goRoiChot(o(3, "unitPrice"), "=SUM(F1:F50)");
    expect(canhBao(items[3], "unitPrice")).toBe(true);
  });
});
