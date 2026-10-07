/** @vitest-environment jsdom */
//
// HỘP "CHIA HÓA ĐƠN" của màn báo giá (sau khi chốt) + tổng Chưa thu.
// Chủ repo:
//   2026-10-06 "back lại cho họ tự chọn lại để làm lại hóa đơn"; "có bỏ ra" (Chưa thu bỏ sheet Không xuất, Để sau vẫn tính).
//   2026-10-07 "không nó phải nằm ở chỗ duyệt cơ", "account chủ báo giá là người làm cái đó" → hộp chia + "Làm lại hóa
//   đơn này" chuyển từ trang Hóa đơn đầu ra (kế toán) sang màn báo giá (chủ báo giá). Hộp xác nhận vẫn nêu mã + số HĐ
//   sẽ gỡ và "đã thu X — giữ nguyên"; gỡ xong ô của sheet đó mở ra ngay để chọn lại.
// ĐỎ trên 643b491: hộp chưa có nút "Làm lại hóa đơn này", chưa xem trước Trước / Sau VAT, và báo giá chưa chia mà không đổi
// gì vẫn gửi một lệnh bỏ chia.
import { describe, it, expect, vi, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ProjectQuote } from "../lib/api";
import { fmtMoney } from "../lib/format";

const sh = (id: number, codeNo: number, name: string, subtotal: number, extra: Record<string, unknown> = {}) =>
  ({ id, codeNo, name, subtotal, invoiceNo: null, invoiceDate: null, paidAt: null, invoiceGroup: null, invoiceHold: null, signedAt: "2026-10-01", ...extra });
// Báo giá 7 (VAT 8%): Hóa đơn 1 = Sân khấu + Âm thanh, ĐÃ có số HĐ, đã thu; Ánh sáng Để sau; LED Không xuất.
const BG7 = {
  id: 7, title: "Sự kiện", status: "converted", vatPercent: 8, projectCode: "FP_7", quoteNumber: "GN26007", customerName: "Khách 7",
  sheets: [
    sh(71, 1, "Sân khấu", 1_000_000, { invoiceGroup: 1, invoiceNo: "HD-7", invoiceDate: "2026-10-02", paidAt: "2026-10-05" }),
    sh(72, 2, "Âm thanh", 2_000_000, { invoiceGroup: 1, invoiceNo: "HD-7", invoiceDate: "2026-10-02", paidAt: "2026-10-05" }),
    sh(73, 3, "Ánh sáng", 4_000_000, { invoiceHold: "later" }),
    sh(74, 4, "LED", 500_000, { invoiceHold: "skip" }),
  ],
} as ProjectQuote;
// Báo giá 8: CHƯA CHIA, hai sheet chưa xuất.
const BG8 = { id: 8, title: "Hội nghị", status: "converted", vatPercent: 10, projectCode: "FP_8", sheets: [sh(81, 1, "Trang A", 100_000), sh(82, 2, "Trang B", 200_000)] } as ProjectQuote;

vi.mock("../lib/api", async (goc) => {
  const that = await goc<typeof import("../lib/api")>();
  return { ...that, api: { ...that.api, quoteProjects: vi.fn(async () => ({ data: [BG7] })), lamLaiHoaDon: vi.fn(async () => ({ sheetIds: [71, 72], invoiceNo: ["HD-7"] })), chiaHoaDon: vi.fn(async (_id: number, ds: unknown[]) => ({ sheets: ds })) } };
});
const xacNhan = vi.fn(async (..._a: unknown[]) => true);
vi.mock("../lib/ui", async (goc) => ({ ...(await goc<typeof import("../lib/ui")>()), toast: vi.fn(), confirmModal: (...a: unknown[]) => xacNhan(...a) }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { InvoicesPage } from "./Invoices";
import { ProjectsPage } from "./Projects";
import { buildActionItems } from "./Dashboard";
import { HopChiaHoaDon } from "../components/HopChiaHoaDon";
import { api } from "../lib/api";

let root: Root | null = null;
const cho = async (ms = 0) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
afterEach(() => { if (root) act(() => root!.unmount()); root = null; document.body.innerHTML = ""; vi.clearAllMocks(); });

async function mo(el: React.ReactElement) {
  const hop = document.createElement("div"); document.body.appendChild(hop);
  root = createRoot(hop);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => { root!.render(<QueryClientProvider client={qc}>{el}</QueryClientProvider>); });
  await cho(20);
  return hop;
}
const giaTriStat = (hop: HTMLElement, nhan: string) =>
  [...hop.querySelectorAll(".stat-card")].find((c) => c.querySelector(".stat-label")?.textContent === nhan)?.querySelector(".stat-value")?.textContent;
const ME = (permissions: string[]) => ({ id: 1, username: "kt", displayName: "KT", role: "accountant", permissions });
const VAT = (x: number) => x + Math.round(x * 0.08);
const doiChon = (el: HTMLSelectElement, v: string) => act(() => {
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(el, v);
  el.dispatchEvent(new Event("change", { bubbles: true }));
});
const nutCo = (hop: HTMLElement, chu: string) => [...hop.querySelectorAll("button")].find((b) => b.textContent === chu) as HTMLButtonElement;

describe("hộp Chia hóa đơn (màn báo giá, sau khi chốt)", () => {
  it("hóa đơn đã xuất: ô chọn KHOÁ + 'Làm lại hóa đơn này' → xác nhận nêu mã, số HĐ, các sheet, 'Đã thu … GIỮ NGUYÊN' → API → ô mở ra", async () => {
    const daLamLai = vi.fn();
    const hop = await mo(<HopChiaHoaDon q={BG7} onClose={vi.fn()} onSaved={vi.fn()} onDaLamLai={daLamLai} />);
    const o71 = () => hop.querySelector('select[name="chiaHoaDon-71"]') as HTMLSelectElement;
    expect(o71().disabled, "sheet của hóa đơn đã xuất khoá").toBe(true);
    const nut = hop.querySelector('button[aria-label="Làm lại hóa đơn này — FP_7_01"]') as HTMLButtonElement;
    expect(nut, "có hành động làm lại cho hóa đơn đã xuất").not.toBeNull();
    expect(hop.querySelectorAll('button[aria-label^="Làm lại hóa đơn này"]'), "một nút cho một hóa đơn, không lặp theo sheet").toHaveLength(1);
    await act(async () => { nut.click(); });
    await cho(10);
    const [tieuDe, loi] = xacNhan.mock.calls[0] as [string, string];
    expect(tieuDe).toContain("FP_7_01");
    expect(loi).toContain("HD-7");
    expect(loi).toContain("Sân khấu, Âm thanh");
    expect(loi).toMatch(/Đã thu .* GIỮ NGUYÊN/);
    expect(api.lamLaiHoaDon).toHaveBeenCalledWith(7, 71);
    expect(daLamLai).toHaveBeenCalledWith([71, 72]);
    expect(o71().disabled, "gỡ số HĐ xong thì chọn lại được ngay").toBe(false);
  });

  it("hủy xác nhận → không gọi API, ô vẫn khoá", async () => {
    xacNhan.mockResolvedValueOnce(false);
    const hop = await mo(<HopChiaHoaDon q={BG7} onClose={vi.fn()} onSaved={vi.fn()} />);
    await act(async () => { (hop.querySelector('button[aria-label^="Làm lại hóa đơn này"]') as HTMLButtonElement).click(); });
    await cho(10);
    expect(api.lamLaiHoaDon).not.toHaveBeenCalled();
    expect((hop.querySelector('select[name="chiaHoaDon-71"]') as HTMLSelectElement).disabled).toBe(true);
  });

  it("xếp Ánh sáng (Để sau) vào Hóa đơn 2: xem trước _02 đúng Trước / Sau VAT; Lưu gửi ĐỦ sheet", async () => {
    const daLuu = vi.fn();
    const hop = await mo(<HopChiaHoaDon q={BG7} onClose={vi.fn()} onSaved={daLuu} />);
    const o73 = hop.querySelector('select[name="chiaHoaDon-73"]') as HTMLSelectElement;
    expect(o73.value).toBe("later");
    doiChon(o73, "2");
    const xem = hop.querySelector(".inv-chia-xem")!.textContent!;
    expect(xem).toContain("FP_7_01");
    expect(xem).toContain(`trước VAT ${fmtMoney(3_000_000)}`);
    expect(xem).toContain("FP_7_02");
    expect(xem).toContain(`trước VAT ${fmtMoney(4_000_000)}`);
    expect(xem).toContain(`sau VAT ${fmtMoney(4_320_000)}`);
    await act(async () => { nutCo(hop, "Lưu").click(); });
    await cho(10);
    const ds = [
      { sheetId: 71, group: 1, hold: null }, { sheetId: 72, group: 1, hold: null },
      { sheetId: 73, group: 2, hold: null }, { sheetId: 74, group: null, hold: "skip" },
    ];
    expect(api.chiaHoaDon).toHaveBeenCalledWith(7, ds);
    expect(daLuu).toHaveBeenCalledWith(ds);
  });

  it("báo giá chưa chia, không đổi gì → KHÔNG gửi gì ('chưa chia' giữ nghĩa cũ); gom hai sheet → gửi Hóa đơn 1 cho cả hai", async () => {
    let hop = await mo(<HopChiaHoaDon q={BG8} onClose={vi.fn()} onSaved={vi.fn()} />);
    expect((hop.querySelector('select[name="chiaHoaDon-82"]') as HTMLSelectElement).value, "mặc định = số mã cũ").toBe("2");
    await act(async () => { nutCo(hop, "Lưu").click(); });
    await cho(10);
    expect(api.chiaHoaDon).not.toHaveBeenCalled();
    act(() => root!.unmount()); root = null; document.body.innerHTML = "";

    hop = await mo(<HopChiaHoaDon q={BG8} onClose={vi.fn()} onSaved={vi.fn()} />);
    doiChon(hop.querySelector('select[name="chiaHoaDon-82"]') as HTMLSelectElement, "1");
    expect(hop.querySelector(".inv-chia-xem")!.textContent, "một hóa đơn gom mọi sheet → không hậu tố").toContain("FP_8 —");
    await act(async () => { nutCo(hop, "Lưu").click(); });
    await cho(10);
    expect(api.chiaHoaDon).toHaveBeenLastCalledWith(8, [{ sheetId: 81, group: 1, hold: null }, { sheetId: 82, group: 1, hold: null }]);
  });
});

describe("Chưa thu bỏ sheet Không xuất, giữ sheet Để sau", () => {
  it("Hóa đơn đầu ra: Tổng + Chưa thu (sau VAT) cộng Để sau (Ánh sáng), KHÔNG cộng Không xuất (LED); có Tổng trước VAT", async () => {
    const hop = await mo(<InvoicesPage me={ME(["invoice:page"])} />);
    expect(giaTriStat(hop, "Tổng sau VAT")).toBe(fmtMoney(VAT(3_000_000) + VAT(4_000_000)));
    expect(giaTriStat(hop, "Tổng trước VAT")).toBe(fmtMoney(3_000_000 + 4_000_000));
    expect(giaTriStat(hop, "Đã thu (sau VAT)")).toBe(fmtMoney(VAT(3_000_000)));
    expect(giaTriStat(hop, "Chưa thu (sau VAT)")).toBe(fmtMoney(VAT(4_000_000)));
  });

  it("Quản lý dự án: Chưa thanh toán bỏ LED (Không xuất), giữ Ánh sáng (Để sau); dòng LED gắn nhãn", async () => {
    const hop = await mo(<ProjectsPage me={ME(["invoice:read", "user:manage"])} />);
    expect(giaTriStat(hop, "Chưa thanh toán")).toBe(fmtMoney(VAT(4_000_000)));
    expect(hop.textContent).toContain("Không xuất HĐ");
  });

  it("Dashboard 'Cần xử lý': 'Đã ký · chưa xuất hóa đơn' có Để sau, không có Không xuất", () => {
    const inv = buildActionItems([BG7]).find((c) => c.key === "inv")!;
    expect(inv.items.map((x) => x.hangMuc)).toEqual(["Ánh sáng"]);
    const chuaChia = { ...BG7, sheets: BG7.sheets!.map((s) => ({ ...s, invoiceGroup: null, invoiceHold: null, invoiceNo: null })) } as ProjectQuote;
    expect(buildActionItems([chuaChia]).find((c) => c.key === "inv")!.items).toHaveLength(4);
  });
});
