/** @vitest-environment jsdom */
/**
 * ============================================================================
 * Ô ĐANG CHỌN PHẢI THEO MODEL SAU DÁN / ĐIỀN — soát toàn diện L6.
 *
 * Effect đồng bộ ô sau mỗi lượt vẽ BỎ QUA ô đang giữ tiêu điểm (để khỏi cướp chữ đang gõ), còn
 * onGridBlur luôn chốt `el.value` vào model. Các thao tác ghi hàng loạt không tự vẽ lại ô đang
 * focus, nên ô vẫn hiện số CŨ trong khi model, thanh fx và Thành Tiền đã theo số mới — rời ô là số
 * cũ bị ghi đè ngược vào model, công thức vừa dán mất:
 *   (a) dán MỘT công thức vào ô số đang chọn;
 *   (b) Shift+↓ rồi dán 1 giá trị ra cả vùng (tiêu điểm đã xuống ô dưới);
 *   (c) dán khối mà ô đầu (đang focus) nhận công thức;
 *   (d) Shift+↓ rồi Ctrl+D.
 *
 * Sơ đồ địa chỉ (showDetail=false): A=STT B=Hạng Mục C=ĐVT D=Số Lượng E=Đơn Giá F=Thành Tiền G=Ghi Chú
 * ============================================================================
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { GridTable } from "./GridTable";
import { nextK, type ItemK } from "../lib/gridShared";

vi.mock("../lib/venueCatalog", async (g) => ({ ...(await g<typeof import("../lib/venueCatalog")>()), loadCatalog: () => Promise.resolve({ entries: [], venues: [] }) }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mk = (o: Partial<ItemK>): ItemK =>
  ({ _k: nextK(), kind: "item", name: "", unit: "m2", quantity: 1, days: 1, unitPrice: 0, notes: "", ...o }) as ItemK;

let root: Root | null = null;
let hop: HTMLDivElement | null = null;
afterEach(async () => {
  await act(async () => { await new Promise((r) => setTimeout(r, 220)); });
  if (root) act(() => root!.unmount());
  hop?.remove(); root = null; hop = null; document.body.innerHTML = "";
});

function Vo({ items }: { items: ItemK[] }) {
  const [, b] = useState(0);
  return <GridTable items={items} usesDays={false} showDetail={false} numberSubs={false} editable internalNote={false}
    groupSubtotal={false} fxBar onChange={() => b((v) => v + 1)} />;
}
function moLuoi(items: ItemK[]) {
  hop = document.createElement("div"); document.body.appendChild(hop); root = createRoot(hop);
  act(() => root!.render(<Vo items={items} />));
}
const o = (row: number, f: string) => hop!.querySelector(`tr[data-row="${row}"] [data-f="${f}"]`) as HTMLInputElement & HTMLTextAreaElement;
const phim = (el: Element, init: KeyboardEventInit) => act(() => { el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init })); });
const chon = (row: number, f: string) => act(() => { o(row, f).focus(); });

type Kho = Record<string, string>;
function suKienClip(loai: "copy" | "paste", kho: Kho) {
  const ev = new Event(loai, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "clipboardData", { value: { getData: (k: string) => kho[k] ?? "", setData: (k: string, v: string) => { kho[k] = v; } } });
  return ev;
}
const chep = (): Kho => { const kho: Kho = {}; act(() => { document.activeElement!.dispatchEvent(suKienClip("copy", kho)); }); return kho; };
const dan = (kho: Kho | string) => act(() => { document.activeElement!.dispatchEvent(suKienClip("paste", typeof kho === "string" ? { "text/plain": kho } : kho)); });

describe("L6 — ô đang chọn theo model sau dán/điền; rời ô không ghi đè số cũ", () => {
  it("(a) dán MỘT công thức vào ô Đơn giá đang chọn → ô hiện công thức, rời ô vẫn giữ công thức", () => {
    const items = [mk({ quantity: 3 }), mk({ quantity: 1, unitPrice: 100 })];
    moLuoi(items);
    chon(1, "unitPrice");
    dan("=D1*2");
    expect(items[1].formulas?.unitPrice).toBe("=D1*2");
    expect(o(1, "unitPrice").value, "ô đang chọn còn hiện số cũ").toBe("=D1*2");
    chon(0, "name");   // rời ô
    expect(items[1].formulas?.unitPrice, "rời ô làm mất công thức vừa dán").toBe("=D1*2");
    expect(items[1].unitPrice).toBe(6);
  });

  it("(a') chép ô công thức TRONG app rồi dán vào ô số đang chọn → rời ô vẫn còn công thức", () => {
    const items = [mk({ quantity: 3, unitPrice: 6, formulas: { unitPrice: "=D1*2" } }), mk({ quantity: 1, unitPrice: 100 })];
    moLuoi(items);
    chon(0, "unitPrice");
    const kho = chep();
    chon(1, "unitPrice");
    dan(kho);
    chon(0, "name");
    expect(items[1].formulas?.unitPrice, "công thức dán vào bị ghi đè bằng số cũ").toBeTruthy();
    expect(items[1].unitPrice).not.toBe(100);
  });

  it("(b) Shift+↓ rồi dán 1 số ra vùng → ô dưới (đang focus) hiện số mới, rời ô không trả số cũ", () => {
    const items = [mk({ unitPrice: 100 }), mk({ unitPrice: 200 })];
    moLuoi(items);
    chon(0, "unitPrice");
    phim(document.activeElement!, { key: "ArrowDown", shiftKey: true });
    expect(document.activeElement).toBe(o(1, "unitPrice"));
    dan("500");
    expect([items[0].unitPrice, items[1].unitPrice]).toEqual([500, 500]);
    expect(o(1, "unitPrice").value).toBe("500");
    chon(0, "name");
    expect([items[0].unitPrice, items[1].unitPrice], "rời ô ghi số cũ đè lên số vừa dán").toEqual([500, 500]);
  });

  it("(c) dán khối [Đơn giá công thức | Ghi chú] → ô đầu (đang focus) hiện công thức, rời ô vẫn giữ", () => {
    const items = [mk({ quantity: 2, unitPrice: 20, notes: "x", formulas: { unitPrice: "=D1*10" } }), mk({ quantity: 3, unitPrice: 100 })];
    moLuoi(items);
    chon(0, "unitPrice");
    phim(document.activeElement!, { key: "ArrowRight", shiftKey: true });
    const kho = chep();
    chon(1, "unitPrice");
    dan(kho);
    expect(items[1].formulas?.unitPrice).toBe("=D2*10");
    expect(o(1, "unitPrice").value, "ô đang focus còn hiện số cũ").toBe("=D2*10");
    chon(0, "name");
    expect(items[1].formulas?.unitPrice, "rời ô làm mất công thức vừa dán").toBe("=D2*10");
    expect(items[1].unitPrice).toBe(30);
  });

  it("(d) Shift+↓ rồi Ctrl+D → ô dưới (đang focus) hiện số mới, rời ô không trả số cũ", () => {
    const items = [mk({ unitPrice: 100 }), mk({ unitPrice: 200 })];
    moLuoi(items);
    chon(0, "unitPrice");
    phim(document.activeElement!, { key: "ArrowDown", shiftKey: true });
    phim(document.activeElement!, { key: "d", ctrlKey: true });
    expect([items[0].unitPrice, items[1].unitPrice]).toEqual([100, 100]);
    expect(o(1, "unitPrice").value).toBe("100");
    chon(0, "name");
    expect([items[0].unitPrice, items[1].unitPrice], "rời ô ghi số cũ đè lên số vừa điền").toEqual([100, 100]);
  });

  it("(e) Shift+↓ rồi dán KHỐI 2 dòng → tiêu điểm về ô đầu, ô dưới (vừa được dán) không bị chốt số cũ", () => {
    const items = [mk({ unitPrice: 100 }), mk({ unitPrice: 200 })];
    moLuoi(items);
    chon(0, "unitPrice");
    phim(document.activeElement!, { key: "ArrowDown", shiftKey: true });
    dan("500\r\n600\r\n");
    expect(document.activeElement).toBe(o(0, "unitPrice"));
    expect([items[0].unitPrice, items[1].unitPrice], "blur của ô dưới chốt lại số cũ").toEqual([500, 600]);
  });

  it("(f) dán khối lên hàng NHÓM khi tiêu điểm ở hàng dưới: hàng bị đẩy xuống giữ nguyên dữ liệu của nó", () => {
    const items = [{ ...mk({ name: "Nhóm G" }), kind: "section" } as ItemK, mk({ name: "X", unit: "cái" }), mk({ name: "Y", unit: "bộ" })];
    moLuoi(items);
    chon(0, "name");
    phim(document.activeElement!, { key: "ArrowDown", shiftKey: true });
    expect(document.activeElement).toBe(o(1, "name"));
    dan("Mới 1\tm2\r\nMới 2\tm3\r\n");
    expect(items.map((x) => x.name)).toEqual(["Nhóm G", "Mới 1", "Mới 2", "X", "Y"]);
    chon(0, "name");
    expect(items.map((x) => `${x.name}/${x.unit}`), "ô cũ đang focus ghi nhầm vào hàng khác").toEqual(["Nhóm G/m2", "Mới 1/m2", "Mới 2/m3", "X/cái", "Y/bộ"]);
  });

  it("đang GÕ trong ô (chưa chốt) thì lượt vẽ lại không cướp chữ đang gõ", async () => {
    const items = [mk({ unitPrice: 100 }), mk({ unitPrice: 200 })];
    moLuoi(items);
    chon(1, "unitPrice");
    phim(o(1, "unitPrice"), { key: "7" });   // gõ là đè: ô rỗng, vào chế độ gõ
    act(() => { const el = o(1, "unitPrice"); el.value = "7"; el.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => { await new Promise((r) => setTimeout(r, 220)); });   // qua lượt vẽ hoãn 180ms
    expect(o(1, "unitPrice").value).toBe("7");
  });
});
