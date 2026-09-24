/** @vitest-environment jsdom */
/**
 * CÔNG THỨC CÓ DẤU PHẨY / KHOẢNG TRẮNG — kiểm trên LƯỚI THẬT (GridTable không bị sửa, chỉ lib/formula).
 *
 *   L30: báo giá cũ lưu {unitPrice: "=ROUND(F1*0,5)"} = 525.000 (app cũ nhận ROUND một đối số). Người
 *        dùng sửa Số Lượng một hàng KHÁC → recomputeAll tính lại → đơn giá thành 0, ô không đỏ, bấm
 *        Lưu là mất tiền. Nay công thức mơ hồ trả null → recomputeAll GIỮ số đã lưu.
 *   L29: gõ "=ROUND(SUM(F1,F2);-3)" → lưới ra 58.000 (đọc "F1,F2" thành 58000,57), Excel 115.000.
 *   L28: gõ "=MAX(F1-100, 0)" → lưới ra 57.900 không đỏ, tệp xuất Excel không mở được. Nay ô ĐỎ.
 *
 * Sơ đồ địa chỉ (usesDays bật, addrDetail tắt): A=STT B=Hạng Mục C=ĐVT D=Số Lượng E=Số Ngày
 * F=Đơn Giá G=Thành Tiền H=Ghi Chú.
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
function moLuoi(items: ItemK[], them: Partial<GridTableProps> = {}) {
  hop = document.createElement("div");
  document.body.appendChild(hop);
  root = createRoot(hop);
  act(() => root!.render(<Vo items={items} them={them} />));
}
beforeEach(() => { root = null; hop = null; });
afterEach(() => { if (root) act(() => root!.unmount()); hop?.remove(); document.body.innerHTML = ""; });

const o = (row: number, f: string): HTMLInputElement => {
  const el = hop!.querySelector(`tr[data-row="${row}"] [data-f="${f}"]`);
  if (!el) throw new Error(`không thấy ô (${row}, ${f})`);
  return el as HTMLInputElement;
};
/** Vào ô, gõ, RỜI ô — rời ô là lúc lưới chốt (commitCell) và tính lại mọi công thức (recomputeAll). */
function goRoiChot(el: HTMLInputElement, chu: string) {
  act(() => { el.focus(); });
  act(() => { el.value = chu; el.dispatchEvent(new Event("input", { bubbles: true })); });
  act(() => { el.blur(); });
}
// Ô đỏ = một trong hai cờ: `_fxWarn` (tham chiếu hỏng) hoặc `_fxLoi` (vòng lặp / không tính được) — soát toàn diện L8 tách hai cờ.
const canhBao = (it: ItemK, f: string) => { const c = it as unknown as { _fxWarn?: Record<string, boolean>; _fxLoi?: Record<string, boolean> }; return !!(c._fxWarn?.[f] || c._fxLoi?.[f]); };

describe("L30 — công thức ĐÃ LƯU kiểu cũ không bị âm thầm đổi số khi sửa ô khác", () => {
  it("=ROUND(F1*0,5) = 525.000 và =ROUNDDOWN(F1*0,9) = 945.000 vẫn giữ nguyên sau khi sửa SL hàng khác", () => {
    const items = [
      mk({ name: "Gốc", unitPrice: 1_050_000 }),
      mk({ name: "Nửa", unitPrice: 525_000, formulas: { unitPrice: "=ROUND(F1*0,5)" } } as Partial<ItemK>),
      mk({ name: "Chín", unitPrice: 945_000, formulas: { unitPrice: "=ROUNDDOWN(F1*0,9)" } } as Partial<ItemK>),
      mk({ name: "Khác" }),
    ];
    moLuoi(items);
    goRoiChot(o(3, "quantity"), "2");
    expect(items[3].quantity).toBe(2);
    expect(items[1].unitPrice, "đơn giá đã lưu bị ghi đè (bản 3848ec2 ra 0)").toBe(525_000);
    expect(items[2].unitPrice, "đơn giá đã lưu bị ghi đè (bản 3848ec2 ra 0)").toBe(945_000);
  });
});

describe("L29 — ',' trong hàm con, ';' ở ngoài", () => {
  it("=ROUND(SUM(F1,F2);-3) ra 115.000 (bản cũ 58.000), không đỏ", () => {
    const items = [mk({ unitPrice: 58_000 }), mk({ unitPrice: 57_000 }), mk({})];
    moLuoi(items);
    goRoiChot(o(2, "unitPrice"), "=ROUND(SUM(F1,F2);-3)");
    expect(items[2].unitPrice).toBe(115_000);
    expect(canhBao(items[2], "unitPrice")).toBe(false);
  });
});

describe("L28 — khoảng trắng giữa hai chữ số → ô đỏ", () => {
  it.each(["=MAX(F1-100, 0)", "=1 000 000*8%"])("%s → ô đỏ (bản cũ ra số, không đỏ)", (fx) => {
    const items = [mk({ unitPrice: 58_000 }), mk({})];
    moLuoi(items);
    goRoiChot(o(1, "unitPrice"), fx);
    expect(canhBao(items[1], "unitPrice")).toBe(true);
  });
});
