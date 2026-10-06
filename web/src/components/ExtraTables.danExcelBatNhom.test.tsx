/** @vitest-environment jsdom */
// BẢNG PHỤ (Chi phí HCM · Phí khách hàng) KHÔNG có hộp "Nhập từ Excel" riêng: ImportExcelModal chỉ mở ở trình soạn báo giá
// (sheet chính) và ở màn Account Hà Nội. Đường đưa dữ liệu Excel vào bảng phụ là DÁN KHỐI chép từ Excel — lưới dựng lại nhóm /
// nhóm con / hạng mục từ khối có hàng tiêu đề (GridTable.onPaste, nhánh "dán dựng lại từ Excel"). Đường đó phải theo cùng luật
// với mọi đường nhập: khối mang nhóm Số Lượng > 1 thì "Hiện Thành Tiền nhóm" tự bật rồi khoá; nhóm SL 1 thì để nguyên.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("../lib/venueCatalog", async (goc) => ({ ...(await goc<typeof import("../lib/venueCatalog")>()), loadCatalog: () => Promise.resolve({ entries: [], venues: [] }) }));
vi.mock("../lib/ui", async (goc) => ({ ...(await goc<typeof import("../lib/ui")>()), toast: () => {}, confirmModal: async () => true }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { ExtraTables, type ExtraTable } from "./ExtraTables";
import type { EditorTemplate } from "../lib/api";

const MAU: EditorTemplate[] = [{ id: 1, code: "gn", name: "GN (không ngày)", companyId: 1, layout: { hasDetail: false, reserveDetail: false, hasDays: false, numberSubsections: false } } as EditorTemplate];
type Hang = Record<string, unknown>;
const nhom = (sl: number): Hang => ({ kind: "section", name: "Nhóm", unit: "", quantity: sl, unitPrice: 0, notes: "" });
const muc = (): Hang => ({ kind: "item", name: "Backdrop", unit: "m2", quantity: 2, unitPrice: 100_000, notes: "" });

/** Khối chép từ Excel: hàng tiêu đề + một nhóm (chữ "A") Số Lượng `slNhom` + một hạng mục. */
const khoiExcel = (slNhom: string) => [
  ["STT", "Hạng Mục", "ĐVT", "Số Lượng", "Đơn Giá", "Thành Tiền", "Ghi Chú"],
  ["A", "Dàn dựng sân khấu", "", slNhom, "", "", ""],
  ["1", "Backdrop", "m2", "2", "100.000", "200.000", ""],
].map((r) => r.join("\t")).join("\n");

let thung: HTMLDivElement, goc: Root;
beforeEach(() => { thung = document.createElement("div"); document.body.appendChild(thung); goc = createRoot(thung); });
afterEach(async () => {
  await act(async () => { await new Promise((r) => setTimeout(r, 220)); });   // cho hẹn giờ vẽ-hoãn 180ms nổ trong act
  act(() => goc.unmount()); thung.remove(); document.body.innerHTML = "";
});

/** Dựng ExtraTables thật với MỘT bảng Chi phí HCM, mở khối của nó. */
function dung(t: ExtraTable) {
  const sheet = { id: 1, templateId: 1, extraTables: [t] };
  act(() => { goc.render(<ExtraTables sheet={sheet} templates={MAU} companyId={1} editable canApprove onMarkDirty={() => {}} />); });
  act(() => { (thung.querySelectorAll(".khoi-sheet-nut")[0] as HTMLButtonElement).click(); });
}
const oTich = () => thung.querySelector<HTMLInputElement>('label.gf-group-sub input[type="checkbox"]')!;
const trangThai = () => [oTich().checked, oTich().disabled];
/** Đứng ở ô Hạng Mục hàng đầu (chưa sửa) rồi DÁN văn bản thường như trình duyệt. */
function danVaoHangDau(text: string) {
  const o = thung.querySelector('table.excel-table tr[data-row="0"] [data-f="name"]') as HTMLTextAreaElement;
  act(() => { o.focus(); });
  act(() => {
    const ev = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(ev, "clipboardData", { value: { getData: (k: string) => (k === "text/plain" || k === "text" ? text : "") } });
    o.dispatchEvent(ev);
  });
}
const xaHen = () => act(async () => { await new Promise((r) => setTimeout(r, 220)); });

describe("bảng phụ: dán khối chép từ Excel (đường nhập Excel duy nhất của bảng phụ) theo luật tự bật", () => {
  it("bảng TẮT, khối mang nhóm Số Lượng 3 → nhóm dựng lại SL 3, ô Thành Tiền nhóm tự bật rồi khoá", async () => {
    const t = { category: "hcm", templateId: 1, name: "HCM", groupSubtotal: false, items: [nhom(1), muc()] } as unknown as ExtraTable;
    dung(t);
    expect(trangThai()).toEqual([false, false]);
    danVaoHangDau(khoiExcel("3"));
    const dau = t.items[0] as unknown as Hang;
    expect([dau.kind, dau.quantity], "khối không được dựng lại thành nhóm — bài này vô nghĩa").toEqual(["section", 3]);
    expect(t.groupSubtotal, "nhóm SL 3 mà ô tắt là tổng nhóm sai im lặng").toBe(true);
    await xaHen();
    expect(trangThai()).toEqual([true, true]);
  });

  it("khối chỉ có nhóm Số Lượng 1 → không bật (hệ số ×1 không đổi gì)", async () => {
    const t = { category: "hcm", templateId: 1, name: "HCM", groupSubtotal: false, items: [nhom(1), muc()] } as unknown as ExtraTable;
    dung(t);
    danVaoHangDau(khoiExcel("1"));
    expect((t.items[0] as unknown as Hang).kind).toBe("section");
    expect(t.groupSubtotal).toBe(false);
    await xaHen();
    expect(trangThai()).toEqual([false, false]);
  });
});
