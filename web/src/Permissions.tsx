import { Fragment, useCallback, useEffect, useState } from "react";
import { api, ApiError, type Me, type PermCatalog, type User } from "./api";
import { toast } from "./ui";

// Port "Phân quyền" (renderPermissions) — bê ĐẦY ĐỦ: (1) ma trận Vai trò × Khả năng (read-only,
// cấu hình cố định) + (2) gán vai trò cho từng nhân viên (đổi dropdown → PUT role). Dùng class
// .perm-matrix/.list-table của SPA. Bảo mật: gate user:manage; không đổi vai trò của chính mình.
export function PermissionsPage({ me }: { me: Me }) {
  const [cat, setCat] = useState<PermCatalog | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setErr("");
    try {
      const [c, u] = await Promise.all([api.permissionsCatalog(), api.listUsers()]);
      setCat(c); setUsers(u);
    } catch (ex) { setErr(ex instanceof ApiError ? ex.message : "Lỗi tải dữ liệu"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const onChangeRole = async (u: User, role: string) => {
    try { await api.updateUser(u.id, { role }); toast("Đã cập nhật vai trò", "success"); setUsers((us) => us.map((x) => x.id === u.id ? { ...x, role } : x)); }
    catch (ex) { toast(ex instanceof ApiError ? ex.message : "Lỗi", "error"); load(); }
  };

  if (err) return <div><h1>Phân quyền</h1><div className="err">⚠ {err} <button className="btn btn-sm" onClick={load}>Thử lại</button></div></div>;
  if (loading || !cat) return <div><h1>Phân quyền</h1><div className="skeleton-wrap">{Array.from({ length: 6 }).map((_, i) => <div className="skeleton-row" key={i} />)}</div></div>;

  const rolePerms = Object.fromEntries(cat.roles.map((r) => [r.key, new Set(r.permissions)]));

  return (
    <div>
      <h1>Phân quyền</h1>
      <p className="muted" style={{ margin: "-8px 0 16px" }}>Vai trò → khả năng (cấu hình cố định, an toàn). Bên dưới: gán vai trò cho từng nhân viên.</p>

      <div className="list-wrap">
        <table className="perm-matrix">
          <thead>
            <tr>
              <th>Quyền</th>
              {cat.roles.map((r) => <th key={r.key}><div className="role-head"><span>{r.label}</span><span className="rh-pill">{r.key}</span></div></th>)}
            </tr>
          </thead>
          <tbody>
            {cat.groups.map((g) => (
              <Fragment key={g.label}>
                <tr className="perm-group-row"><td colSpan={cat.roles.length + 1}>{g.label}</td></tr>
                {g.perms.map((p) => (
                  <tr key={p.key}>
                    <td className="col-perm">{p.label} <span className="muted">{p.key}</span></td>
                    {cat.roles.map((r) => (
                      <td className="col-role" key={r.key}>{rolePerms[r.key].has(p.key) ? <span className="perm-yes">✓</span> : <span className="perm-no">–</span>}</td>
                    ))}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <h3 style={{ marginTop: 26 }}>Gán vai trò nhân viên</h3>
      <div className="list-wrap">
        <table className="list-table">
          <thead><tr><th>Nhân viên</th><th>Username</th><th>Vai trò</th><th>Trạng thái</th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.displayName}</td>
                <td>{u.username}</td>
                <td>
                  <select value={u.role} disabled={u.id === me.id} title={u.id === me.id ? "Không thể đổi vai trò của chính bạn" : undefined}
                          onChange={(e) => onChangeRole(u, e.target.value)}>
                    {cat.roles.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
                  </select>
                </td>
                <td>{u.active ? <span className="status approved">Hoạt động</span> : <span className="status rejected">Khóa</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
