// SỬA-TẠI-CHỖ NHÂN SỰ theo QUYỀN + ẢNH chứng từ thanh toán (field-level authz — bảo mật).
// teamNote=Account chủ dòng · accountingNote=Kế toán · note=Admin · payment+ảnh=Kế toán.
// Form chung (PUT) KHÔNG ghi accountingNote/note (chống rò quyền). Drive REAL app qua supertest.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { prisma } from "../src/db.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "PersonnelRecord" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres/schema PersonnelRecord");

const TAG = `pf${Date.now()}`;
const PWD = "Test1234!a";
// PNG 1x1 hợp lệ (magic byte đúng) cho test ảnh chứng từ.
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

describe.runIf(dbAvailable)("personnel field-level edit + payment proof (integration)", () => {
  let app, adminU, mgrU, mgr2U, acctU, admin, mgr, mgr2, acct, recId;

  const makeUser = async (role, label) =>
    prisma.user.create({ data: { username: `${TAG}-${label}`, displayName: `${TAG} ${label}`, role, passwordHash: await bcrypt.hash(PWD, 4) } });
  const login = async (agent, u) => { const r = await agent.post("/api/auth/login").send({ username: u.username, password: PWD }); expect(r.status).toBe(200); };

  beforeAll(async () => {
    const { createApp } = await import("../src/app.js");
    app = createApp();
    [adminU, mgrU, mgr2U, acctU] = await Promise.all([makeUser("admin", "admin"), makeUser("manager", "mgr"), makeUser("manager", "mgr2"), makeUser("accountant", "acct")]);
    admin = request.agent(app); mgr = request.agent(app); mgr2 = request.agent(app); acct = request.agent(app);
    await Promise.all([login(admin, adminU), login(mgr, mgrU), login(mgr2, mgr2U), login(acct, acctU)]);
    const c = await mgr.post("/api/personnel").send({ fullName: `${TAG} NV`, salary: 10_000_000, projectName: "DA", projectCode: "PRJ-X" });
    expect(c.status).toBe(201);
    recId = c.body.id; // sở hữu bởi mgr
  });

  afterAll(async () => {
    await prisma.auditEvent.deleteMany({ where: { resource: "personnel", resourceId: String(recId) } });
    await prisma.personnelRecord.deleteMany({ where: { fullName: { startsWith: TAG } }, hardDelete: true });
    await prisma.loginAttempt.deleteMany({ where: { username: { startsWith: TAG } } });
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true });
  });

  it("TEAM GHI CHÚ: chủ-dòng (manager) ghi được; manager KHÁC + kế toán → 403", async () => {
    const r = await mgr.post(`/api/personnel/${recId}/team-note`).send({ value: "ghi chú team" });
    expect(r.status).toBe(200);
    expect(r.body.teamNote).toBe("ghi chú team");
    expect((await mgr2.post(`/api/personnel/${recId}/team-note`).send({ value: "x" })).status).toBe(403); // không sở hữu
    expect((await acct.post(`/api/personnel/${recId}/team-note`).send({ value: "x" })).status).toBe(403); // không manage
  });

  it("KẾ TOÁN GHI CHÚ: kế toán ghi được; manager (chủ dòng) → 403", async () => {
    const r = await acct.post(`/api/personnel/${recId}/accounting-note`).send({ value: "kế toán note" });
    expect(r.status).toBe(200);
    expect(r.body.accountingNote).toBe("kế toán note");
    expect((await mgr.post(`/api/personnel/${recId}/accounting-note`).send({ value: "x" })).status).toBe(403);
  });

  it("NOTE: admin ghi được; kế toán + manager → 403", async () => {
    const r = await admin.post(`/api/personnel/${recId}/note`).send({ value: "admin note" });
    expect(r.status).toBe(200);
    expect(r.body.note).toBe("admin note");
    expect((await acct.post(`/api/personnel/${recId}/note`).send({ value: "x" })).status).toBe(403);
    expect((await mgr.post(`/api/personnel/${recId}/note`).send({ value: "x" })).status).toBe(403);
  });

  it("FORM chung (PUT) KHÔNG ghi accountingNote/note (chống rò quyền — bị strip)", async () => {
    await acct.post(`/api/personnel/${recId}/accounting-note`).send({ value: "KT-GIỮ" });
    const r = await mgr.put(`/api/personnel/${recId}`).send({ fullName: `${TAG} NV`, accountingNote: "HACK", note: "HACK" });
    expect(r.status).toBe(200);
    const got = (await admin.get(`/api/personnel/${recId}`)).body;
    expect(got.accountingNote).toBe("KT-GIỮ");   // form KHÔNG ghi đè
    expect(got.note).toBe("admin note");          // form KHÔNG ghi đè
  });

  it("THANH TOÁN + ẢNH: kế toán đánh dấu + ảnh → lưu; list omit base64 + hasPaymentProof; getPaymentProof trả ảnh", async () => {
    const r = await acct.post(`/api/personnel/${recId}/payment`).send({ paid: true, paymentProof: PNG });
    expect(r.status).toBe(200);
    expect(r.body.paidAt).toBeTruthy();
    expect(r.body.hasPaymentProof).toBe(true);
    expect(r.body.paymentProof).toBeUndefined();   // KHÔNG trả base64 trong response thường

    const list = (await acct.get(`/api/personnel?q=${TAG}`)).body;
    const row = list.data.find((x) => x.id === recId);
    expect(row.paymentProof).toBeUndefined();       // list KHÔNG tải base64 (nặng)
    expect(row.hasPaymentProof).toBe(true);

    const pp = await acct.get(`/api/personnel/${recId}/payment-proof`);
    expect(pp.status).toBe(200);
    expect(pp.body.paymentProof).toBe(PNG);          // lấy on-demand đúng ảnh
  });

  it("THANH TOÁN: bỏ đánh dấu → XÓA ảnh; ảnh không-phải-image → 400", async () => {
    const r = await acct.post(`/api/personnel/${recId}/payment`).send({ paid: false });
    expect(r.status).toBe(200);
    expect(r.body.hasPaymentProof).toBe(false);
    expect((await acct.get(`/api/personnel/${recId}/payment-proof`)).status).toBe(404);
    expect((await acct.post(`/api/personnel/${recId}/payment`).send({ paid: true, paymentProof: "khong-phai-anh" })).status).toBe(400);
  });
});
