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

// ── HỆ SỐ NHÓM LẺ: Ô NHÓM HIỆN SỐ NGUYÊN LÀM TRÒN CHÍNH XÁC (2026-11-25) ──────────────────────────────────────────
// Bản cũ hiện `fmtNumCell(tổng × hệ số)` (1 số lẻ): nhóm SL 0,5 × 12.345 ra "6.172,5"; nhóm SL 0,7 × 1.310.725 bằng double ra
// 917.507,4999… nên hiện "917.507,5" và công thức trỏ vào ô nhóm (=G1) đọc 917.507,4999… → dòng đó 917.507 trong khi Excel
// (G×F) và máy chủ (đơn giá lưu 917.507,5) ra 917.508. Nay: ô HIỆN nhanLamTronDong (nguyên, nửa-lên), GIÁ TRỊ ô = tích chính xác.
describe("hệ số nhóm lẻ: ô Thành Tiền nhóm hiện số nguyên đúng phép Decimal", () => {
  it("nhóm SL 0,5 × 12.345 hiện '6.173' (không '6.172,5'); nhóm SL 0,7 năm dòng (ca cinetour lần 50) hiện '7.040.807'", () => {
    const items = [
      mk({ kind: "section", name: "Chia đôi", unit: "gói", quantity: 0.5 }),
      mk({ name: "A", unit: "cái", quantity: 1, unitPrice: 12_345 }),
      mk({ kind: "section", name: "Nhóm 0,7", unit: "gói", quantity: 0.7 }),
      ...[2_744_188, 129_497, 475_258, 5_496_093, 1_213_259].map((p) => mk({ name: "B", unit: "cái", quantity: 1, unitPrice: p })),
    ];
    const { thanhTien } = moLuoi(items, true);
    expect(thanhTien(0)).toBe("6.173");
    expect(thanhTien(2), "Σ dòng × 0,7 bằng double = 7.040.806,4999…").toBe("7.040.807");
    expect(M.sheetSubtotalGrouped(items, false, true), "6.172,5 + 7.040.806,5 = 7.046.979 — làm tròn MỘT lần, không cộng hai ô đã tròn").toBe(7_046_979);
  });

  it("công thức =G1 trỏ vào ô Thành Tiền nhóm (SL 0,7 × 1.310.725) đọc 917.507,5 chính xác → dòng 917.508 như Excel / máy chủ", async () => {
    const items = [
      mk({ kind: "section", name: "Nhóm 0,7", unit: "gói", quantity: 0.7 }),
      mk({ name: "Gói", unit: "gói", quantity: 1, unitPrice: 1_310_725 }),
      mk({ kind: "section", name: "Phí", unit: "", quantity: 0 }),
      mk({ name: "Theo nhóm trên", unit: "gói", quantity: 1, unitPrice: 0 }),
    ];
    const { o, thanhTien } = moLuoi(items, true);
    expect(thanhTien(0), "double 917.507,4999… từng hiện '917.507,5'").toBe("917.508");
    go(o(3, "unitPrice"), "=G1");
    enter(o(3, "unitPrice"));
    await xaHen();
    expect(items[3].unitPrice, "giá trị ô nhóm = tích chính xác chưa làm tròn (ô Excel G×F)").toBe(917_507.5);
    expect(thanhTien(3), "bản cũ 917.507").toBe("917.508");
  });
});
