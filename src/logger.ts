import pino from "pino";

const isProd = process.env.NODE_ENV === "production";

/**
 * Che bí mật NẰM TRONG URL trước khi nó được ghi ra nhật ký.
 *
 * VÌ SAO chốt đặt ở tầng logger chứ không ở serializer của pino-http: serializer là thứ mỗi nơi tự
 * viết (src/app.ts có một cái; một middleware hay worker thêm sau này sẽ có cái khác). Đặt chốt ở
 * cấu hình `redact` DÙNG CHUNG thì mọi bản ghi có `req.url` đều được che, kể cả bản ghi của mã
 * viết sau này — không phải nhớ vá lại từng serializer.
 *
 * VÌ SAO đáng che: token của lời mời và của "quên mật khẩu" nằm NGAY TRONG ĐƯỜNG DẪN
 * (GET /api/auth/invite/:token) và nó CHIẾM ĐƯỢC TÀI KHOẢN — đưa được thẳng vào POST
 * /api/auth/accept-invite để đặt mật khẩu mới. Bí mật cấp đó không được rơi sang một tầng lưu trữ
 * có vòng đời và quyền đọc khác hẳn CSDL (stdout container hôm nay, hệ log tập trung/Sentry mai sau).
 */
export function maskUrlSecrets(url: string) {
  return String(url)
    .replace(/(\/(?:invite|reset)\/)[^/?#]+/gi, "$1[da-che]")
    .replace(/([?&](?:token|inviteToken|resetToken|access_token|refreshToken)=)[^&#]+/gi, "$1[da-che]");
}

/**
 * Cấu hình che dùng chung (export để test hồi quy dựng lại đúng logger này mà không phải ghi ra stdout).
 *
 * KHÔNG dùng `remove: true` được nữa: pino BỎ QUA `censor` khi remove bật, mà `req.url` cần được
 * SỬA chứ không phải xoá (còn phải biết request nào đã chạy). Censor trả `undefined` cho các đường
 * còn lại → khoá đó bị JSON.stringify bỏ hẳn, tức kết quả in ra y hệt `remove: true` như trước.
 */
export const redactConfig = {
  paths: [
    "req.headers.cookie",
    "req.headers.authorization",
    "*.password",
    "*.passwordHash",
    "*.newPassword",
    "*.oldPassword",
    "req.url",
  ],
  censor: (value: unknown, path: string[]) =>
    (path[path.length - 1] === "url" ? maskUrlSecrets(String(value)) : undefined),
};

export const logger = pino({
  level: process.env.LOG_LEVEL || (isProd ? "info" : "debug"),
  redact: redactConfig,
  transport: isProd
    ? undefined
    : {
        target: "pino-pretty",
        options: { colorize: true, translateTime: "HH:MM:ss.l", ignore: "pid,hostname" },
      },
});
