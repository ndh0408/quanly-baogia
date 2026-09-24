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
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({ quote: null as unknown, mau: [] as unknown[] }));
vi.mock("../lib/venueCatalog", async (goc) => ({ ...(await goc<typeof import("../lib/venueCatalog")>()), loadCatalog: () => Promise.resolve({ entries: [], venues: [] }) }));
vi.mock("../lib/ui", async (goc) => ({ ...(await goc<typeof import("../lib/ui")>()), toast: () => {}, confirmModal: async () => true }));
vi.mock("../lib/api", async (goc) => {
  const that = await goc<typeof import("../lib/api")>();
  return { ...that, api: { ...that.api, getQuote: vi.fn(async () => h.quote), metaTemplates: vi.fn(async () => h.mau) } };
});
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { ExtraTables, extraTableSum, type ExtraTable } from "./ExtraTables";
import { HnTables, mauBangHn, type HnTable } from "./HnTables";
import { InternalQuoteView } from "../pages/InternalQuoteView";
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
  it("không nói mẫu: như cũ (nhân days > 0) — như extraTableSum máy chủ khi nơi gọi chưa có mẫu", () => { expect(extraTableSum(t)).toBe(6000); });
});

// Đợt 4 (L64 phía máy chủ): máy chủ (quoteUtils.extraTableSum + bangNoiBoCoNgay — Quản lý dự án, tổng HN ở
// danh sách của account HN) và trang chi phí nội bộ nay tính theo mẫu y như màn soạn. CÙNG bộ đầu vào với
// tests/quoteUtils.test.js ("extraTableSum theo mẫu của bảng — khớp web") — sửa một bên thì sửa cả bên kia.
describe("cùng bộ đầu vào với máy chủ — luật chọn mẫu + tổng bảng", () => {
  const mau = (id: number, companyId: number, hasDays: boolean) => ({ id, code: `m${id}`, name: `M${id}`, companyId, layout: { hasDays } }) as EditorTemplate;
  const MAU_MC = [mau(1, 7, false), mau(2, 7, true), mau(3, 8, true)];
  const bang = (templateId: number | null) => ({ category: "hanoi", ...(templateId != null ? { templateId } : {}), items: [{ kind: "item", quantity: 2, days: 3, unitPrice: 1000 }] }) as unknown as ExtraTable;
  const CA: [string, number | null, number, number][] = [
    ["mẫu không ngày", 1, 7, 2000],
    ["mẫu có ngày", 2, 7, 6000],
    ["thiếu mẫu → mẫu đầu của công ty (không ngày)", null, 7, 2000],
    ["mẫu không còn trong danh sách → mẫu đầu của công ty", 99, 7, 2000],
    ["thiếu mẫu, công ty 8 → mẫu đầu của công ty 8 (có ngày)", null, 8, 6000],
    ["thiếu mẫu, công ty không có mẫu nào → mẫu đầu danh sách", null, 9, 2000],
    ["mẫu của công ty khác vẫn tra theo id", 3, 7, 6000],
  ];
  for (const [ten, tpl, cty, tong] of CA) {
    it(`${ten} → ${tong}`, () => { expect(extraTableSum(bang(tpl), !!mauBangHn(bang(tpl), MAU_MC, cty)?.layout?.hasDays)).toBe(tong); });
  }
});

describe("InternalQuoteView — tổng bảng theo mẫu như màn soạn", () => {
  it("bảng HCM mẫu KHÔNG ngày còn days cũ → 2.000 (không nhân); bảng HN mẫu có ngày → 6.000", async () => {
    h.mau = MAU;
    h.quote = {
      id: 11, quoteNumber: "GN26011", companyId: 1, _internalView: true,
      internalSheets: [{ sheetId: 101, sheetName: "Trang 1", order: 1, tables: [{ category: "hcm", templateId: 1, name: "HCM", items: [{ ...hang(), rid: "e1" }] }] }],
      hnTables: [{ templateId: 2, name: "HN", items: [{ ...hang(), rid: "h1" }] }],
    };
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const me = { id: 3, username: "cp", displayName: "CP", role: "employee", permissions: ["quote:internal:view"] };
    await act(async () => { goc.render(<QueryClientProvider client={qc}><InternalQuoteView quoteId={11} me={me as never} /></QueryClientProvider>); });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    const tong = [...thung.querySelectorAll("tfoot td.num")].map((x) => x.textContent);
    const thanhTien = [...thung.querySelectorAll("tbody tr")].map((tr) => tr.querySelectorAll("td.num")[2]?.textContent);
    expect(tong, "bảng mẫu không ngày bị nhân ngày — lệch màn soạn").toEqual(["2.000", "6.000"]);
    expect(thanhTien).toEqual(["2.000", "6.000"]);
  });
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
