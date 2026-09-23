/**
 * DB-08 — TÌM KHÔNG DẤU Ở DANH BẠ NHÂN VIÊN VÀ Ô CHỌN DỰ ÁN CỦA NHÂN SỰ.
 *
 * Quote/Customer/PersonnelRecord tìm trên searchText đã chuẩn hoá; Danh bạ và ô chọn dự án thì ILIKE
 * trên cột thô → gõ "nguyen" không ra "Nguyễn". (Danh mục rạp lọc ở client — thuộc luồng frontend.)
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import { agentWithCsrf } from "./helpers/agent.js";
import { prisma } from "../src/db.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "User" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") {
  throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");
}

const TAG = `dbtk${Date.now()}`;
const MAT_KHAU = "TimKhongDau1234!ok";

describe.runIf(dbAvailable)("DB-08 — tìm không dấu", () => {
  let app, adminU, ag, company;

  beforeAll(async () => {
    app = (await import("../src/app.js")).createApp();
    adminU = await prisma.user.create({ data: { username: `${TAG}-ad`, displayName: "Ad", role: "admin", passwordHash: await bcrypt.hash(MAT_KHAU, 4) } });
    company = await prisma.company.create({ data: { code: `${TAG}-co`, name: "Co", address: "x", quotePrefix: "TK" } });
    ag = agentWithCsrf(app);
    expect((await ag.post("/api/auth/login").send({ username: adminU.username, password: MAT_KHAU })).status).toBe(200);
  }, 60_000);

  afterAll(async () => {
    await prisma.auditEvent.deleteMany({ where: { actorId: adminU?.id } }).catch(() => {});
    await prisma.employee.deleteMany({ where: { createdById: adminU?.id }, hardDelete: true, includeDeleted: true }).catch(() => {});
    await prisma.quote.deleteMany({ where: { createdById: adminU?.id }, hardDelete: true, includeDeleted: true }).catch(() => {});
    await prisma.loginAttempt.deleteMany({ where: { username: { startsWith: TAG } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true, includeDeleted: true }).catch(() => {});
    await prisma.company.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
  });

  it("Danh bạ: q không dấu tìm ra tên có dấu; tìm theo SĐT thô vẫn chạy", async () => {
    const ten = `Nguyễn Đức ${TAG}`;
    const r = await ag.post("/api/employees").send({ fullName: ten, phone: "0901234567" });
    expect(r.status).toBe(201);
    const tim = await ag.get(`/api/employees?q=${encodeURIComponent(`nguyen duc ${TAG}`)}`);
    expect(tim.status).toBe(200);
    expect(tim.body.data.map((e) => e.fullName), "gõ không dấu không ra ai").toContain(ten);
    const theoSdt = await ag.get(`/api/employees?q=0901234567`);
    expect(theoSdt.body.data.map((e) => e.fullName)).toContain(ten);
  });

  it("Ô chọn dự án ở Nhân sự: q không dấu tìm ra tiêu đề có dấu", async () => {
    await prisma.quote.create({
      data: {
        quoteNumber: `${TAG}-Q`, title: `Sự kiện Đà Nẵng ${TAG}`, toCompany: "K", companyId: company.id, createdById: adminU.id,
        fromContact: "x", fromAddress: "x", city: "x", quoteDate: new Date(), status: "converted",
        searchText: `${TAG.toLowerCase()} q su kien da nang ${TAG.toLowerCase()} k`,
      },
    });
    const r = await ag.get(`/api/personnel/projects?q=${encodeURIComponent(`su kien da nang ${TAG}`)}`);
    expect(r.status).toBe(200);
    expect(r.body.data.map((d) => d.projectName)).toContain(`Sự kiện Đà Nẵng ${TAG}`);
  });
});
