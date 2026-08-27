// ── §27: MỖI DÒNG LOG REQUEST PHẢI CÓ ĐỦ 7 TRƯỜNG, VÀ KHÔNG ĐƯỢC CÓ 6 THỨ ─────
//
// §27 liệt kê chính xác cái PHẢI có (route · method · status · latency · userId · role · requestId)
// và cái KHÔNG BAO GIỜ được có (mật khẩu · JWT · cookie phiên · bí mật MFA · số tài khoản · số căn
// cước). Trước bài này repo có `redactConfig` (src/logger.ts) canh vế CẤM, nhưng KHÔNG có gì canh
// vế PHẢI CÓ — mà thiếu `route` thì log gom về Loki không nhóm được theo endpoint, tức chính lý do
// tồn tại của việc gom log biến mất.
//
// Cách đo: dựng app thật, thay `logger` bằng một bộ hứng ghi vào mảng, gọi vài endpoint, rồi soi
// đúng những dòng "request completed". Không đọc stdout (phải phân tích chuỗi, và pino-pretty ở
// môi trường dev còn tô màu vào giữa).
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { prisma } from "../src/db.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "User" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");

const TAG = `lg${Date.now()}`;
const PWD = "Log1234!abcd";

describe.runIf(dbAvailable)("§27 trường bắt buộc trong log request", () => {
  let app, u, dong;

  beforeAll(async () => {
    dong = [];
    vi.resetModules();
    // Chặn ĐÚNG hàm mà pino-http gọi. `pino` xuất một đối tượng có `child()`, `info()`, `warn()`…
    // — pino-http gọi `logger.info(obj, msg)` cho mỗi request hoàn tất.
    // Dùng pino THẬT ghi vào bộ nhớ, không dựng logger giả: pino-http đọc `logger.levels.values`
    // và vài ký hiệu nội bộ khác, nên bản giả vừa dễ vỡ vừa KHÔNG chạy qua `redactConfig` — mà
    // đúng lớp che đó mới là thứ vế "không được log" cần kiểm.
    vi.doMock("../src/logger.js", async () => {
      const that = await vi.importActual("../src/logger.js");
      const { default: pino } = await import("pino");
      const luong = {
        write(chuoi) {
          for (const d of String(chuoi).split("\n")) {
            if (!d.trim()) continue;
            try { dong.push(JSON.parse(d)); } catch { /* dòng lạ — bỏ */ }
          }
        },
      };
      return { ...that, logger: pino({ level: "trace", redact: that.redactConfig }, luong) };
    });
    const { createApp } = await import("../src/app.js");
    app = createApp();
    u = await prisma.user.create({
      data: { username: `${TAG}-u`, displayName: `${TAG} u`, role: "admin", passwordHash: await bcrypt.hash(PWD, 4) },
    });
  });

  afterAll(async () => {
    vi.doUnmock("../src/logger.js");
    await prisma.loginAttempt.deleteMany({ where: { username: { startsWith: TAG } } }).catch(() => {});
    if (u) await prisma.user.deleteMany({ where: { id: u.id }, hardDelete: true }).catch(() => {});
  });

  const dongCua = (duong) => dong.filter((d) => d?.req?.url?.startsWith(duong));

  it("request ĐÃ ĐĂNG NHẬP có đủ route · method · status · latency · userId · role · reqId", async () => {
    const agent = request.agent(app);
    expect((await agent.post("/api/auth/login").send({ username: u.username, password: PWD })).status).toBe(200);
    dong.length = 0;
    expect((await agent.get("/api/auth/me")).status).toBe(200);

    const d = dongCua("/api/auth/me").at(-1);
    expect(d, "không có dòng log nào cho /api/auth/me").toBeTruthy();
    expect(d.req.method).toBe("GET");
    expect(d.res.status).toBe(200);
    expect(typeof d.responseTime).toBe("number");
    expect(d.userId).toBe(u.id);
    expect(d.role).toBe("admin");
    expect(typeof d.reqId).toBe("string");
    expect(d.reqId.length).toBeGreaterThan(8);
    // ĐÂY là trường mới: mẫu route, không phải URL thật.
    expect(d.route).toBe("/api/auth/me");
  });

  it("route là MẪU (`/api/quotes/:id`), không phải URL có id — nếu không thì gom log vô dụng", async () => {
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ username: u.username, password: PWD });
    dong.length = 0;
    // Báo giá không tồn tại → 404 từ TẦNG SERVICE, tức đã vào handler nên `req.route` có mặt.
    await agent.get("/api/quotes/999999999");
    const d = dongCua("/api/quotes/999999999").at(-1);
    expect(d).toBeTruthy();
    expect(d.route).toBe("/api/quotes/:id");
    expect(d.route).not.toContain("999999999");
  });

  it("request CHƯA đăng nhập: userId/role là null, KHÔNG phải chuỗi rỗng hay 'undefined'", async () => {
    dong.length = 0;
    await request(app).get("/api/auth/me");
    const d = dongCua("/api/auth/me").at(-1);
    expect(d).toBeTruthy();
    expect(d.userId ?? null).toBeNull();
    expect(d.role).toBeNull();
    expect(typeof d.reqId).toBe("string");
  });

  it("đường KHÔNG khớp route nào → route = null, KHÔNG bịa ra một mẫu", async () => {
    dong.length = 0;
    await request(app).get("/api/khong-ton-tai-dau-ca");
    const d = dongCua("/api/khong-ton-tai-dau-ca").at(-1);
    expect(d).toBeTruthy();
    expect(d.route).toBeNull();
  });

  it("KHÔNG log mật khẩu / cookie phiên / Authorization — kể cả khi chúng nằm trong request", async () => {
    dong.length = 0;
    await request(app)
      .post("/api/auth/login")
      .set("Authorization", "Bearer mot-token-bi-mat-khong-duoc-log")
      .set("Cookie", "qly.sid=phien-bi-mat-khong-duoc-log")
      .send({ username: u.username, password: PWD });
    const tatCa = JSON.stringify(dong);
    expect(tatCa).not.toContain(PWD);
    expect(tatCa).not.toContain("mot-token-bi-mat-khong-duoc-log");
    expect(tatCa).not.toContain("phien-bi-mat-khong-duoc-log");
  });
});
