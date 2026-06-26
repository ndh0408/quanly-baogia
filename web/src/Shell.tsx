import { useState, useEffect, useRef, useMemo, lazy, Suspense, Component, type ReactNode, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { api, type Me } from "./api";
import { confirmModal } from "./ui";

// Chặn rời editor khi có thay đổi chưa lưu (QuoteEditor đặt cờ window.__editorDirty) — giống leaveEditorGuard SPA.
async function guardLeave(): Promise<boolean> {
  const w = window as Window & { __editorDirty?: boolean };
  if (!w.__editorDirty) return true;
  const ok = await confirmModal("Rời khỏi mà chưa lưu?", "Bạn có thay đổi chưa lưu trong báo giá. Rời đi sẽ mất các thay đổi này.", { danger: true, confirmText: "Rời, bỏ thay đổi" });
  if (ok) w.__editorDirty = false;
  return ok;
}

// Hiển thị trong lúc tải chunk lazy (editor/wizard/HN) — skeleton giống các trang khác.
function PageFallback() {
  return <div className="skeleton-wrap">{Array.from({ length: 6 }).map((_, i) => <div className="skeleton-row" key={i} />)}</div>;
}

// LazyBoundary = ErrorBoundary + Suspense. Khi deploy bản mới lúc user đang mở app cũ rồi mở route lazy,
// chunk-hash CŨ đã bị xóa (emptyOutDir) → ChunkLoadError. Tự reload 1 lần (chặn loop qua mốc thời gian)
// để lấy bundle mới thay vì để trang hỏng. (Lỗi cố hữu của SPA code-split, không riêng PWA.)
class LazyBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(err: unknown) {
    const msg = String((err as { message?: string })?.message || err);
    if (/ChunkLoadError|Loading chunk|dynamically imported module|Failed to fetch/i.test(msg)) {
      const last = Number(sessionStorage.getItem("chunkReloadAt") || 0);
      if (Date.now() - last > 10000) { // chỉ reload nếu lần trước >10s → tránh lặp vô hạn
        sessionStorage.setItem("chunkReloadAt", String(Date.now()));
        location.reload();
      }
    }
  }
  render() {
    if (this.state.failed) return <PageFallback />;
    return <Suspense fallback={<PageFallback />}>{this.props.children}</Suspense>;
  }
}
import { PersonnelPage } from "./Personnel";
import { EmployeesPage } from "./Employees";
import { CustomersPage } from "./Customers";
import { UsersPage } from "./Users";
import { AuditPage } from "./Audit";
import { PermissionsPage } from "./Permissions";
import { ProfilePage } from "./Profile";
import { NotificationsPage } from "./Notifications";
import { DashboardPage } from "./Dashboard";
import { QuoteListPage } from "./QuoteList";
import { ProjectsPage } from "./Projects";
// Lazy-load các trang NẶNG/route-riêng (editor + lưới + công thức/clipboard, wizard, view HN) → tách
// thành chunk riêng, KHÔNG vào bundle chính: HR/Account-list không phải tải editor mới mở app.
const QuoteEditorPage = lazy(() => import("./QuoteEditor").then((m) => ({ default: m.QuoteEditorPage })));
const NewQuoteWizard = lazy(() => import("./NewQuoteWizard").then((m) => ({ default: m.NewQuoteWizard })));
const AccountHnView = lazy(() => import("./AccountHnView").then((m) => ({ default: m.AccountHnView })));
const InternalQuoteView = lazy(() => import("./InternalQuoteView").then((m) => ({ default: m.InternalQuoteView })));

const ROLE_LABEL: Record<string, string> = {
  admin: "Quản trị", manager: "Account", account_hn: "Account HN", hr: "Nhân sự", accountant: "Kế toán",
};
const QSTATUS: Record<string, string> = { draft: "Nháp", converted: "Đã chốt", lost: "Không chốt", pending: "Chờ duyệt", approved: "Đã duyệt", rejected: "Bị từ chối", sent: "Đã gửi" };
// Bỏ dấu + đ→d → khớp tìm KHÔNG dấu / sai dấu cho "đi tới trang".
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase().trim();

const S = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
const ICON: Record<string, ReactNode> = {
  personnel: <svg {...S}><circle cx="9" cy="8" r="3.2" /><path d="M3.5 20a5.5 5.5 0 0 1 11 0" /><path d="M16 5.2a3 3 0 0 1 0 5.6" /><path d="M17.5 20a5.5 5.5 0 0 0-3-4.9" /></svg>,
  employees: <svg {...S}><rect x="3" y="4.5" width="18" height="15" rx="2" /><circle cx="9" cy="10" r="2.1" /><path d="M5.6 16.5a3.4 3.4 0 0 1 6.8 0" /><line x1="14.5" y1="9" x2="18.5" y2="9" /><line x1="14.5" y1="13" x2="18.5" y2="13" /></svg>,
  dashboard: <svg {...S}><rect x="3" y="3" width="7" height="8" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="11" width="7" height="10" rx="1.5" /></svg>,
  list: <svg {...S}><line x1="8" y1="6" x2="20" y2="6" /><line x1="8" y1="12" x2="20" y2="12" /><line x1="8" y1="18" x2="20" y2="18" /><circle cx="4" cy="6" r="1" /><circle cx="4" cy="12" r="1" /><circle cx="4" cy="18" r="1" /></svg>,
  new: <svg {...S}><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6" /><line x1="12" y1="12" x2="12" y2="18" /><line x1="9" y1="15" x2="15" y2="15" /></svg>,
  customers: <svg {...S}><circle cx="12" cy="8" r="3.2" /><path d="M5 20a7 7 0 0 1 14 0" /></svg>,
  notifications: <svg {...S}><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></svg>,
  projects: <svg {...S}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>,
  users: <svg {...S}><circle cx="9" cy="8" r="3.2" /><path d="M3.5 20a5.5 5.5 0 0 1 11 0" /><path d="M16 5.2a3 3 0 0 1 0 5.6" /><path d="M17.5 20a5.5 5.5 0 0 0-3-4.9" /></svg>,
  permissions: <svg {...S}><path d="M12 3l7 3v5c0 5-3.5 8-7 10-3.5-2-7-5-7-10V6z" /></svg>,
  audit: <svg {...S}><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3.5 2" /></svg>,
  profile: <svg {...S}><circle cx="12" cy="8" r="3.4" /><path d="M5 20a7 7 0 0 1 14 0" /></svg>,
};

const themeIcon = () => (localStorage.getItem("theme") === "dark" ? "☀️" : "🌙");
function toggleTheme() {
  const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  try { localStorage.setItem("theme", next); } catch { /* ignore */ }
}

// ported=true → trang React thật; còn lại NHÚNG app cũ (/app?embed=1) — dùng được ngay, không tách rời.
type Nav = { key: string; label: string; group: string; perm?: string | string[]; ported?: boolean };
// Nhóm theo công việc: Tổng quan dẫn đầu (tổng-quan trước), rồi cụm Báo giá, rồi cụm Nhân sự, rồi
// Thông báo. KHÔNG đổi trang đích (Shell vẫn ép HR-first cho ai có quyền HR) — chỉ sắp xếp menu.
const NAV: Nav[] = [
  { key: "dashboard", label: "Tổng quan", group: "Công việc", perm: "quote:create", ported: true },
  { key: "list", label: "Danh sách báo giá", group: "Công việc", perm: "quote:read:own", ported: true },
  { key: "new", label: "Tạo báo giá", group: "Công việc", perm: "quote:create" },
  { key: "customers", label: "Mã khách hàng", group: "Công việc", perm: "customer:read:own", ported: true },
  { key: "personnel", label: "Nhân sự", group: "Công việc", perm: "personnel:read:own", ported: true },
  { key: "employees", label: "Danh bạ nhân sự", group: "Công việc", perm: "employee:read:own", ported: true },
  { key: "notifications", label: "Thông báo", group: "Công việc", ported: true },
  { key: "projects", label: "Quản lý dự án", group: "Quản trị", perm: ["quote:create", "invoice:read"], ported: true },
  { key: "users", label: "Quản lý nhân viên", group: "Quản trị", perm: "user:manage", ported: true },
  { key: "permissions", label: "Phân quyền", group: "Quản trị", perm: "user:manage", ported: true },
  { key: "audit", label: "Nhật ký hoạt động", group: "Quản trị", perm: "audit:view", ported: true },
  { key: "profile", label: "Tài khoản", group: "Tài khoản", ported: true },
];

// Strip ?query (filters) khi khớp nav key → #/list?status=… vẫn là trang "list".
const currentKey = () => location.hash.replace(/^#\/?/, "").split("?")[0] || "personnel";

// ===== Tìm kiếm TOÀN CỤC thông minh (command palette) =====
// Đa thực thể: Trang (đi tới nhanh) + Báo giá + Khách hàng + Nhân sự — đã phân quyền ở server.
// Bàn phím: ↑↓ chọn · ↵ mở · Esc đóng · Ctrl/⌘+K focus. Bỏ qua kết quả cũ (reqId) → nhanh, không nhấp nháy.
type Hit =
  | { kind: "page"; id: string; label: string; nav: string }
  | { kind: "quote"; id: number; code: string; title: string; status: string }
  | { kind: "customer"; id: number; code: string; name: string; sub: string }
  | { kind: "personnel"; id: number; name: string; sub: string };

function GlobalSearch({ me, query, setQuery, navItems }: { me: Me; query: string; setQuery: (v: string) => void; navItems: Nav[] }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [res, setRes] = useState<{ quotes: Hit[]; customers: Hit[]; personnel: Hit[] }>({ quotes: [], customers: [], personnel: [] });
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const reqId = useRef(0);
  const blurT = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hasOne = (perm: string) => me.permissions.includes(perm) || me.permissions.includes(perm.replace(/:own$/, ":all"));
  // perm có thể là 1 quyền HOẶC mảng (hiện nav nếu CÓ BẤT KỲ quyền nào) — vd Quản lý dự án: quote:create | invoice:read.
  const has = (perm?: string | string[]) => !perm || (Array.isArray(perm) ? perm.some(hasOne) : hasOne(perm));
  const canQuote = has("quote:read:own"), canCust = has("customer:read:own"), canPers = has("personnel:read:own");

  // Trang khớp (đi tới nhanh) — tức thì, không cần mạng. Chỉ các trang user thấy được.
  const pageHits: Hit[] = useMemo(() => {
    const nq = norm(query);
    if (nq.length < 1) return [];
    return navItems.filter((n) => norm(n.label).includes(nq)).slice(0, 4).map((n) => ({ kind: "page" as const, id: n.key, label: n.label, nav: n.key }));
  }, [query, navItems]);

  // Ctrl/⌘+K → focus + mở.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); inputRef.current?.focus(); inputRef.current?.select(); setOpen(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Gọi tìm đa thực thể (debounce 200ms). reqId chặn race; cleanup huỷ timer.
  useEffect(() => {
    const q = query.trim();
    if (!open || q.length < 2) { setRes({ quotes: [], customers: [], personnel: [] }); setLoading(false); return; }
    setLoading(true);
    const id = ++reqId.current;
    const t = setTimeout(async () => {
      try {
        const types = [canQuote ? "quote" : "", canCust ? "customer" : ""].filter(Boolean).join(",");
        const empty = { query: q, results: {} } as Awaited<ReturnType<typeof api.search>>;
        const [s, pers] = await Promise.all([
          types ? api.search(q, types, 6) : Promise.resolve(empty),
          canPers ? api.listPersonnel(q, 1, 5).catch(() => null) : Promise.resolve(null),
        ]);
        if (id !== reqId.current) return;
        const quotes: Hit[] = (s.results.quotes || []).map((x) => ({ kind: "quote", id: x.id, code: x.projectCode || x.quoteNumber || "—", title: x.title, status: x.status }));
        const customers: Hit[] = (s.results.customers || []).map((x) => ({ kind: "customer", id: x.id, code: x.code, name: x.name, sub: x.phone || x.email || "" }));
        const personnel: Hit[] = (pers?.data || []).slice(0, 5).map((x) => ({ kind: "personnel", id: Number(x.id), name: String(x.fullName), sub: [(x as Record<string, unknown>).projectName, (x as Record<string, unknown>).projectCode].filter(Boolean).join(" · ") }));
        setRes({ quotes, customers, personnel });
        setActive(0);
      } catch { if (id === reqId.current) setRes({ quotes: [], customers: [], personnel: [] }); }
      finally { if (id === reqId.current) setLoading(false); }
    }, 200);
    return () => clearTimeout(t);
  }, [query, open, canQuote, canCust, canPers]);

  const groups = [
    { title: "Đi tới trang", items: pageHits },
    { title: "Báo giá", items: res.quotes },
    { title: "Khách hàng", items: res.customers },
    { title: "Nhân sự", items: res.personnel },
  ].filter((g) => g.items.length > 0);
  const flat: Hit[] = groups.flatMap((g) => g.items);
  // ≥2 ký tự: luôn mở (kết quả / đang tìm / "không tìm thấy"). 1 ký tự: chỉ mở nếu có trang khớp.
  const showDrop = open && (query.trim().length >= 2 || flat.length > 0);

  const activate = async (h: Hit) => {
    if (!(await guardLeave())) return;
    setOpen(false);
    if (h.kind === "personnel") { setQuery(h.name); location.hash = "#/personnel"; return; }   // giữ query → trang Nhân sự tự lọc
    setQuery("");
    if (h.kind === "page") location.hash = `#/${h.nav}`;
    else if (h.kind === "quote") location.hash = `#/quotes/${h.id}`;
    else if (h.kind === "customer") location.hash = "#/customers";
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((a) => Math.min(Math.max(0, flat.length - 1), a + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === "Enter") { if (flat[active]) { e.preventDefault(); activate(flat[active]); } }
    else if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
  };

  const renderHit = (h: Hit) => {
    if (h.kind === "page") return <><span className="gs-ico" aria-hidden="true">{ICON[h.nav]}</span><span className="gs-label">{h.label}</span><span className="gs-tag">Trang</span></>;
    if (h.kind === "quote") return <><strong className="gs-code">{h.code}</strong><span className="gs-label">{h.title}</span><span className={`status ${h.status}`}>{QSTATUS[h.status] || h.status}</span></>;
    if (h.kind === "customer") return <><strong className="gs-code">{h.code}</strong><span className="gs-label">{h.name}</span>{h.sub && <span className="gs-sub">{h.sub}</span>}</>;
    return <><span className="gs-label"><strong>{h.name}</strong></span>{h.sub && <span className="gs-sub">{h.sub}</span>}</>;
  };

  let gi = -1;
  return (
    <div className="global-search" role="search" style={{ position: "relative" }}
         onBlur={() => { blurT.current = setTimeout(() => setOpen(false), 130); }}
         onFocus={() => { if (blurT.current) clearTimeout(blurT.current); if (query.trim().length >= 1) setOpen(true); }}>
      <label htmlFor="gs-input" className="sr-only">Tìm trang, nhân sự, báo giá, khách hàng</label>
      <input id="gs-input" ref={inputRef} placeholder="🔎 Tìm mọi thứ… (Ctrl+K)" value={query} autoComplete="off"
             role="combobox" aria-expanded={showDrop} aria-controls="gs-listbox"
             onChange={(e) => { setQuery(e.target.value); setOpen(true); }} onKeyDown={onKeyDown} />
      {showDrop && (
        <div className="global-search-results" id="gs-listbox" role="listbox" onMouseDown={(e) => e.preventDefault()}>
          {flat.length === 0 && loading && <div className="gs-row gs-empty">Đang tìm…</div>}
          {flat.length === 0 && !loading && <div className="gs-row gs-empty">Không tìm thấy “{query.trim()}”.</div>}
          {groups.map((g) => (
            <div key={g.title}>
              <div className="gs-section">{g.title}</div>
              {g.items.map((h) => {
                gi++; const i = gi; const on = i === active;
                return (
                  <div key={`${h.kind}-${"id" in h ? h.id : ""}-${i}`} className={`gs-row ${on ? "active" : ""}`} role="option" aria-selected={on}
                       onMouseEnter={() => setActive(i)} onClick={() => activate(h)}>{renderHit(h)}</div>
                );
              })}
            </div>
          ))}
          <div className="gs-foot"><span>↑↓ chọn</span><span>↵ mở</span><span>esc đóng</span></div>
        </div>
      )}
    </div>
  );
}

export function Shell({ me, onMe }: { me: Me; onMe: (m: Me) => void }) {
  const [key, setKey] = useState(currentKey());
  const [query, setQuery] = useState("");
  const [theme, setTheme] = useState(themeIcon());
  const [sbOpen, setSbOpen] = useState(false); // drawer mobile
  const [unread, setUnread] = useState(0);

  const refreshBadge = () => { api.unreadCount().then((r) => setUnread(r.count || 0)).catch(() => {}); };

  useEffect(() => {
    // Trang đích: GIỮ Nhân sự làm cửa vào (chủ đích HR-first của app "Quản Lý") cho ai CÓ quyền HR;
    // ai KHÔNG có (vd account_hn) thì rơi về nav đầu tiên có quyền → không bị ép vào trang 403.
    if (!location.hash) {
      const canHr = me.permissions.includes("personnel:read:own") || me.permissions.includes("personnel:read:all");
      const first = NAV.find((n) => has(n.perm));
      location.hash = "#/" + (canHr ? "personnel" : (first?.key || "list"));
    }
    refreshBadge();
    const on = () => { setKey(currentKey()); setSbOpen(false); refreshBadge(); };
    window.addEventListener("hashchange", on);
    // Esc đóng drawer mobile (Ctrl/⌘+K focus ô tìm do GlobalSearch tự xử lý).
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSbOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("hashchange", on); window.removeEventListener("keydown", onKey); };
  }, []);

  // SSE realtime (như SPA startSSE): thông báo→badge+refresh list; đổi quyền→pull /me; KHÓA/XÓA tài
  // khoản→ép ĐĂNG XUẤT ngay (bảo mật phiên); thay đổi dữ liệu→bắn event cho trang đang mở.
  useEffect(() => {
    let es: EventSource | null = null;
    try {
      es = new EventSource("/api/stream/events");
      es.addEventListener("notification", () => { refreshBadge(); window.dispatchEvent(new Event("realtime:notification")); });
      es.addEventListener("changed", () => { window.dispatchEvent(new Event("realtime:changed")); });
      es.addEventListener("presence", (e) => { try { window.dispatchEvent(new CustomEvent("realtime:presence", { detail: JSON.parse((e as MessageEvent).data) })); } catch { /* ignore */ } });
      es.addEventListener("session:refresh", () => { api.me().then((m) => onMe(m)).catch(() => { /* ignore */ }); });
      es.addEventListener("session:revoked", async () => { try { await api.logout(); } catch { /* ignore */ } location.reload(); });
    } catch { /* ignore */ }
    return () => { es?.close(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasOne = (perm: string) => me.permissions.includes(perm) || me.permissions.includes(perm.replace(/:own$/, ":all"));
  const has = (perm?: string | string[]) => !perm || (Array.isArray(perm) ? perm.some(hasOne) : hasOne(perm));
  const visible = NAV.filter((n) => has(n.perm));
  const groups = [...new Set(visible.map((n) => n.group))];
  const active = NAV.find((n) => n.key === key);
  const onTheme = () => { toggleTheme(); setTheme(themeIcon()); };
  // FLIP: #/quotes/:id (SỬA báo giá đã có) giờ dùng React editor. NGOẠI LỆ: account_hn giữ view
  // fill-HN của SPA qua iframe. #/new (TẠO mới) tạm giữ wizard SPA (chọn công ty/mẫu/khách) — sẽ port
  // sau. #/redit + #/rnew là alias test → luôn React.
  const isAccountHn = me.permissions.includes("quote:hn:fill"); // người ĐIỀN HN (theo quyền, không role cứng) → view lược HN
  // Tài khoản "chi phí" (quote:internal:view) → mở báo giá CHỈ thấy bảng nội bộ (server lược). account_hn ưu tiên.
  const isInternalViewer = me.permissions.includes("quote:internal:view") && !isAccountHn;
  const reditM = key.match(/^redit\/(\d+)$/);
  const quotesM = key.match(/^quotes\/(\d+)$/);
  const isNewEditor = key === "rnew";
  const editId = reditM ? Number(reditM[1]) : (quotesM && !isAccountHn && !isInternalViewer ? Number(quotesM[1]) : undefined);
  const isEditor = isNewEditor || editId !== undefined;
  const isWizard = key === "new" && !isAccountHn && !isInternalViewer;   // Tạo báo giá mới → wizard React
  const hnEditId = isAccountHn && quotesM ? Number(quotesM[1]) : undefined;   // account_hn mở BG → view điền HN React
  const internalViewId = isInternalViewer && quotesM ? Number(quotesM[1]) : undefined;   // chi phí mở BG → view chỉ-nội-bộ

  return (
    <>
      <a href="#main" className="skip-link">Bỏ qua tới nội dung</a>
      <div className="shell">
        <header className="mobile-topbar" role="banner">
          <button className="icon-btn" aria-label="Mở menu" aria-expanded={sbOpen} onClick={() => setSbOpen(true)}>☰</button>
          <span className="mt-title">{active?.label ?? "Quản Lý"}</span>
          <button className="icon-btn" aria-label="Đổi giao diện sáng/tối" onClick={onTheme}>{theme}</button>
        </header>
        <div className={`sidebar-backdrop${sbOpen ? " show" : ""}`} onClick={() => setSbOpen(false)} />
        <aside className={`sidebar${sbOpen ? " open" : ""}`} id="sidebar">
          <div className="sb-head">
            <div className="sb-brand">
              <div className="sb-logo" aria-hidden="true">GN</div>
              <div><h2>Quản Lý</h2><div className="org">Gia Nguyễn · nội bộ</div></div>
            </div>
            <button className="icon-btn" aria-label="Đổi giao diện sáng/tối" title="Sáng / Tối" onClick={onTheme}>{theme}</button>
          </div>
          <GlobalSearch me={me} query={query} setQuery={setQuery} navItems={visible} />
          <nav className="menu" aria-label="Điều hướng chính">
            {groups.map((g, gi) => (
              <div key={g}>
                <div className={`nav-group-label ${gi === 0 ? "first" : ""}`}>{g}</div>
                {visible.filter((n) => n.group === g).map((n) => (
                  <a key={n.key} className={key === n.key ? "active" : ""} href={`#/${n.key}`} {...(key === n.key ? { "aria-current": "page" as const } : {})}
                     onClick={async (e) => { e.preventDefault(); if (await guardLeave()) location.hash = `#/${n.key}`; }}>
                    {ICON[n.key]}<span>{n.label}</span>
                    {n.key === "notifications" && unread > 0 && <span className="badge-num" aria-label={`${unread} chưa đọc`}>{unread}</span>}
                  </a>
                ))}
              </div>
            ))}
          </nav>
          <div className="who">
            <strong>{me.displayName}</strong>
            <span>@{me.username}</span><br />
            <span className="role-pill">{ROLE_LABEL[me.role] ?? me.role}</span>
            <button className="logout" onClick={async () => { if (!(await guardLeave())) return; try { await api.logout(); } catch { /* ignore */ } location.reload(); }}>Đăng xuất</button>
          </div>
        </aside>
        {isWizard ? (
          <main className="main" id="main" tabIndex={-1}><LazyBoundary><NewQuoteWizard me={me} /></LazyBoundary></main>
        ) : hnEditId !== undefined ? (
          <main className="main" id="main" tabIndex={-1}><LazyBoundary><AccountHnView quoteId={hnEditId} /></LazyBoundary></main>
        ) : internalViewId !== undefined ? (
          <main className="main" id="main" tabIndex={-1}><LazyBoundary><InternalQuoteView quoteId={internalViewId} me={me} /></LazyBoundary></main>
        ) : isEditor ? (
          <main className="main" id="main" tabIndex={-1}>
            <LazyBoundary><QuoteEditorPage me={me} isNew={isNewEditor} quoteId={editId} /></LazyBoundary>
          </main>
        ) : active?.ported ? (
          <main className="main" id="main" tabIndex={-1}>
            {key === "dashboard" ? <DashboardPage me={me} />
              : key === "list" ? <QuoteListPage me={me} />
              : key === "customers" ? <CustomersPage me={me} />
              : key === "users" ? <UsersPage me={me} />
              : key === "audit" ? <AuditPage />
              : key === "permissions" ? <PermissionsPage me={me} />
              : key === "projects" ? <ProjectsPage me={me} />
              : key === "profile" ? <ProfilePage me={me} onMe={onMe} />
              : key === "notifications" ? <NotificationsPage onBadge={refreshBadge} />
              : key === "employees" ? <EmployeesPage me={me} query={query} />
              : <PersonnelPage me={me} query={query} />}
          </main>
        ) : (
          <div className="embed-host" id="main">
            <iframe key={key} title={active?.label ?? "Trang"} src={`/app?embed=1#/${key}`} />
          </div>
        )}
      </div>
    </>
  );
}
