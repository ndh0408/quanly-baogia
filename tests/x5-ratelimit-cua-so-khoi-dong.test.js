// RATE-LIMIT — CỬA SỔ KHỞI ĐỘNG: 15 VẾT STACK Ở ĐẦU MỖI LOG PRODUCTION.
//
// ── LỖI ─────────────────────────────────────────────────────────────────────
// `rate-limit-redis` nạp hai script Lua bằng `SCRIPT LOAD` NGAY trong `new RedisStore(...)`
// (→ `rateLimit()` → `store.init()`, xem node_modules/express-rate-limit: `config.store.init`).
// `createApp()` dựng 15 limiter Ở NGAY LÚC KHỞI ĐỘNG, trước khi ioredis nối xong — mà kết nối
// rate-limit CỐ Ý đặt `enableOfflineQueue: false` (trượt nhanh, không xếp hàng). Kết quả: mỗi
// limiter ném một lỗi và express-rate-limit in nguyên vết stack.
//
// KHÔNG hỏng chức năng: `retryableIncrement`/`get` của rate-limit-redis bắt lỗi EVALSHA rồi tự nạp
// lại script ở lần dùng đầu. Nhưng 15 vết stack (157 dòng) ở đầu mỗi log khởi động thì che mất lỗi
// thật, và ai đọc log sẽ tưởng rate-limit đang hỏng.
//
// ── ĐO Ở ĐÂU ────────────────────────────────────────────────────────────────
// Chỉ container production mới lộ ra: `createLimiter` THOÁT SỚM khi NODE_ENV=test
// (dòng đầu của hàm, để limiter Redis dùng chung không gây 429 giả giữa các file test), nên
// KHÔNG bài test trong tiến trình nào chạm tới nhánh có RedisStore được.
// Vế hành vi nằm ở `scripts/ci/smoke-image.sh`, bước "LOG KHỞI ĐỘNG KHÔNG ĐƯỢC CÓ VẾT STACK"
// (chạy trên container production thật; `scripts/ci/docker-smoke.sh` dựng image rồi gọi nó).
// Đã kiểm ngược: quay lại mã cũ thì bước đó đếm được 157 dòng stack; có bản vá thì 0.
//
// File này khoá phần CÓ THỂ kiểm trong tiến trình: bản thân `rateLimitRedisSanSang` và thứ tự
// `await` trong `sendCommand`.
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";

const REDIS_THAT = process.env.REDIS_URL;
if (!REDIS_THAT && process.env.REQUIRE_DB_TESTS === "1") {
  throw new Error("REQUIRE_DB_TESTS=1 nhưng thiếu REDIS_URL — cửa sổ khởi động rate-limit chỉ tồn tại khi có Redis");
}

const cu = { ...process.env };
afterEach(() => {
  for (const k of Object.keys(process.env)) if (!(k in cu)) delete process.env[k];
  Object.assign(process.env, cu);
});

/** Nạp lại src/queue.js với REDIS_URL chỉ định — trạng thái kết nối là biến MODULE nên phải reset. */
async function nap(redisUrl) {
  process.env.REDIS_URL = redisUrl;
  vi.resetModules();
  return await import("../src/queue.js");
}

describe.runIf(!!REDIS_THAT)("rateLimitRedisSanSang — chờ ĐÚNG một lượt lúc khởi động", () => {
  it("giải quyết khi Redis lên, và sau đó kết nối thật sự sẵn sàng", async () => {
    const q = await nap(REDIS_THAT);
    // Gọi NGAY — đúng thời điểm createLimiter gọi, tức lúc ioredis chưa nối xong.
    expect(q.isRateLimitRedisReady(), "vừa nạp module mà đã ready thì bài này không đo đúng cửa sổ").toBe(false);
    await q.rateLimitRedisSanSang(5000);
    expect(q.isRateLimitRedisReady(), "chờ xong mà kết nối vẫn chưa sẵn sàng → SCRIPT LOAD vẫn sẽ ném").toBe(true);
  }, 20_000);

  it("TRẢ VỀ CÙNG MỘT promise — 15 limiter dùng chung một bộ đếm giờ, không phải 15", async () => {
    const q = await nap(REDIS_THAT);
    const a = q.rateLimitRedisSanSang();
    const b = q.rateLimitRedisSanSang();
    expect(a, "mỗi limiter tự tạo promise riêng = 15 listener + 15 timer cho cùng một sự kiện").toBe(b);
    await a;
  }, 20_000);

  it("Redis KHÔNG BAO GIỜ lên thì vẫn giải quyết sau hạn — không treo khởi động", async () => {
    // Cổng 1 không có ai nghe. Trước đây hành vi là "ném ngay"; bản vá KHÔNG được đổi nó thành "treo".
    const q = await nap("redis://127.0.0.1:1");
    const t0 = Date.now();
    await q.rateLimitRedisSanSang(700);
    const dt = Date.now() - t0;
    expect(dt, `chờ ${dt}ms — quá hạn 700ms nghĩa là khởi động bị treo theo Redis`).toBeLessThan(4000);
    expect(q.isRateLimitRedisReady()).toBe(false);
  }, 20_000);

  it("không có REDIS_URL thì giải quyết ngay, không dựng kết nối nào", async () => {
    delete process.env.REDIS_URL;
    vi.resetModules();
    const q = await import("../src/queue.js");
    const t0 = Date.now();
    await q.rateLimitRedisSanSang(5000);
    expect(Date.now() - t0).toBeLessThan(500);
  }, 20_000);
});

describe("thứ tự trong sendCommand của kho rate-limit", () => {
  const src = readFileSync(new URL("../src/rateLimit.ts", import.meta.url), "utf8");

  // ⚠️ ĐÂY LÀ BÀI ĐỌC MÃ NGUỒN, KHÔNG PHẢI BÀI HÀNH VI. Nó KHÔNG chứng minh bản vá chạy đúng —
  // vế đó nằm ở smoke-image.sh. Nó chỉ khoá đúng MỘT cách viết sai mà tôi đã tự mắc khi viết
  // bản vá này: gán `cho = null` TRƯỚC khi `await`. `store.init()` bắn HAI `SCRIPT LOAD` SONG SONG;
  // gán null trước thì lượt thứ hai thấy null và đi thẳng vào Redis chưa nối — vẫn ném, chỉ bớt
  // một vết thay vì hết. Sai lầm đó không bài hành vi nào trong tiến trình bắt được (xem đầu file).
  it("`await cho` phải đứng TRƯỚC `cho = null`", () => {
    const m = src.match(/if \(cho\) \{([^}]*)\}/);
    expect(m, "không còn khối `if (cho) { ... }` trong sendCommand — bản vá bị gỡ?").not.toBeNull();
    const than = m[1];
    expect(than.indexOf("await cho"), "thiếu `await cho`").toBeGreaterThanOrEqual(0);
    expect(
      than.indexOf("await cho") < than.indexOf("cho = null"),
      `gán null trước khi await → lượt SCRIPT LOAD thứ hai vẫn ném: ${than.trim()}`,
    ).toBe(true);
  });

  it("kho rate-limit KHÔNG quay lại gọi thẳng client.call mà không chờ", () => {
    const goi = src.match(/sendCommand:\s*([^\n]*)/);
    expect(goi, "không tìm thấy sendCommand trong rateLimit.ts").not.toBeNull();
    expect(goi[1], "sendCommand đồng bộ = đúng mã trước bản vá, 15 vết stack quay lại")
      .toMatch(/async/);
  });
});
