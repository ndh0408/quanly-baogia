// core/api.js — the single fetch wrapper every API call goes through (step 3 of the
// SPA modularization). Centralizes JSON parsing, the 401 session-expiry bounce, and
// validation-error message flattening. Depends only on `state`; the "session expired,
// re-render to login" UI action is INJECTED (setUnauthorizedHandler) so this leaf
// module never has to import the router/render — no import cycle.

import { state } from "./state.js?v=20260624b";

// app.js wires this to render() at boot. Default is a no-op so api() is usable
// (e.g. in unit tests) before any handler is set.
let onUnauthorized = () => {};
export function setUnauthorizedHandler(fn) { onUnauthorized = fn; }

// ─── Mã chống giả mạo (CSRF) ────────────────────────────────────────────────
// Máy chủ đòi header X-CSRF-Token cho MỌI thao tác ghi xác thực bằng phiên cookie (csrfGuard trong
// src/app.ts). Nhớ tạm ở đây, và THỬ LẠI MỘT LẦN khi máy chủ báo mã thiếu/không hợp lệ — cần thiết
// vì (a) lúc deploy, phiên đang mở được tạo TRƯỚC khi có tính năng này nên chưa có bí mật, và
// (b) đăng nhập gọi session.regenerate() nên mã cũ hết giá trị.
let _csrf = null;
let _csrfDangLay = null;
async function layCsrf(force = false) {
  if (_csrf && !force) return _csrf;
  if (_csrfDangLay) return _csrfDangLay;
  _csrfDangLay = fetch("/api/csrf-token", { credentials: "same-origin" })
    .then((r) => (r.ok ? r.json() : null))
    .then((b) => { _csrf = (b && b.token) || null; return _csrf; })
    .catch(() => null)
    .finally(() => { _csrfDangLay = null; });
  return _csrfDangLay;
}
/** Đăng nhập/đăng xuất làm mới phiên → mã cũ hết giá trị. */
export function resetCsrfToken() { _csrf = null; }
const _canGhi = (m) => m !== "GET" && m !== "HEAD" && m !== "OPTIONS";
const _laLoiCsrf = (b) => !!b && typeof b === "object" && (b.code === "csrf_token_missing" || b.code === "csrf_token_invalid");

export async function api(path, opts = {}) {
  const method = String(opts.method || "GET").toUpperCase();
  const goi = async (token) => {
    const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
    if (token) headers["X-CSRF-Token"] = token;
    const r = await fetch(path, { credentials: "same-origin", ...opts, headers });
    const ct = r.headers.get("content-type") || "";
    const b = ct.includes("application/json") ? await r.json() : await r.text();
    return { r, b };
  };

  let { r: res, b: body } = await goi(_canGhi(method) ? await layCsrf() : null);
  // 403 vì mã CSRF → lấy mã MỚI, thử lại ĐÚNG MỘT LẦN.
  if (res.status === 403 && _canGhi(method) && _laLoiCsrf(body)) {
    ({ r: res, b: body } = await goi(await layCsrf(true)));
  }
  // A 401 while already logged in = session expired → bounce to login.
  // But NOT during the login attempt itself (state.user is null), so the login
  // form can surface the real message ("Sai mật khẩu" / "Tài khoản bị khóa"…).
  if (res.status === 401 && state.user) {
    state.user = null;
    resetCsrfToken();
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
