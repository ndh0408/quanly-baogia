/** @vitest-environment jsdom */
/**
 * ============================================================================
 * HAI LỖI NGƯỜI DÙNG BÁO TRÊN DEV (2026-09-23):
 *
 *  1. DÁN 129 dòng rồi Ctrl+Z → cả trang "Không tải được trang". Console:
 *       TypeError: Cannot read properties of undefined (reading 'quantityExact')
 *     Lùi làm mất 129 hàng nhưng vùng chọn vẫn phủ chúng; ô "Đếm/TB/Tổng" đọc `items[r]` của hàng
 *     đã mất → `qtyForAmount(undefined)` ném lỗi giữa lúc render.
 *
 *  2. Đang SỬA một ô ("…0m5H x 8 tấm|") mà bấm vào chỗ khác trong chữ để sửa giữa câu → con trỏ
 *     không tới chỗ bấm: nhánh "bấm 1 lần = chọn + khoá" chặn mặc định và khoá luôn ô đang sửa.
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
  ({ _k: nextK(), kind: "item", name: "", detail: "", unit: "m2", quantity: 1, days: 1, unitPrice: 0, notes: "", ...o }) as ItemK;

let root: Root | null = null;
let hop: HTMLDivElement | null = null;
afterEach(async () => {
  await act(async () => { await new Promise((r) => setTimeout(r, 220)); });
  if (root) act(() => root!.unmount());
  hop?.remove(); root = null; hop = null; document.body.innerHTML = "";
});

/** onChange PHẢI vẽ lại như màn soạn thật (QuoteEditor setState) — không vẽ lại thì hiệu ứng
 *  tô vùng chọn sau Ctrl+Z không chạy và lỗi 1 không bao giờ lộ ra trong bài kiểm. */
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
const o = (row: number, f: string) => hop!.querySelector(`tr[data-row="${row}"] [data-f="${f}"]`) as HTMLInputElement | HTMLTextAreaElement;
const phim = (el: Element, init: KeyboardEventInit) => act(() => { el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init })); });

describe("Ctrl+Z sau khi dán nhiều dòng", () => {
  it("lùi một lần dán 30 dòng: không sập, số hàng về như cũ", () => {
    const items = [mk({ name: "Gốc 1", quantity: 2, unitPrice: 100 }), mk({ name: "Gốc 2", quantity: 3, unitPrice: 200 })];
    moLuoi(items);
    const dong = Array.from({ length: 30 }, (_, k) => `Mới ${k}\t\tm2\t${k + 1}\t1000\t`).join("\n");
    const el = o(1, "name");
    act(() => { el.focus(); });
    const ev = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(ev, "clipboardData", { value: { getData: (k: string) => (k === "text/plain" ? dong : "") } });
    act(() => { el.dispatchEvent(ev); });
    expect(items.length).toBe(31);

    const loi = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => phim(o(1, "name") || document.body, { key: "z", ctrlKey: true })).not.toThrow();
    const cacLoi = loi.mock.calls.map((c) => String(c[0]));
    loi.mockRestore();
    expect(items.length, "Ctrl+Z không lùi được lần dán").toBe(2);
    expect(cacLoi.filter((m) => /quantityExact|Cannot read/.test(m)), "render ném lỗi khi lùi").toEqual([]);
    expect(hop!.querySelectorAll("tr[data-row]").length).toBe(2);
  });
});

describe("Bấm vào giữa chữ của ô ĐANG SỬA", () => {
  it("không khoá ô, không chặn mặc định → trình duyệt đặt con trỏ đúng chỗ bấm", () => {
    moLuoi([mk({ name: "Banner hàng rào: 0m8W x 0m5H x 8 tấm", unit: "m2" })]);
    const el = o(0, "unit") as HTMLInputElement;
    act(() => { el.focus(); });
    // Gõ đè = vào chế độ sửa.
    phim(el, { key: "b" });
    act(() => { el.value = "bộ"; el.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(el.readOnly).toBe(false);

    const bam = new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0, detail: 1 });
    act(() => { el.dispatchEvent(bam); });
    expect(bam.defaultPrevented, "cú bấm bị chặn → con trỏ không tới chỗ bấm").toBe(false);
    expect(el.readOnly, "đang sửa mà bấm vào ô lại bị khoá").toBe(false);
  });

  it("ô CHƯA sửa: bấm 1 lần vẫn là chọn + khoá (giữ nếp Excel cũ)", () => {
    moLuoi([mk({ name: "A", unit: "m2" }), mk({ name: "B", unit: "bộ" })]);
    const el = o(1, "unit") as HTMLInputElement;
    const bam = new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0, detail: 1 });
    act(() => { el.dispatchEvent(bam); });
    expect(bam.defaultPrevented).toBe(true);
    expect(el.readOnly).toBe(true);
  });
});
