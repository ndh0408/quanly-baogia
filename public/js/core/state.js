// Shared client state + state-core helpers (step 2 of the SPA modularization).
// `state` is a single mutable object; ES module live-bindings mean every module
// that imports it shares the SAME object, so `state.foo = ...` from any module is
// seen everywhere (do NOT reassign `state` itself). No DOM / api / util deps — a
// foundational leaf module that others import.

export const state = {
  user: null,
  page: "list",
  quoteList: [],
  currentQuote: null,
  filter: { q: "", status: "", page: 1, sort: "createdAt", order: "desc" },
  users: [],
  companies: [],   // [{ id, name, templates: [...] }]
  templates: [],   // [{ id, code, name, companyId }]
};

// Client-side permission mirror of the server catalog (from /api/auth/me).
// Only gates UI visibility — the server is always the source of truth.
export function can(perm) {
  const perms = state.user?.permissions;
  if (!perms) return false;
  if (perms.includes(perm)) return true;
  // ":own" is implied by ":all"
  if (perm.endsWith(":own")) return perms.includes(perm.replace(/:own$/, ":all"));
  return false;
}
export function canOnQuote(action, q) {
  if (can(`quote:${action}:all`)) return true;
  if (can(`quote:${action}:own`)) return q && q.createdById === state.user?.id;
  return false;
}

// Role-appropriate landing page when no specific route is requested: managers/
// admins get the overview dashboard; salespeople go straight to their list.
export function landingPage() {
  const r = state.user?.role;
  return (r === "admin" || r === "manager") ? "dashboard" : "list";
}

export function sheetUsesDays(sheet) {
  const tpl = state.templates.find(t => t.id === sheet.templateId);
  return !!(tpl && tpl.layout && tpl.layout.hasDays);
}
// A template WITHOUT a Số Ngày column must not carry per-item `days`: the grid and the
// Excel export both ignore it, but src/money.js would still multiply qty×days×price and
// inflate the STORED total. Clear stale days (e.g. after switching template) so all paths
// agree. Returns sheets with days nulled where the template has no days column.
export function clearDaysIfUnused(sheet) {
  if (!sheetUsesDays(sheet)) (sheet.items || []).forEach(it => { if (it.days != null) it.days = null; });
}
