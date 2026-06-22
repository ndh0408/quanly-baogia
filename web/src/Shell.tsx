import { useState, useEffect, type ReactNode } from "react";
import { api, type Me } from "./api";
import { PersonnelPage } from "./Personnel";

const ROLE_LABEL: Record<string, string> = {
  admin: "Quản trị", manager: "Account", account_hn: "Account HN", hr: "Nhân sự", accountant: "Kế toán",
};

const S = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
const ICON: Record<string, ReactNode> = {
  personnel: <svg {...S}><circle cx="9" cy="8" r="3.2" /><path d="M3.5 20a5.5 5.5 0 0 1 11 0" /><path d="M16 5.2a3 3 0 0 1 0 5.6" /><path d="M17.5 20a5.5 5.5 0 0 0-3-4.9" /></svg>,
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

function ThemeToggle() {
  const [dark, setDark] = useState(() => document.documentElement.getAttribute("data-theme") === "dark");
  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.setAttribute("data-theme", next ? "dark" : "light");
    try { localStorage.setItem("theme", next ? "dark" : "light"); } catch { /* ignore */ }
  };
  return <button className="theme-toggle" onClick={toggle} title="Sáng / Tối" aria-label="Đổi giao diện sáng tối">{dark ? "☀" : "🌙"}</button>;
}

// Sidebar khớp app cũ. `ported`=true → trang React thật; còn lại hiện placeholder + nút mở bản cũ.
// `perm` để ẩn/hiện theo quyền (vd hr/accountant chỉ thấy Nhân sự + Tài khoản).
type Nav = { key: string; label: string; group: string; perm?: string; ported?: boolean; old?: string };
const NAV: Nav[] = [
  { key: "personnel", label: "Nhân sự", group: "Công việc", perm: "personnel:read:own", ported: true },
  { key: "dashboard", label: "Tổng quan", group: "Công việc", perm: "quote:read:own", old: "/app#/dashboard" },
  { key: "list", label: "Danh sách báo giá", group: "Công việc", perm: "quote:read:own", old: "/app#/list" },
  { key: "new", label: "Tạo báo giá", group: "Công việc", perm: "quote:create", old: "/app#/new" },
  { key: "customers", label: "Mã khách hàng", group: "Công việc", perm: "customer:read:own", old: "/app#/customers" },
  { key: "notifications", label: "Thông báo", group: "Công việc", old: "/app#/notifications" },
  { key: "projects", label: "Quản lý dự án", group: "Quản trị", perm: "quote:read:own", old: "/app#/projects" },
  { key: "users", label: "Quản lý nhân viên", group: "Quản trị", perm: "user:manage", old: "/app#/users" },
  { key: "permissions", label: "Phân quyền", group: "Quản trị", perm: "user:manage", old: "/app#/permissions" },
  { key: "audit", label: "Nhật ký hoạt động", group: "Quản trị", perm: "audit:view", old: "/app#/audit" },
  { key: "profile", label: "Tài khoản", group: "Tài khoản", old: "/app#/profile" },
];

const currentKey = () => location.hash.replace(/^#\/?/, "") || "personnel";

export function Shell({ me }: { me: Me }) {
  const [key, setKey] = useState(currentKey());
  useEffect(() => {
    if (!location.hash) location.hash = "#/personnel";
    const on = () => setKey(currentKey());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);

  const has = (perm?: string) =>
    !perm || me.permissions.includes(perm) || me.permissions.includes(perm.replace(/:own$/, ":all"));
  const visible = NAV.filter((n) => has(n.perm));
  const groups = [...new Set(visible.map((n) => n.group))];
  const active = NAV.find((n) => n.key === key);

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-logo">GN</span>
          <div><strong>Quản lý</strong><div className="muted sm">Gia Nguyễn · nội bộ</div></div>
          <ThemeToggle />
        </div>
        <nav>
          {groups.map((g) => (
            <div className="nav-group" key={g}>
              <div className="nav-group-label">{g}</div>
              {visible.filter((n) => n.group === g).map((n) => (
                <a key={n.key} className={`nav-item ${key === n.key ? "active" : ""}`} href={`#/${n.key}`}
                   onClick={(e) => { e.preventDefault(); location.hash = `#/${n.key}`; }}>
                  {ICON[n.key]}
                  {n.label}
                  {!n.ported && <span className="nav-ext" title="Chưa chuyển sang giao diện mới">•</span>}
                </a>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="su"><strong>{me.displayName}</strong><div className="muted sm">{ROLE_LABEL[me.role] ?? me.role}</div></div>
          <button className="btn btn-sm" onClick={async () => { try { await api.logout(); } catch { /* ignore */ } location.reload(); }}>Đăng xuất</button>
        </div>
      </aside>
      <main className="content">
        {active?.ported ? <PersonnelPage me={me} /> : <Placeholder nav={active} />}
      </main>
    </div>
  );
}

function Placeholder({ nav }: { nav: Nav | undefined }) {
  return (
    <div className="placeholder">
      <h2>{nav?.label ?? "Trang"}</h2>
      <p className="muted" style={{ maxWidth: 460, margin: "8px auto 0" }}>
        Trang này đang được chuyển sang giao diện mới (React). Trong lúc đó bạn dùng bản hiện tại — đầy đủ chức năng.
      </p>
      {nav?.old && <a className="btn btn-primary" href={nav.old}>Mở "{nav.label}" ở bản hiện tại →</a>}
    </div>
  );
}
