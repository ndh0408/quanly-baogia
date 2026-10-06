/** @vitest-environment jsdom */
// Màn kế toán chỉ-xem (quyền quote:internal:view): ba cột NS · CHỨNG TỪ · LƯU KHO của bảng nội bộ
// (4e24308) đã về tới trình duyệt — presentQuoteForInternal chỉ lược ảnh chứng từ — nhưng bảng ở đây
// chỉ vẽ Hạng mục / SL / Đơn giá / Thành tiền / Thanh toán. Kế toán, người đối chiếu chứng từ VAT /
// HĐNS / TM và hàng lưu kho, lại là người duy nhất KHÔNG nhìn thấy chúng.
//
// Luật đã chốt: hiện CHỈ ĐỌC, cùng thứ tự / nhãn như lưới soạn, hàng nhóm không có ô.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({ quote: null as unknown }));
vi.mock("../lib/venueCatalog", async (goc) => ({ ...(await goc<typeof import("../lib/venueCatalog")>()), loadCatalog: () => Promise.resolve({ entries: [], venues: [] }) }));
vi.mock("../lib/api", async (goc) => {
  const that = await goc<typeof import("../lib/api")>();
  return { ...that, api: { ...that.api, getQuote: vi.fn(async () => h.quote), metaTemplates: vi.fn(async () => [{ id: 1, code: "gn", name: "GN", companyId: 1, layout: { hasDays: false } }]) } };
});
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { InternalQuoteView } from "./InternalQuoteView";

let thung: HTMLDivElement, goc: Root;
beforeEach(() => { thung = document.createElement("div"); document.body.appendChild(thung); goc = createRoot(thung); });
afterEach(() => { act(() => goc.unmount()); thung.remove(); document.body.innerHTML = ""; });

const hang = (o: Record<string, unknown>) => ({ kind: "item", unit: "cái", quantity: 1, unitPrice: 1000, ...o });

async function mo(quyen = ["quote:internal:view"], sua: (q: Record<string, unknown>) => void = () => {}) {
  const q: Record<string, unknown> = {
    id: 21, quoteNumber: "GN26021", companyId: 1, _internalView: true,
    internalSheets: [{
      sheetId: 201, sheetName: "Trang 1", order: 1,
      tables: [{
        category: "hcm", templateId: 1, name: "HCM", items: [
          { kind: "section", name: "NHÓM A", ns: "không được hiện", chungTu: "VAT", luuKho: true },
          hang({ rid: "e1", name: "Backdrop", ns: "Anh Tuấn\nứng trước", chungTu: "HDNS", luuKho: true }),
          hang({ rid: "e2", name: "Standee", ns: null, chungTu: null, luuKho: false }),
        ],
      }],
    }],
    hnTables: [{ templateId: 1, name: "HN", items: [hang({ rid: "h1", name: "Xe tải", ns: "Chị Lan", chungTu: "TM", luuKho: false })] }],
  };
  sua(q);
  h.quote = q;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const me = { id: 3, username: "kt", displayName: "KT", role: "employee", permissions: quyen };
  await act(async () => { goc.render(<QueryClientProvider client={qc}><InternalQuoteView quoteId={21} me={me as never} /></QueryClientProvider>); });
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
}
const bang = (i: number) => thung.querySelectorAll("table.list-table")[i] as HTMLTableElement;
const tieuDe = (i: number) => [...bang(i).querySelectorAll("thead th")].map((th) => (th.textContent || "").trim());
const o = (tr: Element, lop: string) => (tr.querySelector(`td.${lop}`)?.textContent || "").trim();

describe("InternalQuoteView — ba cột NS · CHỨNG TỪ · LƯU KHO (chỉ đọc)", () => {
  it("tiêu đề cùng thứ tự / nhãn như lưới soạn: sau Thành tiền, trước Thanh toán", async () => {
    await mo();
    for (const i of [0, 1]) {
      expect(tieuDe(i), `bảng ${i}`).toEqual(["Hạng mục", "SL", "Đơn giá", "Thành tiền", "NS", "CHỨNG TỪ", "LƯU KHO", "Thanh toán"]);
    }
  });

  it("vẽ đúng giá trị từng hàng (HĐNS hiện có dấu, NS nhiều dòng giữ xuống dòng); bảng Hà Nội cũng có", async () => {
    await mo();
    const [bd, st] = [...bang(0).querySelectorAll("tbody tr")];
    expect(bd.querySelector("td.col-ns")?.textContent).toBe("Anh Tuấn\nứng trước");
    expect(o(bd, "col-chung-tu")).toBe("HĐNS");
    expect(o(bd, "col-luu-kho")).toBe("✓");
    // Giá trị mặc định (null / false) là "không có" — không phải chữ "null" hay ô tích trống lạ mắt.
    expect([o(st, "col-ns"), o(st, "col-chung-tu"), o(st, "col-luu-kho")]).toEqual(["—", "—", "—"]);
    const [xe] = [...bang(1).querySelectorAll("tbody tr")];
    expect([o(xe, "col-ns"), o(xe, "col-chung-tu"), o(xe, "col-luu-kho")]).toEqual(["Chị Lan", "TM", "—"]);
  });

  it("hàng nhóm không có ô; màn CHỈ ĐỌC — không một ô nhập / chọn / tích / nút nào, kể cả khi có quyền cũ quote:internal:pay", async () => {
    await mo(["quote:internal:view", "quote:internal:pay"]);
    const hangs = [...bang(0).querySelectorAll("tbody tr")];
    expect(hangs, "hàng nhóm lọt vào bảng").toHaveLength(2);
    expect(thung.textContent).not.toContain("không được hiện");
    expect(thung.querySelectorAll("table input, table select, table textarea")).toHaveLength(0);
    // 2026-10-06: tích ĐÃ CHI + ảnh chứng từ rời màn này sang trang Hóa đơn đầu vào (kế toán, invoice:input:pay).
    // quote:internal:pay không còn mở nút "Thanh toán" nào — kể cả ở bảng Hà Nội.
    expect(thung.querySelectorAll("table button, table a"), "còn nút thanh toán trong bảng").toHaveLength(0);
    // Mỗi hàng đủ 8 ô, dòng Tổng cũng phủ đủ 8 cột (không lệch cột Thanh toán sang dưới LƯU KHO).
    for (const tr of hangs) expect(tr.querySelectorAll("td")).toHaveLength(8);
    const tong = [...bang(0).querySelectorAll("tfoot td")].reduce((n, td) => n + ((td as HTMLTableCellElement).colSpan || 1), 0);
    expect(tong).toBe(8);
  });

  it("cột Thanh toán chỉ là CHỮ từ lớp phủ khoản kế toán: '✓ Đã TT · ngày' + 📎; không mở được ảnh, câu chữ trỏ sang trang Hóa đơn đầu vào", async () => {
    await mo(["quote:internal:view", "quote:internal:pay"], (q) => {
      const s = (q.internalSheets as { tables: { items: Record<string, unknown>[] }[] }[])[0];
      Object.assign(s.tables[0].items[1], { paid: true, paidAt: "2026-10-01T03:00:00.000Z", paidById: 7, hasPaidProof: true });
      Object.assign((q.hnTables as { items: Record<string, unknown>[] }[])[0].items[0], { paid: true, paidAt: "2026-10-02T03:00:00.000Z" });
    });
    const [bd, st] = [...bang(0).querySelectorAll("tbody tr")];
    expect(o(bd, "col-pay")).toBe("✓ Đã TT · 01/10/2026 📎");
    expect(o(st, "col-pay")).toBe("—");
    const [xe] = [...bang(1).querySelectorAll("tbody tr")];
    expect(o(xe, "col-pay"), "hàng HN đã chi nhưng chưa có ảnh: không có 📎").toBe("✓ Đã TT · 02/10/2026");
    // Không nút, không đường dẫn, không ảnh: xem ảnh ủy nhiệm chi chỉ còn ở trang Hóa đơn đầu vào (invoice:input:pay).
    expect(thung.querySelectorAll("td.col-pay button, td.col-pay a, td.col-pay img, [role=dialog]")).toHaveLength(0);
    expect(thung.textContent).toMatch(/Hóa đơn đầu vào/);
    expect(thung.textContent).not.toMatch(/đánh dấu thanh toán từng hàng/);
  });

  it("bảng rỗng: ô \"(không có hàng)\" phủ đủ cả tám cột", async () => {
    await mo(undefined, (q) => { q.hnTables = [{ templateId: 1, name: "HN", items: [] }]; });
    expect(bang(1).querySelector("tbody td")?.getAttribute("colspan")).toBe("8");
  });

  it("điện thoại: bảng nằm trong khung cuộn ngang .list-wrap (thêm ba cột không bóp méo cột tiền)", async () => {
    await mo();
    expect(bang(0).parentElement?.classList.contains("list-wrap")).toBe(true);
  });
});
