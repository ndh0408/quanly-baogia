import { prisma } from "./db.js";
import { logger } from "./logger.js";
import { publish } from "./sse.js";
import { runOrQueue, QUEUES } from "./queue.js";

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
    const row = await prisma.notification.create({
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

    // Realtime push via SSE
    publish(userId, "notification", {
      id: row.id.toString(),
      title: row.title,
      body: row.body,
      link: row.link,
      createdAt: row.createdAt,
    });

    // Optional telegram broadcast (if user has a chat_id stored elsewhere — left as hook)
    if (notif.telegramChatId) {
      await runOrQueue(QUEUES.NOTIFY, "telegram", {
        chatId: notif.telegramChatId,
        text: `*${notif.title}*\n${notif.body}`,
      });
    }
  } catch (e) {
    logger.error({ err: e.message, userId }, "notify failed");
  }
}
