/**
 * RBAC-03 — HỒ SƠ NHÂN SỰ NHẬN MÃ DỰ ÁN TUỲ Ý → ACCOUNT ĐỌC ĐƯỢC SỐ HĐ / PO / TIỀN TRƯỚC THUẾ CỦA DỰ
 * ÁN NGƯỜI KHÁC.
 *
 * Picker GET /api/personnel/projects chỉ đưa dự án của chính mình, nhưng POST/PUT /api/personnel
 * nhận `projectCode` tuỳ ý và phản hồi được decorate bằng buildProjectRef — không lọc người dùng.
 * Manager A gõ mã dự án của manager B là đọc được doanh số từng trang của B.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import { agentWithCsrf } from "./helpers/agent.js";
import { prisma } from "../src/db.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "User" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") {
  throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");
}

const TAG = `rbns${Date.now()}`;
const MAT_KHAU = "NhanSu1234!ok";
const MA_B = `${TAG}_B26_001`;
const MA_A = `${TAG}_A26_001`;

describe.runIf(dbAvailable)("RBAC-03 — mã dự án ghi vào hồ sơ phải thuộc phạm vi người ghi", () => {
  let app, company, template, aU, bU, adminU, a, admin;

  const dangNhap = async (u) => {
    const ag = agentWithCsrf(app);
    expect((await ag.post("/api/auth/login").send({ username: u.username, password: MAT_KHAU })).status).toBe(200);
    return ag;
  };
  const taoBaoGiaDaChot = (u, projectCode, soBG) =>
    prisma.quote.create({
      data: {
        quoteNumber: soBG, projectCode, title: `${TAG} dự án`, toCompany: "K", companyId: company.id, createdById: u.id,
        fromContact: "x", fromAddress: "x", city: "x", quoteDate: new Date(),
        status: "converted", subtotal: 50_000_000, vat: 0, total: 50_000_000,
        sheets: { create: [{ templateId: template.id, name: "Trang 1", order: 1, subtotal: 50_000_000, invoiceNo: `HD-${soBG}`, poNumber: `PO-${soBG}` }] },
      },
    });

  beforeAll(async () => {
    app = (await import("../src/app.js")).createApp();
    company = await prisma.company.create({ data: { code: `${TAG}-co`, name: "Co", address: "x", quotePrefix: "RB" } });
    template = await prisma.quoteTemplate.create({ data: { code: `${TAG}-tpl`, name: "T", companyId: company.id, filePath: "templates/Unibenfood.xlsx" } });
    const mk = await bcrypt.hash(MAT_KHAU, 4);
    aU = await prisma.user.create({ data: { username: `${TAG}-a`, displayName: "A", role: "manager", passwordHash: mk } });
    bU = await prisma.user.create({ data: { username: `${TAG}-b`, displayName: "B", role: "manager", passwordHash: mk } });
    adminU = await prisma.user.create({ data: { username: `${TAG}-ad`, displayName: "Ad", role: "admin", passwordHash: mk } });
    await taoBaoGiaDaChot(bU, MA_B, `${TAG}-Q1`);
    await taoBaoGiaDaChot(aU, MA_A, `${TAG}-Q2`);
    a = await dangNhap(aU);
    admin = await dangNhap(adminU);
  }, 60_000);

  afterAll(async () => {
    const ids = [aU?.id, bU?.id, adminU?.id].filter(Boolean);
    await prisma.auditEvent.deleteMany({ where: { actorId: { in: ids } } }).catch(() => {});
    await prisma.personnelRecord.deleteMany({ where: { createdById: { in: ids } }, hardDelete: true, includeDeleted: true }).catch(() => {});
    await prisma.quote.deleteMany({ where: { title: { startsWith: TAG } }, hardDelete: true, includeDeleted: true }).catch(() => {});
    await prisma.loginAttempt.deleteMany({ where: { username: { startsWith: TAG } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true, includeDeleted: true }).catch(() => {});
    await prisma.quoteTemplate.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.company.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
  });

  it("A tạo hồ sơ với mã dự án của B → 403, không lộ số HĐ/tiền trước thuế", async () => {
    const r = await a.post("/api/personnel").send({ fullName: `${TAG} x`, projectCode: MA_B });
    expect(r.status, `lộ dữ liệu dự án của người khác: ${JSON.stringify(r.body).slice(0, 200)}`).toBe(403);
    expect(r.body.preTaxAmount).toBeUndefined();
  });

  it("vế đối trọng: mã của CHÍNH A → 201 kèm dữ liệu dự án; mã tự do không khớp dự án nào → 201", async () => {
    const r = await a.post("/api/personnel").send({ fullName: `${TAG} y`, projectCode: MA_A });
    expect(r.status, JSON.stringify(r.body).slice(0, 200)).toBe(201);
    expect(r.body.salesContractNo).toBe(`HD-${TAG}-Q2`);
    const tuDo = await a.post("/api/personnel").send({ fullName: `${TAG} z`, projectCode: `${TAG}-NGOAI-HE-THONG` });
    expect(tuDo.status).toBe(201);
  });

  it("admin (personnel:read:all) ghi mã của bất kỳ ai → 201", async () => {
    const r = await admin.post("/api/personnel").send({ fullName: `${TAG} ad`, projectCode: MA_B });
    expect(r.status).toBe(201);
  });

  it("A đổi projectCode của hồ sơ mình sang mã của B → 403; sửa trường khác vẫn được", async () => {
    const tao = await a.post("/api/personnel").send({ fullName: `${TAG} w`, projectCode: MA_A });
    expect(tao.status).toBe(201);
    const doi = await a.put(`/api/personnel/${tao.body.id}`).send({ projectCode: MA_B });
    expect(doi.status).toBe(403);
    const sua = await a.put(`/api/personnel/${tao.body.id}`).send({ phone: "0900000000", projectCode: MA_A });
    expect(sua.status).toBe(200);
  });
});
