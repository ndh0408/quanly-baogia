/** @vitest-environment jsdom */
//
// L65 (soát toàn diện): chế độ tối, ô nhập "TRẦN" — ô không nằm dưới luật nền nào của app — nhận nền
// xám #3b3b3b + viền lõm 2px #858585 mặc định của Chrome (vì `color-scheme: dark`), lệch tông app giữa
// nền navy; chữ gợi ý #757575 trên đó chỉ 2.43:1. Đo trên dev, quét 15 trang: đúng ba chỗ —
//   · ô tìm "Tìm theo tên hoặc username…" và ô chọn vai trò ở từng dòng, trang Phân quyền;
//   · ô "Ghi chú cuối báo giá" của trình soạn (style nội tuyến chỉ có border, không có nền).
// Luật `:where(… .modal …)` sẵn có chỉ phủ ô NẰM TRONG hộp thoại.
//
// Bài này dựng TRANG THẬT (jsdom) rồi hỏi từng ô có khớp một luật tối nào tô nền tông app không —
// bộ chọn đọc thẳng từ styles.css (vitest chặn .css nên đọc đĩa, xem styles.contrast.test.ts).
// Chiều ngược lại cũng gác: luật không được lan sang ô lưới / ô tick (chúng có kiểu riêng).
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Môi trường jsdom thay `URL` toàn cục bằng bản của jsdom → node:fs/node:url không nhận nó ("The URL
// must be of scheme file"); ghép chuỗi rồi để node:url tự đổi sang đường dẫn.
const fs = (await import(/* @vite-ignore */ ["node", "fs"].join(":"))) as { readFileSync: (p: string, e: string) => string };
const nurl = (await import(/* @vite-ignore */ ["node", "url"].join(":"))) as { fileURLToPath: (u: string) => string };
const css = fs.readFileSync(nurl.fileURLToPath(import.meta.url.replace(/[^/]*$/, "styles.css")), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** Bộ chọn của mọi luật CHẾ ĐỘ TỐI tô ô bằng nền tông app: nền --surface-2 + viền 1px --border-strong
 *  (khai cả viền: ô có nền riêng thì Chrome vẽ viền mặc định 2px lõm hai màu). */
const boChonNenApp = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .filter((m) => m[1].includes('data-theme="dark"') && !m[1].includes("::"))
  .filter((m) => /background:\s*var\(--surface-2\)/.test(m[2]) && /border:\s*1px solid var\(--border-strong\)/.test(m[2]))
  .map((m) => m[1].trim());
const anNenApp = (el: Element) => boChonNenApp.some((s) => el.matches(s));

const MAU = [{ id: 1, code: "gn", name: "GN", companyId: 7, layout: { hasDays: false } }];
const baoGia = {
  id: 11, quoteNumber: "GN26011", title: "Sự kiện", status: "draft", companyId: 7, createdById: 1,
  toCompany: "Khách", vatPercent: 0, discount: 0, showTotals: true, quoteDate: "2026-09-20", notes: "Thuê, thu hồi sau sự kiện",
  updatedAt: "2026-09-20T00:00:00.000Z", hnStatus: null, hnTables: [], members: [],
  sheets: [{ id: 101, templateId: 1, name: "Trang 1", groupSubtotal: false, items: [{ kind: "section", name: "Nhóm A" }, { kind: "item", name: "Backdrop", unit: "cái", quantity: 1, unitPrice: 1000 }], extraTables: [] }],
};

vi.mock("./lib/api", async (goc) => {
  const that = await goc<typeof import("./lib/api")>();
  const fns: Record<string, ReturnType<typeof vi.fn>> = {
    permissionsCatalog: vi.fn(async () => ({
      roles: [{ key: "admin", label: "Quản trị", permissions: [] }, { key: "manager", label: "Quản lý", permissions: ["quote:send"] }],
      groups: [{ label: "Báo giá", perms: [{ key: "quote:send", label: "Gửi khách" }] }],
      editableRoles: ["manager"], adminOnlyPermissions: [],
    })),
    listUsers: vi.fn(async () => [
      { id: 1, username: "admin", displayName: "Admin", role: "admin", active: true },
      { id: 2, username: "an", displayName: "An", role: "manager", active: true },
    ]),
    metaCompanies: vi.fn(async () => [{ id: 7, name: "Gia Nguyễn" }]),
    metaTemplates: vi.fn(async () => MAU),
    getQuote: vi.fn(async () => baoGia),
    presence: vi.fn(async () => ({ editing: [] })),
    hnAccounts: vi.fn(async () => ({ data: [] })),
  };
  return { ...that, api: new Proxy(fns, { get: (t, k: string) => t[k] ?? (t[k] = vi.fn(async () => ({}))) }) };
});
vi.mock("./lib/venueCatalog", async (goc) => ({ ...(await goc<typeof import("./lib/venueCatalog")>()), loadCatalog: () => Promise.resolve({ entries: [], venues: [] }) }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { PermissionsPage } from "./pages/Permissions";
import { QuoteEditorPage } from "./pages/QuoteEditor";

let root: Root | null = null;
const cho = async (ms = 0) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
afterEach(async () => {
  await cho(1300);   // hẹn giờ ghi bản nháp 1,2s của trình soạn — cho nổ trong act rồi mới tháo cây
  if (root) act(() => root!.unmount());
  root = null; document.body.innerHTML = ""; localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

async function dung(node: ReactNode) {
  document.documentElement.setAttribute("data-theme", "dark");
  const hop = document.createElement("div"); document.body.appendChild(hop);
  root = createRoot(hop);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => { root!.render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>); });
  await cho(20);
  return hop;
}

describe("L65 — chế độ tối: ô nhập trần theo tông app, không phải ô xám của trình duyệt", () => {
  it("đọc được luật từ styles.css", () => expect(boChonNenApp.length).toBeGreaterThan(0));

  it("Phân quyền: ô tìm nhân viên + ô chọn vai trò ở MỌI dòng; ô tick của ma trận thì không đụng", async () => {
    const me = { id: 1, username: "admin", displayName: "Admin", role: "admin", permissions: ["user:manage"] };
    const hop = await dung(<PermissionsPage me={me} />);
    const tim = hop.querySelector('input[type="search"]')!;
    expect(tim, "phải thấy ô tìm").not.toBeNull();
    expect(anNenApp(tim), "ô 'Tìm theo tên hoặc username…'").toBe(true);
    const chon = [...hop.querySelectorAll("tbody select")];
    expect(chon.length).toBe(2);
    for (const s of chon) expect(anNenApp(s), s.getAttribute("aria-label") ?? "").toBe(true);
    for (const o of hop.querySelectorAll('input[type="checkbox"]')) expect(anNenApp(o)).toBe(false);
    // Chỉ chế độ tối: bản sáng giữ nguyên.
    document.documentElement.setAttribute("data-theme", "light");
    expect(anNenApp(tim)).toBe(false);
  });

  it("Trình soạn: ô 'Ghi chú cuối báo giá' — còn ô lưới (có kiểu riêng, nền trong suốt) thì không", async () => {
    const me = { id: 1, username: "a", displayName: "A", role: "admin", permissions: ["quote:update:all", "quote:read:all"] };
    const hop = await dung(<QuoteEditorPage me={me} quoteId={11} isNew={false} />);
    const ghiChu = hop.querySelector('textarea[placeholder^="VD: Tất cả các hạng mục"]');
    expect(ghiChu, "phải thấy ô ghi chú cuối báo giá").not.toBeNull();
    expect(anNenApp(ghiChu!)).toBe(true);
    const oLuoi = [...hop.querySelectorAll(".excel-table :is(input, textarea, select)")];
    expect(oLuoi.length).toBeGreaterThan(0);
    for (const o of oLuoi) expect(anNenApp(o), (o as HTMLInputElement).placeholder || o.tagName).toBe(false);
  });
});
