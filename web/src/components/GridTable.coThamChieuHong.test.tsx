/** @vitest-environment jsdom */
/**
 * ============================================================================
 * CỜ ĐỎ "THAM CHIẾU HỎNG" PHẢI SỐNG QUA recomputeAll — soát toàn diện L8.
 *
 * Ba đường bật cờ #REF (dán dịch ra ngoài bảng, Ctrl+D ra ngoài bảng, xoá hàng bị trỏ tới) và
 * đường dán khối Excel app xuất (retargetPastedFormulas → markWarn) đều GIỮ công thức gốc + bật
 * `_fxWarn` để ô tô đỏ. Nhưng ngay sau đó recomputeAll → ghiCoVong xoá `_fxWarn` của mọi công thức
 * tính ra số — mà công thức giữ nguyên dạng gốc thì gần như luôn tính ra số (trỏ sang hàng khác, hay
 * cột không có thì cellNum trả 0). Ô không đỏ, số sai được lưu mà không có dấu hiệu nào.
 *
 * Sơ đồ địa chỉ trong tệp (showDetail + addrDetail, không ngày):
 *   A=STT  B=Hạng Mục  C=Chi Tiết  D=ĐVT  E=Số Lượng  F=Đơn Giá  G=Thành Tiền  H=Ghi Chú
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
  ({ _k: nextK(), kind: "item", name: "", detail: "", unit: "m2", quantity: 1, days: 1, unitPrice: 1000, notes: "", ...o }) as ItemK;

let root: Root | null = null;
let hop: HTMLDivElement | null = null;
afterEach(async () => {
  await act(async () => { await new Promise((r) => setTimeout(r, 220)); });
  if (root) act(() => root!.unmount());
  hop?.remove(); root = null; hop = null; document.body.innerHTML = "";
});

/** onChange vẽ lại như màn soạn thật — không vẽ lại thì class ô đỏ không bao giờ lên DOM. */
function Vo({ items }: { items: ItemK[] }) {
  const [, buoc] = useState(0);
  return (
    <GridTable items={items} usesDays={false} showDetail addrDetail numberSubs={false} editable
      internalNote={false} groupSubtotal={false} fxBar onChange={() => buoc((v) => v + 1)} />
  );
}
function moLuoi(items: ItemK[]) {
  hop = document.createElement("div");
  document.body.appendChild(hop);
  root = createRoot(hop);
  act(() => root!.render(<Vo items={items} />));
}
const o = (row: number, f: string) => hop!.querySelector(`tr[data-row="${row}"] [data-f="${f}"]`) as HTMLInputElement & HTMLTextAreaElement;
const phim = (el: Element, init: KeyboardEventInit) => act(() => { el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init })); });
const coDo = (row: number, f: string) => !!o(row, f).closest("td")?.classList.contains("cell-fx-error");
const coWarn = (it: ItemK, f: string) => !!(it as unknown as { _fxWarn?: Record<string, boolean> })._fxWarn?.[f];

type Kho = Record<string, string>;
function suKienClip(loai: "copy" | "paste", kho: Kho) {
  const ev = new Event(loai, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "clipboardData", { value: { getData: (k: string) => kho[k] ?? "", setData: (k: string, v: string) => { kho[k] = v; } } });
  return ev;
}
/** Chọn nguyên các hàng [r0..r1] (Shift+↓ rồi Shift+Space) và chép. */
function chepHang(r0: number, r1: number): Kho {
  act(() => { o(r0, "name").focus(); });
  for (let r = r0; r < r1; r++) phim(document.activeElement!, { key: "ArrowDown", shiftKey: true });
  phim(document.activeElement!, { key: " ", code: "Space", shiftKey: true });
  const kho: Kho = {};
  act(() => { document.activeElement!.dispatchEvent(suKienClip("copy", kho)); });
  return kho;
}
function dan(row: number, kho: Kho) {
  const el = o(row, "name");
  act(() => { el.focus(); });
  act(() => { el.dispatchEvent(suKienClip("paste", kho)); });
}

describe("L8 — cờ đỏ tham chiếu hỏng không bị recomputeAll gỡ", () => {
  it("dán khối có công thức trỏ xuống vào CUỐI bảng: tham chiếu dịch theo bảng SAU khi nới (=E4*2), không kẹt =E2*2", () => {
    const items = [mk({ name: "A", quantity: 10, formulas: { quantity: "=E2*2" } }), mk({ name: "B", quantity: 5 }), mk({ name: "C", quantity: 9 })];
    moLuoi(items);
    const kho = chepHang(0, 1);
    items[1].quantity = 7;   // sửa SL hàng B sau khi chép → công thức kẹt hàng cũ sẽ ra 14 thay vì 10
    dan(2, kho);
    expect(items.length).toBe(4);
    expect(items[2].formulas?.quantity, "tham chiếu không dịch theo khối dán (Excel: =E4*2)").toBe("=E4*2");
    expect(items[2].quantity).toBe(10);
    expect(coWarn(items[2], "quantity")).toBe(false);
  });

  it("dán công thức dịch ra NGOÀI bảng (lên trên hàng 1): giữ công thức gốc, ô ĐỎ, không tính số từ hàng khác", () => {
    const items = [mk({ name: "X", quantity: 5 }), mk({ name: "Y", quantity: 4 }), mk({ name: "Z", quantity: 6, formulas: { quantity: "=E2*2" } })];
    moLuoi(items);
    dan(0, chepHang(2, 2));
    expect(items[0].formulas?.quantity).toBe("=E2*2");
    expect(coWarn(items[0], "quantity"), "cờ #REF bị recomputeAll gỡ").toBe(true);
    expect(coDo(0, "quantity"), "ô dịch ra ngoài bảng không tô đỏ").toBe(true);
    expect(items[0].quantity, "công thức #REF vẫn lặng lẽ lấy SL của hàng Y").not.toBe(8);
  });

  it("xoá hàng bị trỏ tới: ô trỏ vào nó ĐỎ và KHÔNG lặng lẽ lấy SL của hàng kế bên", () => {
    const items = [mk({ name: "A", quantity: 6 }), mk({ name: "B", quantity: 4 }), mk({ name: "C", quantity: 6, formulas: { quantity: "=E1" } })];
    moLuoi(items);
    act(() => { (hop!.querySelector('tr[data-row="0"] .rm-row') as HTMLButtonElement).click(); });
    expect(items.map((x) => x.name)).toEqual(["B", "C"]);
    expect(items[1].formulas?.quantity).toBe("=E1");
    expect(coWarn(items[1], "quantity"), "cờ #REF của hàng xoá bị gỡ ngay").toBe(true);
    expect(coDo(1, "quantity")).toBe(true);
    expect(items[1].quantity, "C lặng lẽ lấy SL của B").toBe(6);
  });

  it("Ctrl+D chép công thức xuống làm tham chiếu vượt đáy bảng: ô đích ĐỎ", () => {
    const items = [mk({ name: "A", quantity: 8, formulas: { quantity: "=E3*2" } }), mk({ name: "B", quantity: 1 }), mk({ name: "C", quantity: 4 })];
    moLuoi(items);
    act(() => { o(0, "quantity").focus(); });
    phim(document.activeElement!, { key: "ArrowDown", shiftKey: true });
    phim(document.activeElement!, { key: "d", ctrlKey: true });
    expect(items[1].formulas?.quantity).toBe("=E3*2");
    expect(coWarn(items[1], "quantity")).toBe(true);
    expect(coDo(1, "quantity"), "ô Ctrl+D ra ngoài bảng không tô đỏ").toBe(true);
  });

  it("dán khối Excel app xuất có '=Z99*2' (không dịch được): toast báo ô đỏ thì ô PHẢI đỏ", () => {
    const items = [mk({ name: "Cũ" })];
    moLuoi(items);
    const tsv = [
      "STT\tHạng Mục\tChi Tiết\tĐVT\tSố Lượng\tĐơn Giá\tThành Tiền\tGhi Chú",
      "A\tNhóm 1\t\t\t1\t\t\t",
      "1\tBanner\t\tm2\t2\t=Z99*2\t200.000\t",
    ].join("\n");
    act(() => { o(0, "name").focus(); });
    act(() => { o(0, "name").dispatchEvent(suKienClip("paste", { "text/plain": tsv })); });
    const hang = items.findIndex((x) => x.name === "Banner");
    expect(hang).toBeGreaterThanOrEqual(0);
    expect(items[hang].formulas?.unitPrice).toBe("=Z99*2");
    expect(coWarn(items[hang], "unitPrice"), "cờ 'không dịch được' bị gỡ").toBe(true);
    expect(coDo(hang, "unitPrice")).toBe(true);
  });

  /* ── RỜI Ô ĐỎ MÀ KHÔNG SỬA GÌ (phản biện L8) ────────────────────────────────────────────────
     onGridFocus hiện công thức gốc trong ô, rời ô thì onGridBlur (và Enter) chốt đúng chuỗi ấy qua
     commitCell — bản trước coi đó là "người dùng đã sửa ô": gỡ cờ rồi tính lại công thức gốc, nên
     C "=E1" (A đã xoá) lặng lẽ thành SL của B chỉ vì con trỏ đi ngang qua. */
  const xoaHangBiTro = () => {
    const items = [mk({ name: "A", quantity: 6 }), mk({ name: "B", quantity: 4 }), mk({ name: "C", quantity: 6, formulas: { quantity: "=E1" } })];
    moLuoi(items);
    act(() => { (hop!.querySelector('tr[data-row="0"] .rm-row') as HTMLButtonElement).click(); });
    expect(coWarn(items[1], "quantity")).toBe(true);
    return items;
  };

  it("lướt mũi tên qua ô đỏ: cờ còn, SL giữ nguyên, không lấy số của hàng khác", () => {
    const items = xoaHangBiTro();
    act(() => { o(1, "quantity").focus(); });
    phim(document.activeElement!, { key: "ArrowRight" });
    expect(document.activeElement).not.toBe(o(1, "quantity"));
    expect(coWarn(items[1], "quantity"), "đi ngang ô đỏ bằng mũi tên là gỡ cờ #REF").toBe(true);
    expect(coDo(1, "quantity")).toBe(true);
    expect(items[1].quantity, "C lặng lẽ lấy SL của B chỉ vì con trỏ đi qua").toBe(6);
    expect(items[1].formulas?.quantity).toBe("=E1");
  });

  it("Enter trên ô đỏ (không gõ gì): cờ còn, SL giữ nguyên", () => {
    const items = xoaHangBiTro();
    act(() => { o(1, "quantity").focus(); });
    phim(document.activeElement!, { key: "Enter" });
    expect(coWarn(items[1], "quantity"), "Enter không sửa gì mà gỡ cờ #REF").toBe(true);
    expect(coDo(1, "quantity")).toBe(true);
    expect(items[1].quantity).toBe(6);
  });

  it("F2 rồi Enter (không gõ gì): vẫn đỏ — chỉ GÕ vào ô mới là sửa", () => {
    const items = xoaHangBiTro();
    const el = o(1, "quantity");
    act(() => { el.focus(); });
    phim(el, { key: "F2" });
    phim(el, { key: "Enter" });
    expect(coWarn(items[1], "quantity")).toBe(true);
    expect(items[1].quantity).toBe(6);
  });

  it("dán khối Excel có '=Z99*2' rồi bấm vào ô đỏ, bấm sang ô khác: cờ còn, Đơn giá giữ nguyên", () => {
    const items = [mk({ name: "Cũ" })];
    moLuoi(items);
    const tsv = [
      "STT\tHạng Mục\tChi Tiết\tĐVT\tSố Lượng\tĐơn Giá\tThành Tiền\tGhi Chú",
      "A\tNhóm 1\t\t\t1\t\t\t",
      "1\tBanner\t\tm2\t2\t=Z99*2\t200.000\t",
    ].join("\n");
    act(() => { o(0, "name").focus(); });
    act(() => { o(0, "name").dispatchEvent(suKienClip("paste", { "text/plain": tsv })); });
    const hang = items.findIndex((x) => x.name === "Banner");
    const giaTruoc = items[hang].unitPrice;
    act(() => { o(hang, "unitPrice").focus(); });
    act(() => { o(hang, "notes").focus(); });
    expect(coWarn(items[hang], "unitPrice"), "toast bảo 'bấm vào kiểm tra' mà bấm vào rồi ra là mất cờ").toBe(true);
    expect(coDo(hang, "unitPrice")).toBe(true);
    expect(items[hang].unitPrice).toBe(giaTruoc);
  });

  it("GÕ lại công thức (dù y nguyên) rồi Enter = người dùng xác nhận → hết đỏ, tính theo bảng hiện tại", () => {
    const items = xoaHangBiTro();
    const el = o(1, "quantity");
    act(() => { el.focus(); });
    phim(el, { key: "F2" });
    act(() => { el.value = "=E1"; el.dispatchEvent(new Event("input", { bubbles: true })); });
    phim(el, { key: "Enter" });
    expect(coWarn(items[1], "quantity")).toBe(false);
    expect(items[1].quantity).toBe(4);
  });

  it("gõ dở trên ô đỏ rồi Esc: trả cả công thức, cờ lẫn SỐ lúc vào ô — không tính lại công thức gốc", () => {
    const items = xoaHangBiTro();
    const el = o(1, "quantity");
    act(() => { el.focus(); });
    phim(el, { key: "F2" });
    act(() => { el.value = "=E1*9"; el.dispatchEvent(new Event("input", { bubbles: true })); });
    phim(el, { key: "Escape" });
    expect(items[1].formulas?.quantity).toBe("=E1");
    expect(coWarn(items[1], "quantity")).toBe(true);
    expect(items[1].quantity, "Esc huỷ phiên gõ mà ô đỏ lại ăn SL của B").toBe(6);
    phim(el, { key: "ArrowDown" });
    expect(coWarn(items[1], "quantity"), "Esc trả cờ nhưng lần rời ô kế tiếp gỡ mất").toBe(true);
    expect(items[1].quantity).toBe(6);
  });

  it("gõ trên ô đỏ, SỬA VỀ đúng công thức gốc rồi Esc: vẫn trả SỐ lúc vào ô, Ctrl+Z không mất gì (soát toàn diện đợt 3 L8)", () => {
    const items = xoaHangBiTro();
    const el = o(1, "quantity");
    act(() => { el.focus(); });
    phim(el, { key: "F2" });
    act(() => { el.value = "=E1*9"; el.dispatchEvent(new Event("input", { bubbles: true })); });
    act(() => { el.value = "=E1"; el.dispatchEvent(new Event("input", { bubbles: true })); });   // onNumInput ghi live 4 (SL của B)
    phim(el, { key: "Escape" });
    expect(items[1].formulas?.quantity).toBe("=E1");
    expect(coWarn(items[1], "quantity")).toBe(true);
    expect(items[1].quantity, "Esc để lại số của hàng khác").toBe(6);
    phim(el, { key: "ArrowDown" });
    expect(items[1].quantity).toBe(6);
    expect(coWarn(items[1], "quantity")).toBe(true);
    // Phiên gõ đã huỷ trọn → Ctrl+Z lùi đúng thao tác thật trước đó (xoá hàng A), không kẹt số 4.
    phim(document.activeElement!, { key: "z", ctrlKey: true });
    expect(items.map((x) => x.name)).toEqual(["A", "B", "C"]);
    expect(items[2].quantity).toBe(6);
  });

  it("ô đỏ vì công thức đã lưu không tính được: gõ dở rồi Esc → số lúc vào ô, không thành 0", () => {
    const items = [mk({ name: "A", unitPrice: 1_050_000 }), mk({ name: "B", unitPrice: 525_000, formulas: { unitPrice: "=ROUND(F1*0,5)" } })];
    moLuoi(items);
    expect(coDo(1, "unitPrice")).toBe(true);
    const el = o(1, "unitPrice");
    act(() => { el.focus(); });
    phim(el, { key: "F2" });
    act(() => { el.value = "=F1"; el.dispatchEvent(new Event("input", { bubbles: true })); });   // live ghi 1.050.000
    phim(el, { key: "Escape" });
    expect(items[1].formulas?.unitPrice).toBe("=ROUND(F1*0,5)");
    expect(items[1].unitPrice, "Esc làm đơn giá thành 0 hoặc giữ số gõ dở").toBe(525_000);
    expect(coDo(1, "unitPrice")).toBe(true);
    // Gõ dở rồi SỬA VỀ đúng chuỗi gốc (live không tính được → model còn 1.050.000 của lần gõ trước) rồi Esc.
    act(() => { el.focus(); });
    phim(el, { key: "F2" });
    act(() => { el.value = "=F1"; el.dispatchEvent(new Event("input", { bubbles: true })); });
    act(() => { el.value = "=ROUND(F1*0,5)"; el.dispatchEvent(new Event("input", { bubbles: true })); });
    phim(el, { key: "Escape" });
    expect(items[1].unitPrice).toBe(525_000);
    expect(coDo(1, "unitPrice")).toBe(true);
  });

  it("sửa tay ô đỏ thành công thức đúng → hết đỏ (commitCell vẫn là nơi gỡ cờ)", () => {
    const items = [mk({ name: "A", quantity: 6 }), mk({ name: "B", quantity: 4 }), mk({ name: "C", quantity: 6, formulas: { quantity: "=E1" } })];
    moLuoi(items);
    act(() => { (hop!.querySelector('tr[data-row="0"] .rm-row') as HTMLButtonElement).click(); });
    const el = o(1, "quantity");
    act(() => { el.focus(); });
    phim(el, { key: "F2" });
    act(() => { el.value = "=E1*2"; el.dispatchEvent(new Event("input", { bubbles: true })); });
    phim(el, { key: "Enter" });
    expect(items[1].quantity).toBe(8);
    expect(coWarn(items[1], "quantity")).toBe(false);
    expect(coDo(1, "quantity")).toBe(false);
  });
});
