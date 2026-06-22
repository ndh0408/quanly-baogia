import { useEffect, useState } from "react";
import { api, type Me } from "./api";
import { PersonnelPage } from "./Personnel";

const ROLE_LABEL: Record<string, string> = {
  admin: "Quản trị", manager: "Account", account_hn: "Account HN", hr: "Nhân sự", accountant: "Kế toán",
};

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
        </div>
        <nav>
          {groups.map((g) => (
            <div className="nav-group" key={g}>
              <div className="nav-group-label">{g}</div>
              {visible.filter((n) => n.group === g).map((n) => (
                <a key={n.key} className={`nav-item ${key === n.key ? "active" : ""}`} href={`#/${n.key}`}
                   onClick={(e) => { e.preventDefault(); location.hash = `#/${n.key}`; }}>
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
