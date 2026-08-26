import "dotenv/config";
import { z } from "zod";

/**
 * Biến môi trường SỐ, coi chuỗi RỖNG như KHÔNG ĐẶT.
 *
 * Vì sao cần: `z.coerce.number()` ép "" thành 0. Với `.positive()` phía sau thì `SMTP_PORT=`
 * (dòng có tên biến nhưng bỏ trống — chuyện rất thường gặp trong file .env sinh tự động, và trong
 * compose khi viết `SMTP_PORT: ${SMTP_PORT}` mà biến gốc chưa đặt) làm TOÀN BỘ tiến trình THOÁT
 * lúc khởi động, kèm thông điệp "expected number to be >0" chẳng chỉ ra biến nào.
 * Đã kiểm bằng zod v4: ""  →  "Too small: expected number to be >0".
 *
 * Chuỗi rỗng nghĩa là "không cấu hình", không phải "cấu hình bằng số không". Chuẩn hoá về undefined
 * để giá trị mặc định của schema được dùng.
 */
// Generic để GIỮ NGUYÊN kiểu đầu ra của schema bên trong. Nếu khai `(s: z.ZodTypeAny)` thì kiểu
// đầu ra bị xoá thành `unknown` và mọi nơi dùng `config.DEFAULT_PAGE_SIZE` sẽ vỡ typecheck.
const rongLaChuaDat = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const numEnv = <T extends z.ZodTypeAny>(schemaSo: T) =>
  z.preprocess(rongLaChuaDat, schemaSo) as unknown as T;

/** Như trên, cho biến CHUỖI: "" nghĩa là chưa đặt, không phải chuỗi rỗng hợp lệ. */
const strEnv = <T extends z.ZodTypeAny>(schemaChuoi: T) =>
  z.preprocess(rongLaChuaDat, schemaChuoi) as unknown as T;

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: numEnv(z.coerce.number().int().positive().default(3000)),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  // KHÔNG dùng `.min(32).or(z.string().min(1))`: union chỉ cần MỘT nhánh khớp, nên `min(32)` không
  // chặn được gì — "short" vẫn qua. Và khi CẢ HAI nhánh trượt (chuỗi rỗng), zod v4 gộp thành
  // `invalid_union` với message "Invalid input", còn thông điệp thật nằm trong mảng lỗi lồng bên
  // trong — mà vòng in lỗi phía dưới chỉ in `issue.message`, tức người vận hành nhận đúng một câu
  // vô nghĩa. Ngưỡng 32 ký tự áp ở lớp kiểm production tường minh phía dưới, nơi nó thật sự bắt buộc.
  SESSION_SECRET: z.string().min(1, "SESSION_SECRET là bắt buộc (production còn phải ≥ 32 ký tự)"),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).optional(),
  // Auth tuning
  BCRYPT_COST: numEnv(z.coerce.number().int().min(10).max(15).default(12)),
  PASSWORD_MIN_LENGTH: numEnv(z.coerce.number().int().min(8).default(8)),
  LOGIN_MAX_ATTEMPTS: numEnv(z.coerce.number().int().min(3).default(5)),
  LOGIN_LOCKOUT_MINUTES: numEnv(z.coerce.number().int().min(1).default(15)),
  // Rate limiting
  RATE_LIMIT_LOGIN_PER_15M: numEnv(z.coerce.number().int().default(10)),
  RATE_LIMIT_API_PER_MIN: numEnv(z.coerce.number().int().default(120)),
  // Pagination defaults
  DEFAULT_PAGE_SIZE: numEnv(z.coerce.number().int().min(1).max(200).default(20)),
  MAX_PAGE_SIZE: numEnv(z.coerce.number().int().min(10).max(500).default(100)),
  // Public base URL of the app (e.g. https://gianguyen.cloud). Used to build
  // links in outgoing emails (password reset, invites). NEVER derived from
  // request headers — Origin/Host are client-controlled and would let an
  // attacker poison reset links (account takeover).
  APP_BASE_URL: z.string().url("APP_BASE_URL phải là URL đầy đủ, vd https://gianguyen.cloud").optional(),
  // CORS
  CORS_ORIGINS: z.string().optional(),
  // Trust proxy (Nginx, Cloudflare). Set 1 (one hop) or true for any.
  TRUST_PROXY: z.string().optional(),
  // JWT
  JWT_SECRET: strEnv(z.string().min(16).optional()),
  JWT_ACCESS_TTL: z.string().default("15m"),
  JWT_REFRESH_TTL_DAYS: numEnv(z.coerce.number().int().min(1).default(7)),
  // Redis (BullMQ, rate-limit-redis, cache)
  REDIS_URL: z.string().optional(),
  // S3 / MinIO
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default("auto"),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  S3_BUCKET: z.string().default("quanly"),
  // z.coerce.boolean() treats the STRING "false" as truthy (non-empty) → true.
  // Parse explicitly so S3_FORCE_PATH_STYLE=false actually means false.
  S3_FORCE_PATH_STYLE: z.preprocess((v) => (typeof v === "string" ? !/^(false|0|no)$/i.test(v) : v), z.boolean()).default(true),
  // Telegram
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  // [KHÔNG DÙNG] Webhook đi được ký bằng secret RIÊNG của từng webhook (`Webhook.secret`, sinh ngẫu
  // nhiên rồi mã hoá at-rest — xem src/webhooks.ts + src/secretbox.ts), KHÔNG dùng biến này. Giữ khai
  // báo để `.env` cũ có dòng này không bị coi là biến lạ; đừng nối nó vào tính năng nào.
  WEBHOOK_SECRET: z.string().optional(),
  // Sentry
  SENTRY_DSN: z.string().optional(),
  // Optional bearer token to protect /metrics (defence-in-depth on top of network policy)
  METRICS_TOKEN: z.string().optional(),
  // Key used to encrypt MFA TOTP secrets at rest (AES-256-GCM). Strongly recommended
  // in production; if absent, secrets fall back to plaintext (legacy) with a warning.
  MFA_ENC_KEY: strEnv(z.string().min(16).optional()),

  // ─────────────────────────────────────────────────────────────────────────
  // TỪ ĐÂY TRỞ XUỐNG: các biến mà mã nguồn ĐANG đọc thẳng qua `process.env`.
  //
  // Chúng được khai ở đây KHÔNG phải để ép mọi nơi phải import `config` — nhiều chỗ đọc
  // `process.env` trực tiếp vẫn chạy đúng. Mục đích là để chúng ĐI QUA MỘT LẦN KIỂM TRA lúc khởi
  // động. Trước đây `RETAIN_AUDIT_DAYS=ba trăm` lặng lẽ thành NaN rồi rơi về mặc định, và
  // `DB_POOL_MAX=abc` lặng lẽ thành 20 — sai cấu hình mà không ai biết cho tới khi truy số liệu
  // không khớp. Khai ở đây thì gõ sai là CHẾT NGAY LÚC KHỞI ĐỘNG kèm tên biến.
  // ─────────────────────────────────────────────────────────────────────────

  // Gửi email (mời thành viên, đặt lại mật khẩu). Thiếu SMTP_HOST → email bị BỎ, chỉ ghi log.
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: numEnv(z.coerce.number().int().positive().max(65535).default(587)),
  SMTP_SECURE: z.string().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),

  // Mã hoá PII khi lưu trữ (CCCD / số tài khoản / lương). TÁCH BIỆT hoàn toàn với MFA_ENC_KEY,
  // JWT_SECRET, SESSION_SECRET — xoay một khoá không được làm hỏng dữ liệu của hệ thống kia.
  // Không đặt → mã hoá TẮT (ghi thô). Xem docs/operations/DISASTER_RECOVERY.md: MẤT KHOÁ = MẤT DỮ LIỆU VĨNH VIỄN.
  PII_ENC_KEY: strEnv(z.string().min(16, "PII_ENC_KEY phải ≥ 16 ký tự (sinh bằng: openssl rand -base64 48)").optional()),

  // Vòng đời dữ liệu (job dọn chạy hằng ngày 03:00 — src/retention.ts).
  RETAIN_AUDIT_DAYS: numEnv(z.coerce.number().int().positive().default(730)),
  RETAIN_LOGIN_DAYS: numEnv(z.coerce.number().int().positive().default(365)),
  RETAIN_WEBHOOK_DAYS: numEnv(z.coerce.number().int().positive().default(90)),
  RETAIN_VERSION_KEEP: numEnv(z.coerce.number().int().positive().default(100)),

  // Kích thước pool kết nối Postgres CỦA MỘT TIẾN TRÌNH (src/db.ts). Nhân với số instance app +
  // worker phải còn nằm dưới max_connections của Postgres.
  DB_POOL_MAX: numEnv(z.coerce.number().int().positive().max(200).default(20)),

  // Trần công suất xuất file (src/exportQueue.ts). Hàng đợi đầy → 503 + Retry-After.
  EXPORT_MAX_ACTIVE: numEnv(z.coerce.number().int().positive().max(32).default(3)),
  EXPORT_MAX_PENDING: numEnv(z.coerce.number().int().min(0).max(500).default(20)),

  // Tiến trình worker nền.
  WORKER_CONCURRENCY: numEnv(z.coerce.number().int().positive().max(64).default(4)),
  WORKER_MODE: z.string().optional(),

  // Lấy mẫu Sentry.
  SENTRY_TRACES_SAMPLE_RATE: numEnv(z.coerce.number().min(0).max(1).default(0.1)),
  SENTRY_PROFILES_SAMPLE_RATE: numEnv(z.coerce.number().min(0).max(1).default(0)),

  // Tài khoản KHẨN CẤP: vẫn hiện trong danh sách, vẫn hạ quyền/khoá được; cờ chỉ để admin nhận ra
  // và mọi thay đổi trên nó được ghi thêm sự kiện audit riêng.
  BREAK_GLASS_EMAILS: z.string().optional(),
  // [BỎ DẦN] tên cũ của BREAK_GLASS_EMAILS. Vẫn đọc để tương thích, KHÔNG còn ẩn tài khoản nữa.
  HIDDEN_USER_EMAILS: z.string().optional(),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error("❌ Invalid environment variables:");
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

export const config = parsed.data;

// Hard fail in production if SESSION_SECRET is a known weak default
if (
  config.NODE_ENV === "production" &&
  (config.SESSION_SECRET === "dev-secret" ||
    config.SESSION_SECRET === "change-me" ||
    config.SESSION_SECRET.length < 32)
) {
  console.error("❌ SESSION_SECRET unsafe in production (must be ≥ 32 chars and not a default).");
  process.exit(1);
}

// In production, require a dedicated JWT_SECRET (do NOT share with SESSION_SECRET:
// a leak in either subsystem must not compromise the other, and they must rotate
// independently).
if (config.NODE_ENV === "production") {
  if (!process.env.JWT_SECRET || !config.JWT_SECRET) {
    console.error("❌ JWT_SECRET must be set explicitly in production (separate from SESSION_SECRET).");
    process.exit(1);
  }
  if (config.JWT_SECRET.length < 32 || config.JWT_SECRET === config.SESSION_SECRET) {
    console.error("❌ JWT_SECRET must be ≥ 32 chars and different from SESSION_SECRET in production.");
    process.exit(1);
  }
}

// Dev/test convenience: derive a JWT secret from SESSION_SECRET if not set.
if (!config.JWT_SECRET) config.JWT_SECRET = config.SESSION_SECRET;

// Email links must come from configuration, not from request headers.
if (config.NODE_ENV === "production" && !config.APP_BASE_URL) {
  console.error("❌ APP_BASE_URL must be set in production (e.g. https://gianguyen.cloud) — email links are built from it.");
  process.exit(1);
}
if (!config.APP_BASE_URL) config.APP_BASE_URL = `http://localhost:${config.PORT}`;
config.APP_BASE_URL = config.APP_BASE_URL.replace(/\/+$/, "");

// In production, require MFA_ENC_KEY so TOTP secrets are ENCRYPTED at-rest (AES-256-GCM).
// Without it, mfa.js falls back to PLAINTEXT — a single DB dump would expose every user's
// 2FA secret, defeating MFA entirely. (Dev/test still allow the plaintext fallback.)
if (config.NODE_ENV === "production" && !config.MFA_ENC_KEY) {
  console.error("❌ MFA_ENC_KEY must be set in production (encrypts TOTP secrets at-rest; ≥ 16 chars).");
  process.exit(1);
}

// Rate limiters share their counters via Redis. Without REDIS_URL they silently fall
// back to a per-process in-memory store, so on a multi-instance prod deploy the
// login/API limits are multiplied per instance and brute-force lockout weakens.
if (config.NODE_ENV === "production" && !config.REDIS_URL) {
  console.warn("⚠️  REDIS_URL is not set in production — rate limiting falls back to a per-process store; set REDIS_URL if you run more than one app instance.");
}

export const isProd = config.NODE_ENV === "production";

/**
 * Tính năng nào ĐANG BẬT theo cấu hình hiện tại.
 *
 * Vì sao cần: hầu hết tính năng phụ ở đây "tắt êm" khi thiếu biến môi trường — không có SMTP_HOST
 * thì email bị BỎ và chỉ ghi một dòng log warn lẫn trong luồng khởi động; không có PII_ENC_KEY thì
 * CCCD/số tài khoản/lương ghi THÔ mà không ai nói gì; không có S3 thì ảnh chứng từ trả 503 đúng lúc
 * kế toán cần lưu. Từng cái đều là lựa chọn hợp lệ ở môi trường dev, nhưng ở production thì gần như
 * luôn là cấu hình sót — và cách duy nhất để phát hiện hiện nay là đi đọc mã nguồn.
 *
 * server.ts in bảng này lúc khởi động để trạng thái thật nằm ngay trong log, không phải suy đoán.
 */
export function featureStatus() {
  return {
    "Kho object (S3/MinIO)": !!(config.S3_ENDPOINT && config.S3_ACCESS_KEY && config.S3_SECRET_KEY),
    "Mã hoá PII khi lưu": !!config.PII_ENC_KEY,
    "Mã hoá bí mật MFA": !!config.MFA_ENC_KEY,
    "Redis (hàng đợi/rate-limit/SSE)": !!config.REDIS_URL,
    "Gửi email (SMTP)": !!config.SMTP_HOST,
    "Sentry": !!config.SENTRY_DSN,
    "Thông báo Telegram": !!config.TELEGRAM_BOT_TOKEN,
    "/metrics có token bảo vệ": !!config.METRICS_TOKEN,
  };
}

// Ở production, những thứ TẮT ÊM mà gây MẤT DỮ LIỆU hoặc hỏng nghiệp vụ thì phải kêu to.
// KHÔNG exit: mỗi cái đều có thể là lựa chọn có chủ ý của một triển khai nhỏ, và làm cả ứng dụng
// không khởi động được vì một tính năng phụ còn tệ hơn. Nhưng im lặng thì không được.
if (config.NODE_ENV === "production") {
  if (!config.PII_ENC_KEY) {
    console.warn(
      "⚠️  PII_ENC_KEY chưa đặt ở production — CCCD / số tài khoản / lương đang được ghi THÔ vào CSDL.\n" +
        "    Bất kỳ bản dump CSDL nào cũng lộ nguyên các trường này. Xem docs/operations/DISASTER_RECOVERY.md."
    );
  }
  if (!config.S3_ENDPOINT) {
    console.warn(
      "⚠️  S3_* chưa đặt ở production — ảnh chứng từ thanh toán KHÔNG lưu được (route trả 503)."
    );
  }
  if (!config.SMTP_HOST) {
    console.warn(
      "⚠️  SMTP_HOST chưa đặt ở production — thư mời thành viên và đặt lại mật khẩu sẽ bị BỎ IM LẶNG."
    );
  }
}
