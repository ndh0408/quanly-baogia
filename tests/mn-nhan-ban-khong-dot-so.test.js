/**
 * MONEY-09 — NHÂN BẢN THỬ LẠI VÌ ĐỤNG projectVersion KHÔNG ĐƯỢC ĐỐT SỐ BÁO GIÁ.
 *
 * Vòng thử lại P2002 của duplicateQuote đẩy bộ đếm SỐ BÁO GIÁ lên số vừa cấp cho MỌI P2002 — kể cả
 * khi thứ bị trùng là `@@unique([projectCode, projectVersion])` (hai người cùng bấm "Bản mới cùng dự
 * án"). Số vừa cấp chưa ai dùng (rollback đã trả nó về), đẩy bộ đếm lên nó là tạo lỗ trong dãy số.
 *
 * Ca đua thật khó dựng tất định (khoá bộ đếm tuần tự hoá hai lượt), nên bài này bọc $transaction:
 * lượt ĐẦU chạy thật trọn vẹn rồi ném đúng lỗi P2002 trên projectCode/projectVersion (rollback thật),
 * lượt sau chạy bình thường.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { agentWithCsrf } from "./helpers/agent.js";
import { prisma } from "../src/db.js";
import { namVN, namNganVN } from "../src/vnTime.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "User" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") {
  throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");
}

const TAG = `mnnbs${Date.now()}`;
const MAT_KHAU = "KhongDot1234!ok";
const PREFIX = `W${String(Date.now()).slice(-7)}`;

describe.runIf(dbAvailable)("MONEY-09 — không đốt số khi đụng projectVersion", () => {
  let app, company, template, adminU, ag, gocId;
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
    gocId = r.body.id;
  }, 60_000);

  afterAll(async () => {
    vi.restoreAllMocks();
    await prisma.auditEvent.deleteMany({ where: { actorId: adminU?.id } }).catch(() => {});
    await prisma.quote.deleteMany({ where: { title: { startsWith: TAG } }, hardDelete: true, includeDeleted: true }).catch(() => {});
    await prisma.quoteCounter.deleteMany({ where: { prefix: PREFIX } }).catch(() => {});
    await prisma.loginAttempt.deleteMany({ where: { username: { startsWith: TAG } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true, includeDeleted: true }).catch(() => {});
    await prisma.quoteTemplate.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.company.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
  });

  it("lượt đầu đụng projectVersion → lượt sau dùng LẠI đúng số đó, không lỗ", async () => {
    const truoc = await dem();
    const goc = prisma.$transaction.bind(prisma);
    let lan = 0;
    vi.spyOn(prisma, "$transaction").mockImplementation(async (fn, opts) => {
      if (lan++ > 0 || typeof fn !== "function") return goc(fn, opts);
      return goc(async (tx) => {
        await fn(tx);
        throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
          code: "P2002", clientVersion: "test", meta: { target: ["projectCode", "projectVersion"] },
        });
      }, opts);
    });
    const r = await ag.post(`/api/quotes/${gocId}/duplicate`).send({ sameProject: true });
    vi.restoreAllMocks();
    expect(r.status, JSON.stringify(r.body).slice(0, 200)).toBe(201);
    expect(lan, "tiền đề: phải có một lượt thử lại").toBeGreaterThanOrEqual(2);
    const kyVong = `${PREFIX}${namNganVN()}${String(truoc + 1).padStart(3, "0")}`;
    expect(r.body.quoteNumber, "đốt một số báo giá vì trùng projectVersion").toBe(kyVong);
    expect(await dem()).toBe(truoc + 1);
  }, 60_000);
});
