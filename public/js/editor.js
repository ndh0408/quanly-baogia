// editor.js — the quote EDITOR + spreadsheet GRID engine (step 8, final SPA module):
// renderEditor (editing screen), drawItems (~1000-line grid: render, keyboard nav, clipboard,
// undo/redo, formula bar ƒ), internal-tables grids, summary, plus member/version modals.
// Largest + most stateful module, but ALL grid state lives in the per-call `grid` closure —
// no module-level mutable state. Function bodies are an exact byte-for-byte copy of the former
// app.js — zero behavior change.
//
// Shell/quotes helpers it calls back (render/leaveEditorGuard/codeLabel from app.js,
// renderManagerHnPanel from quotes.js) are INJECTED via setEditorDeps at boot — keeping the
// dependency graph a one-way star around app.js (no import cycle with quotes.js).
import { parseClipboardTSV, cellsToTSV, cellsToHTML, parseLooseNumber, reconstructExportRows, looksLikeExportPaste } from "../grid-clipboard.js?v=20260623b";
import { fmtMoney, fmtDate, quoteTotals, vnDateText, escapeHtml, groupLetter, sheetSubtotalGrouped, statusLabel, ROLE_LABEL_FULL } from "./util.js?v=20260623b";
import { state, can, sheetUsesDays, clearDaysIfUnused } from "./core/state.js?v=20260623b";
import { api } from "./core/api.js?v=20260623b";
import { toast, skeleton, KBD, applyFieldErrors, openModal, promptModal, confirmModal } from "./ui.js?v=20260623b";
import { refreshPreview } from "./preview.js?v=20260623b";

// Injected at boot (setEditorDeps); used only inside function bodies, so the destructure into
// these lets keeps every moved body byte-for-byte unchanged (no _deps.* rewrite needed).
let render, leaveEditorGuard, codeLabel, renderManagerHnPanel;
export function setEditorDeps(d) {
  ({ render, leaveEditorGuard, codeLabel, renderManagerHnPanel } = d);
}

export function renderEditor(el, quote) {
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

  // Mirror the server rule: admin edits all; manager edits only own or quotes
  // they're a member of — and only while NOT terminal (chưa converted/lost).
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
        <details id="extra-collapse" class="extra-collapse" ${state._extraOpen ? "open" : ""}>
          <summary class="extra-collapse-sum"><strong>Bảng nội bộ</strong> <span class="muted" id="extra-collapse-totals">(bấm để mở)</span></summary>
          <div id="extra-tables-wrap" class="extra-tables-wrap"></div>
        </details>

        <div class="actions">
          ${editable ? `<button class="btn btn-primary" id="btn-save">Lưu</button>` : ""}
          ${!isNew && !["converted", "lost"].includes(q.status) && can("quote:send") ? `<button class="btn btn-success" id="btn-convert">✓ Khách chốt</button>` : ""}
          ${!isNew && !["converted", "lost"].includes(q.status) && can("quote:send") ? `<button class="btn btn-danger" id="btn-lost">✗ Khách không chốt</button>` : ""}
          ${!isNew ? `<div class="kebab-wrap">
            <button class="btn kebab-btn" id="btn-more" aria-haspopup="true" aria-expanded="false" title="Thêm thao tác">⋯</button>
            <div class="kebab-menu" id="more-menu" hidden role="menu">
              <button id="btn-excel" role="menuitem">Tải Excel gửi khách</button>
              <button id="btn-pdf" role="menuitem">Tải PDF gửi khách</button>
              <button id="btn-versions" role="menuitem">Lịch sử phiên bản</button>
              ${(state.user.role === "admin" || q.createdById === state.user.id) ? `<button id="btn-members" role="menuitem">Thành viên phụ trách</button>` : ""}
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
    document.getElementById("extra-collapse")?.addEventListener("toggle", (e) => { state._extraOpen = e.target.open; });   // nhớ trạng thái mở/đóng khu bảng nội bộ

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
  const convertBtn = document.getElementById("btn-convert");
  if (convertBtn) convertBtn.addEventListener("click", async () => {
    if (!(await confirmModal("Khách chốt", "Khách đã đồng ý — đánh dấu báo giá này ĐÃ CHỐT?", { confirmText: "Đã chốt" }))) return;
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

// sheetSubtotalGrouped → moved to ./js/util.js (step 5, shared by editor + preview)

// sheetUsesDays / clearDaysIfUnused → moved to ./js/core/state.js (step 2)

// ===== Bảng nội bộ (CHỈ quản lý — KHÔNG xuất Excel) =====
// Mỗi bảng nội bộ là MỘT LƯỚI ĐẦY ĐỦ y hệt báo giá (tái dùng drawItems): chọn template
// (GN/CLF có-ngày/không-ngày), công thức ƒ, copy/cut/paste, phím tắt Enter/Shift+Enter/mũi
// tên/Tab, nhóm cha/con/hàng con/dòng thông tin, "Hiện Thành Tiền nhóm", Tổng bảng — chỉ
// KHÁC duy nhất là KHÔNG xuất Excel. Mỗi bảng có grid-state + tableSel riêng (#extra-grid-N)
// nên không đụng lưới chính. Tổng theo loại (HCM/HN/KH) đổ sang trang Quản lý dự án.
const EXTRA_CATS = [["hcm", "Chi Phí HCM"], ["hanoi", "Báo Giá Hà Nội"], ["khach", "Phí Khách Hàng"]];
function extraCatLabel(c) { return ({ hcm: "Chi Phí HCM", hanoi: "Báo Giá Hà Nội", khach: "Phí Khách Hàng" })[c] || c; }
// State lưới riêng cho mỗi bảng nội bộ (KHÔNG lưu vào DB — sẽ là non-enumerable).
export function newExtraGrid() { return { sel: null, selSheet: 0, copyBuf: null, _copyToken: 0, undo: [], redo: [], previewOpen: false, focusSnap: null, _dirty: false, requestDraw: null }; }
// <thead> theo template (giống renderEditor) — drawItems chỉ fill tbody/tfoot nên thead dựng riêng.
export function gridHeadHtml(showDetail, usesDays, editable, approveCol) {
  const labels = ["STT", "Hạng Mục", showDetail ? "Chi Tiết" : null, "ĐVT", "SỐ LƯỢNG", usesDays ? "SỐ NGÀY" : null, "ĐƠN GIÁ", "THÀNH TIỀN", "GHI CHÚ"].filter(Boolean);
  return `<thead>
    <tr class="col-letters" aria-hidden="true">${labels.map((_, i) => `<th class="col-letter">${groupLetter(i)}</th>`).join("")}${approveCol ? `<th class="col-letter"></th>` : ""}${editable ? `<th class="col-letter"></th>` : ""}</tr>
    <tr>
      <th style="width:50px">STT</th><th>Hạng Mục</th>
      ${showDetail ? `<th>Chi Tiết</th>` : ""}
      <th style="width:80px">ĐVT</th><th style="width:90px">SỐ LƯỢNG</th>
      ${usesDays ? `<th style="width:80px">SỐ NGÀY</th>` : ""}
      <th style="width:130px">ĐƠN GIÁ&#10;(VNĐ)</th><th style="width:140px">THÀNH TIỀN&#10;(VNĐ)</th><th style="width:150px">GHI CHÚ</th>
      ${approveCol ? `<th style="width:120px">DUYỆT</th>` : ""}
      ${editable ? `<th style="width:36px"></th>` : ""}
    </tr>
  </thead>`;
}
// Tổng 1 sheet nội bộ — KHỚP CHÍNH XÁC src/quoteUtils.js extraTableSum (số đổ sang
// Quản lý dự án): bỏ section/subsection/info, qty×(days nếu>0)×price, KHÔNG hệ số nhóm.
export function extraTableSumLocal(t) {
  const approvedOnly = t && (t.category === "hcm" || t.category === "khach");   // HCM/Phí KH: chỉ cộng hàng đã DUYỆT
  return ((t && t.items) || []).reduce((acc, it) => {
    if (it.kind === "section" || it.kind === "subsection" || it.kind === "info") return acc;
    if (approvedOnly && !it.approved) return acc;
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
          <div class="tbl-scroll"><table class="excel-table" id="extra-grid-active">${gridHeadHtml(showDetail, usesDays, editable, t && (t.category === "hcm" || t.category === "khach"))}<tbody></tbody><tfoot></tfoot></table></div>
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
        drawItems(q, t, editable, tpl && tpl.code, usesDays, t._grid, { tableSel: "#extra-grid-active", fxBar: false, totalLabel: "sheet", subtotalFn: (sh) => extraTableSumLocal(sh), approveCol: t.category === "hcm" || t.category === "khach", onRedraw: () => { window._editorDirty = true; updCatTotal(t.category); }, onCellInput: () => updCatTotal(t.category) });
      } catch (err) { console.error("[extra grid]", err); }
    }

    // Tóm tắt Tổng từng loại lên thanh THU GỌN (để thấy ngay khi đóng, khỏi mở ra).
    const sumEl = document.getElementById("extra-collapse-totals");
    if (sumEl) sumEl.textContent = `— HCM ${fmtMoney(catTotal("hcm"))} · HN ${fmtMoney(catTotal("hanoi"))} · KH ${fmtMoney(catTotal("khach"))} · ${tables.length} sheet`;

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

export function drawItems(q, activeSheet, editable, tplCode, usesDays, grid, opts = {}) {
  // opts.tableSel: chọn bảng đích ("#items-table" mặc định, hoặc "#extra-grid-N" cho lưới
  // NỘI BỘ). opts.fxBar=false: bỏ thanh công thức (singleton — chỉ lưới chính dùng).
  // opts.onRedraw: thay updateSummary khi vẽ lại lưới nội bộ. → drawItems chạy được nhiều nơi.
  const tableSel = opts.tableSel || "#items-table";
  const internalNoteCol = !!opts.internalNote;   // cột "Ghi chú nội bộ" — CHỈ lưới chính, KHÔNG xuất Excel (không có ở bảng nội bộ)
  const approveCol = !!opts.approveCol;          // cột "Duyệt" theo hàng — CHỈ bảng nội bộ HCM/Phí KH
  const canApprove = state.user?.role === "admin";   // CHỈ admin được tick duyệt (server cũng chặn)
  // Ô "Duyệt" 1 hàng: checkbox (admin mới bấm được) + ngày đã duyệt. Tiền hàng vẫn hiện, nhưng
  // chỉ cộng vào Tổng khi đã duyệt (extraTableSumLocal). Server đóng dấu ngày/người duyệt khi lưu.
  const approveCellHtml = (it, i) => {
    const dt = it.approved && it.approvedAt ? `<span class="ap-date">✓ ${escapeHtml(fmtDate(it.approvedAt))}</span>` : "";
    return `<label class="ap-wrap"><input type="checkbox" class="ap-check" data-ap="${i}" ${it.approved ? "checked" : ""} ${canApprove ? "" : "disabled"} title="${canApprove ? "Duyệt hàng này" : "Chỉ admin được duyệt"}" /> Duyệt</label>${dt}`;
  };
  const tbody = document.querySelector(`${tableSel} tbody`);
  const showDetail = !!state.templates.find(t => t.code === tplCode)?.layout?.hasDetail;
  // Fields that allow multi-line (Shift+Enter or paste with \n)
  const multilineFields = new Set(["name", "detail", "notes", "internalNote"]);

  // Numeric cells (số lượng / đơn giá / số ngày / thành tiền) display with VN
  // thousand-dots and show BLANK when zero/empty (so empty rows aren't full of "0").
  const fmtNumCell = (v) => {
    const n = Number(v);
    if (!n || isNaN(n)) return "";                       // 0 / rỗng → ô trống
    if (Number.isInteger(n)) return n.toLocaleString("vi-VN");   // số chẵn → KHÔNG ,00
    // Có phần lẻ → hiện ĐÚNG 2 số, CẮT bớt chứ KHÔNG làm tròn: 5,997→5,99 · 3,2→3,20.
    // toFixed(4) khử nhiễu float (giá trị gốc tối đa 4 lẻ), rồi lấy 2 số đầu của phần lẻ.
    const [intp, dec] = Math.abs(n).toFixed(4).split(".");
    const out = Number(intp).toLocaleString("vi-VN") + "," + dec.slice(0, 2);
    return n < 0 ? "-" + out : out;
  };
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
        ${approveCol ? `<td class="col-approve">${approveCellHtml(it, i)}</td>` : ""}
        ${editable ? `<td class="col-action"><button class="add-sub" data-sub="${i}" title="Thêm hàng con">↳</button><button class="rm-row" data-rm="${i}" title="Xóa hàng">✕</button></td>` : ""}`;

  let sttNo = 0;
  let sectionIdx = -1;
  const infoColspan = 6 + (showDetail ? 1 : 0) + (usesDays ? 1 : 0) + (internalNoteCol ? 1 : 0) + (approveCol ? 1 : 0);
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
        <td class="col-stt"><input data-f="label" value="${escapeHtml(it.label || "")}" placeholder="${isSub ? "" : letter}" title="${isSub ? "Nhãn nhóm con (tuỳ chọn)" : `Chữ nhóm (để trống = tự ${letter})`}" ${dis} style="width:34px;text-align:center" /></td>
        <td class="col-hangmuc"><textarea data-f="name" rows="1" placeholder="${isSub ? "Tên nhóm con (tổng riêng, không cộng vào nhóm chính)" : "Tên nhóm (vd: Wallsticker)"}" ${dis}>${escapeHtml(it.name || "")}</textarea></td>
        ${showDetail ? `<td class="col-detail"></td>` : ""}
        <td class="col-dvt"><input data-f="unit" value="${escapeHtml(it.unit || "")}" ${dis} /></td>
        <td class="col-qty"><input data-f="quantity" inputmode="decimal" value="${fmtNumCell(it.quantity)}" ${dis} /></td>
        ${usesDays ? `<td class="col-qty"></td>` : ""}
        <td class="col-price">${fmtNumCell(subAmt)}</td>
        <td class="col-amount">${activeSheet.groupSubtotal ? fmtNumCell(subAmt * Math.max(1, Number(it.quantity) || 1)) : ""}</td>
        <td class="col-notes"><textarea data-f="notes" rows="1" placeholder="Ghi chú nhóm" ${dis}>${escapeHtml(it.notes || "")}</textarea></td>
        ${internalNoteCol ? `<td class="col-internal-note"><textarea data-f="internalNote" rows="1" placeholder="(không xuất Excel)" ${dis}>${escapeHtml(it.internalNote || "")}</textarea></td>` : ""}
        ${approveCol ? `<td class="col-approve"></td>` : ""}
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

  // "Duyệt" theo hàng (HCM/Phí KH) — CHỈ admin. Cập nhật model + ngày (optimistic; server đóng dấu
  // lại khi lưu) + tính lại Tổng (extraTableSumLocal chỉ cộng hàng đã duyệt) + Tổng-loại live.
  if (approveCol && canApprove) {
    tbody.querySelectorAll(".ap-check").forEach((cb) => {
      cb.addEventListener("change", (e) => {
        const i = parseInt(e.target.dataset.ap, 10);
        const it = activeSheet.items[i]; if (!it) return;
        it.approved = e.target.checked;
        it.approvedAt = it.approved ? new Date().toISOString() : null;
        it.approvedBy = it.approved ? (state.user?.id ?? null) : null;
        window._editorDirty = true;
        const td = e.target.closest("td");
        if (td) {
          td.querySelector(".ap-date")?.remove();
          if (it.approved) td.insertAdjacentHTML("beforeend", ` <span class="ap-date">✓ ${escapeHtml(fmtDate(it.approvedAt))}</span>`);
        }
        updateSectionSubtotals();
        if (opts.onCellInput) opts.onCellInput();
      });
    });
  }

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
  // Tự BẬT "Hiện Thành Tiền nhóm" khi user đặt Số Lượng > 1 cho 1 dòng NHÓM (section/subsection)
  // trên LƯỚI CHÍNH. Số Lượng nhóm CHỈ nhân vào tổng khi cờ này bật (money.js/excel/preview đều
  // theo cờ) → quên tick hay lỡ tay tắt sẽ làm TỔNG TIỀN ÂM THẦM SAI. Vì vậy hễ nhập SL nhóm >1
  // là bật toggle luôn. Chỉ BẬT (không tự tắt) và chỉ chạy khi user THỰC SỰ sửa SL nhóm (không
  // chạy lúc vẽ/load) → báo giá CŨ giữ nguyên cho tới khi đụng vào SL nhóm. Bỏ qua bảng nội bộ/HN
  // (opts.subtotalFn): tổng các bảng đó KHÔNG dùng hệ số nhóm nên bật toggle sẽ gây lệch hiển thị.
  const autoEnableGroupSub = (lo, hi) => {
    if (!editable || opts.subtotalFn || activeSheet.groupSubtotal) return;
    if (lo == null) { lo = 0; hi = activeSheet.items.length - 1; }
    if (hi == null) hi = lo;
    let hit = false;
    for (let i = lo; i <= hi && !hit; i++) {
      const it = activeSheet.items[i];
      if (it && (it.kind === "section" || it.kind === "subsection") && (Number(it.quantity) || 0) > 1) hit = true;
    }
    if (!hit) return;
    activeSheet.groupSubtotal = true;
    const cb = document.querySelector(`${tableSel} .gf-group-sub`);
    if (cb) cb.checked = true;
    window._editorDirty = true;
  };
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
    autoEnableGroupSub(rc.r0, rc.r1);   // kéo fill-handle xuống SL nhóm > 1 → tự bật toggle
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

  tbody.querySelectorAll("input[data-f], textarea[data-f]").forEach((inp) => {
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
          if (f === "quantity") autoEnableGroupSub(i);   // công thức cho SL nhóm > 1 cũng tự bật toggle
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
      if (f === "quantity") autoEnableGroupSub(i);   // SL nhóm > 1 → tự bật "Hiện Thành Tiền nhóm" (kẻo tổng âm thầm sai)
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
        autoEnableGroupSub(rcSel.r0, rcSel.r1);   // dán đè SL nhóm > 1 → tự bật toggle
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
      autoEnableGroupSub(startRow, startRow + built.length - 1);   // báo giá dán vào có SL nhóm > 1 → tự bật toggle
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
    autoEnableGroupSub(startRow, startRow + rows.length - 1);   // khối dán có SL nhóm > 1 → tự bật toggle
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
