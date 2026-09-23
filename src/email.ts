import nodemailer from "nodemailer";
import { logger } from "./logger.js";

let transporter: ReturnType<typeof nodemailer.createTransport> | null = null;
export const SMTP_TIMEOUT_MS = Math.max(1_000, Number(process.env.SMTP_TIMEOUT_MS) || 10_000);
let configured = false;

// Máy BẮT THƯ cục bộ (MailHog trên dev/staging, máy dev) — không có chặng nào qua Internet để MITM,
// và MailHog KHÔNG hỗ trợ STARTTLS: ép requireTLS ở đó là mọi thư mời/đặt lại mật khẩu đều lỗi.
const MAY_BAT_THU_CUC_BO = new Set(["mailhog", "localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * Có BẮT BUỘC STARTTLS không (AUTH-08, audit 2026-09-23).
 *
 * Không dùng TLS ngầm (465) thì mặc định BẮT BUỘC STARTTLS: thiếu cờ này nodemailer chỉ nâng cấp khi
 * máy chủ quảng bá STARTTLS — kẻ MITM gỡ lời quảng bá là đọc được token đặt lại mật khẩu trong thư.
 * Máy chủ không hỗ trợ TLS thì gửi thư LỖI (ghi log) thay vì gửi trần. Hai lối ra:
 *   · SMTP_HOST là máy bắt thư cục bộ (danh sách trên, hoặc tên kết thúc `.local`) → tự miễn;
 *   · SMTP_REQUIRE_TLS=false → tắt tường minh (relay nội bộ không có TLS).
 * Export để kiểm từng ca mà không phải dựng transporter.
 */
export function canBatStartTls(env: Record<string, string | undefined>): boolean {
  if (env.SMTP_SECURE === "true") return false;   // TLS ngầm — STARTTLS không áp dụng
  if (/^(0|false|no|off)$/i.test(String(env.SMTP_REQUIRE_TLS ?? "").trim())) return false;
  const host = String(env.SMTP_HOST ?? "").trim().toLowerCase();
  if (MAY_BAT_THU_CUC_BO.has(host) || host.endsWith(".local")) return false;
  return true;
}

function init() {
  if (configured) return transporter;
  configured = true;
  const host = process.env.SMTP_HOST;
  if (!host) {
    logger.warn("SMTP_HOST not set — emails will be discarded");
    return null;
  }
  transporter = nodemailer.createTransport({
    // TRẦN THỜI GIAN (RT-11). Mặc định nodemailer: connectionTimeout 120s, greetingTimeout 30s,
    // socketTimeout 600s. Đường MỜI thành viên gửi thư ĐỒNG BỘ trong request (userService) — SMTP
    // nuốt gói tin (tường lửa/NAT DROP) là admin chờ tới khi Cloudflare cắt 524, không thấy
    // `inviteUrl` dự phòng, bấm lại thì nhận 409 vì tài khoản đã được tạo. Job email ở worker cũng
    // chiếm slot tới 10 phút. SMTP_TIMEOUT_MS chỉnh trần kết nối/chào (mặc định 10s); socket ×3.
    connectionTimeout: SMTP_TIMEOUT_MS,
    greetingTimeout: SMTP_TIMEOUT_MS,
    socketTimeout: SMTP_TIMEOUT_MS * 3,
    host,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    requireTLS: canBatStartTls(process.env),
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
  return transporter;
}

const _esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c: string) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] ?? c));

// GỠ export `escapeEmailHtml`: được xuất khẩu "phòng khi chỗ gọi cần" nhưng suốt thời gian qua
// không chỗ nào gọi. `_esc` vẫn dùng nội bộ ở dưới; xuất khẩu nó ra ngoài chỉ mời gọi kiểu dùng
// "tự dựng HTML rồi tự escape", đúng thứ mà `renderEmailContent` sinh ra để không ai phải làm.

/**
 * Render one piece of email content SAFELY BY DEFAULT:
 *   - a plain string            → ESCAPED (safe for user-controlled data)
 *   - { text: "..." }           → ESCAPED
 *   - { html: "..." }           → raw, trusted template HTML (author-controlled)
 * This inverts the old "everything is trusted HTML" default so a caller that
 * accidentally passes user input can no longer inject markup into outbound mail.
 */
function emailContent(p: string | { html?: string; text?: string } | null | undefined) {
  if (p && typeof p === "object") {
    if (typeof p.html === "string") return p.html;
    if (typeof p.text === "string") return _esc(p.text);
    return "";
  }
  return _esc(String(p ?? ""));
}

/**
 * Branded, email-client-safe HTML (table layout + inline styles). Renders the
 * Gia Nguyễn Ads header, body paragraphs, an optional CTA button, and a footer.
 * `paragraphs`/`note` are ESCAPED by default; pass { html: "..." } for trusted
 * template markup. `name`/button label/url are always escaped here.
 */
export function brandedEmailHtml({ name, paragraphs = [], button, note }: { name?: any; paragraphs?: any[]; button?: any; note?: any } = {}) {
  const body = paragraphs.map((p) => `<p style="margin:0 0 16px;">${emailContent(p)}</p>`).join("");
  const btn = button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:10px 0 22px;"><tr>
           <td align="center" bgcolor="#f5b400" style="border-radius:10px;">
             <a href="${_esc(button.url)}" target="_blank" style="display:inline-block;padding:13px 34px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;color:#1f2510;text-decoration:none;border-radius:10px;">${_esc(button.label)}</a>
           </td></tr></table>
         <p style="margin:0 0 4px;font-size:12.5px;color:#6b7280;">Nếu nút không bấm được, sao chép liên kết sau vào trình duyệt:</p>
         <p style="margin:0 0 18px;word-break:break-all;"><a href="${_esc(button.url)}" style="color:#1d4ed8;font-size:12.5px;">${_esc(button.url)}</a></p>`
    : "";
  const noteHtml = note ? `<p style="margin:0;font-size:13px;color:#9ca3af;">${emailContent(note)}</p>` : "";
  return `<div style="background:#f4f5f7;margin:0;padding:24px 12px;font-family:Arial,'Segoe UI',Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center">
  <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:560px;max-width:100%;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #eceef1;">
    <tr><td style="background:#f5b400;padding:26px 28px;text-align:center;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center"><tr><td style="width:52px;height:52px;background:#1f2510;border-radius:13px;text-align:center;vertical-align:middle;font-family:Arial,Helvetica,sans-serif;font-size:21px;font-weight:800;color:#f5b400;">GN</td></tr></table>
      <div style="margin-top:12px;color:#1f2510;font-size:19px;font-weight:800;letter-spacing:.2px;">Gia Nguyễn Ads</div>
      <div style="color:#6b5300;font-size:12.5px;margin-top:3px;">Hệ thống Quản lý Báo Giá</div>
    </td></tr>
    <tr><td style="padding:30px 32px 12px;color:#1f2937;font-size:15px;line-height:1.65;">
      ${name ? `<p style="margin:0 0 16px;font-size:17px;font-weight:700;color:#111827;">Chào ${_esc(name)},</p>` : ""}
      ${body}
      ${btn}
      ${noteHtml}
    </td></tr>
    <tr><td style="padding:20px 32px 26px;border-top:1px solid #eef0f2;color:#9aa0a6;font-size:12px;line-height:1.5;">
      Email tự động từ <b style="color:#7a7f85;">Quản lý Báo Giá – Gia Nguyễn Ads</b>. Vui lòng không trả lời email này.
    </td></tr>
  </table>
  </td></tr></table>
</div>`;
}

/**
 * Send an email. No-op if SMTP_HOST not configured. Never throws — logs and continues.
 */
export async function sendEmail({ to, subject, html, text, attachments }: { to?: any; subject?: any; html?: any; text?: any; attachments?: any }) {
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
    const msg = e instanceof Error ? e.message : String(e);
    logger.error({ err: msg, to, subject }, "email send failed");
    return { error: msg };
  }
}
