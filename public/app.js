// SPA quản lý báo giá - multi-sheet, multi-template
const app = document.getElementById("app");

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

async function boot() {
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
  if (!state.user) return renderLogin();
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
  app.innerHTML = `
    <div class="shell">
      <aside class="sidebar">
        <h2>Báo Giá</h2>
        <div class="org">Quản lý nội bộ</div>
        <nav class="menu">
          <a href="#" data-page="list" class="${state.page === "list" ? "active" : ""}">📋 Danh sách báo giá</a>
          <a href="#" data-page="new" class="${state.page === "new" ? "active" : ""}">➕ Tạo báo giá mới</a>
          ${role === "admin" ? `<a href="#" data-page="users" class="${state.page === "users" ? "active" : ""}">👥 Quản lý nhân viên</a>` : ""}
          <a href="#" data-page="profile" class="${state.page === "profile" ? "active" : ""}">🔒 Đổi mật khẩu</a>
        </nav>
        <div class="who">
          <strong>${escapeHtml(state.user.displayName)}</strong>
          <span>@${escapeHtml(state.user.username)}</span><br/>
          <span class="role-pill">${ROLE_LABEL[role]}</span><br/>
          <button class="logout">Đăng xuất</button>
        </div>
      </aside>
      <main class="main" id="main"></main>
    </div>`;
  document.querySelectorAll("[data-page]").forEach(a => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      state.page = a.dataset.page;
      state.currentQuote = null;
      render();
    });
  });
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
    <div id="list-body">Đang tải...</div>`;
  document.getElementById("filter-status").value = state.filter.status;

  const reload = async () => {
    const params = new URLSearchParams();
    if (state.filter.q) params.set("q", state.filter.q);
    if (state.filter.status) params.set("status", state.filter.status);
    try {
      state.quoteList = await api("/api/quotes?" + params.toString());
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
  if (state.user.role === "admin") return true;
  return q.createdById === state.user.id && (q.status === "draft" || q.status === "rejected");
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
function renderNewQuote(el) {
  el.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px">
      <h1>Tạo báo giá mới</h1>
      <button class="btn" id="btn-cancel">← Hủy</button>
    </div>
    <div class="editor" style="max-width:540px">
      <h3 style="margin-top:0">Bước 1: Chọn công ty + sheet đầu tiên</h3>
      <label style="display:block; margin-bottom:12px"><span style="font-size:13px; color:#555">Công ty của bạn</span>
        <select id="sel-company" style="width:100%; padding:8px; border:1px solid #d8dbe3; border-radius:6px; margin-top:4px">
          ${state.companies.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("")}
        </select>
      </label>
      <label style="display:block; margin-bottom:12px"><span style="font-size:13px; color:#555">Form/Template cho sheet đầu</span>
        <select id="sel-template" style="width:100%; padding:8px; border:1px solid #d8dbe3; border-radius:6px; margin-top:4px"></select>
      </label>
      <div class="actions" style="justify-content:flex-end">
        <button class="btn btn-primary" id="btn-create">Tạo & sửa →</button>
      </div>
    </div>`;

  const selC = document.getElementById("sel-company");
  const selT = document.getElementById("sel-template");
  const refreshTemplates = () => {
    const companyId = parseInt(selC.value, 10);
    const company = state.companies.find(c => c.id === companyId);
    selT.innerHTML = (company?.templates || []).map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join("");
  };
  refreshTemplates();
  selC.addEventListener("change", refreshTemplates);

  document.getElementById("btn-cancel").addEventListener("click", () => { state.page = "list"; render(); });
  document.getElementById("btn-create").addEventListener("click", async () => {
    try {
      const companyId = parseInt(selC.value, 10);
      const templateId = parseInt(selT.value, 10);
      if (!companyId || !templateId) { toast("Chọn công ty & template", "error"); return; }
      const { quoteNumber } = await api("/api/quotes/next-number");
      const template = state.templates.find(t => t.id === templateId);
      const draft = {
        quoteNumber, title: "", toCompany: "", toContact: "",
        companyId,
        fromContact: state.user.displayName || "",
        fromPhone: state.user.phone || "",
        fromTitle: state.user.title || "",
        fromAddress: "", city: "TP. Hồ Chí Minh",
        quoteDate: new Date().toISOString().slice(0, 10),
        vatPercent: 8,
        sheets: [{
          templateId, name: template.name,
          items: [{ name: "", detail: "", unit: "", quantity: 1, unitPrice: 0, days: null, notes: "" }],
        }],
      };
      state.currentQuote = { ...draft, _new: true };
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
          ${!isNew ? `<button class="btn" id="btn-excel">📥 Xuất Excel</button>` : ""}
          ${editable ? `<button class="btn btn-primary" id="btn-save">💾 Lưu</button>` : ""}
          ${editable && (isNew || q.status === "draft" || q.status === "rejected") ? `<button class="btn btn-warn" id="btn-submit">📨 Trình duyệt</button>` : ""}
          ${!isNew && q.status === "pending" && (state.user.role === "admin" || state.user.role === "manager") ? `
            <button class="btn btn-success" id="btn-approve">✅ Duyệt</button>
            <button class="btn btn-danger" id="btn-reject">❌ Từ chối</button>
          ` : ""}
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
    <div id="users-body">Đang tải...</div>`;
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

boot();
