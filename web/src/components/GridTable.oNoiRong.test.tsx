/** @vitest-environment jsdom */
/**
 * ============================================================================
 * Ô NHẬP NỚI SANG PHẢI KHI CHỮ DÀI HƠN Ô — như Excel.
 *
 * Người dùng báo (ảnh chụp, báo giá Colorfull, 2026-09-23): chọn ô Số Lượng có công thức
 * "=0.8*0.5*8" thì ô chỉ hiện "=0.8*0.5'" — cột hẹp, phần còn lại khuất, muốn xem/sửa phải lên
 * thanh fx. Nay ô đang focus mà chữ tràn thì <input> dài ra (lớp `.cell-grow`), rời ô là co lại.
 *
 * jsdom không dàn trang nên scrollWidth/clientWidth luôn 0 — bài kiểm GIẢ hai số đo đó trên
 * prototype để mô phỏng "chữ dài hơn ô" / "chữ vừa ô".
 * ============================================================================
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { GridTable } from "./GridTable";
import { nextK, type ItemK } from "../lib/gridShared";

vi.mock("../lib/venueCatalog", async (nhapGoc) => {
  const goc = await nhapGoc<typeof import("../lib/venueCatalog")>();
  return { ...goc, loadCatalog: () => Promise.resolve({ entries: [], venues: [] }) };
});
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mk = (o: Partial<ItemK>): ItemK =>
  ({ k: nextK(), kind: "item", name: "", unit: "m2", quantity: 1, days: 1, unitPrice: 0, notes: "", ...o }) as ItemK;

let root: Root | null = null;
let hop: HTMLDivElement | null = null;
let doCuon = 0;   // scrollWidth giả: > 60 là "chữ tràn"

beforeEach(() => {
  doCuon = 0;
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(() => doCuon);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => 60);
});
afterEach(() => { if (root) act(() => root!.unmount()); hop?.remove(); root = null; hop = null; vi.restoreAllMocks(); document.body.innerHTML = ""; });

function moLuoi(items: ItemK[]) {
  hop = document.createElement("div");
  document.body.appendChild(hop);
  root = createRoot(hop);
  act(() => root!.render(
    <GridTable items={items} usesDays={false} showDetail addrDetail numberSubs={false} editable
      internalNote={false} groupSubtotal={false} fxBar onChange={() => {}} />,
  ));
}
const o = (row: number, f: string) => hop!.querySelector(`tr[data-row="${row}"] [data-f="${f}"]`) as HTMLInputElement;

describe("Ô nhập nới rộng khi chữ dài hơn ô", () => {
  it("chọn ô công thức dài → ô nới ra; rời ô → co về như cũ", () => {
    moLuoi([mk({ name: "Banner hàng rào", quantity: 3.2, unitPrice: 95_000, formulas: { quantity: "=0.8*0.5*8" } })]);
    const q = o(0, "quantity");
    doCuon = 140;
    act(() => { q.focus(); });
    expect(q.value).toBe("=0.8*0.5*8");
    expect(q.classList.contains("cell-grow"), "chữ tràn mà ô không nới").toBe(true);
    expect(parseFloat(q.style.width)).toBeGreaterThan(60);

    act(() => { q.blur(); });
    expect(q.classList.contains("cell-grow"), "rời ô mà vẫn nới").toBe(false);
    expect(q.style.width).toBe("");
  });

  it("chữ vừa ô → KHÔNG nới (không che ô bên cạnh vô cớ)", () => {
    moLuoi([mk({ name: "Chi phí thi công", quantity: 1, unitPrice: 300_000 })]);
    const q = o(0, "quantity");
    doCuon = 40;
    act(() => { q.focus(); });
    expect(q.classList.contains("cell-grow")).toBe(false);
    expect(q.style.width).toBe("");
  });

  it("đang gõ mà chữ dài dần ra → ô nới theo", () => {
    moLuoi([mk({ name: "X", quantity: 1, unitPrice: 0 })]);
    const q = o(0, "quantity");
    act(() => { q.focus(); });
    expect(q.classList.contains("cell-grow")).toBe(false);
    doCuon = 200;
    act(() => { q.value = "=1.2*2.4*19+2.35*1.15"; q.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(q.classList.contains("cell-grow")).toBe(true);
  });

  // Chủ repo 2026-11-25 (ảnh ô SL nhóm "=sum(E7:E8)"): ô vuông kéo của ô gốc nằm giữa cạnh dưới hộp nới, bị
  // hộp đè. fitCell ghi bề rộng hộp vào --o-noi của td để CSS dời ô vuông ra góc hộp; co lại thì phải gỡ.
  it("ô nới ghi bề rộng vào biến --o-noi của td (CSS dời ô vuông kéo theo); rời ô thì gỡ", () => {
    moLuoi([mk({ name: "Nhóm", quantity: 2, unitPrice: 0, formulas: { quantity: "=sum(E7:E8)+E5*2" } })]);
    const q = o(0, "quantity");
    const td = q.closest("td") as HTMLElement;
    doCuon = 140;
    act(() => { q.focus(); });
    expect(td.style.getPropertyValue("--o-noi"), "ô đã nới mà td không biết bề rộng hộp").toBe(q.style.width);
    act(() => { q.blur(); });
    expect(td.style.getPropertyValue("--o-noi"), "rời ô mà biến bề rộng còn treo trên td").toBe("");
  });

  it("gõ dài ra rồi Esc huỷ → hộp co về theo chữ lúc vào ô (không giữ bề rộng của chữ gõ dở)", () => {
    moLuoi([mk({ name: "X", quantity: 3, unitPrice: 0 })]);
    const q = o(0, "quantity");
    act(() => { q.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0, detail: 1 })); });
    act(() => { q.focus(); });
    act(() => { q.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "F2" })); });
    doCuon = 200;
    act(() => { q.value = "=1.2*2.4*19+2.35*1.15"; q.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(q.classList.contains("cell-grow")).toBe(true);
    doCuon = 40;   // chữ lúc vào ô ("3") vừa ô
    act(() => { q.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Escape" })); });
    expect(q.value).toBe("3");
    expect(q.classList.contains("cell-grow"), "Esc trả chữ cũ mà hộp vẫn nới").toBe(false);
    expect(q.style.width).toBe("");
  });
});
