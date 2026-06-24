import { randomUUID } from "node:crypto";
import { logger } from "./logger.js";
import { verifyAccessToken } from "./jwt.js";
import { prisma } from "./db.js";

export function requestId(req, res, next) {
  req.id = req.headers["x-request-id"] || randomUUID();
  res.setHeader("X-Request-Id", req.id);
  next();
}

/**
 * Try to populate req.session from a Bearer JWT if no cookie session is present.
 * This lets the same route handlers serve browser (session) and API/mobile (JWT) clients.
 */
export async function bearerAuth(req, _res, next) {
  if (req.session?.userId) return next();
  const h = req.headers.authorization || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return next();
  try {
    const payload = verifyAccessToken(m[1]);
    // SECURITY: never trust role/active from the token claim. Re-load the user on
    // every request so a deactivated / demoted / locked account loses access
    // immediately (within the access-token TTL the token is otherwise valid).
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, role: true, username: true, active: true, lockedUntil: true },
    });
    if (!user || !user.active || (user.lockedUntil && user.lockedUntil > new Date())) {
      return next(); // fall through unauthenticated → requireAuth/requireRole reject
    }
    // Synthesize a session-like object so downstream code stays identical.
    req.session = req.session || {};
    req.session.userId = user.id;
    req.session.role = user.role; // authoritative role from DB, not the token
    req.session.username = user.username;
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

/**
 * Reload the caller's account state from the DB on each request (cookie-session path).
 * Rejects locked / deactivated / deleted accounts immediately and refreshes the
 * authoritative role — so an admin's lock/ban/role change takes effect on the user's
 * NEXT request instead of being stuck until they re-login. The Bearer path
 * (bearerAuth) already re-loads from the DB, so JWT requests are skipped here.
 */
export async function enforceActiveUser(req, res, next) {
  if (!req.session?.userId || req.viaJwt) return next();
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.session.userId },
      select: { role: true, active: true, lockedUntil: true },
    });
    if (!user || user.active === false || (user.lockedUntil && user.lockedUntil > new Date())) {
      return req.session.destroy(() =>
        res.status(401).json({
          error: "Phiên đã kết thúc — tài khoản bị khóa hoặc vô hiệu hóa",
          code: "session_revoked",
        })
      );
    }
    if (req.session.role !== user.role) req.session.role = user.role; // authoritative role
    next();
  } catch (e) {
    next(e);
  }
}

export function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

export function notFound(req, res, next) {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ error: "Không tìm thấy tài nguyên" });
  }
  next();
}

export function errorHandler(err, req, res, _next) {
  // Multer upload errors (file too large / too many files / unexpected field) are
  // client errors, not 500s. Map them so observability isn't spammed with fake errors.
  if (err && err.name === "MulterError" && !err.status) {
    err.status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    err.message = err.code === "LIMIT_FILE_SIZE" ? "File quá lớn (tối đa 10MB)" : "Tải file không hợp lệ";
  }
  // Map known Prisma errors to proper HTTP status codes instead of opaque 500s.
  // (Avoids unique-constraint races / FK violations leaking as "Lỗi server".)
  if (err && typeof err.code === "string" && /^P\d{4}$/.test(err.code) && !err.status) {
    if (err.code === "P2002") {
      err.status = 409;
      err.message = "Dữ liệu đã tồn tại (trùng khóa duy nhất)";
    } else if (err.code === "P2025") {
      err.status = 404;
      err.message = "Không tìm thấy bản ghi";
    } else if (err.code === "P2003") {
      err.status = 409;
      err.message = "Vi phạm ràng buộc dữ liệu (bản ghi đang được tham chiếu)";
    }
  }
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
