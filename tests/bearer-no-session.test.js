// Request Bearer KHÔNG được sinh phiên cookie — chốt hồi quy.
//
// ── LỖI ─────────────────────────────────────────────────────────────────────
// `bearerAuth` (src/middleware.ts) ghi danh tính vào `req.session` để mã phía sau không phải phân
// biệt hai đường xác thực. Nhưng ghi vào đối tượng phiên là ĐÁNH DẤU NÓ ĐÃ THAY ĐỔI, nên
// express-session LƯU nó xuống kho PG và trả kèm `Set-Cookie` — cho một client API chưa bao giờ
// xin cookie.
//
// Đã đo trước khi vá: 5 request Bearer → `user_sessions` tăng 4→9 (đúng 5 hàng mới) và 5/5 phản hồi
// có Set-Cookie.
//
// Hai hậu quả:
//   1. `user_sessions` phình không giới hạn. Một script gọi API mỗi phút sinh 1.440 hàng/ngày, mỗi
//      hàng sống 7 ngày (~10.000 hàng thường trực). Job prune chỉ dọn hàng ĐÃ HẾT HẠN.
//   2. Client API cầm thêm một thông tin đăng nhập THỨ HAI (cookie phiên) nằm NGOÀI đường thu hồi
//      token mà hệ thống công bố — thu hồi refresh token không giết được cái cookie đó.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { prisma } from "../src/db.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "User" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");

const TAG = `bns${Date.now()}`;
const PWD = "Test1234!a";

describe.runIf(dbAvailable)("Bearer không sinh phiên cookie", () => {
  let app, user, token, envCu;

  /**
   * Tập `sid` đang có trong bảng phiên.
   *
   * ── VÌ SAO KHÔNG ĐẾM SỐ HÀNG ───────────────────────────────────────────
   * Bản trước là `SELECT count(*)` rồi khẳng định `sau - truoc === 0`. Bài kiểm đó CHẬP CHỜN, và
   * đã đỏ thật trong verify với `expected -2 to be +0` — tức bảng MẤT 2 hàng giữa hai lần đếm.
   *
   * Thủ phạm không phải mã đang kiểm: `src/app.ts` dựng kho phiên với
   * `pruneSessionInterval: 60 * 60`, và `connect-pg-simple` dọn phiên hết hạn NGAY khi kho được
   * dựng. Mỗi `createApp()` trong bộ test đều kích một lượt dọn, xoá bớt hàng của những lượt chạy
   * trước — ngay giữa `truoc` và `sau`.
   *
   * Hiệu số ròng vì thế KHÔNG phải thứ cần đo. Ý định thật của bài này là "đường Bearer không được
   * SINH hàng phiên nào", và cái đó chỉ so được bằng TẬP `sid`: hàng bị dọn đi không liên quan.
   */
  const tapPhien = async () =>
    new Set((await prisma.$queryRawUnsafe("SELECT sid FROM user_sessions")).map((r) => r.sid));

  /** Những sid CÓ trong `sau` mà KHÔNG có trong `truoc` — tức hàng phiên vừa được sinh ra. */
  const phienMoi = (truoc, sau) => [...sau].filter((x) => !truoc.has(x));

  beforeAll(async () => {
    // NODE_ENV=test dùng MemoryStore, không chạm bảng user_sessions → không đo được gì.
    // Ép sang "development" để kho phiên PG THẬT được dùng, đúng như production.
    //
    // `vi.resetModules()` là BẮT BUỘC, không phải cho chắc. `src/config.ts` đọc process.env NGAY
    // LÚC NẠP MODULE rồi đóng băng kết quả, và `app.ts` chọn kho phiên bằng `config.NODE_ENV`.
    // Dòng `import { prisma } from "../src/db.js"` ở đầu file này kéo theo `src/config.js` (db.ts
    // import config để lấy trần transaction) — tức config đã bị đóng băng ở "test" TRƯỚC khi
    // beforeAll chạy. Không nạp lại module thì `createApp()` lặng lẽ dùng MemoryStore, bảng
    // user_sessions không hề được ghi, và bài test dưới đo NHẦM: nó sẽ báo "không sinh hàng phiên"
    // cho CẢ hai đường — xanh vì lý do sai ở ca Bearer, đỏ khó hiểu ở ca cookie.
    envCu = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    vi.resetModules();
    const { createApp } = await import("../src/app.js");
    app = createApp();
    user = await prisma.user.create({
      data: { username: `${TAG}u`, displayName: TAG, role: "admin", passwordHash: await bcrypt.hash(PWD, 4) },
    });
    const r = await request(app).post("/api/auth/token").send({ username: user.username, password: PWD });
    expect(r.status).toBe(200);
    token = r.body.accessToken;
  });

  afterAll(async () => {
    process.env.NODE_ENV = envCu;
    await prisma.loginAttempt.deleteMany({ where: { username: { startsWith: TAG } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
  });

  it("nhiều request Bearer → KHÔNG thêm hàng user_sessions, KHÔNG có Set-Cookie", async () => {
    const truoc = await tapPhien();
    let coCookie = 0;
    for (let i = 0; i < 5; i++) {
      const r = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${token}`);
      expect(r.status, "Bearer vẫn phải xác thực được bình thường").toBe(200);
      expect(r.body.username).toBe(user.username);
      if (r.headers["set-cookie"]) coCookie++;
    }
    await new Promise((r) => setTimeout(r, 600)); // kho phiên ghi bất đồng bộ
    const sau = await tapPhien();

    expect(coCookie, "KHÔNG được phát cookie cho client API").toBe(0);
    const moi = phienMoi(truoc, sau);
    expect(moi, `sinh ${moi.length} hàng phiên cho request Bearer`).toEqual([]); // trước khi vá: 5
  });

  it("đăng nhập bằng COOKIE vẫn sinh phiên như cũ (không lỡ tay chặn nhầm trình duyệt)", async () => {
    const truoc = await tapPhien();
    const agent = request.agent(app);
    const r = await agent.post("/api/auth/login").send({ username: user.username, password: PWD });
    expect(r.status).toBe(200);
    expect(r.headers["set-cookie"], "đường trình duyệt PHẢI có cookie").toBeTruthy();
    await new Promise((r) => setTimeout(r, 600));
    // Cũng so theo TẬP, không theo số lượng: lượt dọn phiên có thể xoá nhiều hơn số vừa sinh ra và
    // làm phép so ">" đỏ oan — đúng lỗi chập chờn đã gặp ở bài trên.
    expect(
      phienMoi(truoc, await tapPhien()),
      "không sinh phiên nào = app đang dùng MemoryStore, tức vi.resetModules() ở beforeAll không còn hiệu lực",
    ).not.toEqual([]);
  });

  it("request Bearer KÈM cookie phiên vẫn đi qua phiên thật", async () => {
    // Trình duyệt đã đăng nhập mà gọi kèm token: phải giữ nguyên hành vi cũ, không được bỏ phiên.
    const agent = request.agent(app);
    expect((await agent.post("/api/auth/login").send({ username: user.username, password: PWD })).status).toBe(200);
    const r = await agent.get("/api/auth/me").set("Authorization", `Bearer ${token}`);
    expect(r.status).toBe(200);
    expect(r.body.username).toBe(user.username);
  });
});
