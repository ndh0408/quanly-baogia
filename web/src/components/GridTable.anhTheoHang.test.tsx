/** @vitest-environment jsdom */
/**
 * ============================================================================
 * COPY / CẮT / DÁN HÀNG KHI BẬT CỘT "HÌNH ẢNH" — ẢNH PHẢI ĐI THEO HÀNG.
 *
 * Người dùng báo (2026-09-23): "copy paste nếu bật ô hình ảnh lên thì nó đang bị sai". Tái hiện
 * trên dev: cột Hình ảnh không nằm trong FIELDS (không chọn/gõ được), nên copy một hàng có ảnh rồi
 * dán sang hàng khác thì chữ + số sang, ẢNH Ở LẠI hàng cũ; dán đè lên hàng đang có ảnh thì hàng
 * đó giữ ảnh CŨ — ảnh lệch khỏi hạng mục của nó.
 *
 * jsdom không có DataTransfer/ClipboardEvent → dựng clipboard giả tối thiểu (setData/getData).
 * ============================================================================
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { GridTable } from "./GridTable";
import { nextK, type ItemK } from "../lib/gridShared";

vi.mock("../lib/venueCatalog", async (nhapGoc) => {
  const goc = await nhapGoc<typeof import("../lib/venueCatalog")>();
  return { ...goc, loadCatalog: () => Promise.resolve({ entries: [], venues: [] }) };
});
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ANH_A = "data:image/png;base64,QUFB";
const ANH_B = "data:image/png;base64,QkJC";
const mk = (o: Partial<ItemK>): ItemK =>
  ({ _k: nextK(), kind: "item", name: "", detail: "", unit: "m2", quantity: 1, days: 1, unitPrice: 0, notes: "", ...o }) as ItemK;

let root: Root | null = null;
let hop: HTMLDivElement | null = null;
afterEach(async () => {
  await act(async () => { await new Promise((r) => setTimeout(r, 220)); });
  if (root) act(() => root!.unmount());
  hop?.remove(); root = null; hop = null; document.body.innerHTML = "";
});

function moLuoi(items: ItemK[], showImages = true) {
  hop = document.createElement("div");
  document.body.appendChild(hop);
  root = createRoot(hop);
  act(() => root!.render(
    <GridTable items={items} usesDays={false} showDetail addrDetail numberSubs={false} editable
      internalNote={false} groupSubtotal={false} showImages={showImages} onShowImages={() => {}} onChange={() => {}} />,
  ));
}
const o = (row: number) => hop!.querySelector(`tr[data-row="${row}"] [data-f="name"]`) as HTMLTextAreaElement;

function clipGia() {
  const kho: Record<string, string> = {};
  return { setData: (k: string, v: string) => { kho[k] = v; }, getData: (k: string) => kho[k] ?? "" };
}
/** Chọn nguyên hàng (Shift+Space) rồi copy/cắt. */
function layHang(row: number, cat = false) {
  const el = o(row);
  act(() => { el.focus(); });
  act(() => { el.dispatchEvent(new KeyboardEvent("keydown", { key: " ", code: "Space", shiftKey: true, bubbles: true, cancelable: true })); });
  const cb = clipGia();
  const ev = new Event(cat ? "cut" : "copy", { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "clipboardData", { value: cb });
  act(() => { el.dispatchEvent(ev); });
  return cb;
}
function dan(row: number, cb: ReturnType<typeof clipGia>) {
  const el = o(row);
  act(() => { el.focus(); });
  const ev = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "clipboardData", { value: cb });
  act(() => { el.dispatchEvent(ev); });
}

describe("Copy/cắt/dán hàng khi bật cột Hình ảnh", () => {
  it("copy hàng có ảnh → dán sang hàng khác: ảnh đi theo, hàng gốc vẫn giữ ảnh", () => {
    const items = [mk({ name: "Backdrop", images: [ANH_A] }), mk({ name: "Standee" })];
    moLuoi(items);
    dan(1, layHang(0));
    expect(items[1].name).toBe("Backdrop");
    expect(items[1].images, "ảnh không đi theo hàng được dán").toEqual([ANH_A]);
    expect(items[0].images).toEqual([ANH_A]);
    expect(hop!.querySelectorAll('tr[data-row="1"] .cell-img').length, "ô ảnh trên màn hình chưa vẽ lại").toBe(1);
  });

  it("dán đè lên hàng đang có ảnh KHÁC → thay bằng ảnh của hàng nguồn (không giữ ảnh cũ lệch)", () => {
    const items = [mk({ name: "Không ảnh" }), mk({ name: "Có ảnh B", images: [ANH_B] })];
    moLuoi(items);
    dan(1, layHang(0));
    expect(items[1].name).toBe("Không ảnh");
    expect(items[1].images ?? [], "hàng đích còn giữ ảnh của hạng mục cũ").toEqual([]);
  });

  it("CẮT hàng có ảnh → dán chỗ khác: ảnh dời sang đích, hàng nguồn hết ảnh", () => {
    const items = [mk({ name: "Backdrop", images: [ANH_A] }), mk({ name: "" })];
    moLuoi(items);
    dan(1, layHang(0, true));
    expect(items[1].images).toEqual([ANH_A]);
    expect(items[0].images ?? []).toEqual([]);
  });

  it("cột Hình ảnh TẮT → không mang ảnh (không gắn ảnh vào chỗ người dùng không nhìn thấy)", () => {
    const items = [mk({ name: "Backdrop", images: [ANH_A] }), mk({ name: "Standee", images: [ANH_B] })];
    moLuoi(items, false);
    dan(1, layHang(0));
    expect(items[1].name).toBe("Backdrop");
    expect(items[1].images).toEqual([ANH_B]);
  });
});
