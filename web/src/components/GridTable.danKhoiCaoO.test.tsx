/** @vitest-environment jsdom */
/**
 * ============================================================================
 * DÁN KHỐI chữ nhiều dòng vào ô Ghi chú/Chi tiết ĐANG TRỐNG: ô phải cao lên — soát toàn diện L1.
 *
 * Ô trống lúc dựng lưới là textarea "chưa bẩn" (React 19 initTextarea chỉ gán value khi chuỗi khác
 * rỗng). Dán khối ghi đúng model; dòng vẽ lại, React ghi defaultValue và textarea chưa bẩn tự nhận
 * luôn nội dung mới. Lượt đồng bộ ô thấy `el.value === want` nên KHÔNG đo lại chiều cao; nhánh dán
 * khối, Ctrl+D, Redo cũng không tự đo. Ô giữ chiều cao một dòng, `overflow: hidden` giấu dòng 2 trở
 * đi — người dùng tưởng dán mất chữ. Bản vá 9600e7f chỉ sửa nhánh dán MỘT ô.
 *
 * jsdom không dàn trang nên autoGrow ghi "0px"; điều cần kiểm là ô ĐÃ được đo lại (chiều cao mốc
 * "7px" cắm vào trước thao tác phải bị ghi đè).
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
  ({ _k: nextK(), kind: "item", name: "Hạng", detail: "", unit: "m2", quantity: 1, days: 1, unitPrice: 1000, notes: "", ...o }) as ItemK;

let root: Root | null = null;
let hop: HTMLDivElement | null = null;
afterEach(async () => {
  await act(async () => { await new Promise((r) => setTimeout(r, 220)); });
  if (root) act(() => root!.unmount());
  hop?.remove(); root = null; hop = null; document.body.innerHTML = "";
});

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
const o = (row: number, f: string) => hop!.querySelector(`tr[data-row="${row}"] [data-f="${f}"]`) as HTMLTextAreaElement;
const phim = (el: Element, init: KeyboardEventInit) => act(() => { el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init })); });
const haiKhung = () => act(async () => { await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))); });
const MOC = "7px";
/** Chờ lượt đo lúc dựng lưới xong rồi cắm chiều cao MỐC vào các ô cần theo dõi. */
async function camMoc(...os: HTMLTextAreaElement[]) {
  await haiKhung();
  os.forEach((t) => { t.style.height = MOC; });
}
function danChu(el: HTMLElement, text: string) {
  act(() => { el.focus(); });
  const ev = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "clipboardData", { value: { getData: (k: string) => (k === "text/plain" ? text : "") } });
  act(() => { el.dispatchEvent(ev); });
}

describe("L1 — ô chữ nhiều dòng trống được đo lại chiều cao sau khi nhận nội dung mới", () => {
  it("dán KHỐI 2 hàng chữ nhiều dòng vào Ghi chú trống → cả hai ô cao lên", async () => {
    const items = [mk({}), mk({}), mk({})];
    moLuoi(items);
    await camMoc(o(0, "notes"), o(1, "notes"));
    danChu(o(0, "notes"), '"dòng 1\ndòng 2\ndòng 3"\n"x\ny"');
    await haiKhung();
    expect(items[0].notes).toBe("dòng 1\ndòng 2\ndòng 3");
    expect(o(0, "notes").value).toBe("dòng 1\ndòng 2\ndòng 3");
    expect(items[1].notes).toBe("x\ny");
    expect(o(0, "notes").style.height, "ô Ghi chú hàng 1 (đang chọn) không được đo lại").not.toBe(MOC);
    expect(o(1, "notes").style.height, "ô Ghi chú hàng 2 không được đo lại").not.toBe(MOC);
  });

  it("cột Chi tiết dính y hệt: dán khối vào Chi tiết trống → ô cao lên", async () => {
    const items = [mk({}), mk({})];
    moLuoi(items);
    await camMoc(o(1, "detail"));
    danChu(o(0, "detail"), '"a"\n"b\nc\nd"');
    await haiKhung();
    expect(items[1].detail).toBe("b\nc\nd");
    expect(o(1, "detail").style.height).not.toBe(MOC);
  });

  it("Ctrl+D chép chữ nhiều dòng xuống ô Ghi chú trống → ô đích cao lên", async () => {
    const items = [mk({ notes: "a\nb\nc" }), mk({}), mk({})];
    moLuoi(items);
    await camMoc(o(1, "notes"), o(2, "notes"));
    act(() => { o(0, "notes").focus(); });
    phim(document.activeElement!, { key: "ArrowDown", shiftKey: true });
    phim(document.activeElement!, { key: "ArrowDown", shiftKey: true });
    phim(document.activeElement!, { key: "d", ctrlKey: true });
    await haiKhung();
    expect(items[2].notes).toBe("a\nb\nc");
    expect(o(1, "notes").style.height).not.toBe(MOC);
    expect(o(2, "notes").style.height).not.toBe(MOC);
  });

  it("Redo sau khi dán khối (Ctrl+Z rồi Ctrl+Y) → ô được đo lại theo nội dung trở về", async () => {
    const items = [mk({}), mk({}), mk({})];
    moLuoi(items);
    danChu(o(0, "notes"), '"p\nq"\n"r\ns\nt"');
    expect(items[1].notes).toBe("r\ns\nt");
    act(() => { o(2, "unit").focus(); });
    phim(o(2, "unit"), { key: "z", ctrlKey: true });
    expect(items[1].notes).toBe("");
    await camMoc(o(1, "notes"));
    phim(o(2, "unit"), { key: "y", ctrlKey: true });
    await haiKhung();
    expect(items[1].notes).toBe("r\ns\nt");
    expect(o(1, "notes").style.height, "Ctrl+Y trả chữ nhiều dòng mà ô không đo lại").not.toBe(MOC);
  });
});
