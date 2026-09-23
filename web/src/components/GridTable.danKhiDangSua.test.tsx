/** @vitest-environment jsdom */
/**
 * ============================================================================
 * DÁN KHI ĐANG SỬA TRONG Ô — soát toàn diện L23, L24.
 *
 * L23: đang gõ dở công thức "=D1*" trong ô số mà Ctrl+V "2" → nhánh "1 ô SỐ" luôn chặn mặc định và
 *      ghi đè CẢ Ô: công thức đang gõ mất, Đơn giá = 2 (Excel ở chế độ sửa: "=D1*2").
 * L24: đang sửa ô chữ mà dán MỘT ô chép TRONG app: text/plain là TSV RFC-4180 nên ô có xuống dòng
 *      hoặc dấu " được bọc "…" — trình duyệt chèn nguyên văn, ô nhận thêm dấu ngoặc kép.
 *
 * jsdom không mô phỏng bước trình duyệt tự chèn chữ khi không bị chặn mặc định — bài kiểm tra
 * defaultPrevented và tự làm bước chèn đó (gán value + phát input) như trình duyệt thật.
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
    groupSubtotal={false} onChange={() => b((v) => v + 1)} />;
}
function moLuoi(items: ItemK[]) {
  hop = document.createElement("div"); document.body.appendChild(hop); root = createRoot(hop);
  act(() => root!.render(<Vo items={items} />));
}
const o = (row: number, f: string) => hop!.querySelector(`tr[data-row="${row}"] [data-f="${f}"]`) as HTMLInputElement & HTMLTextAreaElement;
const phim = (el: Element, init: KeyboardEventInit) => act(() => { el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init })); });
const go = (el: HTMLInputElement | HTMLTextAreaElement, chu: string) => act(() => { el.value = chu; try { el.setSelectionRange(chu.length, chu.length); } catch { /* */ } el.dispatchEvent(new Event("input", { bubbles: true })); });

type Kho = Record<string, string>;
function suKienClip(loai: "copy" | "paste", kho: Kho) {
  const ev = new Event(loai, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "clipboardData", { value: { getData: (k: string) => kho[k] ?? "", setData: (k: string, v: string) => { kho[k] = v; } } });
  return ev;
}
const chep = (): Kho => { const kho: Kho = {}; act(() => { document.activeElement!.dispatchEvent(suKienClip("copy", kho)); }); return kho; };
function dan(kho: Kho | string) {
  const ev = suKienClip("paste", typeof kho === "string" ? { "text/plain": kho } : kho);
  act(() => { document.activeElement!.dispatchEvent(ev); });
  return ev;
}
/** Bước trình duyệt tự làm khi paste KHÔNG bị chặn: chèn text/plain tại con trỏ. */
function trinhDuyetChen(el: HTMLInputElement | HTMLTextAreaElement, chu: string) {
  const s = el.selectionStart ?? el.value.length, t = el.selectionEnd ?? s;
  go(el, el.value.slice(0, s) + chu + el.value.slice(t));
}

describe("L23 — đang gõ dở công thức trong ô số mà Ctrl+V: chèn tại con trỏ, không xoá công thức", () => {
  it("'=D1*' rồi dán '2' → '=D1*2' (Excel ở chế độ sửa)", () => {
    const items = [mk({ quantity: 3 }), mk({})];
    moLuoi(items);
    const el = o(1, "unitPrice");
    act(() => { el.focus(); });
    phim(el, { key: "=" });              // gõ là đè → vào chế độ gõ
    go(el, "=D1*");
    const ev = dan("2");
    expect(ev.defaultPrevented, "dán ghi đè cả ô thay vì chèn tại con trỏ").toBe(false);
    expect(items[1].formulas?.unitPrice, "công thức đang gõ bị xoá").toBe("=D1*");
    trinhDuyetChen(el, "2");
    phim(el, { key: "Enter" });
    expect(items[1].formulas?.unitPrice).toBe("=D1*2");
    expect(items[1].unitPrice).toBe(6);
  });

  it("đang sửa SỐ THƯỜNG: vẫn ghi đè cả ô bằng số đã đọc (tránh trình duyệt đọc sai '1,000,000')", () => {
    const items = [mk({ unitPrice: 12 })];
    moLuoi(items);
    const el = o(0, "unitPrice");
    act(() => { el.focus(); });
    phim(el, { key: "F2" });
    const ev = dan("1,000,000");
    expect(ev.defaultPrevented).toBe(true);
    expect(items[0].unitPrice).toBe(1000000);
  });
});

describe("L24 — đang sửa ô chữ, dán MỘT ô chép trong app: chèn đúng chữ, không kèm dấu ngoặc của TSV", () => {
  it("ô Hạng Mục 'Booth⏎HCM' dán vào ô đang F2: chèn đúng hai dòng, không có dấu \"", () => {
    const items = [mk({ name: "Booth\nHCM" }), mk({ name: "Standee " })];
    moLuoi(items);
    act(() => { o(0, "name").focus(); });
    const kho = chep();
    expect(kho["text/plain"]).toBe('"Booth\nHCM"');   // TSV RFC-4180 — đúng thứ Excel cần
    const el = o(1, "name");
    act(() => { el.focus(); });
    phim(el, { key: "F2" });
    const ev = dan(kho);
    if (!ev.defaultPrevented) trinhDuyetChen(el, kho["text/plain"]);   // trình duyệt chèn nguyên văn text/plain
    expect(el.value, "ô nhận nguyên văn TSV kèm dấu ngoặc kép").toBe("Standee Booth\nHCM");
    phim(el, { key: "Enter" });
    expect(items[1].name).toBe("Standee Booth\nHCM");
  });

  it("ô chữ có dấu \" ('Ke 2\" inch') dán vào ô ĐVT đang sửa: không thành '\"Ke 2\"\" inch\"'", () => {
    const items = [mk({ unit: 'Ke 2" inch' }), mk({ unit: "" })];
    moLuoi(items);
    act(() => { o(0, "unit").focus(); });
    const kho = chep();
    const el = o(1, "unit");
    act(() => { el.focus(); });
    phim(el, { key: "F2" });
    const ev = dan(kho);
    if (!ev.defaultPrevented) trinhDuyetChen(el, kho["text/plain"]);
    expect(el.value).toBe('Ke 2" inch');
  });

  it("dán chữ từ NGOÀI app khi đang sửa: vẫn để trình duyệt chèn (không đoán)", () => {
    const items = [mk({ name: "A" })];
    moLuoi(items);
    const el = o(0, "name");
    act(() => { el.focus(); });
    phim(el, { key: "F2" });
    const ev = dan('"trích dẫn"');
    expect(ev.defaultPrevented).toBe(false);
  });
});
