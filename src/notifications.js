import { prisma } from "./db.js";
import { logger } from "./logger.js";

/**
 * Create an in-app notification row for a user. Best-effort; failure logged not thrown.
 *
 * @param {number} userId
 * @param {object} notif
 * @param {string} notif.title
 * @param {string} notif.body
 * @param {string} [notif.link]
 * @param {string} [notif.resource]
 * @param {string|number} [notif.resourceId]
 * @param {"in_app"|"email"|"telegram"} [notif.channel]
 */
export async function notify(userId, notif) {
  try {
    await prisma.notification.create({
      data: {
        userId,
        channel: notif.channel || "in_app",
        title: notif.title,
        body: notif.body,
        link: notif.link || null,
        resource: notif.resource || null,
        resourceId: notif.resourceId != null ? String(notif.resourceId) : null,
      },
    });
  } catch (e) {
    logger.error({ err: e.message, userId }, "notify failed");
  }
}
