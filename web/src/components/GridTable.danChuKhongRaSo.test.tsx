/** @vitest-environment jsdom */
/**
 * ============================================================================
 * DÁN Ô CHỮ VÀO CỘT SỐ MÀ ĐỌC RA 0 PHẢI CÓ CẢNH BÁO — soát toàn diện đợt 5 (d5-luoi 2).
 *
 * Đợt 4 thêm cảnh báo dòng cho bộ nhập Excel (chuKhongRaSo) nhưng đường DÁN vẫn im lặng: dán
 * "ĐG1.500.000", "Liên hệ", "1.500.000 - 2.000.000" vào Đơn Giá thì ra 0 mà không toast nào — bảng dán
 * từ Zalo/email không có cột Thành Tiền để ai nhìn ra. chuKhongRaSo đã export ở clipboard.ts nhưng
 * không nơi nào gọi.
 *   ĐÃ ĐO (460b8b1): cả bốn đường dán (một ô, điền vùng, khối, dựng lại bản xuất) cho 0, toast rỗng.
 * Luật: gom MỌI ô số của CẢ lượt dán rồi báo MỘT lần, nêu số ô. Số 0 viết bằng chữ ("0", "0đ", "-"),
 * ô trống, ô chữ đọc ra số, ô công thức và ô chữ ở cột chữ không báo.
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
  ({ _k: nextK(), kind: "item", name: "", detail: "", unit: "cái", quantity: 1, days: 1, unitPrice: 100, notes: "", ...o }) as ItemK;

let root: Root | null = null;
let hop: HTMLDivElement | null = null;
afterEach(async () => {
  await act(async () => { await new Promise((r) => setTimeout(r, 220)); });
  if (root) act(() => root!.unmount());
  hop?.remove(); root = null; hop = null; document.body.innerHTML = "";
});
function Vo({ items }: { items: ItemK[] }) {
  const [, b] = useState(0);
  return <GridTable items={items} usesDays={false} showDetail={false} addrDetail={false} numberSubs={false} editable internalNote={false}
    groupSubtotal={false} onChange={() => b((v) => v + 1)} />;
}
function moLuoi(items: ItemK[]) {
  hop = document.createElement("div"); document.body.appendChild(hop); root = createRoot(hop);
  act(() => root!.render(<Vo items={items} />));
}
const o = (row: number, f: string) => hop!.querySelector(`tr[data-row="${row}"] [data-f="${f}"]`) as HTMLInputElement & HTMLTextAreaElement;
const phim = (el: Element, init: KeyboardEventInit) => act(() => { el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init })); });
function dan(row: number, f: string, text: string, giuTieuDiem = false) {
  if (!giuTieuDiem) act(() => { o(row, f).focus(); });
  const ev = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "clipboardData", { value: { getData: (k: string) => (k === "text/plain" ? text : "") } });
  act(() => { (document.activeElement ?? o(row, f)).dispatchEvent(ev); });
}
/** Chữ của từng toast đang hiện (afterEach dọn body nên mỗi bài bắt đầu trống). */
const toasts = () => Array.from(document.querySelectorAll("#toast-host .toast-msg")).map((t) => t.textContent ?? "");
const baoKhongSo = () => toasts().filter((t) => /không đọc được số/.test(t));

describe("dán ô chữ vào cột số đọc ra 0 → báo MỘT lần cho cả lượt dán", () => {
  it.each([["ĐG1.500.000"], ["Liên hệ"], ["1.500.000 - 2.000.000"], ["12m2"]])("một ô Đơn Giá '%s' → 0 + cảnh báo nêu đúng chữ", (chu) => {
    const items = [mk({ name: "A", unitPrice: 500 })];
    moLuoi(items);
    dan(0, "unitPrice", chu);
    expect(items[0].unitPrice).toBe(0);
    expect(baoKhongSo(), "dán chữ vào Đơn Giá ra 0 mà không báo").toHaveLength(1);
    expect(baoKhongSo()[0]).toContain(chu);
  });

  it("khối 3 hàng × (SL, Đơn Giá) có 3 ô chữ không ra số → MỘT cảnh báo nêu '3 ô'", () => {
    const items = [mk({ name: "A" }), mk({ name: "B" }), mk({ name: "C" })];
    moLuoi(items);
    dan(0, "quantity", "2\tLiên hệ\r\nSL12\t50.000\r\n1\tĐG1.500.000");
    expect(items.map((i) => [i.quantity, i.unitPrice])).toEqual([[2, 0], [0, 50000], [1, 0]]);
    expect(baoKhongSo(), "khối có ô chữ ra 0 mà không báo, hoặc báo từng ô").toHaveLength(1);
    expect(baoKhongSo()[0]).toMatch(/3 ô/);
  });

  it("điền VÙNG (chọn 3 ô Đơn Giá, dán 'Liên hệ') → MỘT cảnh báo nêu '3 ô'", () => {
    const items = [mk({ name: "A" }), mk({ name: "B" }), mk({ name: "C" })];
    moLuoi(items);
    act(() => { o(0, "unitPrice").focus(); });
    phim(o(0, "unitPrice"), { key: "ArrowDown", shiftKey: true });
    phim(document.activeElement!, { key: "ArrowDown", shiftKey: true });
    dan(0, "unitPrice", "Liên hệ", true);
    expect(items.map((i) => i.unitPrice)).toEqual([0, 0, 0]);
    expect(baoKhongSo()).toHaveLength(1);
    expect(baoKhongSo()[0]).toMatch(/3 ô/);
  });

  it("dán lại bản XUẤT của app (dựng lại nhóm) có Đơn Giá 'Liên hệ' → cảnh báo", () => {
    const items = [mk({})];
    moLuoi(items);
    dan(0, "name", "A\tNhóm âm thanh\t\t\t\t\r\n1\tLoa\tcái\t2\tLiên hệ\t0\r\n2\tMic\tcái\t1\t300.000\t300.000");
    const loa = items.find((i) => i.name === "Loa");
    expect(loa?.unitPrice).toBe(0);
    expect(items.find((i) => i.name === "Mic")?.unitPrice).toBe(300000);
    expect(baoKhongSo()).toHaveLength(1);
    expect(baoKhongSo()[0]).toContain("Liên hệ");
  });

  it("KHÔNG báo giả: số 0 viết bằng chữ, ô trống, ô chữ đọc ra số, ô công thức, ô chữ ở cột chữ", () => {
    const items = [mk({ name: "A" }), mk({ name: "B" }), mk({ name: "C" }), mk({ name: "D" }), mk({ name: "E" })];
    moLuoi(items);
    dan(0, "quantity", "0\t0đ\r\n\t-\r\n12 m2\t95.000đ/m2\r\n=2*3\t=E1*2\r\nx2\t(0)");
    expect(items.map((i) => i.quantity)).toEqual([0, 0, 12, 6, 2]);
    dan(0, "name", "Liên hệ");
    dan(1, "notes", "ĐG1.500.000");
    expect(baoKhongSo(), "báo 'không đọc được số' cho ô không có vấn đề").toEqual([]);
  });
});

// Soát toàn diện đợt 5 (d5-luoi 3): KHOẢNG SỐ bị ghép thành MỘT số khác 0 — SL "10-12" dán vào ra 1012, Đơn
// Giá "500.000 – 700.000" ra 500.000.700.000 — nên cảnh báo "không đọc được số" ở trên không bắt được.
//   ĐÃ ĐO (460b8b1): hai ô dưới ra [1012, 500000700000], toast rỗng.
describe("dán khoảng số vào cột số → 0 + cảnh báo, không ghép thành một số", () => {
  it("SL '10-12' / Đơn Giá '500.000 – 700.000' → 0 + MỘT cảnh báo '2 ô'", () => {
    const items = [mk({ name: "A" })];
    moLuoi(items);
    dan(0, "quantity", "10-12\t500.000 – 700.000");
    expect([items[0].quantity, items[0].unitPrice]).toEqual([0, 0]);
    expect(baoKhongSo()).toHaveLength(1);
    expect(baoKhongSo()[0]).toMatch(/2 ô/);
  });

  it("một ô SL '2 - 3' → 0 + cảnh báo; số âm '-2' vẫn là −2, không báo", () => {
    const items = [mk({ name: "A" }), mk({ name: "B" })];
    moLuoi(items);
    dan(0, "quantity", "2 - 3");
    expect(items[0].quantity).toBe(0);
    expect(baoKhongSo()).toHaveLength(1);
    dan(1, "quantity", "-2");
    expect(items[1].quantity).toBe(-2);
    expect(baoKhongSo()).toHaveLength(1);
  });
});
