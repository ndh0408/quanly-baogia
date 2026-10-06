/** @vitest-environment jsdom */
//
// CHIA SHEET THÀNH HÓA ĐƠN — trang Hóa đơn đầu ra (chủ repo 2026-10-06). Kế toán gom sheet thành Hóa đơn 1, 2… (mã
// _01/_02), Để sau (nhóm riêng — còn phải xuất), Không xuất (ẩn, bật bằng ô tích). Chưa chia = mỗi sheet một dòng như cũ.
// ĐỎ trên mã cũ: buildHeld / hộp Chia hóa đơn chưa có, hóa đơn gom nhiều sheet vẫn tách từng dòng.
import { describe, it, expect, vi, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ProjectQuote } from "../lib/api";

const sh = (id: number, codeNo: number, name: string, subtotal: number, extra: Record<string, unknown> = {}) =>
  ({ id, codeNo, name, subtotal, invoiceNo: null, invoiceDate: null, invoiceGroup: null, invoiceHold: null, ...extra });
const baoGia = (id: number, sheets: ReturnType<typeof sh>[], extra: Record<string, unknown> = {}): ProjectQuote =>
  ({ id, title: "Sự kiện", status: "converted", vatPercent: 8, projectCode: `FP_${id}`, customerName: `Khách ${id}`, sheets, ...extra }) as ProjectQuote;

// Báo giá 7: ĐÃ CHIA — Sân khấu + Âm thanh = Hóa đơn 1, Ánh sáng Để sau, LED Không xuất.
// Báo giá 8: CHƯA CHIA — hai sheet, mỗi sheet một hóa đơn như cũ.
const DU_AN: ProjectQuote[] = [
  baoGia(7, [
    sh(71, 1, "Sân khấu", 1_000_000, { invoiceGroup: 1, poNumber: "PO-7" }),
    sh(72, 2, "Âm thanh", 2_000_000, { invoiceGroup: 1, poNumber: "PO-7" }),
    sh(73, 3, "Ánh sáng", 4_000_000, { invoiceHold: "later" }),
    sh(74, 4, "LED", 500_000, { invoiceHold: "skip" }),
  ]),
  baoGia(8, [sh(81, 1, "Trang A", 100_000), sh(82, 2, "Trang B", 200_000)]),
];

vi.mock("../lib/api", async (goc) => {
  const that = await goc<typeof import("../lib/api")>();
  return { ...that, api: { ...that.api, quoteProjects: vi.fn(async () => ({ data: DU_AN })), updateSheetInvoice: vi.fn(async () => ({})), chiaHoaDon: vi.fn(async () => ({ sheets: [] })) } };
});
vi.mock("../lib/ui", async (goc) => ({ ...(await goc<typeof import("../lib/ui")>()), toast: vi.fn() }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { InvoicesPage, buildRows, buildHeld } from "./Invoices";
import { api } from "../lib/api";

describe("buildRows / buildHeld — dựng hóa đơn theo phép chia", () => {
  it("chưa chia: mỗi sheet một dòng, mã sản xuất _01/_02 y như cũ", () => {
    const rows = buildRows([DU_AN[1]]);
    expect(rows.map((r) => [r.code, r.amount])).toEqual([["FP_8_01", 108_000], ["FP_8_02", 216_000]]);
  });

  it("đã chia: Hóa đơn 1 gom hai sheet thành MỘT dòng mã _01, tiền = tổng sheet + VAT; Để sau / Không xuất không thành dòng", () => {
    const rows = buildRows([DU_AN[0]]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ code: "FP_7_01", amount: 3_240_000, sheetId: 71, poNumber: "PO-7", sheetNames: ["Sân khấu", "Âm thanh"] });
  });

  it("một hóa đơn gom MỌI sheet, không còn sheet Để sau → mã không hậu tố (như báo giá một sheet)", () => {
    const q = baoGia(9, [sh(91, 1, "A", 100, { invoiceGroup: 1 }), sh(92, 2, "B", 100, { invoiceGroup: 1 }), sh(93, 3, "C", 100, { invoiceHold: "skip" })]);
    expect(buildRows([q]).map((r) => r.code)).toEqual(["FP_9"]);
    // Có hóa đơn 2 → mọi hóa đơn mang hậu tố.
    const q2 = baoGia(9, [sh(91, 1, "A", 100, { invoiceGroup: 1 }), sh(92, 2, "B", 100, { invoiceGroup: 2 })]);
    expect(buildRows([q2]).map((r) => r.code)).toEqual(["FP_9_01", "FP_9_02"]);
  });

  it("buildHeld: sheet Để sau + Không xuất, mang mã sản xuất của chính sheet và tiền có VAT", () => {
    expect(buildHeld(DU_AN).map((h) => [h.hold, h.code, h.name, h.amount])).toEqual([
      ["later", "FP_7_03", "Ánh sáng", 4_320_000],
      ["skip", "FP_7_04", "LED", 540_000],
    ]);
  });
});

let root: Root | null = null;
const cho = async (ms = 0) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
afterEach(() => { if (root) act(() => root!.unmount()); root = null; document.body.innerHTML = ""; vi.clearAllMocks(); });

async function moTrang(permissions = ["invoice:edit", "invoice:pay", "invoice:page"]) {
  const hop = document.createElement("div"); document.body.appendChild(hop);
  root = createRoot(hop);
  const me = { id: 1, username: "kt", displayName: "KT", role: "accountant", permissions };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => { root!.render(<QueryClientProvider client={qc}><InvoicesPage me={me} /></QueryClientProvider>); });
  await cho(20);
  return hop;
}
const doiChon = (el: HTMLSelectElement, v: string) => act(() => {
  const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
  set.call(el, v);
  el.dispatchEvent(new Event("change", { bubbles: true }));
});

describe("trang Hóa đơn đầu ra — giao diện chia", () => {
  it("nhóm Để sau hiện riêng; Không xuất ẩn tới khi tích; Hạng mục trống gợi ý theo tên sheet", async () => {
    const hop = await moTrang();
    const deSau = hop.querySelector('section[aria-label^="Sheet để sau"]');
    expect(deSau, "nhóm Sheet để sau phải hiện").not.toBeNull();
    expect(deSau!.textContent).toContain("Ánh sáng");
    expect(deSau!.textContent).toContain("FP_7_03");
    expect(hop.querySelector('section[aria-label^="Sheet không xuất"]')).toBeNull();
    const tich = hop.querySelector('input[name="hienKhongXuat"]') as HTMLInputElement;
    expect(tich).not.toBeNull();
    act(() => tich.click());
    expect(hop.querySelector('section[aria-label^="Sheet không xuất"]')!.textContent).toContain("LED");

    const bang = hop.querySelector(".inv-table")!;
    expect(bang.textContent).toContain("FP_7_01");
    expect(bang.textContent).toContain("Sân khấu, Âm thanh");
    expect(bang.textContent).not.toContain("FP_7_02");
  });

  it("Chia HĐ: xếp Ánh sáng vào Hóa đơn 2 → gửi đủ sheet, đúng nhóm; xem trước mã _01/_02", async () => {
    const hop = await moTrang();
    const nut = hop.querySelector('button[aria-label="Chia hóa đơn — FP_7_01"]') as HTMLButtonElement;
    expect(nut, "kế toán thấy nút Chia HĐ").not.toBeNull();
    act(() => nut.click());
    const hopThoai = document.querySelector('[role="dialog"]') as HTMLElement;
    expect(hopThoai).not.toBeNull();
    const chon = hopThoai.querySelector('select[name="chiaHoaDon-73"]') as HTMLSelectElement;
    expect(chon.value).toBe("later");
    doiChon(chon, "2");
    expect(hopThoai.textContent).toContain("FP_7_02");
    const luu = [...hopThoai.querySelectorAll("button")].find((b) => b.textContent === "Lưu")!;
    await act(async () => { luu.click(); });
    await cho(10);
    expect(api.chiaHoaDon).toHaveBeenCalledWith(7, [
      { sheetId: 71, group: 1, hold: null },
      { sheetId: 72, group: 1, hold: null },
      { sheetId: 73, group: 2, hold: null },
      { sheetId: 74, group: null, hold: "skip" },
    ]);
  });

  it("báo giá chưa chia: gom hai sheet vào Hóa đơn 1; để nguyên mặc định thì gửi BỎ CHIA (mọi sheet null)", async () => {
    const hop = await moTrang();
    act(() => (hop.querySelector('button[aria-label="Chia hóa đơn — FP_8_01"]') as HTMLButtonElement).click());
    let hopThoai = document.querySelector('[role="dialog"]') as HTMLElement;
    expect((hopThoai.querySelector('select[name="chiaHoaDon-82"]') as HTMLSelectElement).value, "mặc định = số mã cũ").toBe("2");
    const luu = () => [...(document.querySelector('[role="dialog"]') as HTMLElement).querySelectorAll("button")].find((b) => b.textContent === "Lưu")!;
    await act(async () => { luu().click(); });
    await cho(10);
    expect(api.chiaHoaDon).toHaveBeenLastCalledWith(8, [{ sheetId: 81, group: null, hold: null }, { sheetId: 82, group: null, hold: null }]);

    act(() => (hop.querySelector('button[aria-label="Chia hóa đơn — FP_8_01"]') as HTMLButtonElement).click());
    hopThoai = document.querySelector('[role="dialog"]') as HTMLElement;
    doiChon(hopThoai.querySelector('select[name="chiaHoaDon-82"]') as HTMLSelectElement, "1");
    expect(hopThoai.textContent, "một hóa đơn gom mọi sheet → không hậu tố").toContain("FP_8 —");
    await act(async () => { luu().click(); });
    await cho(10);
    expect(api.chiaHoaDon).toHaveBeenLastCalledWith(8, [{ sheetId: 81, group: 1, hold: null }, { sheetId: 82, group: 1, hold: null }]);
  });

  it("không có invoice:edit → không có nút Chia HĐ / Xếp vào hóa đơn", async () => {
    const hop = await moTrang(["invoice:page"]);
    expect(hop.querySelector('button[aria-label^="Chia hóa đơn"]')).toBeNull();
    expect(hop.querySelector('button[aria-label^="Xếp vào hóa đơn"]')).toBeNull();
  });
});
