/** @vitest-environment jsdom */
//
// L75 (soát toàn diện): Danh sách báo giá — mở #/list?page=N (F5, Back sau khi mở một báo giá, link đã
// lưu) LUÔN nhảy về trang 1: `useEffect(() => setPage(1), [debouncedQ, status, sort, order])` chạy cả lúc
// mount, ghi đè trang đọc từ URL (và tốn thêm một request page=N bị bỏ phí). Gõ tìm khi đang ở trang 2
// cũng gọi API hai lần: page=2 với từ khoá mới rồi mới page=1. Đo trên dev: '#/list?page=3' → GET page=3
// rồi GET page=1, cuối cùng 'Trang 1/3'.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

type Loc = { q?: string; status?: string; sort?: string; order?: string; page?: number; size?: number };
const h = vi.hoisted(() => ({ goi: [] as Loc[], tong: 60 }));
vi.mock("../lib/api", async (goc) => {
  const that = await goc<typeof import("../lib/api")>();
  const listQuotes = vi.fn(async (p: Loc) => {
    h.goi.push({ ...p });
    const size = p.size ?? 20, page = p.page ?? 1, tong = h.tong;
    const bat = (page - 1) * size;
    const data = Array.from({ length: Math.max(0, Math.min(size, tong - bat)) }, (_, i) => ({ id: bat + i + 1, quoteNumber: `GN${bat + i + 1}`, status: "draft", createdById: 1, sheetCount: 1 }));
    return { data, meta: { total: tong, page, size, pageCount: Math.ceil(tong / size) } };
  });
  return { ...that, api: new Proxy({ listQuotes } as Record<string, unknown>, { get: (t, k: string) => t[k] ?? vi.fn(async () => ({})) }) };
});

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { QuoteListPage } from "./QuoteList";

const ME = { id: 1, username: "a", displayName: "A", role: "manager", permissions: ["quote:read:own", "quote:create"] };
let root: Root | null = null;
let hop: HTMLDivElement;
const cho = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

beforeEach(() => {
  h.goi.length = 0; h.tong = 60;
  // jsdom không có matchMedia (useIsMobile dùng nó)
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
});
afterEach(() => { if (root) act(() => root!.unmount()); root = null; document.body.innerHTML = ""; location.hash = ""; });

async function mo(hash: string) {
  location.hash = hash;
  hop = document.createElement("div"); document.body.appendChild(hop);
  root = createRoot(hop);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => { root!.render(<QueryClientProvider client={qc}><QuoteListPage me={ME} /></QueryClientProvider>); });
  await cho(20);
}
const chuTrang = () => hop.querySelector(".pager .muted")?.textContent ?? "";
const nut = (chu: string) => [...hop.querySelectorAll(".pager button")].find((b) => b.textContent?.includes(chu)) as HTMLButtonElement;
/** Lật tới trang n bằng nút "Sau →" như người dùng (không qua URL — tách khỏi lỗi đọc URL lúc mount). */
async function latToi(n: number) { for (let i = 1; i < n; i++) { await act(async () => { nut("Sau").click(); }); await cho(20); } }
const oTim = () => hop.querySelector('input[aria-label="Tìm báo giá"]') as HTMLInputElement;
function go(el: HTMLInputElement | HTMLSelectElement, v: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")!.set!;
  act(() => { setter.call(el, v); el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true })); });
}

describe("L75 — Danh sách báo giá giữ trang từ URL, đổi bộ lọc về trang 1 bằng MỘT request", () => {
  it("F5 / Back về #/list?page=3: ở lại trang 3, chỉ gọi page=3, URL giữ ?page=3", async () => {
    await mo("#/list?page=3");
    expect(chuTrang()).toBe("Trang 3/3");
    expect(h.goi.map((g) => g.page)).toEqual([3]);
    expect(location.hash).toBe("#/list?page=3");
  });

  it("đang ở trang 2 gõ tìm: đúng MỘT request cho từ khoá mới, và là page=1", async () => {
    await mo("#/list");
    await latToi(2);
    expect(chuTrang()).toBe("Trang 2/3");
    h.goi.length = 0;
    go(oTim(), "Colorfull");
    await cho(400);   // qua debounce 300 ms
    const theoTuKhoa = h.goi.filter((g) => g.q === "Colorfull");
    expect(theoTuKhoa.map((g) => g.page)).toEqual([1]);
  });

  it("đổi trạng thái / sắp xếp ở trang 3 → trang 1 ngay, không request page=3 với bộ lọc mới", async () => {
    await mo("#/list");
    await latToi(3);
    h.goi.length = 0;
    go(hop.querySelector('select[aria-label="Lọc theo trạng thái"]') as HTMLSelectElement, "draft");
    await cho(20);
    expect(h.goi.map((g) => `${g.status}:${g.page}`)).toEqual(["draft:1"]);
    go(hop.querySelector('select[aria-label="Lọc theo trạng thái"]') as HTMLSelectElement, "");
    await cho(20);
    await latToi(3);
    h.goi.length = 0;
    await act(async () => { (hop.querySelector("th.sortable") as HTMLElement).click(); });
    await cho(20);
    expect(h.goi.map((g) => g.page)).toEqual([1]);
  });

  it("đổi bộ lọc rồi đổi LẠI như cũ: vẫn ở trang 1 (không bật về trang cũ)", async () => {
    await mo("#/list?page=3");
    const chon = hop.querySelector('select[aria-label="Lọc theo trạng thái"]') as HTMLSelectElement;
    go(chon, "draft"); await cho(20);
    go(chon, ""); await cho(20);
    expect(chuTrang()).toBe("Trang 1/3");
  });

  it("nút Sau → / ← Trước vẫn lật trang và ghi lên URL", async () => {
    await mo("#/list");
    await act(async () => { nut("Sau").click(); }); await cho(20);
    expect(chuTrang()).toBe("Trang 2/3");
    expect(location.hash).toBe("#/list?page=2");
    await act(async () => { nut("Trước").click(); }); await cho(20);
    expect(chuTrang()).toBe("Trang 1/3");
  });

  it("URL trỏ quá số trang hiện có (báo giá đã bị xoá bớt): kéo về trang cuối, không kẹt ở danh sách rỗng", async () => {
    h.tong = 25;   // còn 2 trang
    await mo("#/list?page=3");
    await cho(20);
    expect(chuTrang()).toBe("Trang 2/2");
    expect(hop.querySelectorAll("tbody tr.qrow").length).toBe(5);
  });
});
