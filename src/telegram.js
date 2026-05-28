import { config } from "./config.js";
import { logger } from "./logger.js";

/** Send a Telegram message. No-op if TELEGRAM_BOT_TOKEN not set. */
export async function sendTelegram({ chatId, text, parseMode = "Markdown" }) {
  if (!config.TELEGRAM_BOT_TOKEN) {
    logger.info({ chatId, textLen: text?.length }, "telegram skipped (no token)");
    return { skipped: true };
  }
  try {
    const r = await fetch(`https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: parseMode, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(8_000),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) {
      logger.warn({ chatId, status: r.status, body }, "telegram non-ok");
      return { error: body.description || `status ${r.status}` };
    }
    return { ok: true, messageId: body.result?.message_id };
  } catch (e) {
    logger.error({ err: e.message, chatId }, "telegram send failed");
    return { error: e.message };
  }
}
