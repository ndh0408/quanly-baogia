/** @vitest-environment jsdom */
/**
 * ============================================================================
 * CẮT–DÁN KHÔNG ĐƯỢC XOÁ NHẦM HÀNG KHI BẢNG ĐÃ ĐỔI SAU LÚC CẮT — soát toàn diện L7.
 *
 * Ctrl+X lưu CHỈ SỐ hàng nguồn (r0..r1); dán xong finishCutMove xoá trắng đúng các chỉ số đó. Chỉ số
 * không được dịch khi bảng đổi, và trạng thái cắt không bị huỷ khi người dùng sửa bảng:
 *   (1) cắt hàng Z rồi dán lên hàng NHÓM: onPaste chèn hàng trống dưới nhóm, Z trôi xuống một hàng
 *       nhưng finishCutMove vẫn xoá hàng cũ — tức hàng Y;
 *   (2) cắt C, bấm ✕ xoá hàng A rồi dán: hàng D bị xoá trắng;
 *   (3) cắt hàng 1, gõ nội dung mới vào hàng 1 (Excel huỷ chế độ cắt ở bước này), dán ở hàng 3:
 *       nội dung vừa gõ bị xoá.
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
  ({ _k: nextK(), kind: "item", name: "", unit: "", quantity: 0, days: 1, unitPrice: 0, notes: "", ...o }) as ItemK;

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

type Kho = Record<string, string>;
function suKienClip(loai: "cut" | "paste", kho: Kho) {
  const ev = new Event(loai, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "clipboardData", { value: { getData: (k: string) => kho[k] ?? "", setData: (k: string, v: string) => { kho[k] = v; } } });
  return ev;
}
/** Chọn nguyên hàng (Shift+Space) rồi Ctrl+X. */
function catHang(row: number): Kho {
  act(() => { o(row, "name").focus(); });
  phim(o(row, "name"), { key: " ", code: "Space", shiftKey: true });
  const kho: Kho = {};
  act(() => { o(row, "name").dispatchEvent(suKienClip("cut", kho)); });
  return kho;
}
function dan(row: number, kho: Kho) {
  act(() => { o(row, "name").focus(); });
  act(() => { o(row, "name").dispatchEvent(suKienClip("paste", kho)); });
}
const tom = (items: ItemK[]) => items.map((x) => `${x.kind === "section" ? "§" : ""}${x.name}:${x.quantity}x${x.unitPrice}`);

describe("L7 — cắt–dán chỉ xoá đúng hàng nguồn", () => {
  it("(1) cắt hàng Z rồi dán lên hàng NHÓM: Z dời lên đầu nhóm, Y còn nguyên", () => {
    const items = [{ ...mk({ name: "Nhóm A" }), kind: "section" } as ItemK, mk({ name: "X", quantity: 1, unitPrice: 100 }), mk({ name: "Y", quantity: 2, unitPrice: 200 }), mk({ name: "Z", quantity: 3, unitPrice: 300 })];
    moLuoi(items);
    const kho = catHang(3);
    dan(0, kho);
    expect(tom(items), "hàng Y bị xoá trắng thay cho Z").toEqual(["§Nhóm A:0x0", "Z:3x300", "X:1x100", "Y:2x200", ":0x0"]);
  });

  it("(2) cắt C, xoá hàng A rồi dán: không hàng nào khác bị xoá trắng", () => {
    const items = [mk({ name: "A", quantity: 1 }), mk({ name: "B", quantity: 2 }), mk({ name: "C", quantity: 3 }), mk({ name: "D", quantity: 4 })];
    moLuoi(items);
    const kho = catHang(2);
    act(() => { (hop!.querySelector('tr[data-row="0"] .rm-row') as HTMLButtonElement).click(); });
    expect(items.map((x) => x.name)).toEqual(["B", "C", "D"]);
    dan(0, kho);
    expect(items.find((x) => x.name === "D")?.quantity, "hàng D bị xoá trắng").toBe(4);
    expect(items[0].name).toBe("C");
  });

  it("(3) cắt hàng 1, gõ nội dung mới vào hàng 1, dán ở hàng 3: nội dung vừa gõ không bị xoá", () => {
    const items = [mk({ name: "A", unit: "cái" }), mk({ name: "B", unit: "cái" }), mk({ name: "C" }), mk({ name: "D" })];
    moLuoi(items);
    const kho = catHang(1);
    const u = o(1, "unit");
    act(() => { u.focus(); });
    phim(u, { key: "b" });
    act(() => { u.value = "bộ (mới gõ)"; u.dispatchEvent(new Event("input", { bubbles: true })); });
    phim(u, { key: "Enter" });
    dan(3, kho);
    expect(items[1].name).toBe("B");
    expect(items[1].unit, "nội dung vừa gõ ở hàng nguồn bị xoá").toBe("bộ (mới gõ)");
    expect(`${items[3].name}/${items[3].unit}`).toBe("B/cái");
  });

  it("cắt–dán bình thường vẫn là DI CHUYỂN (nguồn bị xoá, không để lại thuộc tính rác)", () => {
    const items = [mk({ name: "A", quantity: 1, unitPrice: 5 }), mk({ name: "B" }), mk({ name: "C" })];
    moLuoi(items);
    const kho = catHang(0);
    dan(2, kho);
    expect(tom(items)).toEqual([":0x0", "B:0x0", "A:1x5"]);
    expect(Object.keys(items[0]), "ô STT (ô tính) bị ghi thành thuộc tính của hạng mục").not.toContain("_stt");
  });
});
