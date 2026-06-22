// pages/quotes.js — quote LIST + new-quote WIZARD + Account-HN screens (step 7 of the SPA
// modularization). The editor (renderEditor + grid) stays in app.js for now; the editor/shell
// helpers these pages call (render, goToQuote, codeLabel, shortTitle, drawItems, gridHeadHtml,
// newExtraGrid, extraTableSumLocal) are INJECTED via setQuoteDeps at boot to avoid a circular
// import with the entry module. Function bodies are an exact byte-for-byte copy of the former
// app.js — zero behavior change.
import { fmtMoney, fmtDate, escapeHtml, safeLogoSrc, STATUS_LABEL, statusLabel, ROLE_LABEL } from "../util.js?v=20260619";
import { state, can, canOnQuote } from "../core/state.js?v=20260619";
import { api } from "../core/api.js?v=20260619";
import { toast, skeleton, KBD, errorState, confirmModal } from "../ui.js?v=20260619";
import { pickCustomer } from "./admin.js?v=20260619j";

// Injected at boot (setQuoteDeps) — resolve to app.js's editor/shell functions (hoisted there).
let render, goToQuote, codeLabel, shortTitle, drawItems, gridHeadHtml, newExtraGrid, extraTableSumLocal;
export function setQuoteDeps(d) {
  ({ render, goToQuote, codeLabel, shortTitle, drawItems, gridHeadHtml, newExtraGrid, extraTableSumLocal } = d);
}

// account_hn: nhãn trạng thái LUỒNG HN cho danh sách (khác status báo giá khách). Tái dùng
// màu .status có sẵn để khỏi thêm CSS.
const HN_LIST_STATUS = {
  assigned:  { label: "Đang làm", cls: "sent" },
  submitted: { label: "Chờ duyệt", cls: "pending" },
  approved:  { label: "Đã duyệt", cls: "approved" },
  rejected:  { label: "Bị trả", cls: "rejected" },
};
function hnListBadge(st) {
  const s = HN_LIST_STATUS[st] || { label: "Chưa giao", cls: "draft" };
  return `<span class="status ${s.cls}">${s.label}</span>`;
}

export async function renderList(el) {
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
      ${can("quote:create") ? `<button class="btn btn-primary" id="btn-new">+ Tạo báo giá</button>` : ""}
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
  document.getElementById("btn-new")?.addEventListener("click", () => {
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
    const isAccountHn = state.user?.role === "account_hn";   // account_hn: ẩn tiền/khách/thao tác, hiện "Người giao" + trạng thái HN
    body.innerHTML = `
      <div class="tbl-scroll">
      <table class="list-table cards-sm">
        <thead>
          <tr>
            <th scope="col">Mã dự án</th>${isAdmin ? `<th scope="col">Người tạo</th>` : ""}${isAccountHn ? `<th scope="col">Người giao</th>` : ""}<th scope="col">Tiêu đề</th>
            <th scope="col">Ngày</th><th scope="col">Sheet</th>${isAccountHn ? "" : `<th scope="col" style="text-align:right">Tổng (VNĐ)</th>`}
            <th scope="col">Công ty</th>${isAccountHn ? "" : `<th scope="col">Khách</th><th scope="col">Mã KH</th>`}
            <th scope="col">Trạng thái</th>${isAccountHn ? "" : `<th scope="col">Thao tác</th>`}
          </tr>
        </thead>
        <tbody>
          ${state.quoteList.map(q => `
            <tr class="qrow" data-id="${q.id}" title="Bấm để mở báo giá">
              <td data-label="Mã dự án"><strong>${escapeHtml(codeLabel(q))}</strong></td>
              ${isAdmin ? `<td data-label="Người tạo">${escapeHtml(q.createdBy?.displayName || "")}</td>` : ""}
              ${isAccountHn ? `<td data-label="Người giao">${escapeHtml(q.createdBy?.displayName || "—")}</td>` : ""}
              <td data-label="Tiêu đề" title="${escapeHtml(q.title)}">${escapeHtml(shortTitle(q.title))}</td>
              <td data-label="Ngày">${fmtDate(q.quoteDate)}</td>
              <td data-label="Sheet" style="text-align:center">${q.sheetCount ?? (q.sheets?.length || 0)}</td>
              ${isAccountHn ? "" : `<td data-label="Tổng (VNĐ)" style="text-align:right">${fmtMoney(q.total)}</td>`}
              <td data-label="Công ty">${escapeHtml(q.company?.shortName || q.company?.name || "")}</td>
              ${isAccountHn ? "" : `<td data-label="Khách">${escapeHtml(q.toCompany)}</td>
              <td data-label="Mã KH">${q.customerCode ? `<strong>${escapeHtml(q.customerCode)}</strong>` : "—"}</td>`}
              <td data-label="Trạng thái">${isAccountHn ? hnListBadge(q.hnStatus) : `<span class="status ${q.status}">${statusLabel(q.status)}</span>`}</td>
              ${isAccountHn ? "" : `<td class="cell-actions">
                <div class="row-actions">
                  <button class="act-btn act-excel" data-act="excel" data-id="${q.id}" title="Tải file Excel">📥 Excel</button>
                  <button class="act-btn" data-act="dup" data-id="${q.id}" title="Nhân bản thành báo giá mới">📋 Nhân bản</button>
                  <button class="act-btn" data-act="revise" data-id="${q.id}" title="Tạo bản mới CÙNG mã dự án (v2, v3…) để gửi khách">➕ Bản mới</button>
                  ${canDelete(q) ? `<button class="act-btn act-del" data-act="del" data-id="${q.id}" title="Xóa báo giá">🗑 Xóa</button>` : ""}
                </div>
              </td>`}
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
      // Disable trong lúc gửi: chặn bấm đúp (vd "Bản mới" gửi 2 request → 2 bản cùng version).
      b.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (b.disabled) return;
        b.disabled = true;
        try { await listAction(b.dataset.act, parseInt(b.dataset.id, 10)); }
        finally { b.disabled = false; }
      });
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

export function renderNewQuote(el) {
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
export function renderAccountHnView(el, q) {
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
export function renderManagerHnPanel(q) {
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
