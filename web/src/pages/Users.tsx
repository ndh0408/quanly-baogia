import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type Me, type User, type InviteResult, type PermCatalog } from "../lib/api";
import { dash } from "../lib/format";
import { toast, confirmModal, fieldErrorsFrom, useEscClose } from "../lib/ui";

// "Quản lý nhân viên": bảng + Mời (invite email) + Sửa + Khóa/Mở khóa + Gửi-lại / Hủy lời mời.
// PHÂN QUYỀN PER-USER: KHÔNG còn chọn "vai trò" — admin TÍCH QUYỀN cho từng tài khoản (preset điền nhanh).
// 1 tài khoản hoặc là "Toàn quyền quản trị" (admin) hoặc tích từng quyền cụ thể.
// CHÍNH SÁCH: KHÔNG đổi mật khẩu hộ (đã có "Quên mật khẩu") và KHÔNG xóa tài-khoản đã kích hoạt → nghỉ thì KHÓA.
const ROLE_LABEL: Record<string, string> = {
  manager: "Account", admin: "Quản trị", account_hn: "Account Hà Nội", hr: "Nhân sự", accountant: "Kế toán",
};

type Modal = { t: "invite" } | { t: "edit"; user: User } | { t: "result"; result: InviteResult };

export function UsersPage({ me, onPreview }: { me: Me; onPreview?: (perms: string[], label: string) => void }) {
  const qc = useQueryClient();
  const [modal, setModal] = useState<Modal | null>(null);
  // Lọc client-side (danh sách nhân viên nhỏ, không cần API): ô tìm + trạng thái.
  const [q, setQ] = useState("");
  const [fStatus, setFStatus] = useState(""); // "" | active | pending | locked

  const { data, isPending, error, refetch } = useQuery({ queryKey: ["users"], queryFn: () => api.listUsers() });
  const { data: cat } = useQuery({ queryKey: ["perm-catalog"], queryFn: () => api.permissionsCatalog() });
  const rows = data ?? [];
  const loading = isPending;
  const err = error ? (error instanceof ApiError ? error.message : "Lỗi tải dữ liệu") : "";
  const load = useCallback(() => { qc.invalidateQueries({ queryKey: ["users"] }); }, [qc]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((u) => {
      if (needle) {
        const hay = [u.username, u.displayName, u.email, u.phone, u.projectCode].filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      if (fStatus === "active") return !u.pending && u.active;
      if (fStatus === "pending") return !!u.pending;
      if (fStatus === "locked") return !u.pending && !u.active;
      return true;
    });
  }, [rows, q, fStatus]);
  const hasFilter = !!q || !!fStatus;
  const clearFilters = () => { setQ(""); setFStatus(""); };

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
  // ĐẶT LẠI MFA — đường thoát DUY NHẤT cho ca thật: người dùng mất điện thoại / xoá app
  // Authenticator và đã dùng hết mã dự phòng. Không có nút này thì tài khoản bị khoá cứng, vì
  // chính họ cũng không đăng nhập được để tự tắt MFA. HẠ MỘT LỚP BẢO MẬT nên phải xác nhận, và
  // backend tự thu hồi mọi phiên của người đó (revokeSession "mfa_reset") — ai đang mượn phiên
  // cũng bị đẩy ra. Nút chỉ hiện khi `u.mfaEnabled` (backend 400 nếu MFA vốn đã tắt).
  const onResetMfa = async (u: User) => {
    if (!(await confirmModal("Đặt lại bảo mật 2 lớp", `Tắt bảo mật 2 lớp của "${u.displayName || u.username}"? Người này sẽ đăng nhập chỉ bằng mật khẩu cho tới khi tự bật lại, và mọi phiên đang mở của họ bị đăng xuất. Chỉ làm khi đã xác minh đúng người qua kênh khác.`, { danger: true, confirmText: "Đặt lại MFA" }))) return;
    try { await api.resetMfa(u.id); toast("Đã tắt bảo mật 2 lớp — nhắc người này bật lại ngay", "success"); load(); }
    catch (ex) { toast(ex instanceof ApiError ? ex.message : "Lỗi", "error"); }
  };

  // Nhãn cột "Quyền": admin = Quản trị; đã tùy biến = Tùy chỉnh; còn lại = preset gốc.
  // Preset gốc dùng .neutral (xám) — vàng .pending dành riêng cho "Chờ kích hoạt" ở cột Trạng thái.
  const permLabel = (u: User) =>
    u.role === "admin" ? <span className="status approved">Quản trị</span>
    : u.permCustom ? <span className="status draft">Tùy chỉnh</span>
    : <span className="status neutral">{ROLE_LABEL[u.role] ?? "Nhân viên"}</span>;

  return (
    <div>
      <h1>Quản lý nhân viên</h1>
      <p className="muted page-sub">Mời qua email — nhân viên tự đặt mật khẩu rồi đăng nhập bằng email. Nhân viên nghỉ việc thì <b>Khóa</b> tài khoản (không xóa).</p>
      <div className="toolbar">
        <input type="search" className="grow" placeholder="Tìm theo tên, tên đăng nhập, email, SĐT…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Tìm nhân viên" />
        <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} aria-label="Lọc theo trạng thái">
          <option value="">Tất cả trạng thái</option>
          <option value="active">Hoạt động</option>
          <option value="pending">Chờ kích hoạt</option>
          <option value="locked">Đã khóa</option>
        </select>
        <button className="btn btn-sm btn-ghost" disabled={!hasFilter} onClick={clearFilters}>Xóa lọc</button>
        <button className="btn btn-primary" onClick={() => setModal({ t: "invite" })}>+ Thêm nhân viên</button>
      </div>
      {err && <div className="err">⚠ {err} <button className="btn btn-sm" onClick={() => refetch()}>Thử lại</button></div>}
      {loading ? (
        <div className="skeleton-wrap">{Array.from({ length: 5 }).map((_, i) => <div className="skeleton-row" key={i} />)}</div>
      ) : filtered.length === 0 ? (
        <div className="empty">
          {rows.length === 0
            ? <>Chưa có nhân viên nào. <button className="btn btn-primary" onClick={() => setModal({ t: "invite" })}>+ Thêm nhân viên</button></>
            : <>Không có nhân viên nào khớp bộ lọc. <button className="btn btn-sm btn-ghost" onClick={clearFilters}>Xóa lọc</button></>}
        </div>
      ) : (
        <>
        <div className="list-wrap">
          <table className="list-table">
            <thead><tr>
              <th scope="col">Tên đăng nhập</th><th scope="col">Họ tên</th><th scope="col">Mã dự án</th><th scope="col">Quyền</th><th scope="col">SĐT</th><th scope="col">Trạng thái</th><th scope="col" className="actions" aria-label="Thao tác" />
            </tr></thead>
            <tbody>
              {filtered.map((u) => (
                <tr key={u.id}>
                  <td>{u.username}</td>
                  <td>{u.displayName}</td>
                  <td>{u.projectCode ? <strong>{u.projectCode}</strong> : dash}</td>
                  <td>{permLabel(u)}</td>
                  <td>{u.phone || dash}</td>
                  <td>{u.pending ? <span className="status pending">Chờ kích hoạt</span> : <span className={`status ${u.active ? "approved" : "rejected"}`}>{u.active ? "Hoạt động" : "Đã khóa"}</span>}</td>
                  <td className="row-actions">
                    {u.pending ? (
                      <>
                        <button className="btn btn-sm" onClick={() => onResend(u)}>Gửi lại lời mời</button>
                        {u.id !== me.id && <button className="btn btn-sm btn-danger" onClick={() => onCancelInvite(u)}>Hủy lời mời</button>}
                      </>
                    ) : (
                      <>
                        <button className="btn btn-sm" onClick={() => setModal({ t: "edit", user: u })}>Sửa</button>
                        {u.mfaEnabled && <button className="btn btn-sm btn-warn btn-mfa-reset" onClick={() => onResetMfa(u)} title="Người này mất thiết bị xác thực và hết mã dự phòng">Đặt lại MFA</button>}
                        <button className={`btn btn-sm ${u.active ? "btn-warn" : "btn-success"}`} onClick={() => onToggleLock(u)}>{u.active ? "Khóa" : "Mở khóa"}</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="list-foot">
          <span className="muted">Hiển thị {filtered.length}{hasFilter ? ` / ${rows.length}` : ""} nhân viên</span>
        </div>
        </>
      )}

      {modal?.t === "invite" && <InviteModal cat={cat} onPreview={onPreview} onClose={() => setModal(null)} onInvited={(r) => { setModal({ t: "result", result: r }); load(); }} />}
      {modal?.t === "edit" && <EditUserModal user={modal.user} cat={cat} onPreview={onPreview} onClose={() => setModal(null)} onSaved={() => { setModal(null); load(); }} />}
      {modal?.t === "result" && <InviteResultModal result={modal.result} onClose={() => setModal(null)} />}
    </div>
  );
}

// Ma trận TÍCH QUYỀN per-user. Preset = điền nhanh theo mẫu (Account/Kế toán/…). Nhóm admin-tier bị KHÓA
// (chỉ tài khoản "Toàn quyền quản trị" mới có). isAdmin → ẩn ma trận (admin luôn full).
function PermMatrix({ cat, isAdmin, value, onChange }: { cat: PermCatalog; isAdmin: boolean; value: Set<string>; onChange: (s: Set<string>) => void; }) {
  if (isAdmin) return <p className="muted perm-admin-note">✅ Tài khoản <b>Quản trị</b> có <b>TOÀN QUYỀN</b> — không cần tích.</p>;
  const adminOnly = new Set(cat.adminOnlyPermissions);
  const inMatrix = new Set(cat.groups.flatMap((g) => g.perms.map((p) => p.key))); // chỉ quyền CÓ trong ma trận
  const toggle = (k: string) => { const n = new Set(value); if (n.has(k)) n.delete(k); else n.add(k); onChange(n); };
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
  { label: "Danh bạ nhân sự", perm: ["employee:read:own"] },
  { label: "Quản lý dự án", perm: ["quote:create", "invoice:read"] },
  { label: "Quản lý nhân viên", perm: ["user:manage"] },
  { label: "Phân quyền", perm: ["user:manage"] },
  { label: "Nhật ký hoạt động", perm: ["audit:view"] },
];

// XEM TRƯỚC: tích quyền xong → tài khoản này SẼ THẤY TRANG GÌ + LÀM ĐƯỢC GÌ (cập nhật trực tiếp).
function PermPreview({ cat, isAdmin, perms }: { cat?: PermCatalog; isAdmin: boolean; perms: Set<string> }) {
  if (isAdmin) return (
    <div className="perm-preview">
      <div className="perm-preview-h">👁 Tài khoản này sẽ làm được:</div>
      <div className="perm-preview-row"><b style={{ color: "var(--gold-d)" }}>TOÀN QUYỀN</b> — thấy mọi menu & làm mọi thứ (kể cả quản lý tài khoản, cấu hình).</div>
    </div>
  );
  const hasP = (k: string) => perms.has(k) || perms.has(k.replace(/:own$/, ":all"));
  const pages = PAGE_PERMS.filter((p) => p.perm.some(hasP)).map((p) => p.label);
  // Gom năng lực theo NHÓM (Báo giá / Khách hàng / …) — dễ đọc hơn 1 danh sách phẳng.
  const groups = cat ? cat.groups.map((g) => ({ label: g.label, items: g.perms.filter((p) => perms.has(p.key)).map((p) => p.label) })).filter((g) => g.items.length) : [];
  const total = groups.reduce((a, g) => a + g.items.length, 0);
  return (
    <div className="perm-preview">
      <div className="perm-preview-h">👁 Cấp xong, tài khoản này sẽ: <span className="perm-preview-count">{total} quyền</span></div>
      <div className="perm-preview-row"><b>Thấy menu:</b> {pages.length ? pages.join(" · ") : <span className="muted">(không trang nào)</span>}</div>
      {total === 0
        ? <div className="perm-preview-row muted">Chưa tích quyền nào — tài khoản chưa làm được gì.</div>
        : <div className="perm-preview-caps"><b>Làm được:</b>{groups.map((g) => (
            <div className="perm-preview-cap" key={g.label}><span className="perm-preview-cap-g">{g.label}:</span> {g.items.join(", ")}</div>
          ))}</div>}
    </div>
  );
}

// Hàng "Toàn quyền quản trị" + ma trận + XEM TRƯỚC — dùng chung cho Mời & Sửa.
function PermSection({ cat, isAdmin, setAdmin, perms, setPerms, onPreview, label }: { cat?: PermCatalog; isAdmin: boolean; setAdmin: (v: boolean) => void; perms: Set<string>; setPerms: (s: Set<string>) => void; onPreview?: (perms: string[], label: string) => void; label?: string; }) {
  const tryIt = () => {
    if (!onPreview) return;
    const eff = isAdmin ? (cat?.roles.find((r) => r.key === "admin")?.permissions ?? []) : [...perms];
    onPreview(eff, label || "tài khoản này");
  };
  return (
    <div className="perm-section">
      <label className="perm-admin-toggle">
        <input type="checkbox" checked={isAdmin} onChange={(e) => setAdmin(e.target.checked)} />
        <span><strong>Toàn quyền quản trị</strong> <span className="muted" style={{ fontSize: 11 }}>(thấy & làm mọi thứ; quản lý tài khoản/cấu hình)</span></span>
      </label>
      <PermPreview cat={cat} isAdmin={isAdmin} perms={perms} />
      {onPreview && <button type="button" className="btn btn-sm btn-preview" onClick={tryIt}>👁 Xem thử app với quyền này (chạy thử, không lưu thật)</button>}
      {cat ? <PermMatrix cat={cat} isAdmin={isAdmin} value={perms} onChange={setPerms} />
        : <p className="muted">Đang tải danh mục quyền…</p>}
    </div>
  );
}

// Mời nhân viên qua email (họ tự onboard) — kèm tích quyền.
function InviteModal({ cat, onClose, onInvited, onPreview }: { cat?: PermCatalog; onClose: () => void; onInvited: (r: InviteResult) => void; onPreview?: (perms: string[], label: string) => void }) {
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [senderName, setSenderName] = useState("");
  const [projectCode, setProjectCode] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [perms, setPerms] = useState<Set<string>>(new Set());
  const [err, setErr] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const dirty = useRef(false);
  const firstRef = useRef<HTMLInputElement>(null);
  useEffect(() => { firstRef.current?.focus(); }, []);
  // Mặc định điền sẵn preset "Account" cho tài khoản mới (admin chỉnh lại tùy ý) — KHÔNG tính là "dirty".
  useEffect(() => { if (cat && perms.size === 0 && !isAdmin) { const m = cat.roles.find((r) => r.key === "manager"); if (m) setPerms(new Set(m.permissions.filter((p) => !cat.adminOnlyPermissions.includes(p)))); }   }, [cat]);
  // Guard "bỏ thay đổi" — y hệt EditUserModal: ESC / click backdrop / ✕ / Hủy không vứt form đã gõ.
  const guardedClose = useCallback(async () => {
    if (dirty.current && !(await confirmModal("Bỏ thay đổi?", "Bạn có thay đổi chưa lưu. Đóng và bỏ hết?", { danger: true, confirmText: "Đóng, bỏ thay đổi" }))) return;
    onClose();
  }, [onClose]);
  useEscClose(() => void guardedClose());
  const mark = <T,>(setter: (v: T) => void) => (v: T) => { dirty.current = true; setter(v); };
  const save = async () => {
    if (!displayName.trim() || !email.trim()) { setErr("Vui lòng nhập họ tên và email"); return; }
    setErr(""); setFieldErrors({}); setSaving(true);
    try {
      // Ô "Tên người gửi" ở đây KHÔNG nạp sẵn (tài khoản chưa tồn tại) ⇒ rỗng thì BỎ HẲN KHOÁ, đừng
      // gửi "". Hôm nay vô hại vì `inviteUser` là `prisma.user.create` và ném 409 nếu email đã có —
      // không có giá trị cũ nào để xoá. Nhưng luật phải là MỘT luật chứ không phải một danh sách
      // ngoại lệ: ngày nào ai đó đổi create thành upsert, form này lập tức thành đường xoá dữ liệu.
      onInvited(await api.inviteUser({
        email: email.trim(), displayName: displayName.trim(), projectCode: projectCode.trim() || null,
        ...(senderName.trim() ? { senderName: senderName.trim() } : {}),
        role: isAdmin ? "admin" : "manager",
        permissions: isAdmin ? [] : [...perms],
      }));
    } catch (ex) { const fe = fieldErrorsFrom(ex); setFieldErrors(fe); setErr(Object.keys(fe).length ? "Vui lòng kiểm tra các ô được tô đỏ." : (ex instanceof ApiError ? ex.message : "Lỗi")); setSaving(false); }
  };
  return (
    <div className="modal-backdrop" onClick={() => void guardedClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Mời nhân viên" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h3>Mời nhân viên</h3><button className="x" onClick={() => void guardedClose()} aria-label="Đóng">✕</button></div>
        <div className="modal-body">
          <p className="muted" style={{ marginTop: 0 }}>Nhập email — hệ thống gửi lời mời, họ tự đặt mật khẩu. Tích các quyền tài khoản này được phép.</p>
          <div className="grid">
            <label className="full"><span>Họ tên <b className="req">*</b></span>
              <input ref={firstRef} value={displayName} placeholder="VD: Nguyễn Văn A" aria-invalid={fieldErrors.displayName ? true : undefined} onChange={(e) => mark(setDisplayName)(e.target.value)} />
              {fieldErrors.displayName && <div className="field-err">{fieldErrors.displayName}</div>}</label>
            {/* Cùng cụm danh tính với Họ tên. Câu chữ lấy NGUYÊN của trang Hồ sơ cá nhân và màn
                kích hoạt (#/onboard) — ba nơi cùng một trường thì phải cùng một cách gọi tên. */}
            <label className="full"><span>Tên người gửi trên báo giá</span>
              <input value={senderName} placeholder="Để trống = dùng Họ tên" onChange={(e) => mark(setSenderName)(e.target.value)} /></label>
            <label className="full"><span>Email cá nhân <b className="req">*</b></span>
              <input type="email" value={email} placeholder="email cá nhân của nhân viên" aria-invalid={fieldErrors.email ? true : undefined} onChange={(e) => mark(setEmail)(e.target.value)} />
              {fieldErrors.email && <div className="field-err">{fieldErrors.email}</div>}</label>
            <label className="full"><span>Mã dự án <em className="unit">(chỉ phần chữ, vd FE_A — hệ thống tự thêm năm: báo giá của họ năm nay là FE_A{String(new Date().getFullYear()).slice(-2)}_001…)</em></span>
              <input value={projectCode} placeholder="VD: FE_A" onChange={(e) => mark(setProjectCode)(e.target.value)} /></label>
          </div>
          <PermSection cat={cat} isAdmin={isAdmin} setAdmin={mark(setIsAdmin)} perms={perms} setPerms={mark(setPerms)} onPreview={onPreview} label={displayName.trim() || "tài khoản mới"} />
        </div>
        {err && <div className="err">⚠ {err}</div>}
        <div className="modal-foot">
          <button className="btn" onClick={() => void guardedClose()}>Hủy</button>
          <button className="btn btn-primary" disabled={saving || !displayName.trim() || !email.trim()} onClick={save}>{saving ? "Đang gửi…" : "Gửi lời mời"}</button>
        </div>
      </div>
    </div>
  );
}

function EditUserModal({ user, cat, onClose, onSaved, onPreview }: { user: User; cat?: PermCatalog; onClose: () => void; onSaved: () => void; onPreview?: (perms: string[], label: string) => void }) {
  const [displayName, setDisplayName] = useState(user.displayName || "");
  // NẠP SẴN từ `user.email` (USER_SELECT trả cột này từ trước). Thứ tự vá là bắt buộc và ô này là
  // mắt PHẢI CÓ TRƯỚC khi `UserUpdateSchema` nhận khoá `email`: thêm schema mà ô chưa nạp sẵn là mỗi
  // lần bấm Lưu XOÁ TRẮNG email của người ta — biến thể NẶNG NHẤT của sự cố xoá trắng 5/10 hồ sơ,
  // vì đây là định danh đăng nhập + đường nhận thư mời/đặt lại mật khẩu.
  const [email, setEmail] = useState(user.email || "");
  const [senderName, setSenderName] = useState(user.senderName || "");
  const [phone, setPhone] = useState(user.phone || "");
  // NẠP SẴN từ `user.title` — bắt buộc, không phải tuỳ chọn. Ô trống mà payload vẫn gửi `null` là
  // một đường xoá trắng mới: admin vào sửa mỗi SĐT là mất luôn chức danh in trên báo giá của người ta.
  const [title, setTitle] = useState(user.title || "");
  const [projectCode, setProjectCode] = useState(user.projectCode || "");
  const [isAdmin, setIsAdmin] = useState(user.role === "admin");
  // Pre-fill ma trận từ quyền HIỆU LỰC hiện tại (per-user nếu có, else theo role mặc định).
  const [perms, setPerms] = useState<Set<string>>(new Set(user.effectivePermissions ?? user.permissions ?? []));
  /* ── MỐC BAN ĐẦU, ĐỂ BIẾT ADMIN CÓ THẬT SỰ ĐỔI Ô TÍCH HAY KHÔNG ──────────────────────────────
     Ma trận này nạp sẵn từ quyền HIỆU LỰC. Với người CHƯA tuỳ biến, quyền hiệu lực CHÍNH LÀ bộ mặc
     định của role — nên gửi nó lên là biến "theo mặc định của role" thành một BẢN CHỤP đóng cứng:

         resolveUserPermissions(role, userPerms):
             userPerms RỖNG  →  dùng bộ mặc định CỦA ROLE
             userPerms CÓ     →  dùng đúng bộ đó, BỎ QUA role

     Hậu quả: sau này đổi quyền mặc định của `manager`, người từng bị Lưu một lần KHÔNG được hưởng.
     Và nó xảy ra chỉ vì admin vào sửa số điện thoại rồi bấm Lưu. Chính giao diện cũng biết —
     `permCustom = permissions.length > 0` bật lên thành "đã tuỳ biến".

     Nên áp đúng luật đã chốt cho `role` và ba trường hồ sơ: KHÔNG đổi thì KHÔNG gửi. */
  const permGoc = useRef<Set<string>>(new Set(user.effectivePermissions ?? user.permissions ?? []));
  const permDaDoi = () =>
    perms.size !== permGoc.current.size || [...perms].some((p) => !permGoc.current.has(p));
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
      // `|| null` cho senderName/phone/title: modal này NẠP SẴN cả ba từ danh sách, nên admin xoá
      // trắng ô là một ý định rõ ràng — gửi `null` để máy chủ XOÁ thật. Gửi "" cũng ra cùng kết quả
      // (UserUpdateSchema quy "" về null), `null` chỉ nói thẳng ý định ra ở tầng payload.
      // `projectCode` đã đi đúng mẫu này từ trước.
      //
      // `username` KHÔNG còn trong payload: ô của nó là `<input disabled>`, tức form không cho người
      // dùng điều khiển — đúng hình dạng mà luật đã chốt cấm gửi. Hôm nay vô hại vì UserUpdateSchema
      // không khai khoá này nên zod strip im lặng, nhưng ngày nào ai đó thêm `username` vào schema
      // (vd cho đổi tên đăng nhập) thì dòng cũ lập tức thành lệnh ghi đè mỗi lần Lưu — và
      // `updateUser` KHÔNG gọi `timTaiKhoanTrung`, nên không có chốt chống trùng nào chặn lại.
      await api.updateUser(user.id, {
        displayName,
        // Ô Email NẠP SẴN ⇒ cùng luật với ba ô dưới: xoá trắng là XOÁ THẬT, gửi `null` để nói thẳng ý
        // định. Khác ba ô kia ở HỆ QUẢ, nên nhãn ô phải nói ra (xem chú thích ở ô bên dưới) và máy chủ
        // CHẶN đúng một ca: xoá email của tài khoản CHƯA kích hoạt, ca duy nhất làm tài khoản hết
        // đường dùng (không còn địa chỉ nhận lời mời, mà chưa có mật khẩu để đăng nhập) → 400.
        // KHÔNG gửi `null`: ô này không xoá được (xem chú thích ở ô nhập). Trống thì để `required`
        // của trình duyệt chặn tại chỗ, còn nếu lọt tới máy chủ thì `updateUser` trả 400 có lời giải.
        email: email.trim(),
        senderName: senderName.trim() || null, phone: phone.trim() || null,
        title: title.trim() || null,
        projectCode: projectCode.trim() || null,
        // ── CHỈ GỬI `role` KHI Ô TÍCH "QUẢN TRỊ" THẬT SỰ ĐỔI ────────────────────────────────
        // Modal này KHÔNG có ô chọn vai trò — chỉ có một ô tích "Quản trị". Gửi thẳng
        // `isAdmin ? "admin" : "manager"` nghĩa là mọi tài khoản hr / accountant / account_hn bị
        // ÂM THẦM hạ xuống "manager" chỉ vì admin vào sửa số điện thoại. Không có 400 nào chặn lại:
        // "manager" là giá trị hợp lệ của enum trong UserUpdateSchema.
        //
        // Đây đúng luật đã chốt cho ba trường hồ sơ, áp cho cả vai trò: form KHÔNG hiện giá trị
        // hiện tại thì KHÔNG được gửi trường đó lên. Chỉ khi ô tích đổi trạng thái mới là ý định
        // rõ ràng — và lúc đó "manager" là mặc định duy nhất hợp lý cho việc gỡ quyền quản trị.
        // (InviteModal ở trên thì NGƯỢC LẠI: hàng mới, chưa có vai trò nào để giữ, nên luôn gửi.)
        ...(isAdmin !== (user.role === "admin") ? { role: isAdmin ? "admin" : "manager" } : {}),
        // Gửi `permissions` CHỈ KHI có ý định thật: ô tích đổi, hoặc cờ Quản trị đổi (lúc đó `[]`
        // là tường minh — admin bỏ qua quyền per-user). Không đổi gì thì bỏ hẳn khoá, để máy chủ
        // giữ nguyên cột — xem `permGoc` ở trên. Backend tự đồng bộ cờ canSign từ quote:sign:own
        // KHI VÀ CHỈ KHI khoá này có mặt, nên bỏ khoá cũng là giữ nguyên canSign.
        ...(permDaDoi() || isAdmin !== (user.role === "admin") ? { permissions: isAdmin ? [] : [...perms] } : {}),
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
            {/* Trước 2026-09-18 email đặt được ĐÚNG MỘT LẦN lúc mời rồi khoá cứng: `USER_SELECT` trả
                cột này về nên giao diện ĐỌC được, nhưng không schema quản trị nào NHẬN nó — ảnh gương
                của ca `title` (ghi-được-không-đọc-được). Một địa chỉ gõ sai lúc mời là không ai sửa
                nổi, mà đó là nơi nhận thư mời và thư đặt lại mật khẩu.
                Ô này KHÔNG theo luật "bỏ trống = xoá" như ba ô dưới, và đó là ngoại lệ CÓ CHỦ Ý:
                email là đường DUY NHẤT để đặt lại mật khẩu, mà endpoint quên-mật-khẩu luôn trả 200 để
                chống dò tài khoản — nên email rỗng làm đường phục hồi chết IM LẶNG, người ta ngồi chờ
                một lá thư không bao giờ tới. Máy chủ chặn 400; `required` ở đây chỉ để người dùng biết
                trước khi bấm Lưu. Muốn bỏ một người thì KHOÁ tài khoản, đừng xoá email. */}
            <label className="full"><span>Email <em className="unit">(địa chỉ nhận thư mời · đặt lại mật khẩu)</em></span>
              <input type="email" required value={email} placeholder="vd: nhanvien@gianguyen.vn" aria-invalid={fieldErrors.email ? true : undefined} onChange={(e) => mark(setEmail)(e.target.value)} />
              {fieldErrors.email && <div className="field-err">{fieldErrors.email}</div>}</label>
            {/* Ô NẠP SẴN giá trị đang có ⇒ xoá trắng là XOÁ THẬT. Admin nhìn thấy "Chị Lan", xoá đi,
                bấm Lưu — kỳ vọng duy nhất là nó biến mất. Bản trước quy "" về "không đổi", nên
                giao diện báo "Đã lưu" mà cột vẫn nguyên: lưu mà không ăn. (Luật ngược lại chỉ áp
                cho ô KHÔNG nạp sẵn — vd màn Quên mật khẩu, nơi ô luôn rỗng bất kể CSDL có gì.) */}
            <label className="full"><span>Tên người gửi trên báo giá</span><input value={senderName} placeholder="Để trống = dùng Họ tên" onChange={(e) => mark(setSenderName)(e.target.value)} /></label>
            <label className="full"><span>SĐT</span><input type="tel" value={phone} onChange={(e) => mark(setPhone)(e.target.value)} /></label>
            {/* Cùng luật, cùng câu chữ với trang Hồ sơ cá nhân (web/src/pages/Profile.tsx) và màn
                #/onboard — một trường thì một cách gọi tên. Ô này IN LÊN BÁO GIÁ gửi khách (dòng
                chức danh dưới tên người gửi), nhưng trước 2026-09-17 `USER_SELECT` không trả
                `title` về nên modal không dựng nổi ô: admin ghi được qua API mà không đọc lại được,
                và người được mời qua email bỏ trống ô Chức danh ở #/onboard thì không ai sửa hộ
                được nữa. */}
            <label className="full"><span>Chức danh</span><input value={title} placeholder="VD: Account, Sale…" onChange={(e) => mark(setTitle)(e.target.value)} /></label>
            <label className="full"><span>Mã dự án <em className="unit">(chỉ phần chữ, vd FE_A — hệ thống tự thêm năm: FE_A{String(new Date().getFullYear()).slice(-2)}_001…)</em></span><input value={projectCode} placeholder="VD: FE_A" onChange={(e) => mark(setProjectCode)(e.target.value)} /></label>
          </div>
          <PermSection cat={cat} isAdmin={isAdmin} setAdmin={mark(setIsAdmin)} perms={perms} setPerms={mark(setPerms)} onPreview={onPreview} label={user.displayName || user.username} />
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
          {/* NÓI ĐÚNG LÝ DO. "Chưa cấu hình SMTP" và "SMTP từ chối" phải sửa ở hai chỗ khác nhau;
              gộp làm một là đẩy admin đi tìm nhầm chỗ — đúng chuyện đã xảy ra khi Gmail trả
              535 BadCredentials mà hộp thoại này vẫn báo "email chưa được cấu hình". */}
          <p style={{ marginTop: 0 }}>{result.emailSent
            ? <>Đã gửi email lời mời tới <b>{result.user.email}</b>.</>
            : result.emailSkipped
              ? <>Hệ thống <b>chưa cấu hình email</b> (thiếu <code>SMTP_HOST</code>) — hãy gửi <b>liên kết mời</b> này cho nhân viên:</>
              : <><b>Gửi email thất bại</b> — hãy gửi <b>liên kết mời</b> này cho nhân viên:</>}</p>
          {!result.emailSent && !result.emailSkipped && result.emailError && (
            <p className="muted" style={{ margin: "0 0 8px", fontSize: 12.5, wordBreak: "break-word" }}>
              Máy chủ thư báo: <code>{result.emailError}</code>
              {/^535|BadCredentials|Username and Password not accepted/i.test(result.emailError) &&
                <> — Gmail chỉ nhận <b>Mật khẩu ứng dụng</b> 16 ký tự (bật Xác minh 2 bước rồi tạo), không nhận mật khẩu Gmail thường. Sửa <code>SMTP_PASS</code> trên máy chủ.</>}
            </p>
          )}
          <div className="copy-row" style={{ marginTop: 8 }}>
            <input ref={ref} value={result.inviteUrl} readOnly aria-label="Liên kết mời" />
            <button className="btn" type="button" onClick={copy}>Sao chép</button>
          </div>
          <p className="muted" style={{ marginTop: 10 }}>Nhân viên mở liên kết → đặt mật khẩu + điền SĐT → đăng nhập bằng <b>email</b>. Lời mời hết hạn sau 7 ngày.</p>
        </div>
        <div className="modal-foot"><button className="btn" onClick={onClose}>Đóng</button></div>
      </div>
    </div>
  );
}
