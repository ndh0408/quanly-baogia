/**
 * DB-11 — MST RỖNG ('' hoặc toàn khoảng trắng) PHẢI LƯU LÀ NULL.
 *
 * Index Customer_taxCode_live_key là unique MỘT PHẦN `WHERE taxCode IS NOT NULL`. Lưu '' thì khách
 * thứ hai cũng bỏ trống MST nhận 409 "Mã số thuế đã thuộc khách hàng khác". Giao diện web hiện không
 * gửi taxCode, nên lỗi lộ qua API/tích hợp.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import { agentWithCsrf } from "./helpers/agent.js";
import { prisma } from "../src/db.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "User" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") {
  throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");
}

const TAG = `dbmst${Date.now()}`;
const MAT_KHAU = "MstRong1234!ok";

describe.runIf(dbAvailable)("DB-11 — taxCode rỗng", () => {
  let app, adminU, ag;
  beforeAll(async () => {
    app = (await import("../src/app.js")).createApp();
    adminU = await prisma.user.create({ data: { username: `${TAG}-ad`, displayName: "Ad", role: "admin", passwordHash: await bcrypt.hash(MAT_KHAU, 4) } });
    ag = agentWithCsrf(app);
    expect((await ag.post("/api/auth/login").send({ username: adminU.username, password: MAT_KHAU })).status).toBe(200);
  }, 60_000);
  afterAll(async () => {
    await prisma.auditEvent.deleteMany({ where: { actorId: adminU?.id } }).catch(() => {});
    await prisma.customer.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true, includeDeleted: true }).catch(() => {});
    await prisma.loginAttempt.deleteMany({ where: { username: { startsWith: TAG } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true, includeDeleted: true }).catch(() => {});
  });

  it("hai khách taxCode '' và '  ' đều tạo được, lưu NULL; sửa về '' cũng thành NULL", async () => {
    const r1 = await ag.post("/api/customers").send({ code: `${TAG}-1`, name: "K1", taxCode: "" });
    const r2 = await ag.post("/api/customers").send({ code: `${TAG}-2`, name: "K2", taxCode: "   " });
    expect(r1.status, JSON.stringify(r1.body)).toBe(201);
    expect(r2.status, `khách thứ hai bỏ trống MST nhận 409 sai: ${JSON.stringify(r2.body)}`).toBe(201);
    const hang = await prisma.customer.findMany({ where: { code: { startsWith: TAG } }, select: { taxCode: true } });
    expect(hang.every((h) => h.taxCode === null)).toBe(true);

    const r3 = await ag.post("/api/customers").send({ code: `${TAG}-3`, name: "K3", taxCode: "0312345678" });
    expect(r3.status).toBe(201);
    expect((await ag.put(`/api/customers/${r3.body.id}`).send({ taxCode: " " })).status).toBe(200);
    expect((await prisma.customer.findUnique({ where: { id: r3.body.id }, select: { taxCode: true } })).taxCode).toBeNull();
  });
});
