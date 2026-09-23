/**
 * Bốn phát hiện P3 cụm xác thực (audit 2026-09-23):
 *   AUTH-05 — tài khoản KHÔNG có email: "Quên mật khẩu" không được gửi thư tới địa chỉ do người gọi gõ.
 *   AUTH-06 — token đặt-lại đang sống phải chết khi người dùng đổi mật khẩu / admin đặt lại mật khẩu.
 *   AUTH-07 — GET /api/csrf-token ẩn danh không được tạo phiên sống 7 ngày.
 *   AUTH-08 — SMTP không dùng TLS ngầm thì phải BẮT BUỘC STARTTLS (requireTLS).
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

describe("AUTH-08 — SMTP bắt buộc STARTTLS", () => {
  it("SMTP_PORT 587, không SMTP_SECURE → requireTLS true; SMTP_SECURE=true → không ép", async () => {
    const opts = [];
    vi.resetModules();
    vi.doMock("nodemailer", () => ({ default: { createTransport: (o) => { opts.push(o); return { sendMail: async () => ({ messageId: "x" }) }; } } }));
    const cu = { h: process.env.SMTP_HOST, p: process.env.SMTP_PORT, s: process.env.SMTP_SECURE };
    try {
      process.env.SMTP_HOST = "smtp.example.test"; process.env.SMTP_PORT = "587"; delete process.env.SMTP_SECURE;
      await (await import("../src/email.js")).sendEmail({ to: "a@example.test", subject: "s", text: "t" });
      vi.resetModules();
      process.env.SMTP_SECURE = "true"; process.env.SMTP_PORT = "465";
      await (await import("../src/email.js")).sendEmail({ to: "a@example.test", subject: "s", text: "t" });
    } finally {
      for (const [k, v] of [["SMTP_HOST", cu.h], ["SMTP_PORT", cu.p], ["SMTP_SECURE", cu.s]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
      vi.doUnmock("nodemailer");
      vi.resetModules();
    }
    expect(opts[0]?.requireTLS, "cổng 587 không ép STARTTLS — MITM gỡ được lời quảng bá").toBe(true);
    expect(opts[1]?.requireTLS).toBe(false);
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

  it("AUTH-06: admin đặt lại mật khẩu tài khoản ĐÃ kích hoạt → đốt token; tài khoản CHƯA kích hoạt giữ lời mời", async () => {
    const ad = await taoUser("ad", { role: "admin" });
    const ag = agentWithCsrf(app);
    expect((await ag.post("/api/auth/login").send({ username: ad.username, password: MAT_KHAU })).status).toBe(200);
    const kichHoat = await taoUser("kh", { inviteTokenHash: bam(`a-${TAG}`), inviteExpiresAt: new Date(Date.now() + 3_600_000) });
    const choMoi = await taoUser("cm", { active: false, inviteTokenHash: bam(`b-${TAG}`), inviteExpiresAt: new Date(Date.now() + 3_600_000) });
    expect((await ag.put(`/api/users/${kichHoat.id}`).send({ password: "DatLai123456x" })).status).toBe(200);
    expect((await ag.put(`/api/users/${choMoi.id}`).send({ password: "DatLai123456x" })).status).toBe(200);
    expect((await prisma.user.findUnique({ where: { id: kichHoat.id }, select: { inviteTokenHash: true } })).inviteTokenHash).toBeNull();
    expect((await prisma.user.findUnique({ where: { id: choMoi.id }, select: { inviteTokenHash: true } })).inviteTokenHash).toBe(bam(`b-${TAG}`));
  }, 60_000);

  it("AUTH-07: phiên ẩn danh của /api/csrf-token sống 1 giờ; sau đăng nhập về 7 ngày", async () => {
    const u = await taoUser("ck", {});
    const ag = request.agent(app);
    const r = await ag.get("/api/csrf-token");
    const maxAge = conSong(r);
    expect(maxAge, `phiên ẩn danh sống ${maxAge}s`).toBeLessThanOrEqual(3600);
    expect(maxAge).toBeGreaterThan(3500);
    const l = await ag.post("/api/auth/login").set("x-csrf-token", r.body.token).send({ username: u.username, password: MAT_KHAU });
    expect(l.status).toBe(200);
    const sau = conSong(l);
    expect(sau).toBeGreaterThan(600_000);
  }, 60_000);
});
