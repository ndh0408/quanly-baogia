/**
 * RBAC-08 — ACCOUNT HÀ NỘI ĐÃ BỊ GỠ KHỎI THÀNH VIÊN THÌ KHÔNG CÒN LƯU / GỬI DUYỆT PHẦN HN.
 *
 * saveHn / submitHn chỉ gác bằng `quote:hn:fill` + `hnAssigneeId`. Chủ báo giá gỡ account HN khỏi
 * danh sách thành viên → GET /:id của họ đã 403, nhưng hnAssigneeId không đổi nên đường GHI vẫn mở.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import { agentWithCsrf } from "./helpers/agent.js";
import { prisma } from "../src/db.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "User" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") {
  throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");
}

const TAG = `rbtv${Date.now()}`;
const MAT_KHAU = "GoThanhVien1234!ok";

describe.runIf(dbAvailable)("RBAC-08 — gỡ thành viên là hết quyền ghi phần HN", () => {
  let app, company, template, chuU, hnU, chu, hn, quoteId;

  const dangNhap = async (u) => {
    const ag = agentWithCsrf(app);
    expect((await ag.post("/api/auth/login").send({ username: u.username, password: MAT_KHAU })).status).toBe(200);
    return ag;
  };
  const luuHn = async () => {
    const q = await prisma.quote.findUnique({ where: { id: quoteId }, select: { updatedAt: true } });
    return hn.put(`/api/quotes/${quoteId}/hn`).send({
      baseUpdatedAt: q.updatedAt,
      hnTables: [{ name: "HN", items: [{ kind: "item", name: "Nhân công", quantity: 1, unitPrice: 500 }] }],
    });
  };

  beforeAll(async () => {
    app = (await import("../src/app.js")).createApp();
    company = await prisma.company.create({ data: { code: `${TAG}-co`, name: "Co", address: "x", quotePrefix: "TV" } });
    template = await prisma.quoteTemplate.create({ data: { code: `${TAG}-tpl`, name: "T", companyId: company.id, filePath: "templates/GN_KhongNgay.xlsx" } });
    const mk = await bcrypt.hash(MAT_KHAU, 4);
    chuU = await prisma.user.create({ data: { username: `${TAG}-chu`, displayName: "Chu", role: "manager", passwordHash: mk } });
    hnU = await prisma.user.create({ data: { username: `${TAG}-hn`, displayName: "HN", role: "account_hn", passwordHash: mk } });
    chu = await dangNhap(chuU);
    hn = await dangNhap(hnU);
    const r = await chu.post("/api/quotes").send({
      title: `${TAG} bg`, toCompany: "K", companyId: company.id, vatPercent: 8,
      sheets: [{ templateId: template.id, items: [{ name: "A", quantity: 1, unitPrice: 1000 }] }],
    });
    expect(r.status).toBe(201);
    quoteId = r.body.id;
    const g = await chu.post(`/api/quotes/${quoteId}/hn/assign`).send({ accountId: hnU.id });
    expect(g.status, JSON.stringify(g.body).slice(0, 200)).toBe(200);
  }, 60_000);

  afterAll(async () => {
    const ids = [chuU?.id, hnU?.id].filter(Boolean);
    await prisma.auditEvent.deleteMany({ where: { actorId: { in: ids } } }).catch(() => {});
    await prisma.notification.deleteMany({ where: { userId: { in: ids } } }).catch(() => {});
    await prisma.quote.deleteMany({ where: { title: { startsWith: TAG } }, hardDelete: true, includeDeleted: true }).catch(() => {});
    await prisma.loginAttempt.deleteMany({ where: { username: { startsWith: TAG } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true, includeDeleted: true }).catch(() => {});
    await prisma.quoteTemplate.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.company.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
  });

  it("còn là thành viên → lưu được; bị gỡ → lưu và gửi duyệt đều 403", async () => {
    expect((await luuHn()).status, "vế đối trọng: account HN được giao phải lưu được").toBe(200);

    const go = await chu.put(`/api/quotes/${quoteId}/members`).send({ members: [], memberIds: [] });
    expect(go.status, JSON.stringify(go.body).slice(0, 200)).toBe(200);
    expect((await hn.get(`/api/quotes/${quoteId}`)).status, "tiền đề: đường đọc đã chặn").toBe(403);

    expect((await luuHn()).status, "người đã bị gỡ vẫn ghi đè được bảng HN").toBe(403);
    expect((await hn.post(`/api/quotes/${quoteId}/hn/submit`).send({})).status).toBe(403);
  }, 60_000);
});
