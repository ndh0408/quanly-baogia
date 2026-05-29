import { prisma } from "./db.js";
import { logger } from "./logger.js";
import { publish } from "./sse.js";
import { runOrQueue, QUEUES } from "./queue.js";
import { sendEmail } from "./email.js";
import { sendTelegram } from "./telegram.js";

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
/**
 * Send a notification on multiple channels. The in_app row always gets created
 * (it's the source of truth + SSE push); email/telegram fan out from the user's
 * configured contacts and the Setting-level channel preferences.
 *
 * Setting keys consulted:
 *   notif.channels.email     -> "always" | "important" | "off"
 *   notif.channels.telegram  -> "always" | "important" | "off"
 *
 * notif.important=true forces delivery even on "important" preference.
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

    // Fan-out to email + telegram based on user settings
    const [user, channelPrefs] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, displayName: true },
      }),
      prisma.setting.findUnique({ where: { key: "notif.channels" } }).catch(() => null),
    ]);

    const prefs = channelPrefs?.value || { email: "important", telegram: "off" };
    const shouldDeliver = (pref) => pref === "always" || (pref === "important" && notif.important);

    if (user?.email && shouldDeliver(prefs.email)) {
      await runOrQueue(QUEUES.EMAIL, "send", {
        to: user.email,
        subject: notif.title,
        text: `${notif.body}\n\n${notif.link ? `Link: ${notif.link}\n\n` : ""}— QuanLyBaoGia`,
        html: `<p><strong>${escapeHtml(notif.title)}</strong></p><p>${escapeHtml(notif.body)}</p>${
          notif.link ? `<p><a href="${escapeHtml(notif.link)}">Mở</a></p>` : ""
        }`,
      });
    }

    // Telegram: user-level chatId via Setting `telegram.user.<id>` OR per-call override
    const tgChatId = notif.telegramChatId
      ?? (await prisma.setting.findUnique({ where: { key: `telegram.user.${userId}` } }))?.value;
    if (tgChatId && shouldDeliver(prefs.telegram)) {
      await runOrQueue(QUEUES.NOTIFY, "telegram", {
        chatId: tgChatId,
        text: `*${notif.title}*\n${notif.body}${notif.link ? `\n${notif.link}` : ""}`,
      });
    }
  } catch (e) {
    logger.error({ err: e.message, userId }, "notify failed");
  }
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
