/** @vitest-environment jsdom */
// KHOÁ HÀNG CHI PHÍ HCM / PHÍ KH ĐÃ DUYỆT ở giao diện (chủ repo 2026-10-06: "khoá HCM như HN"). Hàng đã duyệt: mọi ô
// tắt, không nút xoá — kể cả với người có quyền duyệt; ô tích Duyệt vẫn bấm được để BỎ duyệt, bỏ là mở lại ngay. NS ·
// Chứng từ · Lưu kho mở khi nơi gọi cho (`moCotNoiBo`). Máy chủ chặn thật (409 'hang-hcm-da-khoa' — tests/hcm-khoa-…).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("../lib/venueCatalog", async (goc) => ({ ...(await goc<typeof import("../lib/venueCatalog")>()), loadCatalog: () => Promise.resolve({ entries: [], venues: [] }) }));
const toastGoi: string[] = [];
vi.mock("../lib/ui", async (goc) => ({ ...(await goc<typeof import("../lib/ui")>()), toast: (m: string) => { toastGoi.push(m); }, confirmModal: async () => true }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { ExtraTables, type ExtraTable } from "./ExtraTables";
import type { EditorTemplate } from "../lib/api";

const MAU: EditorTemplate[] = [{ id: 1, code: "gn", name: "GN", companyId: 1, layout: { hasDetail: false, reserveDetail: false, hasDays: false, numberSubsections: false } } as EditorTemplate];
const hang = (o: Record<string, unknown>) => ({ kind: "item", name: "x", unit: "bộ", quantity: 1, unitPrice: 1000, notes: "", ...o });

let thung: HTMLDivElement, goc: Root;
beforeEach(() => { toastGoi.length = 0; thung = document.createElement("div"); document.body.appendChild(thung); goc = createRoot(thung); });
afterEach(() => { act(() => goc.unmount()); thung.remove(); document.body.innerHTML = ""; });

const dong = (i: number) => thung.querySelector(`table.excel-table tr[data-row="${i}"]`) as HTMLTableRowElement;
function dung(moCotNoiBo: boolean) {
  const sheet = { id: 1, templateId: 1, extraTables: [{ category: "hcm", templateId: 1, name: "HCM", items: [
    hang({ name: "Đã duyệt", rid: "d", approved: true, approvedAt: "2026-10-01T00:00:00.000Z" }),
    hang({ name: "Chưa duyệt", rid: "c", approved: false }),
  ] }] as unknown as ExtraTable[] };
  act(() => { goc.render(<ExtraTables sheet={sheet} templates={MAU} companyId={1} editable canApprove moCotNoiBo={moCotNoiBo} onMarkDirty={() => {}} />); });
  act(() => { (thung.querySelector(".khoi-sheet-nut") as HTMLButtonElement).click(); });
  return sheet;
}

describe("ExtraTables — hàng đã duyệt bị khoá", () => {
  it("người CÓ quyền duyệt: ô hàng đã duyệt tắt, không nút xoá; hàng chưa duyệt sửa được; ô Duyệt vẫn bấm được", () => {
    dung(false);
    expect(dong(0).querySelector<HTMLInputElement>('input[name="unitPrice"]')!.disabled).toBe(true);
    expect(dong(0).querySelector<HTMLTextAreaElement>('textarea[name="name"]')!.disabled).toBe(true);
    expect(dong(0).querySelector<HTMLTextAreaElement>('textarea[name="ns"]')!.disabled).toBe(true);
    expect(dong(0).querySelector(".rm-row")).toBeNull();
    expect(dong(0).querySelector<HTMLInputElement>('input[name="approved"]')!.disabled).toBe(false);
    expect(dong(1).querySelector<HTMLInputElement>('input[name="unitPrice"]')!.disabled).toBe(false);
    expect(dong(1).querySelector(".rm-row")).not.toBeNull();
  });

  it("bỏ tích Duyệt → hàng mở lại ngay", () => {
    dung(false);
    act(() => { dong(0).querySelector<HTMLInputElement>('input[name="approved"]')!.click(); });
    expect(dong(0).querySelector<HTMLInputElement>('input[name="unitPrice"]')!.disabled).toBe(false);
  });

  it("moCotNoiBo: NS · Chứng từ · Lưu kho của hàng đã duyệt mở, tiền vẫn khoá", () => {
    dung(true);
    expect(dong(0).querySelector<HTMLTextAreaElement>('textarea[name="ns"]')!.disabled).toBe(false);
    expect(dong(0).querySelector<HTMLSelectElement>('select[name="chungTu"]')!.disabled).toBe(false);
    expect(dong(0).querySelector<HTMLInputElement>('input[name="luuKho"]')!.disabled).toBe(false);
    expect(dong(0).querySelector<HTMLInputElement>('input[name="unitPrice"]')!.disabled).toBe(true);
  });
});

// Đường sửa NHIỀU Ô (dán, kéo điền, cắt, Ctrl+Z) không đi qua ô đã tắt mà ghi thẳng vào model rồi báo đổi. Hàng đã duyệt
// phải được HOÀN LẠI ngay ở lần báo đổi đó (cùng cơ chế với bảng HN — lib/giuHangKhoa), kèm toast; bỏ duyệt rồi thì thôi.
describe("ExtraTables — sửa lọt vào hàng đã duyệt bị hoàn lại ngay", () => {
  const baoDoi = () => act(() => { dong(1).querySelector<HTMLInputElement>('input[name="luuKho"]')!.click(); });
  it("ghi đè giá + xoá hàng đã duyệt → hoàn lại (chèn lại đúng chỗ) + toast", () => {
    const sheet = dung(false);
    const items = sheet.extraTables[0].items as unknown as Record<string, unknown>[];
    items[0].unitPrice = 999_999;          // như dán / kéo điền đè lên
    baoDoi();
    expect(items[0].unitPrice).toBe(1000);
    expect(toastGoi.some((m) => /đã duyệt bị khoá/.test(m))).toBe(true);
    items.splice(0, 1);                    // như cắt / Ctrl+Z làm mất hàng
    // Báo đổi qua ô tên sheet (DOM của lưới còn chỉ số hàng cũ — bấm ô trong lưới lúc này là chạm hàng không còn).
    act(() => { const o = thung.querySelector<HTMLInputElement>('input[name="tenSheet"]')!; o.value = "HCM"; o.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(items[0]).toMatchObject({ rid: "d", name: "Đã duyệt", unitPrice: 1000, approved: true });
    expect(dong(0).querySelector<HTMLInputElement>('input[name="unitPrice"]')!.disabled, "lưới vẽ lại từ model đã hoàn").toBe(true);
  });
  it("người duyệt BỎ tích trước → sửa / xoá sau đó KHÔNG bị hoàn", () => {
    const sheet = dung(false);
    const items = sheet.extraTables[0].items as unknown as Record<string, unknown>[];
    act(() => { dong(0).querySelector<HTMLInputElement>('input[name="approved"]')!.click(); });
    items[0].unitPrice = 5000;
    baoDoi();
    expect(items[0].unitPrice).toBe(5000);
    expect(toastGoi.some((m) => /bị khoá/.test(m))).toBe(false);
  });
});
