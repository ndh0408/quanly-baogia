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
  S3_FORCE_PATH_STYLE: z.coerce.boolean().default(true),
  // Telegram
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  // Webhook
  WEBHOOK_SECRET: z.string().optional(),
  // Stripe
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  // Sentry
  SENTRY_DSN: z.string().optional(),
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

// Derive JWT secret from SESSION_SECRET if not explicitly set (still keeps it private)
if (!config.JWT_SECRET) config.JWT_SECRET = config.SESSION_SECRET;

export const isProd = config.NODE_ENV === "production";
