import { prisma } from "./db.js";
import { logger } from "./logger.js";

/**
 * Record an immutable audit event. Best-effort: never throws.
 *
 * @param {object} ctx        Express req-like object (for ip/UA/session) OR null for system events
 * @param {string} action     "login.success", "quote.create", "quote.update", etc
 * @param {object} [opts]
 * @param {string} [opts.resource]   e.g. "quote"
 * @param {string|number} [opts.resourceId]
 * @param {object} [opts.before]
 * @param {object} [opts.after]
 * @param {number} [opts.actorId]    override session.userId
 */
export async function audit(ctx, action, opts = {}) {
  const actorId = opts.actorId ?? ctx?.session?.userId ?? null;
  const ip = ctx?.ip || ctx?.headers?.["x-forwarded-for"]?.split(",")[0]?.trim() || null;
  const ua = ctx?.headers?.["user-agent"] || null;

  try {
    await prisma.auditEvent.create({
      data: {
        actorId: actorId ? Number(actorId) : null,
        action,
        resource: opts.resource || null,
        resourceId: opts.resourceId != null ? String(opts.resourceId) : null,
        before: opts.before ?? undefined,
        after: opts.after ?? undefined,
        ip,
        userAgent: ua,
      },
    });
  } catch (e) {
    logger.error({ err: e.message, action }, "audit write failed");
  }
}

/** Shallow diff of two objects, returning {field: [before, after]} for changed scalar fields. */
export function diff(before, after, fields) {
  const out = {};
  for (const f of fields) {
    const a = before?.[f];
    const b = after?.[f];
    if (a !== b && JSON.stringify(a) !== JSON.stringify(b)) {
      out[f] = [a, b];
    }
  }
  return out;
}
