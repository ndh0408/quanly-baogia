/** @vitest-environment jsdom */
//
// L72 (soát toàn diện): mở báo giá LẦN ĐẦU (F5 / link #/quotes/:id, hoặc báo giá đầu tiên mở từ Danh
// sách trong phiên) phải chờ khung xương ~300 ms không cần thiết. Trình soạn nạp trễ bằng lazy(): lần
// dựng đầu LUÔN treo (throw promise) dù chunk về từ service worker sau vài ms, và React 19 giữ khung chờ
// tối thiểu FALLBACK_THROTTLE_MS = 300 ms rồi mới thay bằng trang thật (trace trên dev: bộ hẹn giờ 260 ms,
// luồng chính rảnh suốt khoảng đó).
// Bài này hỏi đúng điều người dùng thấy: khung chờ (.skeleton-wrap của PageFallback) có bị gắn vào DOM
// không, khi chunk đã kịp về trước lúc cần.
import { describe, it, expect, vi, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

// Trang con thay bằng dấu hiệu (như Shell.dieuHuong.test.tsx) — bài này chỉ hỏi Shell dựng trang thế nào.
const { trang, soLanNapEditor } = vi.hoisted(() => ({
  soLanNapEditor: { n: 0 },
  trang: (ten: string, xuat: string) => async () => {
    const { createElement } = await import("react");
    return { [xuat]: () => createElement("div", { "data-trang": ten }) };
  },
}));
vi.mock("../pages/Personnel", trang("personnel", "PersonnelPage"));
vi.mock("../pages/Employees", trang("employees", "EmployeesPage"));
vi.mock("../pages/Customers", trang("customers", "CustomersPage"));
vi.mock("../pages/Venues", trang("venues", "VenuesPage"));
vi.mock("../pages/Users", trang("users", "UsersPage"));
vi.mock("../pages/Audit", trang("audit", "AuditPage"));
vi.mock("../pages/Permissions", trang("permissions", "PermissionsPage"));
vi.mock("../pages/Profile", trang("profile", "ProfilePage"));
vi.mock("../pages/Notifications", trang("notifications", "NotificationsPage"));
vi.mock("../pages/Dashboard", trang("dashboard", "DashboardPage"));
vi.mock("../pages/QuoteList", trang("list", "QuoteListPage"));
vi.mock("../pages/Projects", trang("projects", "ProjectsPage"));
vi.mock("../pages/Invoices", trang("invoices", "InvoicesPage"));
// Đếm số lần Shell LẤY component trình soạn ra khỏi module (mỗi lượt nạp chunk một lần). Không đếm ở
// factory: vitest giữ kết quả factory qua vi.resetModules nên factory chỉ chạy một lần cho cả tệp.
vi.mock("../pages/QuoteEditor", async () => {
  const { QuoteEditorPage } = (await trang("editor", "QuoteEditorPage")()) as { QuoteEditorPage: unknown };
  return { get QuoteEditorPage() { soLanNapEditor.n++; return QuoteEditorPage; } };
});
vi.mock("../lib/api", async (goc) => {
  const that = await goc<typeof import("../lib/api")>();
  return { ...that, api: new Proxy({}, { get: () => vi.fn(async () => ({ count: 0, data: [] })) }) };
});

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SALES = { id: 1, username: "a", displayName: "A", role: "manager", permissions: ["quote:create", "quote:read:own", "quote:update:own"] };
const HN = { id: 2, username: "hn", displayName: "HN", role: "account_hn", permissions: ["quote:read:own", "quote:hn:fill"] };

let root: Root | null = null;
const cho = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null; document.body.innerHTML = ""; location.hash = "";
  delete (window as { requestIdleCallback?: unknown }).requestIdleCallback;
  localStorage.clear();
});
// Gợi ý Shell ghi lại cho lần tải trang SAU: người đăng nhập gần nhất trên trình duyệt này có mở được
// trình soạn đầy đủ không ("1"/"0"; không có = chưa ai đăng nhập hoặc đã đăng xuất).
const GOI_Y = "quanly:moTrinhSoan";

/** Nạp Shell TƯƠI (bộ nhớ module sạch) tại một hash — như một lần tải trang mới. */
async function taiTrang(hash: string) {
  vi.resetModules();
  soLanNapEditor.n = 0;
  location.hash = hash;
  return (await import("./Shell")).Shell;
}
/** Đếm số lần khung chờ bị gắn vào DOM. */
function demKhungCho(hop: HTMLElement) {
  const dem = { n: hop.querySelectorAll(".skeleton-wrap").length };
  new MutationObserver((ds) => { for (const d of ds) for (const n of d.addedNodes) if (n instanceof HTMLElement && (n.matches(".skeleton-wrap") || n.querySelector(".skeleton-wrap"))) dem.n++; })
    .observe(hop, { childList: true, subtree: true });
  return dem;
}

describe("L72 — mở báo giá lần đầu không chờ khung xương khi chunk trình soạn đã về", () => {
  it("F5 / link thẳng #/quotes/5 (lần trước trên trình duyệt này là người mở được trình soạn): chunk nạp ngay lúc tải Shell (song song /auth/me) → lần dựng đầu là trình soạn", async () => {
    localStorage.setItem(GOI_Y, "1");
    const Shell = await taiTrang("#/quotes/5");
    await cho(0);   // ngoài đời: chunk về từ SW trong lúc chờ /api/auth/me (~250 ms)
    const hop = document.createElement("div"); document.body.appendChild(hop);
    root = createRoot(hop);
    act(() => { root!.render(<Shell me={SALES} onMe={() => {}} onPreview={() => {}} />); });   // commit ĐẦU TIÊN
    expect(hop.querySelector(".skeleton-wrap"), "khung chờ bị gắn — React sẽ giữ nó ≥ 300 ms").toBeNull();
    expect(hop.querySelector('[data-trang="editor"]')).not.toBeNull();
  });

  it("Danh sách → mở báo giá đầu tiên của phiên: chunk đã nạp lúc rảnh → không có khung chờ", async () => {
    const Shell = await taiTrang("#/list");
    (window as { requestIdleCallback?: unknown }).requestIdleCallback = (cb: () => void) => setTimeout(cb, 0);
    const hop = document.createElement("div"); document.body.appendChild(hop);
    root = createRoot(hop);
    await act(async () => { root!.render(<Shell me={SALES} onMe={() => {}} onPreview={() => {}} />); });
    await cho(20);
    expect(hop.querySelector('[data-trang="list"]')).not.toBeNull();
    const khung = demKhungCho(hop);
    await act(async () => { location.hash = "#/quotes/7"; await new Promise((r) => setTimeout(r, 20)); });
    expect(hop.querySelector('[data-trang="editor"]')).not.toBeNull();
    expect(khung.n, "khung chờ đã hiện khi mở báo giá").toBe(0);
  });

  it("chunk CHƯA về (mạng chậm, lần đầu chưa có SW): vẫn dùng khung chờ rồi hiện trình soạn — không kẹt", async () => {
    const Shell = await taiTrang("#/list");   // không có requestIdleCallback → hẹn giờ dự phòng, chưa tới
    const hop = document.createElement("div"); document.body.appendChild(hop);
    root = createRoot(hop);
    await act(async () => { root!.render(<Shell me={SALES} onMe={() => {}} onPreview={() => {}} />); });
    await act(async () => { location.hash = "#/quotes/7"; await new Promise((r) => setTimeout(r, 20)); });
    expect(hop.querySelector('[data-trang="editor"]')).not.toBeNull();
    expect(soLanNapEditor.n).toBeGreaterThan(0);
  });

  // Đợt soát 3: nạp theo hash ở cấp module chạy TRƯỚC khi biết `me`, nên trước đây mọi ai mở link
  // #/quotes/:id — account HN, tài khoản chi phí, người chưa đăng nhập — đều tải chunk trình soạn
  // (~46 kB + ExtraTables ~96 kB) mà không bao giờ dùng.
  it("account HN mở link thẳng #/quotes/5: KHÔNG tải chunk trình soạn (lúc tải trang lẫn sau khi vào view HN)", async () => {
    localStorage.setItem(GOI_Y, "0");   // lần trước trên trình duyệt này: chính account HN
    const Shell = await taiTrang("#/quotes/5");
    await cho(0);
    expect(soLanNapEditor.n, "nạp chunk trình soạn ngay lúc tải trang").toBe(0);
    const hop = document.createElement("div"); document.body.appendChild(hop);
    root = createRoot(hop);
    await act(async () => { root!.render(<Shell me={HN} onMe={() => {}} onPreview={() => {}} />); });
    await cho(20);
    expect(soLanNapEditor.n).toBe(0);
    expect(localStorage.getItem(GOI_Y)).toBe("0");
  });

  it("chưa đăng nhập / đã đăng xuất (không có gợi ý) mà tải trang ở #/quotes/5: KHÔNG tải chunk trình soạn", async () => {
    await taiTrang("#/quotes/5");
    await cho(0);
    expect(soLanNapEditor.n).toBe(0);
  });

  it("Shell ghi gợi ý cho lần tải sau: người mở được trình soạn → '1', account HN → '0'", async () => {
    const Shell = await taiTrang("#/list");
    const hop = document.createElement("div"); document.body.appendChild(hop);
    root = createRoot(hop);
    await act(async () => { root!.render(<Shell me={SALES} onMe={() => {}} onPreview={() => {}} />); });
    expect(localStorage.getItem(GOI_Y)).toBe("1");
    await act(async () => { root!.render(<Shell me={HN} onMe={() => {}} onPreview={() => {}} />); });
    expect(localStorage.getItem(GOI_Y)).toBe("0");
  });

  it("Đăng xuất xoá gợi ý — màn đăng nhập sau đó không tải chunk trình soạn cho người chưa biết là ai", async () => {
    const Shell = await taiTrang("#/list");
    const hop = document.createElement("div"); document.body.appendChild(hop);
    root = createRoot(hop);
    await act(async () => { root!.render(<Shell me={SALES} onMe={() => {}} onPreview={() => {}} />); });
    expect(localStorage.getItem(GOI_Y)).toBe("1");
    await act(async () => { hop.querySelector<HTMLButtonElement>("button.logout")!.click(); await new Promise((r) => setTimeout(r, 20)); });
    expect(localStorage.getItem(GOI_Y)).toBeNull();
  });

  it("tài khoản không mở trình soạn (account HN → view HN riêng): KHÔNG nạp trước chunk trình soạn", async () => {
    const Shell = await taiTrang("#/list");
    (window as { requestIdleCallback?: unknown }).requestIdleCallback = (cb: () => void) => setTimeout(cb, 0);
    const hop = document.createElement("div"); document.body.appendChild(hop);
    root = createRoot(hop);
    await act(async () => { root!.render(<Shell me={HN} onMe={() => {}} onPreview={() => {}} />); });
    await cho(20);
    expect(soLanNapEditor.n).toBe(0);
  });
});
