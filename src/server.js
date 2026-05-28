import { config, isProd } from "./config.js";
import express from "express";
import helmet from "helmet";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import rateLimit from "express-rate-limit";
import pinoHttp from "pino-http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { logger } from "./logger.js";
import { requestId, notFound, errorHandler } from "./middleware.js";
import authRoutes from "./routes/auth.routes.js";
import usersRoutes from "./routes/users.routes.js";
import quotesRoutes from "./routes/quotes.routes.js";
import exportRoutes from "./routes/export.routes.js";
import metaRoutes from "./routes/meta.routes.js";
import auditRoutes from "./routes/audit.routes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PgSession = connectPgSimple(session);

const app = express();

if (config.TRUST_PROXY) {
  app.set("trust proxy", config.TRUST_PROXY === "true" ? true : Number(config.TRUST_PROXY) || config.TRUST_PROXY);
}

app.disable("x-powered-by");

// Security headers. CSP relaxed for inline scripts our legacy SPA still uses;
// tighten when migrating to Next.js (Phase 2).
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "default-src": ["'self'"],
        "script-src": ["'self'", "'unsafe-inline'"],
        "style-src": ["'self'", "'unsafe-inline'"],
        "img-src": ["'self'", "data:"],
        "connect-src": ["'self'"],
        "object-src": ["'none'"],
        "frame-ancestors": ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);

app.use(requestId);
app.use(
  pinoHttp({
    logger,
    customLogLevel: (_req, res, err) => {
      if (err || res.statusCode >= 500) return "error";
      if (res.statusCode >= 400) return "warn";
      return "info";
    },
    customProps: (req) => ({ reqId: req.id, userId: req.session?.userId }),
    serializers: {
      req: (req) => ({ method: req.method, url: req.url, id: req.id }),
      res: (res) => ({ status: res.statusCode }),
    },
  })
);

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));

app.use(
  session({
    name: "qly.sid",
    store: new PgSession({
      conObject: { connectionString: config.DATABASE_URL },
      createTableIfMissing: true,
      tableName: "user_sessions",
      pruneSessionInterval: 60 * 60, // hourly prune
    }),
    secret: config.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
      httpOnly: true,
      sameSite: "lax",
      secure: isProd,
    },
  })
);

// API-wide rate limit (DoS protection). Login route has its own stricter limit.
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: config.RATE_LIMIT_API_PER_MIN,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Quá nhiều yêu cầu, thử lại sau ít phút" },
});
app.use("/api/", apiLimiter);

app.use("/api/auth", authRoutes);
app.use("/api/users", usersRoutes);
app.use("/api/quotes", quotesRoutes);
app.use("/api/export", exportRoutes);
app.use("/api/meta", metaRoutes);
app.use("/api/audit", auditRoutes);

// Health probes
app.get("/livez", (_req, res) => res.json({ ok: true }));
app.get("/readyz", (_req, res) => res.json({ ok: true })); // TODO: check DB ping
app.get("/api/health", (_req, res) => res.json({ ok: true, t: new Date() }));

app.use(notFound);

// Static frontend (after API routes so /api/* doesn't fallthrough)
app.use(express.static(path.join(__dirname, "..", "public")));
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

app.use(errorHandler);

const server = app.listen(config.PORT, () => {
  logger.info({ port: config.PORT, env: config.NODE_ENV }, `🚀 Server chạy tại http://localhost:${config.PORT}`);
});

function shutdown(sig) {
  logger.info({ sig }, "shutting down");
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("unhandledRejection", (err) => logger.error({ err }, "unhandledRejection"));
process.on("uncaughtException", (err) => logger.error({ err }, "uncaughtException"));
