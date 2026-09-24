/** @vitest-environment jsdom */
/**
 * ============================================================================
 * BẤM QUA Ô CÔNG THỨC MÀ KHÔNG SỬA — báo giá KHÔNG được thành "chưa lưu" (kiểm trên dev 2026-09-24).
 *
 * Mở báo giá #264, bấm một ô SL "=2.75*2.05" rồi bấm ra chỗ khác (hoặc Enter/Esc): cờ "chưa lưu" bật,
 * rời trang bị hỏi "Rời khỏi mà chưa lưu?", bản nháp cục bộ được ghi. Gốc: rời ô thì commitCell chốt lại
 * chuỗi công thức, tính lại ra 5.637499999999999 (dấu phẩy động) trong khi máy chủ lưu 5.6375 → mốc
 * so trước/sau của onGridBlur khác → recomputeAll + onChange. L69 chỉ vá nhánh F2 → Esc.
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
  ({ _k: nextK(), kind: "item", name: "HCM", detail: "", unit: "m2", quantity: 1, days: 1, unitPrice: 95000, notes: "", ...o }) as ItemK;

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
const bam = (el: HTMLElement) => act(() => { el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0, detail: 1 })); el.focus(); });
const roi = (el: HTMLElement) => act(() => { el.blur(); });   // jsdom tự phát blur + focusout, như trình duyệt

// Số máy chủ lưu (4 số lẻ) còn tính lại trong JS ra số lệch dấu phẩy động.
const hang = () => [mk({ name: "Hallway", quantity: 5.6375, formulas: { quantity: "=2.75*2.05" } }), mk({ name: "Thi công", quantity: 23.78, formulas: { quantity: "=8.2*2.9" } })];

describe("Bấm qua ô công thức không sửa gì thì không đánh dấu thay đổi", () => {
  it("bấm ô SL công thức rồi rời ô (bấm chỗ khác): không onChange, số đã lưu giữ nguyên", async () => {
    const items = hang();
    moLuoi(items);
    bam(o(0, "quantity"));
    await cho(50);
    roi(o(0, "quantity"));
    await cho(250);
    expect(soLanDoi, "bấm qua ô công thức mà báo giá thành 'chưa lưu'").toBe(0);
    expect(items[0].quantity).toBe(5.6375);
  });

  it("bấm ô công thức rồi Enter xuống ô dưới (cũng là công thức): không onChange", async () => {
    const items = hang();
    moLuoi(items);
    bam(o(0, "quantity"));
    phim(o(0, "quantity"), { key: "Enter" });
    await cho(50);
    roi(document.activeElement as HTMLElement);
    await cho(250);
    expect(soLanDoi).toBe(0);
    expect(items[0].quantity).toBe(5.6375);
    expect(items[1].quantity).toBe(23.78);
  });

  it("bấm ô công thức rồi Esc: không onChange", async () => {
    const items = hang();
    moLuoi(items);
    bam(o(0, "quantity"));
    phim(o(0, "quantity"), { key: "Escape" });
    await cho(50);
    roi(o(0, "quantity"));
    await cho(250);
    expect(soLanDoi).toBe(0);
    expect(items[0].quantity).toBe(5.6375);
  });

  it("gác: sửa công thức THẬT (ra số khác) vẫn báo thay đổi và ghi số mới", async () => {
    const items = hang();
    moLuoi(items);
    const el = o(0, "quantity");
    bam(el);
    phim(el, { key: "F2" });
    act(() => { el.value = "=3*2"; el.dispatchEvent(new Event("input", { bubbles: true })); });
    roi(el);
    await cho(250);
    expect(soLanDoi).toBeGreaterThan(0);
    expect(items[0].quantity).toBe(6);
    expect(items[0].formulas?.quantity).toBe("=3*2");
  });
});
