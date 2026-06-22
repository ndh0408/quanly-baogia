import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be ≥ 32 chars in production").or(z.string().min(1)),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).optional(),
  // Auth tuning
  BCRYPT_COST: z.coerce.number().int().min(10).max(15).default(12),
  PASSWORD_MIN_LENGTH: z.coerce.number().int().min(8).default(8),
  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().min(3).default(5),
  LOGIN_LOCKOUT_MINUTES: z.coerce.number().int().min(1).default(15),
  // Rate limiting
  RATE_LIMIT_LOGIN_PER_15M: z.coerce.number().int().default(10),
  RATE_LIMIT_API_PER_MIN: z.coerce.number().int().default(120),
  // Pagination defaults
  DEFAULT_PAGE_SIZE: z.coerce.number().int().min(1).max(200).default(20),
  MAX_PAGE_SIZE: z.coerce.number().int().min(10).max(500).default(100),
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
  JWT_SECRET: z.string().min(16).optional(),
  JWT_ACCESS_TTL: z.string().default("15m"),
  JWT_REFRESH_TTL_DAYS: z.coerce.number().int().min(1).default(7),
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
  // Webhook
  WEBHOOK_SECRET: z.string().optional(),
  // Sentry
  SENTRY_DSN: z.string().optional(),
  // Optional bearer token to protect /metrics (defence-in-depth on top of network policy)
  METRICS_TOKEN: z.string().optional(),
  // Key used to encrypt MFA TOTP secrets at rest (AES-256-GCM). Strongly recommended
  // in production; if absent, secrets fall back to plaintext (legacy) with a warning.
  MFA_ENC_KEY: z.string().min(16).optional(),
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
  if (!process.env.JWT_SECRET) {
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

// Rate limiters share their counters via Redis. Without REDIS_URL they silently fall
// back to a per-process in-memory store, so on a multi-instance prod deploy the
// login/API limits are multiplied per instance and brute-force lockout weakens.
if (config.NODE_ENV === "production" && !config.REDIS_URL) {
  console.warn("⚠️  REDIS_URL is not set in production — rate limiting falls back to a per-process store; set REDIS_URL if you run more than one app instance.");
}

export const isProd = config.NODE_ENV === "production";
