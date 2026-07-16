import { Fragment, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Me, type PermCatalog, type User } from "../lib/api";
import { errMsg } from "../lib/format";
import { toast, confirmModal } from "../lib/ui";

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
  const err = error ? errMsg(error, "Lỗi tải dữ liệu") : "";

  // Bản nháp quyền đang sửa (theo vai trò) — seed từ catalog, cho tick/bỏ trước khi Lưu.
  const [draft, setDraft] = useState<Record<string, Set<string>>>({});
  const [busyRole, setBusyRole] = useState<string | null>(null);
  const [q, setQ] = useState(""); // lọc nhanh bảng nhân viên theo tên/username
  useEffect(() => {
    if (!cat) return;
    // Merge thay vì ghi đè: giữ nguyên tick chưa lưu (role đang dirty), chỉ reseed role không dirty
    // — tránh mất tick khi refetch sau Lưu 1 role khác / invalidate nền.
    setDraft((d) =>
      Object.fromEntries(cat.roles.map((r) => {
        const cur = d[r.key];
        const orig = new Set(r.permissions);
        const dirty = cur != null && (cur.size !== orig.size || [...cur].some((p) => !orig.has(p)));
        return [r.key, dirty ? cur : orig];
      })));
  }, [cat]);

  const editableSet = new Set(cat?.editableRoles ?? []);
  const adminOnly = new Set(cat?.adminOnlyPermissions ?? []); // quyền chỉ-admin: KHÓA, không tick được
  const toggle = (role: string, perm: string) => {
    if (!editableSet.has(role) || adminOnly.has(perm)) return;
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
    } catch (ex) { toast(errMsg(ex, "Lỗi lưu quyền"), "error"); }
    finally { setBusyRole(null); }
  };
  const reset = async (role: string) => {
    if (!(await confirmModal("Đặt lại mặc định", `Khôi phục quyền vai trò "${role}" về mặc định gốc? Mọi tùy chỉnh sẽ mất.`, { danger: true, confirmText: "Đặt lại" }))) return;
    setBusyRole(role);
    try { await api.resetRolePermissions(role); toast("Đã đặt lại về mặc định", "success"); await refetch(); }
    catch (ex) { toast(errMsg(ex, "Lỗi"), "error"); }
    finally { setBusyRole(null); }
  };

  const onChangeRole = async (u: User, role: string, el: HTMLSelectElement) => {
    const label = cat?.roles.find((r) => r.key === role)?.label ?? role;
    if (!(await confirmModal("Đổi vai trò", `Đổi vai trò của "${u.displayName}" thành "${label}"?`))) {
      el.value = u.role; // hủy → trả select về giá trị cũ
      return;
    }
    try {
      await api.updateUser(u.id, { role });
      toast("Đã cập nhật vai trò", "success");
      qc.setQueryData(["permissions"], (old: { cat: PermCatalog; users: User[] } | undefined) =>
        old ? { ...old, users: old.users.map((x) => x.id === u.id ? { ...x, role } : x) } : old);
    }
    catch (ex) { toast(errMsg(ex, "Lỗi"), "error"); qc.invalidateQueries({ queryKey: ["permissions"] }); }
  };

  if (err) return <div><h1>Phân quyền</h1><div className="err">⚠ {err} <button className="btn btn-sm" onClick={() => refetch()}>Thử lại</button></div></div>;
  if (loading || !cat) return <div><h1>Phân quyền</h1><div className="skeleton-wrap">{Array.from({ length: 6 }).map((_, i) => <div className="skeleton-row" key={i} />)}</div></div>;

  const qn = q.trim().toLowerCase();
  const shownUsers = qn
    ? users.filter((u) => u.displayName.toLowerCase().includes(qn) || u.username.toLowerCase().includes(qn))
    : users;

  return (
    <div>
      <h1>Phân quyền</h1>
      <p className="muted page-sub">
        Tick/bỏ quyền cho từng vai trò rồi bấm <b>Lưu</b> (có hiệu lực ngay cho người đang đăng nhập). Vai trò <b>admin</b> luôn đủ quyền — không sửa được.
      </p>

      <div className="list-wrap">
        <table className="perm-matrix">
          <thead>
            <tr>
              <th scope="col">Quyền</th>
              {cat.roles.map((r) => (
                <th scope="col" key={r.key}>
                  <div className="role-head">
                    <span>{r.label}{r.overridden && <span className="rh-pill" title="Đang khác mặc định gốc" style={{ marginLeft: 4 }}>tùy chỉnh</span>}</span>
                    <span className="rh-pill">{r.key}</span>
                    {editableSet.has(r.key) ? (
                      <div style={{ display: "flex", gap: 4, marginTop: 4, justifyContent: "center" }}>
                        <button className="btn btn-sm" disabled={!isDirty(r.key) || busyRole === r.key} onClick={() => save(r.key)}>{busyRole === r.key ? "Đang lưu…" : "Lưu"}</button>
                        {r.overridden && <button className="btn btn-sm" disabled={busyRole === r.key} onClick={() => reset(r.key)} title="Đặt lại về mặc định" aria-label="Đặt lại về mặc định">↺</button>}
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
                    <td className="col-perm">{p.label} <span className="muted">{p.key}</span>{adminOnly.has(p.key) && <span className="muted" title="Chỉ admin — không cấp động được cho vai trò khác"> 🔒</span>}</td>
                    {cat.roles.map((r) => {
                      const editable = editableSet.has(r.key) && !adminOnly.has(p.key); // admin-only → khóa
                      const checked = (draft[r.key] ?? new Set()).has(p.key);
                      return (
                        <td className="col-role" key={r.key}>
                          {editable
                            ? <input type="checkbox" checked={checked} onChange={() => toggle(r.key, p.key)} aria-label={`${r.label} – ${p.label}`} />
                            : (checked ? <span className="perm-yes" title="Có quyền" aria-label="Có quyền">✓</span> : <span className="perm-no" title="Không có quyền" aria-label="Không có quyền">–</span>)}
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
      <div style={{ display: "flex", gap: 8, alignItems: "center", margin: "8px 0" }}>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm theo tên hoặc username…" aria-label="Tìm nhân viên" />
        <button className="btn btn-sm btn-ghost" disabled={!q} onClick={() => setQ("")}>Xóa lọc</button>
      </div>
      <div className="list-wrap">
        <table className="list-table">
          <thead><tr><th scope="col">Nhân viên</th><th scope="col">Username</th><th scope="col">Vai trò</th><th scope="col">Trạng thái</th></tr></thead>
          <tbody>
            {shownUsers.length === 0 && (
              <tr><td colSpan={4} className="muted">{q ? "Không có nhân viên khớp bộ lọc" : "Chưa có nhân viên"}</td></tr>
            )}
            {shownUsers.map((u) => (
              <tr key={u.id}>
                <td>{u.displayName}</td>
                <td>{u.username}</td>
                <td>
                  <select value={u.role} disabled={u.id === me.id} aria-label={`Vai trò của ${u.displayName}`}
                          title={u.id === me.id ? "Không thể đổi vai trò của chính bạn" : undefined}
                          onChange={(e) => onChangeRole(u, e.target.value, e.target)}>
                    {cat.roles.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
                  </select>
                </td>
                <td>{u.active ? <span className="status approved">Hoạt động</span> : <span className="status rejected">Khóa</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {shownUsers.length > 0 && (
        <div className="list-foot">
          <span className="muted">{q ? `Hiển thị ${shownUsers.length} / ${users.length} nhân viên` : `Tổng ${users.length} nhân viên`}</span>
        </div>
      )}
    </div>
  );
}
