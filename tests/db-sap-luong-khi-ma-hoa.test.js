/**
 * DB-07 — SẮP NHÂN SỰ THEO LƯƠNG PHẢI ĐÚNG KHI ĐÃ BẬT PII_PLAINTEXT_CUTOVER.
 *
 * Cutover bật → cột thô `salary` của hồ sơ ghi mới = NULL, giá trị thật chỉ ở `salaryEnc`. ORDER BY
 * salary trên cột thô xếp các NULL thành một khối: danh sách "sắp theo lương" ra thứ tự tuỳ ý.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import { agentWithCsrf } from "./helpers/agent.js";
import { prisma } from "../src/db.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "User" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") {
  throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");
}

const TAG = `dbsl${Date.now()}`;
const MAT_KHAU = "SapLuong1234!ok";

describe.runIf(dbAvailable && !!process.env.PII_ENC_KEY)("DB-07 — sort=salary khi cutover", () => {
  let app, adminU, ag;
  const cu = { key: process.env.PII_ENC_KEY, cut: process.env.PII_PLAINTEXT_CUTOVER };

  beforeAll(async () => {
    process.env.PII_PLAINTEXT_CUTOVER = "1";
    app = (await import("../src/app.js")).createApp();
    adminU = await prisma.user.create({ data: { username: `${TAG}-ad`, displayName: "Ad", role: "admin", passwordHash: await bcrypt.hash(MAT_KHAU, 4) } });
    ag = agentWithCsrf(app);
    expect((await ag.post("/api/auth/login").send({ username: adminU.username, password: MAT_KHAU })).status).toBe(200);
    for (const [ten, luong] of [["B", 5_000_000], ["A", 20_000_000], ["C", 12_000_000]]) {
      const r = await ag.post("/api/personnel").send({ fullName: `${TAG} ${ten}`, projectCode: `${TAG}-X`, salary: luong });
      expect(r.status, JSON.stringify(r.body).slice(0, 200)).toBe(201);
    }
  }, 60_000);

  afterAll(async () => {
    if (cu.cut === undefined) delete process.env.PII_PLAINTEXT_CUTOVER; else process.env.PII_PLAINTEXT_CUTOVER = cu.cut;
    await prisma.auditEvent.deleteMany({ where: { actorId: adminU?.id } }).catch(() => {});
    await prisma.personnelRecord.deleteMany({ where: { createdById: adminU?.id }, hardDelete: true, includeDeleted: true }).catch(() => {});
    await prisma.loginAttempt.deleteMany({ where: { username: { startsWith: TAG } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true, includeDeleted: true }).catch(() => {});
  });

  it("tiền đề: cột thô lương đã NULL; sort=salary desc/asc ra đúng thứ tự, phân trang đúng", async () => {
    const tho = await prisma.personnelRecord.findMany({ where: { createdById: adminU.id }, select: { salary: true } });
    expect(tho.every((r) => r.salary == null), "tiền đề cutover không đúng").toBe(true);

    const desc = await ag.get(`/api/personnel?q=${TAG}&sort=salary&order=desc&size=50`);
    expect(desc.status).toBe(200);
    expect(desc.body.data.map((r) => r.fullName)).toEqual([`${TAG} A`, `${TAG} C`, `${TAG} B`]);
    const asc = await ag.get(`/api/personnel?q=${TAG}&sort=salary&order=asc&size=50`);
    expect(asc.body.data.map((r) => r.fullName)).toEqual([`${TAG} B`, `${TAG} C`, `${TAG} A`]);
    const trang2 = await ag.get(`/api/personnel?q=${TAG}&sort=salary&order=desc&size=2&page=2`);
    expect(trang2.body.data.map((r) => r.fullName)).toEqual([`${TAG} B`]);
    expect(trang2.body.meta.total).toBe(3);
  });
});
