// HTTP-09 / HTTP-10 / HTTP-11 — cổng phiên và mã CSRF.
//
// HTTP-09: middleware phiên mount KHÔNG kèm path → mỗi asset tĩnh/index.html/probe tải kèm cookie
//   tốn một SELECT + một UPDATE (rolling) vào user_sessions; pool phiên không có trần chờ.
// HTTP-10: GET /api/csrf-token ẩn danh ghi một hàng phiên sống 7 ngày mỗi lượt.
// HTTP-11: request Bearer không kèm cookie → req.session không có regenerate → POST /api/auth/login
//   (mật khẩu ĐÚNG) và GET /api/csrf-token trả 500 thay vì 4xx.
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import request from "supertest";

// HTTP-11 chỉ có nghĩa khi bề mặt Bearer đang BẬT (AUTH-04: mặc định tắt, header Bearer bị bỏ qua).
// Bật TRƯỚC khi config.ts được nạp; ca "cờ tắt" ở cuối tệp tự tắt lại lúc chạy.
vi.hoisted(() => { process.env.JWT_API_ENABLED = "true"; });
import session from "express-session";
import bcrypt from "bcryptjs";
import { createHash } from "node:crypto";

const { prisma } = await import("../src/db.js");
const { conObjectPhien } = await import("../src/app.js");
const { config } = await import("../src/config.js");

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "User" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");

let app;
beforeAll(async () => {
  const { createApp } = await import("../src/app.js");
  app = createApp();
});
afterEach(() => vi.restoreAllMocks());

describe("HTTP-09 — phiên chỉ nạp dưới /api", () => {
  it("GET ngoài /api kèm cookie phiên KHÔNG chạm kho phiên", async () => {
    // Cookie THẬT (đúng chữ ký) — cookie giả bị express-session loại trước khi đọc kho, bài sẽ xanh
    // cả khi cổng phiên còn mount không path.
    const a = request.agent(app);
    expect((await a.get("/api/csrf-token")).status).toBe(200);
    const get = vi.spyOn(session.MemoryStore.prototype, "get");
    await a.get("/livez");
    await a.get("/app2/khong-co.js");
    expect(get, "asset/probe ngoài /api vẫn đọc bảng phiên").not.toHaveBeenCalled();
  });

  it("dưới /api vẫn nạp phiên như cũ", async () => {
    const a = request.agent(app);
    const t = await a.get("/api/csrf-token");
    expect(t.status).toBe(200);
    const get = vi.spyOn(session.MemoryStore.prototype, "get");
    await a.get("/api/auth/me");
    expect(get).toHaveBeenCalled();
  });

  it("pool phiên có trần chờ lấy kết nối (không chờ vô hạn)", () => {
    expect(conObjectPhien().connectionTimeoutMillis).toBe(config.DB_TX_MAX_WAIT);
  });
});

describe("HTTP-10 — phiên ẩn danh của /api/csrf-token sống ngắn", () => {
  it("cookie phiên ẩn danh hết hạn trong ≤ 30 phút", async () => {
    const r = await request(app).get("/api/csrf-token");
    expect(r.status).toBe(200);
    const ck = (r.headers["set-cookie"] || []).find((c) => c.startsWith("qly.sid="));
    expect(ck, "không có cookie phiên").toBeTruthy();
    const han = new Date(/Expires=([^;]+)/i.exec(ck)[1]).getTime();
    expect(han - Date.now(), "phiên ẩn danh sống 7 ngày").toBeLessThanOrEqual(30 * 60 * 1000 + 5000);
  });
});

describe.runIf(dbAvailable)("HTTP-11 — Bearer không kèm cookie gọi đường của phiên", () => {
  const TAG = `hsbearer${Date.now()}`;
  const PWD = "Test1234!a";
  let u;
  beforeAll(async () => {
    u = await prisma.user.create({ data: { username: `${TAG}-u`, displayName: TAG, role: "manager", passwordHash: await bcrypt.hash(PWD, 4) } });
  });
  afterAll(async () => {
    await prisma.loginAttempt.deleteMany({ where: { username: { startsWith: TAG } } }).catch(() => {});
    const ids = (await prisma.user.findMany({ where: { username: { startsWith: TAG } }, select: { id: true } })).map((x) => x.id);
    await prisma.auditEvent.deleteMany({ where: { OR: [{ actorId: { in: ids } }, { resourceId: { in: ids.map(String) } }] } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
  });

  it("POST /api/auth/login với Bearer + mật khẩu ĐÚNG → 400 chỉ đường, không 500", async () => {
    const r = await request(app).post("/api/auth/login").set("Authorization", "Bearer x").send({ username: u.username, password: PWD });
    expect(r.status, JSON.stringify(r.body)).toBe(400);
    expect(r.body.error).toMatch(/\/api\/auth\/token/);
  });

  // ── Soát chéo auth#7: HTTP-11 chỉ vá /login và /csrf-token ─────────────────────────────────
  // Hai đường cấp phiên còn lại cùng gốc lỗi (establishSession gọi `req.session.regenerate` không
  // tồn tại) nhưng TỆ HƠN /login: chúng GHI CSDL trước khi tới establishSession. Nên mỗi ca kiểm cả
  // status LẪN CSDL — status nói một đằng, CSDL một nẻo là đúng cái lỗi đang gác.
  it("POST /api/auth/change-password qua Bearer (không cookie) → 200 reauth, CSDL khớp status, không 500 sau khi đã đổi", async () => {
    const MOI = "DoiQuaBearer123x";
    const v = await prisma.user.create({ data: { username: `${TAG}-cp`, displayName: TAG, role: "manager", passwordHash: await bcrypt.hash(PWD, 4) } });
    const tk = await request(app).post("/api/auth/token").send({ username: v.username, password: PWD });
    expect(tk.status, JSON.stringify(tk.body)).toBe(200);
    const r = await request(app).post("/api/auth/change-password").set("Authorization", `Bearer ${tk.body.accessToken}`).send({ oldPassword: PWD, newPassword: MOI });
    const daDoi = await bcrypt.compare(MOI, (await prisma.user.findUnique({ where: { id: v.id }, select: { passwordHash: true } })).passwordHash);
    expect(daDoi, "mật khẩu phải đổi thật khi trả 200").toBe(true);
    expect(r.status, `CSDL đã đổi mật khẩu mà client nhận ${r.status}: ${JSON.stringify(r.body)}`).toBe(200);
    expect(r.body).toMatchObject({ ok: true, reauth: true });
    expect(r.headers["set-cookie"], "client Bearer không được nhận cookie phiên").toBeUndefined();
    // Chứng thư cũ chết theo passwordChangedAt / revokeAllForUser — client phải lấy cặp mới bằng mật khẩu mới.
    expect((await request(app).get("/api/auth/me").set("Authorization", `Bearer ${tk.body.accessToken}`)).status).toBe(401);
    expect((await request(app).post("/api/auth/token/refresh").send({ refreshToken: tk.body.refreshToken })).status).toBe(401);
    expect((await request(app).post("/api/auth/token").send({ username: v.username, password: MOI })).status).toBe(200);
  });

  it("POST /api/auth/accept-invite kèm Bearer (không cookie) → 400 TRƯỚC khi tiêu token mời, tài khoản chưa bị kích hoạt", async () => {
    const token = `tok-${TAG}-ai`;
    const bam = createHash("sha256").update(token).digest("hex");
    const w = await prisma.user.create({ data: { username: `${TAG}-ai`, displayName: TAG, role: "manager", active: false, passwordHash: "x", inviteTokenHash: bam, inviteExpiresAt: new Date(Date.now() + 3_600_000) } });
    const r = await request(app).post("/api/auth/accept-invite").set("Authorization", "Bearer x").send({ token, password: "NhanLoiMoi123x" });
    const sau = await prisma.user.findUnique({ where: { id: w.id }, select: { inviteTokenHash: true, active: true, passwordChangedAt: true } });
    expect(sau.inviteTokenHash, `token mời bị tiêu dù client nhận ${r.status}`).toBe(bam);
    expect(sau.active).toBe(false);
    expect(sau.passwordChangedAt).toBeNull();
    expect(r.status, JSON.stringify(r.body)).toBe(400);
    expect(r.body.code).toBe("dung_auth_token");
    // Đối chứng: cùng token, đi đường trình duyệt (không Bearer) vẫn nhận được lời mời.
    expect((await request(app).post("/api/auth/accept-invite").send({ token, password: "NhanLoiMoi123x" })).status).toBe(200);
  });

  it("GET /api/csrf-token với Bearer → 400, không 500", async () => {
    const r = await request(app).get("/api/csrf-token").set("Authorization", "Bearer x");
    expect(r.status).toBe(400);
  });

  it("cờ JWT_API_ENABLED TẮT: header Bearer bị bỏ qua hẳn — đăng nhập bằng mật khẩu chạy như thường", async () => {
    const cu = config.JWT_API_ENABLED;
    config.JWT_API_ENABLED = false;   // cờ đọc lúc request (src/app.ts, src/middleware.ts)
    try {
      const r = await request(app).get("/api/csrf-token").set("Authorization", "Bearer x");
      expect(r.status).toBe(200);
    } finally { config.JWT_API_ENABLED = cu; }
  });
});

describe("establishSession không có phiên thật → 400 có mã, không TypeError 500 (soát chéo auth#7)", () => {
  it("req.session là object trần (bearerAuth) hoặc undefined → ném httpError 400 'dung_auth_token'", async () => {
    const { establishSession } = await import("../src/services/authService.js");
    const seed = { id: 1, username: "x", role: "manager", displayName: "x" };
    for (const req of [{ session: {} }, {}]) {
      const e = await establishSession(req, seed).then(() => null, (err) => err);
      expect(e, "phải từ chối").toBeTruthy();
      expect(e.status, String(e?.message)).toBe(400);
      expect(e.code).toBe("dung_auth_token");
    }
  });
});
