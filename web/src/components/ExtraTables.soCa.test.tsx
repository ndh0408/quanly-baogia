/** @vitest-environment jsdom */
//
// MẪU CINETOUR ở BẢNG NỘI BỘ (Chi phí HCM / Phí KH) và BẢNG HÀ NỘI: bảng chọn mẫu có cột SỐ CA thì lưới hiện cột đó
// và MỌI con số tổng (đầu khối, từng tab, khối tổng nhiều sheet) nhân Số Ca — khớp máy chủ (quoteUtils.extraTableSum +
// bangNoiBoCoCa). Đổi bảng sang mẫu thường mà còn hàng Số Ca ≠ 1 → hỏi trước. ĐỎ trên 7a6ce18.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const h = vi.hoisted(() => ({ confirm: null as unknown as ReturnType<typeof vi.fn> }));
vi.mock("../lib/venueCatalog", async (goc) => ({ ...(await goc<typeof import("../lib/venueCatalog")>()), loadCatalog: () => Promise.resolve({ entries: [], venues: [] }) }));
vi.mock("../lib/ui", async (goc) => {
  const confirm = vi.fn(async () => true);
  h.confirm = confirm;
  return { ...(await goc<typeof import("../lib/ui")>()), toast: () => {}, confirmModal: confirm };
});
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { ExtraTables, type ExtraTable } from "./ExtraTables";
import { HnTables, type HnTable } from "./HnTables";
import type { EditorTemplate } from "../lib/api";

const MAU: EditorTemplate[] = [
  { id: 1, code: "marico_decor", name: "GN (không ngày)", companyId: 1, layout: { hasDetail: false, reserveDetail: true, hasDays: false, hasShifts: false, numberSubsections: false } },
  { id: 7, code: "gn_cinetour", name: "GN CINETOUR (không ngày)", companyId: 1, layout: { hasDetail: false, reserveDetail: false, hasDays: false, hasShifts: true, numberSubsections: false } },
] as EditorTemplate[];
// 2 người × 3 ca × 100.000 = 600.000 (mẫu CINETOUR) · 200.000 (mẫu thường)
const hang = (o: Record<string, unknown> = {}) => ({ kind: "item", name: "Bảo vệ", unit: "người", quantity: 2, shifts: 3, unitPrice: 100_000, notes: "", approved: true, ...o });

let thung: HTMLDivElement, goc: Root;
beforeEach(() => { vi.clearAllMocks(); thung = document.createElement("div"); document.body.appendChild(thung); goc = createRoot(thung); });
afterEach(() => { act(() => goc.unmount()); thung.remove(); document.body.innerHTML = ""; });
const soTien = (el: Element | null | undefined) => { const m = (el?.textContent || "").match(/\d{1,3}(?:\.\d{3})+/); return m ? Number(m[0].replace(/\./g, "")) : NaN; };
const tieuDe = () => [...thung.querySelectorAll("table.excel-table thead th")].map((th) => (th.textContent || "").trim());
const chonMau = async (id: number) => {
  await act(async () => { const sel = thung.querySelector("select.extra-tpl") as HTMLSelectElement; sel.value = String(id); sel.dispatchEvent(new Event("change", { bubbles: true })); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
};

describe("Chi phí HCM dùng mẫu CINETOUR", () => {
  it("lưới có cột SỐ CA; tổng đầu khối và tổng từng tab nhân Số Ca", () => {
    const s = { id: 1, templateId: 1, extraTables: [
      { category: "hcm", templateId: 7, name: "Rạp 1", items: [hang()] },
      { category: "hcm", templateId: 7, name: "Rạp 2", items: [hang({ shifts: null, quantity: 1 })] },
    ] as unknown as ExtraTable[] };
    act(() => { goc.render(<ExtraTables sheet={s} templates={MAU} companyId={1} editable canApprove onMarkDirty={() => {}} />); });
    act(() => { (thung.querySelectorAll(".khoi-sheet-nut")[0] as HTMLButtonElement).click(); });
    expect(tieuDe()).toContain("SỐ CA");
    // Hai sheet: tổng cả loại nằm ở khối tổng nhiều sheet (BangTongLuong) — 600.000 + 100.000.
    expect(thung.textContent, "tổng cả loại").toContain("700.000");
    expect(thung.textContent).not.toContain("300.000");
    expect([...thung.querySelectorAll(".sheet-tab-tong")].map(soTien), "tổng từng tab").toEqual([600_000, 100_000]);
  });

  it("đổi bảng sang mẫu thường: hỏi trước; đồng ý thì thôi nhân Số Ca, chọn lại CINETOUR là lấy lại", async () => {
    const s = { id: 1, templateId: 1, extraTables: [{ category: "hcm", templateId: 7, name: "Rạp", items: [hang()] }] as unknown as ExtraTable[] };
    act(() => { goc.render(<ExtraTables sheet={s} templates={MAU} companyId={1} editable canApprove onMarkDirty={() => {}} />); });
    act(() => { (thung.querySelectorAll(".khoi-sheet-nut")[0] as HTMLButtonElement).click(); });
    h.confirm.mockResolvedValueOnce(false);
    await chonMau(1);
    expect(h.confirm).toHaveBeenCalledTimes(1);
    expect(s.extraTables[0].templateId, "không đồng ý mà vẫn đổi mẫu").toBe(7);
    await chonMau(1);
    expect(s.extraTables[0].templateId).toBe(1);
    expect(soTien(thung.querySelector(".extra-cat-total"))).toBe(200_000);
    expect(tieuDe()).not.toContain("SỐ CA");
    await chonMau(7);
    expect(soTien(thung.querySelector(".extra-cat-total")), "Số Ca mất khi đổi mẫu qua lại").toBe(600_000);
  });
});

describe("bảng Hà Nội dùng mẫu CINETOUR", () => {
  it("lưới có cột SỐ CA; tổng nhân Số Ca", () => {
    const t = [{ name: "HN", templateId: 7, groupSubtotal: false, items: [hang()] }] as unknown as HnTable[];
    act(() => { goc.render(<HnTables moMacDinh tables={t} templates={MAU} companyId={1} editable onMarkDirty={() => {}} />); });
    expect(tieuDe()).toContain("SỐ CA");
    expect(thung.textContent).toContain("600.000");
    expect(thung.textContent).not.toContain("200.000");
  });
});
