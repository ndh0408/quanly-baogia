/** @vitest-environment jsdom */
//
// L64 (phần bảng nội bộ / Hà Nội): ExtraTables và HnTables từng XOÁ `days` của mọi hàng ngay LÚC VẼ khi
// bảng dùng mẫu không có cột Số Ngày (vì extraTableSum nhân days bất kể mẫu — không dọn thì tổng phồng).
// Đổi mẫu có ngày → không ngày → có ngày là số Ngày mất vĩnh viễn, tiền rơi về một ngày, lưới gắn lại theo
// mẫu nên Ctrl+Z không cứu. Mở một bảng mẫu không ngày còn days cũ thì bị coi là "đã sửa" ngay lúc mở.
// Nay tổng chỉ nhân days khi mẫu CÓ ngày; dọn days dời sang lúc Lưu (QuoteEditor / AccountHnView).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("../lib/venueCatalog", async (goc) => ({ ...(await goc<typeof import("../lib/venueCatalog")>()), loadCatalog: () => Promise.resolve({ entries: [], venues: [] }) }));
vi.mock("../lib/ui", async (goc) => ({ ...(await goc<typeof import("../lib/ui")>()), toast: () => {}, confirmModal: async () => true }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { ExtraTables, extraTableSum, type ExtraTable } from "./ExtraTables";
import { HnTables, type HnTable } from "./HnTables";
import type { EditorTemplate } from "../lib/api";

const MAU: EditorTemplate[] = [
  { id: 1, code: "gn", name: "GN (không ngày)", companyId: 1, layout: { hasDetail: false, reserveDetail: false, hasDays: false, numberSubsections: false } } as EditorTemplate,
  { id: 2, code: "gnd", name: "GN (có ngày)", companyId: 1, layout: { hasDetail: false, reserveDetail: false, hasDays: true, numberSubsections: false } } as EditorTemplate,
];
// 2 cái × 3 ngày × 1.000 = 6.000 (mẫu có ngày) · 2.000 (mẫu không ngày)
const hang = () => ({ kind: "item", name: "Khung", unit: "bộ", quantity: 2, days: 3, unitPrice: 1000, notes: "", approved: true });

let thung: HTMLDivElement, goc: Root;
beforeEach(() => { thung = document.createElement("div"); document.body.appendChild(thung); goc = createRoot(thung); });
afterEach(() => { act(() => goc.unmount()); thung.remove(); document.body.innerHTML = ""; });

/** Tổng ở đầu khối (đầu khối vẽ tổng khi chỉ có một sheet). */
const tongDauKhoi = (i = 0) => {
  const m = (thung.querySelectorAll(".extra-cat-total")[i]?.textContent || "").match(/\d{1,3}(?:\.\d{3})+/);
  return m ? Number(m[0].replace(/\./g, "")) : NaN;
};
const chonMau = (id: number) => act(() => {
  const sel = thung.querySelector("select.extra-tpl") as HTMLSelectElement;
  sel.value = String(id); sel.dispatchEvent(new Event("change", { bubbles: true }));
});

describe("extraTableSum — chỉ nhân Số Ngày khi mẫu CÓ ngày", () => {
  const t = { category: "hanoi", items: [hang()] } as unknown as ExtraTable;
  it("mẫu không ngày (usesDays = false): bỏ qua days cũ", () => { expect(extraTableSum(t, false)).toBe(2000); });
  it("mẫu có ngày: nhân days", () => { expect(extraTableSum(t, true)).toBe(6000); });
  it("không nói mẫu (InternalQuoteView, dữ liệu đã lưu): như cũ — khớp extraTableSum máy chủ", () => { expect(extraTableSum(t)).toBe(6000); });
});

describe("HnTables — đổi mẫu qua lại không mất số Ngày", () => {
  const dung = (tables: HnTable[], onMarkDirty = () => {}) => act(() => {
    goc.render(<HnTables moMacDinh tables={tables} templates={MAU} companyId={1} editable onMarkDirty={onMarkDirty} />);
  });

  it("có ngày (6.000) → không ngày (2.000) → có ngày: vẫn 3 ngày, lại 6.000", () => {
    const t = [{ templateId: 2, name: "HN", groupSubtotal: false, items: [hang()] }] as unknown as HnTable[];
    dung(t);
    expect(tongDauKhoi()).toBe(6000);
    chonMau(1);
    expect(tongDauKhoi(), "mẫu không ngày mà tổng vẫn nhân ngày").toBe(2000);
    expect(t[0].items[0].days, "số Ngày bị xoá lúc vẽ").toBe(3);
    chonMau(2);
    expect(tongDauKhoi()).toBe(6000);
  });

  it("mở bảng mẫu KHÔNG ngày còn days cũ → tổng không nhân ngày, KHÔNG bị coi là đã sửa lúc mở", () => {
    const t = [{ templateId: 1, name: "HN", groupSubtotal: false, items: [hang()] }] as unknown as HnTable[];
    const danhDau = vi.fn();
    dung(t, danhDau);
    expect(tongDauKhoi()).toBe(2000);
    expect(danhDau, "mới mở đã báo 'có thay đổi chưa lưu'").not.toHaveBeenCalled();
  });
});

describe("ExtraTables — đổi mẫu qua lại không mất số Ngày", () => {
  const dung = (sheet: { id: number; templateId: number; extraTables: ExtraTable[] }, onMarkDirty = () => {}) => {
    act(() => { goc.render(<ExtraTables sheet={sheet} templates={MAU} companyId={1} editable canApprove={false} onMarkDirty={onMarkDirty} />); });
  };

  it("Phí KH có ngày (6.000) → không ngày (2.000) → có ngày: vẫn 3 ngày, lại 6.000", () => {
    const s = { id: 1, templateId: 2, extraTables: [{ category: "khach", templateId: 2, name: "KH", items: [hang()] }] as unknown as ExtraTable[] };
    dung(s);
    act(() => { (thung.querySelectorAll(".khoi-sheet-nut")[1] as HTMLButtonElement).click(); });   // mở khối Phí Khách Hàng
    expect(tongDauKhoi(1)).toBe(6000);
    chonMau(1);
    expect(tongDauKhoi(1)).toBe(2000);
    expect(s.extraTables[0].items[0].days, "số Ngày bị xoá lúc vẽ").toBe(3);
    chonMau(2);
    expect(tongDauKhoi(1)).toBe(6000);
  });

  it("mở bảng mẫu KHÔNG ngày còn days cũ → tổng không nhân ngày, KHÔNG bị coi là đã sửa lúc mở", () => {
    const s = { id: 1, templateId: 1, extraTables: [{ category: "hcm", templateId: 1, name: "HCM", items: [hang()] }] as unknown as ExtraTable[] };
    const danhDau = vi.fn();
    dung(s, danhDau);
    expect(tongDauKhoi(0)).toBe(2000);
    expect(danhDau, "mới mở đã báo 'có thay đổi chưa lưu'").not.toHaveBeenCalled();
  });
});
