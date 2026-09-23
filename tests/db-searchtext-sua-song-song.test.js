/**
 * DB-10 — searchText KHÔNG ĐƯỢC LỆCH KHI HAI NGƯỜI SỬA SONG SONG KHÁC TRƯỜNG.
 *
 * updateCustomer / updatePersonnel tính searchText từ bản `before` đọc NGOÀI transaction. A đổi tên,
 * B đổi SĐT cùng lúc → mỗi bên tính từ bản cũ + phần của mình → người ghi sau thắng, cột tìm kiếm
 * thiếu thay đổi của người kia (dữ liệu nghiệp vụ vẫn đúng, chỉ tìm kiếm bỏ sót).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import { agentWithCsrf } from "./helpers/agent.js";
import { prisma } from "../src/db.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "User" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") {
  throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");
}

const TAG = `dbss${Date.now()}`;
const MAT_KHAU = "SongSong1234!ok";

describe.runIf(dbAvailable)("DB-10 — searchText sau hai lượt sửa song song", () => {
  let app, adminU, a, b;

  beforeAll(async () => {
    app = (await import("../src/app.js")).createApp();
    adminU = await prisma.user.create({ data: { username: `${TAG}-ad`, displayName: "Ad", role: "admin", passwordHash: await bcrypt.hash(MAT_KHAU, 4) } });
    a = agentWithCsrf(app);
    b = agentWithCsrf(app);
    for (const ag of [a, b]) expect((await ag.post("/api/auth/login").send({ username: adminU.username, password: MAT_KHAU })).status).toBe(200);
  }, 60_000);

  afterAll(async () => {
    await prisma.auditEvent.deleteMany({ where: { actorId: adminU?.id } }).catch(() => {});
    await prisma.customer.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true, includeDeleted: true }).catch(() => {});
    await prisma.personnelRecord.deleteMany({ where: { createdById: adminU?.id }, hardDelete: true, includeDeleted: true }).catch(() => {});
    await prisma.loginAttempt.deleteMany({ where: { username: { startsWith: TAG } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true, includeDeleted: true }).catch(() => {});
  });

  it("khách hàng: đổi tên ‖ đổi SĐT → searchText chứa CẢ tên mới lẫn SĐT mới", async () => {
    for (let lan = 0; lan < 5; lan++) {
      const c = await prisma.customer.create({ data: { code: `${TAG}-${lan}`, name: "Ten cu", phone: "0900000000" } });
      await Promise.all([
        a.put(`/api/customers/${c.id}`).send({ name: `Tenmoi${lan}` }),
        b.put(`/api/customers/${c.id}`).send({ phone: `09111${lan}1111` }),
      ]);
      const sau = await prisma.customer.findUnique({ where: { id: c.id }, select: { searchText: true } });
      expect(sau.searchText, `lượt ${lan}`).toContain(`tenmoi${lan}`);
      expect(sau.searchText, `lượt ${lan}`).toContain(`09111${lan}1111`);
    }
  }, 60_000);

  it("hồ sơ Nhân sự: đổi tên ‖ đổi SĐT → searchText chứa cả hai", async () => {
    for (let lan = 0; lan < 5; lan++) {
      const r = await a.post("/api/personnel").send({ fullName: "Ho so cu", projectCode: `${TAG}-X`, phone: "0900000000" });
      expect(r.status).toBe(201);
      await Promise.all([
        a.put(`/api/personnel/${r.body.id}`).send({ fullName: `Hosomoi${lan}` }),
        b.put(`/api/personnel/${r.body.id}`).send({ phone: `09222${lan}2222` }),
      ]);
      const sau = await prisma.personnelRecord.findUnique({ where: { id: r.body.id }, select: { searchText: true } });
      expect(sau.searchText, `lượt ${lan}`).toContain(`hosomoi${lan}`);
      expect(sau.searchText, `lượt ${lan}`).toContain(`09222${lan}2222`);
    }
  }, 60_000);
});
