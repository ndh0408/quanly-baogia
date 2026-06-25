// Server-Sent Events broker. Local subscribers are kept in-memory keyed by userId.
// When REDIS_URL is set, a Redis pub/sub backplane fans events out across ALL app
// instances (pm2 cluster / multiple pods) so a publish on instance A reaches a
// client connected to instance B — otherwise notifications and session-revoke
// events are silently lost across processes. Without Redis it behaves exactly as
// the previous single-process in-memory broker.

import type { Redis } from "ioredis";
import type { Request, Response } from "express";
import { sseClients } from "./observability.js";
import { config } from "./config.js";
import { logger } from "./logger.js";

const subscribers = new Map<number, Set<Response>>(); // userId -> Set<res>
const CHANNEL = "sse:events";
let pub: Redis | null = null; // Redis publisher (null = in-memory only)

function recountClients() {
  let n = 0;
  for (const s of subscribers.values()) n += s.size;
  sseClients.set(n);
}

// --- delivery to THIS process's connections only ---
function localPublish(userId: number, event: string, data: unknown) {
  const set = subscribers.get(userId);
  if (!set || set.size === 0) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data ?? {})}\n\n`;
  for (const res of set) {
    try { res.write(payload); } catch { /* socket gone */ }
  }
}
function localBroadcast(event: string, data: unknown) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data ?? {})}\n\n`;
  for (const set of subscribers.values()) {
    for (const res of set) {
      try { res.write(payload); } catch {}
    }
  }
}

// --- optional Redis backplane ---
// On every instance: PUBLISH goes to Redis; a dedicated subscriber receives the
// message (on this instance too) and delivers it to local connections. So publish
// must NOT also deliver locally when Redis is active — the subscriber handles it.
if (config.REDIS_URL) {
  (async () => {
    try {
      const { default: IORedis } = await import("ioredis");
      const opts = { maxRetriesPerRequest: null, enableReadyCheck: false };
      const pubClient: Redis = new (IORedis as any)(config.REDIS_URL, opts);
      pub = pubClient;
      pubClient.on("error", (e: any) => logger.warn({ err: e.message }, "sse redis pub error"));
      const sub = new (IORedis as any)(config.REDIS_URL, opts);
      sub.on("error", (e: any) => logger.warn({ err: e.message }, "sse redis sub error"));
      await sub.subscribe(CHANNEL);
      sub.on("message", (_chan: string, raw: string) => {
        try {
          const m = JSON.parse(raw);
          if (m.userId != null) localPublish(m.userId, m.event, m.data);
          else localBroadcast(m.event, m.data);
        } catch { /* ignore malformed */ }
      });
      logger.info("SSE Redis pub/sub backplane enabled");
    } catch (e) {
      pub = null;
      logger.warn({ err: e instanceof Error ? e.message : String(e) }, "SSE Redis backplane init failed — falling back to in-memory");
    }
  })();
}

export function attach(req: Request, res: Response, userId: number) {
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

/** Push an event to all open connections for a user (across instances when Redis is on). */
export function publish(userId: number, event: string, data: unknown) {
  if (pub) {
    pub.publish(CHANNEL, JSON.stringify({ userId, event, data })).catch(() => {});
    return;
  }
  localPublish(userId, event, data);
}

/** Broadcast to everyone connected (across instances when Redis is on). */
export function broadcast(event: string, data: unknown) {
  if (pub) {
    pub.publish(CHANNEL, JSON.stringify({ event, data })).catch(() => {});
    return;
  }
  localBroadcast(event, data);
}

/**
 * Broadcast a data-change hint so every connected client refreshes the relevant
 * list view without a manual reload. The client re-fetches through the normal
 * (permission-scoped) API, so broadcasting to everyone is safe.
 */
export function emitChange(entity: string, action: string, id?: number | string | null) {
  broadcast("changed", { entity, action, id: id != null ? String(id) : null });
}

/** Tell one user their session is no longer valid (locked/deactivated/deleted) → client logs out. */
export function revokeSession(userId: number, reason?: string) {
  publish(userId, "session:revoked", { reason: reason || "revoked" });
}

/** Tell one user to re-pull their capabilities (role changed) → client re-renders. */
export function refreshSession(userId: number) {
  publish(userId, "session:refresh", {});
}
