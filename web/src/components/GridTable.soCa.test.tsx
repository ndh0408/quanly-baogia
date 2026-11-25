/** @vitest-environment jsdom */
/**
 * MẪU CINETOUR — cột SỐ CA trên lưới (chủ repo 2026-11-25).
 *
 * Thành Tiền = SL × [Số Ngày] × Số Ca × Đơn Giá; Số Ca trống / 0 = ×1, y luật Số Ngày. Cột Số Ca đứng ngay sau Số
 * Ngày (hoặc Số Lượng ở mẫu không ngày) — sơ đồ chữ cột dịch theo, khớp excel.ts / buildFormulaContext:
 *   không ngày: A=STT B=Hạng Mục C=ĐVT D=SL E=Số Ca F=Đơn Giá G=Thành Tiền H=Ghi Chú
 *   có ngày:    A=STT B=Hạng Mục C=ĐVT D=SL E=Số Ngày F=Số Ca G=Đơn Giá H=Thành Tiền I=Ghi Chú
 * Mẫu thường (không khai `usesShifts`) không có cột, không đổi chữ cột nào. ĐỎ trên 7a6ce18 (lưới chưa có cột Số Ca).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { GridTable } from "./GridTable";
import { nextK, type ItemK } from "../lib/gridShared";

vi.mock("../lib/venueCatalog", async (g) => ({ ...(await g<typeof import("../lib/venueCatalog")>()), loadCatalog: () => Promise.resolve({ entries: [], venues: [] }) }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mk = (o: Partial<ItemK>): ItemK => ({ _k: nextK(), kind: "item", name: "", unit: "ca", quantity: 1, days: null, unitPrice: 0, notes: "", ...o }) as ItemK;

let roots: Root[] = [];
afterEach(() => { roots.forEach((r) => act(() => r.unmount())); roots = []; document.body.innerHTML = ""; });

type Opts = { usesDays?: boolean; usesShifts?: boolean; groupSubtotal?: boolean; khoaHang?: (it: ItemK) => boolean };
function moLuoi(items: ItemK[], o: Opts = {}) {
  function Vo() {
    const [, b] = useState(0);
    const [nhom, datNhom] = useState(!!o.groupSubtotal);
    return <GridTable items={items} usesDays={!!o.usesDays} usesShifts={o.usesShifts} showDetail={false} addrDetail={false} numberSubs={false}
      editable internalNote={false} groupSubtotal={nhom} onGroupSubtotal={datNhom} fxBar khoaHang={o.khoaHang as never}
      onChange={() => b((v) => v + 1)} />;
  }
  const hop = document.createElement("div"); document.body.appendChild(hop);
  const root = createRoot(hop); roots.push(root);
  act(() => root.render(<Vo />));
  return hop;
}
const o = (hop: HTMLElement, row: number, f: string) => hop.querySelector(`tr[data-row="${row}"] [data-f="${f}"]`) as HTMLInputElement;
const thanhTien = (hop: HTMLElement, row: number) => (hop.querySelector(`tr[data-row="${row}"] td.col-amount`)?.textContent || "").trim();
const tieuDe = (hop: HTMLElement) => [...hop.querySelectorAll("thead th")].map((th) => (th.textContent || "").trim());
function goRoiChot(el: HTMLInputElement, chu: string) {
  act(() => { el.focus(); });
  act(() => { el.value = chu; el.dispatchEvent(new Event("input", { bubbles: true })); });
  act(() => { el.blur(); });
}
const phim = (el: Element, init: KeyboardEventInit) => act(() => { el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init })); });
type Kho = Record<string, string>;
function suKienClip(loai: "copy" | "paste", kho: Kho) {
  const ev = new Event(loai, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "clipboardData", { value: { getData: (k: string) => kho[k] ?? "", setData: (k: string, v: string) => { kho[k] = v; } } });
  return ev;
}

describe("CINETOUR — cột SỐ CA hiện đúng chỗ, mẫu thường không có", () => {
  it("không ngày: SỐ CA đứng ngay sau SỐ LƯỢNG; ô nhập có name=shifts", () => {
    const hop = moLuoi([mk({ name: "Bảo vệ", quantity: 2, unitPrice: 300_000 })], { usesShifts: true });
    const td = tieuDe(hop);
    expect(td.slice(td.indexOf("SỐ LƯỢNG"), td.indexOf("SỐ LƯỢNG") + 3)).toEqual(["SỐ LƯỢNG", "SỐ CA", "ĐƠN GIÁ"]);
    const oCa = o(hop, 0, "shifts");
    expect(oCa, "không có ô Số Ca").toBeTruthy();
    expect(oCa.getAttribute("name")).toBe("shifts");
    expect(oCa.getAttribute("autocomplete")).toBe("off");
  });

  it("có ngày: SỐ CA đứng ngay sau SỐ NGÀY", () => {
    const hop = moLuoi([mk({ name: "Bảo vệ", days: 1 })], { usesDays: true, usesShifts: true });
    const td = tieuDe(hop);
    expect(td.slice(td.indexOf("SỐ LƯỢNG"), td.indexOf("SỐ LƯỢNG") + 4)).toEqual(["SỐ LƯỢNG", "SỐ NGÀY", "SỐ CA", "ĐƠN GIÁ"]);
  });

  it("mẫu thường (không khai usesShifts): KHÔNG có cột, Thành Tiền không nhân Số Ca dù hàng còn giữ số", () => {
    const hop = moLuoi([mk({ name: "A", quantity: 2, unitPrice: 100_000, shifts: 3 })], { usesDays: true });
    expect(tieuDe(hop)).not.toContain("SỐ CA");
    expect(o(hop, 0, "shifts")).toBeNull();
    expect(thanhTien(hop, 0)).toBe("200.000");
  });
});

describe("CINETOUR — Thành Tiền nhân Số Ca", () => {
  it("gõ 2 ca → Thành Tiền nhân đôi", () => {
    const items = [mk({ name: "Bảo vệ", quantity: 1, unitPrice: 100_000, shifts: 1 })];
    const hop = moLuoi(items, { usesShifts: true });
    expect(thanhTien(hop, 0)).toBe("100.000");
    goRoiChot(o(hop, 0, "shifts"), "2");
    expect(items[0].shifts).toBe(2);
    expect(thanhTien(hop, 0)).toBe("200.000");
  });

  it("có ngày: SL × Số Ngày × Số Ca × Đơn Giá", () => {
    const items = [mk({ name: "Bảo vệ", quantity: 2, days: 3, unitPrice: 50_000, shifts: 1 })];
    const hop = moLuoi(items, { usesDays: true, usesShifts: true });
    goRoiChot(o(hop, 0, "shifts"), "2");
    expect(thanhTien(hop, 0)).toBe("600.000");
  });

  it.each([null, 0])("Số Ca trống (%s) = ×1, như Số Ngày", (ca) => {
    const hop = moLuoi([mk({ name: "A", quantity: 3, unitPrice: 70_000, shifts: ca as number })], { usesShifts: true });
    expect(thanhTien(hop, 0)).toBe("210.000");
  });

  it("Số Ca có số lẻ: gõ \"1.5\" (dấu chấm vừa gõ) là 1,5 ca — số đo như Số Lượng / Số Ngày", () => {
    const items = [mk({ name: "A", quantity: 1, unitPrice: 100_000, shifts: 1 })];
    const hop = moLuoi(items, { usesShifts: true });
    const el = o(hop, 0, "shifts");
    act(() => { el.focus(); });
    act(() => { el.value = "1."; el.dispatchEvent(new InputEvent("input", { bubbles: true, data: ".", inputType: "insertText" })); });
    act(() => { el.value = el.value + "5"; el.dispatchEvent(new InputEvent("input", { bubbles: true, data: "5", inputType: "insertText" })); });
    act(() => { el.blur(); });
    expect(items[0].shifts).toBe(1.5);
    expect(thanhTien(hop, 0)).toBe("150.000");
  });

  it("nhóm × Số Ca: \"Thành Tiền nhóm\" = (Σ mục đã nhân Số Ca) × SL nhóm; Tổng sheet khớp", () => {
    const items = [
      mk({ kind: "section", name: "Nhân sự", quantity: 2, unit: "" }),
      mk({ name: "Bảo vệ", quantity: 1, unitPrice: 100_000, shifts: 3 }),
      mk({ name: "Lễ tân", quantity: 2, unitPrice: 50_000, shifts: 2 }),
    ];
    const hop = moLuoi(items, { usesShifts: true, groupSubtotal: true });
    expect(thanhTien(hop, 1)).toBe("300.000");
    expect(thanhTien(hop, 2)).toBe("200.000");
    expect(thanhTien(hop, 0), "Thành Tiền nhóm").toBe("1.000.000");
    expect(hop.textContent).toContain("Tổng sheet: 1.000.000");
  });
});

describe("CINETOUR — ô Số Ca nhận công thức, dán, kéo điền, hoàn tác; tham chiếu theo chữ cột MỚI", () => {
  it("gõ công thức vào Số Ca: lưu công thức, Thành Tiền theo kết quả", () => {
    const items = [mk({ name: "A", quantity: 1, unitPrice: 100_000, shifts: 1 })];
    const hop = moLuoi(items, { usesShifts: true });
    goRoiChot(o(hop, 0, "shifts"), "=1+2");
    expect(items[0].shifts).toBe(3);
    expect(items[0].formulas?.shifts).toBe("=1+2");
    expect(thanhTien(hop, 0)).toBe("300.000");
  });

  it("không ngày: công thức hàng khác trỏ ô Số Ca theo chữ E (D = SL, F = Đơn Giá)", () => {
    const items = [mk({ name: "A", quantity: 4, unitPrice: 10_000, shifts: 3 }), mk({ name: "B", quantity: 1, shifts: 1 })];
    const hop = moLuoi(items, { usesShifts: true });
    goRoiChot(o(hop, 1, "unitPrice"), "=E1*50000");
    expect(items[1].unitPrice, "E1 phải là Số Ca của hàng 1").toBe(150_000);
    goRoiChot(o(hop, 1, "quantity"), "=F1/10000");
    expect(items[1].quantity, "F1 phải là Đơn Giá (dời một cột vì có Số Ca)").toBe(1);
    // Đổi Số Ca của hàng 1 → công thức trỏ nó tính lại.
    goRoiChot(o(hop, 0, "shifts"), "2");
    expect(items[1].unitPrice).toBe(100_000);
  });

  it("có ngày: Số Ca là F, Đơn Giá là G, Thành Tiền là H", () => {
    const items = [mk({ name: "A", quantity: 2, days: 3, unitPrice: 10_000, shifts: 4 }), mk({ name: "B", quantity: 1, days: 1, shifts: 1 })];
    const hop = moLuoi(items, { usesDays: true, usesShifts: true });
    goRoiChot(o(hop, 1, "unitPrice"), "=F1*1000");
    expect(items[1].unitPrice).toBe(4_000);
    goRoiChot(o(hop, 1, "quantity"), "=H1/G1");
    expect(items[1].quantity, "H1 / G1 = 240.000 / 10.000").toBe(24);
  });

  it("dán số vào ô Số Ca", () => {
    const items = [mk({ name: "A", quantity: 1, unitPrice: 100_000, shifts: 1 })];
    const hop = moLuoi(items, { usesShifts: true });
    act(() => { o(hop, 0, "shifts").focus(); });
    act(() => { document.activeElement!.dispatchEvent(suKienClip("paste", { "text/plain": "3" })); });
    expect(items[0].shifts).toBe(3);
    expect(thanhTien(hop, 0)).toBe("300.000");
  });

  it("Ctrl+D kéo Số Ca hàng đầu xuống các hàng chọn; Ctrl+Z trả lại", () => {
    const items = [mk({ name: "A", unitPrice: 10_000, shifts: 2 }), mk({ name: "B", unitPrice: 10_000, shifts: 1 }), mk({ name: "C", unitPrice: 10_000, shifts: 1 })];
    const hop = moLuoi(items, { usesShifts: true });
    act(() => { o(hop, 0, "shifts").focus(); });
    phim(document.activeElement!, { key: "ArrowDown", shiftKey: true });
    phim(document.activeElement!, { key: "ArrowDown", shiftKey: true });
    phim(document.activeElement!, { key: "d", ctrlKey: true });
    expect(items.map((x) => x.shifts)).toEqual([2, 2, 2]);
    expect(thanhTien(hop, 2)).toBe("20.000");
    phim(document.activeElement!, { key: "z", ctrlKey: true });
    expect(items.map((x) => x.shifts)).toEqual([2, 1, 1]);
  });

  it("gõ Số Ca rồi Ctrl+Z: về số cũ, Thành Tiền về theo", () => {
    const items = [mk({ name: "A", quantity: 1, unitPrice: 100_000, shifts: 1 })];
    const hop = moLuoi(items, { usesShifts: true });
    goRoiChot(o(hop, 0, "shifts"), "5");
    expect(thanhTien(hop, 0)).toBe("500.000");
    act(() => { o(hop, 0, "name").focus(); });
    phim(document.activeElement!, { key: "z", ctrlKey: true });
    expect(items[0].shifts).toBe(1);
    expect(thanhTien(hop, 0)).toBe("100.000");
  });

  it("hàng bị khoá (đã duyệt): ô Số Ca tắt như mọi ô số", () => {
    const items = [mk({ name: "A", quantity: 1, unitPrice: 100_000, shifts: 2, approved: true })];
    const hop = moLuoi(items, { usesShifts: true, khoaHang: (it) => it.approved === true });
    expect(o(hop, 0, "shifts").disabled).toBe(true);
    expect(o(hop, 0, "quantity").disabled).toBe(true);
  });

  it("thêm hàng ở mẫu CINETOUR: hàng mới mang sẵn Số Ca = 1 (như Số Ngày = 1)", () => {
    const items = [mk({ name: "A", unitPrice: 1, shifts: 1 })];
    const hop = moLuoi(items, { usesShifts: true });
    const nut = [...hop.querySelectorAll("button")].find((b) => /\+ ?Thêm hàng/.test(b.textContent || ""));
    expect(nut, "không thấy nút + Thêm hàng").toBeTruthy();
    act(() => { (nut as HTMLButtonElement).click(); });
    expect(items.length).toBe(2);
    expect(items[1].shifts).toBe(1);
  });
});
