import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type Me } from "../lib/api";
import { toast, fieldErrorsFrom, useEscClose } from "../lib/ui";
import { ROLE_LABEL, errMsg } from "../lib/format";

// Port "Tài khoản" (renderProfile) — bê ĐẦY ĐỦ 3 phần: Hồ sơ (họ tên/tên gửi/SĐT/chức danh,
// email+vai trò read-only) + Bảo mật 2 lớp MFA (bật QR/xác nhận/mã dự phòng · tắt password+token)
// + Đổi mật khẩu (thanh độ mạnh). Dùng class .account-grid/.card-section/.form-grid/.pw-meter SPA.
function pwScore(s: string) {
  let n = 0;
  if (s.length >= 8) n++;
  if (/[a-z]/.test(s) && /[A-Z]/.test(s)) n++;
  if (/\d/.test(s)) n++;
  if (/[^A-Za-z0-9]/.test(s)) n++;
  if (s.length >= 12) n++;
  return Math.min(n, 4);
}

export function ProfilePage({ me, onMe }: { me: Me; onMe: (m: Me) => void }) {
  const [displayName, setDisplayName] = useState(me.displayName || "");
  const [senderName, setSenderName] = useState(me.senderName || "");
  const [phone, setPhone] = useState(me.phone || "");
  const [title, setTitle] = useState(me.title || "");
  const [savingP, setSavingP] = useState(false);

  const [mfaOn, setMfaOn] = useState(!!me.mfaEnabled);
  const [mfaModal, setMfaModal] = useState<null | "setup" | "disable">(null);

  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [newPw2, setNewPw2] = useState("");
  const [savingPw, setSavingPw] = useState(false);
  // Lỗi INLINE từng ô (server trả details[].path: oldPassword/newPassword; newPw2 = lỗi khớp phía client)
  // — pattern .field-err + aria-invalid như CustomerForm, thay vì chỉ toast chuỗi gộp.
  const [pwErrors, setPwErrors] = useState<Record<string, string>>({});
  const clearPwErr = (k: string) => setPwErrors((fe) => (fe[k] ? { ...fe, [k]: "" } : fe));

  const saveProfile = async (e: FormEvent) => {
    e.preventDefault(); setSavingP(true);
    try { const u = await api.updateProfile({ displayName, senderName, phone, title }); onMe({ ...me, ...u }); toast("Đã lưu hồ sơ", "success"); }
    catch (ex) { toast(errMsg(ex, "Lỗi"), "error"); }
    finally { setSavingP(false); }
  };
  const changePw = async (e: FormEvent) => {
    e.preventDefault();
    if (newPw !== newPw2) { setPwErrors({ newPw2: "Mật khẩu nhập lại không khớp" }); toast("Mật khẩu nhập lại không khớp", "error"); return; }
    setPwErrors({});
    setSavingPw(true);
    try { await api.changePassword(oldPw, newPw); toast("Đã đổi mật khẩu", "success"); setOldPw(""); setNewPw(""); setNewPw2(""); }
    catch (ex) {
      const fe = fieldErrorsFrom(ex);
      setPwErrors(fe);
      toast(Object.keys(fe).length ? "Vui lòng kiểm tra các ô được tô đỏ." : errMsg(ex, "Lỗi"), "error");
    }
    finally { setSavingPw(false); }
  };

  const sc = pwScore(newPw);
  const pct = [6, 28, 55, 80, 100][sc];
  const col = ["var(--danger)", "var(--danger)", "var(--warn)", "var(--success)", "var(--success)"][sc];
  const lbl = ["Rất yếu", "Yếu", "Trung bình", "Mạnh", "Rất mạnh"][sc];

  return (
    <div>
      <h1>Tài khoản</h1>
      <p className="page-sub muted">Hồ sơ cá nhân, bảo mật 2 lớp (MFA) và đổi mật khẩu.</p>
      <div className="account-grid">
        <section className="card-section">
          <h3>Hồ sơ</h3>
          <form className="form-grid" onSubmit={saveProfile}>
            <label className="full">Họ tên <b className="req">*</b><input value={displayName} required onChange={(e) => setDisplayName(e.target.value)} /></label>
            <label className="full">Tên người gửi trên báo giá<input value={senderName} placeholder="Để trống = dùng Họ tên" onChange={(e) => setSenderName(e.target.value)} /></label>
            <label>Số điện thoại<input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></label>
            <label>Chức danh<input value={title} placeholder="VD: Account, Sale…" onChange={(e) => setTitle(e.target.value)} /></label>
            <label>Email<input value={me.email || "—"} disabled /></label>
            <label>Vai trò<input value={ROLE_LABEL[me.role] || me.role} disabled /></label>
            <div className="full"><button className="btn btn-primary" type="submit" disabled={savingP}>{savingP ? "Đang lưu…" : "Lưu hồ sơ"}</button></div>
          </form>
        </section>

        <section className="card-section">
          <h3>Bảo mật 2 lớp (MFA)</h3>
          {mfaOn ? (
            <>
              <p>Trạng thái: <span className="status approved">Đang bật</span></p>
              <button className="btn btn-danger" onClick={() => setMfaModal("disable")}>Tắt bảo mật 2 lớp</button>
            </>
          ) : (
            <>
              <p>Trạng thái: <span className="status draft">Chưa bật</span></p>
              <p className="muted">Yêu cầu mã từ ứng dụng (Google Authenticator, Authy…) mỗi lần đăng nhập — tăng bảo mật cho tài khoản.</p>
              <button className="btn btn-primary" onClick={() => setMfaModal("setup")}>Bật bảo mật 2 lớp</button>
            </>
          )}
        </section>

        <section className="card-section">
          <h3>Đổi mật khẩu</h3>
          <form onSubmit={changePw} autoComplete="off">
            <p className="muted" style={{ marginTop: 0 }}>Mật khẩu mới tối thiểu 8 ký tự, gồm cả chữ và số.</p>
            <label className="pf-field"><span>Mật khẩu cũ</span>
              <input type="password" autoComplete="current-password" required value={oldPw}
                aria-invalid={pwErrors.oldPassword ? true : undefined}
                onChange={(e) => { setOldPw(e.target.value); clearPwErr("oldPassword"); }} />
              {pwErrors.oldPassword && <div className="field-err">{pwErrors.oldPassword}</div>}
            </label>
            <label className="pf-field"><span>Mật khẩu mới</span>
              <input type="password" autoComplete="new-password" required minLength={8} maxLength={128} value={newPw}
                aria-invalid={pwErrors.newPassword ? true : undefined}
                onChange={(e) => { setNewPw(e.target.value); clearPwErr("newPassword"); }} />
              {pwErrors.newPassword && <div className="field-err">{pwErrors.newPassword}</div>}
            </label>
            {/* Thanh độ mạnh CHỈ hiện khi đã gõ — trước đây thanh rỗng luôn hiện thành vạch xám (divider lạc chỗ)
                và "Độ mạnh: —" dính vào label kế. Bọc nhóm + margin tách rõ khỏi ô "Nhập lại". */}
            {newPw && (
              <div className="pw-strength">
                <div className="pw-meter" aria-hidden="true"><i style={{ width: pct + "%", background: col }} /></div>
                <div className="pw-hint">Độ mạnh: <b style={{ color: col }}>{lbl}</b></div>
              </div>
            )}
            <label className="pf-field"><span>Nhập lại mật khẩu mới</span>
              <input type="password" autoComplete="new-password" required minLength={8} maxLength={128} value={newPw2}
                aria-invalid={pwErrors.newPw2 ? true : undefined}
                onChange={(e) => { setNewPw2(e.target.value); clearPwErr("newPw2"); }} />
              {pwErrors.newPw2 && <div className="field-err">{pwErrors.newPw2}</div>}
            </label>
            <button className="btn btn-primary" type="submit" disabled={savingPw}>{savingPw ? "Đang đổi…" : "Đổi mật khẩu"}</button>
          </form>
        </section>
      </div>

      {mfaModal === "setup" && <MfaSetupModal onClose={() => setMfaModal(null)} onEnabled={() => { setMfaOn(true); setMfaModal(null); onMe({ ...me, mfaEnabled: true }); }} />}
      {mfaModal === "disable" && <MfaDisableModal onClose={() => setMfaModal(null)} onDisabled={() => { setMfaOn(false); setMfaModal(null); onMe({ ...me, mfaEnabled: false }); }} />}
    </div>
  );
}

function MfaSetupModal({ onClose, onEnabled }: { onClose: () => void; onEnabled: () => void }) {
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [codes, setCodes] = useState<string[] | null>(null);
  const tokenRef = useRef<HTMLInputElement>(null);

  // Tải mã QR/secret qua TanStack Query (thay api.mfaSetup().then(...) thủ công). Giữ nguyên hiển thị
  // "Đang tạo mã…" / lỗi "Lỗi tạo mã" (+ nút Thử lại khi lỗi mạng).
  const { data: setup, error, refetch } = useQuery({
    queryKey: ["mfaSetup"],
    queryFn: () => api.mfaSetup(),
    gcTime: 0,
  });
  const err = error ? errMsg(error, "Lỗi tạo mã") : "";

  // ESC: chưa có mã dự phòng → Hủy; ĐÃ có mã (MFA đã bật) → khớp hành vi nút ✕ = Xong.
  useEscClose(codes ? onEnabled : onClose);
  // Autofocus ô nhập đầu tiên khi QR sẵn sàng — mở modal xong không phải rê chuột.
  useEffect(() => { if (setup && !codes) tokenRef.current?.focus(); }, [setup, codes]);

  const enable = async () => {
    if (!/^\d{6}$/.test(token.trim())) { toast("Nhập đúng mã 6 số", "error"); return; }
    if (!password) { toast("Vui lòng nhập mật khẩu", "error"); return; }
    if (!setup) return;
    setSaving(true);
    try { const r = await api.mfaEnable({ secret: setup.secret, token: token.trim(), password }); setCodes(r.backupCodes || []); toast("Đã bật MFA", "success"); }
    catch (ex) { toast(errMsg(ex, "Lỗi"), "error"); setSaving(false); }
  };
  const copyCodes = async () => {
    if (!codes) return;
    let ok = false;
    try { if (navigator.clipboard) { await navigator.clipboard.writeText(codes.join("\n")); ok = true; } } catch { ok = false; }
    toast(ok ? "Đã sao chép mã dự phòng" : "Chưa sao chép được — hãy chép tay các mã trên", ok ? "success" : "error");
  };

  return (
    <div className="modal-backdrop" onClick={() => !codes && onClose()}>
      <div className="modal modal-sm" role="dialog" aria-modal="true" aria-label="Bật bảo mật 2 lớp" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h3>Bật bảo mật 2 lớp</h3><button className="x" onClick={() => (codes ? onEnabled() : onClose())} aria-label="Đóng">✕</button></div>
        <div className="modal-body">
          {err && <div className="err">⚠ {err} <button type="button" className="btn btn-sm" onClick={() => refetch()}>Thử lại</button></div>}
          {!setup && !err && <div className="muted">Đang tạo mã…</div>}
          {setup && !codes && (
            <form id="mfa-setup-form" onSubmit={(e) => { e.preventDefault(); enable(); }}>
              <p><b>1.</b> Quét mã QR bằng app xác thực (Google Authenticator, Authy…):</p>
              <div style={{ textAlign: "center" }}><img src={setup.qr} alt="Mã QR MFA" style={{ width: 184, height: 184, border: "1px solid var(--line)", borderRadius: 8 }} /></div>
              <p className="muted" style={{ wordBreak: "break-all" }}>Hoặc nhập tay khóa: <b>{setup.secret}</b></p>
              <div className="grid">
                <label className="full"><span><b>2.</b> Mã 6 số đang hiện trên app</span><input ref={tokenRef} inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="123456" value={token} onChange={(e) => setToken(e.target.value)} /></label>
                <label className="full"><span><b>3.</b> Mật khẩu tài khoản (xác nhận)</span><input type="password" autoComplete="current-password" placeholder="Mật khẩu" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
              </div>
            </form>
          )}
          {codes && (
            <div style={{ marginTop: 4, padding: 12, background: "var(--card-2)", borderRadius: 8 }}>
              <b>Mã dự phòng</b> — lưu lại nơi an toàn, mỗi mã dùng 1 lần khi không có điện thoại:
              <div style={{ fontFamily: "monospace", marginTop: 8, columns: 2 }}>{codes.map((c) => <div key={c}>{c}</div>)}</div>
              <button type="button" className="btn btn-sm" style={{ marginTop: 10 }} onClick={copyCodes}>Sao chép mã</button>
            </div>
          )}
        </div>
        <div className="modal-foot">
          {codes ? <button className="btn btn-primary" onClick={onEnabled}>Xong</button>
            : <><button className="btn" onClick={onClose}>Hủy</button><button className="btn btn-primary" type="submit" form="mfa-setup-form" disabled={!setup || saving}>{saving ? "Đang bật…" : "Xác nhận bật"}</button></>}
        </div>
      </div>
    </div>
  );
}

function MfaDisableModal({ onClose, onDisabled }: { onClose: () => void; onDisabled: () => void }) {
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);
  const pwRef = useRef<HTMLInputElement>(null);
  useEscClose(onClose);
  useEffect(() => { pwRef.current?.focus(); }, []);
  const disable = async () => {
    if (!password || !token.trim()) { toast("Nhập mật khẩu và mã xác thực", "error"); return; }
    setSaving(true);
    try { await api.mfaDisable({ password, token: token.trim() }); toast("Đã tắt MFA", "success"); onDisabled(); }
    catch (ex) { toast(errMsg(ex, "Lỗi"), "error"); setSaving(false); }
  };
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-sm" role="dialog" aria-modal="true" aria-label="Tắt bảo mật 2 lớp" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h3>Tắt bảo mật 2 lớp</h3><button className="x" onClick={onClose} aria-label="Đóng">✕</button></div>
        <div className="modal-body">
          <form id="mfa-disable-form" onSubmit={(e) => { e.preventDefault(); disable(); }}>
            <div className="grid">
              <label className="full"><span>Mật khẩu hiện tại</span><input ref={pwRef} type="password" autoComplete="current-password" placeholder="Mật khẩu" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
              <label className="full"><span>Mã 6 số (hoặc mã dự phòng)</span><input autoComplete="one-time-code" placeholder="123456" value={token} onChange={(e) => setToken(e.target.value)} /></label>
            </div>
          </form>
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>Hủy</button>
          <button className="btn btn-danger" type="submit" form="mfa-disable-form" disabled={saving}>{saving ? "Đang tắt…" : "Tắt MFA"}</button>
        </div>
      </div>
    </div>
  );
}
