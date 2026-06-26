import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type Me, type User, type InviteResult, type PermCatalog } from "./api";
import { toast, confirmModal, fieldErrorsFrom } from "./ui";

// "Quản lý nhân viên": bảng + Mời (invite email) + Sửa + Khóa/Mở khóa + Gửi-lại / Hủy lời mời.
// PHÂN QUYỀN PER-USER: KHÔNG còn chọn "vai trò" — admin TÍCH QUYỀN cho từng tài khoản (preset điền nhanh).
// 1 tài khoản hoặc là "Toàn quyền quản trị" (admin) hoặc tích từng quyền cụ thể.
// CHÍNH SÁCH: KHÔNG đổi mật khẩu hộ (đã có "Quên mật khẩu") và KHÔNG xóa tài-khoản đã kích hoạt → nghỉ thì KHÓA.
const ROLE_LABEL: Record<string, string> = {
  manager: "Account", admin: "Quản trị", account_hn: "Account Hà Nội", hr: "Nhân sự", accountant: "Kế toán",
};

type Modal = { t: "invite" } | { t: "edit"; user: User } | { t: "result"; result: InviteResult };

export function UsersPage({ me }: { me: Me }) {
  const qc = useQueryClient();
  const [modal, setModal] = useState<Modal | null>(null);

  const { data, isPending, error, refetch } = useQuery({ queryKey: ["users"], queryFn: () => api.listUsers() });
  const { data: cat } = useQuery({ queryKey: ["perm-catalog"], queryFn: () => api.permissionsCatalog() });
  const rows = data ?? [];
  const loading = isPending;
  const err = error ? (error instanceof ApiError ? error.message : "Lỗi tải dữ liệu") : "";
  const load = useCallback(() => { qc.invalidateQueries({ queryKey: ["users"] }); }, [qc]);

  const onResend = async (u: User) => {
    try { const r = await api.resendInvite(u.id); setModal({ t: "result", result: { ...r, user: { email: u.email || "" } } }); }
    catch (ex) { toast(ex instanceof ApiError ? ex.message : "Lỗi", "error"); }
  };
  const onToggleLock = async (u: User) => {
    if (u.active && !(await confirmModal("Khóa tài khoản", `Khóa tài khoản "${u.displayName || u.username}"? Người này sẽ không đăng nhập được cho tới khi được mở khóa.`, { danger: true, confirmText: "Khóa" }))) return;
    try { await api.updateUser(u.id, { active: !u.active }); toast(u.active ? "Đã khóa tài khoản" : "Đã mở khóa tài khoản", "success"); load(); }
    catch (ex) { toast(ex instanceof ApiError ? ex.message : "Lỗi", "error"); }
  };
  const onCancelInvite = async (u: User) => {
    if (!(await confirmModal("Hủy lời mời", `Hủy lời mời tới "${u.email || u.displayName || u.username}"? Lời mời chưa kích hoạt sẽ bị gỡ.`, { danger: true, confirmText: "Hủy lời mời" }))) return;
    try { await api.deleteUser(u.id); toast("Đã hủy lời mời", "success"); load(); }
    catch (ex) { toast(ex instanceof ApiError ? ex.message : "Lỗi", "error"); }
  };

  const dash = <span className="muted">—</span>;
  // Nhãn cột "Quyền": admin = Quản trị; đã tùy biến = Tùy chỉnh; còn lại = preset gốc.
  const permLabel = (u: User) =>
    u.role === "admin" ? <span className="status approved">Quản trị</span>
    : u.permCustom ? <span className="status draft">Tùy chỉnh</span>
    : <span className="status pending">{ROLE_LABEL[u.role] ?? "Nhân viên"}</span>;

  return (
    <div>
      <h1>Quản lý nhân viên</h1>
      <div className="toolbar">
        <button className="btn btn-primary" onClick={() => setModal({ t: "invite" })}>+ Thêm nhân viên</button>
      </div>
      {err && <div className="err">⚠ {err} <button className="btn btn-sm" onClick={() => refetch()}>Thử lại</button></div>}
      {loading ? (
        <div className="skeleton-wrap">{Array.from({ length: 5 }).map((_, i) => <div className="skeleton-row" key={i} />)}</div>
      ) : (
        <div className="list-wrap">
          <table className="list-table">
            <thead><tr>
              <th>Tên đăng nhập</th><th>Họ tên</th><th>Mã dự án</th><th>Quyền</th><th>SĐT</th><th>Trạng thái</th><th style={{ textAlign: "right" }}>Thao tác</th>
            </tr></thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id}>
                  <td>{u.username}</td>
                  <td>{u.displayName}</td>
                  <td>{u.projectCode ? <strong>{u.projectCode}</strong> : dash}</td>
                  <td>{permLabel(u)}</td>
                  <td>{u.phone || dash}</td>
                  <td>{u.pending ? <span className="status pending">Chờ kích hoạt</span> : <span className={`status ${u.active ? "approved" : "rejected"}`}>{u.active ? "Hoạt động" : "Đã khóa"}</span>}</td>
                  <td className="row-actions" style={{ whiteSpace: "nowrap" }}>
                    {u.pending ? (
                      <>
                        <button className="btn btn-sm" onClick={() => onResend(u)}>Gửi lại lời mời</button>
                        {u.id !== me.id && <button className="btn btn-sm btn-danger" onClick={() => onCancelInvite(u)}>Hủy lời mời</button>}
                      </>
                    ) : (
                      <>
                        <button className="btn btn-sm" onClick={() => setModal({ t: "edit", user: u })}>Sửa</button>
                        <button className={`btn btn-sm ${u.active ? "btn-warn" : "btn-success"}`} onClick={() => onToggleLock(u)}>{u.active ? "Khóa" : "Mở khóa"}</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal?.t === "invite" && <InviteModal cat={cat} onClose={() => setModal(null)} onInvited={(r) => { setModal({ t: "result", result: r }); load(); }} />}
      {modal?.t === "edit" && <EditUserModal user={modal.user} cat={cat} onClose={() => setModal(null)} onSaved={() => { setModal(null); load(); }} />}
      {modal?.t === "result" && <InviteResultModal result={modal.result} onClose={() => setModal(null)} />}
    </div>
  );
}

function useEscClose(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
}

// Ma trận TÍCH QUYỀN per-user. Preset = điền nhanh theo mẫu (Account/Kế toán/…). Nhóm admin-tier bị KHÓA
// (chỉ tài khoản "Toàn quyền quản trị" mới có). isAdmin → ẩn ma trận (admin luôn full).
function PermMatrix({ cat, isAdmin, value, onChange }: { cat: PermCatalog; isAdmin: boolean; value: Set<string>; onChange: (s: Set<string>) => void; }) {
  if (isAdmin) return <p className="muted perm-admin-note">✅ Tài khoản <b>Quản trị</b> có <b>TOÀN QUYỀN</b> — không cần tích.</p>;
  const adminOnly = new Set(cat.adminOnlyPermissions);
  const inMatrix = new Set(cat.groups.flatMap((g) => g.perms.map((p) => p.key))); // chỉ quyền CÓ trong ma trận
  const toggle = (k: string) => { const n = new Set(value); n.has(k) ? n.delete(k) : n.add(k); onChange(n); };
  const applyPreset = (roleKey: string) => {
    const r = cat.roles.find((x) => x.key === roleKey);
    if (r) onChange(new Set(r.permissions.filter((p) => inMatrix.has(p) && !adminOnly.has(p)))); // bỏ quyền ẩn (vd product:*)
  };
  return (
    <div className="perm-pick">
      <div className="perm-presets">
        <span className="muted">Điền nhanh:</span>
        {cat.roles.filter((r) => r.key !== "admin").map((r) => (
          <button key={r.key} type="button" className="btn btn-xs btn-ghost" onClick={() => applyPreset(r.key)}>{r.label}</button>
        ))}
        <button type="button" className="btn btn-xs btn-ghost" onClick={() => onChange(new Set())}>Bỏ hết</button>
      </div>
      {cat.groups.map((g) => (
        <div className="perm-grp" key={g.key}>
          <div className="perm-grp-label">{g.label}</div>
          <div className="perm-grp-items">
            {g.perms.map((p) => {
              const locked = adminOnly.has(p.key);
              return (
                <label key={p.key} className={`perm-item${locked ? " locked" : ""}`} title={locked ? "Chỉ tài khoản Quản trị mới có" : (p.desc || p.key)}>
                  <input type="checkbox" disabled={locked} checked={!locked && value.has(p.key)} onChange={() => toggle(p.key)} />
                  <span className="perm-item-txt">
                    <span className="perm-item-label">{p.label}{locked && " 🔒"}</span>
                    {p.desc && <span className="perm-item-desc">{p.desc}</span>}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// Trang nào hiện theo quyền nào (khớp NAV ở Shell) — để PREVIEW "tài khoản này thấy trang gì".
const PAGE_PERMS: { label: string; perm: string[] }[] = [
  { label: "Tổng quan", perm: ["quote:create"] },
  { label: "Danh sách báo giá", perm: ["quote:read:own"] },
  { label: "Tạo báo giá", perm: ["quote:create"] },
  { label: "Mã khách hàng", perm: ["customer:read:own"] },
  { label: "Nhân sự", perm: ["personnel:read:own"] },
  { label: "Danh bạ nhân sự", perm: ["personnel:read:own"] },
  { label: "Quản lý dự án", perm: ["quote:create", "invoice:read"] },
  { label: "Quản lý nhân viên", perm: ["user:manage"] },
  { label: "Phân quyền", perm: ["user:manage"] },
  { label: "Nhật ký hoạt động", perm: ["audit:view"] },
];

// XEM TRƯỚC: tích quyền xong → tài khoản này SẼ THẤY TRANG GÌ + LÀM ĐƯỢC GÌ (cập nhật trực tiếp).
function PermPreview({ cat, isAdmin, perms }: { cat?: PermCatalog; isAdmin: boolean; perms: Set<string> }) {
  const hasP = (k: string) => perms.has(k) || perms.has(k.replace(/:own$/, ":all"));
  const pages = isAdmin ? PAGE_PERMS.map((p) => p.label) : PAGE_PERMS.filter((p) => p.perm.some(hasP)).map((p) => p.label);
  const caps = isAdmin ? ["Toàn quyền"] : (cat ? cat.groups.flatMap((g) => g.perms).filter((p) => perms.has(p.key)).map((p) => p.label) : []);
  return (
    <div className="perm-preview">
      <div className="perm-preview-h">👁 Cấp xong, tài khoản này sẽ:</div>
      <div className="perm-preview-row"><b>Thấy menu:</b> {pages.length ? pages.join(" · ") : <span className="muted">(không trang nào)</span>}</div>
      <div className="perm-preview-row"><b>Làm được:</b> {caps.length ? caps.join(" · ") : <span className="muted">(chưa tích quyền nào)</span>}</div>
    </div>
  );
}

// Hàng "Toàn quyền quản trị" + ma trận + XEM TRƯỚC — dùng chung cho Mời & Sửa.
function PermSection({ cat, isAdmin, setAdmin, perms, setPerms }: { cat?: PermCatalog; isAdmin: boolean; setAdmin: (v: boolean) => void; perms: Set<string>; setPerms: (s: Set<string>) => void; }) {
  return (
    <div className="perm-section">
      <label className="perm-admin-toggle">
        <input type="checkbox" checked={isAdmin} onChange={(e) => setAdmin(e.target.checked)} />
        <span><strong>Toàn quyền quản trị</strong> <span className="muted" style={{ fontSize: 11 }}>(thấy & làm mọi thứ; quản lý tài khoản/cấu hình)</span></span>
      </label>
      <PermPreview cat={cat} isAdmin={isAdmin} perms={perms} />
      {cat ? <PermMatrix cat={cat} isAdmin={isAdmin} value={perms} onChange={setPerms} />
        : <p className="muted">Đang tải danh mục quyền…</p>}
    </div>
  );
}

// Mời nhân viên qua email (họ tự onboard) — kèm tích quyền.
function InviteModal({ cat, onClose, onInvited }: { cat?: PermCatalog; onClose: () => void; onInvited: (r: InviteResult) => void }) {
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [projectCode, setProjectCode] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [perms, setPerms] = useState<Set<string>>(new Set());
  const [err, setErr] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const firstRef = useRef<HTMLInputElement>(null);
  useEffect(() => { firstRef.current?.focus(); }, []);
  // Mặc định điền sẵn preset "Account" cho tài khoản mới (admin chỉnh lại tùy ý).
  useEffect(() => { if (cat && perms.size === 0 && !isAdmin) { const m = cat.roles.find((r) => r.key === "manager"); if (m) setPerms(new Set(m.permissions.filter((p) => !cat.adminOnlyPermissions.includes(p)))); } /* eslint-disable-next-line */ }, [cat]);
  useEscClose(onClose);
  const save = async () => {
    if (!displayName.trim() || !email.trim()) { setErr("Vui lòng nhập họ tên và email"); return; }
    setErr(""); setFieldErrors({}); setSaving(true);
    try {
      onInvited(await api.inviteUser({
        email: email.trim(), displayName: displayName.trim(), projectCode: projectCode.trim() || null,
        role: isAdmin ? "admin" : "manager",
        permissions: isAdmin ? [] : [...perms],
      }));
    } catch (ex) { const fe = fieldErrorsFrom(ex); setFieldErrors(fe); setErr(Object.keys(fe).length ? "Vui lòng kiểm tra các ô được tô đỏ." : (ex instanceof ApiError ? ex.message : "Lỗi")); setSaving(false); }
  };
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Mời nhân viên" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h3>Mời nhân viên</h3><button className="x" onClick={onClose} aria-label="Đóng">✕</button></div>
        <div className="modal-body">
          <p className="muted" style={{ marginTop: 0 }}>Nhập email — hệ thống gửi lời mời, họ tự đặt mật khẩu. Tích các quyền tài khoản này được phép.</p>
          <div className="grid">
            <label className="full"><span>Họ tên <b className="req">*</b></span>
              <input ref={firstRef} value={displayName} placeholder="VD: Nguyễn Văn A" aria-invalid={fieldErrors.displayName ? true : undefined} onChange={(e) => setDisplayName(e.target.value)} />
              {fieldErrors.displayName && <div className="field-err">{fieldErrors.displayName}</div>}</label>
            <label className="full"><span>Email cá nhân <b className="req">*</b></span>
              <input type="email" value={email} placeholder="email cá nhân của nhân viên" aria-invalid={fieldErrors.email ? true : undefined} onChange={(e) => setEmail(e.target.value)} />
              {fieldErrors.email && <div className="field-err">{fieldErrors.email}</div>}</label>
            <label className="full"><span>Mã dự án <em className="unit">(vd FE_A26 — báo giá của họ sẽ là FE_A26_001…)</em></span>
              <input value={projectCode} placeholder="VD: FE_A26" onChange={(e) => setProjectCode(e.target.value)} /></label>
          </div>
          <PermSection cat={cat} isAdmin={isAdmin} setAdmin={setIsAdmin} perms={perms} setPerms={setPerms} />
        </div>
        {err && <div className="err">⚠ {err}</div>}
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>Hủy</button>
          <button className="btn btn-primary" disabled={saving || !displayName.trim() || !email.trim()} onClick={save}>{saving ? "Đang gửi…" : "Gửi lời mời"}</button>
        </div>
      </div>
    </div>
  );
}

function EditUserModal({ user, cat, onClose, onSaved }: { user: User; cat?: PermCatalog; onClose: () => void; onSaved: () => void }) {
  const [displayName, setDisplayName] = useState(user.displayName || "");
  const [phone, setPhone] = useState(user.phone || "");
  const [projectCode, setProjectCode] = useState(user.projectCode || "");
  const [isAdmin, setIsAdmin] = useState(user.role === "admin");
  // Pre-fill ma trận từ quyền HIỆU LỰC hiện tại (per-user nếu có, else theo role mặc định).
  const [perms, setPerms] = useState<Set<string>>(new Set(user.effectivePermissions ?? user.permissions ?? []));
  const [err, setErr] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const dirty = useRef(false);
  const firstRef = useRef<HTMLInputElement>(null);
  useEffect(() => { firstRef.current?.focus(); }, []);
  const guardedClose = useCallback(async () => {
    if (dirty.current && !(await confirmModal("Bỏ thay đổi?", "Bạn có thay đổi chưa lưu. Đóng và bỏ hết?", { danger: true, confirmText: "Đóng, bỏ thay đổi" }))) return;
    onClose();
  }, [onClose]);
  useEscClose(() => void guardedClose());
  const mark = <T,>(setter: (v: T) => void) => (v: T) => { dirty.current = true; setter(v); };
  const save = async () => {
    setErr(""); setFieldErrors({}); setSaving(true);
    try {
      await api.updateUser(user.id, {
        username: user.username, displayName, phone, projectCode: projectCode.trim() || null,
        role: isAdmin ? "admin" : "manager",
        permissions: isAdmin ? [] : [...perms], // backend tự đồng bộ cờ canSign từ quote:sign:own
      });
      toast("Đã lưu", "success"); onSaved();
    } catch (ex) { const fe = fieldErrorsFrom(ex); setFieldErrors(fe); setErr(Object.keys(fe).length ? "Vui lòng kiểm tra các ô được tô đỏ." : (ex instanceof ApiError ? ex.message : "Lỗi")); setSaving(false); }
  };
  return (
    <div className="modal-backdrop" onClick={() => void guardedClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={`Sửa nhân viên ${user.username}`} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h3>Sửa: {user.username}</h3><button className="x" onClick={() => void guardedClose()} aria-label="Đóng">✕</button></div>
        <div className="modal-body">
          <div className="grid">
            <label className="full"><span>Tên đăng nhập</span><input value={user.username} disabled /></label>
            <label className="full"><span>Họ tên</span><input ref={firstRef} value={displayName} aria-invalid={fieldErrors.displayName ? true : undefined} onChange={(e) => mark(setDisplayName)(e.target.value)} />{fieldErrors.displayName && <div className="field-err">{fieldErrors.displayName}</div>}</label>
            <label className="full"><span>SĐT</span><input type="tel" value={phone} onChange={(e) => mark(setPhone)(e.target.value)} /></label>
            <label className="full"><span>Mã dự án <em className="unit">(vd FE_A26 — báo giá user này tạo sẽ là FE_A26_001…)</em></span><input value={projectCode} placeholder="VD: FE_A26" onChange={(e) => mark(setProjectCode)(e.target.value)} /></label>
          </div>
          <PermSection cat={cat} isAdmin={isAdmin} setAdmin={mark(setIsAdmin)} perms={perms} setPerms={mark(setPerms)} />
        </div>
        {err && <div className="err">⚠ {err}</div>}
        <div className="modal-foot">
          <button className="btn" onClick={() => void guardedClose()}>Hủy</button>
          <button className="btn btn-primary" disabled={saving} onClick={save}>{saving ? "Đang lưu…" : "Lưu"}</button>
        </div>
      </div>
    </div>
  );
}

function InviteResultModal({ result, onClose }: { result: InviteResult; onClose: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEscClose(onClose);
  const copy = async () => {
    const inp = ref.current; if (!inp) return;
    inp.select();
    let ok = false;
    try { if (navigator.clipboard) { await navigator.clipboard.writeText(inp.value); ok = true; } } catch { ok = false; }
    if (!ok) { try { ok = document.execCommand("copy"); } catch { ok = false; } }
    toast(ok ? "Đã sao chép liên kết" : "Chưa sao chép được — hãy chọn rồi nhấn Ctrl/Cmd+C", ok ? "success" : "error");
  };
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-sm" role="dialog" aria-modal="true" aria-label="Đã tạo lời mời" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h3>Đã tạo lời mời</h3><button className="x" onClick={onClose} aria-label="Đóng">✕</button></div>
        <div className="modal-body">
          <p style={{ marginTop: 0 }}>{result.emailSent
            ? <>Đã gửi email lời mời tới <b>{result.user.email}</b>.</>
            : <>Email chưa được cấu hình trên hệ thống — hãy gửi <b>liên kết mời</b> này cho nhân viên:</>}</p>
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <input ref={ref} value={result.inviteUrl} readOnly style={{ flex: 1, padding: "8px 10px", border: "1px solid var(--line-strong)", borderRadius: 7, background: "var(--field-bg)", color: "var(--text)" }} />
            <button className="btn" type="button" onClick={copy}>Sao chép</button>
          </div>
          <p className="muted" style={{ marginTop: 10 }}>Nhân viên mở liên kết → đặt mật khẩu + điền SĐT → đăng nhập bằng <b>email</b>. Lời mời hết hạn sau 7 ngày.</p>
        </div>
        <div className="modal-foot"><button className="btn" onClick={onClose}>Đóng</button></div>
      </div>
    </div>
  );
}
