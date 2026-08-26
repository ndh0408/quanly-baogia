import jwt from "jsonwebtoken";
import type { Secret, SignOptions } from "jsonwebtoken";
import { randomBytes, createHash } from "node:crypto";
import type { User } from "@prisma/client";
import { prisma } from "./db.js";
import { config } from "./config.js";

/**
 * Access + refresh token strategy.
 *
 * - Access token: JWT, short-lived (15m), signed with JWT_SECRET, payload = {sub, role}.
 * - Refresh token: opaque 32-byte hex string, stored hashed in RefreshToken row.
 *   Each refresh issues a NEW token + revokes the old one (rotation).
 *   If a revoked token is presented again, the WHOLE family is revoked (replay attack).
 */

const JWT_ISSUER = "quanly";
const JWT_AUDIENCE = "quanly-api";

/**
 * TRẦN TUỔI THỌ TUYỆT ĐỐI của một HỌ refresh token, tính từ mắt xích ĐẦU TIÊN.
 *
 * VÌ SAO cần: `issueRefreshToken` tính lại `expiresAt` từ Date.now() ở MỖI lần xoay và tái dùng
 * cùng `family`, nên JWT_REFRESH_TTL_DAYS chỉ là hạn của từng mắt xích chứ không phải của cả chuỗi.
 * Một token bị đánh cắp mà cứ được xoay đều thì sống VĨNH VIỄN — không có mốc nào buộc người dùng
 * chứng minh lại danh tính bằng mật khẩu (+MFA).
 *
 * Là hằng số trong module chứ không phải biến môi trường một cách CÓ CHỦ Ý: bề mặt refresh token
 * hiện chưa có client nào dùng, thêm một key config cho nó là mở rộng cấu hình mà chưa ai cần.
 * Nếu sau này có client di động thật thì hãy chuyển sang config.ts cùng lúc.
 */
// Export để test hồi quy ÔM SÁT ranh giới được (MAX−1 ngày phải xoay được, MAX+1 ngày phải bị đốt).
// Trước đây test lùi createdAt về 400 ngày với lý do "mọi trần hợp lý đều < 400 ngày" — nghĩa là
// đổi hằng số này thành 365 (gần như vô hiệu hoá chốt) mà bộ test vẫn xanh.
export const REFRESH_FAMILY_MAX_DAYS = 30;

// config.JWT_SECRET là string|undefined trong type (zod .optional()) nhưng LUÔN được
// đặt ở runtime (config.ts:96 fallback về SESSION_SECRET). Secret cast chỉ thu hẹp kiểu.
const JWT_SECRET = config.JWT_SECRET as Secret;

export function signAccessToken(user: User) {
  // expiresIn nhận StringValue|number trong @types/jsonwebtoken v9; "15m" hợp lệ runtime
  // nhưng string thường không khớp StringValue → ép cả options sang SignOptions.
  const opts: SignOptions = {
    expiresIn: config.JWT_ACCESS_TTL as SignOptions["expiresIn"],
    algorithm: "HS256",
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  };
  return jwt.sign(
    { sub: user.id, role: user.role, username: user.username },
    JWT_SECRET,
    opts
  );
}

export function verifyAccessToken(token: string) {
  // Pin the algorithm (defence-in-depth against alg-confusion / alg:none) and
  // bind issuer/audience.
  return jwt.verify(token, JWT_SECRET, {
    algorithms: ["HS256"],
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  });
}

function hashToken(plain: string) {
  return createHash("sha256").update(plain).digest("hex");
}

export async function issueRefreshToken(
  userId: number,
  { ip, userAgent, family }: { ip?: string | null; userAgent?: string | null; family?: string | null }
) {
  const plain = randomBytes(32).toString("hex");
  const tokenHash = hashToken(plain);
  const fam = family || randomBytes(8).toString("hex");
  const expiresAt = new Date(Date.now() + config.JWT_REFRESH_TTL_DAYS * 86400_000);
  await prisma.refreshToken.create({
    data: { userId, tokenHash, family: fam, ip: ip || null, userAgent: userAgent || null, expiresAt },
  });
  return { token: plain, family: fam, expiresAt };
}

/**
 * Verify a refresh token, rotate it (issue a new one + revoke this one),
 * and return new pair. If the token is already revoked but valid, revoke the
 * entire family — this is a replay attack signal.
 */
export async function rotateRefreshToken(
  plain: string,
  { ip, userAgent }: { ip?: string | null; userAgent?: string | null }
) {
  if (!plain) throw Object.assign(new Error("Thiếu refresh token"), { status: 401 });
  const tokenHash = hashToken(plain);
  const row = await prisma.refreshToken.findUnique({ where: { tokenHash } });
  if (!row) throw Object.assign(new Error("Refresh token không hợp lệ"), { status: 401 });

  if (row.revokedAt) {
    // Replay! Burn the entire family.
    await prisma.refreshToken.updateMany({
      where: { family: row.family, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    throw Object.assign(new Error("Refresh token không còn hợp lệ, vui lòng đăng nhập lại"), { status: 401 });
  }
  if (row.expiresAt < new Date()) {
    await prisma.refreshToken.update({ where: { id: row.id }, data: { revokedAt: new Date() } });
    throw Object.assign(new Error("Refresh token đã hết hạn, vui lòng đăng nhập lại"), { status: 401 });
  }

  // Atomic compare-and-set: flip revokedAt null -> now in a single statement.
  // Only ONE concurrent request can win (count === 1). If two requests race the
  // same valid token, the loser sees count === 0 — that is a double-spend/replay
  // signal, so we burn the whole family and reject. (Replaces the previous
  // non-atomic find-then-update which allowed both racers to rotate.)
  const claimed = await prisma.refreshToken.updateMany({
    where: { id: row.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (claimed.count !== 1) {
    await prisma.refreshToken.updateMany({
      where: { family: row.family, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    throw Object.assign(new Error("Refresh token không còn hợp lệ, vui lòng đăng nhập lại"), { status: 401 });
  }

  // Cả HỌ token có tuổi thọ tuyệt đối: quá trần thì đốt sạch, buộc đăng nhập lại bằng mật khẩu
  // (+MFA). Đây là mốc duy nhất cắt được một chuỗi xoay token bị đánh cắp mà vẫn "hợp lệ".
  const goc = await prisma.refreshToken.findFirst({
    where: { family: row.family },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true },
  });
  if (goc && Date.now() - goc.createdAt.getTime() > REFRESH_FAMILY_MAX_DAYS * 86400_000) {
    await prisma.refreshToken.updateMany({
      where: { family: row.family, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    throw Object.assign(new Error("Phiên đăng nhập đã quá hạn tối đa, vui lòng đăng nhập lại"), { status: 401 });
  }

  // Verify account state BEFORE issuing the new token so we never create an
  // orphaned, still-valid refresh token for a locked/deleted account.
  //
  // `lockedUntil` phải được kiểm ở đây y như bearerAuth và enforceActiveUser (src/middleware.ts)
  // đã làm: thiếu nó thì tài khoản đang bị khoá vì dò mật khẩu vẫn tiếp tục làm mới được thông tin
  // đăng nhập của mình suốt cửa sổ khoá — khoá không cắt được chuỗi credential, chỉ hoãn nó.
  // Token cũ đã bị CAS tiêu thụ ở trên nên caller buộc phải đăng nhập lại, đúng ý muốn.
  const user = await prisma.user.findUnique({ where: { id: row.userId } });
  if (!user || !user.active || (user.lockedUntil && user.lockedUntil > new Date())) {
    throw Object.assign(new Error("Tài khoản đã bị khóa"), { status: 401 });
  }
  const newPair = await issueRefreshToken(row.userId, { ip, userAgent, family: row.family });
  return { user, refresh: newPair };
}

export async function revokeRefreshToken(plain: string) {
  if (!plain) return;
  const tokenHash = hashToken(plain);
  await prisma.refreshToken.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  }).catch(() => {});
}

export async function revokeAllForUser(userId: number) {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
