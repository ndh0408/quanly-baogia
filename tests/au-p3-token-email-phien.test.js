/**
 * Bốn phát hiện P3 cụm xác thực (audit 2026-09-23):
 *   AUTH-05 — tài khoản KHÔNG có email: "Quên mật khẩu" không được gửi thư tới địa chỉ do người gọi gõ.
 *   AUTH-06 — token đặt-lại đang sống phải chết khi người dùng đổi mật khẩu / admin đặt lại mật khẩu.
 *   AUTH-07 — GET /api/csrf-token ẩn danh không được tạo phiên sống 7 ngày.
 *   AUTH-08 — SMTP không dùng TLS ngầm thì phải BẮT BUỘC STARTTLS (requireTLS), trừ máy bắt thư cục bộ
 *             (mailhog/localhost/*.local) và khi SMTP_REQUIRE_TLS=false.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import { createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import { agentWithCsrf } from "./helpers/agent.js";
import { prisma } from "../src/db.js";
import { sendPasswordReset } from "../src/services/authService.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "User" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") {
  throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");
}

const TAG = `aup3${Date.now()}`;
const MAT_KHAU = "AuthP3x1234!ok";
const bam = (t) => createHash("sha256").update(String(t)).digest("hex");

describe("AUTH-08 — SMTP bắt buộc STARTTLS (trừ máy bắt thư cục bộ)", () => {
  // Dựng transporter THẬT qua sendEmail với nodemailer giả, để đo đúng options đi vào createTransport.
  const doOptions = async (env) => {
    const opts = [];
    vi.resetModules();
    vi.doMock("nodemailer", () => ({ default: { createTransport: (o) => { opts.push(o); return { sendMail: async () => ({ messageId: "x" }) }; } } }));
    const khoa = ["SMTP_HOST", "SMTP_PORT", "SMTP_SECURE", "SMTP_REQUIRE_TLS"];
    const cu = Object.fromEntries(khoa.map((k) => [k, process.env[k]]));
    try {
      for (const k of khoa) { if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k]; }
      await (await import("../src/email.js")).sendEmail({ to: "a@example.test", subject: "s", text: "t" });
    } finally {
      for (const k of khoa) { if (cu[k] === undefined) delete process.env[k]; else process.env[k] = cu[k]; }
      vi.doUnmock("nodemailer");
      vi.resetModules();
    }
    return opts[0];
  };

  it("gmail:587, SMTP_SECURE=false (cấu hình production) → requireTLS true", async () => {
    const o = await doOptions({ SMTP_HOST: "smtp.gmail.com", SMTP_PORT: "587", SMTP_SECURE: "false" });
    expect(o?.requireTLS, "cổng 587 không ép STARTTLS — MITM gỡ được lời quảng bá").toBe(true);
  });

  it("mailhog:1025 (dev/staging) → requireTLS false — MailHog không hỗ trợ STARTTLS", async () => {
    const o = await doOptions({ SMTP_HOST: "mailhog", SMTP_PORT: "1025", SMTP_SECURE: "false" });
    expect(o?.requireTLS, "ép STARTTLS với MailHog là mọi thư trên dev đều lỗi").toBe(false);
  });

  it("SMTP_REQUIRE_TLS=false → requireTLS false (tắt tường minh)", async () => {
    const o = await doOptions({ SMTP_HOST: "relay.noibo.example", SMTP_PORT: "25", SMTP_REQUIRE_TLS: "false" });
    expect(o?.requireTLS).toBe(false);
  });

  it("các máy cục bộ khác và TLS ngầm", async () => {
    const { canBatStartTls } = await import("../src/email.js");
    for (const host of ["localhost", "127.0.0.1", "::1", "LOCALHOST", "mail.dev.local"]) {
      expect(canBatStartTls({ SMTP_HOST: host }), host).toBe(false);
    }
    expect(canBatStartTls({ SMTP_HOST: "smtp.gmail.com", SMTP_SECURE: "true" })).toBe(false);
    expect(canBatStartTls({ SMTP_HOST: "smtp.gmail.com" })).toBe(true);
    expect(canBatStartTls({ SMTP_HOST: "smtp.gmail.com", SMTP_REQUIRE_TLS: "true" })).toBe(true);
    // Tên chỉ CHỨA "local" mà không kết thúc bằng ".local" thì KHÔNG được miễn.
    expect(canBatStartTls({ SMTP_HOST: "localmail.example.com" })).toBe(true);
  });
});

describe.runIf(dbAvailable)("AUTH-05/06/07", () => {
  let app;
  const taoUser = (hau, data) => prisma.user.create({
    data: { username: `${TAG}-${hau}`, displayName: hau, role: "manager", passwordHash: bcrypt.hashSync(MAT_KHAU, 4), active: true, ...data },
  });

  // express-session ghi `Expires=` (không phải Max-Age) — quy về số giây còn sống.
  const conSong = (res) => {
    const m = /Expires=([^;]+)/i.exec(String(res.headers["set-cookie"] || ""));
    return m ? Math.round((new Date(m[1]).getTime() - Date.now()) / 1000) : NaN;
  };

  beforeAll(async () => { app = (await import("../src/app.js")).createApp(); }, 60_000);
  afterAll(async () => {
    const ids = (await prisma.user.findMany({ where: { username: { startsWith: TAG } }, select: { id: true }, includeDeleted: true })).map((u) => u.id);
    await prisma.auditEvent.deleteMany({ where: { OR: [{ actorId: { in: ids } }, { resourceId: { in: ids.map(String) } }] } }).catch(() => {});
    await prisma.loginAttempt.deleteMany({ where: { username: { startsWith: TAG } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true, includeDeleted: true }).catch(() => {});
  });

  it("AUTH-05: tài khoản có username là email nhưng cột email NULL → không cấp token, không gửi thư", async () => {
    const emailCu = `${TAG}.cu@example.vn`;
    const u = await prisma.user.create({ data: { username: emailCu, email: null, displayName: "Khong email", passwordHash: bcrypt.hashSync(MAT_KHAU, 4), active: true } });
    const dc = await taoUser("dc", { email: `${TAG}.dc@example.vn` });
    try {
      sendPasswordReset({ body: { email: emailCu }, headers: {}, ip: "127.0.0.1" });
      sendPasswordReset({ body: { email: dc.email }, headers: {}, ip: "127.0.0.1" });
      let coToken = null;
      for (let i = 0; i < 100 && !coToken; i++) {
        coToken = (await prisma.user.findUnique({ where: { id: dc.id }, select: { inviteTokenHash: true } })).inviteTokenHash;
        if (!coToken) await new Promise((r) => setTimeout(r, 100));
      }
      expect(coToken, "mốc đồng bộ hỏng").toBeTruthy();
      const sau = await prisma.user.findUnique({ where: { id: u.id }, select: { inviteTokenHash: true } });
      expect(sau.inviteTokenHash, "thư đặt lại gửi tới hộp thư do người gọi gõ, không phải email của tài khoản").toBeNull();
    } finally {
      await prisma.auditEvent.deleteMany({ where: { resourceId: String(u.id) } }).catch(() => {});
      await prisma.user.delete({ where: { id: u.id }, hardDelete: true }).catch(() => {});
    }
  }, 60_000);

  it("AUTH-06: token đặt-lại phát trước khi đổi mật khẩu → accept-invite 404", async () => {
    const token = `tok-${TAG}-cp`;
    const u = await taoUser("cp", { email: `${TAG}.cp@example.vn`, inviteTokenHash: bam(token), inviteExpiresAt: new Date(Date.now() + 3_600_000) });
    const ag = agentWithCsrf(app);
    expect((await ag.post("/api/auth/login").send({ username: u.username, password: MAT_KHAU })).status).toBe(200);
    expect((await ag.post("/api/auth/change-password").send({ oldPassword: MAT_KHAU, newPassword: "MatKhauMoi789z" })).status).toBe(200);
    const r = await agentWithCsrf(app).post("/api/auth/accept-invite").send({ token, password: "KeTanCong123x" });
    expect(r.status, "token đặt-lại sống sót qua lần đổi mật khẩu").toBe(404);
  }, 60_000);

  // Soát chéo auth#6 (AUTH-01 × AUTH-06): bản trước của ca này cho `PUT {password}` lên tài khoản
  // CHƯA kích hoạt trả 200 rồi chỉ kiểm `inviteTokenHash` còn nguyên — xanh mà không gác mục đích.
  // Mục đích là LIÊN KẾT MỜI CÒN DÙNG ĐƯỢC, mà sau lệnh đó thì không: updateUser đóng mốc
  // `passwordChangedAt`, và chốt lớp hai của acceptInvite (`!active && passwordChangedAt`) trả 404.
  // Hàng vẫn hiện "Chờ kích hoạt" + nút "Gửi lại lời mời", nhưng mọi liên kết đều chết vĩnh viễn.
  // Nên nay đi HẾT ĐƯỜNG: đặt mật khẩu lên tài khoản đang chờ phải bị TỪ CHỐI, và lời mời phải còn nhận được.
  it("AUTH-06: admin đặt lại mật khẩu tài khoản ĐÃ kích hoạt → đốt token; tài khoản CHƯA kích hoạt → 400, lời mời vẫn nhận được", async () => {
    const ad = await taoUser("ad", { role: "admin" });
    const ag = agentWithCsrf(app);
    expect((await ag.post("/api/auth/login").send({ username: ad.username, password: MAT_KHAU })).status).toBe(200);
    const kichHoat = await taoUser("kh", { inviteTokenHash: bam(`a-${TAG}`), inviteExpiresAt: new Date(Date.now() + 3_600_000) });
    const choMoi = await taoUser("cm", { active: false, inviteTokenHash: bam(`b-${TAG}`), inviteExpiresAt: new Date(Date.now() + 3_600_000) });
    expect((await ag.put(`/api/users/${kichHoat.id}`).send({ password: "DatLai123456x" })).status).toBe(200);
    expect((await prisma.user.findUnique({ where: { id: kichHoat.id }, select: { inviteTokenHash: true } })).inviteTokenHash).toBeNull();

    const r = await ag.put(`/api/users/${choMoi.id}`).send({ password: "DatLai123456x" });
    expect(r.status, "đặt mật khẩu lên tài khoản đang chờ → liên kết mời chết mà hàng vẫn 'Chờ kích hoạt'").toBe(400);
    expect(r.body.error).toMatch(/Gửi lại lời mời/);
    const sau = await prisma.user.findUnique({ where: { id: choMoi.id }, select: { inviteTokenHash: true, passwordChangedAt: true, active: true } });
    expect(sau.inviteTokenHash).toBe(bam(`b-${TAG}`));
    expect(sau.passwordChangedAt, "400 mà vẫn đóng mốc = vẫn giết lời mời").toBeNull();
    const nhan = await agentWithCsrf(app).post("/api/auth/accept-invite").send({ token: `b-${TAG}`, password: "NhanLoiMoi123x" });
    expect(nhan.status, `liên kết mời của tài khoản đang chờ phải còn dùng được: ${JSON.stringify(nhan.body)}`).toBe(200);
  }, 60_000);

  it("AUTH-06: MỞ KHOÁ cùng lúc đặt mật khẩu cho tài khoản đang chờ → 200, tài khoản dùng được, lời mời bị đốt", async () => {
    const ad = await taoUser("ad2", { role: "admin" });
    const ag = agentWithCsrf(app);
    expect((await ag.post("/api/auth/login").send({ username: ad.username, password: MAT_KHAU })).status).toBe(200);
    const choMoi = await taoUser("cm2", { active: false, inviteTokenHash: bam(`c-${TAG}`), inviteExpiresAt: new Date(Date.now() + 3_600_000) });
    expect((await ag.put(`/api/users/${choMoi.id}`).send({ active: true, password: "DatLai123456x" })).status).toBe(200);
    const sau = await prisma.user.findUnique({ where: { id: choMoi.id }, select: { inviteTokenHash: true, active: true } });
    expect(sau.active).toBe(true);
    expect(sau.inviteTokenHash, "admin đã giao mật khẩu — token đặt-lại còn sống là cửa thứ hai vào tài khoản").toBeNull();
    expect((await agentWithCsrf(app).post("/api/auth/login").send({ username: choMoi.username, password: "DatLai123456x" })).status).toBe(200);
  }, 60_000);

  it("AUTH-06: 'Gửi lại lời mời' cho tài khoản bị khoá ĐÃ TỪNG đăng nhập → 400, không phát liên kết chắc chắn 404", async () => {
    const ad = await taoUser("ad3", { role: "admin" });
    const ag = agentWithCsrf(app);
    expect((await ag.post("/api/auth/login").send({ username: ad.username, password: MAT_KHAU })).status).toBe(200);
    const khoa = await taoUser("kd", { active: false, email: `${TAG}.kd@example.vn`, lastLoginAt: new Date(Date.now() - 86_400_000) });
    const r = await ag.post(`/api/users/${khoa.id}/resend-invite`);
    expect(r.status, `resendInvite báo emailSent trong khi acceptInvite sẽ 404: ${JSON.stringify(r.body)}`).toBe(400);
    expect((await prisma.user.findUnique({ where: { id: khoa.id }, select: { inviteTokenHash: true } })).inviteTokenHash).toBeNull();
    // Đối chứng: tài khoản đang chờ THẬT (chưa từng kích hoạt) vẫn gửi lại được.
    const cho = await taoUser("cm3", { active: false, email: `${TAG}.cm3@example.vn`, inviteTokenHash: bam(`d-${TAG}`), inviteExpiresAt: new Date(Date.now() + 3_600_000) });
    expect((await ag.post(`/api/users/${cho.id}/resend-invite`)).status).toBe(200);
  }, 60_000);

  it("AUTH-07: phiên ẩn danh của /api/csrf-token sống 1 giờ; sau đăng nhập về 7 ngày", async () => {
    const u = await taoUser("ck", {});
    const ag = request.agent(app);
    const r = await ag.get("/api/csrf-token");
    const maxAge = conSong(r);
    // 30 phút — AUTH-07 và HTTP-10 sửa cùng lỗi, khi gộp chốt một con số (xem src/app.ts /api/csrf-token).
    expect(maxAge, `phiên ẩn danh sống ${maxAge}s`).toBeLessThanOrEqual(1800);
    expect(maxAge).toBeGreaterThan(1700);
    const l = await ag.post("/api/auth/login").set("x-csrf-token", r.body.token).send({ username: u.username, password: MAT_KHAU });
    expect(l.status).toBe(200);
    const sau = conSong(l);
    expect(sau).toBeGreaterThan(600_000);
  }, 60_000);
});
