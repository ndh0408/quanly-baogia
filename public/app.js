// SPA quản lý báo giá - multi-sheet, multi-template
import { parseClipboardTSV, cellsToTSV, cellsToHTML, parseLooseNumber, reconstructExportRows, looksLikeExportPaste } from "./grid-clipboard.js?v=20260617d";
import {
  fmtMoney, quoteTotals, fmtDate, vnDateText, escapeHtml, safeLogoSrc,
  pvRowspan, pvMoney, nl2br, groupLetter, pvRows, baoGiaTitleJS,
  STATUS_LABEL, statusLabel, ROLE_LABEL, ROLE_LABEL_FULL,
  RESOURCE_LABEL, ACTION_LABEL, actionLabel, resourceLabel,
} from "./js/util.js?v=20260618c";

const app = document.getElementById("app");

// Client-side permission mirror of the server catalog (from /api/auth/me).
// Only gates UI visibility — the server is always the source of truth.
function can(perm) {
  const perms = state.user?.permissions;
  if (!perms) return false;
  if (perms.includes(perm)) return true;
  // ":own" is implied by ":all"
  if (perm.endsWith(":own")) return perms.includes(perm.replace(/:own$/, ":all"));
  return false;
}
function canOnQuote(action, q) {
  if (can(`quote:${action}:all`)) return true;
  if (can(`quote:${action}:own`)) return q && q.createdById === state.user?.id;
  return false;
}

// Role-appropriate landing page when no specific route is requested: managers/
// admins get the overview dashboard; salespeople go straight to their list.
function landingPage() {
  const r = state.user?.role;
  return (r === "admin" || r === "manager") ? "dashboard" : "list";
}

const state = {
  user: null,
  page: "list",
  quoteList: [],
  currentQuote: null,
  filter: { q: "", status: "" },
  users: [],
  companies: [],   // [{ id, name, templates: [...] }]
  templates: [],   // [{ id, code, name, companyId }]
};

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    ...opts,
  });
  let body;
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) body = await res.json();
  else body = await res.text();
  // A 401 while already logged in = session expired → bounce to login.
  // But NOT during the login attempt itself (state.user is null), so the login
  // form can surface the real message ("Sai mật khẩu" / "Tài khoản bị khóa"…).
  if (res.status === 401 && state.user) {
    state.user = null;
    render();
    throw new Error((body && body.error) || "Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại");
  }
  if (!res.ok) {
    // Build a human-readable message. Validation errors arrive as a generic
    // `error` ("Dữ liệu không hợp lệ") plus field-level `details`; prefer the
    // concrete reasons so the user sees exactly what failed and how to fix it.
    let msg = (body && body.error) || body || "Lỗi";
    if (body && Array.isArray(body.details) && body.details.length) {
      const reasons = body.details.map((d) => d.message).filter(Boolean).join(". ");
      if (reasons) msg = reasons;
    }
    const err = new Error(msg);
    if (body && body.details) err.details = body.details;
    err.status = res.status;
    err.body = body; // expose full body (e.g. { mfaRequired: true }) to callers
    throw err;
  }
  return body;
}

function toast(msg, type = "info") {
  // Persistent live region so screen readers announce toasts (errors = assertive).
  let region = document.getElementById("toast-region");
  if (!region) {
    region = document.createElement("div");
    region.id = "toast-region";
    region.setAttribute("aria-live", "polite");
    region.setAttribute("aria-atomic", "true");
    document.body.appendChild(region);
  }
  region.setAttribute("aria-live", type === "error" ? "assertive" : "polite");
  const t = document.createElement("div");
  t.className = "toast " + type;
  t.setAttribute("role", type === "error" ? "alert" : "status");
  t.textContent = msg;
  region.appendChild(t);
  setTimeout(() => t.remove(), 2400);
}

// Skeleton loader markup — used while data is being fetched.
function skeleton(rows = 5, tall = false) {
  return `<div class="skeleton">${Array.from({ length: rows })
    .map(() => `<div class="sk-line${tall ? " tall" : ""}"></div>`).join("")}</div>`;
}

// Attribute string that makes a non-button element keyboard-operable. Add it to
// any clickable <div>/<span> and they become focusable + Enter/Space activatable
// (WCAG 2.1.1). One delegated handler (installKeyActivation) does the activation,
// so this survives re-renders without per-element wiring.
const KBD = 'role="button" tabindex="0" data-kbd';
function installKeyActivation() {
  if (window._keyActivationWired) return;
  window._keyActivationWired = true;
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " " && e.key !== "Spacebar") return;
    if (["INPUT", "TEXTAREA", "SELECT", "BUTTON", "A"].includes(e.target.tagName)) return;
    const el = e.target.closest("[data-kbd]");
    if (!el) return;
    e.preventDefault();
    el.click();
  });
  // Native guard: warns on tab-close / refresh / external nav while the quote
  // editor has unsaved changes (window._editorDirty). In-app navigation is guarded
  // separately by leaveEditorGuard().
  window.addEventListener("beforeunload", (e) => {
    if (window._editorDirty) { e.preventDefault(); e.returnValue = ""; }
  });
}

// Ask before leaving the editor with unsaved changes. Returns true if it's safe
// to proceed (no changes, or the user confirmed discarding them).
async function leaveEditorGuard() {
  if (!window._editorDirty) return true;
  const ok = await confirmModal(
    "Rời khỏi báo giá?",
    "Bạn có thay đổi CHƯA LƯU. Rời đi sẽ mất các thay đổi này.",
    { danger: true, confirmText: "Rời đi (bỏ thay đổi)" }
  );
  if (ok) window._editorDirty = false;
  return ok;
}

// Standard error state for a page whose data failed to load — replaces the
// "stuck skeleton" anti-pattern with a clear message + a retry button.
function errorState(message, onRetry) {
  const id = "err-retry-" + Math.random().toString(36).slice(2);
  setTimeout(() => { const b = document.getElementById(id); if (b && onRetry) b.addEventListener("click", onRetry); }, 0);
  return `<div class="error-state" role="alert">
    <div class="es-icon">⚠️</div>
    <div class="es-msg">${escapeHtml(message || "Không tải được dữ liệu")}</div>
    <button class="btn btn-primary" id="${id}">Thử lại</button>
  </div>`;
}

// Navigate to a quote via the hash router so Back/F5/bookmark/deep-links work.
function goToQuote(id) { location.hash = "#/quotes/" + id; }

// Map server validation details ([{path,message}]) to INLINE field errors instead
// of a disappearing toast. Finds an input by id f-<path> / w-<path> or name=<path>,
// sets aria-invalid, shows a .field-err message, and focuses the first bad field.
// Returns true if at least one field was matched.
function applyFieldErrors(err) {
  const details = err && err.details;
  if (!Array.isArray(details) || !details.length) return false;
  document.querySelectorAll("[aria-invalid='true']").forEach((el) => el.removeAttribute("aria-invalid"));
  document.querySelectorAll(".field-err").forEach((el) => el.remove());
  let firstBad = null;
  for (const d of details) {
    const top = String(d.path || "").split(".")[0];
    if (!top || !/^[\w-]+$/.test(top)) continue; // skip non-identifier paths (selector-injection safe)
    const field = document.getElementById("f-" + top) || document.getElementById("w-" + top) || document.querySelector(`[name="${top}"]`);
    if (!field) continue;
    field.setAttribute("aria-invalid", "true");
    const msg = document.createElement("div");
    msg.className = "field-err";
    msg.textContent = d.message;
    (field.closest("label") || field).insertAdjacentElement("afterend", msg);
    if (!firstBad) firstBad = field;
  }
  if (firstBad) { firstBad.focus(); return true; }
  return false;
}

// Pure format/label/preview helpers + groupLetter -> moved to ./js/util.js (imported at top).

// Theme: persist in localStorage, default to OS preference on first visit.
function initTheme() {
  let t = localStorage.getItem("theme");
  if (!t) {
    t = (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light";
  }
  document.documentElement.setAttribute("data-theme", t);
}
function toggleTheme() {
  const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("theme", next);
}

// Monochrome line icons (Lucide-style) for the sidebar — replaces childish emoji.
const ICO = (p) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const NAV_ICON = {
  dashboard: ICO('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/>'),
  list: ICO('<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="M8 13h8M8 17h6"/>'),
  new: ICO('<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="M12 12v6M9 15h6"/>'),
  approvals: ICO('<rect x="8" y="3" width="8" height="4" rx="1"/><path d="M16 5h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/>'),
  notifications: ICO('<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>'),
  users: ICO('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/>'),
  customers: ICO('<path d="M20.59 13.41 13.42 20.6a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><circle cx="7" cy="7" r="1.5"/>'),
  permissions: ICO('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/>'),
  audit: ICO('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  projects: ICO('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 13v3M13 11v5M17 13v3"/>'),
  profile: ICO('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
};

const ROUTE_PAGES = ["dashboard", "list", "new", "customers", "approvals", "notifications", "projects", "users", "permissions", "audit", "profile"];

// Hash router: maps #/page and #/quotes/:id → app state, so pages are
// bookmarkable, the back button works, and notification deep links resolve.
async function routeFromHash() {
  if (location.hash.startsWith("#/onboard")) { renderOnboard(); return; }
  if (!state.user) return;
  if (!location.hash.startsWith("#/")) return; // ignore #main (skip link) etc.
  const h = location.hash.slice(2); // strip "#/"
  const m = h.match(/^quotes\/(\d+)$/);
  if (m) {
    try {
      const q = await api(`/api/quotes/${m[1]}`);
      state.currentQuote = q; state.page = "edit"; render();
    } catch (e) { toast(e.message, "error"); }
    return;
  }
  state.page = ROUTE_PAGES.includes(h) ? h : "list";
  state.currentQuote = null;
  // Remember the last non-quote page so the editor's "Quay lại" returns HERE
  // (list / approvals / search) instead of history.back() — which could exit the app.
  window._returnHash = location.hash;
  render();
}

async function boot() {
  initTheme();
  installKeyActivation();
  if (!window._hashWired) { window.addEventListener("hashchange", routeFromHash); window._hashWired = true; }
  // Public invite-accept page — reachable without logging in.
  if (location.hash.startsWith("#/onboard")) { renderOnboard(); return; }
  try {
    const me = await api("/api/auth/me");
    state.user = me;
    await loadMeta();
  } catch {
    state.user = null;
  }
  if (state.user && location.hash.startsWith("#/")) routeFromHash();
  else { if (state.user) state.page = landingPage(); render(); }
}

async function loadMeta() {
  try {
    state.companies = await api("/api/meta/companies");
    state.templates = state.companies.flatMap(c => c.templates.map(t => ({ ...t, company: { id: c.id, name: c.name, shortName: c.shortName } })));
  } catch (e) {
    console.warn("loadMeta failed", e);
  }
}

function render() {
  document.getElementById("boot")?.remove(); // drop the instant-paint splash
  if (!state.user) {
    if (state._sse) { try { state._sse.close(); } catch {} state._sse = null; }
    return renderLogin();
  }
  startSSE();
  renderShell();
}

// ---------------- Login ----------------
// Public onboarding page: an invited employee sets their password + details.
async function renderOnboard() {
  const token = new URLSearchParams((location.hash.split("?")[1]) || "").get("token");
  app.innerHTML = `<div class="login-wrap"><div class="login-card"><div id="ob-body">Đang kiểm tra lời mời…</div></div></div>`;
  const body = document.getElementById("ob-body");
  if (!token) { body.innerHTML = `<div class="err">Liên kết không hợp lệ.</div>`; return; }
  let info;
  try { info = await api(`/api/auth/invite/${encodeURIComponent(token)}`); }
  catch (e) { body.innerHTML = `<div class="err">${escapeHtml(e.message)}</div><p class="login-hint">Liên hệ quản trị viên để được mời lại.</p>`; return; }
  body.innerHTML = `
    <h1>Hoàn tất tài khoản</h1>
    <p class="sub">${escapeHtml(info.email)}</p>
    <div id="ob-err" role="alert" aria-live="assertive"></div>
    <form id="ob-form">
      <label><span>Họ tên</span><input name="displayName" value="${escapeHtml(info.displayName || "")}" required /></label>
      <label><span>Tên người gửi trên báo giá</span><input name="senderName" placeholder="Để trống = dùng Họ tên" /></label>
      <label><span>Số điện thoại</span><input name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="09xx xxx xxx" /></label>
      <label><span>Chức danh</span><input name="title" placeholder="VD: Account, Sale, Giám đốc…" /></label>
      <label><span>Mật khẩu</span><input name="password" type="password" autocomplete="new-password" placeholder="Tối thiểu 8 ký tự, gồm chữ và số" required /></label>
      <label><span>Nhập lại mật khẩu</span><input name="password2" type="password" autocomplete="new-password" required /></label>
      <button type="submit" class="btn-login">Kích hoạt & đăng nhập</button>
    </form>`;
  document.getElementById("ob-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const err = document.getElementById("ob-err");
    err.innerHTML = "";
    if (fd.get("password") !== fd.get("password2")) { err.innerHTML = `<div class="err">Mật khẩu nhập lại không khớp.</div>`; return; }
    try {
      const me = await api("/api/auth/accept-invite", { method: "POST", body: JSON.stringify({ token, displayName: fd.get("displayName"), senderName: fd.get("senderName"), phone: fd.get("phone"), title: fd.get("title"), password: fd.get("password") }) });
      state.user = me;
      location.hash = "#/list";
      state.page = "list";
      await loadMeta();
      render();
      toast("Chào mừng! Tài khoản đã được kích hoạt.", "success");
    } catch (e2) {
      // e2.message already carries the specific reason(s) (built in api()).
      // Show it in the alert box AND pinpoint the offending field inline.
      err.innerHTML = `<div class="err">${escapeHtml(e2.message)}</div>`;
      applyFieldErrors(e2); // highlight + focus the bad field (password, …)
    }
  });
}

function renderLogin() {
  app.innerHTML = `
    <div class="login-wrap">
      <div class="login-card">
        <h1>Quản Lý Báo Giá</h1>
        <p class="sub">Gia Nguyễn — Hệ thống nội bộ</p>
        <div id="login-err" role="alert" aria-live="assertive"></div>
        <form id="login-form">
          <label><span>Email hoặc tên đăng nhập</span><input name="username" autocomplete="username" required /></label>
          <label><span>Mật khẩu</span><input type="password" name="password" autocomplete="current-password" required /></label>
          <label id="mfa-field" style="display:none"><span>Mã xác thực (MFA)</span><input name="mfaToken" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9A-Za-z]{6,8}" placeholder="6 chữ số" /></label>
          <button type="submit" class="btn-login">Đăng nhập</button>
        </form>
        <p class="login-hint"><a href="#" id="forgot-link">Quên mật khẩu?</a></p>
      </div>
    </div>`;
  document.getElementById("forgot-link")?.addEventListener("click", async (e) => {
    e.preventDefault();
    const email = await promptModal("Quên mật khẩu", "Nhập email tài khoản của bạn — chúng tôi sẽ gửi liên kết đặt lại mật khẩu:", { placeholder: "ten@congty.com" });
    if (!email) return;
    try {
      await api("/api/auth/forgot-password", { method: "POST", body: JSON.stringify({ email: email.trim() }) });
      toast("Nếu email tồn tại, liên kết đặt lại đã được gửi. Vui lòng kiểm tra hộp thư.", "success");
    } catch (err) { toast(err.message, "error"); }
  });
  document.getElementById("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const errEl = document.getElementById("login-err");
    const mfaField = document.getElementById("mfa-field");
    errEl.innerHTML = "";
    const payload = { username: fd.get("username"), password: fd.get("password") };
    const mfaToken = (fd.get("mfaToken") || "").toString().trim();
    if (mfaToken) payload.mfaToken = mfaToken;
    try {
      const me = await api("/api/auth/login", { method: "POST", body: JSON.stringify(payload) });
      state.user = me;
      await loadMeta();
      // Honor a deep link the user followed before logging in (e.g. an email link
      // to a specific quote); otherwise land on the list.
      if (location.hash.startsWith("#/") && !location.hash.startsWith("#/onboard")) routeFromHash();
      else { state.page = landingPage(); render(); }
    } catch (err) {
      // Server asks for a second factor → reveal the MFA field and let the user retry.
      if (err.body && err.body.mfaRequired) {
        mfaField.style.display = "";
        const mfaInput = mfaField.querySelector("input");
        mfaInput.required = true;
        mfaInput.focus();
        errEl.innerHTML = `<div class="err">${mfaToken ? "Mã MFA không đúng, thử lại." : "Tài khoản đã bật MFA — vui lòng nhập mã xác thực."}</div>`;
        return;
      }
      errEl.innerHTML = `<div class="err">${escapeHtml(err.message)}</div>`;
    }
  });
}

// ---------------- Shell ----------------
function renderShell() {
  // Any non-editor page clears the unsaved flag (covers browser-back out of editor).
  if (state.page !== "edit") window._editorDirty = false;
  const role = state.user.role;
  const themeIcon = (localStorage.getItem("theme") === "dark") ? "☀️" : "🌙";
  const nav = (id, label, badge = "") =>
    `<a href="#/${id}" data-page="${id}" class="${state.page === id ? "active" : ""}"${state.page === id ? ' aria-current="page"' : ""}>${label}${badge}</a>`;
  app.innerHTML = `
    <a href="#main" class="skip-link">Bỏ qua tới nội dung</a>
    <div class="shell">
      <header class="mobile-topbar" role="banner">
        <button class="icon-btn" id="sb-toggle" aria-label="Mở menu" aria-controls="sidebar" aria-expanded="false">☰</button>
        <span class="mt-title">Báo Giá</span>
        <button class="icon-btn" id="theme-toggle-m" aria-label="Đổi giao diện sáng/tối">${themeIcon}</button>
      </header>
      <div class="sidebar-backdrop" id="sb-backdrop"></div>
      <aside class="sidebar" id="sidebar">
        <div class="sb-head">
          <div class="sb-brand">
            <div class="sb-logo" aria-hidden="true">GN</div>
            <div>
              <h2>Báo Giá</h2>
              <div class="org">Gia Nguyễn · nội bộ</div>
            </div>
          </div>
          <button class="icon-btn" id="theme-toggle" aria-label="Đổi giao diện sáng/tối" title="Đổi giao diện sáng/tối">${themeIcon}</button>
        </div>
        <div class="global-search">
          <label for="gs-input" class="sr-only">Tìm nhanh báo giá</label>
          <input id="gs-input" placeholder="🔎 Tìm nhanh (Ctrl+K)" />
          <div id="gs-results" class="global-search-results" style="display:none"></div>
        </div>
        <nav class="menu" aria-label="Điều hướng chính">
          <div class="nav-group-label" role="presentation">Công việc</div>
          ${nav("dashboard", NAV_ICON.dashboard + "<span>Tổng quan</span>")}
          ${nav("list", NAV_ICON.list + "<span>Danh sách báo giá</span>")}
          ${nav("new", NAV_ICON.new + "<span>Tạo báo giá mới</span>")}
          ${can("customer:read:own") ? nav("customers", NAV_ICON.customers + "<span>Mã khách hàng</span>") : ""}
          ${(can("quote:approve") || can("quote:approve:own")) ? nav("approvals", NAV_ICON.approvals + "<span>Hàng chờ duyệt</span>", ` <span id="badge-pending" class="badge-num" aria-live="polite"></span>`) : ""}
          ${nav("notifications", NAV_ICON.notifications + "<span>Thông báo</span>", ` <span id="badge-notif" class="badge-num" aria-live="polite"></span>`)}
          ${(can("user:manage") || can("audit:view")) ? `<div class="nav-group-label" role="presentation">Quản trị</div>` : ""}
          ${nav("projects", NAV_ICON.projects + "<span>Quản lý dự án</span>")}
          ${can("user:manage") ? nav("users", NAV_ICON.users + "<span>Quản lý nhân viên</span>") : ""}
          ${can("user:manage") ? nav("permissions", NAV_ICON.permissions + "<span>Phân quyền</span>") : ""}
          ${can("audit:view") ? nav("audit", NAV_ICON.audit + "<span>Nhật ký hoạt động</span>") : ""}
          <div class="nav-group-label" role="presentation">Tài khoản</div>
          ${nav("profile", NAV_ICON.profile + "<span>Tài khoản</span>")}
        </nav>
        <div class="who">
          <strong>${escapeHtml(state.user.displayName)}</strong>
          <span>@${escapeHtml(state.user.username)}</span><br/>
          <span class="role-pill">${ROLE_LABEL[role]}</span>
          <button class="logout">Đăng xuất</button>
        </div>
      </aside>
      <main class="main" id="main" tabindex="-1"></main>
    </div>`;

  // Theme toggle (desktop + mobile)
  const applyThemeIcon = () => {
    const ic = (localStorage.getItem("theme") === "dark") ? "☀️" : "🌙";
    ["theme-toggle", "theme-toggle-m"].forEach(id => { const b = document.getElementById(id); if (b) b.textContent = ic; });
  };
  ["theme-toggle", "theme-toggle-m"].forEach(id => {
    const b = document.getElementById(id);
    if (b) b.addEventListener("click", () => { toggleTheme(); applyThemeIcon(); });
  });

  // Mobile sidebar toggle
  const sidebar = document.getElementById("sidebar");
  const backdrop = document.getElementById("sb-backdrop");
  const sbToggleBtn = document.getElementById("sb-toggle");
  // Focus trap for the mobile drawer: while open, Tab cycles within the sidebar
  // and Escape closes it + returns focus to the hamburger (WCAG 2.4.3 / 2.1.2).
  const trapTab = (e) => {
    if (e.key === "Escape") { closeSidebar(); sbToggleBtn?.focus(); return; }
    if (e.key !== "Tab") return;
    const f = sidebar.querySelectorAll('a[href], button:not([disabled]), input, [tabindex]:not([tabindex="-1"])');
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  const openSidebar = () => {
    sidebar.classList.add("open"); backdrop.classList.add("show");
    sidebar.addEventListener("keydown", trapTab);
    sidebar.querySelector('a[href], button')?.focus();
  };
  const closeSidebar = () => {
    sidebar.classList.remove("open"); backdrop.classList.remove("show");
    sidebar.removeEventListener("keydown", trapTab);
  };
  sbToggleBtn?.addEventListener("click", openSidebar);
  backdrop?.addEventListener("click", closeSidebar);

  // Nav links carry href="#/page"; navigation is driven by the hash router so
  // pages are bookmarkable + the back button works. The click closes the mobile
  // drawer; if leaving the editor with unsaved changes, confirm first (the link's
  // default hash nav is cancelled and re-issued only after the user confirms).
  document.querySelectorAll("[data-page]").forEach(a => {
    a.addEventListener("click", async (e) => {
      closeSidebar();
      if (state.page === "edit" && window._editorDirty) {
        e.preventDefault();
        if (await leaveEditorGuard()) location.hash = a.getAttribute("href");
      }
    });
  });
  // Update the hamburger's expanded state for screen readers.
  const sbToggle = document.getElementById("sb-toggle");
  const syncExpanded = () => sbToggle?.setAttribute("aria-expanded", sidebar.classList.contains("open") ? "true" : "false");
  document.getElementById("sb-toggle")?.addEventListener("click", syncExpanded);
  backdrop?.addEventListener("click", syncExpanded);
  // Global search
  const gsInput = document.getElementById("gs-input");
  const gsResults = document.getElementById("gs-results");
  if (gsInput) {
    gsInput.addEventListener("input", async () => {
      const q = gsInput.value.trim();
      if (!q) { gsResults.style.display = "none"; gsResults.innerHTML = ""; return; }
      clearTimeout(window._gst);
      window._gst = setTimeout(async () => {
        try {
          const r = await api(`/api/search?q=${encodeURIComponent(q)}&types=quote&limit=10`);
          const sections = [];
          if (r.results.quotes?.length) sections.push(`
            <div class="gs-section">Báo giá</div>
            ${r.results.quotes.map(q => `<div class="gs-row" data-go="quote" data-id="${q.id}" ${KBD}>
              <strong>${escapeHtml(q.projectCode || q.quoteNumber)}</strong> — ${escapeHtml(q.title)} <span class="status ${q.status}">${statusLabel(q.status)}</span>
            </div>`).join("")}`);
          gsResults.innerHTML = sections.join("") || "<div class='gs-section'>Không có kết quả</div>";
          gsResults.style.display = "block";
          gsResults.querySelectorAll(".gs-row").forEach(row => row.addEventListener("click", () => {
            const id = row.dataset.id;
            gsInput.value = "";
            gsResults.style.display = "none";
            if (row.dataset.go === "quote" && id) goToQuote(id); // hash router fetches + renders
          }));
        } catch {}
      }, 200);
    });
    // Install the global search keyboard/click handlers ONCE (not per render) and
    // resolve elements at runtime, so re-renders don't pile up stale listeners.
    if (!window._gsKeysWired) {
      window._gsKeysWired = true;
      document.addEventListener("keydown", (e) => {
        const inp = document.getElementById("gs-input"); const out = document.getElementById("gs-results");
        if (!inp) return;
        if ((e.ctrlKey || e.metaKey) && e.key === "k") { e.preventDefault(); inp.focus(); inp.select(); }
        // Only clear search on Escape when it's actually in use (focused or showing
        // results) — don't hijack Escape from unrelated fields/dialogs.
        else if (e.key === "Escape" && out && (document.activeElement === inp || out.style.display !== "none")) { out.style.display = "none"; inp.value = ""; }
      });
      document.addEventListener("click", (e) => {
        const inp = document.getElementById("gs-input"); const out = document.getElementById("gs-results");
        if (out && inp && !out.contains(e.target) && e.target !== inp) out.style.display = "none";
      });
    }
  }

  document.querySelector(".logout").addEventListener("click", async () => {
    await api("/api/auth/logout", { method: "POST" });
    state.user = null;
    render();
  });

  renderMain();

  // Refresh notification + approval queue badges
  refreshBadges();
}

// --- Realtime SSE listener ---
function startSSE() {
  if (state._sse) return; // already open
  try {
    const es = new EventSource("/api/stream/events");
    es.addEventListener("notification", (e) => {
      try {
        const n = JSON.parse(e.data);
        toast(`🔔 ${n.title}`, "info");
        refreshBadges();
        if (state.page === "notifications") scheduleMainRefresh();
      } catch {}
    });
    // Any data change anywhere (báo giá / khách hàng / nhân viên) → refresh the
    // relevant list live. Re-fetch goes through the normal permission-scoped API.
    es.addEventListener("changed", (e) => {
      let d = {}; try { d = JSON.parse(e.data); } catch {}
      onRealtimeChange(d);
    });
    // Your role/permissions changed → re-pull capabilities and re-render shell+page.
    es.addEventListener("session:refresh", async () => {
      try {
        const me = await api("/api/auth/me");
        state.user = me; // keep capabilities current even if we defer the repaint
        toast("Quyền của bạn vừa được cập nhật.", "info");
        // Don't blow away an open editor/wizard/modal; the shell repaints on next nav.
        if (state.page !== "edit" && state.page !== "new" && !document.querySelector(".modal-mask")) render();
      } catch {}
    });
    // You were locked / deactivated / deleted → log out immediately.
    es.addEventListener("session:revoked", (e) => {
      let d = {}; try { d = JSON.parse(e.data); } catch {}
      forceLogout(d.reason);
    });
    es.onopen = () => {
      // Reconnected after a drop — we may have missed events; resync now.
      if (state._sseDown) { state._sseDown = false; refreshBadges(); scheduleMainRefresh(); }
    };
    es.onerror = () => { state._sseDown = true; };
    state._sse = es;
  } catch (e) {
    console.warn("SSE failed", e);
  }
}

// Render ONLY the current page's main content (no shell rebuild). Used by the
// initial shell render and by realtime refreshes so an SSE event doesn't tear
// down + rebuild the whole sidebar/nav (cheaper, no focus/scroll loss).
function renderMain() {
  const mainEl = document.getElementById("main");
  if (!mainEl) return;
  if (state.page === "list") renderList(mainEl);
  else if (state.page === "new") renderNewQuote(mainEl);
  else if (state.page === "edit") (state.currentQuote && state.currentQuote._accountHnView ? renderAccountHnView(mainEl, state.currentQuote) : renderEditor(mainEl, state.currentQuote));
  else if (state.page === "customers") renderCustomers(mainEl);
  else if (state.page === "users") renderUsers(mainEl);
  else if (state.page === "profile") renderProfile(mainEl);
  else if (state.page === "dashboard") renderDashboard(mainEl);
  else if (state.page === "approvals") renderApprovalQueue(mainEl);
  else if (state.page === "notifications") renderNotifications(mainEl);
  else if (state.page === "audit") renderAuditLog(mainEl);
  else if (state.page === "permissions") renderPermissions(mainEl);
  else if (state.page === "projects") renderProjects(mainEl);
}

// Decide whether the current page cares about this change, then refresh it.
function onRealtimeChange(d) {
  refreshBadges();
  const PAGES_FOR = {
    quote: ["list", "dashboard", "approvals", "notifications"],
    customer: ["customers"],
    user: ["users"],
  };
  const pages = PAGES_FOR[d.entity] || ["list", "dashboard", "approvals", "customers", "users", "notifications"];
  if (pages.includes(state.page)) scheduleMainRefresh();
}

// Debounced, non-disruptive refresh of the current page's content.
function scheduleMainRefresh() {
  clearTimeout(state._rtTimer);
  state._rtTimer = setTimeout(doMainRefresh, 500);
}
function doMainRefresh() {
  // Never blow away an in-progress editor / wizard.
  if (state.page === "edit" || state.page === "new") return;
  // Don't interrupt active typing or an open modal — retry once the user is idle.
  const ae = document.activeElement;
  const busy = (ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) || document.querySelector(".modal-mask");
  if (busy) { clearTimeout(state._rtTimer); state._rtTimer = setTimeout(doMainRefresh, 2500); return; }
  renderMain();   // only re-render the page content, not the whole shell
}

// Hard logout triggered by the server (account locked/deactivated/deleted).
async function forceLogout(reason) {
  try { await api("/api/auth/logout", { method: "POST" }); } catch {}
  if (state._sse) { try { state._sse.close(); } catch {} state._sse = null; }
  state.user = null;
  render();
  toast(
    reason === "deleted"
      ? "Tài khoản của bạn đã bị xóa. Bạn đã được đăng xuất."
      : "Tài khoản của bạn đã bị khóa. Bạn đã được đăng xuất.",
    "error"
  );
}

async function refreshBadges() {
  try {
    const n = await api("/api/notifications/unread-count");
    const badge = document.getElementById("badge-notif");
    if (badge) badge.textContent = n.count > 0 ? n.count : "";
  } catch {}
  if (can("quote:approve") || can("quote:approve:own")) {
    try {
      const q = await api("/api/approvals/queue");
      const b = document.getElementById("badge-pending");
      if (b) b.textContent = q.meta.total > 0 ? q.meta.total : "";
    } catch {}
  }
}

// ---------------- List ----------------
// Hide the boilerplate "BẢNG BÁO GIÁ" prefix in the LIST only — the stored title
// (editor + Excel/PDF export) keeps the full text.
function shortTitle(t) {
  const s = String(t || "");
  const r = s.replace(/^\s*bảng\s+báo\s+giá\s*[-–—:|·]*\s*/i, "").trim();
  return r || s;
}
// Mã dự án + nhãn phiên bản (v2/v3…) cho các bản nhân bản cùng mã dự án.
function codeLabel(q) {
  const c = q.projectCode || q.quoteNumber || "";
  return (q.projectVersion && q.projectVersion > 1) ? `${c}_v${q.projectVersion}` : c;
}
async function renderList(el) {
  el.innerHTML = `<h1>Danh sách báo giá</h1>
    <div class="toolbar">
      <label for="filter-q" class="sr-only">Tìm báo giá</label>
      <input id="filter-q" placeholder="Tìm theo số, tiêu đề, khách…" value="${escapeHtml(state.filter.q || "")}" />
      <label for="filter-status" class="sr-only">Lọc theo trạng thái</label>
      <select id="filter-status">
        <option value="">— Tất cả trạng thái —</option>
        ${Object.entries(STATUS_LABEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}
      </select>
      <button class="btn" id="btn-reload">Tải lại</button>
      <button class="btn btn-primary" id="btn-new">+ Tạo báo giá</button>
    </div>
    <div id="list-body">${skeleton(6)}</div>`;
  document.getElementById("filter-status").value = state.filter.status;

  const PAGE_SIZE = 20;
  const reload = async () => {
    const params = new URLSearchParams();
    if (state.filter.q) params.set("q", state.filter.q);
    if (state.filter.status) params.set("status", state.filter.status);
    params.set("page", state.filter.page || 1);
    params.set("size", PAGE_SIZE);
    try {
      const r = await api("/api/quotes?" + params.toString());
      state.quoteList = Array.isArray(r) ? r : (r.data || []);
      state.quoteMeta = (r && r.meta) || { total: state.quoteList.length, page: 1, pageCount: 1 };
      drawList();
    } catch (e) {
      const body = document.getElementById("list-body");
      if (body) body.innerHTML = errorState(e.message, reload);
    }
  };

  document.getElementById("filter-q").addEventListener("input", (e) => {
    state.filter.q = e.target.value;
    state.filter.page = 1;
    clearTimeout(window._fto);
    window._fto = setTimeout(reload, 300);
  });
  document.getElementById("filter-status").addEventListener("change", (e) => {
    state.filter.status = e.target.value;
    state.filter.page = 1;
    reload();
  });
  document.getElementById("btn-reload").addEventListener("click", reload);
  document.getElementById("btn-new").addEventListener("click", () => {
    state.page = "new";
    render();
  });

  function drawList() {
    const body = document.getElementById("list-body");
    const m = state.quoteMeta || { total: 0, page: 1, pageCount: 1 };
    if (!state.quoteList.length) {
      body.innerHTML = `<div class="empty-state">${state.filter.q || state.filter.status ? "Không tìm thấy báo giá phù hợp." : "Chưa có báo giá nào."}</div>`;
      return;
    }
    const start = (m.page - 1) * PAGE_SIZE + 1;
    const end = (m.page - 1) * PAGE_SIZE + state.quoteList.length;
    const isAdmin = state.user?.role === "admin";   // cột "Người tạo" chỉ hiện cho admin
    body.innerHTML = `
      <div class="tbl-scroll">
      <table class="list-table cards-sm">
        <thead>
          <tr>
            <th scope="col">Mã dự án</th>${isAdmin ? `<th scope="col">Người tạo</th>` : ""}<th scope="col">Tiêu đề</th>
            <th scope="col">Ngày</th><th scope="col">Sheet</th><th scope="col" style="text-align:right">Tổng (VNĐ)</th>
            <th scope="col">Công ty</th><th scope="col">Khách</th><th scope="col">Mã KH</th>
            <th scope="col">Trạng thái</th><th scope="col">Thao tác</th>
          </tr>
        </thead>
        <tbody>
          ${state.quoteList.map(q => `
            <tr class="qrow" data-id="${q.id}" title="Bấm để mở báo giá">
              <td data-label="Mã dự án"><strong>${escapeHtml(codeLabel(q))}</strong></td>
              ${isAdmin ? `<td data-label="Người tạo">${escapeHtml(q.createdBy?.displayName || "")}</td>` : ""}
              <td data-label="Tiêu đề" title="${escapeHtml(q.title)}">${escapeHtml(shortTitle(q.title))}</td>
              <td data-label="Ngày">${fmtDate(q.quoteDate)}</td>
              <td data-label="Sheet" style="text-align:center">${q.sheetCount ?? (q.sheets?.length || 0)}</td>
              <td data-label="Tổng (VNĐ)" style="text-align:right">${fmtMoney(q.total)}</td>
              <td data-label="Công ty">${escapeHtml(q.company?.shortName || q.company?.name || "")}</td>
              <td data-label="Khách">${escapeHtml(q.toCompany)}</td>
              <td data-label="Mã KH">${q.customerCode ? `<strong>${escapeHtml(q.customerCode)}</strong>` : "—"}</td>
              <td data-label="Trạng thái"><span class="status ${q.status}">${statusLabel(q.status)}</span></td>
              <td class="cell-actions">
                <div class="row-actions">
                  <button class="act-btn act-excel" data-act="excel" data-id="${q.id}" title="Tải file Excel">📥 Excel</button>
                  <button class="act-btn" data-act="dup" data-id="${q.id}" title="Nhân bản thành báo giá mới">📋 Nhân bản</button>
                  <button class="act-btn" data-act="revise" data-id="${q.id}" title="Tạo bản mới CÙNG mã dự án (v2, v3…) để gửi khách">➕ Bản mới</button>
                  ${canDelete(q) ? `<button class="act-btn act-del" data-act="del" data-id="${q.id}" title="Xóa báo giá">🗑 Xóa</button>` : ""}
                </div>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table></div>
      <div class="pager">
        <span class="muted">Hiển thị ${start}–${end} / ${m.total} báo giá</span>
        <div class="pager-btns">
          <button class="btn btn-sm" id="pg-prev" ${m.page <= 1 ? "disabled" : ""}>← Trước</button>
          <span class="muted" style="padding:0 6px">Trang ${m.page}/${m.pageCount || 1}</span>
          <button class="btn btn-sm" id="pg-next" ${m.page >= (m.pageCount || 1) ? "disabled" : ""}>Sau →</button>
        </div>
      </div>`;
    body.querySelectorAll("button[data-act]").forEach(b => {
      b.addEventListener("click", (e) => { e.stopPropagation(); listAction(b.dataset.act, parseInt(b.dataset.id, 10)); });
    });
    // Bấm vào DÒNG để mở báo giá (trừ khi bấm trúng nút thao tác).
    body.querySelectorAll("tr.qrow").forEach(tr => {
      tr.addEventListener("click", (e) => {
        if (e.target.closest("button, a")) return;
        listAction("open", parseInt(tr.dataset.id, 10));
      });
    });
    document.getElementById("pg-prev")?.addEventListener("click", () => { state.filter.page = Math.max(1, (state.filter.page || 1) - 1); reload(); });
    document.getElementById("pg-next")?.addEventListener("click", () => { state.filter.page = (state.filter.page || 1) + 1; reload(); });
  }
  await reload();
}

function canDelete(q) {
  if (can("quote:delete:all")) return true;
  return canOnQuote("delete", q) && (q.status === "draft" || q.status === "rejected");
}

async function listAction(act, id) {
  try {
    if (act === "open") {
      goToQuote(id); // deep-link via hash router (Back/F5/bookmark work)
    } else if (act === "excel") {
      window.open(`/api/export/${id}.xlsx?t=${Date.now()}`, "_blank");   // cache-bust: tránh CDN trả file cũ
    } else if (act === "dup") {
      const q = await api(`/api/quotes/${id}/duplicate`, { method: "POST" });
      toast("Đã nhân bản. Bạn đang sửa bản mới.", "success");
      goToQuote(q.id);
    } else if (act === "revise") {
      const q = await api(`/api/quotes/${id}/duplicate`, { method: "POST", body: JSON.stringify({ sameProject: true }) });
      toast(`Đã tạo bản mới cùng mã dự án (${codeLabel(q)}). Bạn đang sửa bản này.`, "success");
      goToQuote(q.id);
    } else if (act === "del") {
      const dq = (state.quoteList || []).find(x => String(x.id) === String(id));
      if (!(await confirmModal("Xóa báo giá", `Xóa báo giá ${dq ? (dq.projectCode || dq.quoteNumber) : ""}? Hành động không thể hoàn tác.`, { danger: true }))) return;
      await api(`/api/quotes/${id}`, { method: "DELETE" });
      toast("Đã xóa", "success");
      state.page = "list";
      render();
    }
  } catch (e) { toast(e.message, "error"); }
}

// ---------------- New Quote (wizard) ----------------
// Renders a horizontal stepper. steps = [labels], current = 1-based index.
function stepper(steps, current) {
  return `<div class="stepper">${steps.map((s, i) => {
    const n = i + 1;
    const done = n < current;
    const cls = done ? "done clickable" : n === current ? "active" : "";
    // Completed steps are clickable to jump back.
    const attrs = done ? ` ${KBD} data-step="${n}" aria-label="Quay lại bước ${n}: ${escapeHtml(s)}"` : "";
    const dot = `<div class="step-dot ${cls}"${attrs}><div class="num">${done ? "✓" : n}</div><div class="lbl">${escapeHtml(s)}</div></div>`;
    const line = i < steps.length - 1 ? `<div class="step-line ${done ? "done" : ""}"></div>` : "";
    return dot + line;
  }).join("")}</div>`;
}

const WIZARD_STEPS = ["Công ty", "Mẫu báo giá", "Thông tin", "Hạng mục"];

function renderNewQuote(el) {
  if (!state._wizard) {
    state._wizard = {
      step: 1,
      companyId: state.companies[0]?.id || null,
      templateIds: [],
      managerId: null,
      customerId: null,
      customerCode: "",
      customerName: "",
      info: {
        title: "", toCompany: "", toContact: "",
        fromContact: state.user.senderName || state.user.displayName || "", fromPhone: state.user.phone || "",
        fromTitle: state.user.title || "", fromAddress: state.companies[0]?.address || "", city: "TP. Hồ Chí Minh",
        quoteDate: new Date().toISOString().slice(0, 10), vatPercent: 8, discount: 0, customerLogo: null,
      },
    };
  }
  const wz = state._wizard;
  const company = state.companies.find(c => c.id === wz.companyId);
  const templates = company?.templates || [];
  // Sender address is locked to the company letterhead address.
  if (company && company.address) wz.info.fromAddress = company.address;
  // Load the people picklist once: everyone can pick a "Người gửi" (themselves or another manager/admin).
  if (state._managers === undefined) {
    state._managers = null; // loading
    api("/api/quotes/assignable-users")
      .then(r => {
        // Nhân viên tạo báo giá phải chọn người phụ trách: Quản lý HOẶC Quản trị viên (1 trong 2).
        state._managers = (r.data || []).filter(u => ["manager", "admin"].includes(u.role));
        renderNewQuote(el);
      })
      .catch(() => { state._managers = []; });
  }

  let body = "";
  if (wz.step === 1) {
    body = `
      <h2>Chọn công ty phát hành</h2>
      <p class="hint">Báo giá sẽ dùng letterhead / mẫu của công ty này.</p>
      <div class="pick-grid">
        ${state.companies.map(c => `
          <div class="pick-card ${c.id === wz.companyId ? "selected" : ""}" data-company="${c.id}" ${KBD} aria-pressed="${c.id === wz.companyId}" aria-label="Chọn công ty ${escapeHtml(c.shortName || c.name)}">
            <div class="pc-title">${escapeHtml(c.shortName || c.name)}</div>
            <div class="pc-sub">${escapeHtml(c.name)}</div>
            <div class="pc-sub">${(c.templates || []).length} mẫu</div>
            <div class="pc-check">✓</div>
          </div>`).join("")}
      </div>`;
  } else if (wz.step === 2) {
    body = `
      <h2>Chọn mẫu báo giá (mỗi mẫu = 1 sheet)</h2>
      <p class="hint">Chọn 1 hoặc nhiều mẫu. Có thể đổi thứ tự / thêm sheet sau.</p>
      <div class="pick-grid">
        ${templates.map(t => `
          <div class="pick-card ${wz.templateIds.includes(t.id) ? "selected" : ""}" data-template="${t.id}" ${KBD} aria-pressed="${wz.templateIds.includes(t.id)}" aria-label="Chọn mẫu ${escapeHtml(t.name)}">
            <div class="pc-title">${escapeHtml(t.name)}</div>
            <div class="pc-sub">${escapeHtml(t.code)}</div>
            <div class="pc-check">✓</div>
          </div>`).join("")}
      </div>
      ${wz.templateIds.length ? `<div class="sheet-chips">${wz.templateIds.map((id, i) => {
        const t = templates.find(x => x.id === id);
        return `<span class="sheet-chip">${i + 1}. ${escapeHtml(t?.name || "")} <span class="x" data-rm="${id}" ${KBD} aria-label="Bỏ mẫu ${escapeHtml(t?.name || "")}">✕</span></span>`;
      }).join("")}</div>` : ""}`;
  } else if (wz.step === 3) {
    const i = wz.info;
    body = `
      <h2>Thông tin báo giá</h2>
      <p class="hint">Khách hàng, người gửi, VAT, ngày — và logo khách (chèn vào mẫu CLF).</p>
      <div class="form-grid">
        <label style="grid-column:1/-1">Tiêu đề báo giá <span class="req">*</span>
          <input id="w-title" value="${escapeHtml(i.title)}" placeholder="VD: Décor Premiere Phim Thỏ Ơi"/></label>
        <label style="grid-column:1/-1">Mã khách hàng <span class="req">*</span>
          <div style="display:flex;gap:8px;align-items:center">
            <input id="w-customer-disp" value="${wz.customerId ? escapeHtml((wz.customerCode || "") + " — " + (wz.customerName || "")) : ""}" placeholder="Chưa chọn — bấm nút bên phải" readonly style="flex:1" />
            <button type="button" class="btn btn-sm btn-primary" id="w-pick-customer">Chọn khách hàng</button>
          </div></label>
        <label>Khách hàng (To) <span class="req">*</span><input id="w-toCompany" value="${escapeHtml(i.toCompany)}"/></label>
        <label>Người liên hệ KH<input id="w-toContact" value="${escapeHtml(i.toContact)}"/></label>
        <label style="grid-column:1/-1">Người gửi — chọn nhanh
          <select id="w-sender">
            <option value="__me">Bạn — ${escapeHtml(state.user.senderName || state.user.displayName)}${state.user.title ? " · " + escapeHtml(state.user.title) : ""}</option>
            ${(state._managers || []).filter(m => m.id !== state.user.id).map(m => `<option value="${m.id}">${escapeHtml(m.senderName || m.displayName)} (${ROLE_LABEL[m.role] || m.role}${m.title ? " · " + escapeHtml(m.title) : ""})</option>`).join("")}
          </select>
          <span class="muted" style="font-size:12px">Tự điền Tên + Chức danh + SĐT người gửi — vẫn sửa tay được bên dưới.</span></label>
        <label>Người gửi (From)<input id="w-fromContact" value="${escapeHtml(i.fromContact)}"/></label>
        <label>Chức danh<input id="w-fromTitle" value="${escapeHtml(i.fromTitle)}"/></label>
        <label>SĐT người gửi<input id="w-fromPhone" value="${escapeHtml(i.fromPhone)}"/></label>
        <label>Địa chỉ (tự theo công ty)<input id="w-fromAddress" value="${escapeHtml(i.fromAddress)}" readonly title="Tự lấy theo Công ty bên gửi"/></label>
        <label>VAT (%)<input id="w-vat" type="number" step="0.1" value="${i.vatPercent}"/></label>
        <label>Ngày<input id="w-date" type="date" value="${i.quoteDate}"/></label>
        <div style="grid-column:1/-1">
          <div style="font-size:13px;color:var(--text-soft);font-weight:500;margin-bottom:5px">Logo khách hàng (tùy chọn)</div>
          <div class="logo-drop ${i.customerLogo ? "has" : ""}" id="w-logo-drop">
            ${i.customerLogo
              ? `<img src="${safeLogoSrc(i.customerLogo)}" alt="Logo khách hàng đã chọn"/><div class="logo-actions"><button class="btn btn-sm" id="w-logo-change">Đổi</button><button class="btn btn-sm btn-danger" id="w-logo-clear">Xóa</button></div>`
              : `📁 Bấm để chọn ảnh logo (PNG/JPG, &lt; 2MB)`}
          </div>
          <input type="file" id="w-logo-file" accept="image/png,image/jpeg" style="display:none"/>
        </div>
      </div>`;
  }

  el.innerHTML = `
    <div class="wizard">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px">
        <h1>Tạo báo giá mới</h1>
        <button class="btn" id="btn-cancel">← Hủy</button>
      </div>
      ${stepper(WIZARD_STEPS, wz.step)}
      <div class="wizard-card">
        ${body}
        <div class="wizard-foot">
          <button class="btn" id="w-back" ${wz.step === 1 ? "disabled" : ""}>← Quay lại</button>
          <button class="btn btn-primary" id="w-next">${wz.step === 3 ? "Nhập hạng mục →" : "Tiếp tục →"}</button>
        </div>
      </div>
    </div>`;

  document.getElementById("btn-cancel").addEventListener("click", () => { state._wizard = null; state.page = "list"; render(); });

  // Step 1: company cards
  el.querySelectorAll("[data-company]").forEach(c => c.addEventListener("click", () => {
    wz.companyId = parseInt(c.dataset.company, 10);
    wz.templateIds = []; // reset sheets when company changes
    // Sender address defaults to the issuing company's letterhead address.
    const _co = state.companies.find(x => x.id === wz.companyId);
    if (_co) wz.info.fromAddress = _co.address || "";
    renderNewQuote(el);
  }));
  // Step 2: template cards (toggle)
  el.querySelectorAll("[data-template]").forEach(c => c.addEventListener("click", () => {
    const id = parseInt(c.dataset.template, 10);
    if (wz.templateIds.includes(id)) wz.templateIds = wz.templateIds.filter(x => x !== id);
    else wz.templateIds.push(id);
    renderNewQuote(el);
  }));
  el.querySelectorAll("[data-rm]").forEach(x => x.addEventListener("click", (e) => {
    e.stopPropagation();
    wz.templateIds = wz.templateIds.filter(id => id !== parseInt(x.dataset.rm, 10));
    renderNewQuote(el);
  }));

  // Step 3: bind info fields + logo
  if (wz.step === 3) {
    const bind = (id, key) => { const elx = document.getElementById(id); if (elx) elx.addEventListener("input", () => wz.info[key] = elx.value); };
    bind("w-title", "title"); bind("w-toCompany", "toCompany"); bind("w-toContact", "toContact");
    bind("w-fromContact", "fromContact"); bind("w-fromTitle", "fromTitle"); bind("w-fromPhone", "fromPhone");
    bind("w-fromAddress", "fromAddress"); bind("w-vat", "vatPercent"); bind("w-date", "quoteDate");
    const mgrSel = document.getElementById("w-manager");
    if (mgrSel) mgrSel.addEventListener("change", () => wz.managerId = parseInt(mgrSel.value, 10) || null);
    // Người gửi chọn nhanh → tự điền Tên + Chức danh + SĐT (vẫn cho sửa tay sau đó).
    const senderSel = document.getElementById("w-sender");
    if (senderSel) senderSel.addEventListener("change", () => {
      const p = senderSel.value === "__me"
        ? { senderName: state.user.senderName, displayName: state.user.displayName, title: state.user.title, phone: state.user.phone }
        : (state._managers || []).find(m => String(m.id) === senderSel.value);
      if (!p) return;
      wz.info.fromContact = (p.senderName || p.displayName) || "";
      wz.info.fromTitle = p.title || "";
      wz.info.fromPhone = p.phone || "";
      const setv = (id, v) => { const x = document.getElementById(id); if (x) x.value = v; };
      setv("w-fromContact", wz.info.fromContact);
      setv("w-fromTitle", wz.info.fromTitle);
      setv("w-fromPhone", wz.info.fromPhone);
    });
    document.getElementById("w-pick-customer")?.addEventListener("click", async () => {
      const c = await pickCustomer();
      if (!c) return;
      // Mã khách hàng chỉ là nhãn quản lý — KHÔNG tự điền ô "Khách hàng (To)" (điền riêng).
      wz.customerId = c.id; wz.customerCode = c.code; wz.customerName = c.name || "";
      renderNewQuote(el);
    });
    const fileInput = document.getElementById("w-logo-file");
    const drop = document.getElementById("w-logo-drop");
    const pick = () => fileInput.click();
    if (!wz.info.customerLogo) drop.addEventListener("click", pick);
    document.getElementById("w-logo-change")?.addEventListener("click", pick);
    document.getElementById("w-logo-clear")?.addEventListener("click", () => { wz.info.customerLogo = null; renderNewQuote(el); });
    fileInput.addEventListener("change", () => {
      const f = fileInput.files[0];
      if (!f) return;
      if (f.size > 2 * 1024 * 1024) { toast("Logo phải nhỏ hơn 2MB", "error"); return; }
      const reader = new FileReader();
      reader.onload = () => { wz.info.customerLogo = reader.result; renderNewQuote(el); };
      reader.readAsDataURL(f);
    });
  }

  // Clickable completed step dots (jump back)
  el.querySelectorAll(".step-dot[data-step]").forEach(dot => {
    // Keyboard activation is handled globally via the data-kbd delegation (KBD).
    dot.addEventListener("click", () => { wz.step = parseInt(dot.dataset.step, 10); renderNewQuote(el); });
  });

  document.getElementById("w-back").addEventListener("click", () => { if (wz.step > 1) { wz.step--; renderNewQuote(el); } });
  document.getElementById("w-next").addEventListener("click", async () => {
    if (wz.step === 1) {
      if (!wz.companyId) { toast("Chọn công ty", "error"); return; }
      wz.step = 2; return renderNewQuote(el);
    }
    if (wz.step === 2) {
      if (!wz.templateIds.length) { toast("Chọn ít nhất 1 mẫu", "error"); return; }
      wz.step = 3; return renderNewQuote(el);
    }
    // step 3 → build draft + open editor for items
    if (!wz.info.title.trim()) { toast("Nhập tiêu đề báo giá", "error"); return; }
    if (!wz.customerId) { toast("Chọn mã khách hàng (bấm 'Chọn khách hàng')", "error"); return; }
    if (!wz.info.toCompany.trim()) { toast("Nhập tên khách hàng", "error"); return; }
    try {
      // No client-side number — the server allocates it atomically per company
      // (each company has its own prefix + sequence, e.g. GN…, CLF…).
      const sheets = wz.templateIds.map(tid => {
        const t = state.templates.find(x => x.id === tid);
        return { templateId: tid, name: t?.name || "Sheet", groupSubtotal: true, items: [{ name: "", detail: "", unit: "", quantity: 1, unitPrice: 0, days: null, notes: "" }] };
      });
      state.currentQuote = {
        ...wz.info, companyId: wz.companyId, managerId: wz.managerId, customerId: wz.customerId,
        customerLogo: wz.info.customerLogo, sheets, _new: true,
      };
      state._wizard = null;
      state.page = "edit";
      render();
    } catch (e) { toast(e.message, "error"); }
  });
}

// ---------------- Editor ----------------
// ===== Màn ACCOUNT HÀ NỘI (role account_hn) — CHỈ phần HN, rút gọn =====
// API trả _accountHnView (presentQuoteForAccountHn): chỉ định danh dự án + trạng thái +
// hnSheets[{sheetId, hnTables:[bảng hanoi]}]. Account điền các bảng hanoi (lưới đầy đủ),
// Lưu (PUT /:id/hn — server chỉ ghi hanoi), Gửi duyệt. Sửa được khi assigned/rejected.
function blankHnItem() { return { kind: "item", name: "", detail: "", unit: "", quantity: 0, unitPrice: 0, days: null, notes: "" }; }
function defaultHnTemplateId(q) {
  const t = state.templates.find((x) => x.companyId === q.companyId) || state.templates[0];
  return t ? t.id : null;
}
async function saveHnPart(q, thenSubmit) {
  const payload = { hnSheets: (q.hnSheets || []).map((hs) => ({ sheetId: hs.sheetId, hnTables: hs.hnTables || [] })) };
  try {
    await api(`/api/quotes/${q.id}/hn`, { method: "PUT", body: JSON.stringify(payload) });
    window._editorDirty = false;
    if (thenSubmit) { await api(`/api/quotes/${q.id}/hn/submit`, { method: "POST" }); toast("Đã gửi duyệt phần Hà Nội", "success"); }
    else toast("Đã lưu phần Hà Nội", "success");
    const fresh = await api(`/api/quotes/${q.id}`);
    state.currentQuote = fresh; render();
  } catch (e) { toast(e.message || "Lỗi lưu phần HN", "error"); }
}
function renderAccountHnView(el, q) {
  const editable = !q.hnStatus || ["assigned", "rejected"].includes(q.hnStatus);
  const statusLabel = { assigned: "Đang làm", submitted: "Đã gửi — chờ quản lý duyệt", approved: "✓ Đã duyệt", rejected: "↩ Bị trả lại" }[q.hnStatus] || "Đang làm";
  if (!Array.isArray(q.hnSheets) || !q.hnSheets.length) q.hnSheets = [{ sheetId: null, sheetName: null, hnTables: [] }];
  el.innerHTML = `
    <div class="account-hn-view">
      <div class="ahn-head">
        <div><h2 style="margin:0">Phần Giá Hà Nội</h2>
          <div class="muted">${escapeHtml(q.projectCode || q.quoteNumber || "")}${q.title ? " · " + escapeHtml(q.title) : ""}${q.companyName ? " · " + escapeHtml(q.companyName) : ""}</div></div>
        <span class="ahn-status ahn-${q.hnStatus || "assigned"}">${statusLabel}</span>
      </div>
      ${q.hnStatus === "rejected" && q.hnRejectNote ? `<div class="ahn-reject">↩ <strong>Quản lý trả lại:</strong> ${escapeHtml(q.hnRejectNote)}</div>` : ""}
      <div class="muted" style="margin:8px 0 4px">Bạn chỉ điền <strong>giá Hà Nội</strong> (số nội bộ — KHÔNG xuất cho khách, không thấy phần báo giá khác).</div>
      <div id="ahn-tables"></div>
      <div class="ahn-actions" style="margin-top:14px;display:flex;gap:10px;align-items:center">
        ${editable ? `<button class="btn btn-sm" id="ahn-save">💾 Lưu</button><button class="btn btn-sm btn-primary" id="ahn-submit">✓ Gửi duyệt</button>` : `<span class="muted">${q.hnStatus === "submitted" ? "Đã gửi, chờ quản lý duyệt — không sửa được lúc này." : q.hnStatus === "approved" ? "Phần Hà Nội đã được duyệt." : ""}</span>`}
      </div>
    </div>`;
  const host = el.querySelector("#ahn-tables");
  q.hnSheets.forEach((hs, si) => {
    if (!Array.isArray(hs.hnTables) || !hs.hnTables.length) hs.hnTables = [{ category: "hanoi", name: "", templateId: defaultHnTemplateId(q), groupSubtotal: true, items: [blankHnItem()] }];
    hs.hnTables.forEach((t, ti) => {
      if (!t.templateId) t.templateId = defaultHnTemplateId(q);
      const tpl = state.templates.find((x) => x.id === t.templateId) || state.templates.find((x) => x.companyId === q.companyId) || state.templates[0];
      const showDetail = !!(tpl && tpl.layout && tpl.layout.hasDetail), usesDays = !!(tpl && tpl.layout && tpl.layout.hasDays);
      const gid = `ahn-grid-${si}-${ti}`;
      const div = document.createElement("div"); div.className = "extra-table"; div.style.marginTop = "10px";
      div.innerHTML = `<div class="extra-table-head"><span class="extra-cat-badge cat-hanoi">Báo Giá Hà Nội</span>${si > 0 || ti > 0 ? "" : ""}
          <input class="ahn-name" value="${escapeHtml(t.name || "")}" placeholder="Tên bảng (tuỳ chọn)" data-si="${si}" data-ti="${ti}" ${editable ? "" : "disabled"} /></div>
        <div class="tbl-scroll"><table class="excel-table" id="${gid}">${gridHeadHtml(showDetail, usesDays, editable)}<tbody></tbody><tfoot></tfoot></table></div>`;
      host.appendChild(div);
      if (typeof t.groupSubtotal !== "boolean") t.groupSubtotal = true;
      if (!Array.isArray(t.items) || !t.items.length) t.items = [blankHnItem()];
      if (!t._grid) Object.defineProperty(t, "_grid", { value: newExtraGrid(), writable: true, configurable: true, enumerable: false });
      try {
        drawItems(q, t, editable, tpl && tpl.code, usesDays, t._grid, { tableSel: `#${gid}`, fxBar: false, totalLabel: "HN", subtotalFn: (sh) => extraTableSumLocal(sh), onRedraw: () => { window._editorDirty = true; }, onCellInput: () => { window._editorDirty = true; } });
      } catch (err) { console.error("[ahn grid]", err); }
    });
  });
  if (!editable) return;
  host.addEventListener("input", (e) => {
    const s = e.target;
    if (s.classList && s.classList.contains("ahn-name") && s.dataset.si != null) { const hs = q.hnSheets[+s.dataset.si]; if (hs && hs.hnTables[+s.dataset.ti]) { hs.hnTables[+s.dataset.ti].name = s.value; window._editorDirty = true; } }
  });
  el.querySelector("#ahn-save").addEventListener("click", () => saveHnPart(q, false));
  el.querySelector("#ahn-submit").addEventListener("click", () => { if (confirm("Gửi duyệt phần Hà Nội? Sau khi gửi sẽ không sửa được cho tới khi quản lý duyệt/trả.")) saveHnPart(q, true); });
}

// Panel cho QUẢN LÝ trong renderEditor: giao phần HN cho Account, + duyệt/trả khi account gửi.
function renderManagerHnPanel(q) {
  const el = document.getElementById("hn-manager-panel");
  if (!el) return;
  const st = q.hnStatus;
  const label = { assigned: "Account đang làm", submitted: "Account đã gửi — chờ bạn DUYỆT", approved: "✓ Đã duyệt", rejected: "↩ Đã trả lại" }[st] || "Chưa giao";
  const canAssign = !st || st === "rejected" || st === "approved";
  el.innerHTML = `<div class="hn-mgr-panel">
    <span class="extra-cat-badge cat-hanoi">Phần Hà Nội (Account)</span>
    <span class="ahn-status ahn-${st || "none"}">${label}</span>
    ${st && q.hnAssigneeId ? `<span class="muted" style="font-size:12px">đã giao</span>` : ""}
    ${canAssign ? `<select id="hn-acc-sel" class="extra-add-cat"><option value="">— chọn Account HN —</option></select><button type="button" class="btn btn-sm" id="hn-assign-btn">${st ? "Giao lại" : "Giao cho Account HN"}</button>` : ""}
    ${st === "submitted" ? `<button type="button" class="btn btn-sm btn-primary" id="hn-approve-btn">✓ Duyệt</button><button type="button" class="btn btn-sm" id="hn-reject-btn">↩ Trả lại</button>` : ""}
    ${st === "rejected" && q.hnRejectNote ? `<span class="muted" style="font-size:12px">lý do trả: ${escapeHtml(q.hnRejectNote)}</span>` : ""}
  </div>`;
  const reload = async () => { try { const fresh = await api(`/api/quotes/${q.id}`); state.currentQuote = fresh; render(); } catch {} };
  const sel = document.getElementById("hn-acc-sel");
  if (sel) api("/api/quotes/hn/accounts").then((r) => (r.data || []).forEach((a) => { const o = document.createElement("option"); o.value = a.id; o.textContent = a.displayName || a.username; sel.appendChild(o); })).catch(() => {});
  document.getElementById("hn-assign-btn")?.addEventListener("click", async () => {
    const accId = +(document.getElementById("hn-acc-sel") || {}).value;
    if (!accId) return toast("Chọn Account HN trước", "error");
    try { await api(`/api/quotes/${q.id}/hn/assign`, { method: "POST", body: JSON.stringify({ accountId: accId }) }); toast("Đã giao phần HN cho Account", "success"); reload(); } catch (e) { toast(e.message || "Lỗi giao", "error"); }
  });
  document.getElementById("hn-approve-btn")?.addEventListener("click", async () => {
    try { await api(`/api/quotes/${q.id}/hn/review`, { method: "POST", body: JSON.stringify({ decision: "approve" }) }); toast("Đã duyệt phần HN", "success"); reload(); } catch (e) { toast(e.message || "Lỗi", "error"); }
  });
  document.getElementById("hn-reject-btn")?.addEventListener("click", async () => {
    const note = prompt("Lý do trả lại phần HN (Account sẽ thấy):"); if (note === null) return;
    try { await api(`/api/quotes/${q.id}/hn/review`, { method: "POST", body: JSON.stringify({ decision: "reject", note }) }); toast("Đã trả lại phần HN", "success"); reload(); } catch (e) { toast(e.message || "Lỗi", "error"); }
  });
}

function renderEditor(el, quote) {
  const isNew = !!quote._new;
  const q = JSON.parse(JSON.stringify(quote));
  if (q.quoteDate && q.quoteDate.length > 10) q.quoteDate = q.quoteDate.slice(0, 10);
  if (q.executionDate && q.executionDate.length > 10) q.executionDate = q.executionDate.slice(0, 10);
  if (!q.sheets || !q.sheets.length) {
    q.sheets = [{ templateId: state.templates[0]?.id, groupSubtotal: true, items: [] }];
  }
  q._activeSheet = 0;
  q.sheets.forEach((s) => { if (!Array.isArray(s.extraTables)) s.extraTables = []; });

  // Excel-grid session state (selection rectangle, undo/redo stacks, clipboard buffer,
  // preview flag) — lives in THIS closure, never on DOM nodes, so it survives the
  // tbody.innerHTML re-renders inside drawItems and resets when render() rebuilds the editor.
  const grid = { sel: null, selSheet: 0, copyBuf: null, _copyToken: 0, undo: [], redo: [], previewOpen: false, focusSnap: null, _dirty: false, requestDraw: null };

  // Unsaved-changes tracking for the leave-guard. Fresh open = clean; any input/
  // change bubbling out of the editor marks it dirty (idempotent property handler,
  // survives the draw() innerHTML re-renders). Cleared on successful save below.
  // Gate on state.page so this handler (the #main node is reused by other views)
  // can't mark dirty once we've navigated away from the editor.
  window._editorDirty = false;
  el.oninput = () => { if (state.page === "edit") window._editorDirty = true; };
  el.onchange = () => { if (state.page === "edit") window._editorDirty = true; };

  // Mirror the server rule: admin edits all; manager edits only own; employee
  // edits own or quotes they're a member of (and only while draft/rejected).
  const isMember = (q.members || []).some(m => m.id === state.user.id);
  const canUpdate = state.user.role === "admin" || q.createdById === state.user.id || isMember;
  const editable = isNew
    || (canUpdate && ((state.user.role === "admin" || state.user.role === "manager") || q.status === "draft" || q.status === "rejected"));

  const draw = () => {
    const activeSheet = q.sheets[q._activeSheet];
    // Sheet/template switch: a selection rectangle from another sheet is meaningless
    // (FIELDS differ), so drop it — but KEEP copyBuf (cross-sheet paste) + undo/redo.
    if (grid.sel && grid.selSheet !== q._activeSheet) grid.sel = null;
    grid.selSheet = q._activeSheet;
    const template = state.templates.find(t => t.id === activeSheet.templateId);
    const tplCode = template?.code;
    // Column layout is driven by the template's own config (exposed via meta),
    // so each form shows the same columns as its Excel sheet.
    const usesDays = !!template?.layout?.hasDays;
    // Sender address is locked to the issuing company's letterhead address (read-only field).
    const _senderCo = state.companies.find(c => c.id === q.companyId);
    if (_senderCo && _senderCo.address) q.fromAddress = _senderCo.address;
    const showDetail = !!template?.layout?.hasDetail;

    el.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px">
        <h1>
          ${isNew ? "Tạo báo giá mới" : "Báo giá " + escapeHtml(codeLabel(q))}
          ${!isNew ? `<span class="status ${q.status}" style="margin-left:10px">${statusLabel(q.status)}</span>` : ""}
        </h1>
        <button class="btn" id="btn-back">← Quay lại</button>
      </div>
      <div class="editor">
        <div class="meta-2col">
          <fieldset class="meta-col">
            <legend>Bên nhận · Khách hàng</legend>
            <label>Tên khách hàng
              <input id="f-toCompany" value="${escapeHtml(q.toCompany || "")}" placeholder="Tên công ty khách" ${!editable ? "disabled" : ""} /></label>
            <label>Người liên hệ
              <input id="f-toContact" value="${escapeHtml(q.toContact || "")}" placeholder="Người liên hệ phía KH" ${!editable ? "disabled" : ""} /></label>
            <label>Email
              <input id="f-toEmail" type="email" value="${escapeHtml(q.toEmail || "")}" placeholder="Email khách (hiện ở 'Kính gửi')" ${!editable ? "disabled" : ""} /></label>
            <label>Điện thoại
              <input id="f-toPhone" value="${escapeHtml(q.toPhone || "")}" placeholder="SĐT khách hàng" ${!editable ? "disabled" : ""} /></label>
            <label>Địa chỉ
              <input id="f-toAddress" value="${escapeHtml(q.toAddress || "")}" placeholder="Địa chỉ khách hàng" ${!editable ? "disabled" : ""} /></label>
          </fieldset>
          <fieldset class="meta-col">
            <legend>Bên gửi · Công ty báo giá</legend>
            <label>Công ty <span class="muted" style="font-size:11px">(đã chọn lúc tạo)</span>
              <select id="f-companyId" disabled title="Công ty đã chọn khi tạo báo giá — không đổi ở đây">
                ${state.companies.map(c => `<option value="${c.id}" ${c.id === q.companyId ? "selected" : ""}>${escapeHtml(c.name)}</option>`).join("")}
              </select></label>
            <label>Người gửi
              <input id="f-fromContact" value="${escapeHtml(q.fromContact || "")}" placeholder="Người phụ trách" ${!editable ? "disabled" : ""} /></label>
            <label>Chức danh
              <input id="f-fromTitle" value="${escapeHtml(q.fromTitle || "")}" placeholder="VD: Trưởng phòng KD" ${!editable ? "disabled" : ""} /></label>
            <label>Điện thoại
              <input id="f-fromPhone" value="${escapeHtml(q.fromPhone || "")}" placeholder="SĐT người gửi" ${!editable ? "disabled" : ""} /></label>
            <label>Địa chỉ <span class="muted" style="font-size:11px">(tự theo công ty)</span>
              <input id="f-fromAddress" value="${escapeHtml(q.fromAddress || "")}" readonly title="Tự lấy theo Công ty bên gửi — không cần sửa" ${!editable ? "disabled" : ""} /></label>
          </fieldset>
        </div>
        <div class="meta-row">
          <label>Số xuất Excel <span class="muted" style="font-size:11px">(GN…)</span>
            <input id="f-quoteNumber" value="${escapeHtml(q.quoteNumber || "")}" placeholder="${isNew ? "Tự động cấp khi lưu" : ""}" readonly ${!editable ? "disabled" : ""} /></label>
          <label>Ngày báo giá
            <input type="date" id="f-quoteDate" value="${q.quoteDate}" ${!editable ? "disabled" : ""} /></label>
          <label>Ngày thi công <span class="muted" style="font-size:11px">(lắp đặt — chỉ quản lý nội bộ, không xuất Excel)</span>
            <input type="date" id="f-executionDate" value="${q.executionDate || ""}" ${!editable ? "disabled" : ""} /></label>
          <label>VAT (%)
            <input type="number" step="0.1" id="f-vatPercent" value="${q.vatPercent}" ${!editable ? "disabled" : ""} /></label>
          <label>Giảm giá (VNĐ) <span class="muted" style="font-size:11px">(trừ vào tổng)</span>
            <input type="number" step="1000" min="0" id="f-discount" value="${Number(q.discount) || 0}" ${!editable ? "disabled" : ""} /></label>
        </div>

        <div class="center-line" id="date-preview">${vnDateText(q.quoteDate, q.city)}</div>
        <input class="title-input" id="f-title" value="${escapeHtml(q.title || "")}" placeholder="Tên báo giá (chung cho mọi sheet)" ${!editable ? "disabled" : ""} />
        <div class="quote-no" id="qno-preview">(Số: ${escapeHtml(q.quoteNumber)})</div>

        <textarea class="greeting" id="f-greeting" rows="2" ${!editable ? "disabled" : ""}>${escapeHtml(q.greeting || "Chân thành cảm ơn Quí khách hàng đã quan tâm đến dịch vụ của chúng tôi, chúng tôi xin gởi bảng báo giá theo yêu cầu như sau:")}</textarea>

        <!-- Sheet tabs -->
        <div class="sheet-tabs">
          ${q.sheets.map((s, i) => `
            <div class="sheet-tab ${i === q._activeSheet ? "active" : ""}" data-tab="${i}" ${KBD} aria-pressed="${i === q._activeSheet}">
              <span>${escapeHtml(s.name || state.templates.find(t => t.id === s.templateId)?.name || "Sheet " + (i + 1))}</span>
              ${editable && q.sheets.length > 1 ? `<span class="rm-tab" data-rm-tab="${i}" title="Xóa sheet" ${KBD} aria-label="Xóa sheet ${i + 1}">✕</span>` : ""}
            </div>
          `).join("")}
          ${editable ? `<button class="btn btn-sm add-sheet" id="btn-add-sheet">+ Thêm sheet</button>` : ""}
        </div>

        <div class="sheet-meta" style="display:flex; gap:14px; margin: 8px 0; align-items:center; flex-wrap:wrap">
          <label style="font-size:13px">Tên sheet:
            <input id="f-sheet-name" value="${escapeHtml(activeSheet.name || "")}" style="padding:6px 10px; border:1px solid var(--border-strong); border-radius:var(--radius-sm); background:var(--surface)" ${!editable ? "disabled" : ""} />
          </label>
          <label style="font-size:13px">Template:
            <select id="f-sheet-template" ${!editable ? "disabled" : ""}>
              ${state.templates.filter(t => t.companyId === q.companyId).map(t => `<option value="${t.id}" ${t.id === activeSheet.templateId ? "selected" : ""}>${escapeHtml(t.name)}</option>`).join("")}
            </select>
          </label>
        </div>

        ${editable ? `<div class="fx-bar" id="fx-bar">
          <span class="fx-addr" id="fx-addr" title="Ô đang chọn">—</span>
          <span class="fx-fx" title="Công thức">fx</span>
          <input type="text" id="fx-input" autocomplete="off" spellcheck="false" placeholder="Công thức… vd =SUM(H3:H8) · =G3*E3 — bấm/kéo ô để chèn tham chiếu" />
        </div>` : ""}
        <div class="tbl-scroll">
        <table class="excel-table" id="items-table">
          <thead>
            <tr class="col-letters" aria-hidden="true">
              ${(() => {
                const cols = ["STT", "Hạng Mục", showDetail ? "Chi Tiết" : null, "ĐVT", "SỐ LƯỢNG", usesDays ? "SỐ NGÀY" : null, "ĐƠN GIÁ", "THÀNH TIỀN", "GHI CHÚ", "GHI CHÚ NỘI BỘ"].filter(Boolean);
                return cols.map((_, i) => `<th class="col-letter">${groupLetter(i)}</th>`).join("") + (editable ? `<th class="col-letter"></th>` : "");
              })()}
            </tr>
            <tr>
              <th scope="col" style="width:50px">STT</th>
              <th scope="col">Hạng Mục</th>
              ${showDetail ? `<th scope="col">Chi Tiết</th>` : ""}
              <th scope="col" style="width:80px">ĐVT</th>
              <th scope="col" style="width:90px">SỐ LƯỢNG</th>
              ${usesDays ? `<th scope="col" style="width:80px">SỐ NGÀY</th>` : ""}
              <th scope="col" style="width:130px">ĐƠN GIÁ&#10;(VNĐ)</th>
              <th scope="col" style="width:140px">THÀNH TIỀN&#10;(VNĐ)</th>
              <th scope="col" style="width:150px">GHI CHÚ</th>
              <th scope="col" style="width:150px" class="th-internal-note" title="Chỉ xem/quản lý nội bộ — KHÔNG xuất ra Excel/PDF">GHI CHÚ NỘI BỘ<br><span style="font-weight:400;font-size:10px;opacity:.75">(không xuất Excel)</span></th>
              ${editable ? `<th scope="col" style="width:36px"></th>` : ""}
            </tr>
          </thead>
          <tbody></tbody>
          <tfoot></tfoot>
        </table>
        </div>
        <div id="grid-stat" class="grid-stat hidden"></div>

        ${editable ? `<label class="toggle-totals" style="display:inline-flex;align-items:center;gap:8px;margin:16px 0 6px;font-size:13.5px;cursor:pointer">
          <input type="checkbox" id="f-showTotals" ${q.showTotals !== false ? "checked" : ""}/>
          <span>Hiển thị bảng <strong>Tổng cộng / VAT / Thành tiền</strong> (cả trên màn hình lẫn file Excel/PDF xuất ra)</span>
        </label>` : ""}
        ${editable ? `<div class="muted" style="margin:4px 0 6px;font-size:12.5px">Mẹo: để <strong>giảm giá</strong>, bấm “+ Thêm hàng”, ghi nội dung (vd “Giảm giá khách quen”) rồi nhập <strong>số tiền âm</strong> ở Đơn giá — sẽ tự trừ vào tổng.</div>` : ""}
        ${editable ? `<label class="toggle-totals" style="display:inline-flex;align-items:center;gap:8px;margin:8px 0 4px;font-size:13.5px;cursor:pointer">
          <input type="checkbox" id="f-hasNote" ${q.notes ? "checked" : ""}/>
          <span>Thêm <strong>Ghi chú</strong> cuối báo giá (in vào file Excel/PDF)</span>
        </label>
        <div id="note-wrap" style="${q.notes ? "" : "display:none"};margin:0 0 10px">
          <textarea id="f-notes" rows="2" placeholder="VD: Tất cả các hạng mục trên là thuê, Gia Nguyễn thu hồi toàn bộ sau khi tháo dỡ" style="width:100%;box-sizing:border-box;padding:8px;border:1px solid var(--border,#ccc);border-radius:6px;font:inherit;resize:vertical">${escapeHtml(q.notes || "")}</textarea>
        </div>` : (q.notes ? `<div class="muted" style="margin:8px 0"><strong>Ghi chú:</strong> ${escapeHtml(q.notes)}</div>` : "")}
        <div class="quote-summary" style="${q.showTotals === false ? "display:none" : ""}">
          ${renderQuoteSummary(q)}
        </div>

        <div id="hn-manager-panel"></div>
        <div id="extra-tables-wrap" class="extra-tables-wrap"></div>

        <div class="actions">
          ${editable ? `<button class="btn btn-primary" id="btn-save">Lưu</button>` : ""}
          ${editable && (isNew || q.status === "draft" || q.status === "rejected") ? `<button class="btn btn-warn" id="btn-submit">Trình duyệt</button>` : ""}
          ${!isNew && q.status === "pending" && (can("quote:approve") || (can("quote:approve:own") && q.createdById === state.user?.id)) ? `
            <button class="btn btn-success" id="btn-approve">Duyệt</button>` : ""}
          ${!isNew && q.status === "pending" && can("quote:approve") ? `
            <button class="btn btn-danger" id="btn-reject">Từ chối</button>
          ` : ""}
          ${!isNew && (q.status === "approved" || q.status === "sent") ? `<button class="btn btn-primary" id="btn-send">${q.status === "sent" ? "Gửi lại khách" : "Gửi khách"}</button>` : ""}
          ${!isNew ? `<div class="kebab-wrap">
            <button class="btn kebab-btn" id="btn-more" aria-haspopup="true" aria-expanded="false" title="Thêm thao tác">⋯</button>
            <div class="kebab-menu" id="more-menu" hidden role="menu">
              <button id="btn-excel" role="menuitem">Tải file Excel</button>
              <button id="btn-pdf" role="menuitem">Tải file PDF</button>
              <button id="btn-versions" role="menuitem">Lịch sử phiên bản</button>
              ${(state.user.role === "admin" || q.createdById === state.user.id) ? `<button id="btn-members" role="menuitem">Thành viên phụ trách</button>` : ""}
              ${(q.status === "approved" || q.status === "sent") ? `
                <div class="kebab-sep"></div>
                ${can("quote:send") ? `<button id="btn-convert" role="menuitem">Đánh dấu đã chốt</button>` : ""}
                <button id="btn-lost" role="menuitem" class="danger">Đánh dấu không chốt</button>
              ` : ""}
            </div>
          </div>` : ""}
        </div>
      </div>`;

    document.getElementById("btn-back").addEventListener("click", async () => {
      if (!(await leaveEditorGuard())) return;
      // Return to the last in-app page the user was on (never history.back(), which
      // could navigate out of the app on a deep-linked/refreshed editor).
      location.hash = window._returnHash || "#/list";
    });

    // Kebab "⋯" overflow menu. Self-contained to the wrapper element (no
    // document-level listeners) so it can't leak across draw() re-renders.
    const moreBtn = document.getElementById("btn-more");
    if (moreBtn) {
      const wrap = moreBtn.closest(".kebab-wrap");
      const menu = document.getElementById("more-menu");
      const closeMenu = () => { menu.hidden = true; moreBtn.setAttribute("aria-expanded", "false"); };
      moreBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const willOpen = menu.hidden;
        menu.hidden = !willOpen;
        moreBtn.setAttribute("aria-expanded", String(willOpen));
      });
      // Close when focus leaves the cluster (outside click, item chosen, Esc-blur).
      wrap.addEventListener("focusout", (e) => { if (!wrap.contains(e.relatedTarget)) closeMenu(); });
      menu.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeMenu(); moreBtn.focus(); } });
      menu.querySelectorAll("button").forEach(b => b.addEventListener("click", closeMenu));
    }

    // Sheet tab switching
    document.querySelectorAll(".sheet-tab").forEach(t => {
      t.addEventListener("click", (e) => {
        if (e.target.dataset.rmTab) return;  // handled below
        q._activeSheet = parseInt(t.dataset.tab, 10);
        draw();
      });
    });
    document.querySelectorAll("[data-rm-tab]").forEach(b => {
      b.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (!(await confirmModal("Xóa sheet", "Xóa sheet này khỏi báo giá?", { danger: true }))) return;
        const i = parseInt(b.dataset.rmTab, 10);
        q.sheets.splice(i, 1);
        if (q._activeSheet >= q.sheets.length) q._activeSheet = q.sheets.length - 1;
        draw();
      });
    });
    if (editable) {
      document.getElementById("btn-add-sheet").addEventListener("click", () => {
        const availTemplates = state.templates.filter(t => t.companyId === q.companyId);
        const tpl = availTemplates[0];
        q.sheets.push({
          templateId: tpl.id,
          name: tpl.name,
          groupSubtotal: true,
          items: [{ name: "", detail: "", unit: "", quantity: 1, unitPrice: 0, days: null, notes: "" }],
        });
        q._activeSheet = q.sheets.length - 1;
        draw();
      });
    }

    // Sheet name + template switcher
    const sheetNameInp = document.getElementById("f-sheet-name");
    if (sheetNameInp) sheetNameInp.addEventListener("input", e => { activeSheet.name = e.target.value; });
    const sheetTplSel = document.getElementById("f-sheet-template");
    if (sheetTplSel) sheetTplSel.addEventListener("change", e => {
      activeSheet.templateId = parseInt(e.target.value, 10);
      clearDaysIfUnused(activeSheet);   // new template has no Số Ngày column → drop stale days
      draw();
    });

    // Company change
    document.getElementById("f-companyId").addEventListener("change", e => {
      q.companyId = parseInt(e.target.value, 10);
      // Sender address follows the issuing company's letterhead address.
      const _co = state.companies.find(c => c.id === q.companyId);
      if (_co) q.fromAddress = _co.address || "";
      // Reset all sheets' templates to first available template of new company
      const tpls = state.templates.filter(t => t.companyId === q.companyId);
      if (tpls.length) {
        q.sheets.forEach(s => {
          if (!tpls.find(t => t.id === s.templateId)) s.templateId = tpls[0].id;
          clearDaysIfUnused(s);   // reassigned template may have no Số Ngày column
        });
      }
      draw();
    });

    // Items
    drawItems(q, activeSheet, editable, tplCode, usesDays, grid, { internalNote: true });   // lưới chính có cột "Ghi chú nội bộ" (KHÔNG xuất Excel)
    // Bảng nội bộ (chỉ quản lý — KHÔNG xuất Excel), lưới riêng độc lập với lưới báo giá
    drawExtraTables(q, activeSheet, editable);
    renderManagerHnPanel(q);   // panel giao/duyệt phần HN cho Account

    // Header field bindings
    const bindField = (id, prop) => {
      const e2 = document.getElementById(id);
      if (!e2) return;
      e2.addEventListener("input", (e) => {
        let v = e.target.value;
        if (prop === "vatPercent" || prop === "discount") v = Number(v);
        q[prop] = v;
        if (prop === "quoteNumber") document.getElementById("qno-preview").textContent = `(Số: ${q.quoteNumber})`;
        if (prop === "quoteDate" || prop === "city") {
          document.getElementById("date-preview").textContent = vnDateText(q.quoteDate, q.city);
        }
        if (prop === "vatPercent" || prop === "discount") updateSummary(q);
        refreshPreview(q);   // header fields (Kính gửi, title, date…) feed the live preview
      });
    };
    bindField("f-toCompany", "toCompany");
    bindField("f-toContact", "toContact");
    bindField("f-toEmail", "toEmail");
    bindField("f-toPhone", "toPhone");
    bindField("f-toAddress", "toAddress");
    bindField("f-fromContact", "fromContact");
    bindField("f-fromPhone", "fromPhone");
    bindField("f-fromTitle", "fromTitle");
    bindField("f-fromAddress", "fromAddress");
    bindField("f-quoteNumber", "quoteNumber");
    bindField("f-quoteDate", "quoteDate");
    bindField("f-executionDate", "executionDate");
    bindField("f-vatPercent", "vatPercent");
    bindField("f-discount", "discount");
    bindField("f-title", "title");
    bindField("f-greeting", "greeting");
    // (Đã bỏ "Xem trước bản in". Add-row xử lý trong footer "+ Thêm hàng".)

    bindActions(q, isNew);
  };

  grid.requestDraw = draw;   // undo/redo of a cross-sheet snapshot routes through the heavy draw()
  draw();
}

function bindActions(q, isNew) {
  const showTotalsBox = document.getElementById("f-showTotals");
  if (showTotalsBox) showTotalsBox.addEventListener("change", () => {
    q.showTotals = showTotalsBox.checked;
    const sum = document.querySelector(".quote-summary");
    if (sum) sum.style.display = q.showTotals ? "" : "none";
    refreshPreview(q);
  });
  // Ghi chú cuối báo giá (quote.notes): bật/tắt ô nhập.
  // Tick "có" → tự điền sẵn câu chuẩn (nếu đang trống), sửa/xoá tuỳ ý. Bỏ tick → ẩn + xoá.
  const DEFAULT_NOTE = "Tất cả các hạng mục trên là thuê, Gia Nguyễn thu hồi toàn bộ sau khi tháo dỡ";
  const noteBox = document.getElementById("f-hasNote");
  const noteWrap = document.getElementById("note-wrap");
  const noteInput = document.getElementById("f-notes");
  if (noteBox) noteBox.addEventListener("change", () => {
    if (noteBox.checked) {
      if (!(q.notes || "").trim()) { q.notes = DEFAULT_NOTE; if (noteInput) noteInput.value = DEFAULT_NOTE; }
      if (noteWrap) noteWrap.style.display = "";
      if (noteInput) { noteInput.focus(); noteInput.select(); }
    } else {
      q.notes = ""; if (noteInput) noteInput.value = "";
      if (noteWrap) noteWrap.style.display = "none";
    }
    refreshPreview(q);
  });
  if (noteInput) noteInput.addEventListener("input", () => { q.notes = noteInput.value; refreshPreview(q); });
  const saveBtn = document.getElementById("btn-save");
  if (saveBtn) saveBtn.addEventListener("click", async () => {
    if (saveBtn.disabled) return;                 // guard against double-click → double POST
    saveBtn.disabled = true;
    const label = saveBtn.textContent;
    saveBtn.textContent = "Đang lưu…";
    try {
      const payload = {
        ...q,
        sheets: q.sheets.map((s, i) => {
          const usesDays = sheetUsesDays(s);   // no Số Ngày column → never persist days (else money.js inflates the stored total)
          return {
            templateId: s.templateId,
            name: s.name,
            order: i + 1,
            groupSubtotal: !!s.groupSubtotal,
            items: (s.items || []).map((it, j) => ({ ...it, order: j + 1, days: usesDays ? it.days : null })),
            extraTables: Array.isArray(s.extraTables) ? s.extraTables : [],
          };
        }),
      };
      delete payload._new;
      delete payload._activeSheet;
      // For a new quote, let the server assign the per-company number (GN…/CLF…).
      if (isNew) delete payload.quoteNumber;
      let saved;
      if (isNew) saved = await api("/api/quotes", { method: "POST", body: JSON.stringify(payload) });
      else saved = await api(`/api/quotes/${q.id}`, { method: "PUT", body: JSON.stringify(payload) });
      state.currentQuote = saved;
      state.page = "edit";
      window._editorDirty = false;     // saved → no unsaved changes
      // Point the URL at the now-persisted quote so F5/back/bookmark resolve to it
      // (replaceState avoids a redundant hashchange → double-fetch).
      history.replaceState(null, "", "#/quotes/" + saved.id);
      toast("Đã lưu", "success");
      render();
    } catch (e) {
      // Map server field errors (err.details) to inline messages where possible.
      applyFieldErrors(e);
      toast(e.message, "error");
      saveBtn.disabled = false;
      saveBtn.textContent = label;
    }
  });
  const submitBtn = document.getElementById("btn-submit");
  if (submitBtn) submitBtn.addEventListener("click", async () => {
    if (isNew) { toast("Vui lòng Lưu trước khi trình duyệt", "error"); return; }
    // Guard against submitting an empty/zero-value quote (all prices still 0).
    const tot = Number(q.total || 0);
    if (tot <= 0 && !(await confirmModal("Tổng đang là 0", "Tổng báo giá đang là 0 (chưa nhập đơn giá). Vẫn trình duyệt?"))) return;
    try {
      const updated = await api(`/api/quotes/${q.id}/submit`, { method: "POST" });
      state.currentQuote = updated;
      toast("Đã gửi duyệt", "success");
      render();
    } catch (e) { toast(e.message, "error"); }
  });
  const approveBtn = document.getElementById("btn-approve");
  if (approveBtn) approveBtn.addEventListener("click", async () => {
    try {
      const updated = await api(`/api/quotes/${q.id}/approve`, { method: "POST" });
      state.currentQuote = updated;
      toast("Đã duyệt", "success");
      render();
    } catch (e) { toast(e.message, "error"); }
  });
  const rejectBtn = document.getElementById("btn-reject");
  if (rejectBtn) rejectBtn.addEventListener("click", async () => {
    try {
      const updated = await api(`/api/quotes/${q.id}/reject`, { method: "POST" });
      state.currentQuote = updated;
      toast("Đã từ chối", "success");
      render();
    } catch (e) { toast(e.message, "error"); }
  });
  const excelBtn = document.getElementById("btn-excel");
  if (excelBtn) excelBtn.addEventListener("click", () => {
    window.open(`/api/export/${q.id}.xlsx?t=${Date.now()}`, "_blank");   // cache-bust CDN
  });
  const pdfBtn = document.getElementById("btn-pdf");
  if (pdfBtn) pdfBtn.addEventListener("click", () => {
    window.open(`/api/export/${q.id}.pdf?t=${Date.now()}`, "_blank");   // cache-bust CDN
  });
  const versionsBtn = document.getElementById("btn-versions");
  if (versionsBtn) versionsBtn.addEventListener("click", () => showVersions(q.id));
  const membersBtn = document.getElementById("btn-members");
  if (membersBtn) membersBtn.addEventListener("click", () => openMembersModal(q));
  const sendBtn = document.getElementById("btn-send");
  if (sendBtn) sendBtn.addEventListener("click", async () => {
    try {
      const updated = await api(`/api/quotes/${q.id}/send`, { method: "POST" });
      state.currentQuote = updated;
      toast("Đã đánh dấu là đã gửi khách", "success");
      render();
    } catch (e) { toast(e.message, "error"); }
  });
  const convertBtn = document.getElementById("btn-convert");
  if (convertBtn) convertBtn.addEventListener("click", async () => {
    if (!(await confirmModal("Chốt báo giá", "Đánh dấu báo giá này là ĐÃ CHỐT (đã ký hợp đồng)?", { confirmText: "Đã chốt" }))) return;
    try {
      const updated = await api(`/api/quotes/${q.id}/mark-converted`, { method: "POST" });
      state.currentQuote = updated;
      toast("Đã chốt báo giá", "success");
      render();
    } catch (e) { toast(e.message, "error"); }
  });
  const lostBtn = document.getElementById("btn-lost");
  if (lostBtn) lostBtn.addEventListener("click", async () => {
    const reason = await promptModal("Không chốt được đơn này", "Lý do (không bắt buộc):", { placeholder: "VD: Khách chọn nhà cung cấp khác, giá cao…" });
    if (reason === null) return; // cancelled
    try {
      const updated = await api(`/api/quotes/${q.id}/mark-lost`, { method: "POST", body: JSON.stringify({ reason }) });
      state.currentQuote = updated;
      toast("Đã đánh dấu không chốt", "success");
      render();
    } catch (e) { toast(e.message, "error"); }
  });
}

/** Manage which employees can view & edit this quote (creator/admin only). */
async function openMembersModal(quote) {
  const m = openModal("Thành viên báo giá", `<div id="mem-body">${skeleton(4)}</div>`);
  try {
    const { data: users } = await api("/api/quotes/assignable-users");
    const currentIds = new Set((quote.members || []).map(u => u.id));
    const creatorId = quote.createdById;
    const body = m.find("#mem-body");
    body.innerHTML = `
      <p class="muted" style="margin-top:0">Chọn nhân viên được phép xem & sửa báo giá này. Người tạo luôn là thành viên.</p>
      <div style="max-height:50vh;overflow:auto">
        ${users.map(u => `
          <label style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--border)">
            <input type="checkbox" data-uid="${u.id}" ${currentIds.has(u.id) ? "checked" : ""} ${u.id === creatorId ? "checked disabled" : ""}/>
            <span>${escapeHtml(u.displayName)} <span class="muted">(${ROLE_LABEL_FULL[u.role] || u.role})</span>${u.id === creatorId ? ' <span class="muted">— người tạo</span>' : ""}</span>
          </label>`).join("")}
      </div>`;
    m.onSave(async () => {
      const memberIds = Array.from(body.querySelectorAll("[data-uid]"))
        .filter(c => c.checked && !c.disabled)
        .map(c => Number(c.dataset.uid));
      try {
        await api(`/api/quotes/${quote.id}/members`, { method: "PUT", body: JSON.stringify({ memberIds }) });
        toast("Đã cập nhật thành viên", "success");
        m.close();
        const fresh = await api(`/api/quotes/${quote.id}`);
        state.currentQuote = fresh; render();
      } catch (e) { toast(e.message, "error"); }
    });
  } catch (e) { toast(e.message, "error"); m.close(); }
}

/** Version history viewer with side-by-side diff between any two revisions. */
async function showVersions(quoteId) {
  const m = openModal("Lịch sử phiên bản", `<div id="ver-body">Đang tải…</div>`);
  try {
    const r = await api(`/api/quotes/${quoteId}/versions`);
    const versions = r.data || [];
    if (!versions.length) {
      m.find("#ver-body").innerHTML = "<div class='empty-state'>Chưa có phiên bản</div>";
      return;
    }
    m.find("#ver-body").innerHTML = `
      <table class="list-table" style="margin-bottom:12px">
        <thead><tr><th scope="col">Phiên bản</th><th scope="col">Thời gian</th><th scope="col" style="text-align:right">Tổng (VNĐ)</th></tr></thead>
        <tbody>${versions.map(v => `
          <tr><td>v${v.versionNo}</td><td>${new Date(v.createdAt).toLocaleString("vi-VN")}</td>
          <td style="text-align:right">${fmtMoney(v.total)}</td></tr>`).join("")}</tbody>
      </table>
      ${versions.length >= 2 ? `
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
          <span style="font-size:13px">So sánh:</span>
          <select id="ver-a">${versions.map(v => `<option value="${v.versionNo}">v${v.versionNo}</option>`).join("")}</select>
          <span>→</span>
          <select id="ver-b">${versions.map(v => `<option value="${v.versionNo}">v${v.versionNo}</option>`).join("")}</select>
          <button class="btn btn-sm" id="ver-diff-btn">Xem khác biệt</button>
        </div>
        <div id="ver-diff"></div>` : ""}`;
    if (versions.length >= 2) {
      const selA = m.find("#ver-a"), selB = m.find("#ver-b");
      selA.value = String(versions[1].versionNo);
      selB.value = String(versions[0].versionNo);
      m.find("#ver-diff-btn").addEventListener("click", async () => {
        const a = selA.value, b = selB.value;
        try {
          const d = await api(`/api/quotes/${quoteId}/versions/${a}/diff/${b}`);
          const box = m.find("#ver-diff");
          if (!d.changes.length) { box.innerHTML = "<div class='empty-state'>Không có thay đổi</div>"; return; }
          box.innerHTML = `<table class="list-table"><thead><tr><th scope="col">Trường</th><th scope="col">v${a}</th><th scope="col">v${b}</th></tr></thead>
            <tbody>${d.changes.map(c => `<tr>
              <td><code>${escapeHtml(c.key)}</code></td>
              <td style="color:#b91c1c;max-width:240px;overflow:hidden">${escapeHtml(JSON.stringify(c.before)).slice(0,200)}</td>
              <td style="color:#166534;max-width:240px;overflow:hidden">${escapeHtml(JSON.stringify(c.after)).slice(0,200)}</td>
            </tr>`).join("")}</tbody></table>`;
        } catch (e) { toast(e.message, "error"); }
      });
    }
  } catch (e) { toast(e.message, "error"); }
}

// Evaluate a simple arithmetic formula typed into a numeric cell (Excel-style).
// Supports + - * / and parentheses; "x"/"×" mean multiply; "," is a decimal point.
// CSP blocks eval()/Function(), so this is a tiny hand-written recursive-descent parser.
// Returns a finite Number, or null if the expression is malformed.
// Pure arithmetic evaluator: + - * / ( ), unary +/-, VN decimals (comma → dot).
// Returns a number or null if invalid.
function evalArith(input) {
  let s = String(input).replace(/,/g, ".").replace(/\s+/g, "");
  if (!s || !/^[-+*/().0-9]+$/.test(s)) return null;
  let pos = 0;
  const peek = () => s[pos];
  function expr() {
    let v = term();
    while (peek() === "+" || peek() === "-") { const op = s[pos++]; const r = term(); if (v === null || r === null) return null; v = op === "+" ? v + r : v - r; }
    return v;
  }
  function term() {
    let v = factor();
    while (peek() === "*" || peek() === "/") { const op = s[pos++]; const r = factor(); if (v === null || r === null) return null; v = op === "*" ? v * r : v / r; }
    return v;
  }
  function factor() {
    if (peek() === "(") { pos++; const v = expr(); if (peek() !== ")") return null; pos++; return v; }
    if (peek() === "-") { pos++; const v = factor(); return v === null ? null : -v; }
    if (peek() === "+") { pos++; return factor(); }
    let num = "";
    while (pos < s.length && /[0-9.]/.test(s[pos])) num += s[pos++];
    if (!num || isNaN(Number(num))) return null;
    return Number(num);
  }
  const result = expr();
  if (pos !== s.length || result === null || !isFinite(result)) return null;
  return result;
}

// Excel-style formula for a cell. Supports arithmetic + ( ) + ×, percent (8% → 0.08),
// and functions SUM/AVERAGE/AVG/PRODUCT/MIN/MAX/ROUND/ROUNDUP/ROUNDDOWN/INT/ABS/
// CEILING/FLOOR. Args separated by ";" (VN Excel), "," is the decimal separator.
// e.g. =SUM(1.000.000; 500.000)*1,1   =ROUND(123456*8%; 0)   =MAX(10;20)+5
const FORMULA_FNS = {
  SUM: (a) => a.reduce((x, y) => x + y, 0),
  PRODUCT: (a) => a.reduce((x, y) => x * y, 1),
  AVERAGE: (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0),
  AVG: (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0),
  MIN: (a) => (a.length ? Math.min(...a) : 0),
  MAX: (a) => (a.length ? Math.max(...a) : 0),
  ROUND: (a) => { const p = 10 ** (a[1] || 0); return Math.round((a[0] || 0) * p) / p; },
  ROUNDUP: (a) => { const p = 10 ** (a[1] || 0); return Math.ceil((a[0] || 0) * p) / p; },
  ROUNDDOWN: (a) => { const p = 10 ** (a[1] || 0); return Math.trunc((a[0] || 0) * p) / p; },
  INT: (a) => Math.floor(a[0] || 0),
  ABS: (a) => Math.abs(a[0] || 0),
  CEILING: (a) => Math.ceil(a[0] || 0),
  FLOOR: (a) => Math.floor(a[0] || 0),
};
function evalFormula(input, refs) {
  let s = String(input).trim().replace(/^=/, "");
  if (!s) return null;
  // "×" is always multiply; "x"/"X" only BETWEEN digits (so it doesn't eat the
  // X in function names like MAX or a column ref like X3). Lookahead keeps "2x3x4".
  s = s.replace(/×/g, "*").replace(/(\d)\s*[xX]\s*(?=\d)/g, "$1*");
  // Resolve A1-style cell/range references to values (BEFORE % so "G3" → number first).
  // Ranges (H3:H8) become a ";"-joined list so SUM(H3:H8) works; single refs (G3) → a
  // bare number. `refs` is supplied only by the grid; absent (export/tests) = old behaviour.
  if (refs) {
    s = s.replace(/([A-Za-z]+\d+)\s*:\s*([A-Za-z]+\d+)/g, (_m, a, b) => {
      const list = refs.range(a, b);
      return (list && list.length) ? list.join(";") : "0";
    });
    s = s.replace(/(?<![A-Za-z0-9_.])([A-Za-z]+\d+)/g, (_m, a) => {
      const v = refs.cell(a);
      return (v === null || v === undefined || isNaN(v)) ? "0" : String(v);
    });
  }
  // percent: 8% → 0.08 (bare number; parens would block function matching below)
  s = s.replace(/(\d+(?:[.,]\d+)?)\s*%/g, (_m, n) => String(Number(n.replace(",", ".")) / 100));
  // Resolve function calls innermost-first until none remain. Results inline as
  // BARE numbers so nested calls SUM(MAX(..);..) + trailing arithmetic both work.
  let guard = 0;
  while (/[A-Za-z]+\s*\(/.test(s)) {
    if (guard++ > 100) return null;
    let changed = false;
    s = s.replace(/([A-Za-z]+)\s*\(([^()]*)\)/, (_m, name, args) => {
      changed = true;
      const fn = FORMULA_FNS[name.toUpperCase()];
      if (!fn) return "NaN";
      const vals = args.split(";").map((a) => evalArith(a)).filter((v) => v !== null && isFinite(v));
      const r = fn(vals);
      return (r === null || !isFinite(r)) ? "NaN" : String(r);
    });
    if (!changed) return null;
  }
  return evalArith(s);
}

// 0→"A", 1→"B", …, 25→"Z", 26→"AA". Auto letter for section (nhóm) rows.
// groupLetter -> moved to ./js/util.js

// Sheet subtotal honoring section (nhóm) multipliers: a section's Số Lượng multiplies the
// amounts of the items under it (until the next section). Section rows contribute 0 themselves.
function sheetSubtotalGrouped(items, usesDays, groupSubtotal) {
  let mult = 1, sum = 0;
  for (const it of (items || [])) {
    if (it.kind === "section" || it.kind === "subsection") { mult = groupSubtotal ? Math.max(1, Number(it.quantity) || 1) : 1; continue; }
    if (it.kind === "info") continue;   // dòng thông tin: không tính tiền (khớp Excel + money.js)
    const qty = Number(it.quantity) || 0, days = Number(it.days) || 1, price = Number(it.unitPrice) || 0;
    sum += (usesDays ? qty * days * price : qty * price) * mult;
  }
  return sum;
}

function sheetUsesDays(sheet) {
  const tpl = state.templates.find(t => t.id === sheet.templateId);
  return !!(tpl && tpl.layout && tpl.layout.hasDays);
}
// A template WITHOUT a Số Ngày column must not carry per-item `days`: the grid and the
// Excel export both ignore it, but src/money.js would still multiply qty×days×price and
// inflate the STORED total. Clear stale days (e.g. after switching template) so all paths
// agree. Returns sheets with days nulled where the template has no days column.
function clearDaysIfUnused(sheet) {
  if (!sheetUsesDays(sheet)) (sheet.items || []).forEach(it => { if (it.days != null) it.days = null; });
}

// ===== Bảng nội bộ (CHỈ quản lý — KHÔNG xuất Excel) =====
// Mỗi bảng nội bộ là MỘT LƯỚI ĐẦY ĐỦ y hệt báo giá (tái dùng drawItems): chọn template
// (GN/CLF có-ngày/không-ngày), công thức ƒ, copy/cut/paste, phím tắt Enter/Shift+Enter/mũi
// tên/Tab, nhóm cha/con/hàng con/dòng thông tin, "Hiện Thành Tiền nhóm", Tổng bảng — chỉ
// KHÁC duy nhất là KHÔNG xuất Excel. Mỗi bảng có grid-state + tableSel riêng (#extra-grid-N)
// nên không đụng lưới chính. Tổng theo loại (HCM/HN/KH) đổ sang trang Quản lý dự án.
const EXTRA_CATS = [["hcm", "Chi Phí HCM"], ["hanoi", "Báo Giá Hà Nội"], ["khach", "Phí Khách Hàng"]];
function extraCatLabel(c) { return ({ hcm: "Chi Phí HCM", hanoi: "Báo Giá Hà Nội", khach: "Phí Khách Hàng" })[c] || c; }
// State lưới riêng cho mỗi bảng nội bộ (KHÔNG lưu vào DB — sẽ là non-enumerable).
function newExtraGrid() { return { sel: null, selSheet: 0, copyBuf: null, _copyToken: 0, undo: [], redo: [], previewOpen: false, focusSnap: null, _dirty: false, requestDraw: null }; }
// <thead> theo template (giống renderEditor) — drawItems chỉ fill tbody/tfoot nên thead dựng riêng.
function gridHeadHtml(showDetail, usesDays, editable) {
  const labels = ["STT", "Hạng Mục", showDetail ? "Chi Tiết" : null, "ĐVT", "SỐ LƯỢNG", usesDays ? "SỐ NGÀY" : null, "ĐƠN GIÁ", "THÀNH TIỀN", "GHI CHÚ"].filter(Boolean);
  return `<thead>
    <tr class="col-letters" aria-hidden="true">${labels.map((_, i) => `<th class="col-letter">${groupLetter(i)}</th>`).join("")}${editable ? `<th class="col-letter"></th>` : ""}</tr>
    <tr>
      <th style="width:50px">STT</th><th>Hạng Mục</th>
      ${showDetail ? `<th>Chi Tiết</th>` : ""}
      <th style="width:80px">ĐVT</th><th style="width:90px">SỐ LƯỢNG</th>
      ${usesDays ? `<th style="width:80px">SỐ NGÀY</th>` : ""}
      <th style="width:130px">ĐƠN GIÁ&#10;(VNĐ)</th><th style="width:140px">THÀNH TIỀN&#10;(VNĐ)</th><th style="width:150px">GHI CHÚ</th>
      ${editable ? `<th style="width:36px"></th>` : ""}
    </tr>
  </thead>`;
}
// Tổng 1 sheet nội bộ — KHỚP CHÍNH XÁC src/quoteUtils.js extraTableSum (số đổ sang
// Quản lý dự án): bỏ section/subsection/info, qty×(days nếu>0)×price, KHÔNG hệ số nhóm.
function extraTableSumLocal(t) {
  return ((t && t.items) || []).reduce((acc, it) => {
    if (it.kind === "section" || it.kind === "subsection" || it.kind === "info") return acc;
    const qty = Number(it.quantity) || 0, price = Number(it.unitPrice) || 0;
    const days = it.days != null ? Number(it.days) : null;
    return acc + (days && days > 0 ? qty * days * price : qty * price);
  }, 0);
}
function drawExtraTables(q, activeSheet, editable) {
  const wrap = document.getElementById("extra-tables-wrap");
  if (!wrap) return;
  try {
    if (!Array.isArray(activeSheet.extraTables)) activeSheet.extraTables = [];
    const tables = activeSheet.extraTables;
    const tplList0 = state.templates.filter(t => t.companyId === q.companyId);
    const tplList = tplList0.length ? tplList0 : state.templates;
    const defTplId = (tplList[0] && tplList[0].id) || activeSheet.templateId;
    const tplOf = (t) => state.templates.find(x => x.id === (t.templateId || defTplId)) || state.templates.find(x => x.id === activeSheet.templateId) || tplList[0];
    const blankItem = () => ({ kind: "item", name: "", detail: "", unit: "", quantity: 0, unitPrice: 0, days: null, notes: "" });
    const setGrid = (t) => { if (!t._grid) Object.defineProperty(t, "_grid", { value: newExtraGrid(), writable: true, configurable: true, enumerable: false }); };
    // Null days CŨ cho bảng dùng template KHÔNG có cột Số Ngày (giống clearDaysIfUnused của
    // lưới chính): extraTableSum tính theo per-item days nên days cũ (sau khi đổi has-days →
    // no-days) sẽ làm PHỒNG tổng + lệch số đổ sang Quản lý dự án. Dọn để mọi đường khớp.
    if (editable) {
      let cleaned = false;
      tables.forEach((x) => { const xt = tplOf(x); if (!(xt && xt.layout && xt.layout.hasDays)) (x.items || []).forEach((it) => { if (it.days != null) { it.days = null; cleaned = true; } }); });
      if (cleaned) window._editorDirty = true;
    }
    // Tổng từng LOẠI = đúng số đổ sang Quản lý dự án (Σ extraTableSum theo loại).
    const catTotal = (cat) => tables.reduce((a, x) => a + (x && x.category === cat ? extraTableSumLocal(x) : 0), 0);
    // Sheet nội bộ đang mở (1 lúc 1 sheet như Excel) — index toàn cục trong extraTables.
    let active = Number.isInteger(activeSheet._activeExtra) ? activeSheet._activeExtra : 0;
    if (active >= tables.length) active = tables.length - 1;
    if (active < 0) active = 0;
    activeSheet._activeExtra = active;
    const t = tables[active] || null;
    const tpl = t ? tplOf(t) : null;
    const showDetail = !!(tpl && tpl.layout && tpl.layout.hasDetail), usesDays = !!(tpl && tpl.layout && tpl.layout.hasDays);

    // Mỗi LOẠI tách RIÊNG (HCM / HN / Phí KH) — vì tổng mỗi loại đổ riêng sang dự án.
    const groupsHtml = EXTRA_CATS.map(([cat, label]) => {
      const idxs = []; tables.forEach((x, i) => { if (x && x.category === cat) idxs.push(i); });
      return `<div class="extra-cat-group">
        <div class="extra-cat-grouphead">
          <span class="extra-cat-badge cat-${cat}">${label}</span>
          <span class="extra-cat-total" data-cat="${cat}">Tổng: <strong>${fmtMoney(catTotal(cat))}</strong> <span class="muted">→ Quản lý dự án</span></span>
          ${editable ? `<button type="button" class="btn btn-sm extra-add-in" data-cat="${cat}">+ Thêm sheet</button>` : ""}
          <span class="muted" style="font-size:11.5px">${idxs.length} sheet</span>
        </div>
        <div class="sheet-tabs extra-sheet-tabs">
          ${idxs.length ? idxs.map((i) => `<div class="sheet-tab ${i === active ? "active" : ""}" data-extab="${i}" title="${escapeHtml(label)}">
            <span>${escapeHtml(tables[i].name || ("Bảng " + (i + 1)))}</span>
            ${editable ? `<span class="rm-tab" data-rm-extab="${i}" title="Xoá sheet nội bộ này">✕</span>` : ""}
          </div>`).join("") : `<span class="muted" style="font-size:12px;padding:3px 2px">(chưa có — bấm “+ Thêm sheet”)</span>`}
        </div>
      </div>`;
    }).join("");

    wrap.innerHTML = `
      <div class="extra-head">
        <div><strong>Bảng nội bộ</strong> <span class="muted" style="font-weight:400;font-size:12px">— mỗi LOẠI (HCM · HN · Phí KH) tách RIÊNG; Tổng từng loại đổ riêng sang Quản lý dự án. SHEET đầy đủ như báo giá (template · công thức · nhóm · copy/paste) nhưng KHÔNG xuất Excel.</span></div>
        ${editable ? `<label class="muted" style="font-size:12px;display:flex;align-items:center;gap:5px;white-space:nowrap">Mẫu khi thêm: <select id="extra-add-tpl" class="extra-add-cat">${tplList.map(x => `<option value="${x.id}">${escapeHtml(x.name)}</option>`).join("")}</select></label>` : ""}
      </div>
      <div class="extra-cat-groups">${groupsHtml}</div>
      ${t ? `
        <div class="extra-table">
          <div class="extra-table-head">
            <span class="extra-cat-badge cat-${escapeHtml(t.category)}">${escapeHtml(extraCatLabel(t.category))}</span>
            ${editable ? `<label class="muted" style="font-size:12px;display:flex;align-items:center;gap:5px">Loại: <select class="extra-cat-sel extra-add-cat">${EXTRA_CATS.map(([v, l]) => `<option value="${v}" ${v === t.category ? "selected" : ""}>${l}</option>`).join("")}</select></label>` : ""}
            <input class="extra-name" value="${escapeHtml(t.name || "")}" placeholder="Tên sheet (tuỳ chọn)" ${editable ? "" : "disabled"} />
            ${editable ? `<label class="muted" style="font-size:12px;display:flex;align-items:center;gap:5px;white-space:nowrap">Mẫu: <select class="extra-tpl extra-add-cat">${tplList.map(x => `<option value="${x.id}" ${tpl && x.id === tpl.id ? "selected" : ""}>${escapeHtml(x.name)}</option>`).join("")}</select></label>` : ""}
          </div>
          <div class="tbl-scroll"><table class="excel-table" id="extra-grid-active">${gridHeadHtml(showDetail, usesDays, editable)}<tbody></tbody><tfoot></tfoot></table></div>
        </div>
      ` : `<div class="muted" style="padding:6px 0 2px">Chưa có sheet nội bộ — bấm “+ Thêm sheet” ở loại tương ứng phía trên.</div>`}
    `;

    // Render SHEET đang mở bằng lưới ĐẦY ĐỦ (drawItems); cập nhật Tổng loại live khi sửa.
    if (t) {
      if (typeof t.groupSubtotal !== "boolean") t.groupSubtotal = true;
      if (!Array.isArray(t.items) || !t.items.length) t.items = [blankItem()];
      setGrid(t);
      const updCatTotal = (cat) => { const el = wrap.querySelector(`.extra-cat-total[data-cat="${cat}"] strong`); if (el) el.textContent = fmtMoney(catTotal(cat)); };
      try {
        drawItems(q, t, editable, tpl && tpl.code, usesDays, t._grid, { tableSel: "#extra-grid-active", fxBar: false, totalLabel: "sheet", subtotalFn: (sh) => extraTableSumLocal(sh), onRedraw: () => { window._editorDirty = true; updCatTotal(t.category); }, onCellInput: () => updCatTotal(t.category) });
      } catch (err) { console.error("[extra grid]", err); }
    }

    if (!editable) return;
    if (wrap._exBound) return;
    wrap._exBound = true;
    const cur = () => activeSheet._activeExtra;   // chỉ số sheet đang mở (đọc động, tránh stale-closure)
    wrap.addEventListener("click", (e) => {
      const rm = e.target.closest && e.target.closest(".rm-tab[data-rm-extab]");
      if (rm) { e.stopPropagation(); const ti = +rm.dataset.rmExtab; tables.splice(ti, 1); let a = activeSheet._activeExtra; if (a > ti) a--; if (a >= tables.length) a = tables.length - 1; if (a < 0) a = 0; activeSheet._activeExtra = a; window._editorDirty = true; drawExtraTables(q, activeSheet, editable); return; }
      const tab = e.target.closest && e.target.closest(".sheet-tab[data-extab]");
      if (tab) { activeSheet._activeExtra = +tab.dataset.extab; drawExtraTables(q, activeSheet, editable); return; }
      const add = e.target.closest && e.target.closest(".extra-add-in[data-cat]");
      if (add) {
        const cat = add.dataset.cat;
        const tplId = +((document.getElementById("extra-add-tpl") || {}).value) || defTplId;
        tables.push({ category: cat, templateId: tplId, name: "", groupSubtotal: true, items: [blankItem()] });
        activeSheet._activeExtra = tables.length - 1; window._editorDirty = true; drawExtraTables(q, activeSheet, editable); return;
      }
    });
    wrap.addEventListener("change", (e) => {
      const s = e.target; const a = cur();
      if (!tables[a]) return;
      if (s.classList && s.classList.contains("extra-tpl")) { tables[a].templateId = +s.value; tables[a]._grid = newExtraGrid(); window._editorDirty = true; drawExtraTables(q, activeSheet, editable); }
      else if (s.classList && s.classList.contains("extra-cat-sel")) { tables[a].category = s.value; window._editorDirty = true; drawExtraTables(q, activeSheet, editable); }
    });
    wrap.addEventListener("input", (e) => {
      const s = e.target;
      if (s.classList && s.classList.contains("extra-name") && s.dataset.f == null) { const a = cur(); if (tables[a]) { tables[a].name = s.value; window._editorDirty = true; const tabName = wrap.querySelector(`.sheet-tab[data-extab="${a}"] span`); if (tabName) tabName.textContent = s.value || ("Bảng " + (a + 1)); } }
    });
  } catch (err) { console.error("[drawExtraTables]", err); }
}

// ===== Xem công thức (formula peek) — dùng chung cho mọi ô/mọi quyền/mọi thiết bị =====
// Một popover nổi (gắn vào <body>) hiện công thức đã nhập + kết quả. Bấm ra ngoài / Esc / cuộn = đóng.
function ensureFxPeek() {
  let el = document.getElementById("fx-peek");
  if (!el) {
    el = document.createElement("div");
    el.id = "fx-peek"; el.className = "fx-peek hidden";
    document.body.appendChild(el);
    document.addEventListener("mousedown", (e) => {
      if (el.classList.contains("hidden")) return;
      if (e.target.closest && (e.target.closest("#fx-peek") || e.target.closest(".fx-peek-badge"))) return;
      el.classList.add("hidden");
    }, true);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") el.classList.add("hidden"); });
    window.addEventListener("scroll", () => el.classList.add("hidden"), true);
  }
  return el;
}
function showFxPeek(td) {
  const el = ensureFxPeek();
  const fx = td.dataset.fx || "";
  const val = td.dataset.fxVal || "";
  el.innerHTML = `<div class="fx-peek-h">ƒ Công thức ô này</div>` +
    `<div class="fx-peek-f">${escapeHtml(fx)}</div>` +
    (val !== "" ? `<div class="fx-peek-v">= ${escapeHtml(val)}</div>` : "");
  el.classList.remove("hidden");
  const r = td.getBoundingClientRect();
  const w = el.offsetWidth || 240;
  el.style.left = Math.max(8, Math.min(r.left, window.innerWidth - w - 10)) + "px";
  el.style.top = Math.min(r.bottom + 4, window.innerHeight - el.offsetHeight - 8) + "px";
}

function drawItems(q, activeSheet, editable, tplCode, usesDays, grid, opts = {}) {
  // opts.tableSel: chọn bảng đích ("#items-table" mặc định, hoặc "#extra-grid-N" cho lưới
  // NỘI BỘ). opts.fxBar=false: bỏ thanh công thức (singleton — chỉ lưới chính dùng).
  // opts.onRedraw: thay updateSummary khi vẽ lại lưới nội bộ. → drawItems chạy được nhiều nơi.
  const tableSel = opts.tableSel || "#items-table";
  const internalNoteCol = !!opts.internalNote;   // cột "Ghi chú nội bộ" — CHỈ lưới chính, KHÔNG xuất Excel (không có ở bảng nội bộ)
  const tbody = document.querySelector(`${tableSel} tbody`);
  const showDetail = !!state.templates.find(t => t.code === tplCode)?.layout?.hasDetail;
  // Fields that allow multi-line (Shift+Enter or paste with \n)
  const multilineFields = new Set(["name", "detail", "notes", "internalNote"]);

  // Numeric cells (số lượng / đơn giá / số ngày / thành tiền) display with VN
  // thousand-dots and show BLANK when zero/empty (so empty rows aren't full of "0").
  const fmtNumCell = (v) => { const n = Number(v); return (!n || isNaN(n)) ? "" : n.toLocaleString("vi-VN"); };
  // Parse a VN-formatted string ("1.234.567" / "12,5" / "-5.000") back to a number.
  const parseVN = (s) => {
    s = String(s).replace(/[^\d.,-]/g, "");
    if (!s || s === "-") return 0;
    const neg = s.startsWith("-");
    s = s.replace(/-/g, "").replace(/\./g, "");           // strip sign + thousand dots
    const parts = s.split(",");
    const num = parts.length > 1 ? Number(parts[0] + "." + parts.slice(1).join("")) : Number(parts[0]);
    return (neg ? -1 : 1) * (num || 0);
  };
  // Live thousand-grouping that tolerates an in-progress decimal (comma).
  const liveFormat = (raw) => {
    let s = String(raw).replace(/[^\d.,-]/g, "");
    const neg = s.startsWith("-");
    s = s.replace(/-/g, "").replace(/\./g, "");
    let [intp, ...rest] = s.split(",");
    intp = intp.replace(/^0+(?=\d)/, "");
    const grouped = intp ? Number(intp).toLocaleString("vi-VN") : "";
    let out = rest.length ? (grouped || "0") + "," + rest.join("") : grouped;
    return (neg ? "-" : "") + out;
  };

  // Group structure for "hàng con" (sub-items): an "item" head spans itself + the
  // following consecutive "sub" rows; STT + Hạng Mục cells merge (rowspan) across
  // the group, exactly like the CLF template. "info" rows are standalone program
  // notes (no STT / price). STT is numbered per group head only.
  // VIEW-ONLY: dùng `readonly` (KHÔNG `disabled`) để người chỉ-xem vẫn CHỌN + COPY được ô
  // (disabled thì không focus/bôi/copy được). Sửa/cắt/dán vẫn bị chặn theo `editable`.
  const dis = !editable ? "readonly" : "";
  const rowKind = activeSheet.items.map(() => "head");
  for (let i = 0; i < activeSheet.items.length; i++) {
    const k = activeSheet.items[i].kind;
    if (k === "info") rowKind[i] = "info";
    else if (k === "section" || k === "subsection") rowKind[i] = "section";
    else if (k === "sub" && i > 0 && (rowKind[i - 1] === "head" || rowKind[i - 1] === "sub")) rowKind[i] = "sub";
    else rowKind[i] = "head";
  }
  const rowspanOf = (i) => { let s = 1, j = i + 1; while (j < activeSheet.items.length && rowKind[j] === "sub") { s++; j++; } return s; };

  // Cells shared by head + sub rows (everything except STT + Hạng Mục).
  const dataCells = (it, i, amt) => `
        ${showDetail ? `<td class="col-detail"><textarea data-f="detail" rows="1" ${dis}>${escapeHtml(it.detail || "")}</textarea></td>` : ""}
        <td class="col-dvt"><input data-f="unit" value="${escapeHtml(it.unit || "")}" ${dis} /></td>
        <td class="col-qty"><input data-f="quantity" inputmode="decimal" title="Số hoặc công thức Excel: =E2*G2, =SUM(H3:H8), =ROUND(x;0), 8% — bấm/kéo ô để chèn tham chiếu" value="${fmtNumCell(it.quantity)}" ${dis} /></td>
        ${usesDays ? `<td class="col-qty"><input data-f="days" inputmode="numeric" value="${fmtNumCell(it.days)}" ${dis} /></td>` : ""}
        <td class="col-price"><input data-f="unitPrice" inputmode="numeric" title="Số hoặc công thức Excel: =G3*1,1, =SUM(G3:G8), =1000000*8%, =MAX(G3:G8) — bấm/kéo ô để chèn tham chiếu" value="${fmtNumCell(it.unitPrice)}" ${dis} /></td>
        <td class="col-amount">${fmtNumCell(amt)}</td>
        <td class="col-notes"><textarea data-f="notes" rows="1" ${dis}>${escapeHtml(it.notes || "")}</textarea></td>
        ${internalNoteCol ? `<td class="col-internal-note"><textarea data-f="internalNote" rows="1" placeholder="(không xuất Excel)" ${dis}>${escapeHtml(it.internalNote || "")}</textarea></td>` : ""}
        ${editable ? `<td class="col-action"><button class="add-sub" data-sub="${i}" title="Thêm hàng con">↳</button><button class="rm-row" data-rm="${i}" title="Xóa hàng">✕</button></td>` : ""}`;

  let sttNo = 0;
  let sectionIdx = -1;
  const infoColspan = 6 + (showDetail ? 1 : 0) + (usesDays ? 1 : 0) + (internalNoteCol ? 1 : 0);
  const sectionColspan = 4 + (showDetail ? 1 : 0) + (usesDays ? 1 : 0);
  // Per-section subtotals (for the "Tổng theo nhóm" display in the editor).
  const sectionSum = {};
  { let cur = -1;
    for (let s2 = 0; s2 < activeSheet.items.length; s2++) {
      if (rowKind[s2] === "section") { cur = s2; sectionSum[s2] = 0; }
      else if ((rowKind[s2] === "head" || rowKind[s2] === "sub") && cur >= 0) {
        const x = activeSheet.items[s2];
        sectionSum[cur] += usesDays ? (Number(x.quantity) || 0) * (Number(x.days) || 1) * (Number(x.unitPrice) || 0)
                                    : (Number(x.quantity) || 0) * (Number(x.unitPrice) || 0);
      }
    }
  }
  tbody.innerHTML = activeSheet.items.map((it, i) => {
    if (rowKind[i] === "section") {
      const isSub = it.kind === "subsection";       // nhóm con: tổng riêng, KHÔNG cộng vào nhóm chính, VẪN vào tổng cộng
      let letter = "";
      if (!isSub) { sectionIdx++; letter = groupLetter(sectionIdx); }   // nhóm con không chiếm chữ cái A/B/C
      sttNo = 0;
      const subAmt = sectionSum[i] || 0;
      return `
      <tr data-row="${i}" class="section-row${isSub ? " subgroup-row" : ""}">
        <td class="col-stt"><input data-f="label" value="${escapeHtml(it.label || "")}" placeholder="${isSub ? "↳" : letter}" title="${isSub ? "Nhãn nhóm con (tuỳ chọn)" : `Chữ nhóm (để trống = tự ${letter})`}" ${dis} style="width:34px;text-align:center" /></td>
        <td class="col-hangmuc">${isSub ? `<span class="subgroup-caret" aria-hidden="true">↳ </span>` : ""}<textarea data-f="name" rows="1" placeholder="${isSub ? "Tên nhóm con (tổng riêng, không cộng vào nhóm chính)" : "Tên nhóm (vd: Wallsticker)"}" ${dis}>${escapeHtml(it.name || "")}</textarea></td>
        ${showDetail ? `<td class="col-detail"></td>` : ""}
        <td class="col-dvt"><input data-f="unit" value="${escapeHtml(it.unit || "")}" ${dis} /></td>
        <td class="col-qty"><input data-f="quantity" inputmode="decimal" value="${fmtNumCell(it.quantity)}" ${dis} /></td>
        ${usesDays ? `<td class="col-qty"></td>` : ""}
        <td class="col-price">${fmtNumCell(subAmt)}</td>
        <td class="col-amount">${activeSheet.groupSubtotal ? fmtNumCell(subAmt * Math.max(1, Number(it.quantity) || 1)) : ""}</td>
        <td class="col-notes"><textarea data-f="notes" rows="1" placeholder="Ghi chú nhóm" ${dis}>${escapeHtml(it.notes || "")}</textarea></td>
        ${internalNoteCol ? `<td class="col-internal-note"><textarea data-f="internalNote" rows="1" placeholder="(không xuất Excel)" ${dis}>${escapeHtml(it.internalNote || "")}</textarea></td>` : ""}
        ${editable ? `<td class="col-action"><button class="rm-row" data-rm="${i}" title="${isSub ? "Xóa nhóm con" : "Xóa nhóm"}">✕</button></td>` : ""}
      </tr>`;
    }
    if (rowKind[i] === "info") {
      return `
      <tr data-row="${i}" class="info-row">
        <td class="col-stt"></td>
        <td class="col-info" colspan="${infoColspan}"><textarea data-f="name" rows="1" placeholder="Dòng thông tin chương trình (không tính tiền)" ${dis}>${escapeHtml(it.name || "")}</textarea></td>
        ${editable ? `<td class="col-action"><button class="rm-row" data-rm="${i}" title="Xóa">✕</button></td>` : ""}
      </tr>`;
    }
    const qty = Number(it.quantity) || 0;
    const days = Number(it.days) || 1;
    const price = Number(it.unitPrice) || 0;
    const amt = usesDays ? qty * days * price : qty * price;
    if (rowKind[i] === "sub") {
      // Sub-row: STT + Hạng Mục covered by the head's rowspan, so omit those cells.
      return `<tr data-row="${i}" class="sub-row">${dataCells(it, i, amt)}</tr>`;
    }
    sttNo++;
    const span = rowspanOf(i);
    return `
      <tr data-row="${i}" class="grp-head${span > 1 ? " has-subs" : ""}">
        <td class="col-stt" rowspan="${span}">${sttNo}</td>
        <td class="col-hangmuc" rowspan="${span}"><textarea data-f="name" rows="1" ${dis}>${escapeHtml(it.name || "")}</textarea></td>
        ${dataCells(it, i, amt)}
      </tr>`;
  }).join("");

  // Auto-grow textareas to fit content
  tbody.querySelectorAll("textarea").forEach(ta => {
    const grow = () => {
      ta.style.height = "auto";
      ta.style.height = ta.scrollHeight + "px";
    };
    grow();
    ta.addEventListener("input", grow);
  });

  // Mark cells that hold a formula. AI CŨNG XEM ĐƯỢC CÔNG THỨC: ngoài tooltip khi rê
  // chuột (chỉ máy tính), gắn 1 nút "ƒ" THẬT (clickable) ở góc ô để MỌI người — kể cả
  // người chỉ-xem (ô bị disabled, không bắt được click/hover) và trên điện thoại — chỉ
  // cần BẤM là thấy đúng công thức đã nhập + kết quả, phục vụ quản lý/kiểm tra.
  activeSheet.items.forEach((it, i) => {
    if (!it.formulas) return;
    for (const f in it.formulas) {
      const fx = it.formulas[f]; if (!fx) continue;
      const cell = tbody.querySelector(`tr[data-row="${i}"] [data-f="${f}"]`);
      const td = cell?.closest("td"); if (!td) continue;
      const raw = it[f];
      const valTxt = (typeof raw === "number") ? (raw ? raw.toLocaleString("vi-VN") : "0") : (raw == null ? "" : String(raw));
      td.classList.add("has-formula");
      td.dataset.fx = fx;
      td.dataset.fxVal = valTxt;
      if (cell) cell.title = "Công thức: " + fx + " — bấm ƒ để xem";
      if (!td.querySelector(".fx-peek-badge")) {
        const b = document.createElement("button");
        b.type = "button"; b.className = "fx-peek-badge"; b.textContent = "ƒ";
        b.title = "Xem công thức"; b.setAttribute("aria-label", "Xem công thức ô này");
        td.appendChild(b);
      }
    }
  });
  // Bind ONCE: bấm badge "ƒ" (bất kỳ ô nào, bất kỳ tài khoản/quyền nào) → hiện công thức.
  if (tbody && !tbody._fxPeekBound) {
    tbody._fxPeekBound = true;
    tbody.addEventListener("click", (ev) => {
      const badge = ev.target.closest && ev.target.closest(".fx-peek-badge");
      if (!badge) return;
      ev.preventDefault(); ev.stopPropagation();
      const td = badge.closest("td"); if (td) showFxPeek(td);
    });
  }

  // ---- Excel-style grid helpers ----
  // Editable columns left→right (drives keyboard nav + multi-cell paste).
  const FIELDS = ["name", showDetail ? "detail" : null, "unit", "quantity", usesDays ? "days" : null, "unitPrice", "notes", internalNoteCol ? "internalNote" : null].filter(Boolean);
  const NUMERIC = new Set(["quantity", "unitPrice", "days"]);

  // ===== Excel A1-style cell addressing =====
  // Columns in the SAME visible order as the <thead>, each gets a letter A,B,C…
  // _stt (STT) and _amount (Thành Tiền) are read-only/computed but referenceable.
  const ADDR_COLS = [
    { field: "_stt", ro: true },
    { field: "name" },
    ...(showDetail ? [{ field: "detail" }] : []),
    { field: "unit" },
    { field: "quantity" },
    ...(usesDays ? [{ field: "days" }] : []),
    { field: "unitPrice" },
    { field: "_amount", ro: true },
    { field: "notes" },
    ...(internalNoteCol ? [{ field: "internalNote" }] : []),
  ];
  ADDR_COLS.forEach((c, i) => { c.L = groupLetter(i); });
  const letterToCol = {}; ADDR_COLS.forEach((c) => { letterToCol[c.L] = c; });
  const fieldToLetter = {}; ADDR_COLS.forEach((c) => { fieldToLetter[c.field] = c.L; });
  const colIndexOfLetter = (L) => ADDR_COLS.findIndex((c) => c.L === L);
  const addrOf = (row, field) => (fieldToLetter[field] || "") + (row + 1);
  const parseAddr = (a) => {
    const m = /^([A-Za-z]+)(\d+)$/.exec(String(a).trim());
    if (!m) return null;
    const col = letterToCol[m[1].toUpperCase()]; if (!col) return null;
    const row = parseInt(m[2], 10) - 1;
    if (row < 0 || row >= activeSheet.items.length) return null;
    return { row, field: col.field, col, L: col.L };
  };
  // Numeric value of any cell, for use inside a formula (amount computed live; a text
  // cell is parsed for a number if it looks like one, else 0 — like Excel).
  const cellNumByAddr = (a) => {
    const p = parseAddr(a); if (!p) return 0;
    const it = activeSheet.items[p.row]; if (!it) return 0;
    if (p.field === "_amount") {
      if (it.kind === "section" || it.kind === "subsection" || it.kind === "info") return 0;
      return usesDays ? (Number(it.quantity) || 0) * (Number(it.days) || 1) * (Number(it.unitPrice) || 0)
                      : (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0);
    }
    if (p.field === "_stt") return 0;
    if (NUMERIC.has(p.field)) return Number(it[p.field]) || 0;
    return parseVN(it[p.field] || "");   // text column → number-ish
  };
  // Resolver handed to evalFormula so "=G3", "=SUM(H3:H8)" resolve against this sheet.
  const formulaRefs = {
    cell: (a) => cellNumByAddr(a),
    range: (a, b) => {
      const pa = parseAddr(a), pb = parseAddr(b); if (!pa || !pb) return null;
      const ca = colIndexOfLetter(pa.L), cb = colIndexOfLetter(pb.L);
      const c0 = Math.min(ca, cb), c1 = Math.max(ca, cb);
      const r0 = Math.min(pa.row, pb.row), r1 = Math.max(pa.row, pb.row);
      const out = [];
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) out.push(cellNumByAddr(ADDR_COLS[c].L + (r + 1)));
      return out;
    },
  };
  const sheetHasFormulas = () => activeSheet.items.some((it) => it.formulas && Object.keys(it.formulas).length);
  // Re-evaluate every stored formula against current cell values, a few passes so
  // chains (a cell referencing another formula cell) settle. Grid is small → cheap.
  const recomputeAll = () => {
    if (!sheetHasFormulas()) return;
    for (let pass = 0; pass < 8; pass++) {
      let changed = false;
      for (const it of activeSheet.items) {
        if (!it.formulas) continue;
        for (const f in it.formulas) {
          const v = evalFormula(it.formulas[f], formulaRefs);
          if (v === null) continue;
          if (NUMERIC.has(f)) { if (it[f] !== v) { it[f] = v; changed = true; } }
          else { const sv = fmtNumCell(v); if (it[f] !== sv) { it[f] = sv; changed = true; } }
        }
      }
      if (!changed) break;
    }
  };
  // Repaint computed displays (amounts + every formula cell that isn't being typed in)
  // without rebuilding the table, so dependent cells update live like Excel.
  const paintComputedValues = () => {
    activeSheet.items.forEach((it, i) => {
      const tr = tbody.querySelector(`tr[data-row="${i}"]`); if (!tr) return;
      if (it.kind !== "section" && it.kind !== "subsection" && it.kind !== "info") {
        const amt = usesDays ? (Number(it.quantity) || 0) * (Number(it.days) || 1) * (Number(it.unitPrice) || 0)
                             : (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0);
        const ac = tr.querySelector(".col-amount"); if (ac) ac.textContent = fmtNumCell(amt);
      }
      if (it.formulas) for (const f in it.formulas) {
        const el = tr.querySelector(`[data-f="${f}"]`);
        if (el && document.activeElement !== el) el.value = NUMERIC.has(f) ? fmtNumCell(it[f]) : (it[f] ?? "");
      }
    });
    updateSummary(q); updateSectionSubtotals();
  };

  const blank = () => ({ kind: "item", name: "", detail: "", unit: "", quantity: 0, unitPrice: 0, days: usesDays ? 1 : null, notes: "" });
  const blankInfo = () => ({ kind: "info", name: "", detail: "", unit: "", quantity: 0, unitPrice: 0, days: null, notes: "" });
  const blankSub = () => ({ kind: "sub", name: "", detail: "", unit: "", quantity: 0, unitPrice: 0, days: usesDays ? 1 : null, notes: "" });
  const blankSection = () => ({ kind: "section", label: "", name: "", detail: "", unit: "", quantity: 0, unitPrice: 0, days: null, notes: "" });
  const blankSubSection = () => ({ kind: "subsection", label: "", name: "", detail: "", unit: "", quantity: 0, unitPrice: 0, days: null, notes: "" });
  // Parse a pasted Excel number ("1.000.000", "1,000,000", "12,5"…) into a real number.
  // Dùng helper thuần (đã unit-test) — gồm bản vá lỗi "1.234" (nghìn VN) bị đọc thành 1.234.
  const numLoose = (s) => parseLooseNumber(s);
  const redraw = () => { drawItems(q, activeSheet, editable, tplCode, usesDays, grid, opts); if (opts.onRedraw) opts.onRedraw(); else updateSummary(q); };
  // Live-refresh each section row's "Đơn Giá" (luôn) + "Thành Tiền" (khi bật toggle) as
  // item values change — without a full redraw, so the group total stays current while typing.
  const updateSectionSubtotals = () => {
    const sums = {}; let cur = -1;
    for (let s2 = 0; s2 < activeSheet.items.length; s2++) {
      if (rowKind[s2] === "section") { cur = s2; sums[s2] = 0; }
      else if ((rowKind[s2] === "head" || rowKind[s2] === "sub") && cur >= 0) {
        const x = activeSheet.items[s2];
        sums[cur] += usesDays ? (Number(x.quantity) || 0) * (Number(x.days) || 1) * (Number(x.unitPrice) || 0)
                              : (Number(x.quantity) || 0) * (Number(x.unitPrice) || 0);
      }
    }
    for (const idx in sums) {
      const trS = tbody.querySelector(`tr[data-row="${idx}"]`);
      if (!trS) continue;
      const sq = Math.max(1, Number(activeSheet.items[idx].quantity) || 1);
      const pc = trS.querySelector(".col-price"); if (pc) pc.textContent = fmtNumCell(sums[idx]);
      const ac = trS.querySelector(".col-amount"); if (ac) ac.textContent = activeSheet.groupSubtotal ? fmtNumCell(sums[idx] * sq) : "";
    }
    // Cập nhật "Tổng sheet" ở chân lưới REALTIME (trước đây chỉ đổi khi redraw).
    const stEl = document.querySelector(`${tableSel} .gf-subtotal-val`);
    if (stEl) stEl.textContent = fmtMoney(opts.subtotalFn ? opts.subtotalFn(activeSheet) : sheetSubtotalGrouped(activeSheet.items, usesDays, activeSheet.groupSubtotal));
    if (opts.onCellInput) opts.onCellInput();   // bảng nội bộ: cập nhật Tổng-theo-loại live khi gõ
  };
  const focusCell = (row, field, noSelect) => {
    const cell = tbody.querySelector(`tr[data-row="${row}"] [data-f="${field}"]`);
    if (cell) { cell.focus(); if (!noSelect && cell.select) cell.select(); }
  };
  // Commit an Excel-style formula in ANY cell: evaluate "=…" (with cell/range refs),
  // store the result, reformat, then recompute dependents + totals. No-op for plain text.
  const commitFormula = (inp2, i2, f2) => {
    if (!inp2) return;
    const raw = (inp2.value || "").trim();
    const it2 = activeSheet.items[i2]; if (!it2) return;
    // Not a formula → nothing to commit. Crucially do NOT delete it2.formulas here: a
    // committed formula cell DISPLAYS its computed result, so the blur fired by moving away
    // would see a plain number and wrongly wipe the formula (→ "click lại không hiện"). The
    // input handler already drops the formula when the user truly types a plain value over it.
    if (!raw.startsWith("=")) return;
    const val = evalFormula(raw, formulaRefs);
    if (NUMERIC.has(f2)) {
      const num = (val === null) ? (Number(it2[f2]) || 0) : val;
      it2[f2] = num; inp2.value = fmtNumCell(num);
    } else {
      const out = (val === null) ? (it2[f2] || "") : fmtNumCell(val);
      it2[f2] = out; inp2.value = out;
    }
    // Persist the formula text so re-focusing the cell shows it again (Excel behaviour).
    it2.formulas = { ...(it2.formulas || {}), [f2]: raw };
    recomputeAll(); paintComputedValues();
  };

  // ---- Excel-grid: selection / clipboard / undo (state on `grid`, survives redraw) ----
  const fieldIdx = (f) => FIELDS.indexOf(f);
  const cellEl = (row, field) => tbody.querySelector(`tr[data-row="${row}"] [data-f="${field}"]`);
  const rectOf = (sel) => {
    if (!sel) return null;
    const a = fieldIdx(sel.anchor.field), b = fieldIdx(sel.focus.field);
    return { r0: Math.min(sel.anchor.row, sel.focus.row), r1: Math.max(sel.anchor.row, sel.focus.row), c0: Math.min(a, b), c1: Math.max(a, b) };
  };
  // THE survive-redraw mechanism: highlight is re-derived from grid.sel on every draw.
  const paintSel = () => {
    tbody.querySelectorAll("td.cell-selected, td.cell-anchor").forEach(td => td.classList.remove("cell-selected", "cell-anchor"));
    tbody.querySelectorAll(".fill-handle").forEach(h => h.remove());
    const rc = rectOf(grid.sel);
    if (!rc) return;
    for (let r = rc.r0; r <= rc.r1; r++) for (let c = rc.c0; c <= rc.c1; c++) {
      const el = cellEl(r, FIELDS[c]); if (el) el.closest("td").classList.add("cell-selected");
    }
    const ae = cellEl(grid.sel.anchor.row, grid.sel.anchor.field); if (ae) ae.closest("td").classList.add("cell-anchor");
    // Fill-handle on the bottom-right cell (drag to copy the value down the rows).
    if (editable) {
      const td = cellEl(rc.r1, FIELDS[rc.c1])?.closest("td");
      if (td) {
        const h = document.createElement("div");
        h.className = "fill-handle";
        h.addEventListener("mousedown", (e) => {
          e.preventDefault(); e.stopPropagation();
          const start = rectOf(grid.sel); if (!start) return;
          const onMove = (mv) => {
            const cellTd = mv.target.closest && mv.target.closest("[data-row]");
            if (!cellTd) return;
            grid.sel = { anchor: grid.sel.anchor, focus: { row: parseInt(cellTd.dataset.row, 10), field: FIELDS[start.c1] } };
            paintSel();
          };
          const onUp = () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); fillDown(); };
          document.addEventListener("mousemove", onMove);
          document.addEventListener("mouseup", onUp);
        });
        td.appendChild(h);
      }
    }
    // Excel-style selection summary bar: Sum / Average / Count of selected numeric cells.
    const stat = opts.fxBar === false ? null : document.getElementById("grid-stat");   // lưới nội bộ không dùng thanh stats chung
    if (stat) {
      let sum = 0, cnt = 0;
      if (rc) for (let r = rc.r0; r <= rc.r1; r++) for (let c = rc.c0; c <= rc.c1; c++) {
        const f = FIELDS[c];
        if (!NUMERIC.has(f)) continue;
        const v = Number(activeSheet.items[r]?.[f]);
        if (v) { sum += v; cnt++; }
      }
      if (cnt >= 1) {
        stat.classList.remove("hidden");
        stat.innerHTML = `Đếm: <b>${cnt}</b> &nbsp;·&nbsp; TB: <b>${fmtNumCell(Math.round(sum / cnt))}</b> &nbsp;·&nbsp; Tổng: <b>${fmtNumCell(sum)}</b>`;
      } else {
        stat.classList.add("hidden");
        stat.textContent = "";
      }
    }
    if (grid._fxSync) grid._fxSync();   // keep the formula bar in sync with the active cell
  };
  const setSel = (anchor, focus) => { grid.sel = { anchor, focus }; grid.selSheet = q._activeSheet; paintSel(); };
  const clearSel = () => { grid.sel = null; paintSel(); };
  const clampSel = () => {
    if (!grid.sel) return;
    const max = activeSheet.items.length - 1;
    if (max < 0) { grid.sel = null; return; }
    grid.sel.anchor.row = Math.min(grid.sel.anchor.row, max);
    grid.sel.focus.row = Math.min(grid.sel.focus.row, max);
  };
  // Move to (row,field); if that row lacks the field (sub→no STT/name, info→only name)
  // scan outward for the nearest present column so nav never lands on a missing cell.
  const moveTo = (row, field, extend) => {
    row = Math.max(0, Math.min(activeSheet.items.length - 1, row));
    let ci = Math.max(0, Math.min(FIELDS.length - 1, fieldIdx(field)));
    let f2 = FIELDS[ci];
    if (!cellEl(row, f2)) {
      let found = null;
      for (let d = 1; d < FIELDS.length; d++) {
        if (cellEl(row, FIELDS[ci - d])) { found = FIELDS[ci - d]; break; }
        if (cellEl(row, FIELDS[ci + d])) { found = FIELDS[ci + d]; break; }
      }
      f2 = found || "name";
    }
    if (extend && grid.sel) grid.sel = { anchor: grid.sel.anchor, focus: { row, field: f2 } };
    else grid.sel = { anchor: { row, field: f2 }, focus: { row, field: f2 } };
    grid.selSheet = q._activeSheet;
    grid._navigating = true;       // tell the focus listener not to collapse the range
    focusCell(row, f2, extend);    // don't select text while extending a range
    grid._navigating = false;
    paintSel();
  };
  // Undo/redo: sheet-tagged JSON snapshots (matches the clone at renderEditor).
  const snap = () => ({ sheet: q._activeSheet, items: JSON.parse(JSON.stringify(activeSheet.items)) });
  // Commit a pending in-cell edit (the pre-edit snapshot captured on focus) as ONE undo
  // boundary. Called before every structural op / undo / redo AND on blur — and it clears
  // the dirty flags so the synchronous blur fired by redraw()'s tbody.innerHTML is a no-op
  // (otherwise that stray blur pushes a second, out-of-order snapshot → corrupt history).
  const commitPending = () => {
    if (grid._dirty && grid.focusSnap) { grid.undo.push(grid.focusSnap); if (grid.undo.length > 100) grid.undo.shift(); grid.redo.length = 0; }
    grid._dirty = false; grid.focusSnap = null;
  };
  const pushUndo = () => { commitPending(); grid.undo.push(snap()); if (grid.undo.length > 100) grid.undo.shift(); grid.redo.length = 0; };
  const restoreSnap = (s, fromStack, toStack) => {
    grid._dirty = false; grid.focusSnap = null;
    toStack.push(snap());
    if (s.sheet !== q._activeSheet) { q._activeSheet = s.sheet; q.sheets[s.sheet].items = s.items; grid.requestDraw(); return; }
    activeSheet.items = s.items; redraw(); clampSel(); paintSel();
  };
  const doUndo = () => { commitPending(); if (grid.undo.length) restoreSnap(grid.undo.pop(), grid.undo, grid.redo); };
  const doRedo = () => { commitPending(); if (grid.redo.length) restoreSnap(grid.redo.pop(), grid.redo, grid.undo); };
  // Build a string matrix of the selected rect. NUMERIC cells → raw US value (blank stays
  // blank, never "0"); text cells → raw value (newlines/tabs PRESERVED — the serializer
  // quotes them per RFC-4180 so multi-line "Hạng Mục" round-trips with Excel).
  const rectToMatrix = (rc) => {
    const m = [];
    for (let r = rc.r0; r <= rc.r1; r++) {
      const row = [];
      for (let c = rc.c0; c <= rc.c1; c++) {
        const f2 = FIELDS[c]; const v = activeSheet.items[r][f2];
        if (NUMERIC.has(f2)) { const n = Number(v); row.push((v === "" || v == null || isNaN(n)) ? "" : String(n)); }
        else row.push(String(v ?? ""));
      }
      m.push(row);
    }
    return m;
  };
  const fillDown = () => {
    if (!editable) return;
    const rc = rectOf(grid.sel); if (!rc || rc.r1 <= rc.r0) return;
    pushUndo();
    for (let c = rc.c0; c <= rc.c1; c++) {
      const f2 = FIELDS[c]; const src = activeSheet.items[rc.r0][f2];
      for (let r = rc.r0 + 1; r <= rc.r1; r++) {
        const it = activeSheet.items[r];
        if (it.kind === "info" && f2 !== "name") continue;   // never write price onto an info row
        it[f2] = NUMERIC.has(f2) ? (Number(src) || 0) : src;
      }
    }
    redraw(); setSel({ row: rc.r0, field: FIELDS[rc.c0] }, { row: rc.r1, field: FIELDS[rc.c1] });
    focusCell(rc.r0, FIELDS[rc.c0], true);   // giữ focus để Ctrl+Z hoạt động sau fill-down
  };

  // New rows go right below the selected row (Excel-style); only when nothing on
  // this sheet is selected do they fall back to the end of the list.
  const insertIndex = () => {
    if (grid.sel && grid.selSheet === q._activeSheet) {
      const r = Math.max(grid.sel.anchor.row, grid.sel.focus.row);
      if (r >= 0 && r < activeSheet.items.length) return r + 1;
    }
    return activeSheet.items.length;
  };
  const addRow = (field) => { pushUndo(); const at = insertIndex(); activeSheet.items.splice(at, 0, blank()); redraw(); focusCell(at, field || "name"); };
  const addInfo = () => { pushUndo(); const at = insertIndex(); activeSheet.items.splice(at, 0, blankInfo()); redraw(); focusCell(at, "name"); };
  const addSection = () => { pushUndo(); const at = insertIndex(); activeSheet.items.splice(at, 0, blankSection()); redraw(); focusCell(at, "name"); };
  const addSubSection = () => { pushUndo(); const at = insertIndex(); activeSheet.items.splice(at, 0, blankSubSection()); redraw(); focusCell(at, "name"); };
  // Insert a "hàng con" (sub-item) right below row i — stays inside i's group.
  const addSubAfter = (i) => { pushUndo(); activeSheet.items.splice(i + 1, 0, blankSub()); redraw(); focusCell(i + 1, showDetail ? "detail" : "unit"); };

  // ===== Excel formula UX: point-and-click refs, function autocomplete, formula bar =====
  // The <td> backing a (row, field) — including the computed STT / Thành Tiền columns.
  const tdOf = (row, field) => {
    const tr = tbody.querySelector(`tr[data-row="${row}"]`); if (!tr) return null;
    if (field === "_amount") return tr.querySelector(".col-amount");
    if (field === "_stt") return tr.querySelector(".col-stt");
    const inp = tr.querySelector(`[data-f="${field}"]`); return inp ? inp.closest("td") : null;
  };
  // Which cell is under a mouse event → {row, field, L, addr} (null if not a grid cell).
  const cellAddrFromEvent = (ev) => {
    const td = ev.target.closest && ev.target.closest("td");
    const tr = ev.target.closest && ev.target.closest("tr[data-row]");
    if (!td || !tr) return null;
    const row = parseInt(tr.dataset.row, 10);
    const inp = td.querySelector("[data-f]");
    let field = inp ? inp.dataset.f : null;
    if (!field) {
      if (td.classList.contains("col-amount")) field = "_amount";
      else if (td.classList.contains("col-stt")) field = "_stt";
      else return null;
    }
    const L = fieldToLetter[field]; if (!L) return null;
    return { row, field, L, addr: L + (row + 1) };
  };
  const rangeAddr = (a, b) => {
    const ca = colIndexOfLetter(a.L), cb = colIndexOfLetter(b.L);
    const c0 = Math.min(ca, cb), c1 = Math.max(ca, cb), r0 = Math.min(a.row, b.row), r1 = Math.max(a.row, b.row);
    const tl = ADDR_COLS[c0].L + (r0 + 1), br = ADDR_COLS[c1].L + (r1 + 1);
    return tl === br ? tl : tl + ":" + br;
  };
  const clearRefPick = () => tbody.querySelectorAll("td.cell-ref-pick").forEach((t) => t.classList.remove("cell-ref-pick"));
  const paintRefPick = (a, b) => {
    clearRefPick();
    const ca = colIndexOfLetter(a.L), cb = colIndexOfLetter(b.L);
    const c0 = Math.min(ca, cb), c1 = Math.max(ca, cb), r0 = Math.min(a.row, b.row), r1 = Math.max(a.row, b.row);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) { const td = tdOf(r, ADDR_COLS[c].field); if (td) td.classList.add("cell-ref-pick"); }
  };
  // PERSISTENT highlight of every cell a formula references (Excel's coloured boxes) — shown
  // while a formula cell is focused / being edited, so you can see what it points to.
  // Green shades only — so the referenced cells (xanh lá) never clash with the blue
  // selection/anchor box (xanh dương). Multiple distinct refs get slightly different greens.
  const REF_COLORS = ["#1f7a3d", "#15803d", "#2e7d32", "#4d7c0f", "#0b7a4b", "#3d8b37"];
  const clearActiveRefs = () => tbody.querySelectorAll("td.cell-ref-active").forEach((t) => { t.classList.remove("cell-ref-active"); t.style.removeProperty("--ref-color"); });
  const highlightActiveFormulaRefs = (text) => {
    clearActiveRefs();
    if (!text || !String(text).trim().startsWith("=")) return;
    const body = String(text).replace(/^=/, "");
    let ci = 0;
    const paint = (td) => { if (td) { td.classList.add("cell-ref-active"); td.style.setProperty("--ref-color", REF_COLORS[ci % REF_COLORS.length]); } };
    const rangeRe = /([A-Za-z]+\d+)\s*:\s*([A-Za-z]+\d+)/g;
    let m;
    while ((m = rangeRe.exec(body))) {
      const a = parseAddr(m[1]), b = parseAddr(m[2]); if (!a || !b) continue;
      const c0 = Math.min(colIndexOfLetter(a.L), colIndexOfLetter(b.L)), c1 = Math.max(colIndexOfLetter(a.L), colIndexOfLetter(b.L));
      const r0 = Math.min(a.row, b.row), r1 = Math.max(a.row, b.row);
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) paint(tdOf(r, ADDR_COLS[c].field));
      ci++;
    }
    const noRanges = body.replace(rangeRe, (mm) => " ".repeat(mm.length));   // don't double-count range ends
    const singleRe = /(?<![A-Za-z0-9_.])([A-Za-z]+\d+)/g;
    while ((m = singleRe.exec(noRanges))) { const p = parseAddr(m[1]); if (p) { paint(tdOf(p.row, p.field)); ci++; } }
  };
  grid._fxHighlight = highlightActiveFormulaRefs;
  grid._fxClearRefs = clearActiveRefs;
  // While editing a formula, mousedown on another cell inserts its address (drag → a range)
  // INSTEAD of moving focus — so the half-typed formula is never lost (Excel "point mode").
  const startPointDrag = (fxInput, startInfo) => {
    const caret = fxInput.selectionStart == null ? fxInput.value.length : fxInput.selectionStart;
    const after = fxInput.value.slice(caret);
    // Strip a trailing ref/range token so re-dragging replaces it (not append).
    const baseLeft = fxInput.value.slice(0, caret).replace(/[A-Za-z]+\d+(?::[A-Za-z]+\d+)?$/, "");
    let curInfo = startInfo;
    const apply = (info2) => {
      curInfo = info2;
      const ref = rangeAddr(startInfo, info2);
      fxInput.value = baseLeft + ref + after;
      const pos = (baseLeft + ref).length;
      try { fxInput.setSelectionRange(pos, pos); } catch {}
      paintRefPick(startInfo, info2);
      fxInput.dispatchEvent(new Event("input", { bubbles: true }));   // live re-evaluate
    };
    grid._fxPicking = true;
    document.body.classList.add("fx-picking");
    apply(startInfo);
    const onMove = (mv) => { const info2 = cellAddrFromEvent(mv); if (info2) apply(info2); };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("mouseup", onUp, true);
      grid._fxPicking = false; document.body.classList.remove("fx-picking"); clearRefPick(); fxInput.focus();
      const pos = (baseLeft + rangeAddr(startInfo, curInfo)).length;
      try { fxInput.setSelectionRange(pos, pos); } catch {}
    };
    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("mouseup", onUp, true);
  };
  const onPointMouseDown = (ev) => {
    if (ev.button !== 0) return;
    const ae = document.activeElement;
    if (!ae || !ae.dataset || ae.dataset.f == null) return;
    if (!(ae.value || "").trim().startsWith("=")) return;               // not editing a formula
    const start = cellAddrFromEvent(ev); if (!start) return;            // clicked outside the grid
    const aeTr = ae.closest && ae.closest("tr[data-row]");
    const aeRow = aeTr ? parseInt(aeTr.dataset.row, 10) : -1;
    if (start.row === aeRow && start.field === ae.dataset.f) return;    // clicked its own cell → normal caret
    ev.preventDefault(); ev.stopPropagation();                         // keep focus → don't lose formula
    startPointDrag(ae, start);
  };
  grid._fx = { onPointMouseDown };

  // --- Function-name autocomplete (=SU → SUM/… dropdown) ---
  const FN_LIST = Object.keys(FORMULA_FNS);
  const ensureFxAuto = () => {
    if (grid._fxAutoEl && document.body.contains(grid._fxAutoEl)) return grid._fxAutoEl;
    let d = document.querySelector(".fx-auto");   // reuse across editor re-opens (no leak)
    if (!d) { d = document.createElement("div"); d.className = "fx-auto hidden"; document.body.appendChild(d); }
    grid._fxAutoEl = d; return d;
  };
  const closeFxAuto = () => { grid._fxAuto = null; if (grid._fxAutoEl) grid._fxAutoEl.classList.add("hidden"); };
  const renderFxAuto = () => {
    const a = grid._fxAuto; if (!a) return; const el = ensureFxAuto();
    el.innerHTML = a.items.map((n, k) => `<div class="fx-auto-item${k === a.idx ? " active" : ""}" data-k="${k}">${n}<span>( )</span></div>`).join("");
    el.querySelectorAll(".fx-auto-item").forEach((node) => {
      node.addEventListener("mousedown", (e) => { e.preventDefault(); grid._fxAuto.idx = parseInt(node.dataset.k, 10); acceptFxAuto(); });
    });
  };
  const fxAutocomplete = (input, i, f) => {
    const val = input.value || "";
    const caret = input.selectionStart == null ? val.length : input.selectionStart;
    const left = val.slice(0, caret);
    if (!left.trim().startsWith("=")) { closeFxAuto(); return; }
    const m = /([A-Za-z]+)$/.exec(left); if (!m) { closeFxAuto(); return; }
    const tok = m[1].toUpperCase();
    const matches = FN_LIST.filter((n) => n.startsWith(tok) && n !== tok);
    if (!matches.length) { closeFxAuto(); return; }
    grid._fxAuto = { input, i, f, items: matches, idx: 0 };
    const el = ensureFxAuto(); renderFxAuto();
    const r = input.getBoundingClientRect();
    el.style.left = r.left + "px"; el.style.top = (r.bottom + 2) + "px"; el.style.minWidth = Math.max(120, r.width) + "px";
    el.classList.remove("hidden");
  };
  const acceptFxAuto = () => {
    const a = grid._fxAuto; if (!a) return;
    const name = a.items[a.idx], input = a.input, val = input.value;
    const caret = input.selectionStart == null ? val.length : input.selectionStart;
    const newLeft = val.slice(0, caret).replace(/([A-Za-z]+)$/, name + "(");
    input.value = newLeft + val.slice(caret);
    const pos = newLeft.length; try { input.setSelectionRange(pos, pos); } catch {}
    closeFxAuto(); input.focus();
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const moveFxAuto = (delta) => { const a = grid._fxAuto; if (!a) return; a.idx = (a.idx + delta + a.items.length) % a.items.length; renderFxAuto(); };

  // --- Formula bar (shows the active cell address + its formula; Enter applies) ---
  const syncFxBar = () => {
    const addrEl = document.getElementById("fx-addr"), inEl = document.getElementById("fx-input");
    if (!addrEl || !inEl) return;
    const sel = grid.sel;
    if (!sel || grid.selSheet !== q._activeSheet) { addrEl.textContent = "—"; if (document.activeElement !== inEl) inEl.value = ""; return; }
    const { row, field } = sel.anchor;
    addrEl.textContent = addrOf(row, field) || "—";
    if (document.activeElement === inEl) return;   // don't clobber while typing in the bar
    const it = activeSheet.items[row];
    const fx = it && it.formulas && it.formulas[field];
    inEl.value = fx ? fx : (!it ? "" : (field === "_amount" || field === "_stt") ? "" : NUMERIC.has(field) ? fmtNumCell(it[field]) : (it[field] || ""));
    inEl.readOnly = !editable || field === "_amount" || field === "_stt";
  };
  if (opts.fxBar !== false) grid._fxSync = syncFxBar;   // lưới nội bộ không dùng fx-bar (singleton)
  const applyFxBar = (move) => {
    const inEl = document.getElementById("fx-input"); if (!inEl) return;
    const sel = grid.sel; if (!sel) return;
    const { row, field } = sel.anchor;
    if (!editable || field === "_amount" || field === "_stt") return;
    const cell = cellEl(row, field); if (!cell) return;
    cell.focus(); cell.value = inEl.value;
    cell.dispatchEvent(new Event("input", { bubbles: true }));
    commitFormula(cell, row, field); commitPending();
    if (move) moveTo(row + 1, field, false);
  };
  if (opts.fxBar !== false) grid._fxApplyBar = applyFxBar;
  closeFxAuto();   // drop any stale autocomplete pointing at now-removed inputs
  // Bind listeners ONCE per element. draw() rebuilds el.innerHTML (new tbody + fx-input),
  // so the guard lives on the ELEMENT — survives redraw() (same nodes) yet rebinds after a
  // full draw(). The handlers read grid._fx*/grid._fxSync, refreshed above each drawItems.
  const fxInEl = opts.fxBar === false ? null : document.getElementById("fx-input");
  if (fxInEl && !fxInEl._fxBound) {
    fxInEl._fxBound = true;
    fxInEl.addEventListener("keydown", (e) => {
      if (e.isComposing || e.keyCode === 229 || e.key === "Process") return;   // đang gõ IME → Enter là xác nhận từ, bỏ qua
      if (e.key === "Enter") { e.preventDefault(); grid._fxApplyBar && grid._fxApplyBar(true); }
      else if (e.key === "Escape") { e.preventDefault(); if (grid._fxSync) grid._fxSync(); fxInEl.blur(); }
    });
  }
  if (tbody && !tbody._fxBound) {
    tbody._fxBound = true;
    tbody.addEventListener("mousedown", (ev) => { if (grid._fx && grid._fx.onPointMouseDown) grid._fx.onPointMouseDown(ev); }, true);
  }

  tbody.querySelectorAll("input, textarea").forEach((inp) => {
    const f = inp.dataset.f;
    const isMultiline = multilineFields.has(f);

    inp.addEventListener("input", (e) => {
      const tr = e.target.closest("tr");
      const i = parseInt(tr.dataset.row, 10);
      if (NUMERIC.has(f)) {
        // Excel-style formula: if the cell starts with "=", let the user type the
        // expression freely (no live thousand-grouping). Keep the raw text, but
        // live-evaluate so the row amount + totals + section subtotals + preview
        // update AS YOU TYPE; the cell reformats to the final number on commit.
        if (e.target.value.trim().startsWith("=")) {
          grid._dirty = true;
          const it = activeSheet.items[i];
          // Remember the raw formula so the cell can show it again when re-focused
          // (Excel behaviour: cell shows the result, click → shows "=2000+3000").
          it.formulas = it.formulas || {};
          it.formulas[f] = e.target.value.trim();
          const live = evalFormula(e.target.value.trim(), formulaRefs);
          if (live !== null) it[f] = live;
          recomputeAll(); paintComputedValues();
          fxAutocomplete(e.target, i, f);
          highlightActiveFormulaRefs(e.target.value);
          if (grid._fxSync) grid._fxSync();
          return;
        }
        // Live thousand-dot formatting with caret preservation (count digits left of caret).
        const el2 = e.target;
        const digitsBefore = el2.value.slice(0, el2.selectionStart || 0).replace(/[^\d]/g, "").length;
        const formatted = liveFormat(el2.value);
        el2.value = formatted;
        let pos = 0, seen = 0;
        while (pos < formatted.length && seen < digitsBefore) { if (/\d/.test(formatted[pos])) seen++; pos++; }
        if (el2.setSelectionRange) { try { el2.setSelectionRange(pos, pos); } catch {} }
        activeSheet.items[i][f] = parseVN(formatted);
        // Typed a plain number → this cell no longer has a formula.
        if (activeSheet.items[i].formulas) delete activeSheet.items[i].formulas[f];
      } else {
        let v = e.target.value;
        if (!isMultiline && typeof v === "string" && /[\r\n]/.test(v)) { v = v.replace(/[\r\n]+/g, " "); e.target.value = v; }
        activeSheet.items[i][f] = v;
        // A text cell can also hold a formula (=H3, ="…"): remember it for commit + suggest.
        const it0 = activeSheet.items[i];
        if (v.trim().startsWith("=")) { it0.formulas = it0.formulas || {}; it0.formulas[f] = v.trim(); fxAutocomplete(e.target, i, f); }
        else { if (it0.formulas && it0.formulas[f]) { delete it0.formulas[f]; if (!Object.keys(it0.formulas).length) delete it0.formulas; } closeFxAuto(); }
      }
      grid._dirty = true;   // mark this cell dirty so blur commits one undo snapshot
      const it = activeSheet.items[i];
      if (it.kind !== "section" && it.kind !== "subsection") {
        const amt = usesDays ? (Number(it.quantity) || 0) * (Number(it.days) || 1) * (Number(it.unitPrice) || 0)
                             : (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0);
        const amtCell = tr.querySelector(".col-amount");   // info/section rows: skip
        if (amtCell) amtCell.textContent = fmtNumCell(amt);
      }
      updateSummary(q);
      updateSectionSubtotals();
      if (sheetHasFormulas()) { recomputeAll(); paintComputedValues(); }   // refresh dependents live
      highlightActiveFormulaRefs(e.target.value);   // glow the cells this formula points at
      if (grid._fxSync) grid._fxSync();   // mirror what's typed into the formula bar
    });

    // Focus a cell → single-cell selection (unless mid-navigation) + capture pre-edit snapshot.
    inp.addEventListener("focus", () => {
      const tr = inp.closest("tr"); const i = tr ? parseInt(tr.dataset.row, 10) : 0;
      if (!grid._navigating) {
        if (!grid.sel || grid.sel.anchor.row !== i || grid.sel.anchor.field !== f) {
          grid.sel = { anchor: { row: i, field: f }, focus: { row: i, field: f } };
          grid.selSheet = q._activeSheet; paintSel();
        }
      }
      // Excel/Sheets behaviour: clicking a cell that holds a formula shows the FORMULA
      // for editing (the cell otherwise displays the computed result) — any column.
      const fx = activeSheet.items[i]?.formulas?.[f];
      if (fx) inp.value = fx;
      highlightActiveFormulaRefs(inp.value);   // entering a formula cell → glow its refs
      if (grid._fxSync) grid._fxSync();   // thanh công thức (fx) bám theo ô vừa bấm — như Excel
      grid.focusSnap = snap();
    });
    // Blur → commit the formula (any column) + the pending edit as one undo boundary.
    inp.addEventListener("blur", () => {
      if (grid._fxPicking) return;   // mid point-pick: focus is retained, don't commit yet
      const tr = inp.closest("tr"); if (tr) commitFormula(inp, parseInt(tr.dataset.row, 10), f);
      commitPending();
      clearActiveRefs();   // left the formula cell → drop the ref glow
      setTimeout(closeFxAuto, 150);   // let a click on a suggestion land first
    });

    // Mouse drag to select a range. Transient listeners are removed on mouseup → no leak.
    inp.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      const tr = inp.closest("tr"); const r0 = parseInt(tr.dataset.row, 10);
      grid.sel = { anchor: { row: r0, field: f }, focus: { row: r0, field: f } };
      grid.selSheet = q._activeSheet;
      // QUAN TRỌNG: bấm chuột phải VẼ LẠI vùng chọn NGAY (như Excel). Trước đây chỉ set
      // grid.sel mà không paint; handler focus lại bỏ qua paint vì sel đã khớp ô vừa bấm
      // → khung tô màu KẸT ở ô cũ, chỉ nhảy khi bấm phím. Gọi paintSel() để khung theo chuột.
      paintSel();
      const onOver = (ov) => {
        const c2 = ov.target.closest && ov.target.closest("[data-f]");
        if (!c2) return;
        grid.sel.focus = { row: parseInt(c2.closest("tr").dataset.row, 10), field: c2.dataset.f };
        paintSel();
      };
      const onUp = () => { tbody.removeEventListener("mouseover", onOver); document.removeEventListener("mouseup", onUp); };
      tbody.addEventListener("mouseover", onOver);
      document.addEventListener("mouseup", onUp);
    });

    // Keyboard: Enter (move down), arrows/Tab nav, Ctrl+C/X/D, Ctrl+Z/Y, Esc.
    inp.addEventListener("keydown", (e) => {
      // BỘ GÕ TIẾNG VIỆT (IME): khi đang gõ dấu, phím Enter dùng để XÁC NHẬN từ — phải BỎ
      // QUA, đừng để lưới "ăn" nó (commit + xuống dòng/thêm hàng) khiến nội dung bị đùn/nhân
      // xuống ô trống bên dưới. Lỗi rõ trên Mac (IME tiếng Việt). isComposing / keyCode 229
      // = đang soạn IME (cũng chặn Arrow/Tab/Esc lúc đang gõ — đúng hành vi). NHƯNG cho
      // Ctrl/Cmd (Z/Y/D…) đi qua kể cả khi đang gõ (copy/cut đã chuyển sang sự kiện riêng).
      if (!(e.ctrlKey || e.metaKey) && (e.isComposing || e.keyCode === 229 || e.key === "Process")) return;
      const tr = inp.closest("tr"); const i = parseInt(tr.dataset.row, 10);
      const ci = FIELDS.indexOf(f);
      const ctrl = e.ctrlKey || e.metaKey;
      const atStart = inp.selectionStart === 0 && inp.selectionEnd === 0;
      const atEnd = inp.selectionStart === (inp.value || "").length && inp.selectionEnd === (inp.value || "").length;

      // Function-name autocomplete: only Arrow + Tab steer it. Enter must NOT be hijacked —
      // it always commits the formula + moves down như cũ (just close the dropdown first).
      if (grid._fxAuto) {
        if (e.key === "ArrowDown") { e.preventDefault(); e.stopPropagation(); moveFxAuto(1); return; }
        if (e.key === "ArrowUp") { e.preventDefault(); e.stopPropagation(); moveFxAuto(-1); return; }
        if (e.key === "Tab") { e.preventDefault(); e.stopPropagation(); acceptFxAuto(); return; }
        if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeFxAuto(); return; }
        if (e.key === "Enter") closeFxAuto();   // don't swallow Enter — fall through to commit
      }

      if (e.key === "Enter" && !(isMultiline && e.shiftKey)) {
        e.preventDefault(); e.stopPropagation();
        commitFormula(inp, i, f);
        if (i >= activeSheet.items.length - 1) { addRow(f); moveTo(activeSheet.items.length - 1, f, false); }
        else moveTo(i + 1, f, false);
        return;
      }
      if (ctrl && !e.shiftKey && (e.key === "z" || e.key === "Z")) { e.preventDefault(); e.stopPropagation(); if (editable) doUndo(); return; }
      if (ctrl && ((e.key === "y" || e.key === "Y") || (e.shiftKey && (e.key === "z" || e.key === "Z")))) { e.preventDefault(); e.stopPropagation(); if (editable) doRedo(); return; }
      if (ctrl && (e.key === "d" || e.key === "D")) { e.preventDefault(); e.stopPropagation(); fillDown(); return; }
      // COPY/CUT (Ctrl/Cmd+C/X): KHÔNG bắt ở keydown nữa. Đã chuyển sang sự kiện
      // 'copy'/'cut' chuẩn của trình duyệt (xem grid._clip) — chạy ĐỒNG BỘ đúng lúc, hoạt
      // động ổn trên macOS/Safari/Firefox + chuột phải + cảm ứng + http LAN. Ctrl+C/X rơi
      // xuống đây sẽ kích hoạt sự kiện copy/cut tương ứng, nên ở đây bỏ qua (không chặn).
      if (e.key === "Escape" && grid.sel) { e.stopPropagation(); clearSel(); return; }
      if (e.key === "Tab") {
        if (!e.shiftKey && (ci < FIELDS.length - 1 || i < activeSheet.items.length - 1)) {
          e.preventDefault(); e.stopPropagation();
          if (ci < FIELDS.length - 1) moveTo(i, FIELDS[ci + 1], false); else moveTo(i + 1, FIELDS[0], false);
        } else if (e.shiftKey && (ci > 0 || i > 0)) {
          e.preventDefault(); e.stopPropagation();
          if (ci > 0) moveTo(i, FIELDS[ci - 1], false); else moveTo(i - 1, FIELDS[FIELDS.length - 1], false);
        }
        return;   // at the grid boundary, let Tab fall through to footer buttons
      }
      if (e.key.indexOf("Arrow") === 0) {
        const up = e.key === "ArrowUp", down = e.key === "ArrowDown", left = e.key === "ArrowLeft", right = e.key === "ArrowRight";
        // A fully-selected cell (just navigated into) counts as both edges, so the first
        // arrow navigates instead of being swallowed moving the caret inside the selection.
        const whole = (inp.value || "").length > 0 && inp.selectionStart === 0 && inp.selectionEnd === inp.value.length;
        if (isMultiline) { if ((up || left) && !atStart && !whole) return; if ((down || right) && !atEnd && !whole) return; }
        else { if (left && !atStart && !whole) return; if (right && !atEnd && !whole) return; }
        e.preventDefault(); e.stopPropagation();
        moveTo(i + (down ? 1 : 0) - (up ? 1 : 0), FIELDS[ci + (right ? 1 : 0) - (left ? 1 : 0)] || f, e.shiftKey);
        return;
      }
    });

    // PASTE: xử lý ở cấp tbody (grid._clip.onPaste) — bắt được cả dán bằng chuột phải /
    // menu / cảm ứng, và đọc đúng ô nhiều dòng của Excel (RFC-4180). Xem bên dưới.
  });

  // ===== COPY / CUT / PASTE chuẩn (sự kiện trình duyệt, đồng bộ — chạy ổn mọi nền tảng) =====
  // Bắt ở 'copy'/'cut'/'paste' (không phải keydown) nên Cmd trên macOS/Safari, Firefox,
  // chuột phải, cảm ứng và http LAN đều hoạt động; clipboardData.setData ghi ĐỒNG BỘ nên
  // không còn ghi clipboard kiểu bất đồng bộ nuốt lỗi. Khối được nạp lại mỗi lần drawItems
  // (closure mới: activeSheet/FIELDS…), nhưng listener gắn trên tbody chỉ MỘT lần.
  const onCopyCut = (e) => {
    if (!grid.sel || grid.selSheet !== q._activeSheet) return;   // không phải lưới này → để mặc định
    const rc = rectOf(grid.sel); if (!rc) return;
    const isCut = e.type === "cut";
    const single = rc.r0 === rc.r1 && rc.c0 === rc.c1;
    const ae = cellEl(grid.sel.anchor.row, grid.sel.anchor.field);
    // 1 ô đang bôi đen 1 phần chữ trong ô → để trình duyệt copy đoạn chữ đó (như Excel)
    if (single && ae && document.activeElement === ae && ae.selectionStart !== ae.selectionEnd) {
      grid.copyBuf = null; return;
    }
    if (isCut && !editable) return;   // người chỉ-xem được copy, KHÔNG được cắt
    e.preventDefault();
    const matrix = rectToMatrix(rc);
    const tsv = cellsToTSV(matrix);
    const kinds = []; for (let r = rc.r0; r <= rc.r1; r++) kinds.push(activeSheet.items[r].kind || "item");
    const cols = rc.c1 - rc.c0 + 1;
    const token = ++grid._copyToken;
    if (e.clipboardData) {
      e.clipboardData.setData("text/plain", tsv);
      try { e.clipboardData.setData("text/html", cellsToHTML(matrix)); } catch {}
      try { e.clipboardData.setData("application/x-quanly-grid", JSON.stringify({ token, kinds, cols, tsv })); } catch {}
    }
    grid.copyBuf = { tsv, kinds, cols, token };
    if (isCut && editable) {
      pushUndo();
      for (let r = rc.r0; r <= rc.r1; r++) for (let c = rc.c0; c <= rc.c1; c++) {
        const f2 = FIELDS[c]; const it = activeSheet.items[r];
        if (!it || (it.kind === "info" && f2 !== "name")) continue;
        it[f2] = NUMERIC.has(f2) ? 0 : "";
      }
      redraw(); setSel({ row: rc.r0, field: FIELDS[rc.c0] }, { row: rc.r1, field: FIELDS[rc.c1] });
      focusCell(rc.r0, FIELDS[rc.c0], true);   // giữ focus để Ctrl+Z hoàn tác được ngay sau khi cắt
    }
  };
  const pasteCellVal = (it, field, cell) => {
    if (!it || (it.kind === "info" && field !== "name")) return;   // không dán giá vào dòng thông tin
    const raw = cell == null ? "" : String(cell);
    // Excel-style công thức dán dưới dạng text ("=G3*E3", "=2000+3000", "=1000000*8%"):
    // giữ thành CÔNG THỨC thật (có nút ƒ, sửa lại được) thay vì bị numLoose biến thành số sai.
    // (Excel copy thường chỉ đưa kết quả; bấm Ctrl+` để hiện công thức rồi copy thì text mới có "=".)
    if (raw.trim().startsWith("=")) {
      it.formulas = it.formulas || {};
      it.formulas[field] = raw.trim();
      if (NUMERIC.has(field)) { const live = evalFormula(raw.trim(), formulaRefs); it[field] = live !== null ? live : 0; }
      else it[field] = raw.trim();
      return;
    }
    if (it.formulas && it.formulas[field]) { delete it.formulas[field]; if (!Object.keys(it.formulas).length) delete it.formulas; }
    it[field] = NUMERIC.has(field) ? (raw.trim() === "" ? 0 : numLoose(raw))
      : (multilineFields.has(field) ? raw : raw.trim().replace(/\s+/g, " "));   // giữ xuống hàng cho ô nhiều dòng
  };
  const onPaste = (e) => {
    if (!editable) return;                       // người chỉ-xem không dán
    const cd = e.clipboardData; if (!cd) return;
    const tgtInput = (e.target && e.target.dataset && e.target.dataset.f != null) ? e.target : document.activeElement;
    let startRow, startCol;
    if (grid.sel && grid.selSheet === q._activeSheet) { const rc0 = rectOf(grid.sel); startRow = rc0.r0; startCol = rc0.c0; }
    else if (tgtInput && tgtInput.dataset && tgtInput.dataset.f != null) { startRow = parseInt(tgtInput.closest("tr").dataset.row, 10); startCol = FIELDS.indexOf(tgtInput.dataset.f); }
    else return;                                 // không ở trong lưới → để mặc định
    let internal = null;
    try { const rawIn = cd.getData("application/x-quanly-grid"); if (rawIn) internal = JSON.parse(rawIn); } catch {}
    const text = cd.getData("text/plain") || cd.getData("text") || "";
    if (!text && !internal) return;
    const rows = parseClipboardTSV(internal ? internal.tsv : text);
    const isGrid = rows.length > 1 || (rows[0] && rows[0].length > 1);

    // 1 giá trị đơn lẻ
    if (!isGrid) {
      const val = rows[0][0];
      const rcSel = (grid.sel && grid.selSheet === q._activeSheet) ? rectOf(grid.sel) : null;
      const multiCell = rcSel && (rcSel.r0 !== rcSel.r1 || rcSel.c0 !== rcSel.c1);
      if (multiCell) {   // Excel: điền 1 giá trị ra TOÀN vùng đang chọn
        e.preventDefault(); pushUndo();
        for (let r = rcSel.r0; r <= rcSel.r1; r++) for (let c = rcSel.c0; c <= rcSel.c1; c++) pasteCellVal(activeSheet.items[r], FIELDS[c], val);
        if (sheetHasFormulas()) recomputeAll();
        redraw(); setSel({ row: rcSel.r0, field: FIELDS[rcSel.c0] }, { row: rcSel.r1, field: FIELDS[rcSel.c1] });
        focusCell(rcSel.r0, FIELDS[rcSel.c0], true);
        return;
      }
      if (tgtInput && tgtInput.dataset && tgtInput.dataset.f != null) {   // 1 ô → chèn tại con trỏ
        e.preventDefault();
        const ins = multilineFields.has(tgtInput.dataset.f) ? val : val.replace(/[\r\n]+/g, " ");
        const s = tgtInput.selectionStart || 0, en = tgtInput.selectionEnd || 0;
        tgtInput.value = tgtInput.value.substring(0, s) + ins + tgtInput.value.substring(en);
        tgtInput.dispatchEvent(new Event("input", { bubbles: true }));
      }
      return;
    }

    // DÁN NGUYÊN BÁO GIÁ từ Excel (file app xuất ra, có cột STT) → DỰNG LẠI nhóm lớn /
    // nhóm con / hàng con / dòng thông tin / item cho đúng (không lệch cột, nhận diện nhóm).
    // Chỉ khi KHÔNG phải copy nội bộ (copy nội bộ đã có token khôi phục kind chính xác hơn).
    if (!internal && looksLikeExportPaste(rows, startCol, FIELDS.length)) {
      e.preventDefault(); pushUndo();
      const roles = ADDR_COLS.map((c) => c.field);
      const built = reconstructExportRows(rows, roles, NUMERIC).map((it) => ({ ...blank(), ...it }));
      activeSheet.items.splice(startRow, rows.length, ...built);
      if (!activeSheet.items.length) activeSheet.items.push(blank());
      if (sheetHasFormulas()) recomputeAll();   // đánh giá công thức "=…" vừa nhận từ bảng export
      redraw();
      setSel({ row: startRow, field: FIELDS[0] }, { row: startRow + built.length - 1, field: FIELDS[FIELDS.length - 1] });
      focusCell(startRow, FIELDS[0], true);
      const nGrp = built.filter((b) => b.kind === "section").length, nSub = built.filter((b) => b.kind === "subsection").length;
      const nFx = built.reduce((s, b) => s + (b.formulas ? Object.keys(b.formulas).length : 0), 0);
      toast(`Đã dán & dựng lại ${built.length} dòng (${nGrp} nhóm, ${nSub} nhóm con${nFx ? `, ${nFx} công thức` : ""})`, "success");
      return;
    }

    // Khối nhiều ô
    e.preventDefault(); pushUndo();
    const startKind = activeSheet.items[startRow]?.kind;
    const intoGroup = (startKind === "section" || startKind === "subsection");
    if (intoGroup) { activeSheet.items.splice(startRow + 1, 0, ...rows.map(() => blank())); startRow += 1; startCol = 0; }
    const sameBlock = !intoGroup && internal && grid.copyBuf && internal.token === grid.copyBuf.token;
    rows.forEach((cells, r) => {
      const ri = startRow + r;
      while (activeSheet.items.length <= ri) activeSheet.items.push(blank());
      if (sameBlock && internal.kinds && internal.kinds[r]) activeSheet.items[ri].kind = internal.kinds[r];
      const tgt = activeSheet.items[ri];
      cells.forEach((cell, c) => { const field = FIELDS[startCol + c]; if (field) pasteCellVal(tgt, field, cell); });
    });
    if (sheetHasFormulas()) recomputeAll();   // công thức vừa dán (có tham chiếu) settle trước khi vẽ
    redraw();
    const maxCols = Math.max(...rows.map(rr => rr.length));
    setSel({ row: startRow, field: FIELDS[startCol] }, { row: startRow + rows.length - 1, field: FIELDS[Math.min(startCol + maxCols - 1, FIELDS.length - 1)] });
    focusCell(startRow, FIELDS[startCol], true);   // giữ focus để Ctrl+Z hoạt động ngay sau khi dán
  };
  grid._clip = { onCopyCut, onPaste };
  if (tbody && !tbody._clipBound) {
    tbody._clipBound = true;
    tbody.addEventListener("copy", (e) => { if (grid._clip) grid._clip.onCopyCut(e); });
    tbody.addEventListener("cut", (e) => { if (grid._clip) grid._clip.onCopyCut(e); });
    tbody.addEventListener("paste", (e) => { if (grid._clip) grid._clip.onPaste(e); });
  }

  tbody.querySelectorAll("button[data-rm]").forEach((b) => {
    b.addEventListener("click", () => {
      const i = parseInt(b.dataset.rm, 10);
      pushUndo();
      activeSheet.items.splice(i, 1);
      if (!activeSheet.items.length) activeSheet.items.push(blank());
      clampSel();
      redraw();
    });
  });

  // "↳" — add a hàng con (sub-item) under this row's group.
  tbody.querySelectorAll("button[data-sub]").forEach((b) => {
    b.addEventListener("click", () => addSubAfter(parseInt(b.dataset.sub, 10)));
  });

  // Footer: "+ Thêm hàng" control + per-sheet subtotal.
  const tfoot = document.querySelector(`${tableSel} tfoot`);
  // opts.subtotalFn: bảng nội bộ dùng extraTableSumLocal để "Tổng sheet" KHỚP đúng số đổ
  // sang Quản lý dự án (không hệ số nhóm) — tránh footer lệch Tổng-loại.
  const sheetSubtotal = opts.subtotalFn ? opts.subtotalFn(activeSheet) : sheetSubtotalGrouped(activeSheet.items, usesDays, activeSheet.groupSubtotal);
  const totalCols = FIELDS.length + 2 + (editable ? 1 : 0); // STT + fields + amount (+ action)
  const colSpanLeft = 4 + (showDetail ? 1 : 0) + (usesDays ? 1 : 0);
  tfoot.innerHTML = `
    ${editable ? `<tr class="add-row-tr"><td colspan="${totalCols}">
      <div class="grid-foot-tools">
        <button type="button" class="btn btn-sm gf-add-item">+ Thêm hàng</button>
        <button type="button" class="btn btn-sm gf-add-section">+ Thêm nhóm (A,B…)</button>
        <button type="button" class="btn btn-sm gf-add-subsection" title="Nhóm con: có tổng riêng, KHÔNG cộng vào nhóm chính, vẫn vào Tổng cộng">+ Thêm nhóm con</button>
        <button type="button" class="btn btn-sm gf-add-info">+ Thêm dòng thông tin</button>
        <label class="grid-foot-toggle"><input type="checkbox" class="gf-group-sub" ${activeSheet.groupSubtotal ? "checked" : ""} /> Hiện Thành Tiền nhóm <span class="muted">(Đơn giá × SL)</span></label>
        <span class="muted grid-foot-hint">(hoặc Enter ở hàng cuối · dán từ Excel để điền nhanh)</span>
      </div>
    </td></tr>` : ""}
    <tr>
      <td colspan="${colSpanLeft}"></td>
      <td colspan="2" class="empty-left label">Tổng ${opts.totalLabel || "sheet"}</td>
      <td class="value gf-subtotal-val">${fmtMoney(sheetSubtotal)}</td>
      <td></td>
      ${editable ? "<td></td>" : ""}
    </tr>`;
  if (editable && tfoot) {
    // SCOPE theo tfoot của lưới này (ID dùng-chung sẽ trùng khi có nhiều lưới — vd bảng nội bộ).
    tfoot.querySelector(".gf-add-item")?.addEventListener("click", () => addRow("name"));
    tfoot.querySelector(".gf-add-section")?.addEventListener("click", addSection);
    tfoot.querySelector(".gf-add-subsection")?.addEventListener("click", addSubSection);
    tfoot.querySelector(".gf-add-info")?.addEventListener("click", addInfo);
    tfoot.querySelector(".gf-group-sub")?.addEventListener("change", (e) => { activeSheet.groupSubtotal = e.target.checked; redraw(); });
  }

  // Re-derive the selection highlight from grid.sel — survives this innerHTML rebuild.
  paintSel();
}

function renderQuoteSummary(q) {
  const vatPct = Number(q.vatPercent) || 0;
  let subtotalAll = 0;
  const rows = q.sheets.map((s, i) => {
    const tpl = state.templates.find(t => t.id === s.templateId);
    const usesDays = !!tpl?.layout?.hasDays;
    const sub = sheetSubtotalGrouped(s.items, usesDays, s.groupSubtotal);
    subtotalAll += sub;
    return { idx: i + 1, name: s.name || tpl?.name || `Sheet ${i + 1}`, subtotal: sub };
  });
  const tt = quoteTotals(subtotalAll, vatPct, q.discount);   // mirror src/money.js: round + clamp discount
  return `
    <h3 style="margin: 18px 0 6px">Tổng báo giá (${q.sheets.length} sheet)</h3>
    <table class="summary-table" id="summary-table">
      <thead><tr><th scope="col">STT</th><th scope="col">Sheet</th><th scope="col" style="text-align:right">Tổng (VNĐ)</th></tr></thead>
      <tbody>
        ${rows.map(r => `<tr><td style="text-align:center">${r.idx}</td><td>${escapeHtml(r.name)}</td><td style="text-align:right" data-sub="${r.idx-1}">${fmtMoney(r.subtotal)}</td></tr>`).join("")}
      </tbody>
      <tfoot>
        <tr><td colspan="2">Tổng cộng</td><td style="text-align:right" id="sum-subtotal">${fmtMoney(tt.subtotal)}</td></tr>
        <tr><td colspan="2">VAT (${vatPct}%)</td><td style="text-align:right" id="sum-vat">${fmtMoney(tt.vat)}</td></tr>
        ${tt.discount > 0 ? `<tr><td colspan="2">Giảm giá</td><td style="text-align:right" id="sum-discount">-${fmtMoney(tt.discount)}</td></tr>` : ""}
        <tr><td colspan="2"><strong>Thành tiền</strong></td><td style="text-align:right; color:var(--danger)"><strong id="sum-total">${fmtMoney(tt.total)}</strong></td></tr>
      </tfoot>
    </table>`;
}

function updateSummary(q) {
  const wrap = document.querySelector(".quote-summary");
  if (wrap) wrap.innerHTML = renderQuoteSummary(q);
  refreshPreview(q);   // keep the live xlsx preview in sync (no-op when closed)
}

// ===== Live xlsx-faithful preview (approximates the src/excel.js export layout) =====
let _pvTimer = null;
function refreshPreview(q) {
  const box = document.getElementById("xlsx-preview");
  if (!box || box.hidden) return;
  clearTimeout(_pvTimer);
  _pvTimer = setTimeout(() => renderPreview(q), 80);
}
function renderPreview(q) {
  const box = document.getElementById("xlsx-preview");
  if (!box || box.hidden) return;
  const parts = (q.sheets || []).map(s => {
    const tpl = state.templates.find(t => t.id === s.templateId);
    // Route by layout shape (same flags the editor grid uses): a "Chi Tiết" column
    // means the CLF form; otherwise it's a GN form (with or without a Số ngày column).
    return (tpl && tpl.layout && tpl.layout.hasDetail) ? previewCLF(q, s, tpl) : previewGN(q, s, tpl);
  });
  if (q.showTotals !== false) parts.push(previewSummary(q));   // mirror the export summary sheet
  box.innerHTML = parts.join('<div class="xlsx-page-gap"></div>');
}
function pvCompanyBanner(q) {
  const co = state.companies.find(c => c.id === q.companyId) || {};
  return [
    co.name ? `<b>${escapeHtml(co.name)}</b>` : "",
    escapeHtml(co.address || ""),
    co.phone ? "ĐT: " + escapeHtml(co.phone) : "",
    co.email ? "Email: " + escapeHtml(co.email) : "",
  ].filter(Boolean).join("<br>");
}
function previewCLF(q, s) {
  const items = s.items || [];
  const { rows, eff } = pvRows(items, false, !!s.groupSubtotal);
  const vatPct = Number(q.vatPercent) || 0;
  const infoLines = items.filter(it => it.kind === "info").map(it => (it.name || "").trim()).filter(Boolean);
  const body = rows.map((row, i) => {
    if (row.kind === "info") return "";   // CLF folds info into the banner
    if (row.kind === "section") {
      const it = row.it;
      const amtCell = row.groupSubtotal ? pvMoney(row.groupSum * row.gmult) : "";
      return `<tr class="xlsx-section"><td class="xlsx-stt">${escapeHtml(row.letter)}</td><td style="font-weight:700">${nl2br(it.name)}</td><td></td><td class="xlsx-center">${escapeHtml(it.unit || "")}</td><td class="xlsx-center">${pvMoney(it.quantity)}</td><td class="xlsx-num">${pvMoney(row.groupSum)}</td><td class="xlsx-num">${amtCell}</td><td class="xlsx-center xlsx-italic">${nl2br(it.notes)}</td></tr>`;
    }
    const it = row.it, amt = row.amt;
    const neg = amt < 0 ? " xlsx-neg" : "";
    let head = "";
    if (row.kind === "head") {
      const span = pvRowspan(eff, i);
      head = `<td class="xlsx-stt" rowspan="${span}">${row.stt}</td><td rowspan="${span}" style="font-weight:700">${nl2br(it.name)}</td>`;
    }
    return `<tr>${head}<td class="xlsx-italic">${nl2br(it.detail)}</td><td class="xlsx-center">${escapeHtml(it.unit || "")}</td><td class="xlsx-center">${pvMoney(it.quantity)}</td><td class="xlsx-num${neg}">${pvMoney(it.unitPrice)}</td><td class="xlsx-num${neg}">${pvMoney(amt)}</td><td class="xlsx-center xlsx-italic">${nl2br(it.notes)}</td></tr>`;
  }).join("");
  const subtotal = sheetSubtotalGrouped(items, false, !!s.groupSubtotal);
  // The quote-level discount sits on the grand total; a single-sheet export shows it on
  // the sheet itself (excel.js onlySheet), multi-sheet shows it on the summary sheet.
  const tt = quoteTotals(subtotal, vatPct, (q.sheets || []).length === 1 ? q.discount : 0);
  const kg = [`Kính gửi: ${escapeHtml(q.toCompany || "…..")}`];
  if (q.toContact) kg.push(escapeHtml(q.toContact));
  if (q.toEmail) kg.push("Email: " + escapeHtml(q.toEmail));
  const logoCell = safeLogoSrc(q.customerLogo) ? `<img class="cust-logo" src="${safeLogoSrc(q.customerLogo)}" alt="Logo ${escapeHtml(q.toCompany || "khách hàng")}">` : `<span class="logo-ph">logo cty khách hàng</span>`;
  return `<table class="xlsx-page xlsx-clf">
    <colgroup><col style="width:50px"><col style="width:132px"><col style="width:240px"><col style="width:55px"><col style="width:78px"><col style="width:96px"><col style="width:108px"><col style="width:100px"></colgroup>
    <tr><td colspan="3"></td><td colspan="5" class="xlsx-center" style="white-space:pre-wrap">${pvCompanyBanner(q)}</td></tr>
    <tr><td colspan="8" class="xlsx-band xlsx-title">${escapeHtml(baoGiaTitleJS(q.title))}</td></tr>
    <tr><td colspan="3" class="xlsx-center">${logoCell}</td><td colspan="5" class="xlsx-center" style="white-space:pre-wrap">${kg.join("<br>")}</td></tr>
    <tr class="xlsx-band xlsx-center"><td>STT</td><td>Hạng Mục</td><td>Chi Tiết</td><td>ĐVT</td><td>SỐ LƯỢNG</td><td>ĐƠN GIÁ</td><td>THÀNH TIỀN</td><td>Ghi Chú</td></tr>
    ${infoLines.length ? `<tr><td colspan="8" class="xlsx-band" style="font-weight:600">* Thông tin chương trình: ${infoLines.map(escapeHtml).join("; ")}</td></tr>` : ""}
    ${body}
    <tr class="xlsx-band"><td colspan="6" class="xlsx-center">Tổng Cộng</td><td class="xlsx-num">${pvMoney(tt.subtotal)}</td><td></td></tr>
    <tr class="xlsx-band"><td colspan="6" class="xlsx-center">VAT(${vatPct}%)</td><td class="xlsx-num">${pvMoney(tt.vat)}</td><td></td></tr>
    ${tt.discount > 0 ? `<tr class="xlsx-band"><td colspan="6" class="xlsx-center">Giảm Giá</td><td class="xlsx-num">-${pvMoney(tt.discount)}</td><td></td></tr>` : ""}
    <tr class="xlsx-band"><td colspan="6" class="xlsx-center">Thành Tiền</td><td class="xlsx-num">${pvMoney(tt.total)}</td><td></td></tr>
    <tr><td colspan="4" style="white-space:pre-wrap">* Ghi chú: \n- Tất cả các hạng mục trên là cho thuê, Colofull thu hồi sau khi tháo dỡ</td><td colspan="4" class="xlsx-center">${escapeHtml(vnDateText(q.quoteDate, q.city))}</td></tr>
    <tr><td colspan="4">XÁC NHẬN ĐỒNG Ý ĐẶT HÀNG</td><td colspan="4" class="xlsx-center" style="font-weight:700">Công Ty TNHH Colorfull</td></tr>
  </table>`;
}
function previewGN(q, s, tpl) {
  const usesDays = !!(tpl && tpl.layout && tpl.layout.hasDays);
  const NC = usesDays ? 8 : 7;          // total columns
  const wide = NC;                      // colspan for full-width chrome rows
  const lblSpan = NC - 2;               // totals label spans up to the price column
  const items = s.items || [];
  const { rows, eff } = pvRows(items, usesDays, !!s.groupSubtotal);
  const vatPct = Number(q.vatPercent) || 0;
  const daysHead = usesDays ? `<td>SỐ NGÀY</td>` : "";
  const body = rows.map((row, i) => {
    if (row.kind === "info") return `<tr><td></td><td class="xlsx-italic" colspan="${NC - 1}">${nl2br(row.it.name)}</td></tr>`;
    if (row.kind === "section") {
      const it = row.it;
      const daysCell = usesDays ? `<td></td>` : "";
      const amtCell = row.groupSubtotal ? pvMoney(row.groupSum * row.gmult) : "";
      return `<tr class="xlsx-section"><td class="xlsx-stt">${escapeHtml(row.letter)}</td><td style="font-weight:700">${nl2br(it.name)}</td><td class="xlsx-center">${escapeHtml(it.unit || "")}</td><td class="xlsx-center">${pvMoney(it.quantity)}</td>${daysCell}<td class="xlsx-num">${pvMoney(row.groupSum)}</td><td class="xlsx-num">${amtCell}</td><td class="xlsx-center xlsx-italic">${nl2br(it.notes)}</td></tr>`;
    }
    const it = row.it, amt = row.amt;
    const neg = amt < 0 ? " xlsx-neg" : "";
    let head = "";
    if (row.kind === "head") {
      const span = pvRowspan(eff, i);
      head = `<td class="xlsx-stt" rowspan="${span}">${row.stt}</td><td class="xlsx-italic" rowspan="${span}">${nl2br(it.name)}</td>`;
    }
    const daysCell = usesDays ? `<td class="xlsx-center">${pvMoney(it.days)}</td>` : "";
    return `<tr>${head}<td class="xlsx-center">${escapeHtml(it.unit || "")}</td><td class="xlsx-center">${pvMoney(it.quantity)}</td>${daysCell}<td class="xlsx-num${neg}">${pvMoney(it.unitPrice)}</td><td class="xlsx-num${neg}">${pvMoney(amt)}</td><td class="xlsx-center xlsx-italic">${nl2br(it.notes)}</td></tr>`;
  }).join("");
  const subtotal = sheetSubtotalGrouped(items, usesDays, !!s.groupSubtotal);
  const tt = quoteTotals(subtotal, vatPct, (q.sheets || []).length === 1 ? q.discount : 0);   // discount only on a single-sheet export (excel.js)
  const fromName = state.companies.find(c => c.id === q.companyId)?.name || "";
  return `<table class="xlsx-page xlsx-gn">
    <tr><td colspan="2">To: <b class="xlsx-green">${escapeHtml(q.toCompany || "")}</b></td><td colspan="${wide - 2}">From: ${escapeHtml(fromName)}</td></tr>
    <tr><td colspan="2">${escapeHtml(q.toContact || "")}</td><td colspan="${wide - 2}">${escapeHtml(q.fromContact || "")}${q.fromTitle ? " _ " + escapeHtml(q.fromTitle) : ""}</td></tr>
    <tr><td colspan="2"></td><td colspan="${wide - 2}">Tel: ${escapeHtml(q.fromPhone || "")}</td></tr>
    <tr><td colspan="2"></td><td colspan="${wide - 2}">Add: ${escapeHtml(q.fromAddress || "")}</td></tr>
    <tr><td colspan="${wide}" class="xlsx-center">${escapeHtml(vnDateText(q.quoteDate, q.city))}</td></tr>
    <tr><td colspan="${wide}" class="xlsx-band xlsx-title">${escapeHtml(baoGiaTitleJS(q.title))}</td></tr>
    <tr><td colspan="${wide}" class="xlsx-italic">${nl2br(q.greeting)}</td></tr>
    <tr class="xlsx-band xlsx-center"><td>STT</td><td>Hạng Mục</td><td>ĐVT</td><td>SỐ LƯỢNG</td>${daysHead}<td>ĐƠN GIÁ</td><td>THÀNH TIỀN</td><td>Ghi Chú</td></tr>
    ${body}
    <tr class="xlsx-band-grey"><td colspan="${lblSpan}" class="xlsx-center">Tổng cộng</td><td class="xlsx-num">${pvMoney(tt.subtotal)}</td><td></td></tr>
    <tr class="xlsx-band-grey"><td colspan="${lblSpan}" class="xlsx-center">VAT ${vatPct}%</td><td class="xlsx-num">${pvMoney(tt.vat)}</td><td></td></tr>
    ${tt.discount > 0 ? `<tr class="xlsx-band-grey"><td colspan="${lblSpan}" class="xlsx-center">Giảm giá</td><td class="xlsx-num">-${pvMoney(tt.discount)}</td><td></td></tr>` : ""}
    <tr class="xlsx-band-grey"><td colspan="${lblSpan}" class="xlsx-center">Thành tiền</td><td class="xlsx-num">${pvMoney(tt.total)}</td><td></td></tr>
    ${q.notes ? `<tr><td colspan="${wide}" class="xlsx-italic" style="white-space:pre-wrap">Ghi chú: ${nl2br(q.notes)}</td></tr>` : ""}
  </table>`;
}
function previewSummary(q) {
  const vatPct = Number(q.vatPercent) || 0;
  let subtotalAll = 0;
  const rows = (q.sheets || []).map((s, i) => {
    const tpl = state.templates.find(t => t.id === s.templateId);
    const usesDays = !!(tpl && tpl.layout && tpl.layout.hasDays);
    const sub = sheetSubtotalGrouped(s.items, usesDays, !!s.groupSubtotal);
    subtotalAll += sub;
    return { idx: i + 1, name: s.name || (tpl && tpl.name) || ("Sheet " + (i + 1)), sub };
  });
  const tt = quoteTotals(subtotalAll, vatPct, q.discount);   // grand total carries the discount (mirror excel.js summary sheet)
  return `<table class="xlsx-page xlsx-summary">
    <colgroup><col style="width:50px"><col style="width:330px"><col style="width:160px"></colgroup>
    <tr><td colspan="3" class="xlsx-title">TỔNG BÁO GIÁ ${escapeHtml(q.quoteNumber || "")}</td></tr>
    <tr><td colspan="3" class="xlsx-center xlsx-italic">${escapeHtml(q.title || "")}</td></tr>
    <thead><tr><th>STT</th><th>Hạng mục</th><th>Thành tiền (VNĐ)</th></tr></thead>
    ${rows.map(r => `<tr><td class="xlsx-center">${r.idx}</td><td>${escapeHtml(r.name)}</td><td class="xlsx-num">${pvMoney(r.sub)}</td></tr>`).join("")}
    <tr class="xlsx-band"><td colspan="2" class="xlsx-center">Tổng cộng</td><td class="xlsx-num">${pvMoney(tt.subtotal)}</td></tr>
    <tr class="xlsx-band"><td colspan="2" class="xlsx-center">VAT (${vatPct}%)</td><td class="xlsx-num">${pvMoney(tt.vat)}</td></tr>
    ${tt.discount > 0 ? `<tr class="xlsx-band"><td colspan="2" class="xlsx-center">Giảm giá</td><td class="xlsx-num">-${pvMoney(tt.discount)}</td></tr>` : ""}
    <tr class="xlsx-band"><td colspan="2" class="xlsx-center">Thành tiền</td><td class="total-val">${pvMoney(tt.total)}</td></tr>
  </table>`;
}

// ---------------- Users (Admin) ----------------
async function renderUsers(el) {
  el.innerHTML = `<h1>Quản lý nhân viên</h1>
    <div class="toolbar">
      <button class="btn btn-primary" id="btn-new-user">+ Thêm nhân viên</button>
    </div>
    <div id="users-body">${skeleton(5)}</div>`;
  document.getElementById("btn-new-user").addEventListener("click", () => openUserModal(null));
  await loadUsers();
}

async function loadUsers() {
  try {
    const users = await api("/api/users");
    state.users = users;
    drawUsers();
  } catch (e) { toast(e.message, "error"); }
}

function drawUsers() {
  const body = document.getElementById("users-body");
  if (!body) return;
  const dash = '<span class="muted">—</span>';
  body.innerHTML = `
    <div class="tbl-scroll"><table class="list-table">
      <thead><tr><th scope="col">Tên đăng nhập</th><th scope="col">Họ tên</th><th scope="col">Mã dự án</th><th scope="col">Quyền</th><th scope="col">SĐT</th><th scope="col">Trạng thái</th><th scope="col" style="text-align:right">Thao tác</th></tr></thead>
      <tbody>
        ${state.users.map(u => `
          <tr>
            <td>${escapeHtml(u.username)}</td>
            <td>${escapeHtml(u.displayName)}</td>
            <td>${u.projectCode ? `<strong>${escapeHtml(u.projectCode)}</strong>` : dash}</td>
            <td><span class="status ${u.role === "admin" ? "approved" : u.role === "manager" ? "pending" : "draft"}">${ROLE_LABEL[u.role]}</span></td>
            <td>${u.phone ? escapeHtml(u.phone) : dash}</td>
            <td>${u.pending ? '<span class="status pending">Chờ kích hoạt</span>' : `<span class="status ${u.active ? "approved" : "rejected"}">${u.active ? "Hoạt động" : "Đã khóa"}</span>`}</td>
            <td style="text-align:right; white-space:nowrap">
              ${u.pending
                ? `<button class="btn btn-sm" data-resend="${u.id}">Gửi lại lời mời</button>`
                : `<button class="btn btn-sm" data-edit="${u.id}">Sửa</button>
                   <button class="btn btn-sm" data-pw="${u.id}">Đổi MK</button>
                   <button class="btn btn-sm ${u.active ? "btn-warn" : "btn-success"}" data-toggle="${u.id}">${u.active ? "Khóa" : "Mở khóa"}</button>`}
              ${u.id !== state.user.id ? `<button class="btn btn-sm btn-danger" data-del="${u.id}">Xóa</button>` : ""}
            </td>
          </tr>
        `).join("")}
      </tbody>
    </table></div>`;
  body.querySelectorAll("button[data-edit]").forEach(b => b.addEventListener("click", () => openUserModal(state.users.find(u => u.id === parseInt(b.dataset.edit, 10)))));
  body.querySelectorAll("button[data-resend]").forEach(b => b.addEventListener("click", async () => {
    const u = state.users.find(x => x.id === parseInt(b.dataset.resend, 10));
    try { const r = await api(`/api/users/${b.dataset.resend}/resend-invite`, { method: "POST" }); showInviteResult({ ...r, user: { email: u?.email || "" } }); }
    catch (e) { toast(e.message, "error"); }
  }));
  body.querySelectorAll("button[data-pw]").forEach(b => b.addEventListener("click", () => openPasswordModal(state.users.find(u => u.id === parseInt(b.dataset.pw, 10)))));
  body.querySelectorAll("button[data-toggle]").forEach(b => b.addEventListener("click", async () => {
    const u = state.users.find(x => x.id === parseInt(b.dataset.toggle, 10));
    try {
      await api(`/api/users/${u.id}`, { method: "PUT", body: JSON.stringify({ active: !u.active }) });
      toast(u.active ? "Đã khóa tài khoản" : "Đã mở khóa tài khoản", "success");
      loadUsers();
    } catch (e) { toast(e.message, "error"); }
  }));
  body.querySelectorAll("button[data-del]").forEach(b => b.addEventListener("click", async () => {
    if (!(await confirmModal("Xóa nhân viên", "Xóa nhân viên này? Hành động không thể hoàn tác.", { danger: true }))) return;
    try {
      await api(`/api/users/${b.dataset.del}`, { method: "DELETE" });
      toast("Đã xóa", "success");
      loadUsers();
    } catch (e) { toast(e.message, "error"); }
  }));
}

// Invite a new employee by email (they self-onboard).
function openInviteModal() {
  const m = openModal("Mời nhân viên", `
    <p class="muted" style="margin-top:0">Nhập email nhân viên — hệ thống gửi lời mời, họ tự đặt mật khẩu và điền SĐT.</p>
    <div class="form-grid">
      <label style="grid-column:1/-1">Họ tên <span class="req">*</span><input id="iv-name" placeholder="VD: Nguyễn Văn A" /></label>
      <label style="grid-column:1/-1">Email cá nhân <span class="req">*</span><input id="iv-email" type="email" inputmode="email" placeholder="email cá nhân của nhân viên" /></label>
      <label style="grid-column:1/-1">Quyền
        <select id="iv-role">
          <option value="manager">Quản lý</option>
          <option value="admin">Quản trị viên</option>
          <option value="account_hn">Account Hà Nội</option>
        </select>
      </label>
      <label style="grid-column:1/-1">Mã dự án <span class="muted" style="font-weight:400;font-size:12px">(vd FE_A26 — báo giá của họ sẽ là FE_A26_001, _002…)</span><input id="iv-projectcode" placeholder="VD: FE_A26" /></label>
    </div>`);
  m.onSave(async () => {
    const displayName = m.find("#iv-name").value.trim();
    const email = m.find("#iv-email").value.trim();
    if (!displayName || !email) { toast("Vui lòng nhập họ tên và email", "error"); return; }
    try {
      const r = await api("/api/users/invite", { method: "POST", body: JSON.stringify({ email, displayName, role: m.find("#iv-role").value, projectCode: m.find("#iv-projectcode").value.trim() || null }) });
      m.close();
      showInviteResult(r);
      loadUsers();
    } catch (e) { toast(e.message, "error"); }
  });
  const sb = m.find("[data-save]"); if (sb) sb.textContent = "Gửi lời mời";
  setTimeout(() => m.find("#iv-name")?.focus(), 40);
}

function showInviteResult(r) {
  const sent = r.emailSent;
  const m = openModal("Đã tạo lời mời", `
    <p>${sent ? `Đã gửi email lời mời tới <b>${escapeHtml(r.user.email)}</b>.` : `Email chưa được cấu hình trên hệ thống — hãy gửi <b>liên kết mời</b> này cho nhân viên:`}</p>
    <div style="display:flex;gap:8px;margin-top:8px">
      <input id="iv-link" value="${escapeHtml(r.inviteUrl)}" readonly style="flex:1" />
      <button class="btn" id="iv-copy" type="button">Sao chép</button>
    </div>
    <p class="muted" style="margin-top:10px">Nhân viên mở liên kết → đặt mật khẩu + điền SĐT → đăng nhập bằng <b>email</b>. Lời mời hết hạn sau 7 ngày.</p>`);
  m.find("#iv-copy")?.addEventListener("click", async () => {
    const inp = m.find("#iv-link"); inp.select();
    let ok = false;
    try { if (navigator.clipboard) { await navigator.clipboard.writeText(inp.value); ok = true; } } catch { ok = false; }
    if (!ok) { try { ok = document.execCommand("copy"); } catch { ok = false; } }   // fallback http/insecure
    toast(ok ? "Đã sao chép liên kết" : "Chưa sao chép được — hãy chọn rồi nhấn Ctrl/Cmd+C", ok ? "success" : "error");
  });
  const sb = m.find("[data-save]"); if (sb) sb.style.display = "none";
  const cb = m.find("[data-cancel]"); if (cb) cb.textContent = "Đóng";
}

function openUserModal(u) {
  const isNew = !u;
  if (isNew) return openInviteModal();
  const mask = document.createElement("div");
  mask.className = "modal-mask";
  mask.innerHTML = `
    <div class="modal">
      <h2>${isNew ? "Thêm nhân viên" : "Sửa: " + escapeHtml(u.username)}</h2>
      <label>Tên đăng nhập<input name="username" value="${escapeHtml(u?.username || "")}" ${isNew ? "" : "disabled"} /></label>
      ${isNew ? `<label>Mật khẩu khởi tạo<input name="password" type="password" autocomplete="new-password" placeholder="Tối thiểu 8 ký tự, gồm chữ và số" /></label>` : ""}
      <label>Họ tên<input name="displayName" value="${escapeHtml(u?.displayName || "")}" /></label>
      <label>Quyền
        <select name="role">
          <option value="manager" ${u?.role === "manager" || !u?.role ? "selected" : ""}>Quản lý</option>
          <option value="admin" ${u?.role === "admin" ? "selected" : ""}>Quản trị viên</option>
          <option value="account_hn" ${u?.role === "account_hn" ? "selected" : ""}>Account Hà Nội</option>
        </select>
      </label>
      <label>SĐT<input name="phone" type="tel" inputmode="tel" value="${escapeHtml(u?.phone || "")}" /></label>
      <label>Mã dự án <span class="muted" style="font-size:11px">(vd FE_A26 — báo giá user này tạo sẽ là FE_A26_001…)</span><input name="projectCode" value="${escapeHtml(u?.projectCode || "")}" placeholder="VD: FE_A26" /></label>
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" name="canSign" ${u?.canSign ? "checked" : ""} /> <span>Được <strong>Ký Chứng từ</strong> ở trang Quản lý dự án <span class="muted" style="font-size:11px">(admin luôn được; bật cho nhân viên cần ký)</span></span></label>
      <div class="actions">
        <button class="btn" data-act="cancel">Hủy</button>
        <button class="btn btn-primary" data-act="save">Lưu</button>
      </div>
    </div>`;
  document.body.appendChild(mask);
  mask.querySelector("[data-act=cancel]").addEventListener("click", () => mask.remove());
  mask.querySelector("[data-act=save]").addEventListener("click", async () => {
    const get = n => mask.querySelector(`[name=${n}]`).value;
    const payload = {
      username: get("username"), displayName: get("displayName"),
      role: get("role"), phone: get("phone"),
      projectCode: get("projectCode").trim() || null,
      canSign: !!mask.querySelector("[name=canSign]")?.checked,
    };
    if (isNew) payload.password = get("password");
    try {
      if (isNew) await api("/api/users", { method: "POST", body: JSON.stringify(payload) });
      else await api(`/api/users/${u.id}`, { method: "PUT", body: JSON.stringify(payload) });
      toast("Đã lưu", "success");
      mask.remove();
      loadUsers();
    } catch (e) { toast(e.message, "error"); }
  });
}

function openPasswordModal(u) {
  const mask = document.createElement("div");
  mask.className = "modal-mask";
  mask.innerHTML = `
    <div class="modal">
      <h2>Đổi mật khẩu: ${escapeHtml(u.username)}</h2>
      <label>Mật khẩu mới<input name="password" type="password" autocomplete="new-password" /></label>
      <div class="actions">
        <button class="btn" data-act="cancel">Hủy</button>
        <button class="btn btn-primary" data-act="save">Đổi</button>
      </div>
    </div>`;
  document.body.appendChild(mask);
  mask.querySelector("[data-act=cancel]").addEventListener("click", () => mask.remove());
  mask.querySelector("[data-act=save]").addEventListener("click", async () => {
    const pw = mask.querySelector("[name=password]").value;
    try {
      await api(`/api/users/${u.id}`, { method: "PUT", body: JSON.stringify({ password: pw }) });
      toast("Đã đổi mật khẩu", "success");
      mask.remove();
    } catch (e) { toast(e.message, "error"); }
  });
}

function renderMfaBox() {
  const box = document.getElementById("mfa-box");
  if (!box) return;
  if (state.user.mfaEnabled) {
    box.innerHTML = `<p>Trạng thái: <span class="status approved">Đang bật</span></p>
      <button class="btn btn-danger" id="mfa-disable">Tắt bảo mật 2 lớp</button>`;
    document.getElementById("mfa-disable").addEventListener("click", async () => {
      const password = await promptModal("Tắt bảo mật 2 lớp", "Nhập MẬT KHẨU hiện tại để xác nhận:", { type: "password", placeholder: "Mật khẩu" });
      if (!password) return;
      const token = await promptModal("Tắt bảo mật 2 lớp", "Nhập mã 6 số từ ứng dụng xác thực (hoặc mã dự phòng):", { placeholder: "123456" });
      if (!token) return;
      try { await api("/api/mfa/disable", { method: "POST", body: JSON.stringify({ password, token: token.trim() }) }); state.user.mfaEnabled = false; toast("Đã tắt MFA", "success"); renderMfaBox(); }
      catch (e) { toast(e.message, "error"); }
    });
  } else {
    box.innerHTML = `<p>Trạng thái: <span class="status draft">Chưa bật</span></p>
      <p class="muted">Yêu cầu mã từ ứng dụng (Google Authenticator, Authy…) mỗi lần đăng nhập — tăng bảo mật cho tài khoản.</p>
      <button class="btn btn-primary" id="mfa-enable">Bật bảo mật 2 lớp</button>`;
    document.getElementById("mfa-enable").addEventListener("click", startMfaSetup);
  }
}

async function startMfaSetup() {
  let s;
  try { s = await api("/api/mfa/setup", { method: "POST" }); } catch (e) { toast(e.message, "error"); return; }
  const m = openModal("Bật bảo mật 2 lớp", `
    <p><b>1.</b> Quét mã QR bằng app xác thực (Google Authenticator, Authy…):</p>
    <div style="text-align:center"><img src="${s.qr}" alt="Mã QR MFA" style="width:184px;height:184px;border:1px solid var(--border);border-radius:8px"/></div>
    <p class="muted" style="word-break:break-all">Hoặc nhập tay khóa: <b>${escapeHtml(s.secret)}</b></p>
    <label style="display:block"><b>2.</b> Nhập mã 6 số đang hiện trên app:
      <input id="mfa-token" inputmode="numeric" maxlength="6" placeholder="123456" style="width:100%;margin-top:6px"/></label>
    <div id="mfa-codes"></div>`);
  m.onSave(async () => {
    const token = (m.find("#mfa-token").value || "").trim();
    if (!/^\d{6}$/.test(token)) { toast("Nhập đúng mã 6 số", "error"); return; }
    try {
      const r = await api("/api/mfa/enable", { method: "POST", body: JSON.stringify({ secret: s.secret, token }) });
      state.user.mfaEnabled = true;
      m.find("#mfa-codes").innerHTML = `<div style="margin-top:12px;padding:12px;background:var(--surface-2);border-radius:8px">
        <b>Mã dự phòng</b> — lưu lại nơi an toàn, mỗi mã dùng 1 lần khi không có điện thoại:
        <div style="font-family:var(--font-mono);margin-top:8px;columns:2;gap:8px">${(r.backupCodes || []).map(c => `<div>${escapeHtml(c)}</div>`).join("")}</div></div>`;
      toast("Đã bật MFA", "success");
      const sb = m.find("[data-save]"); if (sb) sb.style.display = "none";
      const cb = m.find("[data-cancel]"); if (cb) cb.textContent = "Xong";
      renderMfaBox();
    } catch (e) { toast(e.message, "error"); }
  });
  const sb = m.find("[data-save]"); if (sb) sb.textContent = "Xác nhận bật";
  setTimeout(() => m.find("#mfa-token")?.focus(), 40);
}

function renderProfile(el) {
  const u = state.user;
  el.innerHTML = `
    <h1>Tài khoản</h1>
    <div class="account-grid">
      <section class="card-section">
        <h3>Hồ sơ</h3>
        <form id="profile-form" class="form-grid">
          <label style="grid-column:1/-1">Họ tên <span class="req">*</span><input id="pf-name" value="${escapeHtml(u.displayName || "")}" required /></label>
          <label style="grid-column:1/-1">Tên người gửi trên báo giá<input id="pf-sender" value="${escapeHtml(u.senderName || "")}" placeholder="Để trống = dùng Họ tên" /></label>
          <label>Số điện thoại<input id="pf-phone" type="tel" inputmode="tel" value="${escapeHtml(u.phone || "")}" /></label>
          <label>Chức danh<input id="pf-title" value="${escapeHtml(u.title || "")}" placeholder="VD: Account, Sale, Giám đốc…" /></label>
          <label>Email<input value="${escapeHtml(u.email || "—")}" disabled /></label>
          <label>Vai trò<input value="${escapeHtml(ROLE_LABEL[u.role] || u.role)}" disabled /></label>
          <div style="grid-column:1/-1"><button class="btn btn-primary" type="submit">Lưu hồ sơ</button></div>
        </form>
      </section>
      <section class="card-section">
        <h3>Bảo mật 2 lớp (MFA)</h3>
        <div id="mfa-box"></div>
      </section>
      <section class="card-section">
        <h3>Đổi mật khẩu</h3>
        <form id="pw-form" autocomplete="off">
          <p class="muted" style="margin-top:0">Mật khẩu mới tối thiểu 8 ký tự, gồm cả chữ và số.</p>
          <label for="old-pw" style="display:block; margin-bottom:14px"><span>Mật khẩu cũ</span>
            <input type="password" id="old-pw" autocomplete="current-password" required
              style="width:100%; padding:9px 11px; border:1px solid var(--border-strong); border-radius:var(--radius-sm); background:var(--surface-2); color:var(--text)" /></label>
          <label for="new-pw" style="display:block; margin-bottom:6px"><span>Mật khẩu mới</span>
            <input type="password" id="new-pw" autocomplete="new-password" required minlength="8" maxlength="128"
              style="width:100%; padding:9px 11px; border:1px solid var(--border-strong); border-radius:var(--radius-sm); background:var(--surface-2); color:var(--text)" /></label>
          <div class="pw-meter" aria-hidden="true"><i id="pw-bar"></i></div>
          <div class="pw-hint" id="pw-hint">Độ mạnh: —</div>
          <label for="new-pw2" style="display:block; margin:14px 0"><span>Nhập lại mật khẩu mới</span>
            <input type="password" id="new-pw2" autocomplete="new-password" required minlength="8" maxlength="128"
              style="width:100%; padding:9px 11px; border:1px solid var(--border-strong); border-radius:var(--radius-sm); background:var(--surface-2); color:var(--text)" /></label>
          <button class="btn btn-primary" type="submit">Đổi mật khẩu</button>
        </form>
      </section>
    </div>`;

  document.getElementById("profile-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const me = await api("/api/auth/profile", { method: "POST", body: JSON.stringify({ displayName: document.getElementById("pf-name").value, senderName: document.getElementById("pf-sender").value, phone: document.getElementById("pf-phone").value, title: document.getElementById("pf-title").value }) });
      state.user = { ...state.user, ...me };
      toast("Đã lưu hồ sơ", "success");
      renderShell();
    } catch (err) { toast(err.message, "error"); }
  });

  renderMfaBox();

  const np = document.getElementById("new-pw");
  const bar = document.getElementById("pw-bar");
  const hint = document.getElementById("pw-hint");
  const score = (s) => {
    let n = 0;
    if (s.length >= 8) n++;
    if (/[a-z]/.test(s) && /[A-Z]/.test(s)) n++;
    if (/\d/.test(s)) n++;
    if (/[^A-Za-z0-9]/.test(s)) n++;
    if (s.length >= 12) n++;
    return Math.min(n, 4);
  };
  np.addEventListener("input", () => {
    const sc = score(np.value);
    const pct = [6, 28, 55, 80, 100][sc];
    const col = ["var(--danger)", "var(--danger)", "var(--warn)", "var(--success)", "var(--success)"][sc];
    const lbl = ["Rất yếu", "Yếu", "Trung bình", "Mạnh", "Rất mạnh"][sc];
    bar.style.width = pct + "%"; bar.style.background = col;
    hint.textContent = "Độ mạnh: " + (np.value ? lbl : "—");
  });

  document.getElementById("pw-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const oldPassword = document.getElementById("old-pw").value;
    const newPassword = np.value;
    const confirm2 = document.getElementById("new-pw2").value;
    if (newPassword !== confirm2) { toast("Mật khẩu nhập lại không khớp", "error"); return; }
    try {
      await api("/api/auth/change-password", { method: "POST", body: JSON.stringify({ oldPassword, newPassword }) });
      toast("Đã đổi mật khẩu", "success");
      e.target.reset();
      bar.style.width = "0"; hint.textContent = "Độ mạnh: —";
    } catch (err) {
      // Surface server validation details if present
      const d = err.details?.map?.(x => x.message).join("; ");
      toast(d || err.message, "error");
    }
  });
}

// ============================================================
// EXTENDED PAGES — Phase 2 modules
// ============================================================

// ---------------- Dashboard ----------------
async function renderDashboard(el) {
  el.innerHTML = `<h1>Tổng quan</h1>
    <p class="muted" style="margin:-8px 0 16px">Số liệu 30 ngày gần nhất</p>
    <div id="dash-kpi" class="kpi-grid">${skeleton(4, true)}</div>
    <div class="dash-cols">
      <section><h3>Phễu báo giá</h3><div id="dash-funnel" class="funnel"></div></section>
      <section><h3>Top nhân viên (doanh số đã duyệt)</h3><div id="dash-top"></div></section>
    </div>`;
  try {
    const [overview, funnel, top] = await Promise.all([
      api("/api/analytics/overview"),
      api("/api/analytics/funnel"),
      api("/api/analytics/top-sales?limit=10"),
    ]);
    const k = overview.kpi;
    document.getElementById("dash-kpi").innerHTML = `
      <div class="kpi"><span>Báo giá (30 ngày)</span><strong>${k.totalQuotes}</strong></div>
      <div class="kpi"><span>Doanh số đã duyệt</span><strong>${fmtMoney(k.approvedAmount)} đ</strong></div>
      <div class="kpi"><span>Trung bình / báo giá</span><strong>${fmtMoney(Math.round(k.avgDealSize))} đ</strong></div>
      <div class="kpi"><span>Tỷ lệ chốt</span><strong>${k.conversionRate}%</strong></div>`;
    const maxCount = Math.max(1, ...funnel.data.map(s => s.count));
    document.getElementById("dash-funnel").innerHTML = funnel.data.map(s => `
      <div class="funnel-row" data-status="${s.status}" ${KBD} aria-label="Lọc danh sách: ${statusLabel(s.status)} (${s.count})">
        <span class="status ${s.status}">${statusLabel(s.status)}</span>
        <div class="funnel-track"><div class="funnel-bar" style="width:${s.count ? Math.max(5, Math.round(s.count / maxCount * 100)) : 0}%"></div></div>
        <strong>${s.count}</strong>
      </div>
    `).join("") || "<div class='empty-state'>Không có dữ liệu</div>";
    // Funnel rows are actionable: click → open the list filtered by that status.
    document.querySelectorAll("#dash-funnel .funnel-row").forEach(r => r.addEventListener("click", () => {
      state.filter = { q: "", status: r.dataset.status, page: 1 };
      location.hash = "#/list";
    }));
    document.getElementById("dash-top").innerHTML = top.data.length ? `
      <div class="tbl-scroll"><table class="list-table">
        <thead><tr><th scope="col">#</th><th scope="col">Nhân viên</th><th scope="col" style="text-align:right">Số BG</th><th scope="col" style="text-align:right">Doanh số (đ)</th></tr></thead>
        <tbody>${top.data.map((t, i) => `
          <tr><td>${i + 1}</td><td>${escapeHtml(t.user?.displayName || "—")}</td><td style="text-align:right">${t.count}</td><td style="text-align:right">${fmtMoney(t.amount)}</td></tr>
        `).join("")}</tbody>
      </table></div>` : "<div class='empty-state'>Chưa có doanh số đã duyệt</div>";
  } catch (e) { toast(e.message, "error"); }
}

// ---------------- Customers (CRM) ----------------
async function renderCustomers(el) {
  el.innerHTML = `<h1>Mã khách hàng</h1>
    <div class="toolbar">
      <input id="cust-q" placeholder="Tìm theo mã hoặc tên công ty…" style="flex:1; min-width:240px"/>
      <button class="btn btn-primary" id="btn-new-cust">+ Khách mới</button>
    </div>
    <div id="cust-body">Đang tải…</div>`;
  let q = "";
  const reload = async () => {
    const qs = "size=100" + (q ? `&q=${encodeURIComponent(q)}` : "");
    try {
      const r = await api("/api/customers?" + qs);
      const body = document.getElementById("cust-body");
      if (!r.data.length) { body.innerHTML = "<div class='empty-state'>Chưa có khách hàng</div>"; return; }
      body.innerHTML = `<table class="list-table">
        <thead><tr><th scope="col">Mã khách hàng</th><th scope="col">Tên công ty</th><th scope="col"></th></tr></thead>
        <tbody>${r.data.map(c => `
          <tr>
            <td><strong>${escapeHtml(c.code)}</strong></td>
            <td>${escapeHtml(c.name)}</td>
            <td>
              <button class="btn btn-sm" data-edit="${c.id}">Sửa</button>
              <button class="btn btn-sm btn-danger" data-del="${c.id}">Xóa</button>
            </td>
          </tr>`).join("")}</tbody>
      </table>`;
      body.querySelectorAll("[data-edit]").forEach(b => b.addEventListener("click", () => editCustomer(parseInt(b.dataset.edit))));
      body.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", async () => {
        if (!(await confirmModal("Xóa khách hàng", "Xóa khách hàng này?", { danger: true, confirmText: "Xóa" }))) return;
        try { await api(`/api/customers/${b.dataset.del}`, { method: "DELETE" }); toast("Đã xóa", "success"); reload(); }
        catch (e) { toast(e.message, "error"); }
      }));
    } catch (e) { toast(e.message, "error"); }
  };
  document.getElementById("cust-q").addEventListener("input", (e) => { q = e.target.value; clearTimeout(window._ct); window._ct = setTimeout(reload, 300); });
  document.getElementById("btn-new-cust").addEventListener("click", () => editCustomer(null));
  await reload();
}

/** Customer picker — used inside the quote editor. Returns selected customer or null. */
async function pickCustomer() {
  return new Promise((resolve) => {
    const m = openModal("Chọn khách hàng", `
      <input id="cp-q" placeholder="Tìm theo tên / mã / SĐT…" autofocus
        style="width:100%;padding:8px;border:1px solid #d8dbe3;border-radius:6px;margin-bottom:10px"/>
      <div id="cp-list" style="max-height:50vh;overflow:auto"></div>`);
    const q = m.find("#cp-q");
    const list = m.find("#cp-list");
    const reload = async () => {
      try {
        const r = await api("/api/customers?size=30" + (q.value ? `&q=${encodeURIComponent(q.value)}` : ""));
        list.innerHTML = r.data.length ? r.data.map(c => `
          <div class="pick-row" data-id="${c.id}" ${KBD} aria-label="Chọn ${escapeHtml(c.code)} ${escapeHtml(c.name)}">
            <div><strong>${escapeHtml(c.code)}</strong> — ${escapeHtml(c.name)}</div>
            <div style="font-size:12px;color:var(--text-muted)">${escapeHtml(c.phone || "")} ${escapeHtml(c.email || "")}</div>
          </div>`).join("") : "<div class='empty-state' style='padding:20px'>Không tìm thấy</div>";
        list.querySelectorAll(".pick-row").forEach(d => d.addEventListener("click", () => {
          const sel = r.data.find(c => c.id === parseInt(d.dataset.id));
          m.close(); resolve(sel);
        }));
      } catch (e) { toast(e.message, "error"); }
    };
    q.addEventListener("input", () => { clearTimeout(window._cpt); window._cpt = setTimeout(reload, 200); });
    m.onSave(() => { m.close(); resolve(null); });
    reload();
  });
}

function editCustomer(id) {
  const isNew = id == null;
  const m = openModal(isNew ? "Tạo khách hàng" : "Sửa khách hàng", `
    <div class="form-grid">
      <label style="grid-column:1/-1">Mã khách hàng${isNew ? ' <span class="muted" style="font-size:11px">(để trống = tự cấp KH…)</span>' : ''}
        <input id="cf-code" placeholder="VD: CGV, KH001…" ${isNew ? "" : "readonly"}/></label>
      <label style="grid-column:1/-1">Tên công ty <span class="req">*</span><input id="cf-name" required/></label>
    </div>`);
  if (!isNew) {
    api(`/api/customers/${id}`).then(c => {
      m.find("#cf-code").value = c.code || "";
      m.find("#cf-name").value = c.name || "";
    });
  }
  m.onSave(async () => {
    const name = m.find("#cf-name").value.trim();
    const code = m.find("#cf-code").value.trim();
    if (!name) { toast("Nhập tên công ty", "error"); return; }
    const body = { name };
    if (isNew && code) body.code = code;
    try {
      if (isNew) await api("/api/customers", { method: "POST", body: JSON.stringify(body) });
      else await api(`/api/customers/${id}`, { method: "PUT", body: JSON.stringify(body) });
      toast("Đã lưu", "success");
      m.close();
      renderCustomers(document.getElementById("main"));
    } catch (e) { toast(e.message, "error"); }
  });
}

// ---------------- Products ----------------
async function renderProducts(el) {
  el.innerHTML = `<h1>Sản phẩm / Dịch vụ</h1>
    <div class="toolbar">
      <input id="p-q" placeholder="Tìm theo SKU hoặc tên…" style="flex:1"/>
      <button class="btn btn-primary" id="btn-new-p">+ Sản phẩm mới</button>
    </div>
    <div id="p-body">Đang tải…</div>`;
  let q = "";
  const reload = async () => {
    try {
      const r = await api("/api/products?size=100" + (q ? `&q=${encodeURIComponent(q)}` : ""));
      const body = document.getElementById("p-body");
      if (!r.data.length) { body.innerHTML = "<div class='empty-state'>Chưa có sản phẩm</div>"; return; }
      body.innerHTML = `<table class="list-table">
        <thead><tr><th scope="col">SKU</th><th scope="col">Tên</th><th scope="col">Loại</th><th scope="col">ĐVT</th>
          <th scope="col" style="text-align:right">Giá vốn</th><th scope="col" style="text-align:right">Giá bán</th>
          <th scope="col" style="text-align:right">Margin</th><th scope="col"></th></tr></thead>
        <tbody>${r.data.map(p => `
          <tr>
            <td><strong>${escapeHtml(p.sku)}</strong></td>
            <td>${escapeHtml(p.name)}</td>
            <td>${escapeHtml(p.category || "")}</td>
            <td>${escapeHtml(p.unit || "")}</td>
            <td style="text-align:right">${fmtMoney(p.costPrice)}</td>
            <td style="text-align:right">${fmtMoney(p.basePrice)}</td>
            <td style="text-align:right">${p.margin != null ? p.margin + "%" : "—"}</td>
            <td><button class="btn btn-sm" data-edit="${p.id}">Sửa</button>
                <button class="btn btn-sm btn-danger" data-del="${p.id}">Xóa</button></td>
          </tr>`).join("")}</tbody></table>`;
      body.querySelectorAll("[data-edit]").forEach(b => b.addEventListener("click", () => editProduct(parseInt(b.dataset.edit))));
      body.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", async () => {
        if (!(await confirmModal("Xóa sản phẩm", "Xóa sản phẩm này?", { danger: true, confirmText: "Xóa" }))) return;
        try { await api(`/api/products/${b.dataset.del}`, { method: "DELETE" }); toast("Đã xóa", "success"); reload(); }
        catch (e) { toast(e.message, "error"); }
      }));
    } catch (e) { toast(e.message, "error"); }
  };
  document.getElementById("p-q").addEventListener("input", (e) => { q = e.target.value; clearTimeout(window._pt); window._pt = setTimeout(reload, 300); });
  document.getElementById("btn-new-p").addEventListener("click", () => editProduct(null));
  await reload();
}

function editProduct(id) {
  const isNew = id == null;
  const m = openModal(isNew ? "Tạo sản phẩm" : "Sửa sản phẩm", `
    <div class="form-grid">
      <label>SKU <span class="req">*</span><input id="pf-sku" required ${isNew ? "" : "disabled"}/></label>
      <label>Tên <span class="req">*</span><input id="pf-name" required/></label>
      <label>Loại<input id="pf-cat"/></label>
      <label>ĐVT<input id="pf-unit"/></label>
      <label>Giá vốn<input id="pf-cost" type="number" min="0" step="1" value="0"/></label>
      <label>Giá bán<input id="pf-base" type="number" min="0" step="1" value="0"/></label>
      <label style="grid-column:1/-1">Mô tả<textarea id="pf-desc" rows="2"></textarea></label>
    </div>`);
  if (!isNew) {
    api(`/api/products/${id}`).then(p => {
      m.find("#pf-sku").value = p.sku || "";
      m.find("#pf-name").value = p.name || "";
      m.find("#pf-cat").value = p.category || "";
      m.find("#pf-unit").value = p.unit || "";
      m.find("#pf-cost").value = p.costPrice || 0;
      m.find("#pf-base").value = p.basePrice || 0;
      m.find("#pf-desc").value = p.description || "";
    });
  }
  m.onSave(async () => {
    const body = {
      sku: m.find("#pf-sku").value.trim(),
      name: m.find("#pf-name").value.trim(),
      category: m.find("#pf-cat").value.trim() || null,
      unit: m.find("#pf-unit").value.trim() || null,
      costPrice: Number(m.find("#pf-cost").value) || 0,
      basePrice: Number(m.find("#pf-base").value) || 0,
      description: m.find("#pf-desc").value.trim() || null,
    };
    if (!body.sku || !body.name) { toast("Vui lòng nhập SKU và tên sản phẩm", "error"); return; }
    try {
      if (isNew) await api("/api/products", { method: "POST", body: JSON.stringify(body) });
      else await api(`/api/products/${id}`, { method: "PUT", body: JSON.stringify(body) });
      toast("Đã lưu", "success"); m.close();
      renderProducts(document.getElementById("main"));
    } catch (e) { toast(e.message, "error"); }
  });
}

// ---------------- Approval queue ----------------
async function renderApprovalQueue(el) {
  el.innerHTML = `<h1>Hàng chờ duyệt</h1><div id="aq-body">${skeleton(4)}</div>`;
  try {
    const r = await api("/api/approvals/queue");
    const body = document.getElementById("aq-body");
    if (!r.data.length) { body.innerHTML = "<div class='empty-state'>Không có báo giá chờ duyệt</div>"; return; }
    body.innerHTML = `<div class="tbl-scroll"><table class="list-table">
      <thead><tr><th scope="col">Mã dự án</th><th scope="col">Tiêu đề</th><th scope="col">Khách hàng</th>
        <th scope="col" style="text-align:right">Tổng tiền</th><th scope="col">Người tạo</th><th scope="col">Thao tác</th></tr></thead>
      <tbody>${r.data.map(a => `
        <tr>
          <td><strong>${escapeHtml(a.quote?.projectCode || a.quote?.quoteNumber)}</strong></td>
          <td>${escapeHtml(a.quote?.title || "")}</td>
          <td>${escapeHtml(a.quote?.toCompany || "")}</td>
          <td style="text-align:right">${fmtMoney(a.quote?.total)} đ</td>
          <td>${escapeHtml(a.quote?.createdBy?.displayName || "")}</td>
          <td style="white-space:nowrap">
            <button class="btn btn-sm" data-open="${a.quote?.id}">Xem</button>
            <button class="btn btn-sm btn-primary" data-approve="${a.quote?.id}">✓ Duyệt</button>
            ${can("quote:approve") ? `<button class="btn btn-sm btn-danger" data-reject="${a.quote?.id}">✗ Từ chối</button>` : ""}
          </td>
        </tr>`).join("")}</tbody></table></div>`;
    body.querySelectorAll("[data-open]").forEach(b => b.addEventListener("click", () => {
      goToQuote(b.dataset.open); // deep-link; routeFromHash fetches + renders, back returns here
    }));
    body.querySelectorAll("[data-approve]").forEach(b => b.addEventListener("click", async () => {
      const comment = await promptModal("Duyệt báo giá", "Ghi chú khi duyệt (không bắt buộc):", { placeholder: "VD: Đồng ý mức giá này" });
      if (comment === null) return;
      try { await api(`/api/quotes/${b.dataset.approve}/approve`, { method: "POST", body: JSON.stringify({ comment }) });
        toast("Đã duyệt", "success"); renderApprovalQueue(el);
      } catch (e) { toast(e.message, "error"); }
    }));
    body.querySelectorAll("[data-reject]").forEach(b => b.addEventListener("click", async () => {
      const comment = await promptModal("Từ chối báo giá", "Lý do từ chối (bắt buộc):", { required: true, min: 5, requiredMsg: "Vui lòng nhập lý do (ít nhất 5 ký tự)", placeholder: "VD: Giá cao hơn ngân sách, cần giảm 10%" });
      if (!comment) return;
      try { await api(`/api/quotes/${b.dataset.reject}/reject`, { method: "POST", body: JSON.stringify({ comment }) });
        toast("Đã từ chối", "success"); renderApprovalQueue(el);
      } catch (e) { toast(e.message, "error"); }
    }));
  } catch (e) { toast(e.message, "error"); }
}

// ---------------- Notifications ----------------
async function renderNotifications(el) {
  el.innerHTML = `<h1>Thông báo</h1>
    <div class="toolbar"><button class="btn" id="btn-read-all">Đánh dấu đã đọc tất cả</button></div>
    <div id="n-body">${skeleton(4)}</div>`;
  document.getElementById("btn-read-all").addEventListener("click", async () => {
    await api("/api/notifications/read-all", { method: "POST" });
    renderNotifications(el);
  });
  try {
    const r = await api("/api/notifications?size=50");
    const body = document.getElementById("n-body");
    if (!r.data.length) { body.innerHTML = "<div class='empty-state'>Không có thông báo</div>"; return; }
    body.innerHTML = r.data.map(n => `
      <div class="notif ${n.readAt ? "" : "unread"}" data-id="${n.id}" data-resource="${escapeHtml(n.resource || "")}" data-rid="${escapeHtml(n.resourceId || "")}" ${KBD}>
        <div class="notif-title">${escapeHtml(n.title)}</div>
        <div class="notif-body">${escapeHtml(n.body)}</div>
        <div class="notif-meta">${fmtDate(n.createdAt)} ${escapeHtml(n.resource || "")}</div>
      </div>`).join("");
    // Every notification is clickable: mark read (if unread) AND deep-link to the
    // referenced quote so the alert leads somewhere instead of dead-ending.
    body.querySelectorAll(".notif").forEach(d => d.addEventListener("click", async () => {
      if (d.classList.contains("unread")) {
        try { await api(`/api/notifications/${d.dataset.id}/read`, { method: "POST" }); } catch {}
        d.classList.remove("unread");
        refreshBadges();
      }
      if (d.dataset.resource === "quote" && d.dataset.rid) goToQuote(d.dataset.rid);
    }));
  } catch (e) { toast(e.message, "error"); }
}

// ---------------- Quản lý dự án (admin) ----------------
// GIAI ĐOẠN 1 (chỉ hiển thị): liệt kê báo giá ĐÃ DUYỆT theo bố cục bảng theo dõi dự
// án/hoá đơn. Báo giá NHIỀU SHEET được tách mỗi sheet thành 1 dòng: Mã Sản Xuất thêm
// hậu tố _1/_2… theo sheet, Hạng Mục = tên sheet, Báo Giá/Thành Tiền VAT theo từng
// sheet. Cột hoá đơn/thanh toán/chứng từ để "—" (Giai đoạn 2). Nguồn: /api/quotes/projects.
async function renderProjects(el) {
  // Ai cũng vào được: admin / người được ký xem TẤT CẢ; quản lý thường CHỈ XEM dự án của
  // mình (server đã lọc theo người tạo). canSignNow = được thao tác Ký; quản lý thường = chỉ xem.
  const canSignNow = can("user:manage") || !!state.user?.canSign;
  el.innerHTML = `<h1>Quản lý dự án</h1>
    <p class="muted">Dự án = báo giá <b>đã duyệt</b>. ${canSignNow ? "" : "<b>Bạn chỉ xem được dự án do mình tạo.</b> "}Báo giá nhiều sheet được tách mỗi sheet 1 dòng (Mã Sản Xuất thêm <b>_1, _2…</b>; Hạng Mục = tên sheet). Bấm vào dòng để mở báo giá.</p>
    <div id="proj-toolbar"></div>
    <div id="proj-summary"></div>
    <div id="proj-body">${skeleton(6)}</div>`;

  let quotes;
  try {
    const r = await api("/api/quotes/projects");
    quotes = (r && r.data) || [];
  } catch (e) {
    const b = document.getElementById("proj-body");
    if (b) b.innerHTML = errorState(e.message, () => renderProjects(el));
    return;
  }

  // Tách mỗi sheet thành 1 dòng. >1 sheet → Mã SX thêm _1/_2…; Hạng Mục = tên sheet.
  const allRows = [];
  for (const q of quotes) {
    const base = codeLabel(q);
    const sheets = (q.sheets && q.sheets.length) ? q.sheets : [{ name: null, subtotal: q.subtotal }];
    const multi = sheets.length > 1;
    sheets.forEach((sh, i) => {
      const baoGia = Number(sh.subtotal) || 0;
      const vat = Math.round((baoGia * (Number(q.vatPercent) || 0)) / 100);
      allRows.push({
        q,
        code: base + (multi ? `_${i + 1}` : ""),
        hangMuc: sh.name || (multi ? `Sheet ${i + 1}` : ""),
        baoGia,
        thanhTienVAT: baoGia + vat,
        hcm: Number(sh.hcm) || 0,
        hanoi: Number(sh.hanoi) || 0,
        khach: Number(sh.khach) || 0,
        cty: sh.cty || null,
        sheetId: sh.id || null,
        signedAt: sh.signedAt || null,
        signedByName: sh.signedByName || null,
      });
    });
  }

  // --- Bộ lọc: Account (người tạo) + Mã khách hàng + ô tìm kiếm tự do ---
  const accounts = [...new Set(quotes.map(q => q.createdBy?.displayName).filter(Boolean))].sort((a, b) => a.localeCompare(b, "vi"));
  const customers = [...new Set(quotes.map(q => q.customerCode).filter(Boolean))].sort((a, b) => a.localeCompare(b, "vi"));
  const flt = { q: "", account: "", customer: "" };
  const norm = (s) => (s == null ? "" : String(s)).toLowerCase();
  const matchRow = (r) => {
    if (flt.account && (r.q.createdBy?.displayName || "") !== flt.account) return false;
    if (flt.customer && (r.q.customerCode || "") !== flt.customer) return false;
    if (flt.q) {
      const hay = [r.q.title, r.code, r.hangMuc, r.q.customerCode, r.q.createdBy?.displayName].map(norm).join(" ");
      if (!hay.includes(norm(flt.q))) return false;
    }
    return true;
  };

  const stat = (label, val) => `<div class="card-section" style="flex:1;min-width:160px;padding:12px 16px">
      <div class="muted" style="font-size:12px">${label}</div>
      <div style="font-size:20px;font-weight:700;margin-top:3px">${val}</div></div>`;
  const dash = '<span class="muted">—</span>';
  const headers = ["Status", "Phim", "Hạng Mục", "Báo Giá", "Chi Phí HCM", "Báo Giá Hà Nội", "Phí Khách Hàng", "Mã Sản Xuất", "Ngày Thi Công", "Số PO/HĐ", "Cty Xuất Hoá Đơn", "Số Hoá Đơn", "Ngày Xuất Hoá Đơn", "Thành Tiền VAT", "Thanh Toán", "Chứng từ gửi đi", "Chứng từ trả về", "Link Hoá Đơn", "Số HĐ HN", "Team client", "Account", "Ký Chứng từ", "Check"];

  const renderSummary = (rows) => {
    const sumBaoGia = rows.reduce((s, r) => s + r.baoGia, 0);
    const sumVAT = rows.reduce((s, r) => s + r.thanhTienVAT, 0);
    const summ = document.getElementById("proj-summary");
    if (summ) summ.innerHTML = `<div style="display:flex;gap:12px;flex-wrap:wrap;margin:8px 0 16px">
      ${stat("Số dự án đã duyệt", new Set(rows.map(r => r.q.id)).size)}
      ${stat("Số dòng (theo sheet)", rows.length)}
      ${stat("Tổng Báo Giá (trước VAT)", fmtMoney(sumBaoGia))}
      ${stat("Tổng Thành Tiền VAT", fmtMoney(sumVAT))}</div>`;
  };

  const renderTable = (rows) => {
    const body = document.getElementById("proj-body");
    if (!body) return;
    if (!rows.length) {
      body.innerHTML = `<div class="empty-state">${allRows.length ? "Không có dự án khớp tìm kiếm/bộ lọc." : 'Chưa có báo giá nào ở trạng thái "Đã duyệt".'}</div>`;
      return;
    }
    body.innerHTML = `<div class="tbl-scroll"><table class="list-table proj-table">
      <thead><tr>${headers.map(h => `<th scope="col">${escapeHtml(h)}</th>`).join("")}</tr></thead>
      <tbody>${rows.map(r => {
        const q = r.q;
        const cty = q.company?.shortName || q.company?.name || "";
        const kyCell = r.signedAt
          ? `<td title="${escapeHtml((r.signedByName || "Đã ký") + " · " + fmtDate(r.signedAt))}"><span class="status approved">✓ Đã Ký</span>${canSignNow && r.sheetId ? ` <button class="ky-undo" data-sheet="${r.sheetId}" title="Bỏ ký">✕</button>` : ""}</td>`
          : (canSignNow && r.sheetId ? `<td><button class="btn btn-sm ky-btn" data-sheet="${r.sheetId}">Ký</button></td>` : `<td>${dash}</td>`);
        return `<tr class="qrow" data-id="${q.id}" title="Bấm để mở báo giá">
          <td><span class="status ${q.status}">${statusLabel(q.status)}</span></td>
          <td title="${escapeHtml(q.title)}"><strong>${escapeHtml(shortTitle(q.title))}</strong></td>
          <td>${r.hangMuc ? escapeHtml(r.hangMuc) : dash}</td>
          <td style="text-align:right">${fmtMoney(r.baoGia)}</td>
          <td style="text-align:right">${r.hcm ? fmtMoney(r.hcm) : dash}</td>
          <td style="text-align:right">${r.hanoi ? fmtMoney(r.hanoi) : dash}</td>
          <td style="text-align:right">${r.khach ? fmtMoney(r.khach) : dash}</td>
          <td><strong>${escapeHtml(r.code)}</strong></td>
          <td>${q.executionDate ? fmtDate(q.executionDate) : dash}</td><td>${dash}</td>
          <td>${(r.cty || cty) ? escapeHtml(r.cty || cty) : dash}</td>
          <td>${dash}</td><td>${dash}</td>
          <td style="text-align:right">${fmtMoney(r.thanhTienVAT)}</td>
          <td>${dash}</td><td>${dash}</td><td>${dash}</td><td>${dash}</td><td>${dash}</td>
          <td>${q.customerCode ? escapeHtml(q.customerCode) : dash}</td><td>${q.createdBy?.displayName ? escapeHtml(q.createdBy.displayName) : dash}</td>${kyCell}<td>${dash}</td>
        </tr>`;
      }).join("")}</tbody>
    </table></div>`;
    body.querySelectorAll("tr.qrow").forEach(tr => {
      tr.addEventListener("click", (e) => { if (e.target.closest("button,a")) return; goToQuote(parseInt(tr.dataset.id, 10)); });
    });
    body.querySelectorAll(".ky-btn, .ky-undo").forEach(b => b.addEventListener("click", async (e) => {
      e.stopPropagation();
      const sheetId = b.dataset.sheet;
      const signed = b.classList.contains("ky-btn");   // ky-btn = ký; ky-undo = bỏ ký
      try {
        await api(`/api/quotes/sheets/${sheetId}/sign`, { method: "POST", body: JSON.stringify({ signed }) });
        toast(signed ? "Đã ký chứng từ" : "Đã bỏ ký", "success");
        renderProjects(el);
      } catch (err) { toast(err.message, "error"); }
    }));
  };

  const refresh = () => { const rows = allRows.filter(matchRow); renderSummary(rows); renderTable(rows); };

  // Thanh tìm kiếm + bộ lọc
  const tb = document.getElementById("proj-toolbar");
  if (tb) {
    tb.innerHTML = `<div class="toolbar" style="margin:4px 0 6px">
      <label for="proj-search" class="sr-only">Tìm kiếm dự án</label>
      <input id="proj-search" type="search" placeholder="Tìm: phim, mã sản xuất, khách hàng, account…" style="min-width:220px;flex:1" />
      <label for="proj-f-account" class="sr-only">Lọc theo Account</label>
      <select id="proj-f-account"><option value="">Account: Tất cả</option>${accounts.map(a => `<option value="${escapeHtml(a)}">${escapeHtml(a)}</option>`).join("")}</select>
      <label for="proj-f-customer" class="sr-only">Lọc theo Mã khách hàng</label>
      <select id="proj-f-customer"><option value="">Mã KH: Tất cả</option>${customers.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("")}</select>
      <button id="proj-clear" class="btn btn-sm btn-ghost" type="button">Xóa lọc</button>
    </div>`;
    const si = tb.querySelector("#proj-search"), fa = tb.querySelector("#proj-f-account"), fc = tb.querySelector("#proj-f-customer");
    si.addEventListener("input", (e) => { flt.q = e.target.value; refresh(); });
    fa.addEventListener("change", (e) => { flt.account = e.target.value; refresh(); });
    fc.addEventListener("change", (e) => { flt.customer = e.target.value; refresh(); });
    tb.querySelector("#proj-clear").addEventListener("click", () => { flt.q = flt.account = flt.customer = ""; si.value = ""; fa.value = ""; fc.value = ""; refresh(); });
  }
  refresh();
}

// ---------------- Audit log (admin) ----------------
async function renderAuditLog(el) {
  const actionOpts = Object.entries(ACTION_LABEL).map(([k, v]) => `<option value="${k}">${escapeHtml(v)}</option>`).join("");
  const resOpts = Object.entries(RESOURCE_LABEL).map(([k, v]) => `<option value="${k}">${escapeHtml(v)}</option>`).join("");
  el.innerHTML = `<h1>Nhật ký hoạt động</h1>
    <p class="muted">Lịch sử ai đã làm gì trong hệ thống.</p>
    <div class="toolbar">
      <label for="a-action" class="sr-only">Lọc theo hoạt động</label>
      <select id="a-action"><option value="">Tất cả hoạt động</option>${actionOpts}</select>
      <label for="a-resource" class="sr-only">Lọc theo đối tượng</label>
      <select id="a-resource"><option value="">Tất cả đối tượng</option>${resOpts}</select>
    </div>
    <div id="a-body">${skeleton(6)}</div>`;
  const reload = async () => {
    const params = new URLSearchParams();
    const av = document.getElementById("a-action").value;
    const rv = document.getElementById("a-resource").value;
    if (av) params.set("action", av);
    if (rv) params.set("resource", rv);
    params.set("size", "100");
    try {
      const r = await api("/api/audit?" + params);
      const body = document.getElementById("a-body");
      if (!r.data.length) { body.innerHTML = "<div class='empty-state'>Chưa có hoạt động nào</div>"; return; }
      body.innerHTML = `<div class="tbl-scroll"><table class="list-table">
        <thead><tr><th scope="col">Thời gian</th><th scope="col">Người thực hiện</th><th scope="col">Hoạt động</th><th scope="col">Đối tượng</th></tr></thead>
        <tbody>${r.data.map(e => `
          <tr>
            <td>${new Date(e.createdAt).toLocaleString("vi-VN")}</td>
            <td>${escapeHtml(e.actor?.displayName || e.actor?.username || "Hệ thống")}</td>
            <td>${escapeHtml(actionLabel(e.action))}</td>
            <td>${escapeHtml(resourceLabel(e.resource))}${e.resourceId ? " #" + escapeHtml(e.resourceId) : ""}</td>
          </tr>`).join("")}</tbody></table></div>`;
    } catch (e) { toast(e.message, "error"); }
  };
  document.getElementById("a-action").addEventListener("change", reload);
  document.getElementById("a-resource").addEventListener("change", reload);
  await reload();
}


// ---------------- Modal helper ----------------
let _modalSeq = 0;
function openModal(title, bodyHtml) {
  const titleId = `modal-title-${++_modalSeq}`;
  const d = document.createElement("div");
  d.className = "modal-backdrop";
  d.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="${titleId}">
    <div class="modal-head"><h3 id="${titleId}">${escapeHtml(title)}</h3><button class="modal-x" aria-label="Đóng">×</button></div>
    <div class="modal-body">${bodyHtml}</div>
    <div class="modal-foot">
      <button class="btn" data-cancel>Hủy</button>
      <button class="btn btn-primary" data-save>Lưu</button>
    </div>
  </div>`;
  document.body.appendChild(d);
  const prevFocus = document.activeElement; // restore focus on close (a11y)
  const closeHandlers = [];
  let saved = false;
  const close = () => {
    d.remove();
    document.removeEventListener("keydown", onKey);
    if (prevFocus && prevFocus.focus) try { prevFocus.focus(); } catch (e) {}
    closeHandlers.forEach((cb) => cb(saved));
  };
  // Focus trap: keep Tab within the dialog.
  const focusables = () => Array.from(d.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'));
  const onKey = (e) => {
    if (e.key === "Escape") { close(); return; }
    if (e.key !== "Tab") return;
    const f = focusables(); if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  document.addEventListener("keydown", onKey);
  d.querySelector(".modal-x").addEventListener("click", close);
  d.querySelector("[data-cancel]").addEventListener("click", close);
  // focus the first field for keyboard users
  setTimeout(() => d.querySelector("input,select,textarea,button")?.focus(), 30);
  return {
    find: (sel) => d.querySelector(sel),
    close: () => { saved = true; close(); }, // programmatic close = a save/confirm
    onSave: (cb) => d.querySelector("[data-save]").addEventListener("click", cb),
    onClose: (cb) => closeHandlers.push(cb),
  };
}

/** Styled replacement for window.prompt — returns the entered text, or null if cancelled. */
function promptModal(title, label, opts = {}) {
  return new Promise((resolve) => {
    let resolved = false;
    // opts.type (e.g. "password") renders a single-line input that masks/keeps the
    // value on one line; otherwise a multi-line textarea (default).
    const field = opts.type
      ? `<input id="pm-input" type="${escapeHtml(opts.type)}" placeholder="${escapeHtml(opts.placeholder || "")}" style="width:100%;margin-top:6px"/>`
      : `<textarea id="pm-input" rows="3" placeholder="${escapeHtml(opts.placeholder || "")}" style="width:100%;margin-top:6px"></textarea>`;
    const m = openModal(title, `<label style="display:block">${escapeHtml(label)}
      ${field}</label>`);
    m.onSave(() => {
      const v = (m.find("#pm-input").value || "").trim();
      if (opts.required && v.length < (opts.min || 1)) { toast(opts.requiredMsg || "Vui lòng nhập nội dung", "error"); return; }
      resolved = true; resolve(v); m.close();
    });
    m.onClose((wasSaved) => { if (!resolved) resolve(wasSaved ? "" : null); });
  });
}

/** Styled yes/no confirmation (replaces window.confirm). Returns true if confirmed. */
function confirmModal(title, message, opts = {}) {
  return new Promise((resolve) => {
    let done = false;
    const m = openModal(title, `<p style="margin:0;line-height:1.55">${escapeHtml(message)}</p>`);
    const saveBtn = m.find("[data-save]");
    if (saveBtn) {
      saveBtn.textContent = opts.confirmText || "Xác nhận";
      if (opts.danger) { saveBtn.classList.remove("btn-primary"); saveBtn.classList.add("btn-danger"); }
    }
    const cancelBtn = m.find("[data-cancel]");
    if (cancelBtn) cancelBtn.textContent = opts.cancelText || "Hủy";
    m.onSave(() => { done = true; resolve(true); m.close(); });
    m.onClose(() => { if (!done) resolve(false); });
  });
}

// ---------------- Permissions (Phân quyền) ----------------
async function renderPermissions(el) {
  el.innerHTML = `<h1>Phân quyền</h1>
    <p class="muted">Vai trò → khả năng (cấu hình cố định, an toàn). Bên dưới: gán vai trò cho từng nhân viên.</p>
    <div id="perm-matrix-wrap">${skeleton(6)}</div>
    <h3 style="margin-top:26px">Gán vai trò nhân viên</h3>
    <div id="perm-users">${skeleton(4)}</div>`;
  try {
    const cat = await api("/api/permissions/catalog");
    const roles = cat.roles;
    const rolePerms = Object.fromEntries(roles.map(r => [r.key, new Set(r.permissions)]));
    const rows = cat.groups.map(g => `
      <tr class="perm-group-row"><td colspan="${roles.length + 1}">${escapeHtml(g.label)}</td></tr>
      ${g.perms.map(p => `
        <tr>
          <td class="col-perm">${escapeHtml(p.label)} <span class="muted">${escapeHtml(p.key)}</span></td>
          ${roles.map(r => `<td class="col-role">${rolePerms[r.key].has(p.key) ? '<span class="perm-yes">✓</span>' : '<span class="perm-no">–</span>'}</td>`).join("")}
        </tr>`).join("")}`).join("");
    document.getElementById("perm-matrix-wrap").innerHTML = `
      <table class="perm-matrix">
        <thead><tr><th scope="col">Quyền</th>${roles.map(r => `<th scope="col"><div class="role-head"><span>${escapeHtml(r.label)}</span><span class="rh-pill">${escapeHtml(r.key)}</span></div></th>`).join("")}</tr></thead>
        <tbody>${rows}</tbody>
      </table>`;

    // User → role assignment
    const users = await api("/api/users");
    const roleOptions = roles.map(r => ({ key: r.key, label: r.label }));
    document.getElementById("perm-users").innerHTML = `
      <table class="list-table">
        <thead><tr><th scope="col">Nhân viên</th><th scope="col">Username</th><th scope="col">Vai trò</th><th scope="col">Trạng thái</th></tr></thead>
        <tbody>${users.map(u => `
          <tr>
            <td>${escapeHtml(u.displayName)}</td>
            <td>${escapeHtml(u.username)}</td>
            <td>
              <select data-role-user="${u.id}" ${u.id === state.user.id ? "disabled title='Không thể đổi vai trò của chính bạn'" : ""}>
                ${roleOptions.map(o => `<option value="${o.key}" ${o.key === u.role ? "selected" : ""}>${escapeHtml(o.label)}</option>`).join("")}
              </select>
            </td>
            <td>${u.active ? '<span class="status approved">Hoạt động</span>' : '<span class="status rejected">Khóa</span>'}</td>
          </tr>`).join("")}</tbody>
      </table>`;
    document.querySelectorAll("[data-role-user]").forEach(sel => sel.addEventListener("change", async () => {
      const id = sel.dataset.roleUser;
      try {
        await api(`/api/users/${id}`, { method: "PUT", body: JSON.stringify({ role: sel.value }) });
        toast("Đã cập nhật vai trò", "success");
      } catch (e) { toast(e.message, "error"); renderPermissions(el); }
    }));
  } catch (e) { toast(e.message, "error"); }
}

boot();
