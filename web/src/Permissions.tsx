import { Fragment, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type Me, type PermCatalog, type User } from "./api";
import { toast, confirmModal } from "./ui";

// "Phân quyền" — (1) ma trận Vai trò × Khả năng SỬA ĐƯỢC (phân quyền ĐỘNG): admin tick/bỏ quyền cho
// từng vai trò rồi Lưu; 'admin' KHÓA (luôn đủ quyền). (2) gán vai trò cho từng nhân viên.
// Bảo mật: gate user:manage (server); 'admin' không sửa được; không đổi vai trò của chính mình.
export function PermissionsPage({ me }: { me: Me }) {
  const qc = useQueryClient();
  const { data, isPending, error, refetch } = useQuery({
    queryKey: ["permissions"],
    queryFn: async () => {
      const [c, u] = await Promise.all([api.permissionsCatalog(), api.listUsers()]);
      return { cat: c, users: u };
    },
  });
  const cat = data?.cat ?? null;
  const users = data?.users ?? [];
  const loading = isPending;
  const err = error ? (error instanceof ApiError ? error.message : "Lỗi tải dữ liệu") : "";

  // Bản nháp quyền đang sửa (theo vai trò) — seed từ catalog, cho tick/bỏ trước khi Lưu.
  const [draft, setDraft] = useState<Record<string, Set<string>>>({});
  const [busyRole, setBusyRole] = useState<string | null>(null);
  useEffect(() => {
    if (cat) setDraft(Object.fromEntries(cat.roles.map((r) => [r.key, new Set(r.permissions)])));
  }, [cat]);

  const editableSet = new Set(cat?.editableRoles ?? []);
  const toggle = (role: string, perm: string) => {
    if (!editableSet.has(role)) return;
    setDraft((d) => {
      const s = new Set(d[role] ?? []);
      if (s.has(perm)) s.delete(perm); else s.add(perm);
      return { ...d, [role]: s };
    });
  };
  const isDirty = (role: string) => {
    const orig = new Set(cat?.roles.find((r) => r.key === role)?.permissions ?? []);
    const cur = draft[role] ?? new Set<string>();
    return orig.size !== cur.size || [...cur].some((p) => !orig.has(p));
  };
  const save = async (role: string) => {
    setBusyRole(role);
    try {
      await api.setRolePermissions(role, [...(draft[role] ?? [])]);
      toast(`Đã lưu quyền vai trò "${role}"`, "success");
      await refetch();
    } catch (ex) { toast(ex instanceof ApiError ? ex.message : "Lỗi lưu quyền", "error"); }
    finally { setBusyRole(null); }
  };
  const reset = async (role: string) => {
    if (!(await confirmModal("Đặt lại mặc định", `Khôi phục quyền vai trò "${role}" về mặc định gốc? Mọi tùy chỉnh sẽ mất.`, { danger: true, confirmText: "Đặt lại" }))) return;
    setBusyRole(role);
    try { await api.resetRolePermissions(role); toast("Đã đặt lại về mặc định", "success"); await refetch(); }
    catch (ex) { toast(ex instanceof ApiError ? ex.message : "Lỗi", "error"); }
    finally { setBusyRole(null); }
  };

  const onChangeRole = async (u: User, role: string) => {
    try {
      await api.updateUser(u.id, { role });
      toast("Đã cập nhật vai trò", "success");
      qc.setQueryData(["permissions"], (old: { cat: PermCatalog; users: User[] } | undefined) =>
        old ? { ...old, users: old.users.map((x) => x.id === u.id ? { ...x, role } : x) } : old);
    }
    catch (ex) { toast(ex instanceof ApiError ? ex.message : "Lỗi", "error"); qc.invalidateQueries({ queryKey: ["permissions"] }); }
  };

  if (err) return <div><h1>Phân quyền</h1><div className="err">⚠ {err} <button className="btn btn-sm" onClick={() => refetch()}>Thử lại</button></div></div>;
  if (loading || !cat) return <div><h1>Phân quyền</h1><div className="skeleton-wrap">{Array.from({ length: 6 }).map((_, i) => <div className="skeleton-row" key={i} />)}</div></div>;

  return (
    <div>
      <h1>Phân quyền</h1>
      <p className="muted" style={{ margin: "-8px 0 16px" }}>
        Tick/bỏ quyền cho từng vai trò rồi bấm <b>Lưu</b> (có hiệu lực ngay cho người đang đăng nhập). Vai trò <b>admin</b> luôn đủ quyền — không sửa được.
      </p>

      <div className="list-wrap">
        <table className="perm-matrix">
          <thead>
            <tr>
              <th>Quyền</th>
              {cat.roles.map((r) => (
                <th key={r.key}>
                  <div className="role-head">
                    <span>{r.label}{r.overridden && <span className="rh-pill" title="Đang khác mặc định gốc" style={{ marginLeft: 4 }}>tùy chỉnh</span>}</span>
                    <span className="rh-pill">{r.key}</span>
                    {editableSet.has(r.key) ? (
                      <div style={{ display: "flex", gap: 4, marginTop: 4, justifyContent: "center" }}>
                        <button className="btn btn-sm" disabled={!isDirty(r.key) || busyRole === r.key} onClick={() => save(r.key)}>Lưu</button>
                        {r.overridden && <button className="btn btn-sm" disabled={busyRole === r.key} onClick={() => reset(r.key)} title="Đặt lại về mặc định">↺</button>}
                      </div>
                    ) : <div className="rh-pill" style={{ marginTop: 4, opacity: 0.7 }}>khóa</div>}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cat.groups.map((g) => (
              <Fragment key={g.label}>
                <tr className="perm-group-row"><td colSpan={cat.roles.length + 1}>{g.label}</td></tr>
                {g.perms.map((p) => (
                  <tr key={p.key}>
                    <td className="col-perm">{p.label} <span className="muted">{p.key}</span></td>
                    {cat.roles.map((r) => {
                      const editable = editableSet.has(r.key);
                      const checked = (draft[r.key] ?? new Set()).has(p.key);
                      return (
                        <td className="col-role" key={r.key}>
                          {editable
                            ? <input type="checkbox" checked={checked} onChange={() => toggle(r.key, p.key)} aria-label={`${r.label} – ${p.label}`} />
                            : (checked ? <span className="perm-yes">✓</span> : <span className="perm-no">–</span>)}
                        </td>
                      );
                    })}
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
