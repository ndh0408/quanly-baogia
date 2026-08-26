// Hồi quy bảo mật — đợt 2. Mỗi khối khoá một lỗ được xác minh trực tiếp từ mã nguồn ở lượt rà soát
// thứ hai, trong đó có HAI lỗ nằm trong chính bản vá của đợt 1.
//
// Cần Postgres + schema. CI/`test-on-dev.sh` đặt REQUIRE_DB_TESTS=1 để cấm bỏ qua âm thầm.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { agentWithCsrf } from "./helpers/agent.js";
import bcrypt from "bcryptjs";
import { prisma } from "../src/db.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "User" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") {
  throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres/schema");
}

const TAG = `sec2${Date.now()}`;
const PASSWORD = "Test1234!a";

describe.runIf(dbAvailable)("hồi quy bảo mật đợt 2 (integration)", () => {
  let app;
  const U = {}, A = {};

  async function makeUser(key, role, permissions, active = true) {
    U[key] = await prisma.user.create({
      data: {
        username: `${TAG}-${key}`, displayName: `${TAG} ${key}`, email: `${TAG}-${key}@example.test`,
        role, active, ...(permissions ? { permissions } : {}),
        passwordHash: await bcrypt.hash(PASSWORD, 4),
      },
    });
    A[key] = agentWithCsrf(app);
    if (active) {
      const r = await A[key].post("/api/auth/login").send({ username: U[key].username, password: PASSWORD });
      expect(r.status, `đăng nhập ${key}`).toBe(200);
    }
    return U[key];
  }

  beforeAll(async () => {
    ({ createApp: global.__ca } = await import("../src/app.js"));
    app = global.__ca();
    await makeUser("admin", "admin");
    await makeUser("manager", "manager");
    await makeUser("hr", "hr");
    // Quyền RIÊNG per-user khác hẳn mặc định của vai trò → dùng để bắt lỗi /permissions/me.
    await makeUser("custom", "manager", ["quote:create", "venue:read"]);
    await makeUser("inactive", "manager", null, false);
  });

  afterAll(async () => {
    const ids = Object.values(U).map((u) => u.id);
    await prisma.uploadObject.deleteMany({ where: { ownerId: { in: ids } } }).catch(() => {});
    await prisma.auditEvent.deleteMany({ where: { actorId: { in: ids } } }).catch(() => {});
    await prisma.loginAttempt.deleteMany({ where: { username: { startsWith: TAG } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
  });

  // ── AUTH-007: không phân loại được tài khoản qua phản hồi đăng nhập ─────────
  describe("AUTH-007 — đăng nhập không tiết lộ tài khoản có tồn tại hay không", () => {
    const login = (username, password) => request(app).post("/api/auth/login").send({ username, password });

    it("người-không-tồn-tại và sai-mật-khẩu cho phản hồi GIỐNG HỆT NHAU", async () => {
      const ghost = await login(`${TAG}-khong-ton-tai`, "SaiMatKhau123");
      const real = await login(U.manager.username, "SaiMatKhau123");
      expect(ghost.status).toBe(401);
      expect(real.status).toBe(401);
      // Đây là điểm mấu chốt: trước bản vá là "Tài khoản không tồn tại hoặc đã bị khóa" vs "Sai mật khẩu".
      expect(real.body.error).toBe(ghost.body.error);
      expect(JSON.stringify(real.body)).toBe(JSON.stringify(ghost.body));
    });

    it("tài khoản BỊ VÔ HIỆU HOÁ cũng cho cùng phản hồi đó", async () => {
      const off = await login(U.inactive.username, PASSWORD);
      const ghost = await login(`${TAG}-khong-ton-tai`, PASSWORD);
      expect(off.status).toBe(401);
      expect(off.body.error).toBe(ghost.body.error);
    });

    it("thông điệp KHÔNG chứa từ khoá phân loại tài khoản", async () => {
      const r = await login(U.manager.username, "SaiMatKhau123");
      expect(r.body.error).not.toMatch(/sai mật khẩu/i);
      expect(r.body.error).not.toMatch(/không tồn tại/i);
    });

    it("tài khoản đang KHOÁ + mật khẩu SAI → vẫn 401 chung (423 sẽ lộ là tài khoản có thật)", async () => {
      const u = await makeUser("locked", "manager");
      await prisma.user.update({ where: { id: u.id }, data: { lockedUntil: new Date(Date.now() + 600_000) } });
      const r = await login(u.username, "SaiMatKhau123");
      expect(r.status).toBe(401);
      const ghost = await login(`${TAG}-khong-ton-tai`, "SaiMatKhau123");
      expect(r.body.error).toBe(ghost.body.error);
    });

    it("tài khoản đang KHOÁ + mật khẩu ĐÚNG → 423 kèm giải thích (đã chứng minh danh tính)", async () => {
      const r = await login(U.locked.username, PASSWORD);
      expect(r.status).toBe(423);
      expect(r.body.error).toMatch(/tạm khóa/i);
    });

    it("nhật ký nội bộ VẪN phân biệt lý do (người vận hành thấy, kẻ tấn công không)", async () => {
      const reasons = await prisma.loginAttempt.findMany({
        where: { username: { startsWith: TAG }, success: false }, select: { reason: true },
      });
      const set = new Set(reasons.map((r) => r.reason));
      expect(set.has("no_such_user")).toBe(true);
      expect(set.has("bad_password")).toBe(true);
      expect(set.has("locked")).toBe(true);
    });
  });

  // ── SESSION-001: đổi mật khẩu phải giết mọi phiên khác + xoay phiên của mình ──
  describe("SESSION-001 — đổi mật khẩu vô hiệu hoá phiên cũ", () => {
    it("phiên thứ hai của cùng tài khoản bị 401 sau khi phiên thứ nhất đổi mật khẩu", async () => {
      const u = await makeUser("pwd", "manager");
      const other = agentWithCsrf(app);
      expect((await other.post("/api/auth/login").send({ username: u.username, password: PASSWORD })).status).toBe(200);
      expect((await other.get("/api/auth/me")).status).toBe(200); // còn sống trước khi đổi

      const ch = await A.pwd.post("/api/auth/change-password").send({ oldPassword: PASSWORD, newPassword: "MatKhauMoi456" });
      expect(ch.status).toBe(200);

      // Phiên B bị huỷ khỏi kho → request kế tiếp không còn danh tính.
      expect((await other.get("/api/auth/me")).status).toBe(401);
      // Phiên A (người vừa đổi) vẫn dùng được — không tự đá mình ra.
      expect((await A.pwd.get("/api/auth/me")).status).toBe(200);
    });

    it("access token JWT phát hành TRƯỚC khi đổi mật khẩu bị từ chối", async () => {
      const u = await makeUser("jwt", "manager");
      const tok = await request(app).post("/api/auth/token").send({ username: u.username, password: PASSWORD });
      expect(tok.status).toBe(200);
      const bearer = `Bearer ${tok.body.accessToken}`;
      // Còn sống trước khi đổi.
      expect((await request(app).get("/api/auth/me").set("Authorization", bearer)).status).toBe(200);

      await A.jwt.post("/api/auth/change-password").send({ oldPassword: PASSWORD, newPassword: "MatKhauMoi456" });

      // Refresh token đã bị thu hồi từ trước; đây là chốt cho ACCESS token đang cầm — nếu thiếu,
      // token cũ vẫn dùng được suốt TTL 15 phút sau khi nạn nhân vừa đổi mật khẩu.
      expect((await request(app).get("/api/auth/me").set("Authorization", bearer)).status).toBe(401);
    });

    it("định danh phiên của chính người đổi mật khẩu được XOAY (chống dùng lại chuỗi phiên cũ)", async () => {
      const u = await makeUser("pwd2", "manager");
      const agent = agentWithCsrf(app);
      const first = await agent.post("/api/auth/login").send({ username: u.username, password: PASSWORD });
      const sidBefore = String(first.headers["set-cookie"] || "");
      const ch = await agent.post("/api/auth/change-password").send({ oldPassword: PASSWORD, newPassword: "MatKhauMoi456" });
      expect(ch.status).toBe(200);
      const sidAfter = String(ch.headers["set-cookie"] || "");
      expect(sidAfter).toBeTruthy();          // có cấp cookie mới
      expect(sidAfter).not.toBe(sidBefore);   // và nó KHÁC cái cũ
    });
  });

  // ── PERM-001: một nguồn sự thật cho "quyền của tôi" ────────────────────────
  describe("PERM-001 — /permissions/me khớp /auth/me và khớp thứ server cưỡng chế", () => {
    it("tài khoản có quyền RIÊNG: hai endpoint trả cùng tập quyền", async () => {
      const a = await A.custom.get("/api/auth/me");
      const b = await A.custom.get("/api/permissions/me");
      expect(a.status).toBe(200); expect(b.status).toBe(200);
      expect([...b.body.permissions].sort()).toEqual([...a.body.permissions].sort());
    });

    it("trả quyền RIÊNG chứ không phải quyền mặc định của vai trò manager", async () => {
      const b = await A.custom.get("/api/permissions/me");
      expect(b.body.permissions).toContain("quote:create");
      // manager mặc định có quote:send + customer:read:all; tài khoản này thì KHÔNG.
      expect(b.body.permissions).not.toContain("quote:send");
      expect(b.body.permissions).not.toContain("customer:read:all");
    });

    it("khớp hành vi THẬT: không có quote:read → /api/quotes trả 403", async () => {
      const b = await A.custom.get("/api/permissions/me");
      expect(b.body.permissions.some((p) => p.startsWith("quote:read"))).toBe(false);
      expect((await A.custom.get("/api/quotes")).status).toBe(403);
    });
  });

  // ── FILE-002: trạng thái tải lên là RÀNG BUỘC, không phải quy ước ──────────
  describe("FILE-002 — object chưa xác minh thì không tải về được", () => {
    it("bản ghi pending → /sign-download bị 403 (bỏ qua /finalize không lách được)", async () => {
      const key = `uploads/u${U.manager.id}/${Date.now()}-pending.png`;
      await prisma.uploadObject.create({
        data: {
          key, stagingKey: `staging-${key}`, ownerId: U.manager.id, expectedMime: "image/png", expectedSize: 100,
          status: "pending", expiresAt: new Date(Date.now() + 600_000),
        },
      });
      const r = await A.manager.get("/api/files/sign-download").query({ key });
      expect(r.status).toBe(403);
    });

    it("ADMIN cũng không vượt được trạng thái chưa xác minh", async () => {
      const key = `uploads/u${U.manager.id}/${Date.now()}-pending-admin.png`;
      await prisma.uploadObject.create({
        data: {
          key, stagingKey: `staging-${key}`, ownerId: U.manager.id, expectedMime: "image/png", expectedSize: 100,
          status: "pending", expiresAt: new Date(Date.now() + 600_000),
        },
      });
      expect((await A.admin.get("/api/files/sign-download").query({ key })).status).toBe(403);
    });

    it("bản ghi rejected → 403", async () => {
      const key = `uploads/u${U.manager.id}/${Date.now()}-rejected.png`;
      await prisma.uploadObject.create({
        data: {
          key, stagingKey: `staging-${key}`, ownerId: U.manager.id, expectedMime: "image/png", expectedSize: 100,
          status: "rejected", rejectReason: "test", expiresAt: new Date(Date.now() + 600_000),
        },
      });
      expect((await A.manager.get("/api/files/sign-download").query({ key })).status).toBe(403);
    });

    it("TOCTOU: vùng TẠM không bao giờ tải về được, kể cả khi bản ghi đã finalized", async () => {
      // URL presigned PUT chỉ trỏ vào uploads/staging/. Nếu vùng tạm tải về được thì dù /finalize đã
      // xác minh xong, người dùng vẫn PUT đè nội dung khác bằng chính URL cũ (còn hiệu lực) rồi tải
      // về thứ chưa ai kiểm. Chặn thẳng theo tiền tố nên không phụ thuộc trạng thái bản ghi.
      const key = `uploads/u${U.manager.id}/${Date.now()}-final.png`;
      const stagingKey = `uploads/staging/u${U.manager.id}/${Date.now()}-tam.png`;
      await prisma.uploadObject.create({
        data: {
          key, stagingKey, ownerId: U.manager.id, expectedMime: "image/png", expectedSize: 100,
          actualMime: "image/png", actualSize: 100,
          status: "finalized", finalizedAt: new Date(), expiresAt: new Date(Date.now() + 600_000),
        },
      });
      // Khoá CUỐI: qua được cổng quyền (chỉ dừng ở 503 vì môi trường test chưa cấu hình S3).
      expect((await A.manager.get("/api/files/sign-download").query({ key })).status).not.toBe(403);
      // Khoá TẠM: 403 dứt khoát, dù bản ghi đã finalized.
      expect((await A.manager.get("/api/files/sign-download").query({ key: stagingKey })).status).toBe(403);
      // Admin cũng không.
      expect((await A.admin.get("/api/files/sign-download").query({ key: stagingKey })).status).toBe(403);
    });

    it("finalize object của NGƯỜI KHÁC → 403 (không lộ có tồn tại hay không)", async () => {
      const key = `uploads/u${U.admin.id}/${Date.now()}-cua-nguoi-khac.png`;
      expect((await A.manager.post("/api/files/finalize").send({ key })).status).toBe(403);
    });
  });

  // ── AUTHZ-007/008: least privilege cho meta + số báo giá kế tiếp ───────────
  describe("AUTHZ-007 — /quotes/next-number đòi quyền tạo báo giá", () => {
    it("hr → 403", async () => expect((await A.hr.get("/api/quotes/next-number")).status).toBe(403));
    it("manager → 200", async () => expect((await A.manager.get("/api/quotes/next-number")).status).toBe(200));
  });

  describe("AUTHZ-008 — /meta không rò đường dẫn tệp trên máy chủ", () => {
    it("companies + templates không có filePath / logoPath", async () => {
      for (const p of ["/api/meta/companies", "/api/meta/templates"]) {
        const r = await A.manager.get(p);
        expect(r.status, p).toBe(200);
        const body = JSON.stringify(r.body);
        expect(body, p).not.toMatch(/filePath/);
        expect(body, p).not.toMatch(/logoPath/);
      }
    });
  });

  // ── STORAGE-001: namespace không bị lách bằng traversal / trùng tiền tố ────
  describe("STORAGE-001 — canAccessKey chống traversal và trùng tiền tố", () => {
    it.each([
      "uploads/u{OTHER}/x.png",
      "logos/../uploads/u{OTHER}/x.png",
      "uploads/u{ME}/../u{OTHER}/x.png",
      "/uploads/u{ME}/x.png",
      "uploads//u{ME}/x.png",
      "uploads\\u{ME}\\x.png",
    ])("từ chối key %s", async (tpl) => {
      const key = tpl.replace("{ME}", String(U.manager.id)).replace("{OTHER}", String(U.admin.id));
      expect((await A.manager.get("/api/files/sign-download").query({ key })).status).toBe(403);
    });

    it("TRÙNG TIỀN TỐ: u1 không với được sang u10 (và ngược lại)", async () => {
      // Dựng đúng cặp id có quan hệ tiền tố để chứng minh startsWith không bị lách.
      const key = `uploads/u${U.manager.id}0/x.png`;
      expect((await A.manager.get("/api/files/sign-download").query({ key })).status).toBe(403);
    });
  });
});
