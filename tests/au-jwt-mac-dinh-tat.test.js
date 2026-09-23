/**
 * AUTH-04 / DEP-06 — BỀ MẶT BEARER JWT MẶC ĐỊNH TẮT.
 *
 * Không client nào dùng JWT (web/src chỉ dùng cookie; không script/e2e nào gọi /api/auth/token),
 * nhưng trước bản vá nó vẫn mở ra Internet: ai có mật khẩu (+MFA) lấy được cặp access/refresh bền
 * 30 ngày mà người dùng không nhìn thấy trên giao diện, và mỗi chốt xác thực phải viết hai lần.
 *
 * Tắt bằng cờ JWT_API_ENABLED (mặc định false) thay vì xoá mã: khi thật sự có client di động thì
 * chỉ cần bật — bộ test JWT sẵn có (bật cờ bằng vi.hoisted) vẫn khoá hành vi khi bật.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";

// Cờ phải TẮT cho bài này, bất kể shell đang export gì.
vi.hoisted(() => { delete process.env.JWT_API_ENABLED; });

const { prisma } = await import("../src/db.js");
const { config } = await import("../src/config.js");
const { signAccessToken } = await import("../src/jwt.js");

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "User" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") {
  throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");
}

const TAG = `aujwt${Date.now()}`;
const MAT_KHAU = "JwtTat1234!ok";

describe("AUTH-04 — cờ JWT_API_ENABLED", () => {
  it("mặc định là TẮT khi không khai biến môi trường", () => {
    expect(config.JWT_API_ENABLED).toBe(false);
  });
});

describe.runIf(dbAvailable)("AUTH-04 — cờ tắt thì không cấp và không nhận Bearer", () => {
  let app, user;

  beforeAll(async () => {
    app = (await import("../src/app.js")).createApp();
    user = await prisma.user.create({
      data: { username: `${TAG}-u`, displayName: "Jwt tat", role: "admin", passwordHash: await bcrypt.hash(MAT_KHAU, 4), active: true },
    });
  }, 60_000);

  afterAll(async () => {
    await prisma.auditEvent.deleteMany({ where: { OR: [{ actorId: user?.id }, { resourceId: String(user?.id) }] } }).catch(() => {});
    await prisma.loginAttempt.deleteMany({ where: { username: { startsWith: TAG } } }).catch(() => {});
    await prisma.refreshToken.deleteMany({ where: { userId: user?.id } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true, includeDeleted: true }).catch(() => {});
  });

  it("POST /api/auth/token → 404, không cấp token nào", async () => {
    const r = await request(app).post("/api/auth/token").send({ username: user.username, password: MAT_KHAU });
    expect(r.status, JSON.stringify(r.body)).toBe(404);
    expect(r.body.accessToken).toBeUndefined();
    expect(await prisma.refreshToken.count({ where: { userId: user.id } })).toBe(0);
  });

  it("POST /api/auth/token/refresh → 404", async () => {
    const r = await request(app).post("/api/auth/token/refresh").send({ refreshToken: "c".repeat(64) });
    expect(r.status).toBe(404);
  });

  it("access token HỢP LỆ (ký đúng khoá) không xác thực được request nào", async () => {
    const tok = signAccessToken(user);
    const r = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${tok}`);
    expect(r.status, "Bearer vẫn được nhận khi cờ tắt").toBe(401);
  });

  it("vế đối trọng: đăng nhập cookie vẫn chạy như cũ", async () => {
    const ag = request.agent(app);
    const r = await ag.post("/api/auth/login").send({ username: user.username, password: MAT_KHAU });
    expect(r.status).toBe(200);
    expect((await ag.get("/api/auth/me")).status).toBe(200);
  });
});
