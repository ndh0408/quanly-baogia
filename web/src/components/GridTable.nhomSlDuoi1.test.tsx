/** @vitest-environment jsdom */
// HỆ SỐ NHÓM NHỎ HƠN 1 TRÊN LƯỚI THẬT — chủ repo báo GẤP 2026-11-25 (production, báo giá #108 FP_B26_023, sheet "Cổng").
// Hàng NHÓM "Cổng Aeon BT" (ghi chú "Chia 2") gõ Số Lượng 0,5 bằng công thức, sheet bật "Hiện Thành Tiền nhóm". Ô Thành
// Tiền nhóm vẫn hiện 29.262.660 (= ×1) thay vì 14.631.330: `groupMult = Math.max(1, SL || 1)` kẹp 0,5 lên 1. Luật mới
// (shared/quote-math.ts): hệ số = SL đang hiện nếu > 0, trống / 0 / âm → ×1. Và vì ×0,5 đổi tổng thật, ô "Hiện Thành
// Tiền nhóm" phải tự bật + khoá như nhóm SL 3 (lib/khoaThanhTienNhom).
/// Dữ liệu TỰ DỰNG theo cấu trúc chủ repo tả. Sơ đồ địa chỉ CÓ chỗ Chi Tiết (addrDetail), không Số Ngày: A STT · B Hạng/n// Mục · C Chi Tiết · D ĐVT · E SL · F Đơn Giá · G Thành Tiền — như sơ đồ của tệp Excel mẫu GN.
import { describe, it, expect, afterEach, vi } from "vitest";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { GridTable } from "./GridTable";
import * as M from "../lib/quoteMath";
import { nextK, type ItemK } from "../lib/gridShared";
import { LY_DO_KHOA_NHOM } from "../lib/khoaThanhTienNhom";

vi.mock("../lib/venueCatalog", async (g) => ({ ...(await g<typeof import("../lib/venueCatalog")>()), loadCatalog: () => Promise.resolve({ entries: [], venues: [] }) }));
vi.mock("../lib/ui", async (g) => ({ ...(await g<typeof import("../lib/ui")>()), toast: vi.fn(), confirmModal: async () => true }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mk = (o: Partial<ItemK>): ItemK =>
  ({ _k: nextK(), kind: "item", name: "", unit: "", quantity: 0, days: null, unitPrice: 0, notes: "", ...o }) as ItemK;
/** Sheet "Cổng": 1 nhóm SL =1/2 · 2 mục =7.6*2.8*2 (42,56 → hiện 42,6) × 565.000 · 3 mục 2 × 800.000 · 4 mục 1 × =sum(G2:G3)*0.14. */
const cong108 = (slNhom = 0.5): ItemK[] => [
  mk({ kind: "section", name: "Cổng Aeon BT", unit: "gói", quantity: slNhom, notes: "Chia 2", ...(slNhom === 0.5 ? { formulas: { quantity: "=1/2" } } : {}) }),
  mk({ name: "Khung cổng", unit: "m2", quantity: 42.56, unitPrice: 565_000, formulas: { quantity: "=7.6*2.8*2" } }),
  mk({ name: "Đèn", unit: "bộ", quantity: 2, unitPrice: 800_000 }),
  mk({ name: "Phí thi công", unit: "gói", quantity: 1, unitPrice: 3_593_660, formulas: { unitPrice: "=sum(G2:G3)*0.14" } }),
];

const hops: HTMLDivElement[] = [];
const roots: Root[] = [];
afterEach(async () => {
  await act(async () => { await new Promise((r) => setTimeout(r, 220)); });   // cho hẹn giờ vẽ-hoãn 180ms nổ trong act
  for (const r of roots.splice(0)) act(() => r.unmount());
  for (const h of hops.splice(0)) h.remove();
  document.body.innerHTML = "";
});

/** Cha THẬT như QuoteEditor: giữ cờ `groupSubtotal` trong state và báo mọi lần lưới gọi `onGroupSubtotal`. */
function Vo({ items, batDau, ghiCo }: { items: ItemK[]; batDau: boolean; ghiCo: (v: boolean) => void }) {
  const [gs, setGs] = useState(batDau);
  const [, b] = useState(0);
  return <GridTable items={items} usesDays={false} showDetail={false} addrDetail numberSubs={false} editable internalNote={false}
    groupSubtotal={gs} onGroupSubtotal={(v) => { ghiCo(v); setGs(v); }} onChange={() => b((x) => x + 1)} />;
}
function moLuoi(items: ItemK[], batDau: boolean) {
  const hop = document.createElement("div"); document.body.appendChild(hop); hops.push(hop);
  const root = createRoot(hop); roots.push(root);
  const ghiCo = vi.fn<(v: boolean) => void>();
  act(() => root.render(<Vo items={items} batDau={batDau} ghiCo={ghiCo} />));
  return {
    ghiCo,
    o: (row: number, f: string) => hop.querySelector(`tr[data-row="${row}"] [data-f="${f}"]`) as HTMLInputElement,
    thanhTien: (row: number) => hop.querySelector(`tr[data-row="${row}"] td.col-amount`)!.textContent,
  };
}
const oTich = () => document.querySelector<HTMLInputElement>("label.gf-group-sub input[type=\"checkbox\"]")!;
const xaHen = () => act(async () => { await new Promise((r) => setTimeout(r, 220)); });
const go = (el: HTMLInputElement, chu: string) => act(() => { el.focus(); el.value = chu; el.dispatchEvent(new Event("input", { bubbles: true })); });
const enter = (el: HTMLInputElement) => act(() => { el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); });

describe("báo giá #108 'Cổng': nhóm SL 0,5 trên lưới", () => {
  it("ô Thành Tiền nhóm hiện 14.631.330 (= 0,5 × 29.262.660), tổng sheet cùng số; ô tích bị khoá bật", () => {
    const items = cong108();
    const { thanhTien } = moLuoi(items, true);
    expect(thanhTien(1), "42,56 hiện 42,6 × 565.000").toBe("24.069.000");
    expect(thanhTien(3)).toBe("3.593.660");
    expect(thanhTien(0), "Thành Tiền nhóm còn ×1 — đúng lỗi chủ repo báo").toBe("14.631.330");
    expect(M.sheetTotals({ items, groupSubtotal: true }, false).gross).toBe(14_631_330);
    expect([oTich().checked, oTich().disabled], "nhóm ×0,5 đổi tổng thật → ô phải khoá bật").toEqual([true, true]);
    expect(oTich().closest("label")!.getAttribute("title")).toBe(LY_DO_KHOA_NHOM);
  });

  it("nhóm SL 1 / trống: Thành Tiền nhóm = 29.262.660 như cũ, ô KHÔNG khoá", () => {
    for (const sl of [1, 0]) {
      const { thanhTien } = moLuoi(cong108(sl), true);
      expect(thanhTien(0), `SL nhóm ${sl}`).toBe("29.262.660");
      expect(oTich().disabled, `SL nhóm ${sl}`).toBe(false);
      act(() => roots.pop()!.unmount()); hops.pop()!.remove();
    }
  });

  it("ô đang TẮT, gõ SL nhóm '0,5' → tự bật + khoá, Thành Tiền nhóm 14.631.330", async () => {
    const items = cong108(1);
    const { o, ghiCo, thanhTien } = moLuoi(items, false);
    go(o(0, "quantity"), "0,5");
    expect(items[0].quantity).toBe(0.5);
    expect(ghiCo, "nhóm SL 0,5 mà ô không tự bật → tổng sai im lặng").toHaveBeenCalledWith(true);
    enter(o(0, "quantity"));
    await xaHen();
    expect([oTich().checked, oTich().disabled]).toEqual([true, true]);
    expect(thanhTien(0)).toBe("14.631.330");
  });

  it("ô đang TẮT, gõ CÔNG THỨC '=1/2' vào SL nhóm (đúng cách #108) → tự bật, Thành Tiền nhóm 14.631.330", async () => {
    const items = cong108(1);
    const { o, ghiCo, thanhTien } = moLuoi(items, false);
    go(o(0, "quantity"), "=1/2");
    enter(o(0, "quantity"));
    await xaHen();
    expect(items[0].quantity).toBe(0.5);
    expect(ghiCo).toHaveBeenCalledWith(true);
    expect(thanhTien(0)).toBe("14.631.330");
  });
});
