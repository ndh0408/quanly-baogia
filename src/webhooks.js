import { createHmac } from "node:crypto";
import { prisma } from "./db.js";
import { logger } from "./logger.js";
import { runOrQueue, QUEUES } from "./queue.js";

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
    const res = await fetch(h.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-QLY-Event": event,
        "X-QLY-Signature": sig,
      },
      body,
      signal: AbortSignal.timeout(15_000),
    });
    status = res.status;
    text = (await res.text()).slice(0, 5000);
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
