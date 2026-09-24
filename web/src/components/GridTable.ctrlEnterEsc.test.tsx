/** @vitest-environment jsdom */
/**
 * ============================================================================
 * Ctrl+Enter (CHỐT rồi Ở LẠI ô) → F2 → Esc KHÔNG được trả ô về nội dung TRƯỚC Ctrl+Enter — soát
 * toàn diện đợt 4 (phản biện, lỗi có sẵn).
 *
 * Mốc Esc (dataset.escVal/escSo/escLoi) chỉ ghi lúc VÀO ô (onGridFocus) và sau lùi/tiến
 * (syncActiveCell). Nhánh Ctrl+Enter ở lại ô chốt nội dung mới mà không dời mốc, cũng không gỡ mốc
 * hoàn tác của phiên gõ. F2 → Esc (kể cả không gõ gì) thấy model lệch mốc cũ → commitCell(escVal CŨ)
 * đè giá trị vừa chốt, rồi `m.i === i && m.f === f` nên dropMark bỏ luôn mốc hoàn tác của phiên
 * Ctrl+Enter → Ctrl+Z / Ctrl+Y không lấy lại được.
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
const toastChu = () => document.getElementById("toast-host")?.textContent ?? "";
const BAO_LOI = "Công thức không tính được";
const GOC = "=ROUND(F1*0,5)";

/** Vào ô, F2, gõ `chu`, Ctrl+Enter — chốt và Ở LẠI ô. */
function chotOLai(el: HTMLInputElement, chu: string) {
  act(() => { el.focus(); });
  phim(el, { key: "F2" });
  go(el, chu);
  phim(el, { key: "Enter", ctrlKey: true });
  expect(document.activeElement, "Ctrl+Enter phải Ở LẠI ô").toBe(el);
}

describe("Ctrl+Enter rồi F2 → Esc: giữ nội dung vừa chốt, hoàn tác vẫn còn", () => {
  it("ô số thường 500: gõ 123, Ctrl+Enter, F2, Esc (không gõ) → còn 123; Ctrl+Z về 500; Ctrl+Y lại 123", () => {
    const items = [mk({ name: "A", unitPrice: 500 }), mk({ name: "B" })];
    moLuoi(items);
    const el = o(0, "unitPrice");
    chotOLai(el, "123");
    expect(items[0].unitPrice).toBe(123);
    phim(el, { key: "F2" });
    phim(el, { key: "Escape" });
    expect(items[0].unitPrice, "F2 → Esc không gõ gì mà trả ô về số TRƯỚC Ctrl+Enter").toBe(123);
    expect(el.value).toBe("123");
    phim(el, { key: "z", ctrlKey: true });
    expect(items[0].unitPrice, "mốc hoàn tác của phiên Ctrl+Enter bị Esc bỏ mất").toBe(500);
    phim(document.activeElement!, { key: "y", ctrlKey: true });
    expect(items[0].unitPrice).toBe(123);
  });

  it("ô số: Ctrl+Enter 123 → F2 → gõ 999 → Esc → về 123 (nội dung vừa chốt), không về 500", () => {
    const items = [mk({ name: "A", unitPrice: 500 }), mk({ name: "B" })];
    moLuoi(items);
    const el = o(0, "unitPrice");
    chotOLai(el, "123");
    phim(el, { key: "F2" });
    go(el, "999");
    expect(items[0].unitPrice).toBe(999);
    phim(el, { key: "Escape" });
    expect(items[0].unitPrice, "Esc huỷ phiên SAU Ctrl+Enter mà trả về số trước Ctrl+Enter").toBe(123);
    expect(el.value).toBe("123");
    phim(el, { key: "ArrowDown" });
    expect(items[0].unitPrice).toBe(123);
    phim(document.activeElement!, { key: "z", ctrlKey: true });
    expect(items[0].unitPrice, "Ctrl+Z phải lùi đúng phiên Ctrl+Enter").toBe(500);
  });

  it("ô chữ Hạng Mục: gõ 'Mới', Ctrl+Enter, F2, Esc → còn 'Mới'; Ctrl+Z về 'Cũ'", () => {
    const items = [mk({ name: "Cũ", unitPrice: 500 }), mk({ name: "B" })];
    moLuoi(items);
    const el = o(0, "name");
    chotOLai(el, "Mới");
    expect(items[0].name).toBe("Mới");
    phim(el, { key: "F2" });
    phim(el, { key: "Escape" });
    expect(items[0].name, "F2 → Esc trả Hạng Mục về chữ trước Ctrl+Enter").toBe("Mới");
    phim(el, { key: "z", ctrlKey: true });
    expect(items[0].name).toBe("Cũ");
  });

  it("ô ĐỎ '=ROUND(F1*0,5)' 525.000: gõ '=F1*2', Ctrl+Enter, F2, Esc → còn '=F1*2' 2.100.000, hết đỏ", () => {
    const items = [
      mk({ name: "Gốc", unitPrice: 1_050_000 }),
      mk({ name: "Mơ hồ", unitPrice: 525_000, formulas: { unitPrice: GOC } } as Partial<ItemK>),
      mk({ name: "Dưới" }),
    ];
    moLuoi(items);
    expect(oDo(1, "unitPrice")).toBe(true);
    const el = o(1, "unitPrice");
    chotOLai(el, "=F1*2");
    expect(items[1].formulas?.unitPrice).toBe("=F1*2");
    expect(items[1].unitPrice).toBe(2_100_000);
    expect(coLoi(items[1], "unitPrice")).toBe(false);
    phim(el, { key: "F2" });
    phim(el, { key: "Escape" });
    expect(items[1].formulas?.unitPrice, "F2 → Esc trả ô về công thức hỏng trước Ctrl+Enter").toBe("=F1*2");
    expect(items[1].unitPrice).toBe(2_100_000);
    expect(coLoi(items[1], "unitPrice"), "F2 → Esc bật lại cờ đỏ của công thức đã thay").toBe(false);
    expect(oDo(1, "unitPrice")).toBe(false);
    phim(el, { key: "ArrowDown" });
    expect(items[1].unitPrice).toBe(2_100_000);
    // Ctrl+Z lùi đúng phiên Ctrl+Enter: về công thức gốc, SỐ gốc — không phải 0.
    phim(document.activeElement!, { key: "z", ctrlKey: true });
    expect(items[1].formulas?.unitPrice).toBe(GOC);
    expect(items[1].unitPrice).toBe(525_000);
    expect(oDo(1, "unitPrice"), "lùi về công thức gốc hỏng thì ô phải đỏ lại").toBe(true);
    expect(toastChu()).not.toContain(BAO_LOI);
  });

  it("ô số chốt công thức HỎNG bằng Ctrl+Enter ('=F1*') rồi F2 → gõ → Esc: giữ cờ đỏ và số vừa chốt", () => {
    const items = [mk({ name: "Gốc", unitPrice: 1_050_000 }), mk({ name: "B", unitPrice: 700 }), mk({})];
    moLuoi(items);
    const el = o(1, "unitPrice");
    chotOLai(el, "=F1*");
    const soChot = items[1].unitPrice;
    expect(items[1].formulas?.unitPrice).toBe("=F1*");
    expect(coLoi(items[1], "unitPrice")).toBe(true);
    phim(el, { key: "F2" });
    go(el, "=F1*3");
    phim(el, { key: "Escape" });
    expect(items[1].formulas?.unitPrice, "Esc trả về nội dung TRƯỚC Ctrl+Enter").toBe("=F1*");
    expect(items[1].unitPrice).toBe(soChot);
    expect(coLoi(items[1], "unitPrice"), "Esc huỷ phiên mà mất cờ đỏ của công thức vừa chốt").toBe(true);
    expect(oDo(1, "unitPrice")).toBe(true);
    phim(el, { key: "ArrowDown" });
    expect(items[1].unitPrice).toBe(soChot);
    expect(oDo(1, "unitPrice")).toBe(true);
  });

  it("Ctrl+Enter ĐIỀN VÙNG (ô đang nhập nằm trong vùng) rồi F2 → Esc: ô giữ nội dung vừa điền", () => {
    const items = [mk({ name: "A", unitPrice: 100 }), mk({ name: "B", unitPrice: 200 }), mk({})];
    moLuoi(items);
    const el0 = o(0, "unitPrice");
    act(() => { el0.focus(); });
    phim(el0, { key: "ArrowDown", shiftKey: true });   // vùng F1:F2, ô đang nhập ở hàng 1
    const el = o(1, "unitPrice");
    expect(document.activeElement).toBe(el);
    phim(el, { key: "F2" });
    go(el, "77");
    phim(el, { key: "Enter", ctrlKey: true });
    expect(items.slice(0, 2).map((i) => i.unitPrice)).toEqual([77, 77]);
    expect(document.activeElement).toBe(el);
    phim(el, { key: "F2" });
    phim(el, { key: "Escape" });
    expect(items.slice(0, 2).map((i) => i.unitPrice), "F2 → Esc trả ô đang nhập về số trước khi điền").toEqual([77, 77]);
    phim(el, { key: "z", ctrlKey: true });
    expect(items.slice(0, 2).map((i) => i.unitPrice), "Ctrl+Z phải lùi cả lần điền vùng").toEqual([100, 200]);
  });

  it("F2 → Esc không gõ gì sau Ctrl+Enter KHÔNG báo đổi (không đánh dấu chưa lưu thêm lần nữa)", () => {
    const items = [mk({ name: "A", unitPrice: 500 }), mk({ name: "B" })];
    let doi = 0;
    function VoDem() {
      const [, b] = useState(0);
      return <GridTable items={items} usesDays showDetail={false} addrDetail={false} numberSubs={false} editable internalNote={false}
        groupSubtotal={false} fxBar onChange={() => { doi++; b((v) => v + 1); }} />;
    }
    hop = document.createElement("div"); document.body.appendChild(hop); root = createRoot(hop);
    act(() => root!.render(<VoDem />));
    const el = o(0, "unitPrice");
    chotOLai(el, "1234");
    const sau = doi;
    phim(el, { key: "F2" });
    phim(el, { key: "Escape" });
    expect(items[0].unitPrice).toBe(1234);
    expect(doi, "F2 → Esc không gõ mà vẫn gọi onChange").toBe(sau);
  });
});
