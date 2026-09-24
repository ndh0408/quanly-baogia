/**
 * RBAC-07 — ACCOUNT PHỤ (manager mặc định, có quote:hn:manage) KHÔNG ĐƯỢC SỬA THẲNG GIÁ HÀ NỘI ĐÃ DUYỆT.
 *
 * chotHnTables return sớm cho MỌI người có quote:hn:manage — mà mọi manager đều có quyền đó theo vai
 * trò mặc định. Nên một manager được CHỦ báo giá thêm vào với vùng "hanoi" ghi đè được bảng HN đã
 * duyệt qua PUT /:id, trong khi reviewHn cấm chính người đó duyệt/trả lại phần HN. Việc nặng được
 * phép, việc nhẹ bị cấm. tests/quote-member-scopes.test.js không bắt được vì account phụ ở đó có tập
 * quyền per-user KHÔNG gồm hn:manage.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import { agentWithCsrf } from "./helpers/agent.js";
import { prisma } from "../src/db.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "User" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") {
  throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");
}

const TAG = `rbhn${Date.now()}`;
const MAT_KHAU = "PhuHn1234!ok";
// GET trả `extraTables: null` cho trang không có bảng nội bộ, còn PUT chỉ nhận mảng — bỏ khoá null khi gửi lại.
const boNull = (sheets) => sheets.map(({ extraTables, ...s }) => (extraTables == null ? s : { ...s, extraTables }));

describe.runIf(dbAvailable)("RBAC-07 — phụ không sửa giá HN đã duyệt", () => {
  let app, company, template, chuU, phuU, chu, phu, quoteId;

  const dangNhap = async (u) => {
    const ag = agentWithCsrf(app);
    expect((await ag.post("/api/auth/login").send({ username: u.username, password: MAT_KHAU })).status).toBe(200);
    return ag;
  };

  beforeAll(async () => {
    app = (await import("../src/app.js")).createApp();
    company = await prisma.company.create({ data: { code: `${TAG}-co`, name: "Co", address: "x", quotePrefix: "HN" } });
    template = await prisma.quoteTemplate.create({ data: { code: `${TAG}-tpl`, name: "T", companyId: company.id, filePath: "templates/GN_KhongNgay.xlsx" } });
    const mk = await bcrypt.hash(MAT_KHAU, 4);
    chuU = await prisma.user.create({ data: { username: `${TAG}-chu`, displayName: "Chu", role: "manager", passwordHash: mk } });
    phuU = await prisma.user.create({ data: { username: `${TAG}-phu`, displayName: "Phu", role: "manager", passwordHash: mk } });
    chu = await dangNhap(chuU);
    phu = await dangNhap(phuU);
    const r = await chu.post("/api/quotes").send({
      title: `${TAG} bg`, toCompany: "K", companyId: company.id, vatPercent: 8,
      sheets: [{ templateId: template.id, items: [{ name: "A", quantity: 1, unitPrice: 1000 }] }],
    });
    expect(r.status).toBe(201);
    quoteId = r.body.id;
    const q0 = (await chu.get(`/api/quotes/${quoteId}`)).body;
    const gieo = await chu.put(`/api/quotes/${quoteId}`).send({
      ...q0, sheets: boNull(q0.sheets), baseUpdatedAt: q0.updatedAt,
      hnTables: [{ name: "HN gốc", items: [{ kind: "item", name: "Nhân công HN", quantity: 1, unitPrice: 700 }] }],
    });
    expect(gieo.status, JSON.stringify(gieo.body).slice(0, 300)).toBe(200);
    const m = await chu.put(`/api/quotes/${quoteId}/members`).send({ members: [{ userId: phuU.id, scopes: ["hanoi"] }], memberIds: [phuU.id] });
    expect(m.status, JSON.stringify(m.body)).toBe(200);
    await prisma.quote.update({ where: { id: quoteId }, data: { hnStatus: "approved" } });
  }, 60_000);

  afterAll(async () => {
    const ids = [chuU?.id, phuU?.id].filter(Boolean);
    await prisma.auditEvent.deleteMany({ where: { actorId: { in: ids } } }).catch(() => {});
    await prisma.notification.deleteMany({ where: { userId: { in: ids } } }).catch(() => {});
    await prisma.quote.deleteMany({ where: { title: { startsWith: TAG } }, hardDelete: true, includeDeleted: true }).catch(() => {});
    await prisma.loginAttempt.deleteMany({ where: { username: { startsWith: TAG } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true, includeDeleted: true }).catch(() => {});
    await prisma.quoteTemplate.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.company.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
  });

  it("phụ (manager mặc định) sửa hnTables khi đã duyệt → 409, giá giữ nguyên", async () => {
    const truoc = (await chu.get(`/api/quotes/${quoteId}`)).body;
    const hn = JSON.parse(JSON.stringify(truoc.hnTables));
    hn[0].items[0].unitPrice = 9_999_999;
    const r = await phu.put(`/api/quotes/${quoteId}`).send({ ...truoc, sheets: boNull(truoc.sheets), hnTables: hn, baseUpdatedAt: truoc.updatedAt });
    expect(r.status, `phụ ghi đè giá HN đã duyệt: ${JSON.stringify(r.body).slice(0, 200)}`).toBe(409);
    const sau = await prisma.quote.findUnique({ where: { id: quoteId }, select: { hnTables: true } });
    expect(Number(sau.hnTables[0].items[0].unitPrice)).toBe(700);
  });

  it("vế đối trọng: CHỦ báo giá (có hn:manage) vẫn sửa được", async () => {
    const truoc = (await chu.get(`/api/quotes/${quoteId}`)).body;
    const hn = JSON.parse(JSON.stringify(truoc.hnTables));
    hn[0].items[0].unitPrice = 800;
    const r = await chu.put(`/api/quotes/${quoteId}`).send({ ...truoc, sheets: boNull(truoc.sheets), hnTables: hn, baseUpdatedAt: truoc.updatedAt });
    expect(r.status, JSON.stringify(r.body).slice(0, 200)).toBe(200);
  });
});
