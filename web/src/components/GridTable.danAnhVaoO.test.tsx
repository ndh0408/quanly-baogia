/** @vitest-environment jsdom */
/**
 * ============================================================================
 * DÁN ẢNH (Ctrl+V) VÀO Ô "HÌNH ẢNH" CỦA LƯỚI — yêu cầu chủ repo 2026-10-06.
 *
 * Trước đây ô hình ảnh chỉ có nút "＋" chọn tệp; ô không nhận tiêu điểm, và sự kiện paste rơi vào
 * nhánh dán ô chung (đọc text/plain, dán vào ô nhớ lần trước) — ảnh chụp màn hình bị bỏ qua.
 * Nay: ô ảnh nhận tiêu điểm (tabIndex), Ctrl+V lấy ảnh trong clipboard đi đúng đường chọn tệp
 * (addImages → fileToImg: nén, tối đa 10 ảnh/ô, một mốc hoàn tác); dán CHỮ vào ô ảnh không ghi gì
 * vào ô nào; Ctrl+V ở ô chữ vẫn dán ô như cũ.
 *
 * jsdom không giải mã ảnh → Image giả gọi onload ngay; canvas.getContext trả null → fileToImg trả
 * nguyên data-URL đọc được (nhánh dự phòng) — đủ để đọc lại nội dung tệp đã dán.
 * ============================================================================
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { GridTable, anhTrongClipboard } from "./GridTable";
import { nextK, type ItemK } from "../lib/gridShared";

vi.mock("../lib/venueCatalog", async (nhapGoc) => {
  const goc = await nhapGoc<typeof import("../lib/venueCatalog")>();
  return { ...goc, loadCatalog: () => Promise.resolve({ entries: [], venues: [] }) };
});
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class AnhGia {
  onload: null | (() => void) = null;
  onerror: null | (() => void) = null;
  width = 20; height = 10;
  set src(_v: string) { setTimeout(() => this.onload?.(), 0); }
}
beforeEach(() => {
  vi.stubGlobal("Image", AnhGia);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});

const mk = (o: Partial<ItemK>): ItemK =>
  ({ _k: nextK(), kind: "item", name: "", detail: "", unit: "m2", quantity: 1, days: 1, unitPrice: 0, notes: "", ...o }) as ItemK;

let root: Root | null = null;
let hop: HTMLDivElement | null = null;
afterEach(async () => {
  await act(async () => { await new Promise((r) => setTimeout(r, 220)); });
  if (root) act(() => root!.unmount());
  hop?.remove(); root = null; hop = null; document.body.innerHTML = "";
  vi.unstubAllGlobals(); vi.restoreAllMocks();
});

function Vo({ items, editable = true }: { items: ItemK[]; editable?: boolean }) {
  const [, buoc] = useState(0);
  return (
    <GridTable items={items} usesDays={false} showDetail={false} numberSubs={false} editable={editable} internalNote={false}
      groupSubtotal={false} showImages onShowImages={() => {}} onChange={() => buoc((v) => v + 1)} />
  );
}
function moLuoi(items: ItemK[], editable = true) {
  hop = document.createElement("div");
  document.body.appendChild(hop);
  root = createRoot(hop);
  act(() => root!.render(<Vo items={items} editable={editable} />));
}
const tep = (ten: string, type = "image/png") => new File([ten], ten + ".png", { type });
type Kho = { text?: string; anh?: File[]; quaFiles?: boolean };
/** Sự kiện paste giả — clipboardData có getData + items (kind "file") + files như trình duyệt thật. */
function suKienDan({ text = "", anh = [], quaFiles = false }: Kho) {
  const ev = new Event("paste", { bubbles: true, cancelable: true });
  const items = quaFiles ? [] : anh.map((f) => ({ kind: "file", type: f.type, getAsFile: () => f }));
  const cd = {
    getData: (k: string) => (k === "text/plain" || k === "text" ? text : ""),
    setData: () => {},
    items, files: quaFiles ? anh : [],
  };
  Object.defineProperty(ev, "clipboardData", { value: cd });
  return ev;
}
const oAnh = (row: number) => hop!.querySelector(`tr[data-row="${row}"] .cell-images`) as HTMLElement;
async function danVao(el: HTMLElement, kho: Kho) {
  act(() => { el.focus(); });
  const ev = suKienDan(kho);
  act(() => { el.dispatchEvent(ev); });
  await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
  return ev;
}
const anhCua = (it: ItemK) => ((it.images || []) as string[]).map((s) => atob(s.split(",")[1] ?? ""));
const toastChu = () => document.getElementById("toast-host")?.textContent ?? "";

describe("Ctrl+V ảnh vào ô Hình ảnh", () => {
  it("ô hình ảnh nhận tiêu điểm được (tabIndex) khi sửa được", () => {
    moLuoi([mk({ name: "A" })]);
    const o = oAnh(0);
    expect(o.tabIndex, "ô ảnh không nhận tiêu điểm → không có chỗ để Ctrl+V").toBe(0);
    act(() => { o.focus(); });
    expect(document.activeElement).toBe(o);
  });

  it("dán ảnh chụp màn hình vào hàng 2 → ảnh vào đúng hàng 2, hàng khác không đổi", async () => {
    const items = [mk({ name: "A" }), mk({ name: "B" })];
    moLuoi(items);
    const ev = await danVao(oAnh(1), { anh: [tep("chup")] });
    expect(ev.defaultPrevented).toBe(true);
    expect(anhCua(items[1])).toEqual(["chup"]);
    expect(anhCua(items[0])).toEqual([]);
    expect(items.map((x) => x.name)).toEqual(["A", "B"]);
  });

  it("ảnh chỉ có ở clipboardData.files (trình duyệt khác) cũng nhận; không dán đôi khi có ở items", async () => {
    const items = [mk({ name: "A" })];
    moLuoi(items);
    await danVao(oAnh(0), { anh: [tep("f1")], quaFiles: true });
    expect(anhCua(items[0])).toEqual(["f1"]);
    const f = tep("x");
    expect(anhTrongClipboard({ items: [{ kind: "file", type: "image/png", getAsFile: () => f }] as unknown as DataTransferItemList, files: [f] as unknown as FileList })).toHaveLength(1);
  });

  it("Ctrl+Z ngay tại ô ảnh gỡ ảnh vừa dán", async () => {
    const items = [mk({ name: "A", images: ["data:image/png;base64," + btoa("cu")] } as Partial<ItemK>)];
    moLuoi(items);
    const o = oAnh(0);
    await danVao(o, { anh: [tep("moi")] });
    expect(anhCua(items[0])).toEqual(["cu", "moi"]);
    act(() => { oAnh(0).focus(); });
    act(() => { document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true })); });
    expect(anhCua(items[0])).toEqual(["cu"]);
  });

  it("dán CHỮ vào ô ảnh → không ghi vào ô nào, báo ô chỉ nhận ảnh", async () => {
    const items = [mk({ name: "A", notes: "gc" }), mk({ name: "B" })];
    moLuoi(items);
    // Đứng ở ô Hạng Mục hàng 1 trước (focusRef nhớ ô này), rồi sang ô ảnh hàng 2 và dán chữ.
    act(() => { (hop!.querySelector('tr[data-row="0"] [data-f="name"]') as HTMLElement).focus(); });
    const ev = await danVao(oAnh(1), { text: "Chữ dán nhầm" });
    expect(ev.defaultPrevented).toBe(true);
    expect(items.map((x) => x.name)).toEqual(["A", "B"]);
    expect(items[0].notes).toBe("gc");
    expect(anhCua(items[1])).toEqual([]);
    expect(toastChu()).toContain("chỉ nhận");
  });

  it("đã đủ 10 ảnh → không thêm, báo tối đa", async () => {
    const day = Array.from({ length: 10 }, (_, k) => "data:image/png;base64," + btoa("a" + k));
    const items = [mk({ name: "A", images: day } as Partial<ItemK>)];
    moLuoi(items);
    await danVao(oAnh(0), { anh: [tep("thua")] });
    expect((items[0].images as string[]).length).toBe(10);
    expect(toastChu()).toContain("Tối đa 10");
  });

  it("lưới CHỈ XEM → ô ảnh không nhận tiêu điểm, dán ảnh không đổi gì", async () => {
    const items = [mk({ name: "A" })];
    moLuoi(items, false);
    const o = oAnh(0);
    expect(o.hasAttribute("tabindex")).toBe(false);
    o.dispatchEvent(suKienDan({ anh: [tep("x")] }));
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(anhCua(items[0])).toEqual([]);
  });

  it("Ctrl+V chữ ở ô Hạng Mục vẫn dán ô như cũ (không bị nhánh ảnh nuốt)", async () => {
    const items = [mk({ name: "A" }), mk({ name: "B" })];
    moLuoi(items);
    const ten = hop!.querySelector('tr[data-row="1"] [data-f="name"]') as HTMLElement;
    await danVao(ten, { text: "Mới" });
    expect(items[1].name).toBe("Mới");
    expect(anhCua(items[1])).toEqual([]);
  });
});
