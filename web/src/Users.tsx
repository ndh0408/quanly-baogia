import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, type Me, type User, type InviteResult } from "./api";
import { toast, confirmModal, fieldErrorsFrom } from "./ui";

// Port "Quản lý nhân viên" (renderUsers) sang React — bê ĐẦY ĐỦ: bảng + Mời (invite email) +
// Sửa + Đổi MK + Kết-quả-mời (link+copy) + Khóa/Mở khóa (confirm) + Xóa (confirm) + Gửi-lại-lời-mời.
// Bảo mật: trang đã gate user:manage (Shell nav); server enforce mọi action.
const ROLES: [string, string][] = [
  ["manager", "Account"], ["admin", "Quản trị"], ["account_hn", "Account Hà Nội"], ["hr", "Nhân sự"], ["accountant", "Kế toán"],
];
const ROLE_LABEL: Record<string, string> = Object.fromEntries(ROLES);
const roleCls = (r: string) => (r === "admin" ? "approved" : r === "manager" ? "pending" : "draft");

type Modal = { t: "invite" } | { t: "edit"; user: User } | { t: "password"; user: User } | { t: "result"; result: InviteResult };

export function UsersPage({ me }: { me: Me }) {
  const [rows, setRows] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [modal, setModal] = useState<Modal | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr("");
    try { setRows(await api.listUsers()); }
    catch (ex) { setErr(ex instanceof ApiError ? ex.message : "Lỗi tải dữ liệu"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const onResend = async (u: User) => {
    try { const r = await api.resendInvite(u.id); setModal({ t: "result", result: { ...r, user: { email: u.email || "" } } }); }
    catch (ex) { toast(ex instanceof ApiError ? ex.message : "Lỗi", "error"); }
  };
  const onToggleLock = async (u: User) => {
    if (u.active && !(await confirmModal("Khóa tài khoản", `Khóa tài khoản "${u.displayName || u.username}"? Người này sẽ không đăng nhập được cho tới khi được mở khóa.`, { danger: true, confirmText: "Khóa" }))) return;
    try { await api.updateUser(u.id, { active: !u.active }); toast(u.active ? "Đã khóa tài khoản" : "Đã mở khóa tài khoản", "success"); load(); }
    catch (ex) { toast(ex instanceof ApiError ? ex.message : "Lỗi", "error"); }
  };
  const onDelete = async (u: User) => {
    if (!(await confirmModal("Xóa nhân viên", "Xóa nhân viên này? Hành động không thể hoàn tác.", { danger: true, confirmText: "Xóa" }))) return;
    try { await api.deleteUser(u.id); toast("Đã xóa", "success"); load(); }
    catch (ex) { toast(ex instanceof ApiError ? ex.message : "Lỗi", "error"); }
  };

  const dash = <span className="muted">—</span>;

  return (
    <div>
      <h1>Quản lý nhân viên</h1>
      <div className="toolbar">
        <button className="btn btn-primary" onClick={() => setModal({ t: "invite" })}>+ Thêm nhân viên</button>
      </div>
      {err && <div className="err">⚠ {err} <button className="btn btn-sm" onClick={load}>Thử lại</button></div>}
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
                  <td><span className={`status ${roleCls(u.role)}`}>{ROLE_LABEL[u.role] ?? u.role}</span></td>
                  <td>{u.phone || dash}</td>
                  <td>{u.pending ? <span className="status pending">Chờ kích hoạt</span> : <span className={`status ${u.active ? "approved" : "rejected"}`}>{u.active ? "Hoạt động" : "Đã khóa"}</span>}</td>
                  <td className="row-actions" style={{ whiteSpace: "nowrap" }}>
                    {u.pending ? (
                      <button className="btn btn-sm" onClick={() => onResend(u)}>Gửi lại lời mời</button>
                    ) : (
                      <>
                        <button className="btn btn-sm" onClick={() => setModal({ t: "edit", user: u })}>Sửa</button>
                        <button className="btn btn-sm" onClick={() => setModal({ t: "password", user: u })}>Đổi MK</button>
                        <button className={`btn btn-sm ${u.active ? "btn-warn" : "btn-success"}`} onClick={() => onToggleLock(u)}>{u.active ? "Khóa" : "Mở khóa"}</button>
                      </>
                    )}
                    {u.id !== me.id && <button className="btn btn-sm btn-danger" onClick={() => onDelete(u)}>Xóa</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal?.t === "invite" && <InviteModal onClose={() => setModal(null)} onInvited={(r) => { setModal({ t: "result", result: r }); load(); }} />}
      {modal?.t === "edit" && <EditUserModal user={modal.user} onClose={() => setModal(null)} onSaved={() => { setModal(null); load(); }} />}
      {modal?.t === "password" && <PasswordModal user={modal.user} onClose={() => setModal(null)} />}
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

// Mời nhân viên qua email (họ tự onboard).
function InviteModal({ onClose, onInvited }: { onClose: () => void; onInvited: (r: InviteResult) => void }) {
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("manager");
  const [projectCode, setProjectCode] = useState("");
  const [err, setErr] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const firstRef = useRef<HTMLInputElement>(null);
  useEffect(() => { firstRef.current?.focus(); }, []);
  useEscClose(onClose);
  const save = async () => {
    if (!displayName.trim() || !email.trim()) { setErr("Vui lòng nhập họ tên và email"); return; }
    setErr(""); setFieldErrors({}); setSaving(true);
    try { onInvited(await api.inviteUser({ email: email.trim(), displayName: displayName.trim(), role, projectCode: projectCode.trim() || null })); }
    catch (ex) { const fe = fieldErrorsFrom(ex); setFieldErrors(fe); setErr(Object.keys(fe).length ? "Vui lòng kiểm tra các ô được tô đỏ." : (ex instanceof ApiError ? ex.message : "Lỗi")); setSaving(false); }
  };
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-sm" role="dialog" aria-modal="true" aria-label="Mời nhân viên" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h3>Mời nhân viên</h3><button className="x" onClick={onClose} aria-label="Đóng">✕</button></div>
        <div className="modal-body">
          <p className="muted" style={{ marginTop: 0 }}>Nhập email nhân viên — hệ thống gửi lời mời, họ tự đặt mật khẩu và điền SĐT.</p>
          <div className="grid">
            <label className="full"><span>Họ tên <b className="req">*</b></span>
              <input ref={firstRef} value={displayName} placeholder="VD: Nguyễn Văn A" aria-invalid={fieldErrors.displayName ? true : undefined} onChange={(e) => setDisplayName(e.target.value)} />
              {fieldErrors.displayName && <div className="field-err">{fieldErrors.displayName}</div>}</label>
            <label className="full"><span>Email cá nhân <b className="req">*</b></span>
              <input type="email" value={email} placeholder="email cá nhân của nhân viên" aria-invalid={fieldErrors.email ? true : undefined} onChange={(e) => setEmail(e.target.value)} />
              {fieldErrors.email && <div className="field-err">{fieldErrors.email}</div>}</label>
            <label className="full"><span>Quyền</span><select value={role} onChange={(e) => setRole(e.target.value)}>{ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
            <label className="full"><span>Mã dự án <em className="unit">(vd FE_A26 — báo giá của họ sẽ là FE_A26_001…)</em></span>
              <input value={projectCode} placeholder="VD: FE_A26" onChange={(e) => setProjectCode(e.target.value)} /></label>
          </div>
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

function EditUserModal({ user, onClose, onSaved }: { user: User; onClose: () => void; onSaved: () => void }) {
  const [displayName, setDisplayName] = useState(user.displayName || "");
  const [role, setRole] = useState(user.role || "manager");
  const [phone, setPhone] = useState(user.phone || "");
  const [projectCode, setProjectCode] = useState(user.projectCode || "");
  const [canSign, setCanSign] = useState(!!user.canSign);
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
      await api.updateUser(user.id, { username: user.username, displayName, role, phone, projectCode: projectCode.trim() || null, canSign });
      toast("Đã lưu", "success"); onSaved();
    } catch (ex) { const fe = fieldErrorsFrom(ex); setFieldErrors(fe); setErr(Object.keys(fe).length ? "Vui lòng kiểm tra các ô được tô đỏ." : (ex instanceof ApiError ? ex.message : "Lỗi")); setSaving(false); }
  };
  return (
    <div className="modal-backdrop" onClick={() => void guardedClose()}>
      <div className="modal modal-sm" role="dialog" aria-modal="true" aria-label={`Sửa nhân viên ${user.username}`} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h3>Sửa: {user.username}</h3><button className="x" onClick={() => void guardedClose()} aria-label="Đóng">✕</button></div>
        <div className="modal-body">
          <div className="grid">
            <label className="full"><span>Tên đăng nhập</span><input value={user.username} disabled /></label>
            <label className="full"><span>Họ tên</span><input ref={firstRef} value={displayName} aria-invalid={fieldErrors.displayName ? true : undefined} onChange={(e) => mark(setDisplayName)(e.target.value)} />{fieldErrors.displayName && <div className="field-err">{fieldErrors.displayName}</div>}</label>
            <label className="full"><span>Quyền</span><select value={role} onChange={(e) => mark(setRole)(e.target.value)}>{ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
            <label className="full"><span>SĐT</span><input type="tel" value={phone} onChange={(e) => mark(setPhone)(e.target.value)} /></label>
            <label className="full"><span>Mã dự án <em className="unit">(vd FE_A26 — báo giá user này tạo sẽ là FE_A26_001…)</em></span><input value={projectCode} placeholder="VD: FE_A26" onChange={(e) => mark(setProjectCode)(e.target.value)} /></label>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", marginTop: 4 }}>
            <input type="checkbox" checked={canSign} onChange={(e) => mark(setCanSign)(e.target.checked)} />
            <span>Được <strong>Ký Chứng từ</strong> ở trang Quản lý dự án <span className="muted" style={{ fontSize: 11 }}>(admin luôn được; bật cho nhân viên cần ký)</span></span>
          </label>
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

function PasswordModal({ user, onClose }: { user: User; onClose: () => void }) {
  const [pw, setPw] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  useEscClose(onClose);
  const save = async () => {
    if (pw.length < 8) { toast("Mật khẩu tối thiểu 8 ký tự", "error"); return; }
    setSaving(true);
    try { await api.updateUser(user.id, { password: pw }); toast("Đã đổi mật khẩu", "success"); onClose(); }
    catch (ex) { toast(ex instanceof ApiError ? ex.message : "Lỗi", "error"); setSaving(false); }
  };
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-sm" role="dialog" aria-modal="true" aria-label={`Đổi mật khẩu ${user.username}`} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h3>Đổi mật khẩu: {user.username}</h3><button className="x" onClick={onClose} aria-label="Đóng">✕</button></div>
        <div className="modal-body">
          <div className="grid">
            <label className="full"><span>Mật khẩu mới <em className="unit">(tối thiểu 8 ký tự)</em></span>
              <span className="pw-wrap">
                <input ref={ref} type={showPw ? "text" : "password"} autoComplete="new-password" minLength={8} value={pw} onChange={(e) => setPw(e.target.value)} />
                <button type="button" className="pw-toggle" tabIndex={-1} aria-label="Hiện / ẩn mật khẩu" onClick={() => setShowPw((s) => !s)}>{showPw ? "🙈" : "👁"}</button>
              </span>
            </label>
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>Hủy</button>
          <button className="btn btn-primary" disabled={saving || pw.length < 8} onClick={save}>{saving ? "Đang đổi…" : "Đổi"}</button>
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
