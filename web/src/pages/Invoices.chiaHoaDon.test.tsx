/** @vitest-environment jsdom */
//
// TRANG HÓA ĐƠN ĐẦU RA — HIỂN THỊ phép chia của chủ báo giá (chủ repo 2026-10-07: "trang hóa đơn là tách ra theo mã khi
// mà account chọn", "thì kế toán báo account để làm lại"; ảnh phác: mỗi mã một khối, cột Hạng mục mỗi sheet một dòng;
// "hạng mục là tên rút gọn_tên sheet, nếu không có tên rút gọn thì lấy theo tên chính"; cột Số tiền tách Trước VAT / Sau
// VAT; tiền mỗi mã = CHỈ các sheet chủ báo giá chọn vào mã đó).
//   · Mỗi MÃ (_01, _02…) một khối: các cột gộp dọc (rowSpan), Hạng mục mỗi sheet một dòng con.
//   · Để sau nhóm riêng (hai cột tiền), Không xuất ẩn tới khi tích.
//   · Kế toán KHÔNG chia / làm lại ở đây nữa — không còn nút; có dòng gợi ý báo chủ báo giá.
// ĐỎ trên 643b491: còn nút Chia HĐ / Làm lại HĐ, Hạng mục là ô gõ tay, một cột "Số tiền".
import { describe, it, expect, vi, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ProjectQuote } from "../lib/api";
import { fmtMoney } from "../lib/format";

const sh = (id: number, codeNo: number, name: string, subtotal: number, extra: Record<string, unknown> = {}) =>
  ({ id, codeNo, name, subtotal, invoiceNo: null, invoiceDate: null, invoiceGroup: null, invoiceHold: null, ...extra });
const baoGia = (id: number, sheets: ReturnType<typeof sh>[], extra: Record<string, unknown> = {}): ProjectQuote =>
  ({ id, title: "BẢNG BÁO GIÁ - Sự kiện ra mắt", shortTitle: "Ra mắt", status: "converted", vatPercent: 8, projectCode: `FP_${id}`, customerName: `Khách ${id}`, createdBy: { displayName: "Lan" }, sheets, ...extra }) as ProjectQuote;

// Báo giá 7 (VAT 8%, có tiêu đề rút gọn): Sân khấu + Âm thanh = Hóa đơn 1, Ánh sáng Để sau, LED Không xuất.
// Báo giá 8 (VAT 10%, KHÔNG có tiêu đề rút gọn): chưa chia — hai sheet, mỗi sheet một mã như cũ.
// Báo giá 9 (VAT 0%): A + B → _01, C → _02; kế toán từng gõ tay Hạng mục cho HĐ 1.
const DU_AN: ProjectQuote[] = [
  baoGia(7, [
    sh(71, 1, "Sân khấu", 1_000_000, { invoiceGroup: 1, poNumber: "PO-7" }),
    sh(72, 2, "Âm thanh", 2_000_000, { invoiceGroup: 1, poNumber: "PO-7" }),
    sh(73, 3, "Ánh sáng", 4_000_000, { invoiceHold: "later" }),
    sh(74, 4, "LED", 500_000, { invoiceHold: "skip" }),
  ]),
  baoGia(8, [sh(81, 1, "Trang A", 100_000), sh(82, 2, "Trang B", 200_000)], { shortTitle: null, title: "Hội nghị khách hàng", vatPercent: 10 }),
  baoGia(9, [
    sh(91, 1, "A", 300_000, { invoiceGroup: 1, invoiceDesc: "Thi công gian hàng" }),
    sh(92, 2, "B", 700_000, { invoiceGroup: 1, invoiceDesc: "Thi công gian hàng" }),
    sh(93, 3, "C", 50_000, { invoiceGroup: 2 }),
  ], { vatPercent: 0, shortTitle: "Hội chợ" }),
];

vi.mock("../lib/api", async (goc) => {
  const that = await goc<typeof import("../lib/api")>();
  return { ...that, api: { ...that.api, quoteProjects: vi.fn(async () => ({ data: DU_AN })), updateSheetInvoice: vi.fn(async () => ({})), chiaHoaDon: vi.fn(async () => ({ sheets: [] })), lamLaiHoaDon: vi.fn(async () => ({ sheetIds: [], invoiceNo: [] })) } };
});
vi.mock("../lib/ui", async (goc) => ({ ...(await goc<typeof import("../lib/ui")>()), toast: vi.fn() }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { InvoicesPage, buildRows, buildHeld } from "./Invoices";

describe("buildRows / buildHeld — tiền mỗi mã chỉ cộng sheet chủ báo giá chọn vào mã đó", () => {
  it("chưa chia: mỗi sheet một mã _01/_02 như cũ; Trước / Sau VAT 10%", () => {
    const rows = buildRows([DU_AN[1]]);
    expect(rows.map((r) => [r.code, r.subtotal, r.amount])).toEqual([["FP_8_01", 100_000, 110_000], ["FP_8_02", 200_000, 220_000]]);
  });

  it("S1+S2 → _01, S3 Để sau, S4 Không xuất ⇒ _01 = S1+S2 (VAT 8% trên tổng); S3 riêng ở nhóm Để sau; S4 không ở đâu trong tổng", () => {
    const rows = buildRows([DU_AN[0]]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ code: "FP_7_01", subtotal: 3_000_000, amount: 3_240_000, sheetId: 71, poNumber: "PO-7" });
    expect(buildHeld([DU_AN[0]]).map((h) => [h.hold, h.code, h.name, h.subtotal, h.amount])).toEqual([
      ["later", "FP_7_03", "Ánh sáng", 4_000_000, 4_320_000],
      ["skip", "FP_7_04", "LED", 500_000, 540_000],
    ]);
  });

  it("VAT 0%: Trước = Sau; hai mã là hai dòng riêng, mỗi mã đúng tổng của mình", () => {
    expect(buildRows([DU_AN[2]]).map((r) => [r.code, r.subtotal, r.amount])).toEqual([["FP_9_01", 1_000_000, 1_000_000], ["FP_9_02", 50_000, 50_000]]);
  });

  it("HẠNG MỤC tự sinh = tiêu đề rút gọn_tên sheet; không có rút gọn → tiêu đề chính (bỏ tiền tố BẢNG BÁO GIÁ)", () => {
    expect(buildRows([DU_AN[0]])[0].hangMuc).toEqual(["Ra mắt_Sân khấu", "Ra mắt_Âm thanh"]);
    expect(buildRows([DU_AN[1]]).map((r) => r.hangMuc)).toEqual([["Hội nghị khách hàng_Trang A"], ["Hội nghị khách hàng_Trang B"]]);
    const q = { ...DU_AN[1], shortTitle: "  ", title: "BẢNG BÁO GIÁ - Lễ khai trương" } as ProjectQuote;
    expect(buildRows([q])[0].hangMuc).toEqual(["Lễ khai trương_Trang A"]);
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
/** Các <tr> của khối mã `code` trong bảng hóa đơn: dòng đầu (chứa ô mã) + các dòng con Hạng mục ngay sau nó. */
function khoi(hop: HTMLElement, code: string) {
  const ds = [...hop.querySelectorAll(".inv-table tbody tr")] as HTMLTableRowElement[];
  const i = ds.findIndex((tr) => [...tr.cells].some((c) => c.querySelector("strong")?.textContent === code));
  if (i < 0) throw new Error("không thấy khối " + code);
  const out = [ds[i]];
  for (let j = i + 1; j < ds.length && ds[j].classList.contains("inv-hm-dong"); j++) out.push(ds[j]);
  return out;
}
const cotIdx = (hop: HTMLElement, ten: string) => [...hop.querySelectorAll(".inv-table thead th")].findIndex((th) => th.textContent?.replace(/[▲▼]/g, "").trim() === ten);

describe("trang Hóa đơn đầu ra — mỗi mã một khối, Hạng mục mỗi sheet một dòng", () => {
  it("_01 gom 2 sheet = MỘT khối 2 dòng: ô mã / tiền gộp dọc (rowSpan 2), Hạng mục 2 dòng con", async () => {
    const hop = await moTrang();
    const k = khoi(hop, "FP_7_01");
    expect(k).toHaveLength(2);
    const oMa = [...k[0].cells].find((c) => c.querySelector("strong")?.textContent === "FP_7_01")!;
    expect(oMa.rowSpan).toBe(2);
    expect(k[0].querySelector("td.inv-hm")!.textContent).toBe("Ra mắt_Sân khấu");
    expect(k[1].cells).toHaveLength(1);
    expect(k[1].cells[0].textContent).toBe("Ra mắt_Âm thanh");
    expect(hop.querySelector(".inv-table")!.textContent, "S2 không thành mã riêng").not.toContain("FP_7_02");
  });

  it("hai mã của một báo giá → hai khối riêng; báo giá chưa chia / 1 sheet mỗi mã → 1 dòng con", async () => {
    const hop = await moTrang();
    expect(khoi(hop, "FP_9_01")).toHaveLength(2);
    expect(khoi(hop, "FP_9_02")).toHaveLength(1);
    expect(khoi(hop, "FP_9_02")[0].querySelector("td.inv-hm")!.textContent).toBe("Hội chợ_C");
    const k8 = khoi(hop, "FP_8_01");
    expect(k8).toHaveLength(1);
    expect(k8[0].querySelector("td.inv-hm")!.textContent).toBe("Hội nghị khách hàng_Trang A");
  });

  it("Hạng mục kế toán từng gõ tay KHÔNG mất: khác chữ tự sinh → hiện nhỏ 'ghi cũ: …'", async () => {
    const hop = await moTrang();
    const cu = khoi(hop, "FP_9_01")[0].querySelector(".inv-hm-cu");
    expect(cu?.textContent).toBe("ghi cũ: Thi công gian hàng");
    expect(khoi(hop, "FP_7_01")[0].querySelector(".inv-hm-cu")).toBeNull();
  });

  it("hai cột Trước VAT / Sau VAT đứng chỗ cột Số tiền cũ, đúng số từng mã (VAT 8% / 10% / 0%)", async () => {
    const hop = await moTrang();
    const truoc = cotIdx(hop, "Trước VAT"), sau = cotIdx(hop, "Sau VAT");
    expect(truoc).toBeGreaterThan(0);
    expect(sau).toBe(truoc + 1);
    expect(cotIdx(hop, "Công nợ")).toBe(sau + 1);
    expect(cotIdx(hop, "Số tiền")).toBe(-1);
    const tien = (code: string) => {
      const tr = khoi(hop, code)[0];
      const nums = [...tr.cells].filter((c) => c.classList.contains("num")).map((c) => c.textContent);
      return nums.slice(0, 2);
    };
    expect(tien("FP_7_01")).toEqual([fmtMoney(3_000_000), fmtMoney(3_240_000)]);
    expect(tien("FP_8_02")).toEqual([fmtMoney(200_000), fmtMoney(220_000)]);
    expect(tien("FP_9_01")).toEqual([fmtMoney(1_000_000), fmtMoney(1_000_000)]);
  });

  it("sắp xếp được theo Trước VAT và Sau VAT (aria-sort)", async () => {
    const hop = await moTrang();
    const th = (ten: string) => [...hop.querySelectorAll(".inv-table thead th")].find((x) => x.textContent?.startsWith(ten)) as HTMLElement;
    act(() => th("Trước VAT").click());
    expect(th("Trước VAT").getAttribute("aria-sort")).toBe("ascending");
    const ma = () => [...hop.querySelectorAll(".inv-table tbody tr:not(.inv-hm-dong)")].map((tr) => [...tr.querySelectorAll("strong")].map((s) => s.textContent).find((t) => /^FP_/.test(t || "")));
    expect(ma()[0]).toBe("FP_9_02");   // 50.000 nhỏ nhất
    act(() => th("Sau VAT").click());
    expect(th("Sau VAT").getAttribute("aria-sort")).toBe("ascending");
    expect(th("Trước VAT").getAttribute("aria-sort")).toBe("none");
  });

  it("nhóm Để sau hiện riêng (hai cột tiền); Không xuất ẩn tới khi tích", async () => {
    const hop = await moTrang();
    const deSau = hop.querySelector('section[aria-label^="Sheet để sau"]');
    expect(deSau!.textContent).toContain("Ánh sáng");
    expect(deSau!.textContent).toContain("FP_7_03");
    expect(deSau!.textContent).toContain(fmtMoney(4_000_000));
    expect(deSau!.textContent).toContain(fmtMoney(4_320_000));
    expect(hop.querySelector('section[aria-label^="Sheet không xuất"]')).toBeNull();
    act(() => (hop.querySelector('input[name="hienKhongXuat"]') as HTMLInputElement).click());
    expect(hop.querySelector('section[aria-label^="Sheet không xuất"]')!.textContent).toContain("LED");
  });

  it("ô tìm khớp chữ Hạng mục mới và cả hai số tiền", async () => {
    const hop = await moTrang();
    const tim = hop.querySelector('input[name="q"]') as HTMLInputElement;
    const go = (v: string) => act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(tim, v);
      tim.dispatchEvent(new Event("input", { bubbles: true }));
    });
    go("Ra mắt_Âm thanh");
    expect(hop.querySelector(".inv-table")!.textContent).toContain("FP_7_01");
    expect(hop.querySelector(".inv-table")!.textContent).not.toContain("FP_8_01");
    go(fmtMoney(3_000_000));
    expect(hop.querySelector(".inv-table")!.textContent).toContain("FP_7_01");
  });

  it("kế toán KHÔNG chia / làm lại ở đây: không còn nút, có gợi ý báo chủ báo giá", async () => {
    const hop = await moTrang(["invoice:edit", "invoice:pay", "invoice:page", "user:manage"]);
    const nut = [...hop.querySelectorAll("button")].map((b) => (b.getAttribute("aria-label") || "") + " " + b.textContent);
    expect(nut.some((t) => /Chia H|Làm lại|Xếp vào hóa đơn/.test(t))).toBe(false);
    expect(hop.querySelector('[role="note"]')!.textContent).toMatch(/chủ báo giá/);
    expect(hop.querySelector(".inv-table textarea, .inv-table input[name=\"invoiceDesc\"], td[aria-label^=\"Sửa Hạng mục\"]")).toBeNull();
  });
});
