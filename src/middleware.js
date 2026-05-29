import { randomUUID } from "node:crypto";
import { logger } from "./logger.js";
import { verifyAccessToken } from "./jwt.js";

export function requestId(req, res, next) {
  req.id = req.headers["x-request-id"] || randomUUID();
  res.setHeader("X-Request-Id", req.id);
  next();
}

/**
 * Try to populate req.session from a Bearer JWT if no cookie session is present.
 * This lets the same route handlers serve browser (session) and API/mobile (JWT) clients.
 */
export function bearerAuth(req, _res, next) {
  if (req.session?.userId) return next();
  const h = req.headers.authorization || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return next();
  try {
    const payload = verifyAccessToken(m[1]);
    // Synthesize a session-like object so downstream code stays identical.
    req.session = req.session || {};
    req.session.userId = payload.sub;
    req.session.role = payload.role;
    req.session.username = payload.username;
    req.viaJwt = true;
  } catch {
    // invalid/expired token → just fall through; requireAuth will reject.
  }
  next();
}

export function requireAuth(req, res, next) {
  if (!req.session?.userId) {
    return res.status(401).json({ error: "Chưa đăng nhập" });
  }
  next();
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "Chưa đăng nhập" });
    }
    if (!roles.includes(req.session.role)) {
      return res.status(403).json({ error: "Không có quyền truy cập" });
    }
    next();
  };
}

export function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

export function notFound(req, res, next) {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ error: "Not found" });
  }
  next();
}

export function errorHandler(err, req, res, _next) {
  const status = err.status || err.statusCode || 500;
  const exposed = status < 500;
  logger.error(
    { reqId: req.id, path: req.path, method: req.method, status, err: err.message, stack: err.stack },
    "request failed"
  );
  if (status >= 500) {
    // Lazy import so this module stays loadable when observability isn't initialized.
    import("./observability.js").then(({ captureError }) => {
      captureError(err, { reqId: req.id, path: req.path, method: req.method, userId: req.session?.userId });
    }).catch(() => {});
  }
  if (res.headersSent) return;
  res.status(status).json({
    error: exposed ? err.message : "Lỗi server",
    reqId: req.id,
  });
}
