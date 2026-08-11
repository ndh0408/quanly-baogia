// Rate-limiter factory. When REDIS_URL is set, limiters are backed by Redis so
// the counters are SHARED across every app instance / pm2 cluster worker (an
// in-memory store is per-process and is trivially bypassed once you run more than
// one instance — and weakens login lockout). Falls back to the default in-memory
// store when Redis isn't configured (single-process / local dev).

import rateLimit from "express-rate-limit";
import type { Request, Response, NextFunction } from "express";
import { RedisStore } from "rate-limit-redis";
import { getRateLimitRedis, isRateLimitRedisReady, isQueueEnabled } from "./queue.js";
import { config } from "./config.js";
import { logger } from "./logger.js";

/**
 * @param {string} prefix  Redis key namespace for this limiter (e.g. "login").
 * @param {import("express-rate-limit").Options} options  Any express-rate-limit options.
 */
export function createLimiter(prefix: string, options: Partial<import("express-rate-limit").Options> = {}) {
  // Trong TEST: bỏ qua rate-limit. Limiter Redis dùng CHUNG mọi test process (vitest chạy song song)
  // → bộ đếm tích lũy vượt ngưỡng gây 429 GIẢ ở test không liên quan. Không test nào kiểm 429. Prod giữ nguyên.
  if (config.NODE_ENV === "test") return (_req: Request, _res: Response, next: NextFunction) => next();
  const opts: any = {
    standardHeaders: "draft-7",
    legacyHeaders: false,
    ...options,
  };
  if (isQueueEnabled()) {
    try {
      const client = getRateLimitRedis();
      if (client) {
        opts.store = new RedisStore({
          sendCommand: (...args: string[]) => client.call(...args),
          prefix: `rl:${prefix}:`,
        });
        // REDIS CHẾT → BỎ QUA LIMITER, KHÔNG chặn request.
        //
        // Đây là đánh đổi có chủ ý và cần nói rõ. Bỏ qua limiter nghĩa là trong lúc Redis chết, giới
        // hạn theo IP không còn. Nhưng lựa chọn còn lại là để mọi request treo (hành vi cũ, đo được:
        // 524 trên toàn bộ API) — tức tự gây ra sự cố toàn hệ thống vì một thành phần PHỤ TRỢ hỏng.
        //
        // Điều làm đánh đổi này chấp nhận được: khoá tài khoản khi sai mật khẩu nhiều lần nằm ở CSDL
        // (`User.failedAttempts` / `lockedUntil`), KHÔNG phụ thuộc Redis. Lớp chống dò mật khẩu quan
        // trọng nhất vẫn còn nguyên khi Redis chết; thứ mất tạm thời là giới hạn theo IP.
        opts.skip = () => !isRateLimitRedisReady();
      }
    } catch (e) {
      logger.warn({ err: e instanceof Error ? e.message : String(e), prefix }, "rate limiter falling back to in-memory store");
    }
  }
  return rateLimit(opts);
}
