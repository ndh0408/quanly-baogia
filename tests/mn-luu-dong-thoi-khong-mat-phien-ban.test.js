/**
 * MONEY-06 — HAI LẦN LƯU ĐỒNG THỜI (client không gửi baseUpdatedAt: script/API/tab bundle rất cũ).
 *
 *   (a) currentVersion = existing+1 đọc NGOÀI transaction → hai lần Lưu cùng ra một versionNo →
 *       snapshotQuoteVersion upsert đè mất một phiên bản lịch sử.
 *   (b) nhánh chỉ-đổi-VAT tính tổng từ hạng mục đọc NGOÀI transaction → chen với một lần Lưu sheet
 *       thì Quote.total ghi theo hạng mục CŨ.
 * Bắt buộc gửi baseUpdatedAt thì KHÔNG làm ở đây (đổi hợp đồng API) — xem báo cáo.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import { agentWithCsrf } from "./helpers/agent.js";
import { prisma } from "../src/db.js";
import { computeQuoteTotals } from "../src/money.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "User" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") {
  throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");
}

const TAG = `mnds${Date.now()}`;
const MAT_KHAU = "DongThoi1234!ok";

describe.runIf(dbAvailable)("MONEY-06 — lưu đồng thời không mốc", () => {
  let app, company, template, adminU, a, b;

  const taoBaoGia = async () => {
    const r = await a.post("/api/quotes").send({
      title: `${TAG} bg`, toCompany: "K", companyId: company.id, vatPercent: 8,
      sheets: [{ templateId: template.id, items: [{ name: "A", quantity: 1, unitPrice: 1_000_000 }] }],
    });
    expect(r.status).toBe(201);
    return r.body.id;
  };
  const sheetsVoiGia = (gia) => [{ templateId: template.id, items: [{ name: "A", quantity: 1, unitPrice: gia }] }];

  beforeAll(async () => {
    app = (await import("../src/app.js")).createApp();
    company = await prisma.company.create({ data: { code: `${TAG}-co`, name: "Co", address: "x", quotePrefix: "DS" } });
    template = await prisma.quoteTemplate.create({ data: { code: `${TAG}-tpl`, name: "T", companyId: company.id, filePath: "templates/Unibenfood.xlsx" } });
    adminU = await prisma.user.create({ data: { username: `${TAG}-ad`, displayName: "Ad", role: "admin", passwordHash: await bcrypt.hash(MAT_KHAU, 4) } });
    a = agentWithCsrf(app);
    b = agentWithCsrf(app);
    for (const ag of [a, b]) expect((await ag.post("/api/auth/login").send({ username: adminU.username, password: MAT_KHAU })).status).toBe(200);
  }, 60_000);

  afterAll(async () => {
    await prisma.auditEvent.deleteMany({ where: { actorId: adminU?.id } }).catch(() => {});
    await prisma.quote.deleteMany({ where: { title: { startsWith: TAG } }, hardDelete: true, includeDeleted: true }).catch(() => {});
    await prisma.loginAttempt.deleteMany({ where: { username: { startsWith: TAG } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true, includeDeleted: true }).catch(() => {});
    await prisma.quoteTemplate.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.company.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
  });

  it("hai lần Lưu sheet đồng thời → hai phiên bản lịch sử riêng, không đè nhau", async () => {
    for (let lan = 0; lan < 4; lan++) {
      const id = await taoBaoGia();
      const [r1, r2] = await Promise.all([
        a.put(`/api/quotes/${id}`).send({ sheets: sheetsVoiGia(2_000_000) }),
        b.put(`/api/quotes/${id}`).send({ sheets: sheetsVoiGia(3_000_000) }),
      ]);
      expect([r1.status, r2.status]).toEqual([200, 200]);
      const q = await prisma.quote.findUnique({ where: { id }, select: { currentVersion: true } });
      const soPhienBan = await prisma.quoteVersion.count({ where: { quoteId: id } });
      expect(q.currentVersion, `lượt ${lan}: hai lần lưu cùng một versionNo`).toBe(3);
      expect(soPhienBan, `lượt ${lan}: mất một phiên bản lịch sử`).toBe(3);
    }
  }, 60_000);

  it("đổi VAT chen với Lưu sheet → Quote.total khớp hạng mục cuối cùng", async () => {
    for (let lan = 0; lan < 4; lan++) {
      const id = await taoBaoGia();
      await Promise.all([
        a.put(`/api/quotes/${id}`).send({ sheets: sheetsVoiGia(5_000_000) }),
        b.put(`/api/quotes/${id}`).send({ vatPercent: 10 }),
      ]);
      const q = await prisma.quote.findUnique({
        where: { id },
        include: { sheets: { include: { items: { orderBy: { order: "asc" } } } } },
      });
      const tinhLai = computeQuoteTotals(q);
      expect(Number(q.total), `lượt ${lan}: tổng lưu lệch hạng mục`).toBe(Number(tinhLai.total));
    }
  }, 60_000);
});
