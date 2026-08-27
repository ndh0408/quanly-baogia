// Rate-limiter factory. When REDIS_URL is set, limiters are backed by Redis so
// the counters are SHARED across every app instance / pm2 cluster worker (an
// in-memory store is per-process and is trivially bypassed once you run more than
// one instance — and weakens login lockout). Falls back to the default in-memory
// store when Redis isn't configured (single-process / local dev).

import rateLimit from "express-rate-limit";
import type { Request, Response, NextFunction } from "express";
import { RedisStore } from "rate-limit-redis";
import { getRateLimitRedis, isRateLimitRedisReady, isQueueEnabled, rateLimitRedisSanSang } from "./queue.js";
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
        // REDIS CHẾT → RƠI VỀ BỘ ĐẾM TRONG BỘ NHỚ, KHÔNG bỏ hẳn limiter.
        //
        // Lựa chọn thứ nhất (hành vi cũ nhất) là để mọi lệnh Redis treo: đo được trên dev là 524
        // trên TOÀN BỘ API — tự gây sự cố toàn hệ thống vì một thành phần PHỤ TRỢ hỏng. Không nhận.
        //
        // Lựa chọn thứ hai (`opts.skip = () => !isRateLimitRedisReady()`) chữa được cái treo nhưng
        // chữa quá tay: nó TẮT SẠCH mọi limiter, chứ không riêng đăng nhập. Lập luận biện minh —
        // "khoá tài khoản nằm ở CSDL nên không mất gì" — chỉ đúng cho /login. Các limiter còn lại
        // KHÔNG có lớp CSDL dự phòng: /auth/forgot-password (không cần đăng nhập) thành máy bơm
        // email, backup/GDPR-export thành đường kéo dump không hạn chế.
        //
        // Lựa chọn ở đây: giữ kho Redis khi Redis khoẻ (bộ đếm dùng chung giữa các instance), và
        // chuyển sang một limiter dự phòng dùng MemoryStore khi Redis chết. Per-process nên nếu sau
        // này chạy nhiều instance thì trần bị nhân lên theo số instance — vẫn tốt hơn vô hạn, và
        // production hiện chỉ có MỘT container app nên gần như không mất độ chính xác.
        // LƯỢT LỆNH ĐẦU TIÊN ĐƯỢC CHỜ KẾT NỐI LÊN, mọi lượt sau trượt nhanh như cũ.
        //
        // `new RedisStore(...)` → `store.init()` bắn ngay hai lệnh `SCRIPT LOAD`, mà lúc `createApp()`
        // dựng 15 limiter thì ioredis chưa nối xong và kết nối này cố ý KHÔNG xếp hàng ngoại tuyến →
        // 15 vết stack ở đầu mỗi log khởi động production (đo trong scripts/ci/smoke-image.sh).
        //
        // Chờ ở đây KHÔNG làm chậm đường xử lý request: handler bên dưới chỉ gọi `limiterRedis` khi
        // `isRateLimitRedisReady()` đã đúng, nên `cho` luôn đã được tiêu thụ và gán null từ lúc khởi
        // động. Nếu Redis không bao giờ lên thì promise tự hết hạn sau 3s và hành vi y như trước.
        let cho: Promise<void> | null = rateLimitRedisSanSang();
        const limiterRedis = rateLimit({
          ...opts,
          store: new RedisStore({
            sendCommand: async (...args: string[]) => {
              // `await` TRƯỚC rồi mới gán null: `store.init()` bắn HAI `SCRIPT LOAD` song song, nếu
              // gán null trước thì lượt thứ hai thấy null và đi thẳng — đúng lỗi vừa vá, chỉ bớt một vết.
              if (cho) { await cho; cho = null; }
              return client.call(...args);
            },
            prefix: `rl:${prefix}:`,
          }),
        });
        // Không truyền `store` → express-rate-limit tự dựng MemoryStore RIÊNG cho limiter này, nên
        // hai limiter khác prefix không ăn chung quota. Bộ đếm giờ dọn của nó đã `unref()`.
        const duPhong = rateLimit({ ...opts });
        return (req: Request, res: Response, next: NextFunction) =>
          isRateLimitRedisReady() ? limiterRedis(req, res, next) : duPhong(req, res, next);
      }
    } catch (e) {
      logger.warn({ err: e instanceof Error ? e.message : String(e), prefix }, "rate limiter falling back to in-memory store");
    }
  }
  return rateLimit(opts);
}
