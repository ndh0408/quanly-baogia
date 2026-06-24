import { Component, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { api, ApiError, type Me } from "./api";
import { Shell } from "./Shell";

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

  useEffect(() => {
    api.me().then(setMe).catch(() => setMe(null)).finally(() => setLoading(false));
    const onExpired = () => setMe(null); // mất phiên 401 → về đăng nhập
    window.addEventListener("auth:expired", onExpired);
    return () => window.removeEventListener("auth:expired", onExpired);
  }, []);

  if (loading) return <div className="center muted">Đang tải…</div>;
  if (!me) return <Login onLogin={setMe} />;
  return <ErrorBoundary><Shell me={me} /></ErrorBoundary>;
}

function Login({ onLogin }: { onLogin: (m: Me) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(""); setBusy(true);
    try {
      await api.login(username, password);
      onLogin(await api.me());
    } catch (ex) {
      setErr(ex instanceof ApiError ? ex.message : "Đăng nhập thất bại");
      setBusy(false);
    }
  };

  return (
    <form className="login" onSubmit={submit}>
      <div className="brand" style={{ border: "none", padding: 0, marginBottom: 6 }}>
        <span className="brand-logo">GN</span><strong>Quản lý · Gia Nguyễn</strong>
      </div>
      <input placeholder="Tên đăng nhập" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
      <input placeholder="Mật khẩu" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      {err && <div className="err">⚠ {err}</div>}
      <button className="btn btn-primary" type="submit" disabled={busy || !username || !password}>
        {busy ? "Đang đăng nhập…" : "Đăng nhập"}
      </button>
    </form>
  );
}
