/** @vitest-environment jsdom */
//
// NHẬP SỐ LẺ BẰNG DẤU "," HOẶC "." (người dùng báo 2026-09-24: "đang lỗi chỗ nhập số lượng … xài thêm
// dấu , hay . á"). Tái hiện trên dev bằng trình duyệt thật:
//   · gõ 9 , 5 vào ô Số lượng → ô ra "95,"  (con trỏ bị đặt TRƯỚC dấu phẩy sau khi định dạng lại)
//   · gõ 2 . 5              → ô ra "25"   (liveFormat coi "." là dấu nghìn và xoá)
// Bài này gõ TỪNG PHÍM như trình duyệt: chèn ký tự tại con trỏ rồi phát InputEvent insertText.
import { describe, it, expect, afterEach, vi } from "vitest";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { GridTable, type GridTableProps } from "./GridTable";
import { nextK, type ItemK } from "../lib/gridShared";

vi.mock("../lib/venueCatalog", async (nhapGoc) => {
  const goc = await nhapGoc<typeof import("../lib/venueCatalog")>();
  return { ...goc, loadCatalog: () => Promise.resolve({ entries: [], venues: [] }) };
});

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Vo({ items, them }: { items: ItemK[]; them: Partial<GridTableProps> }) {
  const [, buoc] = useState(0);
  return (
    <GridTable items={items} usesDays={true} showDetail={false} numberSubs={false} editable={true}
      internalNote={false} groupSubtotal={false} onChange={() => buoc((v) => v + 1)} {...them} />
  );
}

let root: Root | null = null;
let hop: HTMLDivElement | null = null;
afterEach(() => { if (root) act(() => root!.unmount()); root = null; hop?.remove(); hop = null; document.body.innerHTML = ""; });

const hang = (): ItemK[] => [{ _k: nextK(), kind: "item", name: "Backdrop", unit: "m2", quantity: 70, days: 1, unitPrice: 385000 } as ItemK];
function moLuoi(items: ItemK[]) {
  hop = document.createElement("div");
  document.body.appendChild(hop);
  root = createRoot(hop);
  act(() => root!.render(<Vo items={items} them={{}} />));
  return items;
}
const o = (f: string) => hop!.querySelector(`tr[data-row="0"] [data-f="${f}"]`) as HTMLInputElement;

/** Gõ từng ký tự như trình duyệt: phím đầu trên ô đang CHỌN là "gõ để thay" (Excel), sau đó chèn tại con trỏ. */
function go(el: HTMLInputElement, chuoi: string) {
  act(() => { el.focus(); });
  for (const ch of chuoi) {
    act(() => { el.dispatchEvent(new KeyboardEvent("keydown", { key: ch, bubbles: true, cancelable: true })); });
    act(() => {
      const a = el.selectionStart ?? el.value.length, b = el.selectionEnd ?? a;
      el.value = el.value.slice(0, a) + ch + el.value.slice(b);
      el.setSelectionRange(a + 1, a + 1);
      el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: ch }));
    });
  }
}

describe("nhập số lẻ trong lưới", () => {
  it('Số lượng: gõ "9,5" → ô hiện 9,5 và model = 9.5 (không phải "95,")', () => {
    const items = moLuoi(hang());
    go(o("quantity"), "9,5");
    expect(o("quantity").value).toBe("9,5");
    expect(items[0].quantity).toBe(9.5);
  });

  it('Số lượng: gõ "2.5" → dấu chấm là THẬP PHÂN, ô hiện 2,5 và model = 2.5 (không phải 25)', () => {
    const items = moLuoi(hang());
    go(o("quantity"), "2.5");
    expect(o("quantity").value).toBe("2,5");
    expect(items[0].quantity).toBe(2.5);
  });

  it('Số lượng: "0,125" → 0.125', () => {
    const items = moLuoi(hang());
    go(o("quantity"), "0,125");
    expect(o("quantity").value).toBe("0,125");
    expect(items[0].quantity).toBe(0.125);
  });

  it('Số lượng: "13.524" → 13,524 (dấu chấm là thập phân, không phải 13524)', () => {
    const items = moLuoi(hang());
    go(o("quantity"), "13.524");
    expect(o("quantity").value).toBe("13,524");
    expect(items[0].quantity).toBe(13.524);
  });

  it('Số ngày: gõ "1.5" → 1,5 ngày', () => {
    const items = moLuoi(hang());
    go(o("days"), "1.5");
    expect(o("days").value).toBe("1,5");
    expect(items[0].days).toBe(1.5);
  });

  it('Đơn giá GIỮ luật cũ: "250.000" gõ tay là tiền có dấu nghìn → 250000', () => {
    const items = moLuoi(hang());
    go(o("unitPrice"), "250.000");
    expect(o("unitPrice").value).toBe("250.000");
    expect(items[0].unitPrice).toBe(250000);
  });

  it("Số lượng nguyên lớn vẫn gom nghìn: gõ 1500 → 1.500, model 1500", () => {
    const items = moLuoi(hang());
    go(o("quantity"), "1500");
    expect(o("quantity").value).toBe("1.500");
    expect(items[0].quantity).toBe(1500);
  });
});
