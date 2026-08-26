// CSRF — chốt hồi quy cho hàng rào chống giả mạo request.
//
// ── ĐIỀU ĐÃ THAY ĐỔI VÀ VÌ SAO ──────────────────────────────────────────────
// Bản cũ của csrfGuard KẾT THÚC BẰNG next() khi KHÔNG có Origin VÀ KHÔNG có Referer. Lập luận đi
// kèm ("trình duyệt nào cũng gửi Origin, nên đây chắc chắn là client không phải trình duyệt") đúng
// với trình duyệt hiện đại, nhưng nó đặt toàn bộ khả năng chống CSRF lên một hành vi mà máy chủ
// KHÔNG kiểm soát được, và mặc định của nhánh ấy là CHO QUA. Nay mặc định là TỪ CHỐI: thao tác ghi
// xác thực bằng phiên cookie phải kèm token đồng bộ hoá gắn với phiên.
//
// Phạm vi CỐ Ý hẹp — chỉ request xác thực bằng PHIÊN COOKIE. Đó đúng là tập request mà trình duyệt
// tự đính kèm thông tin đăng nhập, tức tập bị CSRF. Client Bearer và request chưa đăng nhập không
// bị ảnh hưởng (bộ test dưới chốt cả hai điều đó, để lần siết sau không lỡ tay chặn nhầm).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { prisma } from "../src/db.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "User" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");

const TAG = `csrf${Date.now()}`;
const PWD = "Test1234!a";
const ORIGIN = process.env.APP_BASE_URL || "http://localhost:3000";

describe.runIf(dbAvailable)("CSRF", () => {
  let app, agent, user;

  const layToken = async () => {
    const r = await agent.get("/api/csrf-token");
    expect(r.status).toBe(200);
    expect(typeof r.body.token).toBe("string");
    expect(r.body.token.length).toBeGreaterThanOrEqual(32);
    return r.body.token;
  };

  beforeAll(async () => {
    const { createApp } = await import("../src/app.js");
    app = createApp();
    user = await prisma.user.create({
      data: { username: `${TAG}-u`, displayName: `${TAG} u`, role: "admin", passwordHash: await bcrypt.hash(PWD, 4) },
    });
    agent = request.agent(app);
    expect((await agent.post("/api/auth/login").send({ username: user.username, password: PWD })).status).toBe(200);
  });

  afterAll(async () => {
    await prisma.loginAttempt.deleteMany({ where: { username: { startsWith: TAG } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
  });

  it("GET /api/csrf-token cấp mã, và KHÔNG được cache", async () => {
    const r = await agent.get("/api/csrf-token");
    expect(r.status).toBe(200);
    expect(r.headers["cache-control"]).toMatch(/no-store/);
  });

  it("GET không cần mã (phương thức an toàn đi thẳng)", async () => {
    expect((await agent.get("/api/auth/me")).status).toBe(200);
  });

  it("GHI có mã hợp lệ → đi qua", async () => {
    const token = await layToken();
    const r = await agent.post("/api/auth/logout").set("Origin", ORIGIN).set("X-CSRF-Token", token);
    expect(r.status).toBeLessThan(400);
    // đăng nhập lại cho các ca sau
    expect((await agent.post("/api/auth/login").send({ username: user.username, password: PWD })).status).toBe(200);
  });

  it("ĐÂY LÀ CHỖ ĐÃ SIẾT: KHÔNG Origin, KHÔNG Referer, KHÔNG mã → 403 (bản cũ CHO QUA)", async () => {
    const r = await agent.post("/api/customers").send({ name: "Khách giả mạo" });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("csrf_token_missing");
  });

  it("có Origin hợp lệ nhưng THIẾU mã → vẫn 403 (Origin một mình không còn đủ)", async () => {
    await layToken(); // phiên đã có bí mật
    const r = await agent.post("/api/customers").set("Origin", ORIGIN).send({ name: "Khách" });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("csrf_token_invalid");
  });

  it("mã SAI → 403", async () => {
    const token = await layToken();
    const r = await agent
      .post("/api/customers")
      .set("Origin", ORIGIN)
      .set("X-CSRF-Token", "0".repeat(token.length))
      .send({ name: "Khách" });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("csrf_token_invalid");
  });

  it("mã ĐÚNG ĐỘ DÀI nhưng của phiên KHÁC → 403 (mã gắn với phiên, không dùng chung)", async () => {
    const token = await layToken();
    const nguoiKhac = request.agent(app);
    const u2 = await prisma.user.create({
      data: { username: `${TAG}-u2`, displayName: `${TAG} u2`, role: "admin", passwordHash: await bcrypt.hash(PWD, 4) },
    });
    expect((await nguoiKhac.post("/api/auth/login").send({ username: u2.username, password: PWD })).status).toBe(200);
    const tokenKhac = (await nguoiKhac.get("/api/csrf-token")).body.token;
    expect(tokenKhac).not.toBe(token);

    const r = await agent.post("/api/customers").set("Origin", ORIGIN).set("X-CSRF-Token", tokenKhac).send({ name: "Khách" });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("csrf_token_invalid");
  });

  it("Origin LẠ → 403 ngay ở lớp 1, kể cả khi mã hợp lệ", async () => {
    const token = await layToken();
    const r = await agent
      .post("/api/customers")
      .set("Origin", "https://ke-tan-cong.example")
      .set("X-CSRF-Token", token)
      .send({ name: "Khách" });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("csrf_origin");
  });

  it("Referer LẠ (không có Origin) → 403", async () => {
    const token = await layToken();
    const r = await agent
      .post("/api/customers")
      .set("Referer", "https://ke-tan-cong.example/trang")
      .set("X-CSRF-Token", token)
      .send({ name: "Khách" });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("csrf_referer");
  });

  it("client Bearer KHÔNG bị đòi mã (token không được trình duyệt tự đính kèm)", async () => {
    const lr = await request(app).post("/api/auth/token").send({ username: user.username, password: PWD });
    expect(lr.status, JSON.stringify(lr.body)).toBe(200);
    const accessToken = lr.body.accessToken;
    expect(accessToken, "POST /api/auth/token phải cấp access token").toBeTruthy();

    // KHÔNG cookie, KHÔNG Origin, KHÔNG mã CSRF — chỉ Bearer. Phải KHÔNG bị chặn vì CSRF.
    const r = await request(app)
      .post("/api/customers")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name: `${TAG} khách bearer`, code: `KH-BR-${Date.now()}` });
    // Phải KHÔNG bị từ chối vì CSRF. Kiểm bằng THÔNG ĐIỆP LỖI, không kiểm r.body.code — với một
    // lần tạo THÀNH CÔNG thì `code` là mã KHÁCH HÀNG trong bản ghi trả về, không phải mã lỗi.
    expect(r.status).not.toBe(403);
    if (r.status >= 400) expect(String(r.body.error || "")).not.toMatch(/CSRF/i);
    if (r.status === 201 && r.body.id) {
      await prisma.customer.deleteMany({ where: { id: r.body.id }, hardDelete: true }).catch(() => {});
    }
  });

  it("CHƯA đăng nhập → không bị chặn vì CSRF (đăng nhập phải gọi được, 401 chứ không 403)", async () => {
    const r = await request(app).post("/api/auth/login").send({ username: "khong-ton-tai", password: "sai" });
    expect(r.status).toBe(401);
  });

  it("đăng nhập lại (session.regenerate) làm mã CŨ hết giá trị — đây là lý do client phải thử lại", async () => {
    const tokenCu = await layToken();
    // Đăng nhập lại KHI ĐANG CÓ PHIÊN cũng là thao tác ghi bằng phiên cookie → phải kèm mã, đúng
    // như SPA làm (nó gắn mã cho mọi lệnh ghi). Đây chính là hành vi mới, có chủ đích.
    expect(
      (await agent.post("/api/auth/login").set("Origin", ORIGIN).set("X-CSRF-Token", tokenCu)
        .send({ username: user.username, password: PWD })).status
    ).toBe(200);
    const r = await agent.post("/api/customers").set("Origin", ORIGIN).set("X-CSRF-Token", tokenCu).send({ name: "Khách" });
    expect(r.status).toBe(403);
    // lấy mã mới thì đi qua được
    const tokenMoi = await layToken();
    expect(tokenMoi).not.toBe(tokenCu);
    const ok = await agent
      .post("/api/customers")
      .set("Origin", ORIGIN)
      .set("X-CSRF-Token", tokenMoi)
      .send({ name: `${TAG} khách ok`, code: `${TAG}OK` });
    expect(ok.status).toBeLessThan(400);
    if (ok.body?.id) await prisma.customer.deleteMany({ where: { id: ok.body.id }, hardDelete: true }).catch(() => {});
  });
});
