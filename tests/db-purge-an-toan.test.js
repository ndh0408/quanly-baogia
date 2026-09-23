/**
 * DB-06 — purgeSoftDeleted: không cho days < 30, không 500 vì FK RESTRICT của hồ sơ Nhân sự / danh bạ,
 * và xoá cứng chạy TRONG transaction (hỏng giữa chừng thì không để lại purge nửa vời).
 *
 * Mốc 1900 / days ≈ 109 năm: cùng lý do với tests/b5-purge-audit-actor.test.js — purge quét toàn
 * bảng, cutoff phải đủ xa để không đụng dữ liệu xoá mềm của bài khác chạy song song.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import { agentWithCsrf } from "./helpers/agent.js";
import { prisma } from "../src/db.js";
import { purgeSoftDeleted } from "../src/services/adminService.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "User" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") {
  throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");
}

const TAG = `dbpg${Date.now()}`;
const MAT_KHAU = "Purge1234!ok";
const XOA_MEM_LUC = new Date("1900-01-01T00:00:00Z");
const SO_NGAY = 40_000;

describe.runIf(dbAvailable)("DB-06 — purge an toàn", () => {
  let app, adminU;

  beforeAll(async () => {
    app = (await import("../src/app.js")).createApp();
    adminU = await prisma.user.create({ data: { username: `${TAG}-ad`, displayName: "Ad", role: "admin", passwordHash: await bcrypt.hash(MAT_KHAU, 4) } });
  }, 60_000);

  afterAll(async () => {
    await prisma.auditEvent.deleteMany({ where: { actorId: adminU?.id } }).catch(() => {});
    await prisma.$executeRawUnsafe(`DELETE FROM "PersonnelRecord" WHERE "fullName" LIKE $1`, `${TAG}%`).catch(() => {});
    await prisma.$executeRawUnsafe(`DELETE FROM "Employee" WHERE "fullName" LIKE $1`, `${TAG}%`).catch(() => {});
    await prisma.loginAttempt.deleteMany({ where: { username: { startsWith: TAG } } }).catch(() => {});
    await prisma.$executeRawUnsafe(`DELETE FROM "User" WHERE username LIKE $1`, `${TAG}%`).catch(() => {});
  });

  it("days < 30 → 400", async () => {
    const ag = agentWithCsrf(app);
    expect((await ag.post("/api/auth/login").send({ username: adminU.username, password: MAT_KHAU })).status).toBe(200);
    expect((await ag.post("/api/admin/purge-soft-deleted").send({ days: 0 })).status).toBe(400);
    expect((await ag.post("/api/admin/purge-soft-deleted").send({ days: 29 })).status).toBe(400);
  }, 60_000);

  it("user xoá mềm còn hồ sơ Nhân sự / danh bạ (không nhật ký) → không bị chọn, purge không 500", async () => {
    const u = await prisma.user.create({ data: { username: `${TAG}-u`, displayName: "U", role: "manager", passwordHash: "x", deletedAt: XOA_MEM_LUC } });
    await prisma.personnelRecord.create({ data: { createdById: u.id, fullName: `${TAG} hồ sơ`, projectCode: "X" } });
    const u2 = await prisma.user.create({ data: { username: `${TAG}-u2`, displayName: "U2", role: "manager", passwordHash: "x", deletedAt: XOA_MEM_LUC } });
    await prisma.employee.create({ data: { createdById: u2.id, fullName: `${TAG} danh bạ` } });

    const kq = await purgeSoftDeleted({ body: { days: SO_NGAY }, session: {}, ip: "127.0.0.1", headers: {} });
    expect(kq.result).toBeTruthy();
    const con = await prisma.$queryRawUnsafe(`SELECT id FROM "User" WHERE id IN ($1, $2)`, u.id, u2.id);
    expect(con.length).toBe(2);
  }, 60_000);

  it("xoá cứng (hardDelete) trong transaction ROLLBACK theo transaction", async () => {
    const u = await prisma.user.create({ data: { username: `${TAG}-rb`, displayName: "RB", passwordHash: "x" } });
    await expect(prisma.$transaction(async (tx) => {
      await tx.user.deleteMany({ where: { id: u.id }, hardDelete: true });
      throw new Error("hỏng giữa chừng");
    })).rejects.toThrow("hỏng giữa chừng");
    const con = await prisma.$queryRawUnsafe(`SELECT id FROM "User" WHERE id = $1`, u.id);
    expect(con.length, "xoá cứng chạy ngoài transaction — không rollback").toBe(1);
  }, 60_000);
});
