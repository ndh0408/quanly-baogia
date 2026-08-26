import { Component, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { api, ApiError, setPreviewMode, type Me } from "./lib/api";
import { Shell } from "./components/Shell";
import { promptModal, toast } from "./lib/ui";

export type PreviewState = { perms: string[]; label: string };

// Bắt lỗi render để 1 lỗi không làm TRẮNG toàn app — hiện màn lỗi + nút tải lại.
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { console.error("[ErrorBoundary]", error); }
  render() {
    if (this.state.error) {
      return (
        <div className="center" style={{ flexDirection: "column", gap: 12, padding: 24, textAlign: "center" }}>
          <div style={{ fontSize: 40 }}>⚠️</div>
          <h2>Đã xảy ra lỗi hiển thị</h2>
          <p className="muted">{this.state.error.message || "Lỗi không xác định"}</p>
          <button className="btn btn-primary" onClick={() => location.reload()}>Tải lại trang</button>
        </div>
      );
    }
    return this.props.children;
  }
}

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [hash, setHash] = useState(location.hash);
  const [preview, setPreview] = useState<PreviewState | null>(null); // đang XEM THỬ quyền của 1 tài khoản
  // MẤT PHIÊN giữa chừng → BẬT LỚP PHỦ, KHÔNG unmount cây component.
  //
  // Trước đây: mọi 401 chạy `setMe(null)`, mà ngay dưới có `if (!me) return <Login/>` — nghĩa là
  // <Shell> và <QuoteEditor> bị GỠ khỏi cây, toàn bộ báo giá đang soạn (sống trong state của
  // QuoteEditor) bay sạch. Không có bản nháp nào được lưu: pendingQuote.ts chỉ giữ biến in-memory,
  // và cleanup của editor còn xoá cờ __editorDirty nên beforeunload cũng không kịp cảnh báo.
  //
  // Nguồn 401 KHÔNG do người dùng bấm là có thật: middleware chặn khi tài khoản bị khoá/vô hiệu
  // hoặc khi passwordChangedAt mới hơn thời điểm đăng nhập — cộng thêm nhịp tim presence 30 giây
  // vẫn nện vào server suốt lúc người ta đang gõ. Người dùng gõ nửa tiếng rồi mất trắng.
  //
  // Nay: giữ nguyên cây đang mount, phủ một hộp đăng nhập lại lên trên. Đăng nhập xong đóng hộp,
  // dữ liệu trong state editor còn nguyên vẹn, bấm Lưu lại là xong.
  const [matPhien, setMatPhien] = useState(false);

  useEffect(() => {
    api.me().then(setMe).catch(() => setMe(null)).finally(() => setLoading(false));
    const onExpired = () => setMatPhien(true);
    const onHash = () => setHash(location.hash);
    // Xem thử: mỗi thao tác GHI (giả) → nhắc nhẹ (throttle) rằng không lưu thật.
    let last = 0;
    const onPreviewWrite = () => { const now = Date.now(); if (now - last > 2500) { last = now; toast("🔍 Xem thử — thao tác chạy thử, KHÔNG lưu thật", "info"); } };
    window.addEventListener("auth:expired", onExpired);
    window.addEventListener("hashchange", onHash);
    window.addEventListener("preview:write", onPreviewWrite);
    return () => { window.removeEventListener("auth:expired", onExpired); window.removeEventListener("hashchange", onHash); window.removeEventListener("preview:write", onPreviewWrite); };
  }, []);

  const enterPreview = (perms: string[], label: string) => { setPreview({ perms, label }); setPreviewMode(true); location.hash = "#/dashboard"; window.scrollTo(0, 0); };
  const exitPreview = () => { setPreviewMode(false); setPreview(null); };

  // Onboard (kích hoạt tài khoản mời) — hiện cả khi chưa đăng nhập; server gửi link tới /#/onboard?token=
  if (hash.startsWith("#/onboard")) return <OnboardPage onLogin={setMe} />;
  if (loading) return <div className="center muted">Đang tải…</div>;
  // Chưa từng đăng nhập → màn đăng nhập đầy đủ. (Lớp phủ chỉ dành cho phiên MẤT giữa chừng.)
  if (!me) return <Login onLogin={(m) => { setMatPhien(false); setMe(m); }} />;
  // Khi xem thử: GIỮ identity admin (server) nhưng ĐỔI permissions sang tài khoản đang xem → UI hiện đúng quyền đó.
  const shellMe: Me = preview ? { ...me, permissions: preview.perms } : me;
  return (
    <ErrorBoundary>
      {preview && (
        <div className="preview-banner">
          <span>🔍 ĐANG XEM THỬ với quyền của <b>{preview.label}</b> — mọi thao tác chỉ chạy thử, <b>KHÔNG lưu thật</b>.</span>
          <button className="btn btn-sm" onClick={exitPreview}>✕ Thoát xem thử</button>
        </div>
      )}
      <div className={preview ? "has-preview-banner" : undefined}>
        <Shell me={shellMe} onMe={setMe} onPreview={enterPreview} />
      </div>
      {matPhien && (
        <SessionLostOverlay
          me={me}
          onLogin={(m) => {
            setMatPhien(false);
            // ĐĂNG NHẬP LẠI BẰNG TÀI KHOẢN KHÁC thì KHÔNG được giữ màn hình cũ: phía sau lớp phủ
            // đang là dữ liệu + quyền của người trước. Nạp lại sạch. Cùng người → giữ nguyên,
            // đó chính là mục đích của lớp phủ này.
            if (m.id !== me.id) { location.reload(); return; }
            setMe(m);
          }}
        />
      )}
    </ErrorBoundary>
  );
}

/**
 * Lớp phủ ĐĂNG NHẬP LẠI — hiện ĐÈ LÊN ứng dụng đang mở, không thay thế nó.
 *
 * Cố ý KHÔNG có nút đóng và KHÔNG đóng khi bấm ra ngoài: phiên đã mất thì mọi thao tác phía sau
 * đều sẽ 401, để người dùng bấm loạn vào đó chỉ tạo thêm thông báo lỗi. Đường ra duy nhất là đăng
 * nhập lại, hoặc tải lại trang (mất dữ liệu — nên nút đó nói rõ điều đó).
 */
function SessionLostOverlay({ me, onLogin }: { me: Me; onLogin: (m: Me) => void }) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Phiên đăng nhập đã hết">
      <div className="modal modal-sm">
        <Login onLogin={onLogin} lopPhu tenGoiY={me.username} />
      </div>
    </div>
  );
}

// Login — class SPA + MFA (lộ ô mã khi server yêu cầu) + Quên mật khẩu.
// `lopPhu`: dùng lại đúng form này bên trong lớp phủ ĐĂNG NHẬP LẠI (SessionLostOverlay) — cùng một
// đường xử lý MFA / khoá tài khoản / thông báo lỗi, không nhân đôi logic đăng nhập thành hai bản.
function Login({ onLogin, lopPhu = false, tenGoiY }: { onLogin: (m: Me) => void; lopPhu?: boolean; tenGoiY?: string }) {
  const [username, setUsername] = useState(tenGoiY ?? "");
  const [password, setPassword] = useState("");
  const [mfaToken, setMfaToken] = useState("");
  const [mfaShown, setMfaShown] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(""); setBusy(true);
    try {
      const m = await api.login(username, password, mfaToken.trim() || undefined);
      onLogin(m);
    } catch (ex) {
      // Server yêu cầu lớp 2 → lộ ô MFA và cho nhập lại.
      const body = ex instanceof ApiError ? (ex.body as { mfaRequired?: boolean } | undefined) : undefined;
      if (body?.mfaRequired) {
        setMfaShown(true);
        setErr(mfaToken.trim() ? "Mã MFA không đúng, thử lại." : "Tài khoản đã bật MFA — vui lòng nhập mã xác thực.");
      } else {
        setErr(ex instanceof ApiError ? ex.message : "Đăng nhập thất bại");
      }
      setBusy(false);
    }
  };

  const forgot = async (e: FormEvent) => {
    e.preventDefault();
    const email = await promptModal("Quên mật khẩu", "Nhập email tài khoản của bạn — chúng tôi sẽ gửi liên kết đặt lại mật khẩu:", { placeholder: "ten@congty.com", confirmText: "Gửi liên kết" });
    if (!email) return;
    try { await api.forgotPassword(email.trim()); toast("Nếu email tồn tại, liên kết đặt lại đã được gửi. Vui lòng kiểm tra hộp thư.", "success"); }
    catch (ex) { toast(ex instanceof ApiError ? ex.message : "Lỗi", "error"); }
  };

  return (
    <div className={lopPhu ? "login-card" : "login-wrap"}>
      <div className={lopPhu ? undefined : "login-card"}>
        {lopPhu ? (
          <>
            <h1>Phiên đăng nhập đã hết</h1>
            <p className="sub">Đăng nhập lại để tiếp tục — <b>bản báo giá bạn đang soạn vẫn còn nguyên</b>.</p>
          </>
        ) : (
          <>
            <h1>Quản Lý</h1>
            <p className="sub">Gia Nguyễn — Hệ thống nội bộ</p>
          </>
        )}
        {err && <div className="err" role="alert">{err}</div>}
        <form id="login-form" onSubmit={submit}>
          <label><span>Email hoặc tên đăng nhập</span>
            <input name="username" autoComplete="username" required autoFocus value={username} onChange={(e) => setUsername(e.target.value)} /></label>
          <label><span>Mật khẩu</span>
            <span className="pw-wrap">
              <input type={showPw ? "text" : "password"} name="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
              <button type="button" className="pw-toggle" tabIndex={-1} aria-label="Hiện / ẩn mật khẩu" onClick={() => setShowPw((s) => !s)}>{showPw ? "🙈" : "👁"}</button>
            </span>
          </label>
          <label id="mfa-field" style={{ display: mfaShown ? "" : "none" }}><span>Mã xác thực (MFA)</span>
            <input name="mfaToken" autoComplete="one-time-code" pattern="[0-9A-Za-z]{6,8}" placeholder="Mã 6 số hoặc mã dự phòng" value={mfaToken} onChange={(e) => setMfaToken(e.target.value)} /></label>
          <button type="submit" className="btn-login" disabled={busy || !username || !password} aria-busy={busy}>
            {busy ? "Đang đăng nhập…" : "Đăng nhập"}
          </button>
        </form>
        <p className="login-hint"><a href="#" onClick={forgot}>Quên mật khẩu?</a></p>
      </div>
    </div>
  );
}

// Onboard — đọc token từ URL, tải lời mời, kích hoạt tài khoản + đăng nhập.
function OnboardPage({ onLogin }: { onLogin: (m: Me) => void }) {
  const token = new URLSearchParams(location.hash.split("?")[1] || "").get("token") || "";
  const [info, setInfo] = useState<{ email: string; displayName?: string } | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [form, setForm] = useState({ displayName: "", senderName: "", phone: "", title: "", password: "", password2: "" });
  const [showPw, setShowPw] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) { setLoadErr("Liên kết không hợp lệ."); return; }
    api.getInvite(token).then((i) => { setInfo(i); setForm((f) => ({ ...f, displayName: i.displayName || "" })); }).catch((ex) => setLoadErr(ex instanceof ApiError ? ex.message : "Lời mời không hợp lệ hoặc đã hết hạn."));
  }, [token]);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr("");
    if (form.password !== form.password2) { setErr("Mật khẩu nhập lại không khớp."); return; }
    setBusy(true);
    try {
      const m = await api.acceptInvite({ token, displayName: form.displayName, senderName: form.senderName, phone: form.phone, title: form.title, password: form.password });
      location.hash = "#/list"; onLogin(m); toast("Chào mừng! Tài khoản đã được kích hoạt.", "success");
    } catch (ex) {
      const d = ex instanceof ApiError ? (ex.body as { details?: { message?: string }[] } | undefined)?.details : undefined;
      setErr((Array.isArray(d) && d[0]?.message) || (ex instanceof ApiError ? ex.message : "Lỗi kích hoạt")); setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <div className="login-card">
        {loadErr ? (
          <><div className="err">{loadErr}</div><p className="login-hint">Liên hệ quản trị viên để được mời lại.</p></>
        ) : !info ? <div className="muted">Đang kiểm tra lời mời…</div> : (
          <>
            <h1>Hoàn tất tài khoản</h1>
            <p className="sub">{info.email}</p>
            {err && <div className="err" role="alert">{err}</div>}
            <form id="ob-form" onSubmit={submit}>
              <label><span>Họ tên</span><input required value={form.displayName} autoFocus onChange={(e) => set("displayName", e.target.value)} /></label>
              <label><span>Tên người gửi trên báo giá</span><input placeholder="Để trống = dùng Họ tên" value={form.senderName} onChange={(e) => set("senderName", e.target.value)} /></label>
              <label><span>Số điện thoại</span><input type="tel" inputMode="tel" autoComplete="tel" placeholder="09xx xxx xxx" value={form.phone} onChange={(e) => set("phone", e.target.value)} /></label>
              <label><span>Chức danh</span><input placeholder="VD: Account, Sale…" value={form.title} onChange={(e) => set("title", e.target.value)} /></label>
              <label><span>Mật khẩu</span>
                <span className="pw-wrap"><input type={showPw ? "text" : "password"} autoComplete="new-password" minLength={8} required placeholder="Tối thiểu 8 ký tự, gồm chữ và số" value={form.password} onChange={(e) => set("password", e.target.value)} />
                  <button type="button" className="pw-toggle" tabIndex={-1} aria-label="Hiện / ẩn mật khẩu" onClick={() => setShowPw((s) => !s)}>{showPw ? "🙈" : "👁"}</button></span></label>
              <label><span>Nhập lại mật khẩu</span><input type={showPw ? "text" : "password"} autoComplete="new-password" required value={form.password2} onChange={(e) => set("password2", e.target.value)} /></label>
              <button type="submit" className="btn-login" disabled={busy} aria-busy={busy}>{busy ? "Đang kích hoạt…" : "Kích hoạt & đăng nhập"}</button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
