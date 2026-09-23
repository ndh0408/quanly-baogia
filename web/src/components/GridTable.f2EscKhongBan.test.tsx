/** @vitest-environment jsdom */
/**
 * ============================================================================
 * F2 RỒI Esc MÀ KHÔNG SỬA GÌ — báo giá KHÔNG được thành "chưa lưu" — soát toàn diện L69 (trùng L71).
 *
 * Nhánh Esc khi đang sửa luôn chạy commitCell(escVal) + recomputeAll() + onChange(), không so với
 * model. escVal được gán lúc vào ô nên F2 → Esc lúc nào cũng gọi onChange: QuoteEditor mark() →
 * báo "Rời khỏi mà chưa lưu?" và ghi bản nháp cục bộ; recomputeAll còn tính lại mọi công thức ra
 * số thực lệch dấu phẩy động (5.637499999999999 thay cho 5.6375 máy chủ lưu). Nhánh blur thì đã
 * so before/after — rời ô bằng chuột/Tab không bẩn, chỉ Esc bị.
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
  ({ _k: nextK(), kind: "item", name: "HCM", detail: "", unit: "m2", quantity: 1, days: 1, unitPrice: 1000, notes: "", ...o }) as ItemK;

let root: Root | null = null;
let hop: HTMLDivElement | null = null;
afterEach(async () => {
  await act(async () => { await new Promise((r) => setTimeout(r, 220)); });
  if (root) act(() => root!.unmount());
  hop?.remove(); root = null; hop = null; document.body.innerHTML = "";
});

let soLanDoi = 0;
function Vo({ items }: { items: ItemK[] }) {
  const [, buoc] = useState(0);
  return (
    <GridTable items={items} usesDays={false} showDetail={false} numberSubs={false} editable
      internalNote={false} groupSubtotal={false} fxBar onChange={() => { soLanDoi++; buoc((v) => v + 1); }} />
  );
}
function moLuoi(items: ItemK[]) {
  soLanDoi = 0;
  hop = document.createElement("div");
  document.body.appendChild(hop);
  root = createRoot(hop);
  act(() => root!.render(<Vo items={items} />));
}
const o = (row: number, f: string) => hop!.querySelector(`tr[data-row="${row}"] [data-f="${f}"]`) as HTMLInputElement & HTMLTextAreaElement;
const phim = (el: Element, init: KeyboardEventInit) => act(() => { el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init })); });
const cho = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
/** Bấm chuột vào ô (chọn + khoá) — đúng đường người dùng. */
const bam = (el: HTMLElement) => act(() => { el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0, detail: 1 })); });

describe("L69 — F2 rồi Esc không sửa gì thì không đánh dấu thay đổi", () => {
  it("bấm ô HCM → Shift+↓ → F2 → Esc: không onChange, không đụng số công thức đã lưu", async () => {
    // SL công thức mà số lưu trên máy chủ đã làm tròn: tính lại ra 5.637499999999999.
    const items = [mk({}), mk({ name: "Bạt", quantity: 5.6375, formulas: { quantity: "=2.255*2.5" } })];
    moLuoi(items);
    bam(o(0, "name"));
    phim(document.activeElement!, { key: "ArrowDown", shiftKey: true });
    const el = document.activeElement as HTMLElement;
    phim(el, { key: "F2" });
    phim(el, { key: "Escape" });
    await cho(250);
    expect(soLanDoi, "F2 + Esc không sửa gì mà vẫn báo có thay đổi (báo giá thành 'chưa lưu')").toBe(0);
    expect(items[1].quantity, "Esc tính lại công thức, ghi số lệch dấu phẩy động").toBe(5.6375);
  });

  it("F2 rồi Esc ngay trên ô SỐ: không onChange", async () => {
    const items = [mk({ quantity: 3 })];
    moLuoi(items);
    bam(o(0, "quantity"));
    phim(o(0, "quantity"), { key: "F2" });
    phim(o(0, "quantity"), { key: "Escape" });
    await cho(250);
    expect(soLanDoi).toBe(0);
    expect(items[0].quantity).toBe(3);
  });

  it("ô ĐỎ vì tham chiếu hỏng: F2 → Esc, hay gõ dở rồi Esc, đều KHÔNG gỡ cờ đỏ", async () => {
    // Xoá hàng A mà C trỏ vào ("=E1" → #REF, xem soát L8) rồi huỷ sửa ô C: Esc là HUỶ, không phải
    // "đã kiểm tra, cho qua" — ô phải còn đỏ.
    const items = [mk({ name: "A", quantity: 6 }), mk({ name: "B", quantity: 4 }), mk({ name: "C", quantity: 6, formulas: { quantity: "=D1" } })];
    moLuoi(items);
    act(() => { (hop!.querySelector('tr[data-row="0"] .rm-row') as HTMLButtonElement).click(); });
    const coDo = () => !!(items[1] as unknown as { _fxWarn?: Record<string, boolean> })._fxWarn?.quantity && o(1, "quantity").closest("td")!.classList.contains("cell-fx-error");
    expect(coDo()).toBe(true);
    const el = o(1, "quantity");
    bam(el);
    phim(el, { key: "F2" });
    phim(el, { key: "Escape" });
    expect(coDo(), "F2 + Esc gỡ mất cờ đỏ").toBe(true);
    phim(el, { key: "F2" });
    act(() => { el.value = "=D1*9"; el.dispatchEvent(new Event("input", { bubbles: true })); });
    phim(el, { key: "Escape" });
    await cho(250);
    expect(items[1].formulas?.quantity).toBe("=D1");
    expect(coDo(), "gõ dở rồi Esc gỡ mất cờ đỏ — ô hỏng thành ô sạch im lặng").toBe(true);
  });

  it("gõ SL dở rồi Esc: VẪN tính lại ngay và báo thay đổi (giữ mục đích của 45b2f9d)", async () => {
    const items = [mk({ quantity: 2 })];
    moLuoi(items);
    const el = o(0, "quantity");
    bam(el);
    phim(el, { key: "7" });
    act(() => { el.value = "7"; el.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(items[0].quantity).toBe(7);
    const truoc = soLanDoi;
    phim(el, { key: "Escape" });
    expect(items[0].quantity).toBe(2);
    expect(soLanDoi, "huỷ số đang gõ mà tổng không được tính lại ngay").toBeGreaterThan(truoc);
    expect(hop!.querySelector('tr[data-row="0"] td.col-amount')!.textContent).toBe("2.000");
  });
});
