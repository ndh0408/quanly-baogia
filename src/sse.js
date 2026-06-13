// Minimal Server-Sent Events broker. In-memory subscribers keyed by userId.
// For multi-instance setups, swap to Redis pub/sub later.

import { sseClients } from "./observability.js";

const subscribers = new Map(); // userId -> Set<res>

function recountClients() {
  let n = 0;
  for (const s of subscribers.values()) n += s.size;
  sseClients.set(n);
}

export function attach(req, res, userId) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // nginx
  res.flushHeaders?.();
  res.write(`: connected\n\n`);

  let set = subscribers.get(userId);
  if (!set) { set = new Set(); subscribers.set(userId, set); }
  set.add(res);
  recountClients();

  // Keepalive every 25s
  const ka = setInterval(() => {
    try { res.write(`: keepalive\n\n`); } catch {}
  }, 25_000);

  req.on("close", () => {
    clearInterval(ka);
    set.delete(res);
    if (set.size === 0) subscribers.delete(userId);
    recountClients();
  });
}

/** Push an event to all open connections for a user. Safe to call from any handler. */
export function publish(userId, event, data) {
  const set = subscribers.get(userId);
  if (!set || set.size === 0) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data ?? {})}\n\n`;
  for (const res of set) {
    try { res.write(payload); } catch { /* socket gone */ }
  }
}

/** Broadcast to everyone connected. */
export function broadcast(event, data) {
  for (const set of subscribers.values()) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data ?? {})}\n\n`;
    for (const res of set) {
      try { res.write(payload); } catch {}
    }
  }
}

/**
 * Broadcast a data-change hint so every connected client refreshes the relevant
 * list view without a manual reload. The client re-fetches through the normal
 * (permission-scoped) API, so broadcasting to everyone is safe.
 */
export function emitChange(entity, action, id) {
  broadcast("changed", { entity, action, id: id != null ? String(id) : null });
}

/** Tell one user their session is no longer valid (locked/deactivated/deleted) → client logs out. */
export function revokeSession(userId, reason) {
  publish(userId, "session:revoked", { reason: reason || "revoked" });
}

/** Tell one user to re-pull their capabilities (role changed) → client re-renders. */
export function refreshSession(userId) {
  publish(userId, "session:refresh", {});
}
