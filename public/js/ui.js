// ui.js — DOM/interaction primitives (step 4 of the SPA modularization): toasts,
// skeletons, keyboard-activation, inline field errors, theme, and the modal stack
// (openModal/promptModal/confirmModal). All leaf: the only cross-module dependency
// is escapeHtml from util.js — NO state / api / render here, so these never pull the
// app graph in and stay unit-friendly.

import { escapeHtml } from "./util.js?v=20260623b";

export function toast(msg, type = "info") {
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
export function skeleton(rows = 5, tall = false) {
  return `<div class="skeleton">${Array.from({ length: rows })
    .map(() => `<div class="sk-line${tall ? " tall" : ""}"></div>`).join("")}</div>`;
}

// Attribute string that makes a non-button element keyboard-operable. Add it to
// any clickable <div>/<span> and they become focusable + Enter/Space activatable
// (WCAG 2.1.1). One delegated handler (installKeyActivation) does the activation,
// so this survives re-renders without per-element wiring.
export const KBD = 'role="button" tabindex="0" data-kbd';
export function installKeyActivation() {
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

// Standard error state for a page whose data failed to load — replaces the
// "stuck skeleton" anti-pattern with a clear message + a retry button.
export function errorState(message, onRetry) {
  const id = "err-retry-" + Math.random().toString(36).slice(2);
  setTimeout(() => { const b = document.getElementById(id); if (b && onRetry) b.addEventListener("click", onRetry); }, 0);
  return `<div class="error-state" role="alert">
    <div class="es-icon">⚠️</div>
    <div class="es-msg">${escapeHtml(message || "Không tải được dữ liệu")}</div>
    <button class="btn btn-primary" id="${id}">Thử lại</button>
  </div>`;
}

// Map server validation details ([{path,message}]) to INLINE field errors instead
// of a disappearing toast. Finds an input by id f-<path> / w-<path> or name=<path>,
// sets aria-invalid, shows a .field-err message, and focuses the first bad field.
// Returns true if at least one field was matched.
export function applyFieldErrors(err) {
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

// Theme: persist in localStorage, default to OS preference on first visit.
export function initTheme() {
  let t = localStorage.getItem("theme");
  if (!t) {
    t = (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light";
  }
  document.documentElement.setAttribute("data-theme", t);
}
export function toggleTheme() {
  const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("theme", next);
}

// ---- Modal stack ----
let _modalSeq = 0;
export function openModal(title, bodyHtml) {
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
export function promptModal(title, label, opts = {}) {
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
export function confirmModal(title, message, opts = {}) {
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
