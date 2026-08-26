// Express app factory — builds the FULL middleware + route stack but does NOT
// listen or start timers. server.js (the entrypoint) listens; tests import
// createApp() and drive it with supertest without binding a port.
import { config, isProd } from "./config.js";
import express from "express";
import type { Request, Response, NextFunction } from "express";
import helmet from "helmet";
import compression from "compression";
import { decompressBody } from "./decompressBody.js";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import pinoHttp from "pino-http";
import { timingSafeEqual, createHash, randomBytes } from "node:crypto";
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
import importRoutes from "./routes/import.routes.js";
import exportRoutes from "./routes/export.routes.js";
import metaRoutes from "./routes/meta.routes.js";
import auditRoutes from "./routes/audit.routes.js";
import personnelRoutes from "./routes/personnel.routes.js";
import employeesRoutes from "./routes/employees.routes.js";
import customersRoutes from "./routes/customers.routes.js";
import venuesRoutes from "./routes/venues.routes.js";
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
function bearerTokenMatches(authHeader: string | undefined, expected: string) {
  const m = /^Bearer\s+(.+)$/i.exec(authHeader || "");
  if (!m) return false;
  const a = createHash("sha256").update(m[1]).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

// Origin được phép thực hiện thao tác GHI bằng phiên cookie (danh sách cho phép của CSRF).
// config.ts đảm bảo APP_BASE_URL luôn được đặt (fallback http://localhost:PORT) trước khi tới đây,
// nhưng kiểu khai báo là string|undefined → narrow bằng guard để TS biết chắc là string.
//
// Chuẩn hoá về ORIGIN thật (scheme://host[:port]) rồi mới so.
//
// Trước đây danh sách này chứa NGUYÊN chuỗi cấu hình. Nếu APP_BASE_URL có đường dẫn phía sau
// (vd "https://gianguyen.cloud/app" — một cấu hình sai rất dễ mắc) thì phần tử trong danh sách là
// "https://gianguyen.cloud/app", trong khi header Origin trình duyệt gửi luôn là
// "https://gianguyen.cloud". Không bao giờ khớp → MỌI thao tác ghi bằng phiên cookie trả 403, và
// thông điệp lỗi thì đổ cho CSRF chứ không chỉ ra cấu hình sai.
function toOrigin(raw: string): string | null {
  try {
    return new URL(raw.trim()).origin.toLowerCase();
  } catch {
    return null;
  }
}
const baseOrigin = config.APP_BASE_URL;
if (!baseOrigin) throw new Error("APP_BASE_URL chưa được cấu hình (config.ts phải đặt fallback)");
const baseParsed = toOrigin(baseOrigin);
if (!baseParsed) throw new Error(`APP_BASE_URL không phải URL hợp lệ: ${baseOrigin}`);
const ALLOWED_ORIGINS = new Set([baseParsed]);
if (config.CORS_ORIGINS) {
  for (const o of config.CORS_ORIGINS.split(",")) {
    const v = toOrigin(o);
    if (v) ALLOWED_ORIGINS.add(v);
  }
}

// ─── CSRF: token đồng bộ hoá gắn với phiên ──────────────────────────────────
//
// Vì sao cần thêm token khi ĐÃ có kiểm Origin/Referer + SameSite=Lax:
//
//   Nhánh cũ KẾT THÚC BẰNG next() khi KHÔNG có Origin VÀ KHÔNG có Referer. Lập luận đi kèm ("trình
//   duyệt nào cũng gửi Origin, nên đây chắc chắn là client không phải trình duyệt") đúng với trình
//   duyệt hiện đại, nhưng nó bắt toàn bộ khả năng chống CSRF phụ thuộc vào một hành vi mà máy chủ
//   KHÔNG kiểm soát được — và mặc định của nó là CHO QUA. Một trình duyệt cũ, một tiện ích mở rộng,
//   một kiểu điều hướng mới trong tương lai lược bỏ cả hai header là hàng rào biến mất, âm thầm.
//   Mặc định phải là TỪ CHỐI, và cái cho phép đi qua phải là thứ chỉ mã của chính mình có được.
//
// Phạm vi áp dụng CHÍNH XÁC: chỉ những request được xác thực bằng PHIÊN COOKIE. Đó đúng là tập
// request mà trình duyệt tự đính kèm thông tin đăng nhập — tức tập bị CSRF. Request dùng Bearer
// (viaJwt) và request chưa đăng nhập không nằm trong đó, nên client API, webhook vào và bản thân
// lần POST đăng nhập KHÔNG bị ảnh hưởng.
const CSRF_HEADER = "x-csrf-token";
const CSRF_SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function issueCsrfToken(req: Request): string {
  if (!req.session) throw new Error("csrf: không có phiên");
  if (!req.session.csrfSecret) req.session.csrfSecret = randomBytes(32).toString("hex");
  return req.session.csrfSecret;
}

// Export để test trực tiếp: ca hỏng (header 64 byte có byte ≥ 0x80) KHÔNG gửi được qua
// supertest — Node phía client từ chối header ngoài Latin-1 — nên phải kiểm ở mức hàm.
export function csrfTokenMatches(sent: unknown, expected: string) {
  if (typeof sent !== "string") return false;
  // So theo ĐỘ DÀI BYTE, không phải độ dài chuỗi. `"ă".repeat(64)` có 64 KÝ TỰ nhưng 128 BYTE:
  // qua được phép so `sent.length !== expected.length` rồi làm timingSafeEqual ném RangeError
  // ("Input buffers must have the same byte length") — biến một lần từ chối 403 đáng lẽ gọn gàng
  // thành 500 kèm vết stack trong log. Đã kiểm bằng node: chuỗi 64 ký tự tiếng Việt ném thật.
  const a = Buffer.from(sent, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function csrfGuard(req: Request, res: Response, next: NextFunction) {
  if (CSRF_SAFE_METHODS.has(req.method)) return next();
  if (req.viaJwt) return next(); // Bearer tokens are not auto-sent by browsers → not CSRF-able

  // LỚP 1 — Origin/Referer. Giữ nguyên, vẫn là hàng rào rẻ nhất và chặn sớm nhất.
  const origin = req.headers.origin;
  if (origin) {
    if (!ALLOWED_ORIGINS.has(origin.toLowerCase())) {
      return res.status(403).json({ error: "Yêu cầu bị chặn (CSRF: origin không hợp lệ)", code: "csrf_origin" });
    }
  } else {
    const ref = req.headers.referer;
    if (ref) {
      const refOrigin = toOrigin(ref);
      if (!refOrigin || !ALLOWED_ORIGINS.has(refOrigin)) {
        return res.status(403).json({ error: "Yêu cầu bị chặn (CSRF: referer không hợp lệ)", code: "csrf_referer" });
      }
    }
    // Không có cả hai → KHÔNG cho qua nữa. Lớp 2 bên dưới quyết định.
  }

  // LỚP 2 — token đồng bộ hoá, CHỈ với request xác thực bằng phiên cookie.
  if (!req.session?.userId) return next(); // chưa đăng nhập bằng cookie → không có gì để giả mạo
  const expected = req.session.csrfSecret;
  if (!expected) {
    // Phiên có TỪ TRƯỚC khi tính năng này tồn tại (hoặc vừa bị regenerate lúc đăng nhập) thì chưa
    // có bí mật nào. Nói rõ bằng mã lỗi riêng để client tự lấy token rồi thử lại — thay vì bắt
    // toàn bộ người đang đăng nhập phải tải lại trang ngay lúc deploy.
    return res.status(403).json({ error: "Thiếu mã chống giả mạo (CSRF) — vui lòng thử lại", code: "csrf_token_missing" });
  }
  if (!csrfTokenMatches(req.headers[CSRF_HEADER], expected)) {
    return res.status(403).json({ error: "Mã chống giả mạo (CSRF) không hợp lệ — vui lòng thử lại", code: "csrf_token_invalid" });
  }
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

  // helmet 8 no longer emits Permissions-Policy; lock down powerful browser features
  // the app never uses so an injected/embedded context can't request them.
  app.use((_req, res, next) => {
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=(), accelerometer=(), gyroscope=(), magnetometer=()");
    next();
  });

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
    (pinoHttp as any)({
      logger,
      customLogLevel: (_req: Request, res: Response, err: Error | undefined) => {
        if (err || res.statusCode >= 500) return "error";
        if (res.statusCode >= 400) return "warn";
        return "info";
      },
      customProps: (req: Request) => ({ reqId: req.id, userId: req.session?.userId }),
      serializers: {
        req: (req: Request) => ({ method: req.method, url: req.url, id: req.id }),
        res: (res: Response) => ({ status: res.statusCode }),
      },
    })
  );


  // Thân request NÉN: client tự nén gói lớn (web/src/lib/api.ts) vì trình duyệt không tự nén thân
  // GỬI LÊN. Đặt TRƯỚC mọi express.json — xem src/decompressBody.ts.
  // Trần giải nén ĂN THEO ROUTE, không dùng chung: chỉ nhóm báo giá cần gói lớn (16MB), phần còn
  // lại giữ đúng trần 2MB như express.json của nó — middleware này chạy TRƯỚC auth/rate-limit nên
  // trần chung 16MB sẽ cho người CHƯA đăng nhập bơm 16MB vào bất kỳ endpoint nào. Mount nhóm quotes
  // trước; sau khi xử lý xong nó xoá header Content-Encoding nên lớp chung phía dưới tự bỏ qua.
  app.use(["/api/quotes", "/api/quotes/*"], decompressBody(16 * 1024 * 1024));
  app.use(decompressBody(2 * 1024 * 1024));

  // Báo giá lớn (thực tế tới 50 trang × vài trăm dòng) vượt xa 2MB: 50×200 dòng đã là ~1,6MB,
  // 50×500 là ~4MB. Trần 2MB cho TOÀN BỘ API khiến lưu báo giá lớn hỏng với lỗi 413 khó hiểu.
  // Nâng trần RIÊNG cho nhóm route báo giá (mount TRƯỚC nên thân đã được đọc xong, middleware
  // chung phía dưới bỏ qua), phần API còn lại vẫn giữ 2MB để không mở rộng bề mặt tấn công.
  app.use(["/api/quotes", "/api/quotes/*"], express.json({ limit: "16mb" }));
  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: true, limit: "2mb" }));

  const sessionMiddleware = session({
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
  });

  // BỎ QUA hẳn phiên cho request Bearer KHÔNG mang cookie.
  //
  // ── VẤN ĐỀ ĐÃ ĐO ĐƯỢC ─────────────────────────────────────────────────────
  // `bearerAuth` (src/middleware.ts) ghi danh tính vào `req.session` để mã phía sau không phải
  // phân biệt hai đường xác thực. Nhưng ghi vào đối tượng phiên là ĐÁNH DẤU NÓ ĐÃ THAY ĐỔI, nên
  // express-session LƯU nó xuống kho PG và trả kèm Set-Cookie — cho một client API chưa bao giờ
  // xin cookie.
  //
  // Đã đo: 5 request Bearer → 5 hàng mới trong `user_sessions` và 5 Set-Cookie. Một script gọi API
  // mỗi phút sinh 1.440 hàng/ngày, mỗi hàng sống 7 ngày (~10.000 hàng thường trực). Job prune chỉ
  // dọn hàng ĐÃ HẾT HẠN nên không cứu được. Kèm theo đó là một thông tin đăng nhập THỨ HAI nằm
  // ngoài đường thu hồi token mà chính hệ thống công bố.
  //
  // Cách chữa: những request này KHÔNG cần phiên, nên đừng dựng phiên. `bearerAuth` vốn đã làm
  // `req.session = req.session || {}` — không có middleware phiên thì nó dùng object thường, mã
  // phía sau chạy y hệt, mà không có gì được ghi xuống và không có cookie nào được phát.
  //
  // Điều kiện CỐ Ý hẹp: phải CÓ Bearer VÀ KHÔNG có cookie phiên. Trình duyệt gửi cả hai (vd SPA đã
  // đăng nhập lại thử gọi kèm token) vẫn phải đi qua phiên thật như cũ.
  const COOKIE_PHIEN = /(?:^|;\s*)qly\.sid=/;
  app.use((req: Request, res: Response, next: NextFunction) => {
    const coBearer = /^Bearer\s+\S/i.test(req.headers.authorization || "");
    const coCookiePhien = COOKIE_PHIEN.test(req.headers.cookie || "");
    if (coBearer && !coCookiePhien) return next();
    return sessionMiddleware(req, res, next);
  });

  // Prometheus metrics middleware (records all requests).
  app.use(metricsMiddleware);

  // Metrics endpoint. Protect at the network level (NetworkPolicy/Nginx allowlist)
  // AND, if METRICS_TOKEN is set, require a bearer token (defence-in-depth).
  app.get("/metrics", async (req, res) => {
    // Fail closed in production: if no METRICS_TOKEN is set, do NOT expose metrics.
    // Otherwise an internet-reachable deployment (e.g. behind a tunnel where the
    // network allowlist assumption doesn't hold) leaks route names, traffic volumes,
    // error rates and resource usage to anyone. Set METRICS_TOKEN to enable scraping.
    if (isProd && !config.METRICS_TOKEN) {
      return res.status(404).end();
    }
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

  // Cấp mã chống giả mạo (CSRF) cho SPA. Phải nằm TRƯỚC csrfGuard trong chuỗi, và là GET nên
  // bản thân nó không bị guard chặn. Ghi vào phiên → express-session tự lưu và đặt cookie
  // (saveUninitialized=false nên phiên ẩn danh chỉ được tạo khi thực sự có gì để ghi).
  app.get("/api/csrf-token", (req, res) => {
    if (!req.session) return res.status(500).json({ error: "Phiên chưa sẵn sàng" });
    const token = issueCsrfToken(req);
    // Không được để proxy/CDN cache — mỗi phiên một mã khác nhau.
    res.setHeader("Cache-Control", "no-store, private, max-age=0");
    res.json({ token });
  });

  // CSRF defence for the cookie-session path: reject state-changing requests whose
  // Origin/Referer isn't our own, AND require a session-bound token. Bearer-JWT
  // requests are exempt (tokens aren't auto-attached by browsers). Safe methods pass.
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
  app.use("/api/quotes", importRoutes);   // nhập Excel — đặt TRƯỚC quotesRoutes (tránh khớp "/:id")
  app.use("/api/quotes", quotesRoutes);
  app.use("/api/export", exportRoutes);
  app.use("/api/meta", metaRoutes);
  app.use("/api/audit", auditRoutes);
  app.use("/api/customers", customersRoutes);
  app.use("/api/venues", venuesRoutes);
  app.use("/api/personnel", personnelRoutes);
  app.use("/api/employees", employeesRoutes);
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
      logger.error({ err: e instanceof Error ? e.message : String(e) }, "readyz failed");
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
    setHeaders: (res: import("node:http").ServerResponse, filePath: string) => {
      // PWA sw.js/registerSW.js/manifest KHÔNG content-hash + tham chiếu unversioned → KHÔNG được
      // long-cache/immutable (kẻo đổi nội dung mà client kẹt bản cũ tới hết hạn cache). Cho revalidate.
      if (/(?:sw|registerSW)\.js$|manifest\.webmanifest$/.test(filePath)) {
        res.setHeader("Cache-Control", "no-cache");
      }
    },
  }));
  const sendOld = (res: Response) => { res.setHeader("Cache-Control", "no-cache"); res.sendFile(path.join(__dirname, "..", "public", "index.html")); };
  const sendReact = (res: Response) => { res.setHeader("Cache-Control", "no-cache"); res.sendFile(path.join(__dirname, "..", "public", "app2", "index.html")); };
  // App CŨ (vanilla) LUÔN truy cập được tại /app — để app React mở các mục CHƯA port + dùng song song.
  app.get(["/app", "/app/*"], (_req, res) => sendOld(res));
  // App MỚI (React/TS) tại /app2 (giữ tương thích/đường dẫn cũ).
  app.get(["/app2", "/app2/*"], (_req, res) => sendReact(res));
  // Gốc "/": phục vụ app REACT cho MỌI môi trường (2026-07-06 — chuyển đổi công nghệ chính thức:
  // React đã port đầy đủ tính năng, duyệt kỹ trên staging, bỏ gate hostname). App CŨ (vanilla SPA)
  // vẫn truy cập được tại /app làm đường lui — không xoá gì, chỉ đổi mặc định.
  app.get("*", (_req, res) => sendReact(res));

  app.use(errorHandler);

  return app;
}
