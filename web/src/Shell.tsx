import { useState, useEffect, useRef, type ReactNode } from "react";
import { api, type Me } from "./api";
import { PersonnelPage } from "./Personnel";
import { EmployeesPage } from "./Employees";
import { CustomersPage } from "./Customers";
import { UsersPage } from "./Users";

const ROLE_LABEL: Record<string, string> = {
  admin: "Quản trị", manager: "Account", account_hn: "Account HN", hr: "Nhân sự", accountant: "Kế toán",
};

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
  { key: "dashboard", label: "Tổng quan", group: "Công việc", perm: "quote:read:own" },
  { key: "list", label: "Danh sách báo giá", group: "Công việc", perm: "quote:read:own" },
  { key: "new", label: "Tạo báo giá", group: "Công việc", perm: "quote:create" },
  { key: "customers", label: "Mã khách hàng", group: "Công việc", perm: "customer:read:own", ported: true },
  { key: "notifications", label: "Thông báo", group: "Công việc" },
  { key: "projects", label: "Quản lý dự án", group: "Quản trị", perm: "quote:read:own" },
  { key: "users", label: "Quản lý nhân viên", group: "Quản trị", perm: "user:manage", ported: true },
  { key: "permissions", label: "Phân quyền", group: "Quản trị", perm: "user:manage" },
  { key: "audit", label: "Nhật ký hoạt động", group: "Quản trị", perm: "audit:view" },
  { key: "profile", label: "Tài khoản", group: "Tài khoản" },
];

const currentKey = () => location.hash.replace(/^#\/?/, "") || "personnel";

export function Shell({ me }: { me: Me }) {
  const [key, setKey] = useState(currentKey());
  const [query, setQuery] = useState("");
  const [theme, setTheme] = useState(themeIcon());
  const [sbOpen, setSbOpen] = useState(false); // drawer mobile
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!location.hash) location.hash = "#/personnel";
    const on = () => { setKey(currentKey()); setSbOpen(false); };
    window.addEventListener("hashchange", on);
    // Ctrl/Cmd+K focuses the search box (placeholder advertises it — giờ là thật).
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); searchRef.current?.focus(); searchRef.current?.select(); }
      if (e.key === "Escape") setSbOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("hashchange", on); window.removeEventListener("keydown", onKey); };
  }, []);

  const has = (perm?: string) =>
    !perm || me.permissions.includes(perm) || me.permissions.includes(perm.replace(/:own$/, ":all"));
  const visible = NAV.filter((n) => has(n.perm));
  const groups = [...new Set(visible.map((n) => n.group))];
  const active = NAV.find((n) => n.key === key);
  const onTheme = () => { toggleTheme(); setTheme(themeIcon()); };

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
          <div className="global-search" role="search">
            <label htmlFor="gs-input" className="sr-only">Tìm nhân sự / danh bạ</label>
            <input id="gs-input" ref={searchRef} placeholder="🔎 Tìm nhân sự, danh bạ… (Ctrl+K)" value={query}
                   onChange={(e) => { const v = e.target.value; setQuery(v); if (v && currentKey() !== "personnel" && currentKey() !== "employees") location.hash = "#/personnel"; }} />
          </div>
          <nav className="menu" aria-label="Điều hướng chính">
            {groups.map((g, gi) => (
              <div key={g}>
                <div className={`nav-group-label ${gi === 0 ? "first" : ""}`}>{g}</div>
                {visible.filter((n) => n.group === g).map((n) => (
                  <a key={n.key} className={key === n.key ? "active" : ""} href={`#/${n.key}`} {...(key === n.key ? { "aria-current": "page" as const } : {})}
                     onClick={(e) => { e.preventDefault(); location.hash = `#/${n.key}`; }}>
                    {ICON[n.key]}<span>{n.label}</span>
                  </a>
                ))}
              </div>
            ))}
          </nav>
          <div className="who">
            <strong>{me.displayName}</strong>
            <span>@{me.username}</span><br />
            <span className="role-pill">{ROLE_LABEL[me.role] ?? me.role}</span>
            <button className="logout" onClick={async () => { try { await api.logout(); } catch { /* ignore */ } location.reload(); }}>Đăng xuất</button>
          </div>
        </aside>
        {active?.ported ? (
          <main className="main" id="main" tabIndex={-1}>
            {key === "customers" ? <CustomersPage me={me} />
              : key === "users" ? <UsersPage me={me} />
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
