/** @vitest-environment jsdom */
//
// BỘ LỌC + SẮP XẾP MỌI CỘT của Danh sách báo giá (chủ repo 2026-09-30, chỉ vào tiêu đề "NGÀY ▼": "bộ lọc cũng chưa đầy đủ … và bộ
// lọc trên kia cũng chưa đầy đủ và thông minh"). Bài này kiểm phần NỐI giữa trang và bộ lọc — đúng tên khoá gửi máy chủ, URL hai
// chiều, số đếm, mỗi cột bấm được để sắp xếp — và ranh giới VIEW LƯỢC: account HN / tài khoản chi phí chỉ có ô tìm + trạng thái +
// ngày, không số đếm (máy chủ 403), chỉ sắp theo các cột cũ, và tham số người tạo/tiền/ghi chú trên URL bị bỏ chứ không áp ngầm.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

type Tham = Record<string, unknown>;
const h = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  goi: [] as Tham[],
  dem: [] as Tham[],
  listQuotes: null as unknown as ReturnType<typeof vi.fn>,
  quoteFacets: null as unknown as ReturnType<typeof vi.fn>,
  setQuoteListNote: null as unknown as ReturnType<typeof vi.fn>,
}));
const FACETS = {
  total: 3, mine: 2,
  status: [{ value: "draft", count: 2 }, { value: "converted", count: 1 }],
  creators: [{ id: 1, name: "A", count: 2 }, { id: 9, name: "Bình", count: 1 }],
  companies: [{ id: 1, name: "GN", count: 2 }, { id: 2, name: "CLF", count: 1 }],
  note: { has: 1, none: 2, colors: { red: 1, orange: 0, green: 0, blue: 0, purple: 0 } },
};
vi.mock("../lib/api", async (goc) => {
  const that = await goc<typeof import("../lib/api")>();
  h.listQuotes = vi.fn(async (p: Tham) => { h.goi.push({ ...p }); return { data: JSON.parse(JSON.stringify(h.rows)), meta: { total: h.rows.length, page: 1, size: 20, pageCount: 1 } }; });
  h.quoteFacets = vi.fn(async (p: Tham) => { h.dem.push({ ...p }); return FACETS; });
  h.setQuoteListNote = vi.fn(async (id: number, p: { note?: string; color?: string | null }) => ({ quoteId: id, note: p.note ?? "", color: p.color ?? null, updatedByName: "A", updatedAt: "2026-09-30T03:00:00.000Z" }));
  return { ...that, api: new Proxy({ listQuotes: h.listQuotes, quoteFacets: h.quoteFacets, setQuoteListNote: h.setQuoteListNote } as Record<string, unknown>, { get: (t, k: string) => t[k] ?? vi.fn(async () => ({})) }) };
});

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { QuoteListPage } from "./QuoteList";
import { khoangNgay } from "../lib/locDanhSach";

const QUYEN_DAY_DU = ["quote:read:own", "quote:update:own", "quote:create"];
const QUYEN_ADMIN = ["quote:read:all", "quote:update:all", "quote:create"];
const QUYEN_HN = ["quote:read:own", "quote:hn:fill"];
const QUYEN_CHI_PHI = ["quote:read:own", "quote:internal:view"];
const me = (permissions: string[]) => ({ id: 1, username: "a", displayName: "A", role: "manager", permissions });
const dong = (id: number, over: Record<string, unknown> = {}) => ({ id, quoteNumber: `GN${id}`, projectCode: `FP_A26_00${id}`, title: `Báo giá ${id}`, status: "draft", createdById: 1, sheetCount: 1, total: 1000 * id, quoteDate: "2026-09-20", toCompany: `Khách ${id}`, customerCode: `KH${id}`, ...over });

let root: Root | null = null;
let hop: HTMLDivElement;
const cho = (ms = 20) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

beforeEach(() => {
  h.rows = [dong(1, { listNote: null }), dong(2, { status: "converted", listNote: { note: "Gọi lại", color: "red" } })];
  h.goi.length = 0; h.dem.length = 0;
  h.listQuotes.mockClear(); h.quoteFacets.mockClear(); h.setQuoteListNote.mockClear();
  h.quoteFacets.mockImplementation(async (p: Tham) => { h.dem.push({ ...p }); return FACETS; });
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
});
afterEach(() => { if (root) act(() => root!.unmount()); root = null; document.body.innerHTML = ""; location.hash = ""; });

async function mo(permissions = QUYEN_DAY_DU, hash = "#/list") {
  location.hash = hash;
  hop = document.createElement("div"); document.body.appendChild(hop);
  root = createRoot(hop);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => { root!.render(<QueryClientProvider client={qc}><QuoteListPage me={me(permissions)} /></QueryClientProvider>); });
  await cho();
}
const cuoi = () => h.goi[h.goi.length - 1];
const demCuoi = () => h.dem[h.dem.length - 1];
const urlHienTai = () => new URLSearchParams(location.hash.split("?")[1] || "");
const chipTT = (nhan: string) => [...hop.querySelectorAll('[aria-label="Trạng thái báo giá"] button')].find((b) => b.textContent?.startsWith(nhan)) as HTMLButtonElement;
const nutChu = (nhan: string) => [...hop.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.startsWith(nhan))!;
const bam = async (el: Element) => { await act(async () => { (el as HTMLElement).click(); }); await cho(); };
/** Nút "Xong" của bảng nổi (portal ở document.body — không nằm trong `hop`). */
const xong = () => [...document.querySelectorAll<HTMLButtonElement>(".cn-chan button")].find((b) => b.textContent === "Xong")!;
const tieuDe = () => [...hop.querySelectorAll("thead th")] as HTMLElement[];
const thCot = (ten: string) => tieuDe().find((t) => (t.textContent || "").replace(/\s[▲▼]$/, "") === ten)!;
function go(el: HTMLInputElement | HTMLSelectElement, v: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")!.set!;
  act(() => { setter.call(el, v); el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true })); });
}

describe("Danh sách báo giá — bộ lọc đầy đủ (view đầy đủ)", () => {
  it("có ô tìm THÔNG MINH + bảng lọc; KHÔNG còn ô chọn trạng thái kiểu cũ; ô tìm nói rõ tìm được những gì", async () => {
    await mo();
    const tim = hop.querySelector('input[aria-label="Tìm báo giá"]') as HTMLInputElement;
    expect(tim.placeholder).toContain("người tạo");
    expect(tim.placeholder).toContain("ghi chú");
    expect(tim.title).toContain("không cần dấu");
    expect(hop.querySelector(".bl-panel")).toBeTruthy();
    expect(hop.querySelector('select[aria-label="Lọc theo trạng thái"]')).toBeNull();
    expect(hop.querySelector('[aria-label="Trạng thái báo giá"]')).toBeTruthy();
  });

  it("số đếm trên chip lấy từ /quotes/facets; yêu cầu đếm KHÔNG mang sort/order/page/size", async () => {
    await mo();
    expect(chipTT("Nháp").textContent).toBe("Nháp2");
    expect(chipTT("Đã chốt").textContent).toBe("Đã chốt1");
    expect(nutChu("Của tôi").textContent).toBe("Của tôi2");
    expect(h.quoteFacets).toHaveBeenCalled();
    for (const k of ["sort", "order", "page", "size"]) expect(Object.keys(demCuoi()), `facets không được mang ${k}`).not.toContain(k);
  });

  it("mỗi bộ lọc gửi ĐÚNG tên khoá máy chủ; nhiều bộ lọc CÙNG lúc; facets nhận cùng bộ lọc", async () => {
    await mo();
    await bam(chipTT("Nháp"));
    await bam(chipTT("Đã chốt"));
    expect(cuoi().status).toBe("draft,converted");
    expect(location.hash, "dấu phẩy giữa các giá trị để nguyên trên URL (không %2C) — link dán cho nhau đọc được").toBe("#/list?status=draft,converted");
    // Người tạo
    await bam(nutChu("Người tạo"));
    await act(async () => { (document.querySelectorAll<HTMLInputElement>(".bang-noi label.cn-dong input")[1]).click(); });   // "Bình" (#9)
    await bam(xong());
    // Công ty
    await bam(nutChu("Công ty"));
    await act(async () => { (document.querySelectorAll<HTMLInputElement>(".bang-noi label.cn-dong input")[0]).click(); });   // GN (#1)
    await act(async () => { (document.querySelectorAll<HTMLInputElement>(".bang-noi label.cn-dong input")[1]).click(); });   // CLF (#2)
    await bam(xong());
    // Ngày + tiền + ghi chú màu
    go(hop.querySelector('select[aria-label="Mẫu ngày báo giá"]') as HTMLSelectElement, "namnay");
    const tien = hop.querySelector('input[aria-label="Tổng từ"]') as HTMLInputElement;
    go(tien, "100tr");
    await act(async () => { tien.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); });
    await bam(hop.querySelector('button.bl-mau[aria-label^="Màu Đỏ"]')!);
    await cho();
    const nam = khoangNgay("namnay");
    expect(cuoi()).toMatchObject({ status: "draft,converted", creator: "9", companyId: "1,2", from: nam.tu, to: nam.den, minTotal: "100000000", noteColor: "red", sort: "createdAt", order: "desc", page: 1, size: 20 });
    expect(Object.keys(cuoi())).not.toContain("q");   // không gõ gì → không gửi q rỗng
    expect(demCuoi()).toMatchObject({ status: "draft,converted", creator: "9", companyId: "1,2", minTotal: "100000000", noteColor: "red" });
  });

  it("'Của tôi' gửi người tạo = id của chính mình", async () => {
    await mo();
    await bam(nutChu("Của tôi"));
    expect(cuoi().creator).toBe("1");
  });

  it("URL hai chiều: bộ lọc được GHI lên URL, và mở link có sẵn thì dựng lại đủ bộ lọc + gửi đúng ngay lượt đầu", async () => {
    await mo();
    await bam(chipTT("Đã chốt"));
    expect(urlHienTai().get("status")).toBe("converted");
    await bam(nutChu("Có ghi chú"));
    expect(urlHienTai().get("note")).toBe("has");
    await bam(nutChu("Xóa tất cả"));
    expect(location.hash, "xoá hết thì URL sạch").toBe("#/list");
    act(() => root!.unmount()); root = null; hop.remove(); document.body.innerHTML = ""; h.goi.length = 0;

    await mo(QUYEN_DAY_DU, "#/list?status=draft,converted&company=2&creator=9&from=2026-09-01&to=2026-09-30&min=100&max=200&note=has&color=red&sort=total&order=asc");
    expect(h.goi[0]).toMatchObject({ status: "draft,converted", companyId: "2", creator: "9", from: "2026-09-01", to: "2026-09-30", minTotal: "100", maxTotal: "200", note: "has", noteColor: "red", sort: "total", order: "asc" });
    expect(h.goi, "đúng MỘT lượt nạp đầu, không nhảy qua bộ lọc rỗng rồi mới tới bộ lọc của link").toHaveLength(1);
    expect(chipTT("Nháp").getAttribute("aria-pressed")).toBe("true");
    expect(chipTT("Không chốt").getAttribute("aria-pressed")).toBe("false");
    expect(nutChu("Có ghi chú").getAttribute("aria-pressed")).toBe("true");
    expect(hop.querySelector('button.bl-mau[aria-label^="Màu Đỏ"]')!.getAttribute("aria-pressed")).toBe("true");
    expect((hop.querySelector('input[aria-label="Tổng đến"]') as HTMLInputElement).value).toBe("200");
    expect(nutChu("Xóa tất cả").querySelector(".inv-filter-count")!.textContent, "trạng thái + công ty + người tạo + ngày + tiền + ghi chú/màu").toBe("6");
  });

  it("link có giá trị RÁC (màu lạ, ngày sai, số âm) → bỏ phần rác, trang vẫn mở bình thường", async () => {
    await mo(QUYEN_DAY_DU, "#/list?color=hotpink&from=hom-qua&min=-5&note=maybe&company=x&sort=password");
    expect(h.goi[0]).toMatchObject({ sort: "createdAt" });
    for (const k of ["noteColor", "from", "minTotal", "note", "companyId"]) expect(Object.keys(h.goi[0]), k).not.toContain(k);
    expect(hop.querySelectorAll("tbody tr.qrow")).toHaveLength(2);
  });

  it("gõ tìm: sau debounce gửi q; đổi bộ lọc khác KHÔNG bị debounce (áp ngay)", async () => {
    await mo();
    go(hop.querySelector('input[aria-label="Tìm báo giá"]') as HTMLInputElement, "sao mai hcm");
    await cho(400);
    expect(cuoi().q).toBe("sao mai hcm");
    expect(urlHienTai().get("q")).toBe("sao mai hcm");
    h.goi.length = 0;
    await bam(chipTT("Nháp"));
    expect(cuoi()).toMatchObject({ q: "sao mai hcm", status: "draft" });
  });

  it("KHÔNG có kết quả: báo rõ + nút 'Xóa tất cả bộ lọc' đưa danh sách về; không lọc mà rỗng thì mời tạo báo giá", async () => {
    h.rows = [];
    await mo(QUYEN_DAY_DU, "#/list?status=lost");
    expect(hop.querySelector(".empty")!.textContent).toContain("Không tìm thấy báo giá phù hợp.");
    h.rows = [dong(1)];
    await bam(nutChu("Xóa tất cả bộ lọc"));
    expect(hop.querySelectorAll("tbody tr.qrow")).toHaveLength(1);
    expect(location.hash).toBe("#/list");
    act(() => root!.unmount()); root = null; hop.remove(); document.body.innerHTML = "";
    h.rows = [];
    await mo();
    expect(hop.querySelector(".empty")!.textContent).toContain("Chưa có báo giá nào.");
    expect(hop.querySelector(".empty")!.textContent).toContain("+ Tạo báo giá");
    expect(hop.querySelector(".empty")!.textContent).not.toContain("Xóa tất cả bộ lọc");
  });

  it("/quotes/facets LỖI (máy chủ bản cũ, mạng) → danh sách vẫn chạy, chip chỉ thiếu số, không báo lỗi đỏ", async () => {
    h.quoteFacets.mockImplementation(async () => { throw new Error("404"); });
    await mo();
    expect(hop.querySelectorAll("tbody tr.qrow")).toHaveLength(2);
    expect(chipTT("Nháp").textContent).toBe("Nháp");
    expect(hop.querySelector(".err")).toBeNull();
    await bam(chipTT("Nháp"));
    expect(cuoi().status).toBe("draft");
  });

  it("lưu ghi chú xong thì SỐ ĐẾM được làm tươi (nhưng không nạp lại danh sách — dòng vừa sửa phải ở yên)", async () => {
    await mo();
    const soDem = h.quoteFacets.mock.calls.length, soDs = h.listQuotes.mock.calls.length;
    await act(async () => { (hop.querySelectorAll("tbody tr.qrow")[0].querySelector("button.qn-text") as HTMLButtonElement).click(); });
    const o = document.querySelector("textarea.qn-area") as HTMLTextAreaElement;
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(o), "value")!.set!;
    act(() => { setter.call(o, "Mới"); o.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => { o.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); });
    await cho(50);
    expect(h.setQuoteListNote).toHaveBeenCalledWith(1, { note: "Mới" });
    expect(h.quoteFacets.mock.calls.length, "số đếm 'Có ghi chú / Chưa có' phải đổi theo").toBeGreaterThan(soDem);
    expect(h.listQuotes.mock.calls.length, "danh sách KHÔNG nạp lại").toBe(soDs);
  });
});

describe("Danh sách báo giá — sắp xếp MỌI cột", () => {
  it("view đầy đủ: mọi cột dữ liệu bấm được (trừ Sheet, Ghi chú, Thao tác); thứ tự cột đúng", async () => {
    await mo(QUYEN_ADMIN);
    const ten = tieuDe().map((t) => (t.textContent || "").replace(/\s[▲▼]$/, "") || t.getAttribute("aria-label"));
    expect(ten).toEqual(["Mã dự án", "Người tạo", "Tiêu đề", "Ngày", "Sheet", "Tổng (VNĐ)", "Công ty", "Khách", "Mã KH", "Trạng thái", "Ghi chú", "Thao tác"]);
    const sapDuoc = tieuDe().filter((t) => t.classList.contains("sortable")).map((t) => (t.textContent || "").replace(/\s[▲▼]$/, ""));
    expect(sapDuoc).toEqual(["Mã dự án", "Người tạo", "Tiêu đề", "Ngày", "Tổng (VNĐ)", "Công ty", "Khách", "Mã KH", "Trạng thái"]);
  });

  it("bấm từng cột gửi ĐÚNG khoá sắp xếp; ngày/tiền mặc định GIẢM dần, chữ TĂNG dần; bấm lại đảo chiều; aria-sort theo", async () => {
    await mo(QUYEN_ADMIN);
    const ca: [string, string, string][] = [
      ["Mã dự án", "quoteNumber", "asc"], ["Người tạo", "creator", "asc"], ["Tiêu đề", "title", "asc"], ["Ngày", "quoteDate", "desc"],
      ["Tổng (VNĐ)", "total", "desc"], ["Công ty", "company", "asc"], ["Khách", "toCompany", "asc"], ["Mã KH", "customerCode", "asc"], ["Trạng thái", "status", "asc"],
    ];
    for (const [cot, khoa, chieu] of ca) {
      await bam(thCot(cot));
      expect(cuoi(), cot).toMatchObject({ sort: khoa, order: chieu });
      expect(thCot(cot).getAttribute("aria-sort"), cot).toBe(chieu === "asc" ? "ascending" : "descending");
      expect(urlHienTai().get("sort"), cot).toBe(khoa);
    }
    await bam(thCot("Trạng thái"));
    expect(cuoi()).toMatchObject({ sort: "status", order: "desc" });
    expect(thCot("Trạng thái").textContent).toContain("▼");
    // Mũi tên dính chữ cuối bằng dấu cách KHÔNG NGẮT: ở laptop tiêu đề cột được xuống 2 dòng, dấu cách thường để mũi tên rơi
    // xuống dòng một mình (styles.css, vùng đặc ≤1700px).
    expect(thCot("Trạng thái").textContent).toBe("Trạng thái ▼");
    expect(thCot("Mã KH").getAttribute("aria-sort"), "cột khác về none").toBe("none");
  });

  it("bàn phím: Enter / Space trên tiêu đề cột cũng sắp xếp (a11y)", async () => {
    await mo(QUYEN_ADMIN);
    await act(async () => { thCot("Công ty").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); });
    await cho();
    expect(cuoi()).toMatchObject({ sort: "company", order: "asc" });
    await act(async () => { thCot("Khách").dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true })); });
    await cho();
    expect(cuoi()).toMatchObject({ sort: "toCompany" });
  });

  it("link ?sort=customerCode&order=desc mở đúng cột đó; sort lạ → mặc định", async () => {
    await mo(QUYEN_DAY_DU, "#/list?sort=customerCode&order=desc");
    expect(h.goi[0]).toMatchObject({ sort: "customerCode", order: "desc" });
    expect(thCot("Mã KH").getAttribute("aria-sort")).toBe("descending");
  });
});

describe("Danh sách báo giá — VIEW LƯỢC (account HN / tài khoản chi phí)", () => {
  beforeEach(() => { h.rows = [dong(1, { _accountHnRow: true, hnStatus: "assigned", hnSheetCount: 1, hnTotal: 5000, internalRows: 4, internalPaidRows: 1 })]; });

  it("giữ thanh lọc GỌN: ô tìm + trạng thái + ngày; không bảng lọc đầy đủ, không số đếm, không gọi /facets", async () => {
    for (const quyen of [QUYEN_HN, QUYEN_CHI_PHI]) {
      h.quoteFacets.mockClear();
      await mo(quyen);
      expect(hop.querySelector(".bl-panel"), quyen.join()).toBeNull();
      expect(hop.querySelector('select[aria-label="Lọc theo trạng thái"]')).toBeTruthy();
      expect(hop.querySelector('input[aria-label="Ngày báo giá từ"]')).toBeTruthy();
      expect(hop.querySelector('input[aria-label="Ngày báo giá đến"]')).toBeTruthy();
      expect(h.quoteFacets, "view lược bị máy chủ từ chối (403) — không được gọi").not.toHaveBeenCalled();
      act(() => root!.unmount()); root = null; hop.remove(); document.body.innerHTML = "";
    }
  });

  it("lọc trạng thái + ngày vẫn chạy (cả hai là thứ họ thấy trên dòng); 'Xóa lọc' xoá", async () => {
    await mo(QUYEN_HN);
    go(hop.querySelector('select[aria-label="Lọc theo trạng thái"]') as HTMLSelectElement, "converted");
    await cho();
    expect(cuoi().status).toBe("converted");
    go(hop.querySelector('input[aria-label="Ngày báo giá từ"]') as HTMLInputElement, "2026-09-01");
    await cho();
    expect(cuoi()).toMatchObject({ status: "converted", from: "2026-09-01" });
    await bam(nutChu("Xóa lọc"));
    expect(Object.keys(cuoi())).not.toContain("status");
    expect(Object.keys(cuoi())).not.toContain("from");
  });

  it("CHỈ sắp theo cột CŨ (Mã dự án, Ngày): các cột còn lại là chữ thường, không mũi tên, không bấm được", async () => {
    await mo(QUYEN_HN);
    const sapDuoc = tieuDe().filter((t) => t.classList.contains("sortable")).map((t) => (t.textContent || "").replace(/\s[▲▼]$/, ""));
    expect(sapDuoc).toEqual(["Mã dự án", "Ngày"]);
    for (const ten of ["Người giao", "Tiêu đề", "Công ty", "Trạng thái"]) {
      expect(thCot(ten).classList.contains("sortable"), ten).toBe(false);
      expect(thCot(ten).getAttribute("tabindex"), ten).toBeNull();
    }
    act(() => root!.unmount()); root = null; hop.remove(); document.body.innerHTML = "";
    await mo(QUYEN_CHI_PHI);
    expect(tieuDe().filter((t) => t.classList.contains("sortable")).map((t) => (t.textContent || "").replace(/\s[▲▼]$/, ""))).toEqual(["Mã dự án", "Ngày"]);
  });

  it("URL mang tham số người tạo / tiền / ghi chú / màu / sắp xếp cột mới → BỎ (màn hình không có ô để hiện chúng, áp ngầm là sai)", async () => {
    await mo(QUYEN_HN, "#/list?creator=9&min=5&max=9&note=has&color=red&company=2&sort=creator&status=draft&from=2026-09-01");
    const p = h.goi[0];
    for (const k of ["creator", "minTotal", "maxTotal", "note", "noteColor", "companyId"]) expect(Object.keys(p), k).not.toContain(k);
    expect(p).toMatchObject({ status: "draft", from: "2026-09-01", sort: "createdAt" });
  });
});
