import { createHmac } from "node:crypto";
import net from "node:net";
import dns from "node:dns/promises";
import { prisma } from "./db.js";
import { logger } from "./logger.js";
import { isProd } from "./config.js";
import { runOrQueue, QUEUES } from "./queue.js";

// === SSRF guard ===========================================================
// Webhook URLs are admin-configurable and fetched server-side. Without these
// checks an attacker could target cloud metadata (169.254.169.254), localhost
// admin panels or internal services and read the response back via the
// deliveries log. We block private/reserved address space and re-resolve the
// hostname at delivery time to mitigate DNS rebinding.
function isPrivateIPv4(ip) {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  if (a === 0 || a === 10 || a === 127) return true;          // this-net, RFC1918, loopback
  if (a === 169 && b === 254) return true;                    // link-local (cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true;           // RFC1918
  if (a === 192 && b === 168) return true;                    // RFC1918
  if (a === 100 && b >= 64 && b <= 127) return true;          // CGNAT
  if (a === 192 && b === 0) return true;                      // 192.0.0.0/24, 192.0.2.0/24
  if (a === 198 && (b === 18 || b === 19)) return true;       // benchmarking
  if (a >= 224) return true;                                  // multicast + reserved + broadcast
  return false;
}
function isPrivateIPv6(ip) {
  const x = ip.toLowerCase();
  if (x === "::1" || x === "::") return true;
  if (x.startsWith("fe80") || x.startsWith("fc") || x.startsWith("fd")) return true; // link-local + ULA
  const m = x.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);          // IPv4-mapped
  if (m) return isPrivateIPv4(m[1]);
  return false;
}
function isBlockedIp(ip) {
  const fam = net.isIP(ip);
  if (fam === 4) return isPrivateIPv4(ip);
  if (fam === 6) return isPrivateIPv6(ip);
  return true; // not a valid IP literal → treat as unsafe
}

/** Throw (status 400) unless urlStr is a public http(s) endpoint. */
export async function assertPublicHttpUrl(urlStr) {
  let u;
  try { u = new URL(urlStr); } catch { throw Object.assign(new Error("URL webhook không hợp lệ"), { status: 400 }); }
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    throw Object.assign(new Error("Webhook chỉ chấp nhận http/https"), { status: 400 });
  }
  if (isProd && u.protocol !== "https:") {
    throw Object.assign(new Error("Webhook phải dùng https ở môi trường production"), { status: 400 });
  }
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host)) {
    if (isBlockedIp(host)) throw Object.assign(new Error("Webhook trỏ tới địa chỉ nội bộ — bị chặn"), { status: 400 });
    return;
  }
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".localhost")) {
    throw Object.assign(new Error("Hostname webhook bị chặn"), { status: 400 });
  }
  let addrs;
  try { addrs = await dns.lookup(host, { all: true }); } catch {
    throw Object.assign(new Error("Không phân giải được hostname webhook"), { status: 400 });
  }
  if (!addrs.length || addrs.some((a) => isBlockedIp(a.address))) {
    throw Object.assign(new Error("Webhook phân giải tới địa chỉ nội bộ — bị chặn"), { status: 400 });
  }
}

/**
 * Public domain events emitted by the app. Listed here so admins can wire
 * webhooks UI and we can statically validate event names.
 */
export const EVENTS = [
  "quote.created",
  "quote.updated",
  "quote.submitted",
  "quote.approved",
  "quote.rejected",
  "quote.sent",
  "quote.converted",
  "customer.created",
  "customer.updated",
];

function sign(payload, secret) {
  return "sha256=" + createHmac("sha256", secret).update(payload).digest("hex");
}

/** Emit an event: queues delivery for every matching active webhook. */
export async function emit(event, payload) {
  if (!EVENTS.includes(event)) {
    logger.warn({ event }, "unknown event emitted");
  }
  const hooks = await prisma.webhook.findMany({ where: { active: true } });
  const targets = hooks.filter((h) => h.events.includes(event));
  for (const h of targets) {
    await runOrQueue(QUEUES.WEBHOOK, "deliver", {
      webhookId: h.id,
      event,
      payload,
    }, { attempts: 5, backoff: { type: "exponential", delay: 5_000 } });
  }
}

/** Delivery handler invoked by worker (or inline if no Redis). */
export async function deliverWebhook({ webhookId, event, payload }) {
  const h = await prisma.webhook.findUnique({ where: { id: webhookId } });
  if (!h || !h.active) return { skipped: true };

  const body = JSON.stringify({ event, payload, timestamp: new Date().toISOString() });
  const sig = sign(body, h.secret);

  let status = 0, text = "";
  try {
    await assertPublicHttpUrl(h.url); // SSRF guard (re-resolves at delivery time)
    const res = await fetch(h.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-QLY-Event": event,
        "X-QLY-Signature": sig,
      },
      body,
      redirect: "error", // don't follow redirects into internal space
      signal: AbortSignal.timeout(15_000),
    });
    status = res.status;
    // Do NOT persist/echo the raw response body — that would turn any SSRF into a
    // read primitive via the deliveries log. Record only its length.
    const raw = await res.text();
    text = `len=${raw.length}`;
  } catch (e) {
    status = 0;
    text = e.message;
  }

  await prisma.webhookDelivery.create({
    data: {
      webhookId, event, payload,
      responseStatus: status, responseBody: text,
      deliveredAt: status >= 200 && status < 300 ? new Date() : null,
    },
  });
  if (status < 200 || status >= 300) throw new Error(`webhook ${webhookId} returned ${status}`);
  return { status };
}
