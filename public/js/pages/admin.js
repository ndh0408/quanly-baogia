// pages/admin.js — the 10 standalone admin screens (step 6 of the SPA modularization):
// users, profile/2FA, dashboard, customers, products, approvals, notifications, projects,
// audit log, permissions. None of these touch the quote editor/grid, so they extract as a
// clean leaf. Exact byte-for-byte copy of the former app.js bodies — zero behavior change.
import {
  fmtMoney, fmtDate, escapeHtml, statusLabel,
  ROLE_LABEL, RESOURCE_LABEL, ACTION_LABEL, actionLabel, resourceLabel,
} from "../util.js?v=20260623a";
import { state, can } from "../core/state.js?v=20260623a";
import { api } from "../core/api.js?v=20260623a";
import {
  toast, skeleton, KBD, errorState, openModal, promptModal, confirmModal,
} from "../ui.js?v=20260623a";

// The 5 shell/nav helpers that stay in app.js are INJECTED at boot (setAdminDeps) rather
// than imported, to avoid a circular import with the entry module — which under cache-bust
// ?v= could load a SECOND app.js instance (double render/SSE). They are hoisted function
// declarations in app.js, fully wired before any admin page renders (navigation is later).
let goToQuote, renderShell, refreshBadges, shortTitle, codeLabel;
export function setAdminDeps(d) { ({ goToQuote, renderShell, refreshBadges, shortTitle, codeLabel } = d); }

export async function renderUsers(el) {
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
          <option value="manager">Account</option>
          <option value="admin">Quản trị</option>
          <option value="account_hn">Account Hà Nội</option>
          <option value="hr">Nhân sự</option>
          <option value="accountant">Kế toán</option>
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
          <option value="manager" ${u?.role === "manager" || !u?.role ? "selected" : ""}>Account</option>
          <option value="admin" ${u?.role === "admin" ? "selected" : ""}>Quản trị</option>
          <option value="account_hn" ${u?.role === "account_hn" ? "selected" : ""}>Account Hà Nội</option>
          <option value="hr" ${u?.role === "hr" ? "selected" : ""}>Nhân sự</option>
          <option value="accountant" ${u?.role === "accountant" ? "selected" : ""}>Kế toán</option>
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
    <label style="display:block;margin-top:10px"><b>3.</b> Nhập MẬT KHẨU tài khoản để xác nhận:
      <input id="mfa-pass" type="password" placeholder="Mật khẩu" autocomplete="current-password" style="width:100%;margin-top:6px"/></label>
    <div id="mfa-codes"></div>`);
  m.onSave(async () => {
    const token = (m.find("#mfa-token").value || "").trim();
    if (!/^\d{6}$/.test(token)) { toast("Nhập đúng mã 6 số", "error"); return; }
    const password = m.find("#mfa-pass").value || "";
    if (!password) { toast("Vui lòng nhập mật khẩu", "error"); return; }
    try {
      const r = await api("/api/mfa/enable", { method: "POST", body: JSON.stringify({ secret: s.secret, token, password }) });
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

export function renderProfile(el) {
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
export async function renderDashboard(el) {
  el.innerHTML = `<h1>Tổng quan</h1>
    <p class="muted" style="margin:-8px 0 16px">Số liệu 30 ngày gần nhất</p>
    <div id="dash-kpi" class="kpi-grid">${skeleton(4, true)}</div>
    <div class="dash-cols">
      <section><h3>Phễu báo giá</h3><div id="dash-funnel" class="funnel"></div></section>
      <section><h3>Top nhân viên (doanh số đã chốt)</h3><div id="dash-top"></div></section>
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
      <div class="kpi"><span>Doanh số đã chốt</span><strong>${fmtMoney(k.approvedAmount)} đ</strong></div>
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
      </table></div>` : "<div class='empty-state'>Chưa có doanh số đã chốt</div>";
  } catch (e) { toast(e.message, "error"); }
}

// ---------------- Customers (CRM) ----------------
export async function renderCustomers(el) {
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
export async function pickCustomer() {
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


// ---------------- Notifications ----------------
export async function renderNotifications(el) {
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
// Liệt kê báo giá ĐÃ CHỐT (converted) theo bố cục bảng theo dõi dự án/hoá đơn. Báo giá
// NHIỀU SHEET được tách mỗi sheet thành 1 dòng: Mã Sản Xuất thêm hậu tố _1/_2… theo
// sheet, Hạng Mục = tên sheet, Báo Giá/Thành Tiền VAT theo từng sheet. Luồng hoàn chỉnh:
// Hoá đơn → Thanh toán → Done (admin nhập Số HĐ + Ngày TT). Nguồn: /api/quotes/projects.
export async function renderProjects(el) {
  // CHỈ admin xem TẤT CẢ dự án + ký mọi dự án. Người có canSign (vd Lan Anh): CHỈ xem + ký dự án
  // DO MÌNH TẠO. Quản lý thường: chỉ xem dự án của mình, không ký. (server đã lọc theo người tạo)
  const isAdmin = can("user:manage");
  const canSignNow = isAdmin || !!state.user?.canSign;   // được thao tác Ký trên các dòng đang thấy
  el.innerHTML = `<h1>Quản lý dự án</h1>
    <p class="muted">Dự án = báo giá <b>đã chốt</b>. ${isAdmin ? "" : "<b>Bạn chỉ xem được dự án do mình tạo.</b> "}Báo giá nhiều sheet được tách mỗi sheet 1 dòng (Mã Sản Xuất thêm <b>_1, _2…</b>; Hạng Mục = tên sheet). Bấm vào dòng để mở báo giá.</p>
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
        invoiceNo: sh.invoiceNo || null,
        paidAt: sh.paidAt || null,
        invStatus: sh.invStatus || "invoice",   // invoice | payment | done (suy từ server)
        poNumber: sh.poNumber || null,
        hnInvoiceNo: sh.hnInvoiceNo || null,
        invoiceLink: sh.invoiceLink || null,
        docSentAt: sh.docSentAt || null,
        docReturnedAt: sh.docReturnedAt || null,
        hnStatus: q.hnStatus || null,           // báo giá HN: assigned/submitted/approved/rejected
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

  const stat = (label, val, color) => `<div class="card-section" style="flex:1;min-width:160px;padding:12px 16px">
      <div class="muted" style="font-size:12px">${label}</div>
      <div style="font-size:20px;font-weight:700;margin-top:3px${color ? `;color:${color}` : ""}">${val}</div></div>`;
  const dash = '<span class="muted">—</span>';
  // Luồng hoá đơn (chỉ BG đã chốt): Hoá đơn → Thanh toán (có số HĐ) → Done (có ngày TT). Tái dùng màu .status.
  const INV = { invoice: { l: "Hoá đơn", c: "pending" }, payment: { l: "Thanh toán", c: "sent" }, done: { l: "Done", c: "approved" } };
  const canInv = state.user?.role === "admin";   // chỉ admin nhập số HĐ + ngày thanh toán
  const headers = ["Status", "Phim", "Hạng Mục", "Báo Giá", "Chi Phí HCM", "Báo Giá Hà Nội", "Phí Khách Hàng", "Mã Sản Xuất", "Ngày Thi Công", "Số PO/HĐ", "Cty Xuất Hoá Đơn", "Số Hoá Đơn", "Ngày Xuất Hoá Đơn", "Thành Tiền VAT", "Thanh Toán", "Chứng từ gửi đi", "Chứng từ trả về", "Link Hoá Đơn", "Số HĐ HN", "Team client", "Account", "Ký Chứng từ", "Check"];

  const renderSummary = (rows) => {
    const sumBaoGia = rows.reduce((s, r) => s + r.baoGia, 0);
    const sumVAT = rows.reduce((s, r) => s + r.thanhTienVAT, 0);
    // Đã thanh toán = dòng có Ngày Thanh Toán; còn lại = chưa thu (theo Thành Tiền VAT).
    const paid = rows.reduce((s, r) => s + (r.paidAt ? r.thanhTienVAT : 0), 0);
    const unpaid = sumVAT - paid;
    const summ = document.getElementById("proj-summary");
    if (summ) summ.innerHTML = `<div style="display:flex;gap:12px;flex-wrap:wrap;margin:8px 0 16px">
      ${stat("Tổng Báo Giá (trước VAT)", fmtMoney(sumBaoGia))}
      ${stat("Tổng Thành Tiền VAT", fmtMoney(sumVAT))}
      ${stat("Đã thanh toán", fmtMoney(paid), "#0a7d28")}
      ${stat("Chưa thanh toán", fmtMoney(unpaid), unpaid > 0 ? "#c0392b" : "")}</div>`;
  };

  const renderTable = (rows) => {
    const body = document.getElementById("proj-body");
    if (!body) return;
    if (!rows.length) {
      body.innerHTML = `<div class="empty-state">${allRows.length ? "Không có dự án khớp tìm kiếm/bộ lọc." : 'Chưa có báo giá nào ở trạng thái "Đã chốt".'}</div>`;
      return;
    }
    body.innerHTML = `<div class="tbl-scroll"><table class="list-table proj-table">
      <thead><tr>${headers.map(h => `<th scope="col">${escapeHtml(h)}</th>`).join("")}</tr></thead>
      <tbody>${rows.map(r => {
        const q = r.q;
        const cty = q.company?.shortName || q.company?.name || "";
        // Số HĐ / Ngày TT / PO/HĐ / chứng từ / link / Số HĐ HN: admin nhập trực tiếp (dự án đã chốt).
        const editable2 = canInv && r.sheetId && q.status === "converted";
        // ĐÈN ĐỎ = việc CẦN làm; nhập/làm xong → TRẮNG lại. "Số PO/HĐ" có giá trị thì kích hoạt
        // 4 việc: chứng từ gửi đi, chứng từ trả về, link hoá đơn, ký chứng từ.
        const poFilled = !!r.poNumber;
        const hnNeed = r.hnStatus === "approved" && r.hanoi > 0 && !r.hnInvoiceNo; // BG Hà Nội đã DUYỆT mà chưa có Số HĐ HN
        const red = (need) => need ? ' style="background:#ffdede"' : '';
        const txtCell = (cls, val, need, ph, w = 110) => editable2
          ? `<td${red(need)}><input class="${cls}" data-sheet="${r.sheetId}" value="${escapeHtml(val || "")}" placeholder="${ph}" style="width:${w}px" /></td>`
          : `<td${red(need)}>${val ? escapeHtml(val) : dash}</td>`;
        const dateCell = (cls, val, need) => editable2
          ? `<td${red(need)}><input type="date" class="${cls}" data-sheet="${r.sheetId}" value="${val ? new Date(val).toISOString().slice(0, 10) : ""}" style="width:140px" /></td>`
          : `<td${red(need)}>${val ? fmtDate(val) : dash}</td>`;
        // Ký Chứng từ: đỏ khi đã có Số PO/HĐ mà CHƯA ký; ký xong → trắng.
        const kyRed = (poFilled && !r.signedAt) ? ' style="background:#ffdede"' : '';
        const kyCell = r.signedAt
          ? `<td title="${escapeHtml((r.signedByName || "Đã ký") + " · " + fmtDate(r.signedAt))}"><span class="status approved">✓ Đã Ký</span>${canSignNow && r.sheetId ? ` <button class="ky-undo" data-sheet="${r.sheetId}" title="Bỏ ký">✕</button>` : ""}</td>`
          : (canSignNow && r.sheetId ? `<td${kyRed}><button class="btn btn-sm ky-btn" data-sheet="${r.sheetId}">Ký</button></td>` : `<td${kyRed}>${dash}</td>`);
        // Status: BG đã chốt → badge luồng hoá đơn (Hoá đơn/Thanh toán/Done); khác → status thường.
        const inv = INV[r.invStatus] || INV.invoice;
        const statusCell = q.status === "converted"
          ? `<td><span class="status ${inv.c}">${inv.l}</span></td>`
          : `<td><span class="status ${q.status}">${statusLabel(q.status)}</span></td>`;
        const invNoCell = editable2
          ? `<td><input class="inv-no" data-sheet="${r.sheetId}" value="${escapeHtml(r.invoiceNo || "")}" placeholder="Số HĐ" style="width:110px" /></td>`
          : `<td>${r.invoiceNo ? escapeHtml(r.invoiceNo) : dash}</td>`;
        const paidCell = editable2
          ? `<td><input type="date" class="inv-paid" data-sheet="${r.sheetId}" value="${r.paidAt ? new Date(r.paidAt).toISOString().slice(0, 10) : ""}" style="width:140px" /></td>`
          : `<td>${r.paidAt ? fmtDate(r.paidAt) : dash}</td>`;
        // Link Hoá Đơn: đỏ khi có PO/HĐ mà chưa có link; đã nhập → hiện link bấm được (trắng).
        const linkNeed = poFilled && !r.invoiceLink;
        const linkCell = editable2
          ? `<td${red(linkNeed)}><input class="inv-link" data-sheet="${r.sheetId}" value="${escapeHtml(r.invoiceLink || "")}" placeholder="Link HĐ" style="width:120px" /></td>`
          : `<td${red(linkNeed)}>${r.invoiceLink ? `<a href="${escapeHtml(r.invoiceLink)}" target="_blank" rel="noopener">Xem HĐ</a>` : dash}</td>`;
        return `<tr class="qrow" data-id="${q.id}" title="Bấm để mở báo giá">
          ${statusCell}
          <td title="${escapeHtml(q.title)}"><strong>${escapeHtml(shortTitle(q.title))}</strong></td>
          <td>${r.hangMuc ? escapeHtml(r.hangMuc) : dash}</td>
          <td style="text-align:right">${fmtMoney(r.baoGia)}</td>
          <td style="text-align:right">${r.hcm ? fmtMoney(r.hcm) : dash}</td>
          <td style="text-align:right">${r.hanoi ? fmtMoney(r.hanoi) : dash}</td>
          <td style="text-align:right">${r.khach ? fmtMoney(r.khach) : dash}</td>
          <td><strong>${escapeHtml(r.code)}</strong></td>
          <td>${q.executionDate ? fmtDate(q.executionDate) : dash}</td>${txtCell("po-no", r.poNumber, false, "Số PO/HĐ")}
          <td>${(r.cty || cty) ? escapeHtml(r.cty || cty) : dash}</td>
          ${invNoCell}<td>${dash}</td>
          <td style="text-align:right">${fmtMoney(r.thanhTienVAT)}</td>
          ${paidCell}${dateCell("doc-sent", r.docSentAt, poFilled && !r.docSentAt)}${dateCell("doc-ret", r.docReturnedAt, poFilled && !r.docReturnedAt)}${linkCell}${txtCell("hn-no", r.hnInvoiceNo, hnNeed, "Số HĐ HN")}
          <td>${q.customerCode ? escapeHtml(q.customerCode) : dash}</td><td>${q.createdBy?.displayName ? escapeHtml(q.createdBy.displayName) : dash}</td>${kyCell}<td>${dash}</td>
        </tr>`;
      }).join("")}</tbody>
    </table></div>`;
    body.querySelectorAll("tr.qrow").forEach(tr => {
      tr.addEventListener("click", (e) => { if (e.target.closest("button,a,input")) return; goToQuote(parseInt(tr.dataset.id, 10)); });
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
    // Admin nhập Số Hoá Đơn / Ngày TT / Số PO/HĐ / chứng từ / link / Số HĐ HN → lưu + vẽ lại
    // để Status (Hoá đơn/Thanh toán/Done) + đèn đỏ-trắng cập nhật.
    const FIELD_OF = { "inv-no": "invoiceNo", "inv-paid": "paidAt", "po-no": "poNumber", "hn-no": "hnInvoiceNo", "inv-link": "invoiceLink", "doc-sent": "docSentAt", "doc-ret": "docReturnedAt" };
    body.querySelectorAll(".inv-no, .inv-paid, .po-no, .hn-no, .inv-link, .doc-sent, .doc-ret").forEach((inp) => inp.addEventListener("change", async (e) => {
      e.stopPropagation();
      const sheetId = inp.dataset.sheet;
      const cls = Object.keys(FIELD_OF).find((c) => inp.classList.contains(c));
      const val = inp.type === "date" ? (inp.value || null) : inp.value.trim();
      try {
        await api(`/api/quotes/sheets/${sheetId}/invoice`, { method: "PUT", body: JSON.stringify({ [FIELD_OF[cls]]: val }) });
        toast("Đã lưu", "success");
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
export async function renderAuditLog(el) {
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
// openModal / promptModal / confirmModal → moved to ./js/ui.js (step 4)

// ---------------- Permissions (Phân quyền) ----------------
export async function renderPermissions(el) {
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
