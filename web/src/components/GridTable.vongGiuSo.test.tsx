/** @vitest-environment jsdom */
/**
 * ============================================================================
 * Ô DÍNH VÒNG QUA TỔNG NHÓM KHÔNG ĐƯỢC "BỊA SỐ" — diễn tập lên production 2026-09-25.
 *
 * Trên bản sao CSDL production có một báo giá mà dòng "Phí vận chuyển" (nằm trong nhóm "Chi phí khác")
 * mang công thức Đơn giá dạng =ROUND((SUM(G..:G..)*14%);-6), dải SUM phủ luôn hàng TỔNG của chính nhóm
 * đó (dán từ Excel, lệch hàng). Bộ tính cũ không đọc được ngoặc lồng → null → ô giữ 0. Bộ tính mới
 * đọc được: cellNum gặp tổng của CHÍNH nhóm thì bật cờ vòng và trả 0 cho số hạng đó, nhưng vẫn cộng các
 * số hạng còn lại — recomputeAll GHI con số dở dang ấy. Người dùng sửa một ô số BẤT KỲ rồi Lưu là đơn
 * giá tự nhảy từ 0 lên hàng chục triệu, không một lời báo (ô đã đỏ sẵn từ lúc mở nên cũng không có tín
 * hiệu mới).
 *
 * Luật đã có cho vòng phát hiện qua đồ thị (oVongLap): "giữ nguyên số đang có, tô đỏ". Vòng qua tổng
 * nhóm phải theo đúng luật đó: recomputeAll giữ số; người dùng GÕ MỚI một công thức dính vòng thì ô ra 0
 * kèm đỏ (fxNhom: "không bịa số"), không ra tổng dở dang.
 *
 * Sơ đồ địa chỉ (usesDays bật, addrDetail tắt): A=STT B=Hạng Mục C=ĐVT D=SL E=Ngày F=Đơn Giá G=Thành Tiền
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
  ({ _k: nextK(), kind: "item", name: "", unit: "bộ", quantity: 1, days: 1, unitPrice: 0, notes: "", ...o }) as ItemK;

const CT_VONG = "=ROUND((SUM(G2:G4)*14%);-6)";   // G4 = tổng của CHÍNH nhóm chứa hàng 5 (hàng 5 KHÔNG nằm trong dải)
/** Hàng 5 "Vận chuyển" nằm trong nhóm hàng 4; dải G2:G4 phủ hàng nhóm 4 → vòng qua tổng nhóm. */
const bo = (): ItemK[] => [
  mk({ kind: "section", name: "Sản xuất", quantity: 1 }),                          // hàng 1
  mk({ name: "Bàn ghế", quantity: 3, unitPrice: 2_000_000 }),                      // hàng 2 → 6.000.000
  mk({ name: "Standee", quantity: 2, unitPrice: 500_000 }),                        // hàng 3 → 1.000.000
  mk({ kind: "section", name: "Chi phí khác", quantity: 1 }),                      // hàng 4
  mk({ name: "Vận chuyển", quantity: 1, unitPrice: 0, formulas: { unitPrice: "=ROUND((SUM(G2:G3)*14%);-6)" } }), // hàng 5
  mk({ name: "Dọn dẹp", quantity: 1, unitPrice: 2_200_000 }),                      // hàng 6
];

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
    <GridTable items={items} usesDays showDetail={false} addrDetail={false} numberSubs={false} editable
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
const phim = (el: Element, key: string) => act(() => { el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })); });
const bam = (el: HTMLElement) => act(() => { el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0, detail: 1 })); el.focus(); });
/** Gõ đè nội dung một ô rồi Enter — đúng đường người dùng (F2 → gõ → Enter). */
function go(el: HTMLInputElement, chu: string) {
  bam(el);
  phim(el, "F2");
  act(() => { el.value = chu; el.dispatchEvent(new Event("input", { bubbles: true })); });
  phim(el, "Enter");
}
const coDo = (it: ItemK, f: string) => { const c = it as unknown as { _fxWarn?: Record<string, boolean>; _fxLoi?: Record<string, boolean> }; return !!(c._fxWarn?.[f] || c._fxLoi?.[f]); };

describe("Công thức đã lưu dính vòng qua tổng CHÍNH nhóm: giữ số, không bịa", () => {
  it("mở lưới: ô được tô đỏ ngay, số đã lưu (0) giữ nguyên", () => {
    const items = bo();
    items[4].formulas = { unitPrice: CT_VONG };
    moLuoi(items);
    expect(coDo(items[4], "unitPrice"), "vòng qua tổng nhóm mà không đỏ lúc mở").toBe(true);
    expect(items[4].unitPrice).toBe(0);
  });

  it("sửa một ô số KHÁC (Dọn dẹp) rồi Enter → Đơn giá dòng vòng vẫn 0, không nhảy lên tổng dở dang", async () => {
    const items = bo();
    items[4].formulas = { unitPrice: CT_VONG };
    moLuoi(items);
    go(o(5, "unitPrice"), "2300000");
    await act(async () => { await new Promise((r) => setTimeout(r, 250)); });
    expect(items[5].unitPrice).toBe(2_300_000);
    // Bản cũ: SUM(G2:G4) với G4 (tổng chính nhóm) = 0 → (6.000.000 + 1.000.000 + 0 + 0) × 14% → ROUND -6
    // = 1.000.000, ghi im lặng vào đơn giá.
    expect(items[4].unitPrice, "recomputeAll ghi tổng dở dang vào ô dính vòng").toBe(0);
    expect(coDo(items[4], "unitPrice")).toBe(true);
  });

  it("ô dính vòng đang giữ SỐ KHÁC 0 (đã lưu) cũng được giữ nguyên khi tính lại", async () => {
    const items = bo();
    items[4].formulas = { unitPrice: CT_VONG };
    items[4].unitPrice = 750_000;
    moLuoi(items);
    go(o(1, "quantity"), "4");
    await act(async () => { await new Promise((r) => setTimeout(r, 250)); });
    expect(items[4].unitPrice).toBe(750_000);
  });

  it("GÕ MỚI một công thức dính vòng qua tổng nhóm → 0 + đỏ, không ra tổng dở dang", async () => {
    const items = bo();
    moLuoi(items);
    go(o(4, "unitPrice"), CT_VONG);
    await act(async () => { await new Promise((r) => setTimeout(r, 250)); });
    expect(items[4].formulas?.unitPrice).toBe(CT_VONG);
    expect(items[4].unitPrice, "công thức dính vòng mà vẫn ra số").toBe(0);
    expect(coDo(items[4], "unitPrice")).toBe(true);
  });

  it("gác: công thức KHÔNG dính vòng (SUM chỉ qua các mục) vẫn tính lại bình thường khi ô khác đổi", async () => {
    const items = bo();
    moLuoi(items);
    go(o(1, "quantity"), "4");   // Bàn ghế 4 × 2.000.000 = 8.000.000 → (8.000.000 + 1.000.000) × 14% = 1.260.000 → 1.000.000
    await act(async () => { await new Promise((r) => setTimeout(r, 250)); });
    expect(items[4].unitPrice).toBe(1_000_000);
    expect(coDo(items[4], "unitPrice")).toBe(false);
  });
});
