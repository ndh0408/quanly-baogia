/**
 * CỤM auth-phien — phiên cookie KHÔNG có tuổi thọ TUYỆT ĐỐI (src/middleware.ts, enforceActiveUser).
 *
 * TÁI HIỆN: cấu hình phiên ở src/app.ts đặt `rolling: true` + cookie.maxAge 7 ngày, nghĩa là mỗi
 * request lại đẩy hạn cookie thêm 7 ngày nữa. `enforceActiveUser` đọc `req.session.authAt` DUY NHẤT
 * để so với `User.passwordChangedAt`, không hề so với tuổi tuyệt đối của phiên. Mà `passwordChangedAt`
 * nullable và chỉ được ghi bởi đổi-mật-khẩu / nhận-lời-mời / admin đặt lại.
 *
 * HẬU QUẢ: một tài khoản CHƯA TỪNG đổi mật khẩu có phiên sống VÔ HẠN, miễn là cookie được dùng ít
 * nhất một lần mỗi 7 ngày. Không có mốc nào buộc người dùng chứng minh lại danh tính bằng mật khẩu
 * (+MFA) — đúng lớp lỗi đã được vá cho HỌ refresh token (REFRESH_FAMILY_MAX_DAYS, src/jwt.ts).
 *
 * BÀI TEST ĐI QUA ĐÚNG LỚP CÓ LỖI: dựng express + express-session THẬT (cùng kho phiên trong bộ nhớ
 * mà test dùng ở src/app.ts), gieo `authAt` lùi về quá khứ rồi gọi CHÍNH `enforceActiveUser` — chứ
 * không gọi thẳng một hàm thuần nào. Người dùng là hàng THẬT trong CSDL vì middleware findUnique nó.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import session from "express-session";
import request from "supertest";
import { prisma } from "../src/db.js";
import { enforceActiveUser, requireAuth, SESSION_MAX_AGE_DAYS } from "../src/middleware.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "User" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") {
  throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres — test cụm auth-phien không được skip trong CI");
}

const TAG = `asxTtl${Date.now()}`;
const NGAY = 86400_000;

/** App tối thiểu: phiên thật + enforceActiveUser thật. /gieo đặt authAt, /do đi qua middleware. */
function dungApp(userId) {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test-secret-du-dai-cho-express-session", resave: false, saveUninitialized: false }));
  app.post("/gieo", (req, res) => {
    req.session.userId = userId;
    if (req.body.authAt !== null) req.session.authAt = req.body.authAt;
    req.session.save(() => res.json({ ok: true }));
  });
  // Xếp middleware ĐÚNG THỨ TỰ của src/app.ts (enforceActiveUser ở tầng app, requireAuth ở route),
  // để bài "request kế tiếp" đo được đúng thứ người dùng thật gặp sau khi phiên bị huỷ.
  app.get("/do", enforceActiveUser, requireAuth, (req, res) => res.json({ userId: req.session.userId }));
  return app;
}

describe.runIf(dbAvailable)("phiên cookie — trần tuổi thọ tuyệt đối", () => {
  let userId, app;

  beforeAll(async () => {
    const u = await prisma.user.create({
      data: { username: `${TAG}u`, displayName: "TTL Test", passwordHash: "x", active: true },
    });
    userId = u.id;
    app = dungApp(userId);
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId }, includeDeleted: true }).catch(() => {});
  });

  async function phienVoiTuoi(authAt) {
    const a = request.agent(app);
    await a.post("/gieo").send({ authAt });
    return a;
  }

  it("phiên QUÁ trần bị huỷ với code session_expired", async () => {
    const a = await phienVoiTuoi(Date.now() - (SESSION_MAX_AGE_DAYS + 1) * NGAY);
    const r = await a.get("/do");
    expect(r.status).toBe(401);
    expect(r.body.code).toBe("session_expired");
  });

  it("phiên CHƯA tới trần vẫn đi qua bình thường", async () => {
    const a = await phienVoiTuoi(Date.now() - (SESSION_MAX_AGE_DAYS - 1) * NGAY);
    const r = await a.get("/do");
    expect(r.status).toBe(200);
    expect(r.body.userId).toBe(userId);
  });

  it("phiên THIẾU authAt bị coi là quá hạn (fail-closed, không fail-open)", async () => {
    const a = await phienVoiTuoi(null);
    const r = await a.get("/do");
    expect(r.status).toBe(401);
    expect(r.body.code).toBe("session_expired");
  });

  it("phiên đã bị huỷ thì request KẾ TIẾP cũng không còn danh tính", async () => {
    const a = await phienVoiTuoi(Date.now() - (SESSION_MAX_AGE_DAYS + 1) * NGAY);
    await a.get("/do");
    const r = await a.get("/do");
    expect(r.status).toBe(401);
  });

  // Ba bài trên dùng CHÍNH hằng số nên chúng kiểm CƠ CHẾ, không ghim CHÍNH SÁCH: đổi trần thành 3650
  // ngày thì chúng vẫn xanh. Bài này ghim chính sách — trần phải đủ ngắn để có ý nghĩa và đủ dài để
  // không đá người dùng ra khỏi máy mỗi tuần.
  it("trần nằm trong khoảng hợp lý (7..90 ngày)", () => {
    expect(SESSION_MAX_AGE_DAYS).toBeGreaterThanOrEqual(7);
    expect(SESSION_MAX_AGE_DAYS).toBeLessThanOrEqual(90);
  });
});
