// Minimal Server-Sent Events broker. In-memory subscribers keyed by userId.
// For multi-instance setups, swap to Redis pub/sub later.

const subscribers = new Map(); // userId -> Set<res>

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

  // Keepalive every 25s
  const ka = setInterval(() => {
    try { res.write(`: keepalive\n\n`); } catch {}
  }, 25_000);

  req.on("close", () => {
    clearInterval(ka);
    set.delete(res);
    if (set.size === 0) subscribers.delete(userId);
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
