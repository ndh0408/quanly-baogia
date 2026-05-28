import nodemailer from "nodemailer";
import { logger } from "./logger.js";

let transporter = null;
let configured = false;

function init() {
  if (configured) return transporter;
  configured = true;
  const host = process.env.SMTP_HOST;
  if (!host) {
    logger.warn("SMTP_HOST not set — emails will be discarded");
    return null;
  }
  transporter = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
  return transporter;
}

/**
 * Send an email. No-op if SMTP_HOST not configured. Never throws — logs and continues.
 */
export async function sendEmail({ to, subject, html, text, attachments }) {
  const t = init();
  if (!t) {
    logger.info({ to, subject }, "email skipped (no SMTP)");
    return { skipped: true };
  }
  try {
    const info = await t.sendMail({
      from: process.env.SMTP_FROM || "noreply@example.local",
      to: Array.isArray(to) ? to.join(",") : to,
      subject,
      html,
      text,
      attachments,
    });
    return { messageId: info.messageId };
  } catch (e) {
    logger.error({ err: e.message, to, subject }, "email send failed");
    return { error: e.message };
  }
}
