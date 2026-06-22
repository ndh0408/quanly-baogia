// Express app factory — builds the FULL middleware + route stack but does NOT
// listen or start timers. server.js (the entrypoint) listens; tests import
// createApp() and drive it with supertest without binding a port.
import { config, isProd } from "./config.js";
import express from "express";
import helmet from "helmet";
import compression from "compression";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import pinoHttp from "pino-http";
import { timingSafeEqual, createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { logger } from "./logger.js";
import { createLimiter } from "./rateLimit.js";
import { requestId, notFound, errorHandler, bearerAuth, enforceActiveUser } from "./middleware.js";
import { registry, metricsMiddleware } from "./observability.js";
import { prisma } from "./db.js";

import authRoutes from "./routes/auth.routes.js";
import usersRoutes from "./routes/users.routes.js";
import quotesRoutes from "./routes/quotes.routes.js";
import exportRoutes from "./routes/export.routes.js";
import metaRoutes from "./routes/meta.routes.js";
import auditRoutes from "./routes/audit.routes.js";
import customersRoutes from "./routes/customers.routes.js";
import productsRoutes from "./routes/products.routes.js";
import notificationsRoutes from "./routes/notifications.routes.js";
import mfaRoutes from "./routes/mfa.routes.js";
import analyticsRoutes from "./routes/analytics.routes.js";
import settingsRoutes from "./routes/settings.routes.js";
import filesRoutes from "./routes/files.routes.js";
import jobsRoutes from "./routes/jobs.routes.js";
import streamRoutes from "./routes/stream.routes.js";
import webhooksRoutes from "./routes/webhooks.routes.js";
import adminRoutes from "./routes/admin.routes.js";
import permissionsRoutes from "./routes/permissions.routes.js";
import gdprRoutes from "./routes/gdpr.routes.js";
import searchRoutes from "./routes/search.routes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PgSession = connectPgSimple(session);

// Constant-time compare of an "Authorization: Bearer <token>" header against the
// expected secret. Plain !== short-circuits on the first differing byte (timing
// oracle); timingSafeEqual on equal-length SHA-256 digests removes that.
function bearerTokenMatches(authHeader, expected) {
  const m = /^Bearer\s+(.+)$/i.exec(authHeader || "");
  if (!m) return false;
  const a = createHash("sha256").update(m[1]).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

// Origins allowed to make state-changing cookie-session requests (CSRF allowlist).
// Normalized to lowercase (scheme+host are case-insensitive) for robust matching.
const ALLOWED_ORIGINS = new Set([config.APP_BASE_URL.toLowerCase()]);
if (config.CORS_ORIGINS) {
  for (const o of config.CORS_ORIGINS.split(",")) {
    const v = o.trim().replace(/\/+$/, "").toLowerCase();
    if (v) ALLOWED_ORIGINS.add(v);
  }
}

function csrfGuard(req, res, next) {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
  if (req.viaJwt) return next(); // Bearer tokens are not auto-sent by browsers → not CSRF-able
  const origin = req.headers.origin;
  if (origin) {
    if (!ALLOWED_ORIGINS.has(origin.toLowerCase())) {
      return res.status(403).json({ error: "Yêu cầu bị chặn (CSRF: origin không hợp lệ)", code: "csrf_origin" });
    }
    return next();
  }
  // No Origin (some clients omit it) — fall back to Referer when present.
  const ref = req.headers.referer;
  if (ref) {
    let refOrigin = null;
    try { refOrigin = new URL(ref).origin.toLowerCase(); } catch { /* malformed */ }
    if (!refOrigin || !ALLOWED_ORIGINS.has(refOrigin)) {
      return res.status(403).json({ error: "Yêu cầu bị chặn (CSRF: referer không hợp lệ)", code: "csrf_referer" });
    }
  }
  // Neither header present → non-browser client (curl/SDK); cookie CSRF needs a
  // browser, which would have sent Origin. Allow.
  next();
}

export function createApp() {
  const app = express();

  if (config.TRUST_PROXY) {
    app.set("trust proxy", config.TRUST_PROXY === "true" ? true : Number(config.TRUST_PROXY) || config.TRUST_PROXY);
  }

  app.disable("x-powered-by");

  // Security headers. script-src is 'self' only (no 'unsafe-inline') — all JS is
  // external (app.js + theme-init.js), so an injected inline <script> or onX=
  // handler is blocked by CSP. style-src keeps 'unsafe-inline' because the SPA
  // renders many inline style="" attributes (would need a templating overhaul to drop).
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          "default-src": ["'self'"],
          "script-src": ["'self'"],
          "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
          "font-src": ["'self'", "https://fonts.gstatic.com"],
          "img-src": ["'self'", "data:"],
          "connect-src": ["'self'"],
          "object-src": ["'none'"],
          "frame-ancestors": ["'self'"],
        },
      },
      crossOriginEmbedderPolicy: false,
    })
  );

  // gzip/deflate text responses (JS/CSS/JSON). ~70-80% smaller over the wire.
  // IMPORTANT: never compress Server-Sent Events — the compressor buffers the stream
  // and delays/withholds realtime events (the classic "SSE works intermittently" bug).
  app.use(
    compression({
      filter: (req, res) => {
        // Decide at REQUEST time — Content-Type may not be committed yet when the
        // filter runs. The SSE endpoint, and any client asking for an event-stream,
        // must never be compressed (the compressor buffers/withholds live events).
        if (req.path === "/api/stream/events") return false;
        if ((req.headers.accept || "").includes("text/event-stream")) return false;
        const ct = res.getHeader("Content-Type");
        if (typeof ct === "string" && ct.includes("text/event-stream")) return false;
        return compression.filter(req, res);
      },
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
      // Tests run against an in-memory store: no PG dependency, no prune timer
      // keeping the process alive. Behavior at the route level is identical.
      store: config.NODE_ENV === "test"
        ? undefined
        : new PgSession({
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

  // Prometheus metrics middleware (records all requests).
  app.use(metricsMiddleware);

  // Metrics endpoint. Protect at the network level (NetworkPolicy/Nginx allowlist)
  // AND, if METRICS_TOKEN is set, require a bearer token (defence-in-depth).
  app.get("/metrics", async (req, res) => {
    if (config.METRICS_TOKEN && !bearerTokenMatches(req.headers.authorization, config.METRICS_TOKEN)) {
      return res.status(401).end();
    }
    res.setHeader("Content-Type", registry.contentType);
    res.end(await registry.metrics());
  });

  // Accept Bearer JWT as an alternative to session cookies on every API call.
  app.use("/api/", bearerAuth);

  // Enforce account state (locked/deactivated/role) from the DB on every API call,
  // so admin lock/ban/role changes take effect on a logged-in user's NEXT request
  // (cookie sessions otherwise carry a stale role and never re-check `active`).
  app.use("/api/", enforceActiveUser);

  // CSRF defence for the cookie-session path: reject state-changing requests whose
  // Origin/Referer isn't our own. Browsers always send Origin on cross-site
  // POST/PUT/DELETE, so this blocks CSRF without a token. Bearer-JWT requests are
  // exempt (tokens aren't auto-attached by browsers). Safe methods pass through.
  app.use("/api/", csrfGuard);

  // API-wide rate limit (DoS protection). Login route has its own stricter limit.
  // Redis-backed when REDIS_URL is set so the limit is shared across instances.
  const apiLimiter = createLimiter("api", {
    windowMs: 60 * 1000,
    max: config.RATE_LIMIT_API_PER_MIN,
    message: { error: "Quá nhiều yêu cầu, thử lại sau ít phút" },
  });
  app.use("/api/", apiLimiter);

  app.use("/api/auth", authRoutes);
  app.use("/api/users", usersRoutes);
  app.use("/api/quotes", quotesRoutes);
  app.use("/api/export", exportRoutes);
  app.use("/api/meta", metaRoutes);
  app.use("/api/audit", auditRoutes);
  app.use("/api/customers", customersRoutes);
  app.use("/api/products", productsRoutes);
  app.use("/api/notifications", notificationsRoutes);
  app.use("/api/mfa", mfaRoutes);
  app.use("/api/analytics", analyticsRoutes);
  app.use("/api/settings", settingsRoutes);
  app.use("/api/files", filesRoutes);
  app.use("/api", jobsRoutes); // mounts /api/quotes/:id/export and /api/jobs/:queue/:id
  app.use("/api/stream", streamRoutes);
  app.use("/api/webhooks", webhooksRoutes);
  app.use("/api/admin", adminRoutes);
  app.use("/api/permissions", permissionsRoutes);
  app.use("/api/gdpr", gdprRoutes);
  app.use("/api/search", searchRoutes);

  // Health probes
  app.get("/livez", (_req, res) => res.json({ ok: true }));
  app.get("/readyz", async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ ok: true });
    } catch (e) {
      // Never leak DB error details on an unauthenticated endpoint.
      logger.error({ err: e.message }, "readyz failed");
      res.status(503).json({ ok: false });
    }
  });
  app.get("/api/health", (_req, res) => res.json({ ok: true, t: new Date() }));

  app.use(notFound);

  // Static frontend (after API routes so /api/* doesn't fallthrough).
  // Assets are immutable + cached 1 year because the SPA busts them via ?v=...;
  // index.html itself is served no-cache (below) so a new ?v= is always seen.
  app.use(express.static(path.join(__dirname, "..", "public"), {
    index: false,                 // let the SPA fallback serve index.html (no-cache)
    maxAge: "1y",
    immutable: true,
  }));
  app.get("*", (req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(path.join(__dirname, "..", "public", "index.html"));
  });

  app.use(errorHandler);

  return app;
}
