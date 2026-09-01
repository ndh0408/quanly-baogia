/**
 * CỤM auth-session — hai lỗi quanh yếu tố thứ hai (MFA).
 *
 * ── LỖI 1: mã dự phòng chỉ 40 bit, băm SHA-256 TRẦN (src/mfa.ts) ────────────────────────
 * TÁI HIỆN: `generateBackupCodes` dùng `randomBytes(5)` → 10 ký tự hex = đúng 2^40 khả năng, và
 * lưu bằng `createHash("sha256")` không muối, không KDF. Định dạng còn được công bố công khai qua
 * regex `[0-9A-Fa-f]{10}` ở auth.routes.ts và mfa.routes.ts, nên không gian tìm kiếm là biết trước.
 * HẬU QUẢ: ai lấy được một bản dump CSDL (endpoint GET /api/admin/backup.dump chạy pg_dump và trả
 * qua HTTP) có thể quét cạn 2^40 giá trị bằng SHA-256 — vài giờ trên một GPU — rồi dùng mã đó để
 * VƯỢT MFA và cả để TẮT MFA. Chính thiết kế đã coi "dump CSDL" là mô hình đe doạ có thật: bí mật
 * TOTP được AES-256-GCM dưới MFA_ENC_KEY và bắt buộc ở production. Mã dự phòng thì không, mà nó
 * lại KHÔNG bị vô hiệu khi đổi mật khẩu → là thông tin đăng nhập sống dai.
 *
 * ── LỖI 2: TẮT MFA nhận lại mã TOTP VỪA DÙNG (src/services/mfaService.ts) ───────────────
 * TÁI HIỆN: đăng nhập bằng một mã TOTP (đường /login ghi lại step đã dùng vào `mfaLastStep`), rồi
 * gọi POST /api/mfa/disable với ĐÚNG mã đó trong cùng cửa sổ 30 giây. `disableMfa` gọi
 * `speakeasy.totp.verify` trần — không đọc, không tiến `mfaLastStep` → mã cũ vẫn được chấp nhận.
 * HẬU QUẢ: kẻ đã cầm phiên + mật khẩu của nạn nhân (vd nhìn trộm một lần) chỉ cần chép lại mã 6 số
 * vừa thấy để GỠ HẲN yếu tố thứ hai, biến một lần lộ thoáng qua thành quyền truy cập lâu dài.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash } from "node:crypto";
import speakeasy from "speakeasy";
import bcrypt from "bcryptjs";
import { prisma } from "../src/db.js";
import { generateBackupCodes, consumeBackupCode } from "../src/mfa.js";
import { authenticateCredentials } from "../src/authCore.js";
import { disableMfa } from "../src/services/mfaService.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "User" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") {
  throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres — test cụm auth-session không được skip trong CI");
}

const TAG = `asxMfa${Date.now()}`;
const PW = "MatKhau123";
const SECRET = "JBSWY3DPEHPK3PXP";

describe("mã dự phòng MFA — độ dài & cách lưu", () => {
  it("mã dài ≥ 16 ký tự hex (≥ 64 bit) và KHÔNG lưu bằng SHA-256 trần", async () => {
    const { plain, hashed } = await generateBackupCodes(4);
    expect(plain).toHaveLength(4);
    // 40 bit (10 hex) là quá ít cho một giá trị bị băm nhanh và có định dạng công khai.
    expect(plain.every((c) => /^[0-9A-F]{16,}$/.test(c))).toBe(true);
    // SHA-256 hex trần = đúng 64 ký tự [0-9a-f]. Bản lưu mới phải KHÁC hình dạng đó (bcrypt có muối).
    expect(hashed.every((h) => !/^[0-9a-f]{64}$/.test(h))).toBe(true);
    // Cùng một mã băm hai lần phải ra hai chuỗi khác nhau → chứng minh có muối ngẫu nhiên.
    const { hashed: lai } = await generateBackupCodes(1);
    expect(hashed[0]).not.toBe(lai[0]);
  });

  it("vẫn khớp mã mới, và trả về đúng phần tử đã lưu để làm khoá lạc quan", async () => {
    const { plain, hashed } = await generateBackupCodes(3);
    const hit = await consumeBackupCode(hashed, plain[1]);
    expect(hit.matched).toBe(hashed[1]);
    expect(hit.remaining).toHaveLength(2);
    expect(await consumeBackupCode(hit.remaining, plain[1])).toBeNull();
  });

  it("TƯƠNG THÍCH NGƯỢC: vẫn nhận mã cũ dạng SHA-256 và dạng plaintext 10 ký tự", async () => {
    const cu = "A1B2C3D4E5";
    const sha = createHash("sha256").update(cu).digest("hex");
    expect((await consumeBackupCode([sha], cu)).matched).toBe(sha);
    expect((await consumeBackupCode([cu], cu)).matched).toBe(cu);
    expect(await consumeBackupCode([sha], "0000000000")).toBeNull();
  });
});

describe.runIf(dbAvailable)("TẮT MFA không được nhận lại mã TOTP đã dùng", () => {
  let userId;

  beforeAll(async () => {
    const u = await prisma.user.create({
      data: {
        username: `${TAG}u`,
        displayName: "MFA Replay Test",
        passwordHash: bcrypt.hashSync(PW, 4),
        active: true,
        mfaEnabled: true,
        mfaSecret: SECRET,
      },
    });
    userId = u.id;
  });

  afterAll(async () => {
    await prisma.loginAttempt.deleteMany({ where: { username: `${TAG}u` } }).catch(() => {});
    await prisma.auditEvent.deleteMany({ where: { actorId: userId } }).catch(() => {});
    await prisma.user.delete({ where: { id: userId }, includeDeleted: true }).catch(() => {});
  });

  it("mã vừa dùng để ĐĂNG NHẬP không tắt được MFA", async () => {
    await prisma.user.update({ where: { id: userId }, data: { mfaEnabled: true, mfaSecret: SECRET, mfaLastStep: null } });
    const ma = speakeasy.totp({ secret: SECRET, encoding: "base32" });

    const dangNhap = await authenticateCredentials(
      { ip: "127.0.0.1", headers: { "user-agent": "vitest" } },
      { username: `${TAG}u`, password: PW, mfaToken: ma, flow: "login" }
    );
    expect(dangNhap.ok).toBe(true); // mã hợp lệ, step đã được ghi nhận

    const req = { session: { userId }, body: { password: PW, token: ma }, headers: {}, ip: "127.0.0.1" };
    await expect(disableMfa(req)).rejects.toThrow();

    const u = await prisma.user.findUnique({ where: { id: userId }, select: { mfaEnabled: true } });
    expect(u.mfaEnabled).toBe(true); // vẫn còn yếu tố thứ hai
  });

  it("mã TOTP CHƯA dùng vẫn tắt được MFA (không phá đường dùng hợp lệ)", async () => {
    await prisma.user.update({ where: { id: userId }, data: { mfaEnabled: true, mfaSecret: SECRET, mfaLastStep: null } });
    const ma = speakeasy.totp({ secret: SECRET, encoding: "base32" });
    const req = { session: { userId }, body: { password: PW, token: ma }, headers: {}, ip: "127.0.0.1" };
    await expect(disableMfa(req)).resolves.toEqual({ ok: true });
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { mfaEnabled: true } });
    expect(u.mfaEnabled).toBe(false);
  });
});
