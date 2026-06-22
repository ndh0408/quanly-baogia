// SPA quản lý báo giá - multi-sheet, multi-template
import {
  escapeHtml, statusLabel, ROLE_LABEL,
} from "./js/util.js?v=20260622r";
// Shared state + state-core helpers (step 2): `state` is a live-binding singleton —
// mutate `state.foo`, never reassign `state`. can/landingPage gate UI only.
import {
  state, can, landingPage,
} from "./js/core/state.js?v=20260622r";
// api(): single fetch wrapper (step 3). 401-while-logged-in bounces to login via the
// injected handler wired just below (render is a hoisted declaration, safe to reference).
import { api, setUnauthorizedHandler } from "./js/core/api.js?v=20260622r";
// UI primitives (step 4): toasts, modals, theme, keyboard activation, inline field errors.
import {
  toast, KBD, installKeyActivation, applyFieldErrors,
  initTheme, toggleTheme, promptModal, confirmModal,
} from "./js/ui.js?v=20260622r";
// 10 standalone admin pages (step 6). They live in their own module; the 5 shell/nav
// helpers they need from here are injected via setAdminDeps (no circular import).
import {
  setAdminDeps, renderUsers, renderProfile, renderDashboard, renderCustomers,
  renderNotifications, renderProjects, renderAuditLog, renderPermissions,
} from "./js/pages/admin.js?v=20260622r";
// Quote list + new-quote wizard + Account-HN (step 7). Editor/shell helpers injected below.
import {
  setQuoteDeps, renderList, renderNewQuote, renderAccountHnView, renderManagerHnPanel,
} from "./js/pages/quotes.js?v=20260622r";
// Editor + spreadsheet grid (step 8). drawItems & co. are re-exported here so the existing
// setQuoteDeps call keeps feeding them to quotes.js; shell helpers injected via setEditorDeps.
import {
  setEditorDeps, renderEditor, drawItems, gridHeadHtml, newExtraGrid, extraTableSumLocal,
} from "./js/editor.js?v=20260622r";

const app = document.getElementById("app");
setUnauthorizedHandler(() => render());
setAdminDeps({ goToQuote, renderShell, refreshBadges, shortTitle, codeLabel });
setQuoteDeps({ render, goToQuote, codeLabel, shortTitle, drawItems, gridHeadHtml, newExtraGrid, extraTableSumLocal });
setEditorDeps({ render, leaveEditorGuard, codeLabel, renderManagerHnPanel });

// toast / skeleton / KBD / installKeyActivation → moved to ./js/ui.js (step 4)

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

// errorState → moved to ./js/ui.js (step 4)

// Navigate to a quote via the hash router so Back/F5/bookmark/deep-links work.
export function goToQuote(id) { location.hash = "#/quotes/" + id; }

// applyFieldErrors → moved to ./js/ui.js (step 4)

// Pure format/label/preview helpers + groupLetter -> moved to ./js/util.js (imported at top).

// initTheme / toggleTheme → moved to ./js/ui.js (step 4)

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

const ROUTE_PAGES = ["dashboard", "list", "new", "customers", "notifications", "projects", "users", "permissions", "audit", "profile"];

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
  let target = ROUTE_PAGES.includes(h) ? h : "list";
  // Trang chỉ dành cho người tạo/quản lý báo giá — account_hn (chỉ điền HN, không thấy
  // tiền/khách) vào sẽ trống/lỗi 403, nên đẩy về danh sách.
  if (!can("quote:create") && (target === "dashboard" || target === "projects" || target === "new")) target = "list";
  state.page = target;
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
export function renderShell() {
  // Any non-editor page clears the unsaved flag (covers browser-back out of editor).
  if (state.page !== "edit") window._editorDirty = false;
  // CHẾ ĐỘ NHÚNG: app React mới (/) nhúng các trang chưa port qua iframe /app?embed=1 →
  // ẩn sidebar/topbar của app cũ, chỉ render nội dung (#main) để không bị 2 sidebar.
  if (new URLSearchParams(location.search).get("embed") === "1") {
    document.body.classList.add("embedded");
    app.innerHTML = `<main class="main main-embed" id="main" tabindex="-1"></main>`;
    renderMain(); // render nội dung trang vào #main (bỏ qua sidebar/topbar)
    return;
  }
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
          ${can("quote:create") ? nav("dashboard", NAV_ICON.dashboard + "<span>Tổng quan</span>") : ""}
          ${nav("list", NAV_ICON.list + "<span>Danh sách báo giá</span>")}
          ${can("quote:create") ? nav("new", NAV_ICON.new + "<span>Tạo báo giá mới</span>") : ""}
          ${can("customer:read:own") ? nav("customers", NAV_ICON.customers + "<span>Mã khách hàng</span>") : ""}
          ${nav("notifications", NAV_ICON.notifications + "<span>Thông báo</span>", ` <span id="badge-notif" class="badge-num" aria-live="polite"></span>`)}
          ${(can("user:manage") || can("audit:view")) ? `<div class="nav-group-label" role="presentation">Quản trị</div>` : ""}
          ${can("quote:create") ? nav("projects", NAV_ICON.projects + "<span>Quản lý dự án</span>") : ""}
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
  else if (state.page === "notifications") renderNotifications(mainEl);
  else if (state.page === "audit") renderAuditLog(mainEl);
  else if (state.page === "permissions") renderPermissions(mainEl);
  else if (state.page === "projects") renderProjects(mainEl);
}

// Decide whether the current page cares about this change, then refresh it.
function onRealtimeChange(d) {
  refreshBadges();
  const PAGES_FOR = {
    quote: ["list", "dashboard", "notifications"],
    customer: ["customers"],
    user: ["users"],
  };
  const pages = PAGES_FOR[d.entity] || ["list", "dashboard", "customers", "users", "notifications"];
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

export async function refreshBadges() {
  try {
    const n = await api("/api/notifications/unread-count");
    const badge = document.getElementById("badge-notif");
    if (badge) badge.textContent = n.count > 0 ? n.count : "";
  } catch {}
}

// ---------------- List ----------------
// Hide the boilerplate "BẢNG BÁO GIÁ" prefix in the LIST only — the stored title
// (editor + Excel/PDF export) keeps the full text.
export function shortTitle(t) {
  const s = String(t || "");
  const r = s.replace(/^\s*bảng\s+báo\s+giá\s*[-–—:|·]*\s*/i, "").trim();
  return r || s;
}
// Mã dự án + nhãn phiên bản (v2/v3…) cho các bản nhân bản cùng mã dự án.
export function codeLabel(q) {
  const c = q.projectCode || q.quoteNumber || "";
  return (q.projectVersion && q.projectVersion > 1) ? `${c}_v${q.projectVersion}` : c;
}

// Quote LIST + new-quote WIZARD + Account-HN screens (renderList/canDelete/listAction/
// stepper/WIZARD_STEPS/renderNewQuote/blankHnItem/defaultHnTemplateId/saveHnPart/
// renderAccountHnView/renderManagerHnPanel) → moved to ./js/pages/quotes.js (step 7).
// They receive the editor/shell helpers via setQuoteDeps (wired near the top).
// Editor + spreadsheet grid (renderEditor/drawItems/bindActions/drawExtraTables/formula ƒ/
// modals/summary + FORMULA_FNS/EXTRA_CATS) → moved to ./js/editor.js (step 8). It receives
// render/leaveEditorGuard/codeLabel/renderManagerHnPanel via setEditorDeps (wired near the top).

// Live xlsx-faithful preview (refreshPreview/renderPreview/previewCLF/previewGN/
// previewSummary/pvCompanyBanner) → moved to ./js/preview.js (step 5)
// 10 admin pages (users/profile/dashboard/customers/products/approvals/notifications/
// projects/audit/permissions) → moved to ./js/pages/admin.js (step 6)

boot();
