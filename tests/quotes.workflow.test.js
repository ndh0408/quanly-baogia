// Integration tests for the quote lifecycle (create → converted/lost) and the
// RBAC / terminal-state guards around it. Drives the REAL app via supertest —
// requires a Postgres with the app schema (CI provides one; locally the suite
// skips itself when the DB or schema is missing).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { prisma } from "../src/db.js";

// Probe BOTH connectivity and schema so a dev machine without Postgres (or with
// an empty test DB) skips cleanly instead of failing 20 tests with P1001 noise.
const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "User" LIMIT 1')
  .then(() => true)
  .catch(() => false);

// In CI we set REQUIRE_DB_TESTS=1 so the route-level authz/IDOR enforcement here
// is ALWAYS exercised; a missing DB/schema must fail CI, not skip silently.
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") {
  throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres/schema — integration test authz không được phép skip trong CI");
}

const TAG = `wf${Date.now()}`;
const PASSWORD = "Test1234!a";

describe.runIf(dbAvailable)("quote workflow + RBAC (integration)", () => {
  let app;
  let company, template;
  let adminU, managerU, manager2U;
  let admin, manager, manager2; // supertest agents (cookie sessions)

  async function makeUser(role, label = role) {
    return prisma.user.create({
      data: {
        username: `${TAG}-${label}`,
        displayName: `${TAG} ${label}`,
        role,
        passwordHash: await bcrypt.hash(PASSWORD, 4), // low cost: test speed
      },
    });
  }
  async function login(agent, user) {
    const res = await agent.post("/api/auth/login").send({ username: user.username, password: PASSWORD });
    expect(res.status).toBe(200);
    return res;
  }
  function quotePayload(overrides = {}) {
    return {
      title: `${TAG} báo giá test`,
      toCompany: "Khách Test",
      companyId: company.id,
      vatPercent: 8,
      sheets: [{ templateId: template.id, items: [{ name: "Hạng mục A", quantity: 2, unitPrice: 1_000_000 }] }],
      ...overrides,
    };
  }

  beforeAll(async () => {
    const { createApp } = await import("../src/app.js");
    app = createApp();

    company = await prisma.company.create({
      data: { code: `${TAG}-co`, name: `${TAG} Co`, address: "1 Test St", quotePrefix: "TS" },
    });
    template = await prisma.quoteTemplate.create({
      data: { code: `${TAG}-tpl`, name: `${TAG} Template`, companyId: company.id, filePath: "templates/Unibenfood.xlsx" },
    });
    // 'employee' role removed — the regular non-admin actor is now a MANAGER.
    // manager2 is a second manager, used to prove cross-user approval/read is denied.
    [adminU, managerU, manager2U] = await Promise.all([
      makeUser("admin"), makeUser("manager", "manager"), makeUser("manager", "manager2"),
    ]);

    admin = request.agent(app);
    manager = request.agent(app);
    manager2 = request.agent(app);
    await login(admin, adminU);
    await login(manager, managerU);
    await login(manager2, manager2U);
  });

  afterAll(async () => {
    const quotes = await prisma.quote.findMany({
      where: { title: { startsWith: TAG } },
      includeDeleted: true,
      select: { id: true },
    });
    const qIds = quotes.map((q) => q.id);
    const uIds = [adminU, managerU, manager2U].filter(Boolean).map((u) => u.id);
    await prisma.approval.deleteMany({ where: { quoteId: { in: qIds } } });
    await prisma.notification.deleteMany({ where: { userId: { in: uIds } } });
    await prisma.loginAttempt.deleteMany({ where: { username: { startsWith: TAG } } });
    await prisma.quote.deleteMany({ where: { id: { in: qIds } }, hardDelete: true });
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true });
    await prisma.quoteTemplate.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true });
    await prisma.company.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true });
  });

  it("rejects a wrong password with 401", async () => {
    const res = await request(app).post("/api/auth/login").send({ username: adminU.username, password: "wrong-pass-1" });
    expect(res.status).toBe(401);
  });

  it("rejects unauthenticated API access", async () => {
    const res = await request(app).get("/api/quotes");
    expect(res.status).toBe(401);
  });

  // A stolen cookie alone must NOT be able to enable MFA (else an attacker locks the
  // victim out with an attacker-controlled secret). /enable now requires a password step-up,
  // symmetric with /disable. These paths reject BEFORE persisting any secret, so MFA stays off.
  it("MFA /enable requires a password step-up", async () => {
    const noPw = await admin.post("/api/mfa/enable").send({ secret: "JBSWY3DPEHPK3PXP", token: "123456" });
    expect(noPw.status).toBe(400); // missing password → validation
    const wrongPw = await admin.post("/api/mfa/enable").send({ password: "definitely-wrong", secret: "JBSWY3DPEHPK3PXP", token: "123456" });
    expect(wrongPw.status).toBe(401); // wrong password → step-up rejects
  });

  // Concurrent "Bản mới cùng mã dự án" must NOT both land on _v2 (race). The
  // @@unique([projectCode, projectVersion]) + in-tx version recompute serialize them.
  it("concurrent 'new version, same project' get distinct versions (no duplicate _v2)", async () => {
    const srcRes = await manager.post("/api/quotes").send(quotePayload({ title: `${TAG} ver-race` }));
    expect(srcRes.status).toBe(201);
    const srcId = srcRes.body.id;
    const [a, b] = await Promise.all([
      manager.post(`/api/quotes/${srcId}/duplicate`).send({ sameProject: true }),
      manager.post(`/api/quotes/${srcId}/duplicate`).send({ sameProject: true }),
    ]);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.projectCode).toBe(b.body.projectCode);          // cùng mã dự án
    expect([a.body.projectVersion, b.body.projectVersion].sort()).toEqual([2, 3]); // KHÔNG phải [2,2]
  });

  // Vòng đời mới (luồng duyệt nội bộ BỎ 2026-06-22): Nháp → Khách chốt (converted) /
  // Không chốt (lost). "Gửi khách" chỉ là export, không đổi trạng thái.
  describe("lifecycle: create → khách chốt", () => {
    let quoteId;

    it("manager creates a quote → 201 draft with totals", async () => {
      const res = await manager.post("/api/quotes").send(quotePayload());
      expect(res.status).toBe(201);
      expect(res.body.status).toBe("draft");
      expect(res.body.subtotal).toBe(2_000_000);
      expect(res.body.vat).toBe(160_000);
      expect(res.body.total).toBe(2_160_000);
      quoteId = res.body.id;
    });

    it("a price-affecting edit on a draft re-prices it", async () => {
      const res = await manager.put(`/api/quotes/${quoteId}`).send({
        sheets: [{ templateId: template.id, items: [{ name: "Hạng mục B", quantity: 1, unitPrice: 500_000 }] }],
      });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("draft");
      expect(res.body.total).toBe(540_000); // 500,000 + 8% VAT
    });

    it("REGRESSION: a discount-only PUT actually changes the total", async () => {
      // Quote is now draft with total 540,000 (500,000 + 8% VAT).
      const res = await manager.put(`/api/quotes/${quoteId}`).send({ discount: 40_000 });
      expect(res.status).toBe(200);
      expect(res.body.discount).toBe(40_000);
      expect(res.body.total).toBe(500_000); // 540,000 − 40,000
    });

    it("a plain MEMBER (no quote:send) cannot terminal-close the deal → 403", async () => {
      // manager2 isn't owner/member here; segregation of duties also blocks self-close.
      const res = await manager2.post(`/api/quotes/${quoteId}/mark-converted`).send({});
      expect(res.status).toBe(403);
    });

    it("owner marks Khách chốt (mark-converted) → converted", async () => {
      const res = await manager.post(`/api/quotes/${quoteId}/mark-converted`).send({});
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("converted");
    });

    it("converted is terminal — re-marking is rejected", async () => {
      const res = await manager.post(`/api/quotes/${quoteId}/mark-converted`).send({});
      expect(res.status).toBe(400);
    });
  });

  describe("terminal state: converted is immutable", () => {
    let quoteId;

    beforeAll(async () => {
      const res = await admin.post("/api/quotes").send(quotePayload({ title: `${TAG} deal đã chốt` }));
      expect(res.status).toBe(201);
      quoteId = res.body.id;
      await prisma.quote.update({ where: { id: quoteId }, data: { status: "converted" } });
    });

    it("REGRESSION: even admin cannot edit a converted quote", async () => {
      const res = await admin.put(`/api/quotes/${quoteId}`).send({
        sheets: [{ templateId: template.id, items: [{ name: "Sửa giá deal đã chốt", quantity: 1, unitPrice: 9_999_999 }] }],
      });
      expect(res.status).toBe(403);
    });

    it("converted quote cannot be deleted", async () => {
      const res = await admin.delete(`/api/quotes/${quoteId}`);
      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe("RBAC scoping", () => {
    let adminQuoteId;

    beforeAll(async () => {
      const res = await admin.post("/api/quotes").send(quotePayload({ title: `${TAG} của admin` }));
      adminQuoteId = res.body.id;
    });

    it("a manager cannot read a quote they don't own / aren't a member of", async () => {
      const res = await manager2.get(`/api/quotes/${adminQuoteId}`);
      expect(res.status).toBe(403);
    });

    it("manager list only shows their own quotes", async () => {
      const res = await manager2.get("/api/quotes").query({ q: TAG });
      expect(res.status).toBe(200);
      for (const row of res.body.data) {
        const mine =
          row.createdById === manager2U.id ||
          (row.members || []).some((m) => (m.id ?? m) === manager2U.id);
        expect(mine).toBe(true);
      }
    });
  });

  describe("REGRESSION: list filter accepts every real status", () => {
    it.each(["draft", "pending", "approved", "rejected", "sent", "converted", "lost"])(
      "GET /api/quotes?status=%s → 200",
      async (status) => {
        const res = await admin.get("/api/quotes").query({ status });
        expect(res.status).toBe(200);
      }
    );

    it("filter actually matches the converted fixture", async () => {
      const res = await admin.get("/api/quotes").query({ status: "converted", q: TAG });
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    });
  });
});
