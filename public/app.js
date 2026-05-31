// SPA quản lý báo giá - multi-sheet, multi-template
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
  if (res.status === 401) {
    state.user = null;
    render();
    throw new Error("Chưa đăng nhập");
  }
  let body;
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) body = await res.json();
  else body = await res.text();
  if (!res.ok) throw new Error((body && body.error) || body || "Lỗi");
  return body;
}

function toast(msg, type = "info") {
  const t = document.createElement("div");
  t.className = "toast " + type;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2400);
}

// Skeleton loader markup — used while data is being fetched.
function skeleton(rows = 5, tall = false) {
  return `<div class="skeleton">${Array.from({ length: rows })
    .map(() => `<div class="sk-line${tall ? " tall" : ""}"></div>`).join("")}</div>`;
}

function fmtMoney(n) {
  if (n == null || isNaN(n)) return "0";
  return Number(n).toLocaleString("vi-VN");
}
function fmtDate(d) {
  if (!d) return "";
  const dt = new Date(d);
  return `${String(dt.getDate()).padStart(2, "0")}/${String(dt.getMonth() + 1).padStart(2, "0")}/${dt.getFullYear()}`;
}
function vnDateText(d, city) {
  const dt = d instanceof Date ? d : new Date(d);
  return `${city || "TP. Hồ Chí Minh"}, ngày ${String(dt.getDate()).padStart(2, "0")} tháng ${String(dt.getMonth() + 1).padStart(2, "0")} năm ${dt.getFullYear()}`;
}
function escapeHtml(s) {
  if (s == null) return "";
  return String(s).replace(/[&<>"']/g, ch =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

const STATUS_LABEL = { draft: "Nháp", pending: "Chờ duyệt", approved: "Đã duyệt", rejected: "Bị từ chối" };
const ROLE_LABEL = { admin: "Quản trị", manager: "Quản lý", employee: "Nhân viên" };

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

async function boot() {
  initTheme();
  try {
    const me = await api("/api/auth/me");
    state.user = me;
    await loadMeta();
  } catch {
    state.user = null;
  }
  render();
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
  if (!state.user) {
    if (state._sse) { try { state._sse.close(); } catch {} state._sse = null; }
    return renderLogin();
  }
  startSSE();
  renderShell();
}

// ---------------- Login ----------------
function renderLogin() {
  app.innerHTML = `
    <div class="login-wrap">
      <div class="login-card">
        <h1>Quản Lý Báo Giá</h1>
        <p class="sub">Gia Nguyễn — Hệ thống nội bộ</p>
        <div id="login-err"></div>
        <form id="login-form">
          <label><span>Tên đăng nhập</span><input name="username" autocomplete="username" required /></label>
          <label><span>Mật khẩu</span><input type="password" name="password" autocomplete="current-password" required /></label>
          <button type="submit" class="btn-login">Đăng nhập</button>
        </form>
      </div>
    </div>`;
  document.getElementById("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const errEl = document.getElementById("login-err");
    errEl.innerHTML = "";
    try {
      const me = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username: fd.get("username"), password: fd.get("password") }),
      });
      state.user = me;
      state.page = "list";
      await loadMeta();
      render();
    } catch (err) {
      errEl.innerHTML = `<div class="err">${err.message}</div>`;
    }
  });
}

// ---------------- Shell ----------------
function renderShell() {
  const role = state.user.role;
  const themeIcon = (localStorage.getItem("theme") === "dark") ? "☀️" : "🌙";
  app.innerHTML = `
    <div class="shell">
      <div class="mobile-topbar">
        <button class="icon-btn" id="sb-toggle" aria-label="Mở menu">☰</button>
        <span class="mt-title">Báo Giá</span>
        <button class="icon-btn" id="theme-toggle-m" aria-label="Đổi giao diện">${themeIcon}</button>
      </div>
      <div class="sidebar-backdrop" id="sb-backdrop"></div>
      <aside class="sidebar" id="sidebar">
        <div class="sb-head">
          <div class="sb-brand">
            <div class="sb-logo">GN</div>
            <div>
              <h2>Báo Giá</h2>
              <div class="org">Gia Nguyễn · nội bộ</div>
            </div>
          </div>
          <button class="icon-btn" id="theme-toggle" title="Đổi giao diện sáng/tối">${themeIcon}</button>
        </div>
        <div class="global-search">
          <input id="gs-input" placeholder="🔎 Tìm nhanh (Ctrl+K)" />
          <div id="gs-results" class="global-search-results" style="display:none"></div>
        </div>
        <nav class="menu">
          <a href="#" data-page="dashboard" class="${state.page === "dashboard" ? "active" : ""}">📊 Dashboard</a>
          <a href="#" data-page="list" class="${state.page === "list" ? "active" : ""}">📋 Danh sách báo giá</a>
          <a href="#" data-page="new" class="${state.page === "new" ? "active" : ""}">➕ Tạo báo giá mới</a>
          <a href="#" data-page="notifications" class="${state.page === "notifications" ? "active" : ""}">🔔 Thông báo <span id="badge-notif" class="badge-num"></span></a>
          ${can("user:manage") ? `<a href="#" data-page="users" class="${state.page === "users" ? "active" : ""}">👥 Quản lý nhân viên</a>` : ""}
          ${can("user:manage") ? `<a href="#" data-page="permissions" class="${state.page === "permissions" ? "active" : ""}">🛡️ Phân quyền</a>` : ""}
          ${can("audit:view") ? `<a href="#" data-page="audit" class="${state.page === "audit" ? "active" : ""}">📜 Audit log</a>` : ""}
          <a href="#" data-page="profile" class="${state.page === "profile" ? "active" : ""}">🔒 Tài khoản</a>
        </nav>
        <div class="who">
          <strong>${escapeHtml(state.user.displayName)}</strong>
          <span>@${escapeHtml(state.user.username)}</span><br/>
          <span class="role-pill">${ROLE_LABEL[role]}</span>
          <button class="logout">Đăng xuất</button>
        </div>
      </aside>
      <main class="main" id="main"></main>
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
  const openSidebar = () => { sidebar.classList.add("open"); backdrop.classList.add("show"); };
  const closeSidebar = () => { sidebar.classList.remove("open"); backdrop.classList.remove("show"); };
  document.getElementById("sb-toggle")?.addEventListener("click", openSidebar);
  backdrop?.addEventListener("click", closeSidebar);

  document.querySelectorAll("[data-page]").forEach(a => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      state.page = a.dataset.page;
      state.currentQuote = null;
      closeSidebar();
      render();
    });
  });
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
            ${r.results.quotes.map(q => `<div class="gs-row" data-go="quote" data-id="${q.id}">
              <strong>${escapeHtml(q.quoteNumber)}</strong> — ${escapeHtml(q.title)} <span class="status ${q.status}">${q.status}</span>
            </div>`).join("")}`);
          gsResults.innerHTML = sections.join("") || "<div class='gs-section'>Không có kết quả</div>";
          gsResults.style.display = "block";
          gsResults.querySelectorAll(".gs-row").forEach(row => row.addEventListener("click", async () => {
            const id = row.dataset.id;
            if (row.dataset.go === "quote" && id) {
              const q = await api(`/api/quotes/${id}`);
              state.currentQuote = q; state.page = "edit"; render();
            }
            gsInput.value = "";
            gsResults.style.display = "none";
          }));
        } catch {}
      }, 200);
    });
    document.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") { e.preventDefault(); gsInput.focus(); gsInput.select(); }
      else if (e.key === "Escape") { gsResults.style.display = "none"; gsInput.value = ""; }
    });
    document.addEventListener("click", (e) => {
      if (!gsResults.contains(e.target) && e.target !== gsInput) gsResults.style.display = "none";
    });
  }

  document.querySelector(".logout").addEventListener("click", async () => {
    await api("/api/auth/logout", { method: "POST" });
    state.user = null;
    render();
  });

  const mainEl = document.getElementById("main");
  if (state.page === "list") renderList(mainEl);
  else if (state.page === "new") renderNewQuote(mainEl);
  else if (state.page === "edit") renderEditor(mainEl, state.currentQuote);
  else if (state.page === "users") renderUsers(mainEl);
  else if (state.page === "profile") renderProfile(mainEl);
  else if (state.page === "dashboard") renderDashboard(mainEl);
  else if (state.page === "customers") renderCustomers(mainEl);
  else if (state.page === "products") renderProducts(mainEl);
  else if (state.page === "approvals") renderApprovalQueue(mainEl);
  else if (state.page === "notifications") renderNotifications(mainEl);
  else if (state.page === "audit") renderAuditLog(mainEl);
  else if (state.page === "permissions") renderPermissions(mainEl);
  else if (state.page === "settings") renderSettings(mainEl);

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
      } catch {}
    });
    es.onerror = () => { /* retry handled by browser */ };
    state._sse = es;
  } catch (e) {
    console.warn("SSE failed", e);
  }
}

async function refreshBadges() {
  try {
    const n = await api("/api/notifications/unread-count");
    const badge = document.getElementById("badge-notif");
    if (badge) badge.textContent = n.count > 0 ? n.count : "";
  } catch {}
}

// ---------------- List ----------------
async function renderList(el) {
  el.innerHTML = `<h1>Danh sách báo giá</h1>
    <div class="toolbar">
      <input id="filter-q" placeholder="Tìm theo số, tiêu đề, khách..." value="${state.filter.q}" />
      <select id="filter-status">
        <option value="">— Tất cả trạng thái —</option>
        <option value="draft">Nháp</option>
        <option value="pending">Chờ duyệt</option>
        <option value="approved">Đã duyệt</option>
        <option value="rejected">Bị từ chối</option>
      </select>
      <button class="btn" id="btn-reload">🔄 Tải lại</button>
      <button class="btn btn-primary" id="btn-new">+ Tạo báo giá</button>
    </div>
    <div id="list-body">${skeleton(6)}</div>`;
  document.getElementById("filter-status").value = state.filter.status;

  const reload = async () => {
    const params = new URLSearchParams();
    if (state.filter.q) params.set("q", state.filter.q);
    if (state.filter.status) params.set("status", state.filter.status);
    try {
      const r = await api("/api/quotes?" + params.toString());
      state.quoteList = Array.isArray(r) ? r : (r.data || []);
      drawList();
    } catch (e) { toast(e.message, "error"); }
  };

  document.getElementById("filter-q").addEventListener("input", (e) => {
    state.filter.q = e.target.value;
    clearTimeout(window._fto);
    window._fto = setTimeout(reload, 300);
  });
  document.getElementById("filter-status").addEventListener("change", (e) => {
    state.filter.status = e.target.value;
    reload();
  });
  document.getElementById("btn-reload").addEventListener("click", reload);
  document.getElementById("btn-new").addEventListener("click", () => {
    state.page = "new";
    render();
  });

  function drawList() {
    const body = document.getElementById("list-body");
    if (!state.quoteList.length) {
      body.innerHTML = `<div class="empty-state">Chưa có báo giá nào.</div>`;
      return;
    }
    body.innerHTML = `
      <table class="list-table">
        <thead>
          <tr>
            <th>Số BG</th><th>Tiêu đề</th><th>Công ty</th><th>Khách</th>
            <th>Sheet</th><th>Ngày</th><th style="text-align:right">Tổng (VNĐ)</th>
            <th>Trạng thái</th><th>Thao tác</th>
          </tr>
        </thead>
        <tbody>
          ${state.quoteList.map(q => `
            <tr>
              <td><strong>${escapeHtml(q.quoteNumber)}</strong></td>
              <td>${escapeHtml(q.title)}</td>
              <td>${escapeHtml(q.company?.shortName || q.company?.name || "")}</td>
              <td>${escapeHtml(q.toCompany)}</td>
              <td style="text-align:center">${q.sheets?.length || 0}</td>
              <td>${fmtDate(q.quoteDate)}</td>
              <td style="text-align:right">${fmtMoney(q.total)}</td>
              <td><span class="status ${q.status}">${STATUS_LABEL[q.status]}</span></td>
              <td>
                <button class="btn btn-sm" data-act="open" data-id="${q.id}">Mở</button>
                <button class="btn btn-sm" data-act="excel" data-id="${q.id}">📥 Excel</button>
                <button class="btn btn-sm" data-act="dup" data-id="${q.id}">Nhân bản</button>
                ${canDelete(q) ? `<button class="btn btn-sm btn-danger" data-act="del" data-id="${q.id}">Xóa</button>` : ""}
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>`;
    body.querySelectorAll("button[data-act]").forEach(b => {
      b.addEventListener("click", () => listAction(b.dataset.act, parseInt(b.dataset.id, 10)));
    });
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
      const q = await api(`/api/quotes/${id}`);
      state.currentQuote = q;
      state.page = "edit";
      render();
    } else if (act === "excel") {
      window.open(`/api/export/${id}.xlsx`, "_blank");
    } else if (act === "dup") {
      const q = await api(`/api/quotes/${id}/duplicate`, { method: "POST" });
      state.currentQuote = q;
      state.page = "edit";
      toast("Đã nhân bản. Bạn đang sửa bản mới.", "success");
      render();
    } else if (act === "del") {
      if (!confirm("Xóa báo giá?")) return;
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
    const cls = n < current ? "done" : n === current ? "active" : "";
    const dot = `<div class="step-dot ${cls}"><div class="num">${n < current ? "✓" : n}</div><div class="lbl">${escapeHtml(s)}</div></div>`;
    const line = i < steps.length - 1 ? `<div class="step-line ${n < current ? "done" : ""}"></div>` : "";
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
      info: {
        title: "", toCompany: "", toContact: "",
        fromContact: state.user.displayName || "", fromPhone: state.user.phone || "",
        fromTitle: state.user.title || "", fromAddress: "", city: "TP. Hồ Chí Minh",
        quoteDate: new Date().toISOString().slice(0, 10), vatPercent: 8, customerLogo: null,
      },
    };
  }
  const wz = state._wizard;
  const company = state.companies.find(c => c.id === wz.companyId);
  const templates = company?.templates || [];

  let body = "";
  if (wz.step === 1) {
    body = `
      <h2>Chọn công ty phát hành</h2>
      <p class="hint">Báo giá sẽ dùng letterhead / mẫu của công ty này.</p>
      <div class="pick-grid">
        ${state.companies.map(c => `
          <div class="pick-card ${c.id === wz.companyId ? "selected" : ""}" data-company="${c.id}">
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
          <div class="pick-card ${wz.templateIds.includes(t.id) ? "selected" : ""}" data-template="${t.id}">
            <div class="pc-title">${escapeHtml(t.name)}</div>
            <div class="pc-sub">${escapeHtml(t.code)}</div>
            <div class="pc-check">✓</div>
          </div>`).join("")}
      </div>
      ${wz.templateIds.length ? `<div class="sheet-chips">${wz.templateIds.map((id, i) => {
        const t = templates.find(x => x.id === id);
        return `<span class="sheet-chip">${i + 1}. ${escapeHtml(t?.name || "")} <span class="x" data-rm="${id}">✕</span></span>`;
      }).join("")}</div>` : ""}`;
  } else if (wz.step === 3) {
    const i = wz.info;
    body = `
      <h2>Thông tin báo giá</h2>
      <p class="hint">Khách hàng, người gửi, VAT, ngày — và logo khách (chèn vào mẫu CLF).</p>
      <div class="form-grid">
        <label style="grid-column:1/-1">Tiêu đề báo giá <span class="req">*</span>
          <input id="w-title" value="${escapeHtml(i.title)}" placeholder="VD: Décor Premiere Phim Thỏ Ơi"/></label>
        <label>Khách hàng (To) <span class="req">*</span><input id="w-toCompany" value="${escapeHtml(i.toCompany)}"/></label>
        <label>Người liên hệ KH<input id="w-toContact" value="${escapeHtml(i.toContact)}"/></label>
        <label>Người gửi (From)<input id="w-fromContact" value="${escapeHtml(i.fromContact)}"/></label>
        <label>Chức danh<input id="w-fromTitle" value="${escapeHtml(i.fromTitle)}"/></label>
        <label>SĐT người gửi<input id="w-fromPhone" value="${escapeHtml(i.fromPhone)}"/></label>
        <label>Địa chỉ<input id="w-fromAddress" value="${escapeHtml(i.fromAddress)}"/></label>
        <label>VAT (%)<input id="w-vat" type="number" step="0.1" value="${i.vatPercent}"/></label>
        <label>Ngày<input id="w-date" type="date" value="${i.quoteDate}"/></label>
        <div style="grid-column:1/-1">
          <div style="font-size:13px;color:var(--text-soft);font-weight:500;margin-bottom:5px">Logo khách hàng (tùy chọn)</div>
          <div class="logo-drop ${i.customerLogo ? "has" : ""}" id="w-logo-drop">
            ${i.customerLogo
              ? `<img src="${i.customerLogo}"/><div class="logo-actions"><button class="btn btn-sm" id="w-logo-change">Đổi</button><button class="btn btn-sm btn-danger" id="w-logo-clear">Xóa</button></div>`
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
    if (!wz.info.toCompany.trim()) { toast("Nhập tên khách hàng", "error"); return; }
    try {
      const { quoteNumber } = await api("/api/quotes/next-number");
      const sheets = wz.templateIds.map(tid => {
        const t = state.templates.find(x => x.id === tid);
        return { templateId: tid, name: t?.name || "Sheet", items: [{ name: "", detail: "", unit: "", quantity: 1, unitPrice: 0, days: null, notes: "" }] };
      });
      state.currentQuote = {
        quoteNumber, ...wz.info, companyId: wz.companyId,
        customerLogo: wz.info.customerLogo, sheets, _new: true,
      };
      state._wizard = null;
      state.page = "edit";
      render();
    } catch (e) { toast(e.message, "error"); }
  });
}

// ---------------- Editor ----------------
function renderEditor(el, quote) {
  const isNew = !!quote._new;
  const q = JSON.parse(JSON.stringify(quote));
  if (q.quoteDate && q.quoteDate.length > 10) q.quoteDate = q.quoteDate.slice(0, 10);
  if (!q.sheets || !q.sheets.length) {
    q.sheets = [{ templateId: state.templates[0]?.id, items: [] }];
  }
  q._activeSheet = 0;

  const editable = isNew
    || state.user.role === "admin"
    || state.user.role === "manager"
    || (q.createdById === state.user.id && (q.status === "draft" || q.status === "rejected"));

  const draw = () => {
    const activeSheet = q.sheets[q._activeSheet];
    const template = state.templates.find(t => t.id === activeSheet.templateId);
    const tplCode = template?.code;
    const usesDays = tplCode === "unibenfood";

    el.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px">
        <h1>
          ${isNew ? "Tạo báo giá mới" : "Báo giá " + escapeHtml(q.quoteNumber)}
          ${!isNew ? `<span class="status ${q.status}" style="margin-left:10px">${STATUS_LABEL[q.status]}</span>` : ""}
        </h1>
        <button class="btn" id="btn-back">← Quay lại</button>
      </div>
      <div class="editor">
        <div class="meta-grid">
          <label>Công ty:</label>
          <select id="f-companyId" ${!editable ? "disabled" : ""}>
            ${state.companies.map(c => `<option value="${c.id}" ${c.id === q.companyId ? "selected" : ""}>${escapeHtml(c.name)}</option>`).join("")}
          </select>
          <label>VAT (%):</label>
          <input type="number" step="0.1" id="f-vatPercent" value="${q.vatPercent}" ${!editable ? "disabled" : ""} />

          <label>To:</label>
          <input id="f-toCompany" value="${escapeHtml(q.toCompany || "")}" placeholder="Tên KH" ${!editable ? "disabled" : ""} />
          <label>From:</label>
          <input id="f-fromCompany-display" value="${escapeHtml(state.companies.find(c => c.id === q.companyId)?.name || "")}" disabled />

          <label>Ms./Mr.</label>
          <input id="f-toContact" value="${escapeHtml(q.toContact || "")}" placeholder="Người KH" ${!editable ? "disabled" : ""} />
          <label>Ms./Mr.</label>
          <input id="f-fromContact" value="${escapeHtml(q.fromContact || "")}" placeholder="Người ta" ${!editable ? "disabled" : ""} />

          <label></label><label></label>
          <label>Title:</label>
          <input id="f-fromTitle" value="${escapeHtml(q.fromTitle || "")}" placeholder="Account Team..." ${!editable ? "disabled" : ""} />

          <label></label><label></label>
          <label>Phone:</label>
          <input id="f-fromPhone" value="${escapeHtml(q.fromPhone || "")}" placeholder="SĐT" ${!editable ? "disabled" : ""} />

          <label></label><label></label>
          <label>Add:</label>
          <input id="f-fromAddress" value="${escapeHtml(q.fromAddress || "")}" ${!editable ? "disabled" : ""} />

          <label>Số BG:</label>
          <input id="f-quoteNumber" value="${escapeHtml(q.quoteNumber)}" ${!editable ? "disabled" : ""} />
          <label>Ngày:</label>
          <input type="date" id="f-quoteDate" value="${q.quoteDate}" ${!editable ? "disabled" : ""} />
        </div>

        <div class="center-line" id="date-preview">${vnDateText(q.quoteDate, q.city)}</div>
        <input class="title-input" id="f-title" value="${escapeHtml(q.title || "")}" placeholder="Tên báo giá (chung cho mọi sheet)" ${!editable ? "disabled" : ""} />
        <div class="quote-no" id="qno-preview">(Số://${escapeHtml(q.quoteNumber)})</div>

        <textarea class="greeting" id="f-greeting" rows="2" ${!editable ? "disabled" : ""}>${escapeHtml(q.greeting || "Chân thành cảm ơn Quí khách hàng đã quan tâm đến dịch vụ của chúng tôi, chúng tôi xin gởi bảng báo giá theo yêu cầu như sau:")}</textarea>

        <!-- Sheet tabs -->
        <div class="sheet-tabs">
          ${q.sheets.map((s, i) => `
            <div class="sheet-tab ${i === q._activeSheet ? "active" : ""}" data-tab="${i}">
              <span>${escapeHtml(s.name || state.templates.find(t => t.id === s.templateId)?.name || "Sheet " + (i + 1))}</span>
              ${editable && q.sheets.length > 1 ? `<span class="rm-tab" data-rm-tab="${i}" title="Xóa sheet">✕</span>` : ""}
            </div>
          `).join("")}
          ${editable ? `<button class="btn btn-sm add-sheet" id="btn-add-sheet">+ Thêm sheet</button>` : ""}
        </div>

        <div class="sheet-meta" style="display:flex; gap:14px; margin: 8px 0; align-items:center; flex-wrap:wrap">
          <label style="font-size:13px">Tên sheet:
            <input id="f-sheet-name" value="${escapeHtml(activeSheet.name || "")}" style="padding:4px 8px; border:1px solid #d8dbe3; border-radius:6px" ${!editable ? "disabled" : ""} />
          </label>
          <label style="font-size:13px">Template:
            <select id="f-sheet-template" ${!editable ? "disabled" : ""}>
              ${state.templates.filter(t => t.companyId === q.companyId).map(t => `<option value="${t.id}" ${t.id === activeSheet.templateId ? "selected" : ""}>${escapeHtml(t.name)}</option>`).join("")}
            </select>
          </label>
        </div>

        <table class="excel-table" id="items-table">
          <thead>
            <tr>
              <th style="width:50px">STT</th>
              <th>Hạng Mục</th>
              ${tplCode === "marico_decor" ? `<th>Chi Tiết</th>` : ""}
              <th style="width:80px">ĐVT</th>
              <th style="width:90px">SỐ LƯỢNG</th>
              ${usesDays ? `<th style="width:80px">SỐ NGÀY</th>` : ""}
              <th style="width:130px">ĐƠN GIÁ&#10;(VNĐ)</th>
              <th style="width:140px">THÀNH TIỀN&#10;(VNĐ)</th>
              <th style="width:150px">Notes</th>
              ${editable ? `<th style="width:36px"></th>` : ""}
            </tr>
          </thead>
          <tbody></tbody>
          <tfoot></tfoot>
        </table>

        ${editable ? `<button class="btn btn-sm" id="btn-add-item" style="margin-top:10px">+ Thêm dòng vào sheet này</button>` : ""}

        <div class="quote-summary">
          ${renderQuoteSummary(q)}
        </div>

        <div class="actions">
          ${editable ? `<button class="btn btn-primary" id="btn-save">💾 Lưu</button>` : ""}
          ${!isNew ? `<button class="btn" id="btn-excel">📥 Excel</button>` : ""}
          ${!isNew ? `<button class="btn" id="btn-pdf">📄 PDF</button>` : ""}
          ${!isNew ? `<button class="btn" id="btn-versions">🕘 Lịch sử</button>` : ""}
          ${editable && (isNew || q.status === "draft" || q.status === "rejected") ? `<button class="btn btn-warn" id="btn-submit">📨 Trình duyệt</button>` : ""}
          ${!isNew && q.status === "pending" && can("quote:approve") ? `
            <button class="btn btn-success" id="btn-approve">✅ Duyệt</button>
            <button class="btn btn-danger" id="btn-reject">❌ Từ chối</button>
          ` : ""}
          ${!isNew && (q.status === "approved" || q.status === "sent") ? `<button class="btn btn-primary" id="btn-send">📤 ${q.status === "sent" ? "Gửi lại KH" : "Gửi KH"}</button>` : ""}
          ${!isNew && (q.status === "approved" || q.status === "sent") ? `<button class="btn btn-success" id="btn-convert">🤝 Đã chốt</button>` : ""}
        </div>
      </div>`;

    document.getElementById("btn-back").addEventListener("click", () => { state.page = "list"; render(); });

    // Sheet tab switching
    document.querySelectorAll(".sheet-tab").forEach(t => {
      t.addEventListener("click", (e) => {
        if (e.target.dataset.rmTab) return;  // handled below
        q._activeSheet = parseInt(t.dataset.tab, 10);
        draw();
      });
    });
    document.querySelectorAll("[data-rm-tab]").forEach(b => {
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!confirm("Xóa sheet này khỏi báo giá?")) return;
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
      draw();
    });

    // Company change
    document.getElementById("f-companyId").addEventListener("change", e => {
      q.companyId = parseInt(e.target.value, 10);
      // Reset all sheets' templates to first available template of new company
      const tpls = state.templates.filter(t => t.companyId === q.companyId);
      if (tpls.length) {
        q.sheets.forEach(s => {
          if (!tpls.find(t => t.id === s.templateId)) s.templateId = tpls[0].id;
        });
      }
      draw();
    });

    // Items
    drawItems(q, activeSheet, editable, tplCode, usesDays);

    // Header field bindings
    const bindField = (id, prop) => {
      const e2 = document.getElementById(id);
      if (!e2) return;
      e2.addEventListener("input", (e) => {
        let v = e.target.value;
        if (prop === "vatPercent") v = Number(v);
        q[prop] = v;
        if (prop === "quoteNumber") document.getElementById("qno-preview").textContent = `(Số://${q.quoteNumber})`;
        if (prop === "quoteDate" || prop === "city") {
          document.getElementById("date-preview").textContent = vnDateText(q.quoteDate, q.city);
        }
        if (prop === "vatPercent") updateSummary(q);
      });
    };
    bindField("f-toCompany", "toCompany");
    bindField("f-toContact", "toContact");
    bindField("f-fromContact", "fromContact");
    bindField("f-fromPhone", "fromPhone");
    bindField("f-fromTitle", "fromTitle");
    bindField("f-fromAddress", "fromAddress");
    bindField("f-quoteNumber", "quoteNumber");
    bindField("f-quoteDate", "quoteDate");
    bindField("f-vatPercent", "vatPercent");
    bindField("f-title", "title");
    bindField("f-greeting", "greeting");

    const addBtn = document.getElementById("btn-add-item");
    if (addBtn) addBtn.addEventListener("click", () => {
      activeSheet.items.push({ name: "", detail: "", unit: "", quantity: 1, unitPrice: 0, days: usesDays ? 1 : null, notes: "" });
      drawItems(q, activeSheet, editable, tplCode, usesDays);
      updateSummary(q);
    });

    bindActions(q, isNew);
  };

  draw();
}

function bindActions(q, isNew) {
  const saveBtn = document.getElementById("btn-save");
  if (saveBtn) saveBtn.addEventListener("click", async () => {
    try {
      const payload = {
        ...q,
        sheets: q.sheets.map((s, i) => ({
          templateId: s.templateId,
          name: s.name,
          order: i + 1,
          items: (s.items || []).map((it, j) => ({ ...it, order: j + 1 })),
        })),
      };
      delete payload._new;
      delete payload._activeSheet;
      let saved;
      if (isNew) saved = await api("/api/quotes", { method: "POST", body: JSON.stringify(payload) });
      else saved = await api(`/api/quotes/${q.id}`, { method: "PUT", body: JSON.stringify(payload) });
      state.currentQuote = saved;
      state.page = "edit";
      toast("Đã lưu", "success");
      render();
    } catch (e) { toast(e.message, "error"); }
  });
  const submitBtn = document.getElementById("btn-submit");
  if (submitBtn) submitBtn.addEventListener("click", async () => {
    if (isNew) { toast("Vui lòng Lưu trước khi trình duyệt", "error"); return; }
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
    window.open(`/api/export/${q.id}.xlsx`, "_blank");
  });
  const pdfBtn = document.getElementById("btn-pdf");
  if (pdfBtn) pdfBtn.addEventListener("click", () => {
    window.open(`/api/export/${q.id}.pdf`, "_blank");
  });
  const versionsBtn = document.getElementById("btn-versions");
  if (versionsBtn) versionsBtn.addEventListener("click", () => showVersions(q.id));
  const sendBtn = document.getElementById("btn-send");
  if (sendBtn) sendBtn.addEventListener("click", async () => {
    try {
      const updated = await api(`/api/quotes/${q.id}/send`, { method: "POST" });
      state.currentQuote = updated;
      toast("Đã đánh dấu Đã gửi khách", "success");
      render();
    } catch (e) { toast(e.message, "error"); }
  });
  const convertBtn = document.getElementById("btn-convert");
  if (convertBtn) convertBtn.addEventListener("click", async () => {
    if (!confirm("Đánh dấu báo giá này là ĐÃ CHỐT (chuyển đơn)?")) return;
    try {
      const updated = await api(`/api/quotes/${q.id}/mark-converted`, { method: "POST" });
      state.currentQuote = updated;
      toast("Đã chốt 🎉", "success");
      render();
    } catch (e) { toast(e.message, "error"); }
  });
}

/** Version history viewer with side-by-side diff between any two revisions. */
async function showVersions(quoteId) {
  const m = openModal("Lịch sử phiên bản", `<div id="ver-body">Đang tải...</div>`);
  try {
    const r = await api(`/api/quotes/${quoteId}/versions`);
    const versions = r.data || [];
    if (!versions.length) {
      m.find("#ver-body").innerHTML = "<div class='empty-state'>Chưa có phiên bản</div>";
      return;
    }
    m.find("#ver-body").innerHTML = `
      <table class="list-table" style="margin-bottom:12px">
        <thead><tr><th>Phiên bản</th><th>Thời gian</th><th style="text-align:right">Tổng (VNĐ)</th></tr></thead>
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
          box.innerHTML = `<table class="list-table"><thead><tr><th>Trường</th><th>v${a}</th><th>v${b}</th></tr></thead>
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

function drawItems(q, activeSheet, editable, tplCode, usesDays) {
  const tbody = document.querySelector("#items-table tbody");
  const showDetail = tplCode === "marico_decor";
  // Fields that allow multi-line (Shift+Enter or paste with \n)
  const multilineFields = new Set(["name", "detail", "notes"]);

  tbody.innerHTML = activeSheet.items.map((it, i) => {
    const qty = Number(it.quantity) || 0;
    const days = Number(it.days) || 1;
    const price = Number(it.unitPrice) || 0;
    const amt = usesDays ? qty * days * price : qty * price;
    return `
      <tr data-row="${i}">
        <td class="col-stt">${i + 1}</td>
        <td class="col-hangmuc"><textarea data-f="name" rows="1" ${!editable ? "disabled" : ""}>${escapeHtml(it.name || "")}</textarea></td>
        ${showDetail ? `<td class="col-detail"><textarea data-f="detail" rows="1" ${!editable ? "disabled" : ""}>${escapeHtml(it.detail || "")}</textarea></td>` : ""}
        <td class="col-dvt"><input data-f="unit" value="${escapeHtml(it.unit || "")}" ${!editable ? "disabled" : ""} /></td>
        <td class="col-qty"><input data-f="quantity" type="number" step="0.01" value="${it.quantity ?? 0}" ${!editable ? "disabled" : ""} /></td>
        ${usesDays ? `<td class="col-qty"><input data-f="days" type="number" step="1" value="${it.days ?? 1}" ${!editable ? "disabled" : ""} /></td>` : ""}
        <td class="col-price"><input data-f="unitPrice" type="number" step="1" value="${it.unitPrice ?? 0}" ${!editable ? "disabled" : ""} /></td>
        <td class="col-amount">${fmtMoney(amt)}</td>
        <td class="col-notes"><textarea data-f="notes" rows="1" ${!editable ? "disabled" : ""}>${escapeHtml(it.notes || "")}</textarea></td>
        ${editable ? `<td class="col-action"><button data-rm="${i}" title="Xóa">✕</button></td>` : ""}
      </tr>
    `;
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

  // Handle BOTH input and textarea cells
  tbody.querySelectorAll("input, textarea").forEach(inp => {
    const f = inp.dataset.f;
    const isMultiline = multilineFields.has(f);

    inp.addEventListener("input", (e) => {
      const tr = e.target.closest("tr");
      const i = parseInt(tr.dataset.row, 10);
      let v = e.target.value;
      // For single-line fields, strip any newlines that sneaked in (e.g. paste)
      if (!isMultiline && typeof v === "string") {
        if (/[\r\n]/.test(v)) {
          v = v.replace(/[\r\n]+/g, " ");
          e.target.value = v;
        }
      }
      if (f === "quantity" || f === "unitPrice" || f === "days") v = Number(v) || 0;
      activeSheet.items[i][f] = v;
      const it = activeSheet.items[i];
      const qty = Number(it.quantity) || 0;
      const days = Number(it.days) || 1;
      const price = Number(it.unitPrice) || 0;
      const amt = usesDays ? qty * days * price : qty * price;
      tr.querySelector(".col-amount").textContent = fmtMoney(amt);
      updateSummary(q);
    });

    // For non-multiline inputs: block Enter and strip newlines on paste
    if (!isMultiline) {
      inp.addEventListener("keydown", (e) => {
        if (e.key === "Enter") e.preventDefault();
      });
      inp.addEventListener("paste", (e) => {
        const text = (e.clipboardData || window.clipboardData).getData("text");
        if (/[\r\n]/.test(text)) {
          e.preventDefault();
          const cleaned = text.replace(/[\r\n]+/g, " ");
          const tgt = e.target;
          const start = tgt.selectionStart || 0;
          const end = tgt.selectionEnd || 0;
          tgt.value = tgt.value.substring(0, start) + cleaned + tgt.value.substring(end);
          tgt.dispatchEvent(new Event("input", { bubbles: true }));
        }
      });
    }
  });
  tbody.querySelectorAll("button[data-rm]").forEach(b => {
    b.addEventListener("click", () => {
      const i = parseInt(b.dataset.rm, 10);
      activeSheet.items.splice(i, 1);
      if (!activeSheet.items.length) activeSheet.items.push({ name: "", detail: "", unit: "", quantity: 1, unitPrice: 0, days: usesDays ? 1 : null, notes: "" });
      drawItems(q, activeSheet, editable, tplCode, usesDays);
      updateSummary(q);
    });
  });

  // Render footer (per-sheet subtotal)
  const tfoot = document.querySelector("#items-table tfoot");
  const sheetSubtotal = activeSheet.items.reduce((s, it) => {
    const qty = Number(it.quantity) || 0;
    const days = Number(it.days) || 1;
    const price = Number(it.unitPrice) || 0;
    return s + (usesDays ? qty * days * price : qty * price);
  }, 0);
  const colSpanLeft = 4 + (showDetail ? 1 : 0) + (usesDays ? 1 : 0);
  tfoot.innerHTML = `
    <tr>
      <td colspan="${colSpanLeft}"></td>
      <td colspan="2" class="empty-left label">Tổng sheet</td>
      <td class="value">${fmtMoney(sheetSubtotal)}</td>
      <td></td>
      ${editable ? "<td></td>" : ""}
    </tr>`;
}

function renderQuoteSummary(q) {
  const vatPct = Number(q.vatPercent) || 0;
  let subtotalAll = 0;
  const rows = q.sheets.map((s, i) => {
    const tpl = state.templates.find(t => t.id === s.templateId);
    const usesDays = tpl?.code === "unibenfood";
    const sub = (s.items || []).reduce((sum, it) => {
      const qty = Number(it.quantity) || 0;
      const days = Number(it.days) || 1;
      const price = Number(it.unitPrice) || 0;
      return sum + (usesDays ? qty * days * price : qty * price);
    }, 0);
    subtotalAll += sub;
    return { idx: i + 1, name: s.name || tpl?.name || `Sheet ${i + 1}`, subtotal: sub };
  });
  const vat = subtotalAll * vatPct / 100;
  const total = subtotalAll + vat;
  return `
    <h3 style="margin: 18px 0 6px">Tổng báo giá (${q.sheets.length} sheet)</h3>
    <table class="summary-table" id="summary-table">
      <thead><tr><th>STT</th><th>Sheet</th><th style="text-align:right">Tổng (VNĐ)</th></tr></thead>
      <tbody>
        ${rows.map(r => `<tr><td style="text-align:center">${r.idx}</td><td>${escapeHtml(r.name)}</td><td style="text-align:right" data-sub="${r.idx-1}">${fmtMoney(r.subtotal)}</td></tr>`).join("")}
      </tbody>
      <tfoot>
        <tr><td colspan="2">Tổng cộng</td><td style="text-align:right" id="sum-subtotal">${fmtMoney(subtotalAll)}</td></tr>
        <tr><td colspan="2">VAT (${vatPct}%)</td><td style="text-align:right" id="sum-vat">${fmtMoney(vat)}</td></tr>
        <tr><td colspan="2"><strong>Thành tiền</strong></td><td style="text-align:right; color:#C00000"><strong id="sum-total">${fmtMoney(total)}</strong></td></tr>
      </tfoot>
    </table>`;
}

function updateSummary(q) {
  const wrap = document.querySelector(".quote-summary");
  if (!wrap) return;
  wrap.innerHTML = renderQuoteSummary(q);
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
  body.innerHTML = `
    <table class="list-table">
      <thead><tr><th>Username</th><th>Họ tên</th><th>Quyền</th><th>SĐT</th><th>Chức vụ</th><th>Trạng thái</th><th>Thao tác</th></tr></thead>
      <tbody>
        ${state.users.map(u => `
          <tr>
            <td>${escapeHtml(u.username)}</td>
            <td>${escapeHtml(u.displayName)}</td>
            <td><span class="status ${u.role === "admin" ? "approved" : u.role === "manager" ? "pending" : "draft"}">${ROLE_LABEL[u.role]}</span></td>
            <td>${escapeHtml(u.phone || "")}</td>
            <td>${escapeHtml(u.title || "")}</td>
            <td>${u.active ? "✅ Hoạt động" : "🔒 Khóa"}</td>
            <td>
              <button class="btn btn-sm" data-edit="${u.id}">Sửa</button>
              <button class="btn btn-sm" data-pw="${u.id}">Đổi MK</button>
              <button class="btn btn-sm ${u.active ? "btn-warn" : "btn-success"}" data-toggle="${u.id}">${u.active ? "Khóa" : "Mở khóa"}</button>
              ${u.id !== state.user.id ? `<button class="btn btn-sm btn-danger" data-del="${u.id}">Xóa</button>` : ""}
            </td>
          </tr>
        `).join("")}
      </tbody>
    </table>`;
  body.querySelectorAll("button[data-edit]").forEach(b => b.addEventListener("click", () => openUserModal(state.users.find(u => u.id === parseInt(b.dataset.edit, 10)))));
  body.querySelectorAll("button[data-pw]").forEach(b => b.addEventListener("click", () => openPasswordModal(state.users.find(u => u.id === parseInt(b.dataset.pw, 10)))));
  body.querySelectorAll("button[data-toggle]").forEach(b => b.addEventListener("click", async () => {
    const u = state.users.find(x => x.id === parseInt(b.dataset.toggle, 10));
    try {
      await api(`/api/users/${u.id}`, { method: "PUT", body: JSON.stringify({ active: !u.active }) });
      toast("Đã cập nhật", "success");
      loadUsers();
    } catch (e) { toast(e.message, "error"); }
  }));
  body.querySelectorAll("button[data-del]").forEach(b => b.addEventListener("click", async () => {
    if (!confirm("Xóa user này?")) return;
    try {
      await api(`/api/users/${b.dataset.del}`, { method: "DELETE" });
      toast("Đã xóa", "success");
      loadUsers();
    } catch (e) { toast(e.message, "error"); }
  }));
}

function openUserModal(u) {
  const isNew = !u;
  const mask = document.createElement("div");
  mask.className = "modal-mask";
  mask.innerHTML = `
    <div class="modal">
      <h2>${isNew ? "Thêm nhân viên" : "Sửa: " + escapeHtml(u.username)}</h2>
      <label>Tên đăng nhập<input name="username" value="${escapeHtml(u?.username || "")}" ${isNew ? "" : "disabled"} /></label>
      ${isNew ? `<label>Mật khẩu khởi tạo<input name="password" type="text" value="123456" /></label>` : ""}
      <label>Họ tên<input name="displayName" value="${escapeHtml(u?.displayName || "")}" /></label>
      <label>Quyền
        <select name="role">
          <option value="employee" ${u?.role === "employee" ? "selected" : ""}>Nhân viên</option>
          <option value="manager" ${u?.role === "manager" ? "selected" : ""}>Quản lý</option>
          <option value="admin" ${u?.role === "admin" ? "selected" : ""}>Quản trị viên</option>
        </select>
      </label>
      <label>SĐT<input name="phone" value="${escapeHtml(u?.phone || "")}" /></label>
      <label>Chức vụ<input name="title" placeholder="Account Team..." value="${escapeHtml(u?.title || "")}" /></label>
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
      role: get("role"), phone: get("phone"), title: get("title"),
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
      <label>Mật khẩu mới<input name="password" type="text" /></label>
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

function renderProfile(el) {
  el.innerHTML = `
    <h1>Đổi mật khẩu</h1>
    <div class="editor" style="max-width:420px">
      <label style="display:block; margin-bottom:14px"><span>Mật khẩu cũ</span>
        <input type="password" id="old-pw" style="width:100%; padding:8px; border:1px solid #d8dbe3; border-radius:6px" />
      </label>
      <label style="display:block; margin-bottom:14px"><span>Mật khẩu mới</span>
        <input type="password" id="new-pw" style="width:100%; padding:8px; border:1px solid #d8dbe3; border-radius:6px" />
      </label>
      <button class="btn btn-primary" id="btn-change-pw">Đổi mật khẩu</button>
    </div>`;
  document.getElementById("btn-change-pw").addEventListener("click", async () => {
    try {
      await api("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({
          oldPassword: document.getElementById("old-pw").value,
          newPassword: document.getElementById("new-pw").value,
        }),
      });
      toast("Đã đổi mật khẩu", "success");
      document.getElementById("old-pw").value = "";
      document.getElementById("new-pw").value = "";
    } catch (e) { toast(e.message, "error"); }
  });
}

// ============================================================
// EXTENDED PAGES — Phase 2 modules
// ============================================================

// ---------------- Dashboard ----------------
async function renderDashboard(el) {
  el.innerHTML = `<h1>📊 Dashboard</h1>
    <div id="dash-kpi" class="kpi-grid">${skeleton(5, true)}</div>
    <h3 style="margin-top:24px">Phễu báo giá</h3>
    <div id="dash-funnel" class="funnel"></div>
    <h3 style="margin-top:24px">Top nhân viên (theo doanh số duyệt)</h3>
    <div id="dash-top"></div>`;
  try {
    const [overview, funnel, top] = await Promise.all([
      api("/api/analytics/overview"),
      api("/api/analytics/funnel"),
      api("/api/analytics/top-sales?limit=10"),
    ]);
    const k = overview.kpi;
    document.getElementById("dash-kpi").innerHTML = `
      <div class="kpi"><span>Tổng báo giá 30d</span><strong>${k.totalQuotes}</strong></div>
      <div class="kpi"><span>Doanh số duyệt</span><strong>${fmtMoney(k.approvedAmount)}</strong></div>
      <div class="kpi"><span>TB / báo giá</span><strong>${fmtMoney(Math.round(k.avgDealSize))}</strong></div>
      <div class="kpi"><span>Tỷ lệ chốt</span><strong>${k.conversionRate}%</strong></div>
      <div class="kpi"><span>Sắp hết hạn (≤7d)</span><strong>${k.expiringSoon}</strong></div>`;
    document.getElementById("dash-funnel").innerHTML = funnel.data.map(s => `
      <div class="funnel-row">
        <span class="status ${s.status}">${STATUS_LABEL[s.status] || s.status}</span>
        <div class="funnel-bar" style="width:${Math.min(100, s.count * 8)}%"></div>
        <strong>${s.count}</strong>
      </div>
    `).join("") || "<div class='empty-state'>Không có dữ liệu</div>";
    document.getElementById("dash-top").innerHTML = top.data.length ? `
      <table class="list-table">
        <thead><tr><th>#</th><th>Nhân viên</th><th>Số BG</th><th style="text-align:right">Doanh số</th></tr></thead>
        <tbody>${top.data.map((t, i) => `
          <tr><td>${i + 1}</td><td>${escapeHtml(t.user?.displayName || "—")}</td><td>${t.count}</td><td style="text-align:right">${fmtMoney(t.amount)}</td></tr>
        `).join("")}</tbody>
      </table>` : "<div class='empty-state'>Chưa có doanh số duyệt</div>";
  } catch (e) { toast(e.message, "error"); }
}

// ---------------- Customers (CRM) ----------------
async function renderCustomers(el) {
  el.innerHTML = `<h1>🏢 Khách hàng (CRM)</h1>
    <div class="toolbar">
      <input id="cust-q" placeholder="Tìm theo tên, mã, SĐT, email..." style="flex:1; min-width:240px"/>
      <select id="cust-status">
        <option value="">Tất cả</option>
        <option value="lead">Lead</option>
        <option value="prospect">Prospect</option>
        <option value="active">Đang giao dịch</option>
        <option value="inactive">Ngưng</option>
      </select>
      <button class="btn btn-primary" id="btn-new-cust">+ Khách mới</button>
    </div>
    <div id="cust-body">Đang tải...</div>`;
  let q = "", status = "";
  const reload = async () => {
    const params = new URLSearchParams({ q, status, size: "50" });
    try {
      const r = await api("/api/customers?" + params);
      const body = document.getElementById("cust-body");
      if (!r.data.length) { body.innerHTML = "<div class='empty-state'>Chưa có khách hàng</div>"; return; }
      body.innerHTML = `<table class="list-table">
        <thead><tr><th>Mã</th><th>Tên</th><th>SĐT</th><th>Email</th><th>Trạng thái</th><th>Tags</th><th>Phụ trách</th><th></th></tr></thead>
        <tbody>${r.data.map(c => `
          <tr>
            <td><strong>${escapeHtml(c.code)}</strong></td>
            <td>${escapeHtml(c.name)}</td>
            <td>${escapeHtml(c.phone || "")}</td>
            <td>${escapeHtml(c.email || "")}</td>
            <td><span class="status ${c.status}">${c.status}</span></td>
            <td>${(c.tags || []).map(t => `<span class="tag">${escapeHtml(t)}</span>`).join("")}</td>
            <td>${escapeHtml(c.owner?.displayName || "")}</td>
            <td>
              <button class="btn btn-sm" data-edit="${c.id}">Sửa</button>
              <button class="btn btn-sm btn-danger" data-del="${c.id}">Xóa</button>
            </td>
          </tr>`).join("")}</tbody>
      </table>`;
      body.querySelectorAll("[data-edit]").forEach(b => b.addEventListener("click", () => editCustomer(parseInt(b.dataset.edit))));
      body.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", async () => {
        if (!confirm("Xóa khách hàng?")) return;
        try { await api(`/api/customers/${b.dataset.del}`, { method: "DELETE" }); toast("Đã xóa", "success"); reload(); }
        catch (e) { toast(e.message, "error"); }
      }));
    } catch (e) { toast(e.message, "error"); }
  };
  document.getElementById("cust-q").addEventListener("input", (e) => { q = e.target.value; clearTimeout(window._ct); window._ct = setTimeout(reload, 300); });
  document.getElementById("cust-status").addEventListener("change", (e) => { status = e.target.value; reload(); });
  document.getElementById("btn-new-cust").addEventListener("click", () => editCustomer(null));
  await reload();
}

/** Customer picker — used inside the quote editor. Returns selected customer or null. */
async function pickCustomer() {
  return new Promise((resolve) => {
    const m = openModal("Chọn khách hàng", `
      <input id="cp-q" placeholder="Tìm tên / mã / SĐT..." autofocus
        style="width:100%;padding:8px;border:1px solid #d8dbe3;border-radius:6px;margin-bottom:10px"/>
      <div id="cp-list" style="max-height:50vh;overflow:auto"></div>`);
    const q = m.find("#cp-q");
    const list = m.find("#cp-list");
    const reload = async () => {
      try {
        const r = await api("/api/customers?size=30" + (q.value ? `&q=${encodeURIComponent(q.value)}` : ""));
        list.innerHTML = r.data.length ? r.data.map(c => `
          <div class="pick-row" data-id="${c.id}">
            <div><strong>${escapeHtml(c.code)}</strong> — ${escapeHtml(c.name)}</div>
            <div style="font-size:12px;color:#6b7280">${escapeHtml(c.phone || "")} ${escapeHtml(c.email || "")}</div>
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
      <label>Tên <span class="req">*</span><input id="cf-name" required/></label>
      <label>Mã số thuế<input id="cf-tax"/></label>
      <label>Điện thoại<input id="cf-phone"/></label>
      <label>Email<input id="cf-email" type="email"/></label>
      <label>Người liên hệ<input id="cf-contact"/></label>
      <label>Chức vụ<input id="cf-title"/></label>
      <label style="grid-column:1/-1">Địa chỉ<input id="cf-addr"/></label>
      <label>Thành phố<input id="cf-city"/></label>
      <label>Trạng thái<select id="cf-status">
        <option value="lead">Lead</option><option value="prospect">Prospect</option>
        <option value="active">Đang giao dịch</option><option value="inactive">Ngưng</option>
      </select></label>
      <label style="grid-column:1/-1">Tags (phân tách dấu phẩy)<input id="cf-tags" placeholder="hot, vip"/></label>
    </div>`);
  if (!isNew) {
    api(`/api/customers/${id}`).then(c => {
      m.find("#cf-name").value = c.name || "";
      m.find("#cf-tax").value = c.taxCode || "";
      m.find("#cf-phone").value = c.phone || "";
      m.find("#cf-email").value = c.email || "";
      m.find("#cf-contact").value = c.contactName || "";
      m.find("#cf-title").value = c.contactTitle || "";
      m.find("#cf-addr").value = c.address || "";
      m.find("#cf-city").value = c.city || "";
      m.find("#cf-status").value = c.status || "lead";
      m.find("#cf-tags").value = (c.tags || []).join(", ");
    });
  }
  m.onSave(async () => {
    const body = {
      name: m.find("#cf-name").value.trim(),
      taxCode: m.find("#cf-tax").value.trim() || null,
      phone: m.find("#cf-phone").value.trim() || null,
      email: m.find("#cf-email").value.trim() || null,
      contactName: m.find("#cf-contact").value.trim() || null,
      contactTitle: m.find("#cf-title").value.trim() || null,
      address: m.find("#cf-addr").value.trim() || null,
      city: m.find("#cf-city").value.trim() || null,
      status: m.find("#cf-status").value,
      tags: m.find("#cf-tags").value.split(",").map(s => s.trim()).filter(Boolean),
    };
    if (!body.name) { toast("Thiếu tên", "error"); return; }
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
  el.innerHTML = `<h1>📦 Sản phẩm / Dịch vụ</h1>
    <div class="toolbar">
      <input id="p-q" placeholder="Tìm theo SKU hoặc tên..." style="flex:1"/>
      <button class="btn btn-primary" id="btn-new-p">+ Sản phẩm mới</button>
    </div>
    <div id="p-body">Đang tải...</div>`;
  let q = "";
  const reload = async () => {
    try {
      const r = await api("/api/products?size=100" + (q ? `&q=${encodeURIComponent(q)}` : ""));
      const body = document.getElementById("p-body");
      if (!r.data.length) { body.innerHTML = "<div class='empty-state'>Chưa có sản phẩm</div>"; return; }
      body.innerHTML = `<table class="list-table">
        <thead><tr><th>SKU</th><th>Tên</th><th>Loại</th><th>ĐVT</th>
          <th style="text-align:right">Giá vốn</th><th style="text-align:right">Giá bán</th>
          <th style="text-align:right">Margin</th><th></th></tr></thead>
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
        if (!confirm("Xóa sản phẩm?")) return;
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
    if (!body.sku || !body.name) { toast("Thiếu SKU hoặc tên", "error"); return; }
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
  el.innerHTML = `<h1>✅ Hàng chờ duyệt</h1><div id="aq-body">Đang tải...</div>`;
  try {
    const r = await api("/api/approvals/queue");
    const body = document.getElementById("aq-body");
    if (!r.data.length) { body.innerHTML = "<div class='empty-state'>Không có báo giá chờ duyệt</div>"; return; }
    body.innerHTML = `<table class="list-table">
      <thead><tr><th>Số BG</th><th>Tiêu đề</th><th>Khách</th><th>Level</th>
        <th style="text-align:right">Tổng</th><th>Người tạo</th><th></th></tr></thead>
      <tbody>${r.data.map(a => `
        <tr>
          <td><strong>${escapeHtml(a.quote?.quoteNumber)}</strong></td>
          <td>${escapeHtml(a.quote?.title || "")}</td>
          <td>${escapeHtml(a.quote?.toCompany || "")}</td>
          <td>L${a.level}</td>
          <td style="text-align:right">${fmtMoney(a.quote?.total)}</td>
          <td>${escapeHtml(a.quote?.createdBy?.displayName || "")}</td>
          <td>
            <button class="btn btn-sm" data-open="${a.quote?.id}">Xem</button>
            <button class="btn btn-sm btn-primary" data-approve="${a.quote?.id}">✓ Duyệt</button>
            <button class="btn btn-sm btn-danger" data-reject="${a.quote?.id}">✗ Từ chối</button>
          </td>
        </tr>`).join("")}</tbody></table>`;
    body.querySelectorAll("[data-open]").forEach(b => b.addEventListener("click", async () => {
      const q = await api(`/api/quotes/${b.dataset.open}`); state.currentQuote = q; state.page = "edit"; render();
    }));
    body.querySelectorAll("[data-approve]").forEach(b => b.addEventListener("click", async () => {
      const comment = prompt("Comment duyệt (tuỳ chọn):") ?? "";
      try { await api(`/api/quotes/${b.dataset.approve}/approve`, { method: "POST", body: JSON.stringify({ comment }) });
        toast("Đã duyệt", "success"); renderApprovalQueue(el);
      } catch (e) { toast(e.message, "error"); }
    }));
    body.querySelectorAll("[data-reject]").forEach(b => b.addEventListener("click", async () => {
      const comment = prompt("Lý do từ chối:") ?? "";
      if (!comment.trim()) return;
      try { await api(`/api/quotes/${b.dataset.reject}/reject`, { method: "POST", body: JSON.stringify({ comment }) });
        toast("Đã từ chối", "success"); renderApprovalQueue(el);
      } catch (e) { toast(e.message, "error"); }
    }));
  } catch (e) { toast(e.message, "error"); }
}

// ---------------- Notifications ----------------
async function renderNotifications(el) {
  el.innerHTML = `<h1>🔔 Thông báo</h1>
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
      <div class="notif ${n.readAt ? "" : "unread"}" data-id="${n.id}">
        <div class="notif-title">${escapeHtml(n.title)}</div>
        <div class="notif-body">${escapeHtml(n.body)}</div>
        <div class="notif-meta">${fmtDate(n.createdAt)} ${escapeHtml(n.resource || "")}</div>
      </div>`).join("");
    body.querySelectorAll(".notif.unread").forEach(d => d.addEventListener("click", async () => {
      await api(`/api/notifications/${d.dataset.id}/read`, { method: "POST" });
      d.classList.remove("unread");
      refreshBadges();
    }));
  } catch (e) { toast(e.message, "error"); }
}

// ---------------- Audit log (admin) ----------------
async function renderAuditLog(el) {
  el.innerHTML = `<h1>📜 Audit log</h1>
    <div class="toolbar">
      <input id="a-action" placeholder="action (vd: quote.create)"/>
      <input id="a-resource" placeholder="resource (vd: quote)"/>
      <button class="btn" id="a-reload">Tải</button>
    </div>
    <div id="a-body">${skeleton(6)}</div>`;
  const reload = async () => {
    const params = new URLSearchParams();
    if (document.getElementById("a-action").value) params.set("action", document.getElementById("a-action").value);
    if (document.getElementById("a-resource").value) params.set("resource", document.getElementById("a-resource").value);
    params.set("size", "100");
    try {
      const r = await api("/api/audit?" + params);
      const body = document.getElementById("a-body");
      if (!r.data.length) { body.innerHTML = "<div class='empty-state'>Không có sự kiện</div>"; return; }
      body.innerHTML = `<table class="list-table">
        <thead><tr><th>Thời gian</th><th>Actor</th><th>Action</th><th>Resource</th><th>IP</th></tr></thead>
        <tbody>${r.data.map(e => `
          <tr>
            <td>${new Date(e.createdAt).toLocaleString("vi-VN")}</td>
            <td>${escapeHtml(e.actor?.username || "—")}</td>
            <td><code>${escapeHtml(e.action)}</code></td>
            <td>${escapeHtml(e.resource || "")}/${escapeHtml(e.resourceId || "")}</td>
            <td>${escapeHtml(e.ip || "")}</td>
          </tr>`).join("")}</tbody></table>`;
    } catch (e) { toast(e.message, "error"); }
  };
  document.getElementById("a-reload").addEventListener("click", reload);
  await reload();
}

// ---------------- Settings (admin) ----------------
async function renderSettings(el) {
  el.innerHTML = `<h1>⚙️ Cài đặt hệ thống</h1>
    <p>Quản lý approval matrix, key/value settings tổ chức.</p>
    <h3>Approval matrix</h3>
    <div id="s-matrix-body">Đang tải...</div>
    <button class="btn btn-primary" id="btn-add-matrix">+ Thêm matrix</button>`;

  const reload = async () => {
    try {
      const rows = await api("/api/approvals/matrix");
      document.getElementById("s-matrix-body").innerHTML = rows.length ? `
        <table class="list-table">
          <thead><tr><th>Tên</th><th>Min</th><th>Max</th><th>Levels</th><th>Active</th><th></th></tr></thead>
          <tbody>${rows.map(r => `
            <tr>
              <td>${escapeHtml(r.name)}</td>
              <td>${fmtMoney(r.minAmount)}</td>
              <td>${r.maxAmount != null ? fmtMoney(r.maxAmount) : "∞"}</td>
              <td><code style="font-size:11px">${escapeHtml(JSON.stringify(r.levels))}</code></td>
              <td>${r.active ? "✓" : "✗"}</td>
              <td><button class="btn btn-sm btn-danger" data-del="${r.id}">Xóa</button></td>
            </tr>`).join("")}</tbody>
        </table>` : "<div class='empty-state'>Chưa có matrix</div>";
      document.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", async () => {
        if (!confirm("Xóa matrix?")) return;
        await api(`/api/approvals/matrix/${b.dataset.del}`, { method: "DELETE" });
        reload();
      }));
    } catch (e) { toast(e.message, "error"); }
  };
  document.getElementById("btn-add-matrix").addEventListener("click", () => {
    const m = openModal("Thêm approval matrix", `
      <div class="form-grid">
        <label>Tên<input id="m-name" value="Default"/></label>
        <label>Min amount<input id="m-min" type="number" value="0"/></label>
        <label>Max amount (để trống = ∞)<input id="m-max" type="number"/></label>
        <label style="grid-column:1/-1">Levels (JSON)<textarea id="m-lvl" rows="4">[{"level":1,"roles":["manager","admin"],"any":1}]</textarea></label>
      </div>`);
    m.onSave(async () => {
      try {
        await api("/api/approvals/matrix", { method: "POST", body: JSON.stringify({
          name: m.find("#m-name").value || "Default",
          minAmount: Number(m.find("#m-min").value) || 0,
          maxAmount: m.find("#m-max").value ? Number(m.find("#m-max").value) : null,
          levels: JSON.parse(m.find("#m-lvl").value),
        })});
        toast("Đã lưu", "success"); m.close(); reload();
      } catch (e) { toast(e.message, "error"); }
    });
  });
  await reload();
}

// ---------------- Modal helper ----------------
function openModal(title, bodyHtml) {
  const d = document.createElement("div");
  d.className = "modal-backdrop";
  d.innerHTML = `<div class="modal">
    <div class="modal-head"><h3>${escapeHtml(title)}</h3><button class="modal-x">×</button></div>
    <div class="modal-body">${bodyHtml}</div>
    <div class="modal-foot">
      <button class="btn" data-cancel>Hủy</button>
      <button class="btn btn-primary" data-save>Lưu</button>
    </div>
  </div>`;
  document.body.appendChild(d);
  const close = () => d.remove();
  d.querySelector(".modal-x").addEventListener("click", close);
  d.querySelector("[data-cancel]").addEventListener("click", close);
  return {
    find: (sel) => d.querySelector(sel),
    close,
    onSave: (cb) => d.querySelector("[data-save]").addEventListener("click", cb),
  };
}

// ---------------- Permissions (Phân quyền) ----------------
async function renderPermissions(el) {
  el.innerHTML = `<h1>🛡️ Phân quyền</h1>
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
        <thead><tr><th>Quyền</th>${roles.map(r => `<th><div class="role-head"><span>${escapeHtml(r.label)}</span><span class="rh-pill">${escapeHtml(r.key)}</span></div></th>`).join("")}</tr></thead>
        <tbody>${rows}</tbody>
      </table>`;

    // User → role assignment
    const users = await api("/api/users");
    const roleOptions = roles.map(r => ({ key: r.key, label: r.label }));
    document.getElementById("perm-users").innerHTML = `
      <table class="list-table">
        <thead><tr><th>Nhân viên</th><th>Username</th><th>Vai trò</th><th>Trạng thái</th></tr></thead>
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
