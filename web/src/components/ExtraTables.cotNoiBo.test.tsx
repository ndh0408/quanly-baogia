/** @vitest-environment jsdom */
// Ba cột NS · CHỨNG TỪ · LƯU KHO (4e24308) chỉ hiện khi NƠI GỌI GridTable truyền `cotNoiBo`. Các bài của
// GridTable tự dựng lưới với prop đó nên vẫn xanh dù ExtraTables (Chi phí HCM · Phí khách hàng) hay
// HnTables (Hà Nội) quên truyền — tức người dùng mất cả ba cột mà không một bài nào đỏ. Ở đây dựng đúng
// hai component thật, như trang soạn / màn account Hà Nội dựng.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("../lib/venueCatalog", async (goc) => ({ ...(await goc<typeof import("../lib/venueCatalog")>()), loadCatalog: () => Promise.resolve({ entries: [], venues: [] }) }));
vi.mock("../lib/ui", async (goc) => ({ ...(await goc<typeof import("../lib/ui")>()), toast: () => {}, confirmModal: async () => true }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { ExtraTables, type ExtraTable } from "./ExtraTables";
import { HnTables, type HnTable } from "./HnTables";
import type { EditorTemplate } from "../lib/api";

const MAU: EditorTemplate[] = [{ id: 1, code: "gn", name: "GN (không ngày)", companyId: 1, layout: { hasDetail: false, reserveDetail: false, hasDays: false, numberSubsections: false } } as EditorTemplate];
type Hang = Record<string, unknown>;
const hang = (o: Hang = {}): Hang => ({ kind: "item", name: "Backdrop", unit: "m2", quantity: 1, unitPrice: 250000, notes: "", ...o });

let thung: HTMLDivElement, goc: Root;
beforeEach(() => { thung = document.createElement("div"); document.body.appendChild(thung); goc = createRoot(thung); });
afterEach(() => { act(() => goc.unmount()); thung.remove(); document.body.innerHTML = ""; });

const tieuDe = () => [...thung.querySelectorAll("table.excel-table thead th")].map((th) => (th.textContent || "").trim());
/** Đoạn tiêu đề từ GHI CHÚ tới hết — nơi ba cột phải đứng. */
const sauGhiChu = () => { const td = tieuDe(); return td.slice(td.indexOf("GHI CHÚ")); };
const oLuoi = (row: number, sel: string) => thung.querySelector(`table.excel-table tr[data-row="${row}"] ${sel}`) as HTMLInputElement & HTMLSelectElement & HTMLTextAreaElement;
const chon = (el: HTMLSelectElement, v: string) => act(() => { el.value = v; el.dispatchEvent(new Event("change", { bubbles: true })); });

// CỘT THANH TOÁN CHỈ XEM (2026-10-06). Lần đầu (cb14f8c) cột bị gỡ hẳn khỏi màn soạn: "cái thanh toán bên đó là cho
// kế toán, không nằm trong kia nữa". Rồi chủ repo: "cái thanh toán hiện đã thanh toán ở đây ngày như nào chứ, và bên
// hóa đơn đầu vào là chỗ đó cho kế toán up hình thanh toán lên" → cột QUAY LẠI nhưng CHỈ XEM: "✓ Đã TT <ngày>" (+ 📎
// khi có ảnh), không nút / ô tích / ảnh — kể cả khi người mở giữ quyền cũ quote:internal:pay. `quyenThanhToanCu` là
// đúng hai prop màn soạn BẢN CŨ truyền cho người có quyền đó (rải qua biến `object` để tệp vẫn biên dịch).
// Ở đây không truyền `daChi` → cột đọc cờ LỚP PHỦ máy chủ gắn trên hàng lúc nạp (đường dự phòng); đường `daChi` (tươi
// theo realtime, có tên người tích) ở ExtraTables.daChiChiXem.test.tsx.
const quyenThanhToanCu: object = { canPay: true, quoteId: 21 };
const daChi = { rid: "r1", paid: true, paidAt: "2026-10-01T03:00:00.000Z", hasPaidProof: true };
const thanhToanChiXem = () => {
  expect(tieuDe(), "lưới nội bộ thiếu cột THANH TOÁN").toContain("THANH TOÁN");
  const o = thung.querySelector('table.excel-table tr[data-row="0"] td.col-pay') as HTMLElement;
  expect(o.textContent).toContain("✓ Đã TT 01/10/2026");
  expect(o.textContent).toContain("📎");
  expect(thung.querySelectorAll('td.col-pay button, td.col-pay input, td.col-pay select, td.col-pay a, td.col-pay img, button[data-xl="thanh-toan"]'), "cột Thanh toán phải CHỈ XEM").toHaveLength(0);
};

describe("ExtraTables (Chi phí HCM · Phí khách hàng) bật cột nội bộ thật", () => {
  const dung = (sheet: { id: number; templateId: number; extraTables: ExtraTable[]; _activeExtra?: number }, onMarkDirty = () => {}) =>
    act(() => { goc.render(<ExtraTables {...quyenThanhToanCu} sheet={sheet} templates={MAU} companyId={1} editable canApprove onMarkDirty={onMarkDirty} />); });
  const moKhoi = (i: number) => act(() => { (thung.querySelectorAll(".khoi-sheet-nut")[i] as HTMLButtonElement).click(); });

  it("Chi phí HCM: đủ NS · CHỨNG TỪ · LƯU KHO sau GHI CHÚ, rồi DUYỆT, rồi THANH TOÁN chỉ xem; ô hiện đúng giá trị đã lưu", () => {
    const s = { id: 1, templateId: 1, extraTables: [{ category: "hcm", templateId: 1, name: "HCM", items: [hang({ ns: "Anh Tuấn", chungTu: "VAT", luuKho: true, approved: true, ...daChi })] }] as unknown as ExtraTable[] };
    dung(s);
    moKhoi(0);
    expect(sauGhiChu().slice(0, 6)).toEqual(["GHI CHÚ", "NS", "CHỨNG TỪ", "LƯU KHO", "DUYỆT", "THANH TOÁN"]);
    thanhToanChiXem();
    expect(oLuoi(0, "[data-f=\"ns\"]").value).toBe("Anh Tuấn");
    expect(oLuoi(0, "td.col-chung-tu select").value).toBe("VAT");
    expect(oLuoi(0, "td.col-luu-kho input").checked).toBe(true);
  });

  it("Phí khách hàng: chọn chứng từ / tích lưu kho ghi vào đúng hàng của bảng và báo 'chưa lưu'", () => {
    const tables = [
      { category: "hcm", templateId: 1, name: "HCM", items: [hang()] },
      { category: "khach", templateId: 1, name: "Phí KH", items: [hang({ name: "Vận chuyển" })] },
    ] as unknown as ExtraTable[];
    const danhDau = vi.fn();
    dung({ id: 1, templateId: 1, extraTables: tables, _activeExtra: 1 }, danhDau);
    moKhoi(1);
    expect(sauGhiChu().slice(0, 4)).toEqual(["GHI CHÚ", "NS", "CHỨNG TỪ", "LƯU KHO"]);
    expect(tieuDe()).toContain("THANH TOÁN");
    expect((oLuoi(0, "td.col-pay") as HTMLElement).textContent, "hàng chưa chi").toBe("—");
    chon(oLuoi(0, "td.col-chung-tu select"), "HDNS");
    act(() => { oLuoi(0, "td.col-luu-kho input").click(); });
    const kh = tables[1].items[0] as unknown as Hang;
    expect([kh.chungTu, kh.luuKho]).toEqual(["HDNS", true]);
    expect((tables[0].items[0] as unknown as Hang).chungTu ?? null, "ghi nhầm sang bảng HCM").toBeNull();
    expect(danhDau).toHaveBeenCalled();
  });
});

describe("HnTables (Báo giá Hà Nội) bật cột nội bộ thật", () => {
  // 2026-10-06: bảng HN có cột DUYỆT từng hàng (trước đó duyệt theo cả phần nên không có cột).
  it("đủ ba cột + DUYỆT từng hàng + THANH TOÁN chỉ xem dù người mở có quote:internal:pay; tích / chọn ghi vào hàng và báo 'chưa lưu'", () => {
    const t = [{ templateId: 1, name: "HN", groupSubtotal: false, items: [hang({ name: "Nhân công", ns: "Chị Lan", ...daChi })] }] as unknown as HnTable[];
    const danhDau = vi.fn();
    act(() => { goc.render(<HnTables {...quyenThanhToanCu} moMacDinh tables={t} templates={MAU} companyId={1} editable onMarkDirty={danhDau} />); });
    const td = sauGhiChu();
    expect(td.slice(0, 4)).toEqual(["GHI CHÚ", "NS", "CHỨNG TỪ", "LƯU KHO"]);
    expect(td.slice(0, 6)).toEqual(["GHI CHÚ", "NS", "CHỨNG TỪ", "LƯU KHO", "DUYỆT", "THANH TOÁN"]);
    thanhToanChiXem();
    expect(oLuoi(0, "[data-f=\"ns\"]").value).toBe("Chị Lan");
    chon(oLuoi(0, "td.col-chung-tu select"), "TM");
    act(() => { oLuoi(0, "td.col-luu-kho input").click(); });
    const h = t[0].items[0] as unknown as Hang;
    expect([h.chungTu, h.luuKho]).toEqual(["TM", true]);
    expect(danhDau).toHaveBeenCalled();
  });
});
