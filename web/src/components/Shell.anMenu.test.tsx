/** @vitest-environment jsdom */
//
// Chủ repo 2026-10-07: (1) "cho tôi thêm nút ẩn tắt cái menu" — menu trái chiếm 248px mà các bảng nhiều cột (Nhân sự,
// Quản lý dự án, Hóa đơn, lưới báo giá) đang phải cuộn ngang; (2) "có mấy cái email dài nó tràn ra khỏi menu luôn" —
// "@<email>" ở chân menu là chữ liền không ngắt được, đo bằng Chromium: email 52 ký tự tràn tới x=399px trong menu rộng 248px.
// Bài jsdom khoá HÀNH VI (nút, phím tắt, nhớ theo máy, title); phần hình học do CSS lo được khoá ở cuối tệp bằng cách đọc
// thẳng styles.css như styles.nhieuManHinh.test.ts.
import { describe, it, expect, vi, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const { trang, chuaDoc } = vi.hoisted(() => ({
  chuaDoc: { n: 0 },
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
vi.mock("../pages/InvoicesIn", trang("invoices-in", "InvoicesInPage"));
vi.mock("../lib/api", async (goc) => {
  const that = await goc<typeof import("../lib/api")>();
  return { ...that, api: new Proxy({}, { get: (_, k) => vi.fn(async () => (k === "unreadCount" ? { count: chuaDoc.n } : { count: 0, data: [] })) }) };
});

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { Shell } from "./Shell";

const KHOA = "quanly:anMenu";
const EMAIL_DAI = "nguyenthithanhhuong.ketoan.giannguyen2026@gmail.com";
const TEN_DAI = "Nguyễn Thị Thanh Hương Phạm Ngọc Bảo Trâm";

let root: Root | null = null;
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null; document.body.innerHTML = ""; location.hash = "";
  localStorage.clear(); vi.restoreAllMocks(); chuaDoc.n = 0;
  delete (window as { matchMedia?: unknown }).matchMedia;
});

async function mo(me: Partial<{ username: string; displayName: string }> = {}) {
  location.hash = "#/list";
  const hop = document.createElement("div"); document.body.appendChild(hop);
  root = createRoot(hop);
  const nguoi = { id: 1, username: "a", displayName: "A", role: "manager", permissions: ["quote:read:own"], ...me };
  await act(async () => { root!.render(<Shell me={nguoi} onMe={() => {}} onPreview={() => {}} />); });
  return hop;
}
const dongMo = () => { act(() => root!.unmount()); root = null; document.body.innerHTML = ""; };
const nut = (hop: HTMLElement) => hop.querySelector<HTMLButtonElement>("aside.sidebar button.sb-an-hien");
const anMenu = (hop: HTMLElement) => !!hop.querySelector("aside.sidebar.thu-gon") && !!hop.querySelector(".shell.sb-thu-gon");
const phim = (key: string, them: KeyboardEventInit = {}) => act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key, ctrlKey: true, bubbles: true, cancelable: true, ...them })); });

describe("nút ẩn / hiện menu trái (màn rộng)", () => {
  it("bấm nút → menu thu gọn, ghi localStorage, nút MỞ LẠI vẫn ở đó; bấm lần nữa → hiện lại", async () => {
    const hop = await mo();
    const b = nut(hop);
    expect(b, "phải có nút ẩn menu trong thanh bên").not.toBeNull();
    expect(anMenu(hop)).toBe(false);
    expect(b!.type).toBe("button");
    expect(b!.getAttribute("aria-label")).toBe("Ẩn menu");
    expect(b!.getAttribute("aria-expanded")).toBe("true");
    expect(b!.title).toMatch(/Ctrl\+B/);

    act(() => b!.click());
    expect(anMenu(hop), "aside + .shell phải mang lớp thu gọn").toBe(true);
    expect(localStorage.getItem(KHOA)).toBe("1");
    // CÙNG một nút (tiêu điểm bàn phím không rơi về <body>), đổi nghĩa thành "Hiện menu".
    expect(nut(hop)).toBe(b);
    expect(b!.getAttribute("aria-label")).toBe("Hiện menu");
    expect(b!.getAttribute("aria-expanded")).toBe("false");
    expect(b!.hidden).toBe(false);

    act(() => b!.click());
    expect(anMenu(hop)).toBe(false);
    expect(localStorage.getItem(KHOA)).toBe("0");
  });

  it("nạp lại trang → nhớ trạng thái theo máy", async () => {
    let hop = await mo();
    act(() => nut(hop)!.click());
    dongMo();
    hop = await mo();
    expect(anMenu(hop), "lần mở sau vẫn ẩn").toBe(true);
    expect(nut(hop)!.getAttribute("aria-label")).toBe("Hiện menu");
  });

  it("localStorage bị chặn (ném lỗi) → không vỡ trang, mặc định hiện menu, nút vẫn bấm được", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("SecurityError"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("SecurityError"); });
    const hop = await mo();
    expect(anMenu(hop)).toBe(false);
    act(() => nut(hop)!.click());
    expect(anMenu(hop)).toBe(true);
  });

  it("đang ẩn mà có thông báo chưa đọc → nút mở lại báo số (menu với huy hiệu đang bị giấu)", async () => {
    localStorage.setItem(KHOA, "1");
    chuaDoc.n = 3;
    const hop = await mo();
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(nut(hop)!.getAttribute("aria-label")).toBe("Hiện menu — 3 thông báo chưa đọc");
    expect(nut(hop)!.querySelector(".sb-an-hien-cham")).not.toBeNull();
  });
});

describe("phím tắt", () => {
  it("Ctrl+B ẩn rồi hiện; ⌘+B (Mac) cũng vậy; Ctrl+Shift+B / Ctrl+Alt+B không đụng", async () => {
    const hop = await mo();
    phim("b");
    expect(anMenu(hop)).toBe(true);
    expect(localStorage.getItem(KHOA)).toBe("1");
    phim("B", { ctrlKey: false, metaKey: true });
    expect(anMenu(hop)).toBe(false);
    phim("B", { shiftKey: true });
    phim("b", { altKey: true });
    expect(anMenu(hop)).toBe(false);
  });

  it("màn hẹp (≤920px, drawer mobile) → Ctrl+B KHÔNG đổi cờ — hai cơ chế không giành nhau", async () => {
    window.matchMedia = ((q: string) => ({ matches: q === "(max-width: 920px)", media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
    const hop = await mo();
    phim("b");
    expect(anMenu(hop)).toBe(false);
    expect(localStorage.getItem(KHOA)).not.toBe("1");
  });

  it("Ctrl+K lúc menu đang ẩn → hiện menu và đặt con trỏ vào ô tìm (ô tìm nằm trong menu)", async () => {
    localStorage.setItem(KHOA, "1");
    const hop = await mo();
    expect(anMenu(hop)).toBe(true);
    phim("k");
    expect(anMenu(hop)).toBe(false);
    expect(document.activeElement?.id).toBe("gs-input");
  });
});

describe("chữ dài ở chân menu không tràn ra ngoài", () => {
  it("tên + @email dài có title đủ chữ và mang lớp cắt gọn", async () => {
    const hop = await mo({ username: EMAIL_DAI, displayName: TEN_DAI });
    const tk = hop.querySelector<HTMLElement>(".sidebar .who .who-tk");
    const ten = hop.querySelector<HTMLElement>(".sidebar .who .who-ten");
    expect(tk?.textContent).toBe("@" + EMAIL_DAI);
    expect(tk?.title).toBe("@" + EMAIL_DAI);
    expect(ten?.textContent).toBe(TEN_DAI);
    expect(ten?.title).toBe(TEN_DAI);
    expect(hop.querySelector(".sidebar .who .role-pill")?.getAttribute("title")).toBe("Account");
    // Nhãn menu cũng có title (cắt gọn nếu dài) — ui-smoke đọc `nav a span` nên chữ trong span phải giữ nguyên.
    const nhan = hop.querySelector<HTMLElement>(".sidebar nav a span");
    expect(nhan?.title).toBe(nhan?.textContent);
  });
});

// ── CSS: đọc thẳng đĩa (vitest trả RỖNG cho *.css?raw — xem styles.contrast.test.ts). jsdom thay `URL` toàn cục nên
// node:fs không nhận `new URL(…)` — ghép chuỗi rồi để node:url đổi sang đường dẫn, như styles.oTranToi.test.tsx. ──
const fs = (await import(/* @vite-ignore */ ["node", "fs"].join(":"))) as { readFileSync: (p: string, e: string) => string };
const nurl = (await import(/* @vite-ignore */ ["node", "url"].join(":"))) as { fileURLToPath: (u: string) => string };
const css = fs.readFileSync(nurl.fileURLToPath(import.meta.url.replace(/components\/[^/]*$/, "styles.css")), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
function dong(mo: number): number {
  let d = 0;
  for (let j = mo; j < css.length; j++) {
    if (css[j] === "{") d++;
    else if (css[j] === "}" && --d === 0) return j;
  }
  return css.length;
}
const khoi: { dau: string; ruot: string }[] = [];
for (let i = 0, batDau = 0; i < css.length; i++) {
  if (css[i] !== "{") continue;
  const het = dong(i);
  khoi.push({ dau: css.slice(batDau, i).trim(), ruot: css.slice(i + 1, het) });
  i = het; batDau = het + 1;
}
const chuan = (s: string) => s.trim().replace(/\s+/g, " ");
/** Ruột các luật (trong `ruot`, mặc định cấp đầu) có bộ chọn `chon`. */
function luat(chon: string, trong = css): string {
  return [...trong.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => m[1].split(",").map(chuan).includes(chon)).map((m) => m[2]).join(";");
}
const DESKTOP = "@media not all and (max-width: 920px)";
const MOBILE = "@media (max-width: 920px)";
const ruotMedia = (dau: string) => khoi.filter((k) => chuan(k.dau) === dau).map((k) => k.ruot).join("\n");
const capDau = khoi.filter((k) => !k.dau.startsWith("@")).map((k) => `${k.dau}{${k.ruot}}`).join("\n");

describe("CSS — thu gọn chỉ ở màn rộng, chữ dài cắt gọn", () => {
  it("lớp thu gọn chỉ có hiệu lực trong @media màn rộng (đúng phần bù của drawer ≤920px)", () => {
    const rong = ruotMedia(DESKTOP);
    expect(rong, `thiếu khối ${DESKTOP}`).not.toBe("");
    expect(luat(".shell.sb-thu-gon", rong), "cột lưới của menu phải co lại").toMatch(/--sidebar-w:\s*48px/);
    expect(luat(".sidebar.thu-gon > :not(.sb-an-hien)", rong)).toMatch(/display:\s*none/);
    // Không một luật cấp đầu nào chạm lớp thu gọn — nếu có thì nó áp cả lên drawer mobile.
    expect(capDau).not.toMatch(/thu-gon[^{}]*\{/);
    for (const k of khoi.filter((x) => x.dau.startsWith("@media") && chuan(x.dau) !== DESKTOP)) {
      const moc = /^@media \(min-width: (\d+)px\)$/.exec(chuan(k.dau));
      if (moc && Number(moc[1]) > 920) continue;   // nấc chỉ tồn tại ở màn rộng
      expect(k.ruot, k.dau).not.toMatch(/thu-gon/);
    }
  });

  it("màn hẹp giấu nút ẩn/hiện (drawer có nút ☰ riêng)", () => {
    expect(luat(".sb-an-hien", ruotMedia(MOBILE))).toMatch(/display:\s*none/);
  });

  it("bảng giãn ra khi menu ẩn: nấc bề rộng tối đa dời theo 200px menu trả lại", () => {
    // Nấc gốc (styles.css, khối "nới theo nấc") tính theo cửa sổ khi menu rộng 248px: 1600 → 1680, 1960 → 1880, 2300 → 2200.
    // Menu còn 48px → cùng chỗ trống cho bảng ở cửa sổ hẹp hơn 200px.
    for (const [moc, tran] of [[1400, 1680], [1760, 1880], [2100, 2200]]) {
      const r = ruotMedia(`@media (min-width: ${moc}px)`);
      expect(luat(".shell.sb-thu-gon .main > *:has(table)", r), `nấc ${moc}px`).toMatch(new RegExp(`max-width:\\s*min\\(${tran}px,\\s*100%\\)`));
    }
  });

  it("tên, @email, vai trò, tên công ty, nhãn menu: một dòng, cắt bằng dấu …", () => {
    for (const chon of [".sidebar .who-ten", ".sidebar .who-tk", ".sidebar .role-pill", ".sidebar .org", ".sidebar h2", ".sidebar .menu a > span:not(.badge-num)"]) {
      const r = luat(chon);
      expect(r, chon).toMatch(/overflow:\s*hidden/);
      expect(r, chon).toMatch(/text-overflow:\s*ellipsis/);
      expect(r, chon).toMatch(/white-space:\s*nowrap/);
    }
    expect(luat(".sidebar .sb-brand-chu"), "con flex phải co được, không thì ellipsis không bao giờ kích hoạt").toMatch(/min-width:\s*0/);
  });
});
