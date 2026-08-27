import type { Request } from "express";
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
/**
 * MÃ NHẬT KÝ ĐƯỢC TRUYỀN QUA BIẾN — khai tường minh vì máy không lần ra được.
 *
 * `writeNoteField` (src/services/personnelService.ts) nhận `action: string` từ nơi gọi rồi mới
 * `audit(req, action, …)`. Không bộ phân tích tĩnh nào theo được, nên hai mã dưới đây từng VÔ HÌNH
 * với web/src/pages/w2-auditActionCoverage.test.ts — và vì thế cũng vắng mặt trong bộ lọc "Hoạt
 * động" của trang Nhật ký, khiến admin không lọc ra được và cột Hoạt động hiện mã thô.
 *
 * BẮT BUỘC: thêm một lời gọi `audit()` mà đối số thứ hai KHÔNG phải chuỗi văn tự thì phải khai mã
 * vào đây. Bài test trên đỏ cho tới khi khai — cố ý, để chuyện đó không lặng lẽ trôi lần nữa.
 */
export const MA_NHAT_KY_GIAN_TIEP = [
  "personnel.accounting-note",
  "personnel.note",
] as const;

export async function audit(ctx: Request | null, action: string, opts: Record<string, any> = {}) {
  const actorId = opts.actorId ?? ctx?.session?.userId ?? null;
  // req.ip is resolved by Express from the configured trust-proxy hop count; the
  // raw X-Forwarded-For is client-controlled and must not be trusted for an
  // immutable audit trail (it would let an attacker forge the source IP).
  const ip = ctx?.ip || null;
  const ua = ctx?.headers?.["user-agent"] || null;
  // Mã request do `requestId` ở src/middleware.ts sinh. Nối nhật ký kiểm toán với log pino: không
  // có nó thì "ai làm gì" và "request nào chạy" là hai kho không ghép lại được.
  // `opts.requestId` cho phép job nền tự truyền mã của lượt chạy nếu có.
  const reqId = opts.requestId ?? ctx?.id ?? null;

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
        requestId: reqId ? String(reqId) : null,
      },
    });
  } catch (e) {
    logger.error({ err: e instanceof Error ? e.message : String(e), action }, "audit write failed");
  }
}

/** Shallow diff of two objects, returning {field: [before, after]} for changed scalar fields. */
export function diff(before: Record<string, unknown> | null | undefined, after: Record<string, unknown> | null | undefined, fields: string[]) {
  const out: Record<string, [unknown, unknown]> = {};
  for (const f of fields) {
    const a = before?.[f];
    const b = after?.[f];
    if (a !== b && JSON.stringify(a) !== JSON.stringify(b)) {
      out[f] = [a, b];
    }
  }
  return out;
}
