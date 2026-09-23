/** @vitest-environment jsdom */
/**
 * ============================================================================
 * LƯỚI DÀI PHẢI MƯỢT + DÁN CHỮ NHIỀU DÒNG PHẢI CAO NGAY — người dùng báo 2026-09-23.
 *
 * 1. "Hoạt động mượt mà": đo trên dev, lưới 503 dòng, mỗi phím gõ kéo theo một lần vẽ lại (180ms
 *    sau) GHI LẠI ~4.000 thuộc tính name/type trên <input> và ~1.500 nội dung <textarea> dù không gì
 *    đổi. Gốc: React 19 LUÔN ghi lại name/type/defaultValue của mọi <input>/<textarea> được vẽ
 *    lại, prop có đổi hay không. Trình duyệt phải tính lại kiểu chữ cả bảng: 250–325ms + ~110ms React
 *    → gõ thấy ì. Sửa: dòng có ghi nhớ (DongNho, chữ ký dòng) + hàm xử lý cố định. Bài này đếm số lần
 *    ghi DOM vào các dòng KHÔNG liên quan sau một lần vẽ lại — phải gần 0 (bản cũ: 2.189).
 * 2. Dán một ô chữ nhiều dòng ("Booth…⏎HCM…⏎HN…") vào Hạng Mục chỉ thấy dòng đầu tới khi bấm Lưu:
 *    nhánh dán 1 ô chữ ghi value mà không đo lại chiều cao.
 * ============================================================================
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { GridTable } from "./GridTable";
import { nextK, type ItemK } from "../lib/gridShared";

vi.mock("../lib/venueCatalog", async (g) => ({ ...(await g<typeof import("../lib/venueCatalog")>()), loadCatalog: () => Promise.resolve({ entries: [], venues: [] }) }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mk = (k: number): ItemK =>
  ({ _k: nextK(), kind: "item", name: `Hạng ${k}`, detail: "ct", unit: "m2", quantity: 1 + (k % 5), days: 1, unitPrice: 1000, notes: "" }) as ItemK;

let root: Root | null = null;
let hop: HTMLDivElement | null = null;
afterEach(async () => {
  await act(async () => { await new Promise((r) => setTimeout(r, 220)); });
  if (root) act(() => root!.unmount());
  hop?.remove(); root = null; hop = null; document.body.innerHTML = "";
});

function Vo({ items }: { items: ItemK[] }) {
  const [, b] = useState(0);
  return <GridTable items={items} usesDays={false} showDetail addrDetail numberSubs={false} editable internalNote showImages onShowImages={() => {}}
    groupSubtotal={false} fxBar onChange={() => b((v) => v + 1)} />;
}
function moLuoi(items: ItemK[]) {
  hop = document.createElement("div"); document.body.appendChild(hop); root = createRoot(hop);
  act(() => root!.render(<Vo items={items} />));
}
const o = (row: number, f: string) => hop!.querySelector(`tr[data-row="${row}"] [data-f="${f}"]`) as HTMLInputElement & HTMLTextAreaElement;

describe("Lưới dài: vẽ lại sau khi gõ KHÔNG ghi lại DOM của các dòng khác", () => {
  it("200 dòng, gõ vào Ghi Chú dòng 100 → các dòng khác gần như không bị ghi", async () => {
    const items = Array.from({ length: 200 }, (_, k) => mk(k));
    moLuoi(items);
    const el = o(100, "notes");
    act(() => { el.focus(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    let khac = 0;
    const mo = new MutationObserver((ls) => {
      for (const m of ls) {
        const tr = (m.target as Element).closest?.("tr[data-row]") ?? (m.target.parentElement?.closest("tr[data-row]") ?? null);
        if (!tr || tr.getAttribute("data-row") !== "100") khac++;
      }
    });
    mo.observe(hop!.querySelector("tbody")!, { subtree: true, childList: true, characterData: true, attributes: true });
    act(() => { el.value = "đổi"; el.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => { await new Promise((r) => setTimeout(r, 260)); });   // qua hẹn giờ vẽ lại 180ms
    mo.disconnect();
    expect(items[100].notes).toBe("đổi");
    // Bản cũ: hàng nghìn lần ghi (mỗi <input>/<textarea> của 200 dòng). Chừa khoảng nhỏ cho viền chọn.
    expect(khac, `vẽ lại ghi ${khac} lần vào DOM các dòng không liên quan`).toBeLessThan(40);
  });
});

describe("Dán một ô chữ nhiều dòng vào Hạng Mục", () => {
  it("ô được đo lại chiều cao NGAY (không đợi bấm Lưu)", async () => {
    const items = [mk(0), mk(1)];
    moLuoi(items);
    const el = o(1, "name");
    act(() => { el.focus(); });
    // Chờ lượt đo chiều cao lúc dựng lưới chạy xong, rồi cắm một chiều cao MỐC: dán xong mà ô không
    // được đo lại thì mốc vẫn còn nguyên.
    await act(async () => { await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))); });
    el.style.height = "7px";
    const truoc = el.style.height;
    const text = "Booth 3m5W x 2m7H x 1m2D\nHCM: GLXND, BHDLVV\nHN: Aeon HĐ, VRC\nBD: Aeon BD";
    const ev = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(ev, "clipboardData", { value: { getData: (k: string) => (k === "text/plain" ? `"${text}"` : "") } });
    act(() => { el.dispatchEvent(ev); });
    await act(async () => { await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))); });
    expect(items[1].name).toBe(text);
    expect(el.value).toBe(text);
    // autoGrow ghi style.height (jsdom không dàn trang nên ra "0px" — điều cần là nó ĐÃ được đo).
    expect(el.style.height, "ô không được đo lại chiều cao sau khi dán").not.toBe(truoc);
  });
});
