/**
 * MONEY-07 (phía máy chủ) — NGÀY BÁO GIÁ MẶC ĐỊNH PHẢI LÀ NGÀY VIỆT NAM.
 *
 * duplicateQuote ghi `quoteDate: new Date()` (và createQuote khi client không gửi) — editor cắt 10 ký
 * tự ISO, Excel đọc getDate() trên container UTC → nhân bản lúc 01:00 giờ VN ngày 23 ra ngày 22.
 * Phần mặc định ngày ở wizard/editor (web) thuộc luồng frontend.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import bcrypt from "bcryptjs";
import { agentWithCsrf } from "./helpers/agent.js";
import { prisma } from "../src/db.js";
import { homNayVN } from "../src/vnTime.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "User" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") {
  throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");
}

const TAG = `mnng${Date.now()}`;
const MAT_KHAU = "NgayVN1234!ok";

describe("homNayVN — hàm thuần", () => {
  it("17:30 UTC ngày 22 = 00:30 giờ VN ngày 23 → nửa đêm UTC ngày 23", () => {
    expect(homNayVN(new Date("2026-09-22T17:30:00Z")).toISOString()).toBe("2026-09-23T00:00:00.000Z");
  });
  it("16:59 UTC ngày 22 = 23:59 giờ VN ngày 22 → ngày 22", () => {
    expect(homNayVN(new Date("2026-09-22T16:59:00Z")).toISOString()).toBe("2026-09-22T00:00:00.000Z");
  });
});

describe.runIf(dbAvailable)("MONEY-07 — nhân bản / tạo không gửi ngày", () => {
  let app, company, template, adminU, ag;

  beforeAll(async () => {
    app = (await import("../src/app.js")).createApp();
    company = await prisma.company.create({ data: { code: `${TAG}-co`, name: "Co", address: "x", quotePrefix: "NG" } });
    template = await prisma.quoteTemplate.create({ data: { code: `${TAG}-tpl`, name: "T", companyId: company.id, filePath: "templates/Unibenfood.xlsx" } });
    adminU = await prisma.user.create({ data: { username: `${TAG}-ad`, displayName: "Ad", role: "admin", passwordHash: await bcrypt.hash(MAT_KHAU, 4) } });
    ag = agentWithCsrf(app);
    expect((await ag.post("/api/auth/login").send({ username: adminU.username, password: MAT_KHAU })).status).toBe(200);
  }, 60_000);

  afterAll(async () => {
    vi.useRealTimers();
    await prisma.auditEvent.deleteMany({ where: { actorId: adminU?.id } }).catch(() => {});
    await prisma.quote.deleteMany({ where: { title: { startsWith: TAG } }, hardDelete: true, includeDeleted: true }).catch(() => {});
    await prisma.loginAttempt.deleteMany({ where: { username: { startsWith: TAG } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true, includeDeleted: true }).catch(() => {});
    await prisma.quoteTemplate.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.company.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
  });

  it("tạo không gửi quoteDate và nhân bản → quoteDate = nửa đêm UTC của ngày VN hôm nay", async () => {
    const tao = await ag.post("/api/quotes").send({
      title: `${TAG} bg`, toCompany: "K", companyId: company.id, vatPercent: 8,
      sheets: [{ templateId: template.id, items: [{ name: "A", quantity: 1, unitPrice: 1000 }] }],
    });
    expect(tao.status).toBe(201);
    const nb = await ag.post(`/api/quotes/${tao.body.id}/duplicate`).send({});
    expect(nb.status).toBe(201);
    const ky = homNayVN().toISOString();
    for (const id of [tao.body.id, nb.body.id]) {
      const q = await prisma.quote.findUnique({ where: { id }, select: { quoteDate: true } });
      expect(q.quoteDate.toISOString(), "ngày báo giá lưu theo thời điểm UTC, không phải ngày VN").toBe(ky);
    }
  }, 60_000);
});
