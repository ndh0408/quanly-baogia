/** @vitest-environment jsdom */
//
// Soát toàn diện đợt 3 (L61 phần component con): hộp "Xoá sheet nội bộ?" / "Xoá sheet Hà Nội?" là DOM tự
// dựng (confirmModal), KHÔNG tự đóng khi Back — Shell gỡ editor (đổi `key` theo route) mà hộp vẫn nằm đè
// lên trang mới. Xác nhận hộp treo đó từng xoá bảng của báo giá ĐÃ RỜI rồi gọi onMarkDirty = mark() của
// editor đã gỡ: bật cờ `__editorDirty` DÙNG CHUNG trên trang mới (hỏi "Rời khỏi mà chưa lưu?" vô cớ) và
// hẹn giờ ghi bản nháp của báo giá cũ sau khi cleanup đã chạy.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const h = vi.hoisted(() => ({ traLoi: null as ((v: boolean) => void) | null }));
vi.mock("../lib/venueCatalog", async (goc) => ({ ...(await goc<typeof import("../lib/venueCatalog")>()), loadCatalog: () => Promise.resolve({ entries: [], venues: [] }) }));
vi.mock("../lib/ui", async (goc) => ({
  ...(await goc<typeof import("../lib/ui")>()),
  toast: () => {},
  confirmModal: vi.fn(() => new Promise<boolean>((r) => { h.traLoi = r; })),
}));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { ExtraTables, type ExtraTable } from "./ExtraTables";
import { HnTables, type HnTable } from "./HnTables";
import type { EditorTemplate } from "../lib/api";

const MAU: EditorTemplate[] = [
  { id: 2, code: "unibenfood", name: "GN (có ngày)", companyId: 1, layout: { hasDetail: false, reserveDetail: false, hasDays: true, numberSubsections: false } } as EditorTemplate,
];
const hang = (ten: string) => ({ kind: "item", name: ten, unit: "bộ", quantity: 1, days: 1, unitPrice: 1_000_000, notes: "" });

let thung: HTMLDivElement, goc: Root | null;
beforeEach(() => { h.traLoi = null; thung = document.createElement("div"); document.body.appendChild(thung); goc = createRoot(thung); });
afterEach(() => { if (goc) act(() => goc!.unmount()); goc = null; thung.remove(); document.body.innerHTML = ""; });

const go = () => { act(() => goc!.unmount()); goc = null; };
const traLoi = async (v: boolean) => { await act(async () => { h.traLoi!(v); }); };

describe("L61 — hộp 'Xoá sheet nội bộ?' còn treo sau khi editor đã gỡ", () => {
  const dung = (sheet: { id: number; templateId: number; extraTables: ExtraTable[] }, onMarkDirty: () => void) => {
    act(() => { goc!.render(<ExtraTables sheet={sheet} templates={MAU} companyId={1} editable canApprove={false} onMarkDirty={onMarkDirty} />); });
    act(() => { thung.querySelector<HTMLButtonElement>(".khoi-sheet-nut")!.click(); });   // mở khối Chi Phí HCM
    act(() => { thung.querySelector<HTMLButtonElement>(".rm-tab")!.click(); });
  };
  const sheet = () => ({ id: 1, templateId: 2, extraTables: [{ category: "hcm", templateId: 2, name: "HCM 1", items: [hang("Xe chở")] }] as unknown as ExtraTable[] });

  it("xác nhận hộp treo sau khi gỡ → KHÔNG xoá bảng, KHÔNG gọi onMarkDirty", async () => {
    const s = sheet(), danhDau = vi.fn();
    dung(s, danhDau);
    expect(h.traLoi, "chưa bật hộp hỏi xoá").not.toBeNull();
    go();
    await traLoi(true);
    expect(s.extraTables.length, "hộp treo xoá bảng của báo giá đã rời").toBe(1);
    expect(danhDau, "hộp treo gọi mark() của editor đã gỡ").not.toHaveBeenCalled();
  });

  it("đối chứng: còn gắn, xác nhận → xoá bảng và báo đã sửa", async () => {
    const s = sheet(), danhDau = vi.fn();
    dung(s, danhDau);
    await traLoi(true);
    expect(s.extraTables.length).toBe(0);
    expect(danhDau).toHaveBeenCalled();
  });
});

describe("L61 — hộp 'Xoá sheet Hà Nội?' còn treo sau khi editor / màn Account HN đã gỡ", () => {
  const dung = (tables: HnTable[], onMarkDirty: () => void) => {
    act(() => { goc!.render(<HnTables moMacDinh tables={tables} templates={MAU} companyId={1} editable onMarkDirty={onMarkDirty} />); });
    act(() => { thung.querySelector<HTMLButtonElement>(".rm-tab")!.click(); });
  };
  const bang = () => [{ templateId: 2, name: "HN 1", items: [hang("Khung")] }, { templateId: 2, name: "HN 2", items: [hang("Bạt")] }] as unknown as HnTable[];

  it("xác nhận hộp treo sau khi gỡ → KHÔNG xoá bảng, KHÔNG gọi onMarkDirty", async () => {
    const t = bang(), danhDau = vi.fn();
    dung(t, danhDau);
    expect(h.traLoi, "chưa bật hộp hỏi xoá").not.toBeNull();
    go();
    await traLoi(true);
    expect(t.map((x) => x.name), "hộp treo xoá bảng HN của báo giá đã rời").toEqual(["HN 1", "HN 2"]);
    expect(danhDau, "hộp treo gọi mark() của màn đã gỡ").not.toHaveBeenCalled();
  });

  it("đối chứng: còn gắn, xác nhận → xoá bảng và báo đã sửa", async () => {
    const t = bang(), danhDau = vi.fn();
    dung(t, danhDau);
    await traLoi(true);
    expect(t.map((x) => x.name)).toEqual(["HN 2"]);
    expect(danhDau).toHaveBeenCalled();
  });
});
