/**
 * AUTH-01 — TÀI KHOẢN ĐÃ BỊ KHOÁ MÀ `passwordChangedAt` = NULL TỰ MỞ LẠI ĐƯỢC QUA "QUÊN MẬT KHẨU".
 *
 * ── LỖI ─────────────────────────────────────────────────────────────────────────────────
 * `sendPasswordReset` phân biệt "chưa từng kích hoạt" với "bị admin khoá" CHỈ bằng
 * `passwordChangedAt ≠ NULL`. Nhưng cột đó NULL ở ba nhóm tài khoản thật sự đã dùng hệ thống:
 *   · mọi tài khoản có từ trước migration 20260811160000 (cố ý để NULL) mà chưa đổi mật khẩu;
 *   · tài khoản tạo bằng `POST /api/users` (createUser không ghi cột này);
 *   · admin seed.
 * Admin khoá một người thuộc các nhóm đó → người đó bấm "Quên mật khẩu" trên hộp thư cá nhân → nhận
 * token → accept-invite đặt `active: true` và cấp phiên với ĐÚNG role/quyền cũ (kể cả admin).
 *
 * ── BẢN VÁ (fixPB) ──────────────────────────────────────────────────────────────────────
 *   1. forgot-password: "đã từng kích hoạt" = passwordChangedAt HOẶC lastLoginAt; và tài khoản
 *      khoá chỉ được cấp token khi nó ĐANG CHỜ lời mời (còn inviteTokenHash/inviteExpiresAt — lệnh
 *      khoá ở updateUser luôn đốt cả hai).
 *   2. accept-invite: chốt lớp hai — token còn hạn của tài khoản khoá đã từng kích hoạt → 404.
 *   3. createUser ghi `passwordChangedAt`.
 *   4. Migration backfill `passwordChangedAt = createdAt` cho hàng NULL đã từng đăng nhập.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import { agentWithCsrf } from "./helpers/agent.js";
import { prisma } from "../src/db.js";
import { sendPasswordReset } from "../src/services/authService.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "User" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") {
  throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");
}

const TAG = `aukhoa${Date.now()}`;
const MAT_KHAU = "KhoaMo1234!ok";
const bam = (t) => createHash("sha256").update(String(t)).digest("hex");

describe.runIf(dbAvailable)("AUTH-01 — khoá tài khoản phải thật sự là khoá", () => {
  let app, doiChungId;
  const EMAIL_DC = `${TAG}.doichung@example.vn`;

  const taoUser = (hau, data) =>
    prisma.user.create({
      data: {
        username: `${TAG}-${hau}`, email: `${TAG}.${hau}@example.vn`, displayName: `${TAG} ${hau}`,
        passwordHash: bcrypt.hashSync(MAT_KHAU, 4), role: "manager", ...data,
      },
    });

  // Mốc đồng bộ cho tác vụ nền (cùng kỹ thuật với tests/authsess-forgot-case.test.js): bắn yêu cầu
  // cho tài khoản đối chứng SAU ca cần kiểm rồi chờ token của nó xuất hiện — khi đó ca trước chắc
  // chắn đã tra cứu và đã quyết định xong.
  const doiToken = async (id) => {
    for (let i = 0; i < 100; i++) {
      const u = await prisma.user.findUnique({ where: { id }, select: { inviteTokenHash: true }, includeDeleted: true });
      if (u?.inviteTokenHash) return u.inviteTokenHash;
      await new Promise((r) => setTimeout(r, 100));
    }
    return null;
  };
  const quenMatKhauRoiDoi = async (email) => {
    await prisma.user.update({ where: { id: doiChungId }, data: { inviteTokenHash: null, inviteExpiresAt: null } });
    sendPasswordReset({ body: { email }, headers: {}, ip: "127.0.0.1" });
    sendPasswordReset({ body: { email: EMAIL_DC }, headers: {}, ip: "127.0.0.1" });
    expect(await doiToken(doiChungId), "tài khoản đối chứng không nhận token — mốc đồng bộ hỏng").toBeTruthy();
  };

  beforeAll(async () => {
    app = (await import("../src/app.js")).createApp();
    const dc = await prisma.user.create({
      data: { username: `${TAG}-dc`, email: EMAIL_DC, displayName: "Doi chung", passwordHash: bcrypt.hashSync(MAT_KHAU, 4), active: true },
    });
    doiChungId = dc.id;
  }, 60_000);

  afterAll(async () => {
    const ids = (await prisma.user.findMany({ where: { username: { startsWith: TAG } }, select: { id: true }, includeDeleted: true })).map((u) => u.id);
    await prisma.auditEvent.deleteMany({ where: { OR: [{ actorId: { in: ids } }, { resourceId: { in: ids.map(String) } }] } }).catch(() => {});
    await prisma.loginAttempt.deleteMany({ where: { username: { startsWith: TAG } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true, includeDeleted: true }).catch(() => {});
  });

  it("khoá + passwordChangedAt NULL + ĐÃ TỪNG đăng nhập → Quên mật khẩu KHÔNG cấp token", async () => {
    // Đúng nhóm tài khoản cũ trên production: có từ trước 2026-08-11, chưa đổi mật khẩu lần nào.
    const u = await taoUser("cu", { active: false, passwordChangedAt: null, lastLoginAt: new Date(Date.now() - 86_400_000) });
    await quenMatKhauRoiDoi(u.email);
    const sau = await prisma.user.findUnique({ where: { id: u.id }, select: { inviteTokenHash: true } });
    expect(sau.inviteTokenHash, "người đã bị khoá tự lấy lại được token kích hoạt").toBeNull();
  }, 60_000);

  it("khoá + chưa từng đăng nhập + KHÔNG có lời mời đang chờ (createUser rồi khoá) → không cấp token", async () => {
    // Tài khoản do admin tạo sẵn mật khẩu rồi khoá trước khi người đó kịp đăng nhập — lệnh khoá đã
    // đốt mọi token, nên đây KHÔNG phải một lời mời kẹt.
    const u = await taoUser("taotay", { active: false, passwordChangedAt: null, lastLoginAt: null, inviteTokenHash: null, inviteExpiresAt: null });
    await quenMatKhauRoiDoi(u.email);
    const sau = await prisma.user.findUnique({ where: { id: u.id }, select: { inviteTokenHash: true } });
    expect(sau.inviteTokenHash).toBeNull();
  }, 60_000);

  it("vế đối trọng: người được MỜI thật (lời mời còn treo) vẫn nhận được liên kết kích hoạt", async () => {
    const u = await taoUser("moi", {
      active: false, passwordChangedAt: null, lastLoginAt: null,
      inviteTokenHash: bam(`cu-${TAG}`), inviteExpiresAt: new Date(Date.now() - 86_400_000),
    });
    const truoc = bam(`cu-${TAG}`);
    sendPasswordReset({ body: { email: u.email }, headers: {}, ip: "127.0.0.1" });
    let moi = null;
    for (let i = 0; i < 100 && !moi; i++) {
      const r = await prisma.user.findUnique({ where: { id: u.id }, select: { inviteTokenHash: true } });
      if (r.inviteTokenHash && r.inviteTokenHash !== truoc) moi = r.inviteTokenHash;
      else await new Promise((res) => setTimeout(res, 100));
    }
    expect(moi, "lời mời kẹt lại thành ngõ cụt — đúng lỗi 2026-09-07 đã vá").toBeTruthy();
  }, 60_000);

  it("accept-invite: token còn hạn của tài khoản khoá ĐÃ TỪNG đăng nhập → 404, vẫn khoá", async () => {
    // Token phát ra theo lỗ cũ trước khi vá (hoặc bằng bất cứ đường nào khác) phải chết ở cửa này.
    const token = `tok-${TAG}-a`;
    const u = await taoUser("cotoken", {
      active: false, passwordChangedAt: null, lastLoginAt: new Date(Date.now() - 86_400_000),
      inviteTokenHash: bam(token), inviteExpiresAt: new Date(Date.now() + 3_600_000),
    });
    const ag = agentWithCsrf(app);
    const r = await ag.post("/api/auth/accept-invite").send({ token, password: "MatKhauMoi123x" });
    expect(r.status, JSON.stringify(r.body)).toBe(404);
    const sau = await prisma.user.findUnique({ where: { id: u.id }, select: { active: true } });
    expect(sau.active, "accept-invite tự mở khoá tài khoản bị khoá").toBe(false);
  }, 60_000);

  it("vế đối trọng: accept-invite cho người được mời thật vẫn kích hoạt được", async () => {
    const token = `tok-${TAG}-b`;
    const u = await taoUser("moithat", {
      active: false, passwordChangedAt: null, lastLoginAt: null,
      inviteTokenHash: bam(token), inviteExpiresAt: new Date(Date.now() + 3_600_000),
    });
    const ag = agentWithCsrf(app);
    const r = await ag.post("/api/auth/accept-invite").send({ token, password: "MatKhauMoi123x" });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect((await prisma.user.findUnique({ where: { id: u.id }, select: { active: true } })).active).toBe(true);
  }, 60_000);

  it("createUser ghi passwordChangedAt — tài khoản tạo tay không rơi vào nhóm NULL nữa", async () => {
    const ad = await taoUser("admin", { role: "admin", active: true });
    const ag = agentWithCsrf(app);
    const l = await ag.post("/api/auth/login").send({ username: ad.username, password: MAT_KHAU });
    expect(l.status).toBe(200);
    const username = `${TAG}-moitao`;
    const r = await ag.post("/api/users").send({ username, password: MAT_KHAU, displayName: "Moi tao", role: "manager" });
    expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(201);
    const hang = await prisma.user.findUnique({ where: { username }, select: { passwordChangedAt: true } });
    expect(hang.passwordChangedAt, "createUser đặt mật khẩu thật mà không đóng mốc").not.toBeNull();
  }, 60_000);

  it("migration backfill: chỉ đổi hàng NULL đã từng đăng nhập, về đúng createdAt; chạy lại không đổi gì", async () => {
    const sql = readFileSync(new URL("../prisma/migrations/20260923090000_backfill_password_changed_at/migration.sql", import.meta.url), "utf8");
    const daDangNhap = await taoUser("bf1", { active: true, passwordChangedAt: null, lastLoginAt: new Date() });
    const chuaDangNhap = await taoUser("bf2", { active: true, passwordChangedAt: null, lastLoginAt: null });
    const moc = new Date("2026-09-01T00:00:00Z");
    const daCo = await taoUser("bf3", { active: true, passwordChangedAt: moc, lastLoginAt: new Date() });

    await prisma.$executeRawUnsafe(sql);
    const a = await prisma.user.findUnique({ where: { id: daDangNhap.id }, select: { passwordChangedAt: true, createdAt: true } });
    expect(a.passwordChangedAt?.getTime()).toBe(a.createdAt.getTime());
    expect((await prisma.user.findUnique({ where: { id: chuaDangNhap.id }, select: { passwordChangedAt: true } })).passwordChangedAt).toBeNull();
    expect((await prisma.user.findUnique({ where: { id: daCo.id }, select: { passwordChangedAt: true } })).passwordChangedAt.getTime()).toBe(moc.getTime());

    // Idempotent: lượt hai không đổi gì.
    await prisma.$executeRawUnsafe(sql);
    const a2 = await prisma.user.findUnique({ where: { id: daDangNhap.id }, select: { passwordChangedAt: true } });
    expect(a2.passwordChangedAt.getTime()).toBe(a.createdAt.getTime());
  }, 60_000);
});
