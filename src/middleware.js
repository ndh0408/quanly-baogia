import { randomUUID } from "node:crypto";
import { logger } from "./logger.js";

export function requestId(req, res, next) {
  req.id = req.headers["x-request-id"] || randomUUID();
  res.setHeader("X-Request-Id", req.id);
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
  // Don't leak internals in production responses
  const status = err.status || err.statusCode || 500;
  const exposed = status < 500;
  logger.error(
    { reqId: req.id, path: req.path, method: req.method, status, err: err.message, stack: err.stack },
    "request failed"
  );
  if (res.headersSent) return;
  res.status(status).json({
    error: exposed ? err.message : "Lỗi server",
    reqId: req.id,
  });
}
