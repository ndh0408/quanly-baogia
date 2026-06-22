import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError, type Me } from "./api";
import { PersonnelPage } from "./Personnel";

const ROLE_LABEL: Record<string, string> = {
  admin: "Quản trị", manager: "Account", account_hn: "Account HN", hr: "Nhân sự", accountant: "Kế toán",
};
export const roleLabel = (r: string) => ROLE_LABEL[r] ?? r;

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.me().then(setMe).catch(() => setMe(null)).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="center muted">Đang tải…</div>;
  if (!me) return <Login onLogin={setMe} />;

  return (
    <div className="app">
      <header className="topbar">
        <strong>Quản lý · Nhân sự</strong>
        <span className="spacer" />
        <span className="muted">{me.displayName} · {roleLabel(me.role)}</span>
        <button className="btn btn-sm" onClick={async () => { try { await api.logout(); } catch { /* ignore */ } location.reload(); }}>
          Đăng xuất
        </button>
      </header>
      <main className="container">
        <PersonnelPage me={me} />
      </main>
    </div>
  );
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
      <h1>Đăng nhập</h1>
      <input placeholder="Tên đăng nhập" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
      <input placeholder="Mật khẩu" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      {err && <div className="err">{err}</div>}
      <button className="btn btn-primary" type="submit" disabled={busy || !username || !password}>
        {busy ? "Đang đăng nhập…" : "Đăng nhập"}
      </button>
    </form>
  );
}
