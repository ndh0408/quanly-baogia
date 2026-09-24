/** @vitest-environment jsdom */
/**
 * ============================================================================
 * Esc HUỶ PHIÊN GÕ TRÊN Ô ĐỎ `_fxLoi` PHẢI TRẢ LẠI CỜ — soát toàn diện đợt 4 (hồi quy của 68f8800).
 *
 * Ô đơn giá "=ROUND(F1*0,5)" (nay mơ hồ dấu phẩy → null) giữ 525.000 và ĐỎ ngay lúc mở. Ở phím đầu
 * tiên onNumInput gọi ghiCoVong — hàm này gỡ `_fxLoi` kể cả khi công thức gõ dở không tính được — còn
 * recomputeAll nay MIỄN ô đang gõ (không nháy đỏ), nên suốt phiên gõ không ai bật lại cờ. Gõ rồi xoá
 * về đúng chuỗi cũ (hoặc chỉ thêm dấu cách) rồi Esc: công thức và số khớp mốc → nhánh Esc không gọi
 * commitCell, mốc (công thức|số) không đổi → không tính lại → cờ MẤT hẳn. Lần rời ô kế tiếp
 * commitCell(giuCoHong) không còn thấy cờ → rơi vào nhánh GRID-03 và ghi `0` đè 525.000; mốc hoàn
 * tác của phiên đã bị Esc bỏ nên Ctrl+Z không lấy lại được.
 * Kèm: gõ '=F1*' rồi Esc (HUỶ) vẫn hiện toast GRID-03 — commitCell(escVal) tưởng ô "chưa đỏ từ trước".
 *
 * Sơ đồ địa chỉ (usesDays bật, addrDetail tắt): A=STT B=Hạng Mục C=ĐVT D=Số Lượng E=Số Ngày
 * F=Đơn Giá G=Thành Tiền H=Ghi Chú.
 * ============================================================================
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
afterEach(async () => {
  await act(async () => { await new Promise((r) => setTimeout(r, 220)); });
  if (root) act(() => root!.unmount());
  hop?.remove(); root = null; hop = null; document.body.innerHTML = "";
});

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
const oDo = (row: number, f: string) => !!o(row, f).closest("td")?.classList.contains("cell-fx-error");
const coLoi = (it: ItemK, f: string) => !!(it as unknown as { _fxLoi?: Record<string, boolean> })._fxLoi?.[f];
const phim = (el: Element, init: KeyboardEventInit) => act(() => { el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init })); });
const go = (el: HTMLInputElement, chu: string) => act(() => { el.value = chu; el.dispatchEvent(new Event("input", { bubbles: true })); });
type Kho = Record<string, string>;
function suKienClip(kho: Kho) {
  const ev = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "clipboardData", { value: { getData: (k: string) => kho[k] ?? "", setData: (k: string, v: string) => { kho[k] = v; } } });
  return ev;
}
const dan = (kho: Kho) => act(() => { document.activeElement!.dispatchEvent(suKienClip(kho)); });
const toastChu = () => document.getElementById("toast-host")?.textContent ?? "";
const BAO_LOI = "Công thức không tính được";
const GOC = "=ROUND(F1*0,5)";

/** Hàng 0 gốc 1.050.000, hàng 1 ô đỏ lúc mở (525.000), hàng 2 trống để ↓ có chỗ đi. */
function moODo() {
  const items = [
    mk({ name: "Gốc", unitPrice: 1_050_000 }),
    mk({ name: "Mơ hồ", unitPrice: 525_000, formulas: { unitPrice: GOC } } as Partial<ItemK>),
    mk({ name: "Dưới" }),
  ];
  moLuoi(items);
  expect(oDo(1, "unitPrice")).toBe(true);
  return items;
}

describe("Esc trên ô đỏ `_fxLoi` — cờ và số phải sống qua lần rời ô kế tiếp", () => {
  it("F2 → gõ thêm rồi xoá về y nguyên → Esc → ↓: còn 525.000, ô vẫn đỏ, Ctrl+Z không lấy mất số", () => {
    const items = moODo();
    const el = o(1, "unitPrice");
    act(() => { el.focus(); });
    phim(el, { key: "F2" });
    go(el, GOC + "x");
    go(el, GOC);
    phim(el, { key: "Escape" });
    expect(coLoi(items[1], "unitPrice"), "Esc huỷ phiên gõ mà cờ lỗi tính mất").toBe(true);
    expect(oDo(1, "unitPrice"), "Esc xong ô hết đỏ").toBe(true);
    phim(el, { key: "ArrowDown" });
    expect(items[1].unitPrice, "rời ô sau Esc làm đơn giá thành 0").toBe(525_000);
    expect(items[1].formulas?.unitPrice).toBe(GOC);
    expect(oDo(1, "unitPrice")).toBe(true);
    phim(document.activeElement!, { key: "z", ctrlKey: true });
    expect(items[1].unitPrice, "Ctrl+Z làm mất số").toBe(525_000);
    expect(toastChu(), "chỉ HUỶ rồi đi qua mà vẫn báo lỗi").not.toContain(BAO_LOI);
  });

  it("chỉ thêm MỘT dấu cách rồi Esc, sau đó bấm chuột ra ngoài: số giữ, cờ giữ", () => {
    const items = moODo();
    const el = o(1, "unitPrice");
    act(() => { el.focus(); });
    phim(el, { key: "F2" });
    go(el, GOC + " ");
    phim(el, { key: "Escape" });
    act(() => { el.blur(); });
    expect(items[1].unitPrice, "rời ô sau Esc làm đơn giá thành 0").toBe(525_000);
    expect(coLoi(items[1], "unitPrice")).toBe(true);
    expect(oDo(1, "unitPrice")).toBe(true);
  });

  it("gõ '=F1*' rồi Esc (HUỶ): không toast GRID-03, số và cờ đỏ trả đúng", () => {
    const items = moODo();
    const el = o(1, "unitPrice");
    act(() => { el.focus(); });
    phim(el, { key: "F2" });
    for (const chu of ["=", "=F", "=F1", "=F1*"]) go(el, chu);
    phim(el, { key: "Escape" });
    expect(toastChu(), "Esc là HUỶ mà vẫn báo công thức không tính được").not.toContain(BAO_LOI);
    expect(items[1].formulas?.unitPrice).toBe(GOC);
    expect(items[1].unitPrice).toBe(525_000);
    expect(coLoi(items[1], "unitPrice")).toBe(true);
    expect(oDo(1, "unitPrice")).toBe(true);
    phim(el, { key: "ArrowDown" });
    expect(items[1].unitPrice).toBe(525_000);
    expect(oDo(1, "unitPrice")).toBe(true);
  });

  it("gõ công thức ĐÚNG rồi Esc: vẫn về công thức cũ, số cũ, ô đỏ — Esc không phải là chốt", () => {
    const items = moODo();
    const el = o(1, "unitPrice");
    act(() => { el.focus(); });
    phim(el, { key: "F2" });
    go(el, "=ROUND(F1*0,5;0)");   // live ghi 525.000 và gỡ cờ — đúng khi đang gõ
    expect(coLoi(items[1], "unitPrice")).toBe(false);
    phim(el, { key: "Escape" });
    expect(items[1].formulas?.unitPrice).toBe(GOC);
    expect(items[1].unitPrice).toBe(525_000);
    expect(coLoi(items[1], "unitPrice")).toBe(true);
    expect(toastChu()).not.toContain(BAO_LOI);
  });

  it("ô KHÔNG đỏ: gõ dở rồi Esc vẫn như cũ — không tự nhiên bật cờ", () => {
    const items = [mk({ name: "Gốc", unitPrice: 1_050_000 }), mk({ name: "Đúng", unitPrice: 525_000, formulas: { unitPrice: "=ROUND(F1*0,5;0)" } } as Partial<ItemK>), mk({})];
    moLuoi(items);
    const el = o(1, "unitPrice");
    act(() => { el.focus(); });
    phim(el, { key: "F2" });
    go(el, "=F1*");
    phim(el, { key: "Escape" });
    phim(el, { key: "ArrowDown" });
    expect(items[1].unitPrice).toBe(525_000);
    expect(coLoi(items[1], "unitPrice")).toBe(false);
    expect(oDo(1, "unitPrice")).toBe(false);
    expect(toastChu()).not.toContain(BAO_LOI);
  });

  // Dán / lùi / tiến khi đang đứng ở ô dời mốc Esc (escVal) theo nội dung mới (syncActiveCell — L6), nhưng
  // số và cờ đỏ lúc vào ô (escSo/escLoi) thì trước đây không: Esc trả công thức vừa dán kèm SỐ của công
  // thức đã bị dán đè. Mốc cờ mới (escLoi) phải đi cùng escVal, kẻo Esc tô đỏ ô vừa dán số sạch.
  it("dán số vào ô ĐỎ đang đứng rồi gõ + Esc: về SỐ VỪA DÁN, không đem cờ đỏ lúc vào ô về", () => {
    const items = moODo();
    const el = o(1, "unitPrice");
    act(() => { el.focus(); });
    dan({ "text/plain": "700" });
    expect(items[1].unitPrice).toBe(700);
    expect(items[1].formulas?.unitPrice).toBeUndefined();
    expect(coLoi(items[1], "unitPrice")).toBe(false);
    phim(el, { key: "F2" });
    go(el, "=F1");
    phim(el, { key: "Escape" });
    expect(items[1].formulas?.unitPrice).toBeUndefined();
    expect(items[1].unitPrice).toBe(700);
    expect(coLoi(items[1], "unitPrice"), "Esc đem cờ đỏ của công thức đã bị dán đè về").toBe(false);
    expect(oDo(1, "unitPrice")).toBe(false);
  });

  it("dán CÔNG THỨC hỏng vào ô ĐỎ đang đứng rồi gõ + Esc: về đúng số của lần dán, không phải số trước khi dán", () => {
    const items = moODo();
    const el = o(1, "unitPrice");
    act(() => { el.focus(); });
    dan({ "text/plain": "=F1/0" });
    const soSauDan = items[1].unitPrice;
    expect(items[1].formulas?.unitPrice).toBe("=F1/0");
    phim(el, { key: "F2" });
    go(el, "=F1/0+");
    phim(el, { key: "Escape" });
    expect(items[1].formulas?.unitPrice).toBe("=F1/0");
    expect(items[1].unitPrice, "Esc đem số của công thức đã bị dán đè về").toBe(soSauDan);
    expect(coLoi(items[1], "unitPrice")).toBe(true);
  });

  it("đi NGANG ô đỏ khi cờ đã rơi mất (phòng thủ ở commitCell): công thức y nguyên trả null → giữ số, tô đỏ", () => {
    // Mô phỏng một đường nào đó gỡ `_fxLoi` mà không bật lại (như hồi quy trên): rời ô không gõ gì
    // thì công thức vẫn là chuỗi đã lưu — ghi 0 đè số đang có là mất tiền, không phải "tính lại".
    const items = moODo();
    delete (items[1] as unknown as { _fxLoi?: unknown })._fxLoi;
    const el = o(1, "unitPrice");
    act(() => { el.focus(); });
    act(() => { el.blur(); });
    expect(items[1].unitPrice, "đi ngang ô mà đơn giá thành 0").toBe(525_000);
    expect(coLoi(items[1], "unitPrice")).toBe(true);
  });
});
