/** @vitest-environment jsdom */
//
// Trang HÓA ĐƠN ĐẦU VÀO (chủ repo 2026-09-30): các HÀNG bảng nội bộ ĐÃ DUYỆT, mỗi hàng là một khoản chi cần hoá
// đơn đầu vào. Máy chủ quyết định hàng nào vào và tính tiền (tests/hoa-don-dau-vao.test.js); bài này khoá phía
// trình duyệt: lọc (kết hợp tự do), số tổng khớp đúng tập đang lọc, sắp xếp, phân trang về trang 1 khi đổi lọc,
// và chỉ mời mở báo giá khi người xem MỞ ĐƯỢC báo giá (kế toán thường không có quote:read → không có ngõ cụt).
// Bố cục 10 cột (2026-10-06, vừa laptop 1280px): Mã dự án | Khách hàng | Hạng mục (+ huy hiệu loại bảng) | NS | SL |
// Đơn giá | Thành tiền | Chứng từ (+ Lưu kho) | Duyệt (ngày + người) | Kế toán. Phần ghi của cột Kế toán (hộp Khoản
// chi) khoá ở InvoicesIn.keToan.test.tsx.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { InputInvoiceRow } from "../lib/api";

const h = vi.hoisted(() => ({ resp: null as unknown, loi: null as unknown, goi: 0 }));
vi.mock("../lib/api", async (goc) => {
  const that = await goc<typeof import("../lib/api")>();
  const inputInvoices = vi.fn(async () => { h.goi++; if (h.loi) throw h.loi; return h.resp; });
  return { ...that, api: new Proxy({ inputInvoices } as Record<string, unknown>, { get: (t, k: string) => t[k] ?? vi.fn(async () => ({})) }) };
});

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { InvoicesInPage, locHang, BO_LOC_RONG } from "./InvoicesIn";
import { ApiError } from "../lib/api";

let n = 0;
const hang = (over: Partial<InputInvoiceRow> = {}): InputInvoiceRow => {
  n++;
  const r: InputInvoiceRow = {
    key: `k${n}`, quoteId: 10 + n, quoteCode: `FP_A26_0${n}`, title: `Sự kiện ${n}`, status: "converted",
    customerCode: "KH1", customerName: "Sao Mai", companyName: "GN", createdByName: "Lan",
    sheetId: 100 + n, sheetName: "Trang A", sheetCode: `FP_A26_0${n}_01`, side: "sheet", category: "hcm", tableName: "Chi phí HCM",
    rid: `r${n}`, name: `Hạng mục ${n}`, detail: null, unit: null, quantity: 1, unitPrice: 1000, days: null, amount: 1000,
    ns: null, chungTu: null, luuKho: false, approvedAt: "2026-09-20T03:00:00.000Z", approvedByName: "Admin", paid: false, paidAt: null,
    // Phần kế toán (KhoanChiDto): khoản chưa có dữ liệu.
    version: 0, paidByName: null, hasPaidProof: false, proofs: [], paidAmount: null, tienDoi: false, invoiceDate: null,
    accountingNote: null, keToanCapNhatLuc: null, keToanCapNhatBoi: null, nguon: "khong",
    trangThaiHang: "binh-thuong", coTheGhi: true, lyDoKhoa: null, ...over,
  };
  return { ...r, side: r.category === "hanoi" ? "hn" : r.side };
};

let root: Root | null = null;
let hop: HTMLDivElement;
const cho = (ms = 20) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const ME_KE_TOAN = { id: 1, username: "kt", displayName: "KT", role: "accountant", permissions: ["invoice:page"] };
const ME_MO_DUOC = { ...ME_KE_TOAN, permissions: ["invoice:page", "quote:read:all"] };

async function mo(rows: InputInvoiceRow[], { me = ME_KE_TOAN, truncated = false }: { me?: typeof ME_KE_TOAN; truncated?: boolean } = {}) {
  h.resp = { data: rows, meta: { quotes: rows.length, truncated } };
  hop = document.createElement("div"); document.body.appendChild(hop);
  root = createRoot(hop);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => { root!.render(<QueryClientProvider client={qc}><InvoicesInPage me={me} /></QueryClientProvider>); });
  await cho();
}
beforeEach(() => { n = 0; h.loi = null; h.goi = 0; });
afterEach(() => { if (root) act(() => root!.unmount()); root = null; document.body.innerHTML = ""; location.hash = ""; });

const dong = () => [...hop.querySelectorAll("tbody tr")] as HTMLElement[];
const ten = () => dong().map((r) => r.querySelectorAll("td")[2].querySelector("div")!.textContent);
const stat = (nhan: string) => [...hop.querySelectorAll(".stat-card")].find((s) => s.querySelector(".stat-label")!.textContent === nhan)!.querySelector(".stat-value")!.textContent;
function go(el: HTMLInputElement | HTMLSelectElement, v: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")!.set!;
  act(() => { setter.call(el, v); el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true })); });
}
const chon = (nhan: string) => hop.querySelector(`select[aria-label="${nhan}"]`) as HTMLSelectElement;

describe("locHang (thuần)", () => {
  const ds = [
    hang({ category: "hcm", chungTu: "VAT", paid: true, name: "Thuê xe nâng", ns: "Công ty Đại Phát" }),
    hang({ category: "khach", chungTu: "TM", name: "Phí ship" }),
    hang({ category: "hanoi", chungTu: null, status: "draft", name: "Thuê sàn", approvedAt: "2026-08-01T03:00:00.000Z" }),
    hang({ category: "hcm", chungTu: "HDNS", status: "lost", name: "Nhân công", approvedAt: null }),
  ];
  const ten = (b: Partial<typeof BO_LOC_RONG>) => locHang(ds, { ...BO_LOC_RONG, ...b }).map((r) => r.name);

  it("không lọc → đủ; từng nhóm lọc đúng", () => {
    expect(ten({})).toHaveLength(4);
    expect(ten({ loai: "hcm" })).toEqual(["Thuê xe nâng", "Nhân công"]);
    expect(ten({ chungTu: "VAT" })).toEqual(["Thuê xe nâng"]);
    expect(ten({ chungTu: "none" }), "chưa chọn chứng từ").toEqual(["Thuê sàn"]);
    expect(ten({ thanhToan: "paid" })).toEqual(["Thuê xe nâng"]);
    expect(ten({ thanhToan: "unpaid" })).toHaveLength(3);
    expect(ten({ trangThai: "draft" })).toEqual(["Thuê sàn"]);
    expect(ten({ trangThai: "converted" })).toEqual(["Thuê xe nâng", "Phí ship"]);
    expect(ten({ trangThai: "other" }), "trạng thái ngoài đã chốt/nháp/không chốt").toEqual([]);
  });

  it("các nhóm KẾT HỢP tự do (AND)", () => {
    expect(ten({ loai: "hcm", thanhToan: "unpaid" })).toEqual(["Nhân công"]);
    expect(ten({ loai: "hcm", chungTu: "VAT", thanhToan: "paid" })).toEqual(["Thuê xe nâng"]);
    expect(ten({ loai: "khach", chungTu: "VAT" })).toEqual([]);
  });

  it("khoảng NGÀY DUYỆT: biên gồm cả hai đầu; hàng không có ngày duyệt không nằm trong khoảng đã chọn", () => {
    expect(ten({ tu: "2026-09-20", den: "2026-09-20" })).toEqual(["Thuê xe nâng", "Phí ship"]);
    expect(ten({ tu: "2026-08-01", den: "2026-08-31" })).toEqual(["Thuê sàn"]);
    expect(ten({ tu: "2026-01-01" }), "Nhân công không có ngày duyệt").not.toContain("Nhân công");
    expect(ten({ den: "2026-12-31" })).not.toContain("Nhân công");
  });

  it("tìm KHÔNG DẤU, nhiều từ không cần đúng thứ tự, trên cả NS / số tiền / người duyệt / trạng thái thanh toán", () => {
    expect(ten({ q: "thue xe" })).toEqual(["Thuê xe nâng"]);
    expect(ten({ q: "dai phat" })).toEqual(["Thuê xe nâng"]);       // NS
    expect(ten({ q: "san thue" })).toEqual(["Thuê sàn"]);           // đảo thứ tự
    expect(ten({ q: "admin" })).toHaveLength(4);                    // người duyệt
    // Tìm theo TỪ (từng từ khớp bất kỳ đâu, bỏ dấu) nên "da" còn khớp "Đại"/"Đã chốt" — đó là cách tìm chung của
    // cả app (smartTextMatch), không phải lỗi. Khẳng định đúng chiều có ích: hàng đã trả khớp "đã thanh toán", và
    // "chưa thanh toán" loại ĐÚNG hàng đã trả (nó không chứa từ "chưa").
    expect(ten({ q: "da thanh toan" })).toContain("Thuê xe nâng");
    expect(ten({ q: "chua thanh toan" })).toHaveLength(3);
    expect(ten({ q: "chua thanh toan" })).not.toContain("Thuê xe nâng");
    expect(ten({ q: "ha noi" }), "tên loại bảng").toEqual(["Thuê sàn"]);
    expect(ten({ q: "khong co gi ca" })).toEqual([]);
  });
});

describe("Trang Hóa đơn đầu vào", () => {
  it("hiện từng khoản: tiêu đề + số liệu đúng tập dữ liệu; mã dự án theo SHEET, loại bảng, chứng từ, người duyệt", async () => {
    await mo([hang({ name: "Thuê xe", quantity: 2, unitPrice: 500000, amount: 1000000, chungTu: "VAT", luuKho: true, ns: "Cty Xe", paid: true, paidAt: "2026-09-22T00:00:00.000Z", approvedByName: "Admin" })]);
    expect(hop.querySelector("h1")!.textContent).toBe("Hóa đơn đầu vào");
    expect([...hop.querySelectorAll("thead th")].map((t) => t.textContent), "10 cột vừa laptop 1280px")
      .toEqual(["Mã dự án", "Khách hàng", "Hạng mục", "NS", "SL", "Đơn giá", "Thành tiền", "Chứng từ", "Duyệt", "Kế toán"]);
    const o = dong()[0].querySelectorAll("td");
    expect(o).toHaveLength(10);
    expect(o[0].textContent).toContain("FP_A26_01_01");
    expect(o[2].querySelector("div")!.textContent).toBe("Thuê xe");
    // Loại bảng thành HUY HIỆU ở dòng phụ của Hạng mục; tên bảng trùng tên mặc định ("Chi phí HCM") không lặp lại.
    expect(o[2].querySelector(".extra-cat-badge")!.textContent).toBe("Chi phí HCM");
    expect(o[2].textContent!.match(/Chi phí HCM/g), "tên bảng mặc định không in hai lần").toHaveLength(1);
    expect(o[3].textContent).toBe("Cty Xe");
    expect(o[6].textContent).toBe("1.000.000");
    expect(o[7].querySelector(".status")!.textContent).toBe("VAT");
    expect(o[7].textContent, "Lưu kho thành dòng phụ của Chứng từ").toContain("Lưu kho");
    expect(o[8].textContent).toBe("20/09/2026Admin");   // ngày + người duyệt chung một cột
    expect(o[9].textContent).toContain("✓ Đã chi · 22/09/2026");
  });

  it("tên bảng KHÁC tên mặc định và chi tiết hiện ở dòng phụ của Hạng mục; không có Lưu kho thì không có dòng phụ đó", async () => {
    await mo([hang({ name: "Thuê sàn", tableName: "Sân khấu chính", detail: "6x4m", category: "khach", luuKho: false, chungTu: null })]);
    const o = dong()[0].querySelectorAll("td");
    expect(o[2].querySelector(".extra-cat-badge")!.textContent).toBe("Phí khách hàng");
    expect(o[2].textContent).toContain("Sân khấu chính · 6x4m");
    expect(o[7].textContent).not.toContain("Lưu kho");
  });

  it("số tổng tính trên TẬP ĐANG LỌC: tổng, đã thanh toán, chưa thanh toán, có VAT, số khoản", async () => {
    await mo([
      hang({ amount: 1000000, paid: true, chungTu: "VAT" }),
      hang({ amount: 500000, paid: false, chungTu: "VAT" }),
      hang({ amount: 250000, paid: false, chungTu: "TM", category: "khach" }),
    ]);
    expect(stat("Tổng tiền đã duyệt")).toBe("1.750.000");
    expect(stat("Đã thanh toán")).toBe("1.000.000");
    expect(stat("Chưa thanh toán")).toBe("750.000");
    expect(stat("Có chứng từ VAT")).toBe("1.500.000");
    expect(stat("Số khoản")).toBe("3");
    go(chon("Lọc theo loại bảng"), "khach");
    expect(stat("Tổng tiền đã duyệt")).toBe("250.000");
    expect(stat("Số khoản")).toBe("1");
    expect(stat("Có chứng từ VAT")).toBe("0");
  });

  it("thẻ thống kê bấm được để lọc (Đã TT / Chưa TT / VAT), bấm lại thì bỏ lọc", async () => {
    await mo([hang({ name: "A", paid: true }), hang({ name: "B", paid: false, chungTu: "VAT" })]);
    const the = (nhan: string) => [...hop.querySelectorAll("button.stat-card")].find((s) => s.querySelector(".stat-label")!.textContent === nhan) as HTMLButtonElement;
    await act(async () => { the("Đã thanh toán").click(); });
    expect(ten()).toEqual(["A"]);
    await act(async () => { the("Đã thanh toán").click(); });
    expect(ten()).toEqual(["A", "B"]);
    await act(async () => { the("Có chứng từ VAT").click(); });
    expect(ten()).toEqual(["B"]);
  });

  it("sắp xếp theo Thành tiền: lần 1 tăng, lần 2 giảm; ngày duyệt trống luôn xuống cuối", async () => {
    await mo([hang({ name: "B", amount: 500 }), hang({ name: "A", amount: 100 }), hang({ name: "C", amount: 900 })]);
    const th = [...hop.querySelectorAll("th.sortable")].find((t) => t.textContent!.startsWith("Thành tiền")) as HTMLElement;
    await act(async () => { th.click(); });
    expect(ten()).toEqual(["A", "B", "C"]);
    await act(async () => { th.click(); });
    expect(ten()).toEqual(["C", "B", "A"]);
    expect(th.getAttribute("aria-sort")).toBe("descending");
    // "Duyệt" (ngày + người duyệt chung cột) vẫn sắp theo NGÀY duyệt.
    const ngay = [...hop.querySelectorAll("th.sortable")].find((t) => t.textContent!.startsWith("Duyệt")) as HTMLElement;
    await act(async () => { ngay.click(); });
    expect(ngay.getAttribute("aria-sort")).toBe("ascending");
  });

  it("kế toán KHÔNG có quote:read → dòng không phải ngõ cụt: không bấm mở báo giá được, hash giữ nguyên", async () => {
    await mo([hang({ quoteId: 77 })]);
    expect(dong()[0].className).not.toContain("qrow");
    await act(async () => { dong()[0].click(); });
    expect(location.hash).toBe("");
  });

  it("người đọc được báo giá → bấm dòng mở báo giá; nhưng bấm vào nút/ô nhập trong dòng thì không", async () => {
    await mo([hang({ quoteId: 77 })], { me: { ...ME_MO_DUOC, permissions: [...ME_MO_DUOC.permissions, "invoice:edit"] } });
    expect(dong()[0].className).toContain("qrow");
    // Bấm nút ở cột Kế toán (và mọi phần tử bên trong nó): mở hộp Khoản chi, KHÔNG nhảy sang báo giá.
    const nut = dong()[0].querySelector("button[data-ke-toan]") as HTMLButtonElement;
    expect(nut, "người có invoice:edit thấy nút ở cột Kế toán").not.toBeNull();
    await act(async () => { (nut.querySelector("span") as HTMLElement).click(); });
    expect(location.hash).toBe("");
    expect(hop.querySelector('[role="dialog"]'), "hộp Khoản chi đã mở").not.toBeNull();
    await act(async () => { (hop.querySelector('[role="dialog"] .x') as HTMLButtonElement).click(); });
    expect(hop.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => { dong()[0].click(); });
    expect(location.hash).toBe("#/quotes/77");
  });

  it("phân trang 100 dòng/trang; đổi bộ lọc → về trang 1", async () => {
    await mo(Array.from({ length: 230 }, (_, i) => hang({ name: `H${i}`, category: i % 2 ? "hcm" : "khach" })));
    expect(dong()).toHaveLength(100);
    expect(hop.querySelector(".pager .muted")!.textContent).toBe("Trang 1/3");
    const sau = () => [...hop.querySelectorAll(".pager button")].find((b) => b.textContent!.includes("Sau")) as HTMLButtonElement;
    await act(async () => { sau().click(); });
    await act(async () => { sau().click(); });
    expect(hop.querySelector(".pager .muted")!.textContent).toBe("Trang 3/3");
    expect(dong()).toHaveLength(30);
    go(chon("Lọc theo loại bảng"), "hcm");   // 115 dòng → 2 trang
    await cho();
    expect(hop.querySelector(".pager .muted")!.textContent).toBe("Trang 1/2");
    expect(dong()).toHaveLength(100);
    expect(hop.querySelector(".list-foot .muted")!.textContent).toContain("1–100 / 115");
  });

  it("trạng thái rỗng: chưa có hàng nào duyệt / bộ lọc không khớp (kèm nút xoá lọc)", async () => {
    await mo([]);
    expect(hop.querySelector(".empty")!.textContent).toContain("Chưa có hàng nào được duyệt");
    act(() => root!.unmount()); root = null; hop.remove();
    await mo([hang({ name: "A" })]);
    go(hop.querySelector('input[aria-label="Tìm hóa đơn đầu vào"]') as HTMLInputElement, "khong co");
    expect(hop.querySelector(".empty")!.textContent).toContain("Không có khoản nào khớp bộ lọc");
    await act(async () => { (hop.querySelector(".empty button") as HTMLButtonElement).click(); });
    expect(ten()).toEqual(["A"]);
  });

  it("máy chủ chạm trần số báo giá → hiện cảnh báo, không cắt thầm", async () => {
    await mo([hang()], { truncated: true });
    expect(hop.querySelector(".inv-in-warn")!.textContent).toContain("chạm trần");
    act(() => root!.unmount()); root = null; hop.remove();
    await mo([hang()], { truncated: false });
    expect(hop.querySelector(".inv-in-warn")).toBeNull();
  });

  it("lỗi tải: hiện banner lỗi có nút Thử lại, KHÔNG hiện số thống kê 0 gây hiểu nhầm; thử lại nạp lần nữa", async () => {
    h.loi = new ApiError("Bạn không có quyền xem trang Hóa đơn đầu vào", 403, null);
    hop = document.createElement("div"); document.body.appendChild(hop);
    root = createRoot(hop);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => { root!.render(<QueryClientProvider client={qc}><InvoicesInPage me={ME_KE_TOAN} /></QueryClientProvider>); });
    await cho();
    expect(hop.querySelector(".err")!.textContent).toContain("Bạn không có quyền");
    expect(hop.querySelector(".stat-row")).toBeNull();
    const truoc = h.goi;
    await act(async () => { (hop.querySelector(".err button") as HTMLButtonElement).click(); });
    await cho();
    expect(h.goi).toBeGreaterThan(truoc);
  });
});
