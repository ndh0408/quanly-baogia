/** @vitest-environment jsdom */
//
// HAI THANH CÔNG THỨC CÙNG TRANG (lưới chính + bảng nội bộ) — soát bằng Chrome DevTools 2026-10-06.
//
// Màn soạn dựng fx-bar cho cả lưới chính lẫn bảng nội bộ (Chi phí HCM / Phí KH…), cùng `id="fx-input"` / `id="fx-addr"`.
// Bộ xử lý `mousedown` toàn cục ("bấm ra ngoài → ô đang hiện công thức về số, thanh fx về trống") dùng
// `document.getElementById`, nên chỉ dọn thanh ĐẦU TIÊN: thanh của bảng nội bộ giữ địa chỉ ô + công thức cũ.
// Bài này dựng hai lưới, giả trạng thái "đang xem công thức" ở CẢ HAI thanh rồi bấm ra ngoài: cả hai phải về trống.
// ĐỎ trên mã cũ (thanh thứ hai còn nguyên).
import { describe, it, expect, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { GridTable } from "./GridTable";
import { nextK, type ItemK } from "../lib/gridShared";

const kho = vi.hoisted(() => ({ danhMuc: { entries: [] as unknown[], venues: [] as unknown[] } }));
vi.mock("../lib/venueCatalog", async (nhapGoc) => {
  const goc = await nhapGoc<typeof import("../lib/venueCatalog")>();
  return { ...goc, loadCatalog: () => Promise.resolve(kho.danhMuc) };
});
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let hop: HTMLDivElement | null = null;
afterEach(() => { act(() => root?.unmount()); hop?.remove(); root = null; hop = null; });

const mot = (): ItemK[] => [{ _k: nextK(), kind: "item", name: "Mục 1", unit: "m2", quantity: 2, unitPrice: 1000, notes: "" } as unknown as ItemK];

describe("bấm ra ngoài dọn MỌI thanh công thức, không chỉ thanh đầu", () => {
  it("lưới chính + bảng nội bộ: cả hai fx-addr về '—', cả hai fx-input chỉ-đọc về trống", () => {
    hop = document.createElement("div");
    document.body.appendChild(hop);
    root = createRoot(hop);
    act(() => root!.render(
      <>
        <GridTable items={mot()} usesDays={false} numberSubs={false} editable internalNote={false} groupSubtotal={false} fxBar showDetail={false} onChange={() => {}} />
        <GridTable items={mot()} usesDays={false} numberSubs={false} editable internalNote={false} groupSubtotal={false} fxBar showDetail={false} onChange={() => {}} />
      </>,
    ));
    const thanh = [...hop.querySelectorAll(".fx-bar")];
    expect(thanh, "phải có hai thanh công thức").toHaveLength(2);
    // Trạng thái "đang xem công thức" ở cả hai: ô mang data-fx-shown, thanh hiện địa chỉ + công thức (ô Thành tiền: chỉ đọc).
    const td = hop.querySelector("td.col-amount") as HTMLElement;
    td.setAttribute("data-fx-shown", "1");
    td.setAttribute("data-fx-val", "2.000");
    for (const t of thanh) {
      (t.querySelector(".fx-addr") as HTMLElement).textContent = "G3";
      const o = t.querySelector("input.fx-input") as HTMLInputElement;
      o.readOnly = true;
      o.value = "=E3*F3";
    }
    act(() => { document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); });
    expect(thanh.map((t) => (t.querySelector(".fx-addr") as HTMLElement).textContent)).toEqual(["—", "—"]);
    expect(thanh.map((t) => (t.querySelector("input.fx-input") as HTMLInputElement).value), "mã cũ: thanh thứ hai giữ công thức cũ").toEqual(["", ""]);
  });
});
