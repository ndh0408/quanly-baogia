import { config } from "./config.js";
import { logger } from "./logger.js";

/** Send a Telegram message. No-op if TELEGRAM_BOT_TOKEN not set. */
export async function sendTelegram({ chatId, text, parseMode = "" }: { chatId: string | number; text: string; parseMode?: string }) {
  if (!config.TELEGRAM_BOT_TOKEN) {
    logger.info({ chatId, textLen: text?.length }, "telegram skipped (no token)");
    return { skipped: true };
  }
  try {
    const r = await fetch(`https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // parse_mode CHỈ gửi khi caller chỉ định rõ — mặc định plain text để nội dung người dùng
      // (vd tiêu đề báo giá) không bị diễn giải thành link/định dạng (Markdown injection).
      body: JSON.stringify({ chat_id: chatId, text, ...(parseMode ? { parse_mode: parseMode } : {}), disable_web_page_preview: true }),
      signal: AbortSignal.timeout(8_000),
    });
    const body: any = await r.json().catch(() => ({}));
    if (!r.ok) {
      logger.warn({ chatId, status: r.status, body }, "telegram non-ok");
      return { error: body.description || `status ${r.status}` };
    }
    return { ok: true, messageId: body.result?.message_id };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error({ err: msg, chatId }, "telegram send failed");
    return { error: msg };
  }
}
