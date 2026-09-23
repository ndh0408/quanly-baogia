/**
 * DB-05 — BIỂU ĐỒ DOANH SỐ THEO NGÀY PHẢI CỘNG KHỚP Ô "DOANH SỐ ĐÃ CHỐT", VÀ GOM THEO NGÀY GIỜ VN.
 *
 * overview() dùng quoteScopeWhere (read:own = mình tạo HOẶC là thành viên), revenueByDay chỉ lấy
 * `createdById` → hai con số cạnh nhau trên Dashboard không khớp. revenueByDay còn gom DATE("createdAt")
 * trên giờ UTC → báo giá tạo 00:00–06:59 giờ VN rơi sang ngày hôm trước.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import { agentWithCsrf } from "./helpers/agent.js";
import { prisma } from "../src/db.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "User" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") {
  throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");
}

const TAG = `dbbd${Date.now()}`;
const MAT_KHAU = "BieuDo1234!ok";

describe.runIf(dbAvailable)("DB-05 — revenue-by-day khớp KPI", () => {
  let app, company, aU, bU, a;
  const tao = (u, soBG, createdAt, total) => prisma.quote.create({
    data: {
      quoteNumber: soBG, title: `${TAG} bg`, toCompany: "K", companyId: company.id, createdById: u.id,
      fromContact: "x", fromAddress: "x", city: "x", quoteDate: createdAt, createdAt, status: "converted",
      subtotal: total, vat: 0, total, convertedTotal: total,
    },
  });

  beforeAll(async () => {
    app = (await import("../src/app.js")).createApp();
    company = await prisma.company.create({ data: { code: `${TAG}-co`, name: "Co", address: "x", quotePrefix: "BD" } });
    const mk = await bcrypt.hash(MAT_KHAU, 4);
    // read:own THUẦN (per-user) để không dính quote:read:all.
    aU = await prisma.user.create({ data: { username: `${TAG}-a`, displayName: "A", role: "manager", passwordHash: mk, permissions: ["quote:read:own", "quote:create"] } });
    bU = await prisma.user.create({ data: { username: `${TAG}-b`, displayName: "B", role: "manager", passwordHash: mk } });
    // 23:30 UTC ngày 10 = 06:30 giờ VN ngày 11.
    await tao(aU, `${TAG}-1`, new Date("2026-09-10T23:30:00Z"), 1_000_000);
    const cuaB = await tao(bU, `${TAG}-2`, new Date("2026-09-10T03:00:00Z"), 2_000_000);
    await prisma.quoteMember.create({ data: { quoteId: cuaB.id, userId: aU.id, scopes: ["main"] } });
    a = agentWithCsrf(app);
    expect((await a.post("/api/auth/login").send({ username: aU.username, password: MAT_KHAU })).status).toBe(200);
  }, 60_000);

  afterAll(async () => {
    await prisma.quote.deleteMany({ where: { title: { startsWith: TAG } }, hardDelete: true, includeDeleted: true }).catch(() => {});
    await prisma.loginAttempt.deleteMany({ where: { username: { startsWith: TAG } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true, includeDeleted: true }).catch(() => {});
    await prisma.company.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
  });

  it("tổng biểu đồ = kpi.approvedAmount cho cùng kỳ; điểm rơi đúng ngày giờ VN", async () => {
    const q = "from=2026-09-09T00:00:00Z&to=2026-09-12T00:00:00Z";
    const ov = await a.get(`/api/analytics/overview?${q}`);
    const rv = await a.get(`/api/analytics/revenue-by-day?${q}`);
    expect(ov.status).toBe(200);
    expect(rv.status).toBe(200);
    const tong = rv.body.data.reduce((s, r) => s + Number(r.amount), 0);
    expect(tong, "biểu đồ bỏ báo giá mình là thành viên mà KPI thì tính").toBe(ov.body.kpi.approvedAmount);
    const ngay = rv.body.data.map((r) => new Date(r.d).toISOString().slice(0, 10)).sort();
    expect(ngay, "báo giá 06:30 giờ VN ngày 11 bị gom vào ngày 10 (UTC)").toEqual(["2026-09-10", "2026-09-11"]);
  });
});
