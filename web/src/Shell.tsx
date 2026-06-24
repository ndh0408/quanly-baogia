import { useState, useEffect, useRef, type ReactNode } from "react";
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
import { QuoteEditorPage } from "./QuoteEditor";

const ROLE_LABEL: Record<string, string> = {
  admin: "Quản trị", manager: "Account", account_hn: "Account HN", hr: "Nhân sự", accountant: "Kế toán",
};
const QSTATUS: Record<string, string> = { draft: "Nháp", converted: "Đã chốt", lost: "Không chốt", pending: "Chờ duyệt", approved: "Đã duyệt", rejected: "Bị từ chối", sent: "Đã gửi" };
type QuoteHit = { id: number; quoteNumber?: string; projectCode?: string | null; title: string; status: string };

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
type Nav = { key: string; label: string; group: string; perm?: string; ported?: boolean };
const NAV: Nav[] = [
  { key: "personnel", label: "Nhân sự", group: "Công việc", perm: "personnel:read:own", ported: true },
  { key: "employees", label: "Danh bạ nhân viên", group: "Công việc", perm: "personnel:read:own", ported: true },
  { key: "dashboard", label: "Tổng quan", group: "Công việc", perm: "quote:read:own", ported: true },
  { key: "list", label: "Danh sách báo giá", group: "Công việc", perm: "quote:read:own", ported: true },
  { key: "new", label: "Tạo báo giá", group: "Công việc", perm: "quote:create" },
  { key: "customers", label: "Mã khách hàng", group: "Công việc", perm: "customer:read:own", ported: true },
  { key: "notifications", label: "Thông báo", group: "Công việc", ported: true },
  { key: "projects", label: "Quản lý dự án", group: "Quản trị", perm: "quote:read:own", ported: true },
  { key: "users", label: "Quản lý nhân viên", group: "Quản trị", perm: "user:manage", ported: true },
  { key: "permissions", label: "Phân quyền", group: "Quản trị", perm: "user:manage", ported: true },
  { key: "audit", label: "Nhật ký hoạt động", group: "Quản trị", perm: "audit:view", ported: true },
  { key: "profile", label: "Tài khoản", group: "Tài khoản", ported: true },
];

// Strip ?query (filters) khi khớp nav key → #/list?status=… vẫn là trang "list".
const currentKey = () => location.hash.replace(/^#\/?/, "").split("?")[0] || "personnel";

export function Shell({ me, onMe }: { me: Me; onMe: (m: Me) => void }) {
  const [key, setKey] = useState(currentKey());
  const [query, setQuery] = useState("");
  const [theme, setTheme] = useState(themeIcon());
  const [sbOpen, setSbOpen] = useState(false); // drawer mobile
  const [unread, setUnread] = useState(0);
  const [quoteHits, setQuoteHits] = useState<QuoteHit[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);

  // Tìm BÁO GIÁ toàn cục (song song lọc nhân sự) → dropdown deep-link #/quotes/:id.
  useEffect(() => {
    if (!query || query.trim().length < 2) { setQuoteHits([]); return; }
    const t = setTimeout(() => { api.searchQuotes(query.trim()).then((r) => setQuoteHits(r.results.quotes || [])).catch(() => setQuoteHits([])); }, 250);
    return () => clearTimeout(t);
  }, [query]);

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
    // Ctrl/Cmd+K focuses the search box (placeholder advertises it — giờ là thật).
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); searchRef.current?.focus(); searchRef.current?.select(); }
      if (e.key === "Escape") setSbOpen(false);
    };
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
      es.addEventListener("session:refresh", () => { api.me().then((m) => onMe(m)).catch(() => { /* ignore */ }); });
      es.addEventListener("session:revoked", async () => { try { await api.logout(); } catch { /* ignore */ } location.reload(); });
    } catch { /* ignore */ }
    return () => { es?.close(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const has = (perm?: string) =>
    !perm || me.permissions.includes(perm) || me.permissions.includes(perm.replace(/:own$/, ":all"));
  const visible = NAV.filter((n) => has(n.perm));
  const groups = [...new Set(visible.map((n) => n.group))];
  const active = NAV.find((n) => n.key === key);
  const onTheme = () => { toggleTheme(); setTheme(themeIcon()); };
  // FLIP: #/quotes/:id (SỬA báo giá đã có) giờ dùng React editor. NGOẠI LỆ: account_hn giữ view
  // fill-HN của SPA qua iframe. #/new (TẠO mới) tạm giữ wizard SPA (chọn công ty/mẫu/khách) — sẽ port
  // sau. #/redit + #/rnew là alias test → luôn React.
  const isAccountHn = me.role === "account_hn";
  const reditM = key.match(/^redit\/(\d+)$/);
  const quotesM = key.match(/^quotes\/(\d+)$/);
  const isNewEditor = key === "rnew";
  const editId = reditM ? Number(reditM[1]) : (quotesM && !isAccountHn ? Number(quotesM[1]) : undefined);
  const isEditor = isNewEditor || editId !== undefined;

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
          <div className="global-search" role="search" style={{ position: "relative" }}>
            <label htmlFor="gs-input" className="sr-only">Tìm nhân sự / báo giá</label>
            <input id="gs-input" ref={searchRef} placeholder="🔎 Tìm nhân sự, báo giá… (Ctrl+K)" value={query} autoComplete="off"
                   onChange={(e) => { const v = e.target.value; setQuery(v); if (v && currentKey() !== "personnel" && currentKey() !== "employees") location.hash = "#/personnel"; }} />
            {quoteHits.length > 0 && (
              <div className="gs-results" style={{ display: "block" }}>
                <div className="gs-section">Báo giá</div>
                {quoteHits.map((h) => (
                  <div key={h.id} className="gs-row" role="button" tabIndex={0}
                       onClick={async () => { if (await guardLeave()) { setQuery(""); setQuoteHits([]); location.hash = "#/quotes/" + h.id; } }}>
                    <strong>{h.projectCode || h.quoteNumber}</strong> — {h.title} <span className={`status ${h.status}`}>{QSTATUS[h.status] || h.status}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
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
        {isEditor ? (
          <main className="main" id="main" tabIndex={-1}>
            <QuoteEditorPage me={me} isNew={isNewEditor} quoteId={editId} />
          </main>
        ) : active?.ported ? (
          <main className="main" id="main" tabIndex={-1}>
            {key === "dashboard" ? <DashboardPage />
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
