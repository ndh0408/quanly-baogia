/** @vitest-environment jsdom */
// CỘT "THANH TOÁN" CHỈ XEM ở bảng nội bộ (chủ repo 2026-10-06): "cái thanh toán hiện đã thanh toán ở đây ngày như nào
// chứ, và bên hóa đơn đầu vào là chỗ đó cho kế toán up hình thanh toán lên".
//
// cb14f8c gỡ hẳn cột khỏi màn soạn / Account HN → người soạn không biết hàng nào kế toán đã chi. Nay cột quay lại ở
// Chi phí HCM · Phí KH · Hà Nội, CHỈ XEM: "✓ Đã TT <ngày>" + tên người tích (+ 📎 khi có ảnh), nguồn GET
// /quotes/:id/khoan-chi (trạng thái HIỆU LỰC, khoản thắng cờ JSON cũ) qua useDaChiBaoGia — tươi lại khi có sự kiện
// realtime `inputInvoice`, KHÔNG nạp lại cả báo giá. Hàng nhóm / nhóm con không có ô; không nút / ô tích / ảnh nào.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({ daChi: [] as unknown[], goi: 0, quote: null as unknown }));
vi.mock("../lib/venueCatalog", async (goc) => ({ ...(await goc<typeof import("../lib/venueCatalog")>()), loadCatalog: () => Promise.resolve({ entries: [], venues: [] }) }));
vi.mock("../lib/ui", async (goc) => ({ ...(await goc<typeof import("../lib/ui")>()), toast: () => {}, confirmModal: async () => true }));
vi.mock("../lib/api", async (goc) => {
  const that = await goc<typeof import("../lib/api")>();
  return { ...that, isPreviewMode: () => false, api: { ...that.api,
    quoteDaChi: vi.fn(async (id: number) => { h.goi++; const [sheet, hn] = h.daChi as [unknown[], unknown[]]; return { quoteId: id, sheet: sheet ?? [], hn: hn ?? [] }; }),
    getQuote: vi.fn(async () => h.quote),
    metaTemplates: vi.fn(async () => MAU),
  } };
});
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { ExtraTables, type ExtraTable } from "./ExtraTables";
import { HnTables, type HnTable } from "./HnTables";
import { useDaChiBaoGia } from "../lib/daChiHang";
import { InternalQuoteView } from "../pages/InternalQuoteView";
import { AccountHnView } from "../pages/AccountHnView";
import type { EditorTemplate } from "../lib/api";

const MAU: EditorTemplate[] = [{ id: 1, code: "gn", name: "GN (không ngày)", companyId: 1, layout: { hasDetail: false, reserveDetail: false, hasDays: false, numberSubsections: false } } as EditorTemplate];
const hang = (o: Record<string, unknown> = {}) => ({ kind: "item", name: "Backdrop", unit: "m2", quantity: 1, unitPrice: 250000, notes: "", approved: true, ...o });
const KT = { rid: "r1", paidAt: "2026-10-06T03:00:00.000Z", paidByName: "Kế toán Lan", coAnh: true };

let thung: HTMLDivElement, goc: Root;
beforeEach(() => { thung = document.createElement("div"); document.body.appendChild(thung); goc = createRoot(thung); h.daChi = []; h.goi = 0; });
afterEach(() => { act(() => goc.unmount()); thung.remove(); document.body.innerHTML = ""; });

const cho = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });
const oPay = (row: number) => (thung.querySelector(`table.excel-table tr[data-row="${row}"] td.col-pay`) as HTMLElement | null);
const chiXem = () => expect(thung.querySelectorAll("td.col-pay button, td.col-pay input, td.col-pay select, td.col-pay a, td.col-pay img"), "cột Thanh toán phải CHỈ XEM").toHaveLength(0);

describe("ExtraTables — cột Thanh toán theo `daChi` (chỉ xem)", () => {
  const items = () => [
    { kind: "section", name: "NHÓM A", quantity: 0, unitPrice: 0 },
    hang({ rid: "r1", name: "Thuê xe" }),
    hang({ rid: "r2", name: "Cờ cũ nhưng khoản đã bỏ tích", paid: true, paidAt: "2026-09-01T00:00:00.000Z" }),
    hang({ name: "Hàng mới chưa lưu (chưa có rid)" }),
  ];
  const dung = (daChi: Map<string, typeof KT> | null, cat = "hcm") => {
    const s = { id: 1, templateId: 1, extraTables: [{ category: cat, templateId: 1, name: "B", items: items() }] as unknown as ExtraTable[], _activeExtra: 0 };
    act(() => { goc.render(<ExtraTables sheet={s} templates={MAU} companyId={1} editable canApprove onMarkDirty={() => {}} daChi={daChi} />); });
    act(() => { (thung.querySelectorAll(".khoi-sheet-nut")[cat === "hcm" ? 0 : 1] as HTMLButtonElement).click(); });
  };

  it("hàng đã chi: ngày + tên người tích + 📎; hàng chưa chi '—'; `daChi` thắng cờ cũ trên hàng; hàng nhóm không có ô", () => {
    dung(new Map([["r1", KT]]));
    expect(oPay(0)?.textContent ?? "", "hàng NHÓM có nội dung ở cột Thanh toán").toBe("");
    expect(oPay(1)!.textContent).toBe("✓ Đã TT 06/10/2026 📎Kế toán Lan");
    expect(oPay(1)!.querySelector(".pay-nguoi")?.textContent).toBe("Kế toán Lan");
    expect((oPay(1)!.querySelector(".pay-da") as HTMLElement).title).toContain("Hóa đơn đầu vào");
    expect(oPay(2)!.textContent, "cờ JSON cũ không được thắng trạng thái hiệu lực").toBe("—");
    expect(oPay(3)!.textContent).toBe("—");
    chiXem();
  });

  it("Phí khách hàng cũng có cột; lưới không sửa được vẫn hiện", () => {
    dung(new Map([["r1", { ...KT, coAnh: false, paidByName: null as unknown as string }]]), "khach");
    expect(oPay(1)!.textContent).toBe("✓ Đã TT 06/10/2026");
    chiXem();
  });
});

describe("HnTables — cột Thanh toán (chỉ xem)", () => {
  it("bảng Hà Nội hiện ngày + người tích, hàng nhóm không ô", () => {
    const t = [{ templateId: 1, name: "HN", groupSubtotal: false, items: [{ kind: "section", name: "NHÓM" }, hang({ rid: "r1", name: "Xe tải" })] }] as unknown as HnTable[];
    act(() => { goc.render(<HnTables moMacDinh tables={t} templates={MAU} companyId={1} editable={false} onMarkDirty={() => {}} daChi={new Map([["r1", KT]])} />); });
    expect(oPay(0)?.textContent ?? "").toBe("");
    expect(oPay(1)!.textContent).toBe("✓ Đã TT 06/10/2026 📎Kế toán Lan");
    chiXem();
  });
});

describe("useDaChiBaoGia — nạp theo báo giá, tươi lại theo realtime", () => {
  function Vo({ id }: { id: number }) {
    const d = useDaChiBaoGia(id);
    const t = [{ templateId: 1, name: "HN", items: [hang({ rid: "r1" }), hang({ rid: "r2" })] }] as unknown as HnTable[];
    return <HnTables moMacDinh tables={t} templates={MAU} companyId={1} editable onMarkDirty={() => {}} daChi={d?.hn} />;
  }
  const phat = (entity?: string) => act(() => { window.dispatchEvent(entity ? new CustomEvent("realtime:changed", { detail: { entity, action: "update" } }) : new Event("realtime:changed")); });
  const choGom = () => act(async () => { await new Promise((r) => setTimeout(r, 400)); });

  it("kế toán tích (sự kiện inputInvoice) → cột đổi ngay, không nạp lại báo giá; sự kiện thực thể khác không gọi", async () => {
    h.daChi = [[], []];
    await act(async () => { goc.render(<Vo id={21} />); });
    await cho();
    expect(h.goi).toBe(1);
    expect(oPay(0)!.textContent).toBe("—");
    h.daChi = [[], [KT]];
    phat("customer");
    await choGom();
    expect(h.goi, "sự kiện khách hàng không liên quan").toBe(1);
    phat("inputInvoice"); phat("inputInvoice");
    await choGom();
    expect(h.goi, "hai sự kiện liền nhau phải gom một lần gọi").toBe(2);
    expect(oPay(0)!.textContent).toBe("✓ Đã TT 06/10/2026 📎Kế toán Lan");
    expect(oPay(1)!.textContent).toBe("—");
    // SSE nối lại (sự kiện không rõ thực thể) → cũng nạp lại; kế toán bỏ tích → về "—".
    h.daChi = [[], []];
    phat();
    await choGom();
    expect(oPay(0)!.textContent).toBe("—");
  });
});

describe("Màn chỉ-xem nội bộ + Account HN dùng chung nguồn", () => {
  it("InternalQuoteView hiện thêm tên người tích, theo trạng thái hiệu lực", async () => {
    h.daChi = [[KT], []];
    h.quote = { id: 21, quoteNumber: "GN26021", companyId: 1, _internalView: true,
      internalSheets: [{ sheetId: 201, sheetName: "Trang 1", order: 1, tables: [{ category: "hcm", templateId: 1, name: "HCM", items: [hang({ rid: "r1" }), hang({ rid: "r2", paid: true })] }] }], hnTables: [] };
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => { goc.render(<QueryClientProvider client={qc}><InternalQuoteView quoteId={21} me={{ id: 1 } as never} /></QueryClientProvider>); });
    await cho();
    const [a, b] = [...thung.querySelectorAll("table.list-table tbody tr")];
    expect(a.querySelector("td.col-pay")!.textContent).toBe("✓ Đã TT · 06/10/2026 📎Kế toán Lan");
    expect(b.querySelector("td.col-pay")!.textContent).toBe("—");
  });

  it("Account HN: bảng Hà Nội có cột Thanh toán chỉ xem từ cùng endpoint", async () => {
    h.daChi = [[], [KT]];
    h.quote = { id: 11, quoteNumber: "GN26D011", title: "Giao HN", companyId: 1, hnStatus: "assigned", updatedAt: "2026-09-16T00:00:00.000Z", hnRev: "0".repeat(32),
      hnTables: [{ name: "HN", templateId: 1, groupSubtotal: true, items: [hang({ rid: "r1", name: "Xe tải" })] }] };
    await act(async () => { goc.render(<AccountHnView quoteId={11} meId={5} />); });
    await cho(); await cho();
    expect(oPay(0)?.textContent).toBe("✓ Đã TT 06/10/2026 📎Kế toán Lan");
    chiXem();
  });
});
