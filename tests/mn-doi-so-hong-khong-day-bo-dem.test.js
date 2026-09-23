/**
 * MONEY-08 — ĐỔI SỐ BÁO GIÁ MÀ LẦN LƯU HỎNG THÌ BỘ ĐẾM KHÔNG ĐƯỢC NHẢY.
 *
 * updateQuote gọi syncQuoteCounter(b.quoteNumber) NGOÀI transaction, TRƯỚC khi ghi: lần Lưu sau đó
 * hỏng (400 tổng âm, 409 khoá lạc quan trong tx…) vẫn để QuoteCounter nhảy lên số vừa gõ — GREATEST không bao giờ lùi, nên
 * mọi số tự động về sau bắt đầu từ đó (lỗ số không giải thích được).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import { agentWithCsrf } from "./helpers/agent.js";
import { prisma } from "../src/db.js";
import { namVN, namNganVN } from "../src/vnTime.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "User" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") {
  throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");
}

const TAG = `mnds${Date.now()}`;
const MAT_KHAU = "DoiSo1234!ok";
const PREFIX = `Y${String(Date.now()).slice(-7)}`;

describe.runIf(dbAvailable)("MONEY-08 — bộ đếm chỉ đẩy khi lưu thành công", () => {
  let app, company, template, adminU, ag, quote;
  const dem = async () => (await prisma.quoteCounter.findUnique({ where: { prefix_year: { prefix: PREFIX, year: namVN() } } }))?.value ?? 0;

  beforeAll(async () => {
    app = (await import("../src/app.js")).createApp();
    company = await prisma.company.create({ data: { code: `${TAG}-co`, name: "Co", address: "x", quotePrefix: PREFIX } });
    template = await prisma.quoteTemplate.create({ data: { code: `${TAG}-tpl`, name: "T", companyId: company.id, filePath: "templates/Unibenfood.xlsx" } });
    adminU = await prisma.user.create({ data: { username: `${TAG}-ad`, displayName: "Ad", role: "admin", passwordHash: await bcrypt.hash(MAT_KHAU, 4) } });
    ag = agentWithCsrf(app);
    expect((await ag.post("/api/auth/login").send({ username: adminU.username, password: MAT_KHAU })).status).toBe(200);
    const r = await ag.post("/api/quotes").send({
      title: `${TAG} bg`, toCompany: "K", companyId: company.id, vatPercent: 8,
      sheets: [{ templateId: template.id, items: [{ name: "A", quantity: 1, unitPrice: 1000 }] }],
    });
    expect(r.status).toBe(201);
    quote = r.body;
  }, 60_000);

  afterAll(async () => {
    await prisma.auditEvent.deleteMany({ where: { actorId: adminU?.id } }).catch(() => {});
    await prisma.quote.deleteMany({ where: { title: { startsWith: TAG } }, hardDelete: true, includeDeleted: true }).catch(() => {});
    await prisma.quoteCounter.deleteMany({ where: { prefix: PREFIX } }).catch(() => {});
    await prisma.loginAttempt.deleteMany({ where: { username: { startsWith: TAG } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true, includeDeleted: true }).catch(() => {});
    await prisma.quoteTemplate.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.company.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
  });

  it("PUT đổi số mà lần Lưu hỏng (400 tổng âm) → bộ đếm KHÔNG đổi; lưu thành công thì bộ đếm theo số mới", async () => {
    const truoc = await dem();
    const soMoi = `${PREFIX}${namNganVN()}900`;
    // Lần Lưu hỏng SAU chỗ đổi số: tổng âm → 400 (assertTotalsStorable).
    const q0 = (await ag.get(`/api/quotes/${quote.id}`)).body;
    const hong = await ag.put(`/api/quotes/${quote.id}`).send({
      quoteNumber: soMoi, baseUpdatedAt: q0.updatedAt,
      sheets: [{ templateId: template.id, items: [{ name: "Giảm", quantity: 1, unitPrice: -5_000_000 }] }],
    });
    expect(hong.status, JSON.stringify(hong.body).slice(0, 200)).toBe(400);
    expect(await dem(), "lần Lưu hỏng vẫn đẩy bộ đếm lên số vừa gõ").toBe(truoc);

    const q = (await ag.get(`/api/quotes/${quote.id}`)).body;
    const ok = await ag.put(`/api/quotes/${quote.id}`).send({ quoteNumber: soMoi, baseUpdatedAt: q.updatedAt });
    expect(ok.status, JSON.stringify(ok.body).slice(0, 200)).toBe(200);
    expect(await dem()).toBe(900);
  }, 60_000);
});
