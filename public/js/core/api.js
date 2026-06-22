// core/api.js — the single fetch wrapper every API call goes through (step 3 of the
// SPA modularization). Centralizes JSON parsing, the 401 session-expiry bounce, and
// validation-error message flattening. Depends only on `state`; the "session expired,
// re-render to login" UI action is INJECTED (setUnauthorizedHandler) so this leaf
// module never has to import the router/render — no import cycle.

import { state } from "./state.js?v=20260622i";

// app.js wires this to render() at boot. Default is a no-op so api() is usable
// (e.g. in unit tests) before any handler is set.
let onUnauthorized = () => {};
export function setUnauthorizedHandler(fn) { onUnauthorized = fn; }

export async function api(path, opts = {}) {
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
    onUnauthorized();
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
