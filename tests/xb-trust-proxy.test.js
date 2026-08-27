// ── §40: TIN PROXY BAO NHIÊU CHẶNG ───────────────────────────────────────────
// Topology thật: Internet → Cloudflare → cloudflared → container. Nghĩa là ĐÚNG MỘT chặng do mình
// kiểm soát đứng trước ứng dụng, và `X-Forwarded-For` mà nó thêm vào là thứ DUY NHẤT đáng tin.
// Mọi phần TRÁI hơn trong chuỗi đó do client tự viết ra được.
//
// Vì sao phải có bài kiểm chứ không chỉ chú thích: hậu quả của việc đặt sai KHÔNG hiện ra ở đâu cả.
// `app.set("trust proxy", true)` chạy êm, log vẫn có IP, rate-limit vẫn đếm — chỉ có điều IP là do
// kẻ tấn công tự khai, nên mỗi request họ đổi một IP là trần rate-limit thành vô nghĩa, và mọi dòng
// nhật ký điều tra sự cố đều trỏ vào địa chỉ bịa.
//
// Quan sát qua `LoginAttempt.ip` — bảng thật, do `clientIp(req)` (src/authCore.ts) ghi từ `req.ip`,
// và cũng chính là IP mà lớp chống dò mật khẩu đếm theo. Không dựng endpoint giả nào cho bài test.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import { prisma } from "../src/db.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "User" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");

const TAG = `tp${Date.now()}`;
const IP_THAT = "203.0.113.9";      // chặng cuối (cloudflared) thêm vào
const IP_BIA = "198.51.100.7";      // client tự khai — KHÔNG được thắng

/** Dựng app với một giá trị TRUST_PROXY cụ thể. config.ts đọc env LÚC NẠP MODULE nên phải reset. */
async function appVoi(giaTri) {
  vi.resetModules();
  const cu = process.env.TRUST_PROXY;
  if (giaTri === undefined) delete process.env.TRUST_PROXY;
  else process.env.TRUST_PROXY = giaTri;
  const { createApp } = await import("../src/app.js");
  const app = createApp();
  if (cu === undefined) delete process.env.TRUST_PROXY; else process.env.TRUST_PROXY = cu;
  return app;
}

/** Một lần đăng nhập HỎNG (tài khoản không tồn tại) → sinh đúng một dòng LoginAttempt để đọc IP. */
async function ipGhiNhan(app, headers) {
  const ten = `${TAG}-${Math.random().toString(36).slice(2, 10)}`;
  const r = await request(app).post("/api/auth/login").set(headers).send({ username: ten, password: "sai-be-bet" });
  expect(r.status).toBe(401);
  // `loginAttempt.create` chạy KHÔNG await trong authCore (nó không được làm chậm đường đăng nhập).
  for (let i = 0; i < 40; i++) {
    const row = await prisma.loginAttempt.findFirst({ where: { username: ten }, orderBy: { id: "desc" } });
    if (row) return row.ip;
    await new Promise((r2) => setTimeout(r2, 50));
  }
  throw new Error("không thấy dòng LoginAttempt nào — bài test không quan sát được gì");
}

describe.runIf(dbAvailable)("§40 trust proxy — IP client là IP THẬT, không phải IP client tự khai", () => {
  let appKhongTin, appMotChang;

  beforeAll(async () => {
    appKhongTin = await appVoi(undefined);
    appMotChang = await appVoi("1");
  });

  afterAll(async () => {
    await prisma.loginAttempt.deleteMany({ where: { username: { startsWith: TAG } } }).catch(() => {});
  });

  it("KHÔNG đặt TRUST_PROXY → X-Forwarded-For bị BỎ QUA hoàn toàn (mặc định an toàn)", async () => {
    const ip = await ipGhiNhan(appKhongTin, { "X-Forwarded-For": IP_BIA });
    expect(ip).not.toBe(IP_BIA);
    expect(ip).toMatch(/127\.0\.0\.1|::1/);   // socket thật, đúng như mong đợi khi không tin ai
  });

  it("TRUST_PROXY=1 → lấy ĐÚNG địa chỉ do chặng tin cậy thêm vào", async () => {
    expect(await ipGhiNhan(appMotChang, { "X-Forwarded-For": IP_THAT })).toBe(IP_THAT);
  });

  it("TRUST_PROXY=1 + client tự chèn thêm một chặng giả → IP GIẢ KHÔNG THẮNG", async () => {
    // Đây là toàn bộ lý do của bài này. Client gửi `X-Forwarded-For: <giả>`, cloudflared NỐI THÊM
    // địa chỉ thật vào bên phải. Tin đúng 1 chặng thì phần bên trái — do client viết — bị bỏ.
    const ip = await ipGhiNhan(appMotChang, { "X-Forwarded-For": `${IP_BIA}, ${IP_THAT}` });
    expect(ip).toBe(IP_THAT);
    expect(ip).not.toBe(IP_BIA);
  });

  it("TRUST_PROXY=1 + client chèn NHIỀU chặng giả → vẫn chỉ lấy chặng phải cùng", async () => {
    const ip = await ipGhiNhan(appMotChang, { "X-Forwarded-For": `1.1.1.1, 2.2.2.2, ${IP_BIA}, ${IP_THAT}` });
    expect(ip).toBe(IP_THAT);
  });

  it("TRUST_PROXY=true tin MỌI chặng → IP do client khai THẮNG (vì sao không được dùng)", async () => {
    // Bài này KHÔNG chốt một hành vi mong muốn — nó chốt HẬU QUẢ, để con số trong .env.example
    // ("1, không phải true") có bằng chứng đi kèm thay vì chỉ là lời khuyên.
    const appTinTat = await appVoi("true");
    const ip = await ipGhiNhan(appTinTat, { "X-Forwarded-For": `${IP_BIA}, ${IP_THAT}` });
    expect(ip).toBe(IP_BIA);
  });
});
