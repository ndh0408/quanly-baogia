// POST /api/mfa/disable — hai lỗi: F1 (không thu hồi phiên khác) + F2 (tiêu mã dự phòng không
// nguyên tử) — chốt hồi quy (ultracode audit 2026-09-09).
//
// ── F1 ───────────────────────────────────────────────────────────────────────
// Tự gỡ MFA thành công không huỷ phiên/refresh token ĐANG MỞ khác của CHÍNH tài khoản đó — khác
// hẳn `resetMfa` (admin gỡ hộ) và `changePassword`, cả hai đều gọi revokeAllForUser +
// destroyAllSessions ngay sau khi đổi trạng thái xác thực.
//
// ── F2 ───────────────────────────────────────────────────────────────────────
// Bản trước tự gọi `consumeBackupCode` (hàm THUẦN, chỉ so trên bản mảng ĐÃ ĐỌC) thay vì
// `verifyMfaChallenge` (authCore.ts — có chốt nguyên tử `array_remove` cho đường đăng nhập). TOCTOU:
// một mã vừa bị tiêu thụ bởi request KHÁC (vd đăng nhập) ngay giữa lúc disableMfa đọc xong và ghi
// vẫn được disableMfa coi là hợp lệ.
//
// Kỹ thuật tái hiện F2 THẬT (không đoán giờ giấc): giữ khoá hàng User bằng client pg riêng, bắn
// request disableMfa (findFirst không bị khoá chặn, chỉ chặn khi ĐỤNG update), rồi từ client đó
// XOÁ mã (đóng vai "đăng nhập đã tiêu mã này trước") rồi COMMIT — request bị chặn mới được tiếp
// tục. Đúng kỹ thuật tests/zm-hn-review-atomic.test.js đã dùng cho reviewHn.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import pg from "pg";
import { agentWithCsrf } from "./helpers/agent.js";

const { prisma } = await import("../src/db.js");
const { generateBackupCodes } = await import("../src/mfa.js");

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "User" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");

const TAG = `zpmfa${Date.now()}`;
const PWD = "Test1234!a";
const SECRET = "JBSWY3DPEHPK3PXP";
const nghi = (ms) => new Promise((r) => setTimeout(r, ms));
const banNgay = (t) => t.then((r) => r);

async function moKhoa() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query("BEGIN");
  return client;
}

describe.runIf(dbAvailable)("POST /api/mfa/disable — thu hồi phiên + tiêu mã dự phòng nguyên tử (integration)", () => {
  let app;

  beforeAll(async () => {
    app = (await import("../src/app.js")).createApp();
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
  });

  it("F1 — tự gỡ MFA thành công phải xoá phiên KHÁC của CHÍNH mình, không đụng người khác", async () => {
    const { hashed, plain } = await generateBackupCodes(2);
    const u = await prisma.user.create({ data: {
      username: `${TAG}-f1`, displayName: `${TAG} f1`, role: "manager",
      passwordHash: await bcrypt.hash(PWD, 4), mfaEnabled: true, mfaSecret: SECRET, mfaBackupCodes: hashed,
    } });
    const nguoiKhac = await prisma.user.create({ data: { username: `${TAG}-f1-khac`, displayName: `${TAG} khac`, role: "manager", passwordHash: await bcrypt.hash(PWD, 4) } });

    const agent = agentWithCsrf(app);
    expect((await agent.post("/api/auth/login").send({ username: u.username, password: PWD, mfaToken: plain[0] })).status).toBe(200);

    // Giả lập ĐÚNG hình dạng hàng mà PgSession (production) ghi — cùng kỹ thuật tests/mfa-reset.test.js
    // (NODE_ENV=test dùng MemoryStore nên phiên HTTP thật của agent này KHÔNG nằm trong bảng mà
    // destroyAllSessions xoá; seed trực tiếp để kiểm ĐÚNG hành vi SQL của hàm, không đo nhầm store).
    const seed = async (sid, userId) => prisma.$executeRawUnsafe(
      `INSERT INTO user_sessions (sid, sess, expire) VALUES ($1, $2::json, now() + interval '7 days')`,
      sid, JSON.stringify({ userId, cookie: {} }),
    );
    const sidThietBiKhac = `test-sid-f1-${u.id}`;
    const sidNguoiKhac = `test-sid-f1-khac-${nguoiKhac.id}`;
    await seed(sidThietBiKhac, u.id);
    await seed(sidNguoiKhac, nguoiKhac.id);

    const con = async (sid) => prisma.$queryRawUnsafe(`SELECT 1 FROM user_sessions WHERE sid = $1`, sid);
    expect((await con(sidThietBiKhac)).length).toBe(1);

    const r = await agent.post("/api/mfa/disable").send({ password: PWD, token: plain[1] });
    expect(r.status, JSON.stringify(r.body)).toBe(200);

    expect((await con(sidThietBiKhac)).length, "trước bản vá: disableMfa không gọi destroyAllSessions — hàng này còn sống").toBe(0);
    expect((await con(sidNguoiKhac)).length, "không được đụng phiên của người khác").toBe(1);
    await prisma.$executeRawUnsafe(`DELETE FROM user_sessions WHERE sid = $1`, sidNguoiKhac);
  });

  it("F2 — mã dự phòng bị 'người khác' tiêu thụ XEN VÀO GIỮA lúc mình gỡ MFA → 401, không được coi là hợp lệ", async () => {
    const { hashed, plain } = await generateBackupCodes(2);
    const u = await prisma.user.create({ data: {
      username: `${TAG}-f2`, displayName: `${TAG} f2`, role: "manager",
      passwordHash: await bcrypt.hash(PWD, 4), mfaEnabled: true, mfaSecret: SECRET, mfaBackupCodes: hashed,
    } });
    const agent = agentWithCsrf(app);
    expect((await agent.post("/api/auth/login").send({ username: u.username, password: PWD, mfaToken: plain[0] })).status).toBe(200);

    const kia = await moKhoa();
    try {
      await kia.query('SELECT id FROM "User" WHERE id = $1 FOR UPDATE', [u.id]);

      const p = banNgay(agent.post("/api/mfa/disable").send({ password: PWD, token: plain[1] }));
      await nghi(500); // đủ để loadUser() đọc xong (plain read, không bị khoá chặn) rồi kẹt ở lệnh ghi

      // "Người khác" đã tiêu THỰC mã plain[1] (vd qua một lần đăng nhập) TRƯỚC KHI request trên
      // kịp ghi — xoá đúng phần tử này khỏi mảng, giữ hình dạng THẬT của array_remove.
      await kia.query('UPDATE "User" SET "mfaBackupCodes" = array_remove("mfaBackupCodes", $2) WHERE id = $1', [u.id, hashed[1]]);
      await kia.query("COMMIT");

      const r = await p;
      expect(r.status, JSON.stringify(r.body)).toBe(401);
      expect(r.body.error).toMatch(/không đúng/);
    } finally {
      await kia.query("ROLLBACK").catch(() => {});
      await kia.end();
    }

    // MFA phải CÒN NGUYÊN (chưa gỡ) — request bị từ chối, không được phép có tác dụng phụ.
    const sau = await prisma.user.findUnique({ where: { id: u.id }, select: { mfaEnabled: true } });
    expect(sau.mfaEnabled, "trước bản vá: mã đã bị tiêu vẫn được coi là hợp lệ, MFA bị gỡ nhầm").toBe(true);
  });
});
