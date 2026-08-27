import { randomUUID } from "node:crypto";
import type { Request, Response, NextFunction, RequestHandler } from "express";
import { logger } from "./logger.js";
import { verifyAccessToken } from "./jwt.js";
import { prisma } from "./db.js";
import { resolveUserPermissions } from "./permissions.js";

// Hình dạng id truy vết được CHẤP NHẬN từ client. Cố ý hẹp: chữ-số cùng `. _ -`, tối đa 64 ký tự —
// đủ cho mọi định dạng đang dùng ngoài đời (UUID, trace-id của Cloudflare/OTel) mà không hơn.
const ID_HOP_LE = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * TRẦN TUỔI THỌTỦYỆT ĐỐI của một phiên cookie, tính từ lần XÁC THỰC (`authAt`, đặt trong
 * authService.establishSession), KHÔNG phải từ lần dùng gần nhất.
 *
 * VÌ SAO cần: cấu hình phiên (src/app.ts) là `rolling: true` + cookie.maxAge 7 ngày, nên MỖI request
 * lại đẩy hạn thêm 7 ngày. Trước chốt này, `enforceActiveUser` đọc `authAt` DUY NHẤT để so với
 * `User.passwordChangedAt` — mà cột đó nullable và chỉ được ghi khi đổi mật khẩu / nhận lời mời /
 * admin đặt lại. Tài khoản chưa từng đổi mật khẩu có phiên sống VÔ HẠN miễn là được dùng mỗi tuần:
 * không có mốc nào buộc người dùng chứng minh lại danh tính bằng mật khẩu (+MFA). Đây đúng là lớp
 * lỗi đã được vá cho HỌrefresh token (REFRESH_FAMILY_MAX_DAYS, src/jwt.ts) — chốt này là bản
 * tương ứng cho đường cookie.
 *
 * Là hằng số trong module chứ không phải biến môi trường một cách CÓ CHỦ Ý — cùng lý do như
 * REFRESH_FAMILY_MAX_DAYS: một chính sách bảo mật không nên có nút vặn mà chưa ai cần vặn. (Nếu sau
 * này thật sự cần thì chuyển sang src/config.ts.) Export để test hồi quy ÔM SÁT được ranh giới.
 */
export const SESSION_MAX_AGE_DAYS = 30;

export function requestId(req: Request, res: Response, next: NextFunction) {
  // x-request-id header có thể là string | string[] (header trùng lặp) | undefined.
  // Chuẩn hoá về 1 string: header trùng → lấy phần tử đầu; thiếu → sinh UUID.
  //
  // VÌ SAO PHẢI KIỂM HÌNH DẠNG chứ không dùng nguyên xi: giá trị này được ghi thẳng ra header phản
  // hồi ngay dòng dưới, nên một ký tự điều khiển làm `res.setHeader` ném ERR_INVALID_CHAR — tức
  // chính lớp truy vết sinh ra lỗi 500 kèm một sự kiện Sentry cho MỖI request như vậy. Nó còn đi
  // vào mọi dòng log, vào ngữ cảnh Sentry và vào thân JSON trả về, nên một chuỗi 100 KB do client
  // gửi là kênh bơm rác vào hạ tầng quan sát. Không hợp lệ thì sinh UUID, không từ chối request:
  // header truy vết hỏng không phải lý do để chặn một request đúng đắn.
  const hdr = req.headers["x-request-id"];
  const tho = Array.isArray(hdr) ? hdr[0] : hdr;
  req.id = typeof tho === "string" && ID_HOP_LE.test(tho) ? tho : randomUUID();
  res.setHeader("X-Request-Id", req.id);
  next();
}

/**
 * Try to populate req.session from a Bearer JWT if no cookie session is present.
 * This lets the same route handlers serve browser (session) and API/mobile (JWT) clients.
 */
export async function bearerAuth(req: Request, _res: Response, next: NextFunction) {
  if (req.session?.userId) return next();
  const h = req.headers.authorization || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return next();
  try {
    const payload = verifyAccessToken(m[1]);
    // payload là JwtPayload (verify có options) — sub được sign từ user.id (number).
    // Number() trả số ↔ chính nó; bám đúng giá trị id runtime để Prisma where nhận number.
    const sub = typeof payload === "string" ? payload : payload.sub;
    // SECURITY: never trust role/active from the token claim. Re-load the user on
    // every request so a deactivated / demoted / locked account loses access
    // immediately (within the access-token TTL the token is otherwise valid).
    const user = await prisma.user.findUnique({
      where: { id: Number(sub) },
      select: { id: true, role: true, username: true, active: true, lockedUntil: true, permissions: true, canSign: true, passwordChangedAt: true },
    });
    if (!user || !user.active || (user.lockedUntil && user.lockedUntil > new Date())) {
      return next(); // fall through unauthenticated → requireAuth/requireRole reject
    }
    // Access token phát hành TRƯỚC lần đổi mật khẩu gần nhất → coi như không có token.
    // Không có chốt này thì đổi mật khẩu vẫn để lọt một cửa sổ bằng TTL của access token (15 phút)
    // trong đó token cũ vẫn dùng được — refresh token thì đã bị thu hồi, nhưng cái đang cầm thì chưa.
    const iatMs = typeof payload !== "string" && payload.iat ? payload.iat * 1000 : 0;
    if (user.passwordChangedAt && iatMs && iatMs < user.passwordChangedAt.getTime()) {
      return next();
    }
    // Synthesize a session-like object so downstream code stays identical.
    req.session = req.session || {};
    req.session.userId = user.id;
    req.session.role = user.role; // authoritative role from DB, not the token
    req.session.username = user.username;
    // TẬP QUYỀN HIỆU LỰC per-user (nguồn phân quyền). Resolve mỗi request → admin đổi quyền là áp dụng NGAY.
    req.session.permissions = resolveUserPermissions(user.role, user.permissions, user.canSign);
    req.viaJwt = true;
  } catch {
    // invalid/expired token → just fall through; requireAuth will reject.
  }
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.userId) {
    return res.status(401).json({ error: "Chưa đăng nhập" });
  }
  next();
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "Chưa đăng nhập" });
    }
    // role có thể undefined trong type; "" không khớp role hợp lệ nào → cùng kết quả 403.
    if (!roles.includes(req.session.role ?? "")) {
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
export async function enforceActiveUser(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.userId || req.viaJwt) return next();
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.session.userId },
      select: { role: true, active: true, lockedUntil: true, permissions: true, canSign: true, passwordChangedAt: true },
    });
    if (!user || user.active === false || (user.lockedUntil && user.lockedUntil > new Date())) {
      return req.session.destroy(() =>
        res.status(401).json({
          error: "Phiên đã kết thúc — tài khoản bị khóa hoặc vô hiệu hóa",
          code: "session_revoked",
        })
      );
    }
    // Phiên được thiết lập TRƯỚC lần đổi mật khẩu gần nhất → huỷ ngay.
    //
    // Đây là chốt CHÍNH để "đổi mật khẩu thì mọi phiên khác chết", chứ không phải DELETE trên bảng
    // user_sessions. Cái DELETE kia chỉ chạy với kho phiên PG và còn nuốt lỗi (chỉ ghi log), nên một
    // trục trặc DB sẽ làm nó im lặng fail-open đúng vào lúc người dùng vừa tuyên bố "tôi nghi bị lộ".
    // So mốc thời gian thì không fail-open được: thiếu `authAt` cũng bị coi là phiên cũ.
    if (user.passwordChangedAt) {
      const authAt = Number(req.session.authAt ?? 0);
      if (authAt < user.passwordChangedAt.getTime()) {
        return req.session.destroy(() =>
          res.status(401).json({
            error: "Phiên đã kết thúc — mật khẩu vừa được thay đổi",
            code: "session_revoked",
          })
        );
      }
    }
    // TRẦN TUỔI THỌTỦYỆT ĐỐI — xem SESSION_MAX_AGE_DAYS ở đầu file.
    //
    // FAIL-CLOSED VÀ HỆ QUẢ ĐÃ BIẾT: phiên KHÔNG có `authAt` cũng bị huỷ. `authAt` chỉ được đặt ở
    // establishSession (src/services/authService.ts), nên mọi phiên hợp lệ sinh ra từ lần triển khai
    // trước bản vá này đều thiếu nó → LẦN TRIỂN KHAI NÀY BUỘC TẤT CẢ NGƯỜI DÙNG ĐANG ĐĂNG NHẬP PHẢI
    // ĐĂNG NHẬP LẠI ĐÚNG MỘT LẦN. Đó là cái giá được chấp nhận có ý thức: chọn hướng ngược lại (coi
    // thiếu `authAt` là hợp lệ) biến chốt này thành thứ tự vô hiệu hoá được bằng cách xoá một khoá.
    //
    // Mã trả về là 'session_expired' chứ không dùng lại 'session_revoked': hai tình huống khác nhau
    // (hết hạn theo thời gian vs tài khoản bị khoá/đổi mật khẩu) nên nhật ký phân biệt được. Client
    // không cần đổi gì — web/src/lib/api.ts bắn "auth:expired" cho MỌI 401, không đọc `code`.
    const tuoiPhien = Date.now() - Number(req.session.authAt ?? 0);
    if (!req.session.authAt || tuoiPhien > SESSION_MAX_AGE_DAYS * 86400_000) {
      return req.session.destroy(() =>
        res.status(401).json({
          error: "Phiên đã hết hạn, vui lòng đăng nhập lại",
          code: "session_expired",
        })
      );
    }
    if (req.session.role !== user.role) req.session.role = user.role; // authoritative role
    // Resolve quyền per-user MỖI request (cookie path) → admin đổi quyền user là hiệu lực ngay request kế.
    req.session.permissions = resolveUserPermissions(user.role, user.permissions, user.canSign);
    next();
  } catch (e) {
    next(e);
  }
}

export function asyncHandler(fn: RequestHandler) {
  return (req: Request, res: Response, next: NextFunction) => {
    // ── GHI LẠI MẪU ROUTE NGAY LÚC NÀY, KHÔNG ĐỂ TỚI LÚC GHI LOG ─────────────
    // §27 đòi mỗi dòng log có `route` — MẪU (`/api/quotes/:id`), không phải URL thật, vì URL chứa
    // id nên mỗi request thành một chuỗi riêng và không nhóm được "endpoint nào đang chậm".
    //
    // Không đọc được ở lúc ghi log: pino-http chạy `customProps` khi phản hồi KẾT THÚC, mà Express
    // KHÔI PHỤC `req.baseUrl` về "" khi ngăn xếp router tháo ra. Đường THÀNH CÔNG không tháo (handler
    // không gọi `next()`) nên còn đúng, còn đường LỖI thì `.catch(next)` làm nó tháo — và ta nhận
    // `/:id` thay vì `/api/quotes/:id`. Nghĩa là đúng những request 4xx/5xx (thứ cần điều tra nhất)
    // lại mất mất tiền tố. Đo được, không phải lo xa.
    //
    // Ở ĐÂY thì cả `req.route` lẫn `req.baseUrl` đều đang đúng. Mọi route trong repo bọc bằng
    // `asyncHandler`, nên chốt đặt tại đây phủ hết; route nào không bọc thì `customProps` tự lùi về
    // cách đọc trực tiếp (src/app.ts).
    const mau = (req as Request & { route?: { path?: string } }).route?.path;
    if (mau) (req as Request & { routePattern?: string }).routePattern = `${req.baseUrl || ""}${mau}`;
    return Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export function notFound(req: Request, res: Response, next: NextFunction) {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ error: "Không tìm thấy tài nguyên" });
  }
  next();
}

export function errorHandler(err: any, req: Request, res: Response, _next: NextFunction) {
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
    } else if (err.code === "P2028") {
      // Transaction hết giờ (trần DB_TX_TIMEOUT — src/db.ts). KHÔNG phải hỏng hệ thống: đường Lưu
      // báo giá gói cả việc nặng vào MỘT transaction, nên báo giá quá lớn là chạm trần. Trả 500
      // "Lỗi server" ở đây vừa giấu mất cách thoát (tách bớt trang), vừa bắn báo động giả sang
      // Sentry — và từ khi trần được nới lên 60s thì người dùng còn phải chờ 60 GIÂY để nhận nó.
      err.status = 503;
      err.retryAfter = err.retryAfter || 10;
      err.message = "Lưu không kịp: báo giá quá lớn cho một lần ghi. Hãy tách bớt trang (hoặc bớt dòng) rồi lưu lại.";
    } else if (err.code === "P2024") {
      // Hết kết nối trong pool (trần connectionTimeoutMillis — src/db.ts). Đây là QUÁ TẢI THOÁNG
      // QUA: thử lại sau vài giây là xong. Retry-After để client và proxy không dội lại tức thì.
      err.status = 503;
      err.retryAfter = err.retryAfter || 5;
      err.message = "Hệ thống đang bận (hết kết nối cơ sở dữ liệu). Vui lòng thử lại sau ít giây.";
    } else if (err.code === "P2034") {
      // Deadlock / write conflict: hai người ghi cùng một báo giá, Postgres giết một bên. Việc của
      // người dùng chỉ là bấm Lưu lại — cùng nhóm nghĩa với 409 khoá lạc quan, không phải lỗi 500.
      err.status = 409;
      err.message = "Có người khác đang lưu cùng lúc. Vui lòng thử lại.";
    }
  }
  const status = err.status || err.statusCode || 500;
  // 5xx thì giấu thông điệp (không để chi tiết nội bộ/stack rò ra) — TRỪ 503 kèm `retryAfter`.
  // Cặp đó CHỈ do mã của chính hệ thống đặt ra để nói "đang quá tải, thử lại sau": hàng đợi xuất
  // file (src/exportQueue.ts) và các lỗi transaction vừa map ở trên. Giấu chúng sau "Lỗi server"
  // là xoá đúng phần thông tin người dùng cần để tự thoát (chờ rồi thử lại / tách bớt trang), và
  // biến một tình huống có cách xử lý thành một lỗi bí ẩn.
  const exposed = status < 500 || (status === 503 && !!err.retryAfter);
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
  // Retry-After cho 429/503: nói cho client BAO LÂU thì thử lại. Không có header này thì client
  // (và mọi proxy ở giữa) chỉ biết thử lại ngay lập tức, đúng lúc hệ thống đang quá tải — biến
  // một đợt bận thoáng qua thành bão retry tự duy trì.
  if (err.retryAfter && (status === 429 || status === 503)) {
    res.setHeader("Retry-After", String(err.retryAfter));
  }
  res.status(status).json({
    error: exposed ? err.message : "Lỗi server",
    ...(err.code ? { code: err.code } : {}),
    reqId: req.id,
  });
}
