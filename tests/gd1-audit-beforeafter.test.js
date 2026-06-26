// GĐ1 #3 — markPayment/markConfirm GHI before/after vào AuditEvent (truy vết thao tác tài chính/ký).
// Drives the REAL app qua supertest — cần Postgres có schema (CI cấp; local tự skip).
// Kiểm: POST /payment (kế toán) → AuditEvent action "personnel.pay" có before.paidAt=null + after.paidAt!=null.
//       POST /confirm (admin)    → AuditEvent action "personnel.confirm" có before.confirmedAt=null + after.confirmedAt!=null.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { prisma } from "../src/db.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "AuditEvent" LIMIT 1')
  .then(() => true)
  .catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") {
  throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres/schema AuditEvent");
}

const TAG = `auba${Date.now()}`;
const PASSWORD = "Test1234!a";

describe.runIf(dbAvailable)("GĐ1 #3 — audit before/after pay/confirm (integration)", () => {
  let app;
  let adminU, mgrU, acctU; // user rows
  let admin, mgr, acct; // supertest agents (cookie sessions)
  const createdRecIds = []; // PersonnelRecord ids để dọn AuditEvent theo resourceId

  const makeUser = async (role, label) =>
    prisma.user.create({
      data: { username: `${TAG}-${label}`, displayName: `${TAG} ${label}`, role, passwordHash: await bcrypt.hash(PASSWORD, 4) },
    });
  const login = async (agent, user) => {
    const r = await agent.post("/api/auth/login").send({ username: user.username, password: PASSWORD });
    expect(r.status).toBe(200);
  };
  // projectCode BẮT BUỘC khi tạo (gắn dự án đã chốt).
  const payload = (o = {}) => ({ fullName: `${TAG} Nhân viên`, salary: 10_000_000, projectName: "Dự án X", projectCode: "PRJ-X", ...o });

  // Lấy AuditEvent MỚI NHẤT cho 1 hồ sơ + action cụ thể. resourceId lưu dạng String (audit.ts ép String()).
  const latestAudit = (recId, action) =>
    prisma.auditEvent.findFirst({
      where: { resource: "personnel", resourceId: String(recId), action },
      orderBy: { createdAt: "desc" },
    });

  beforeAll(async () => {
    const { createApp } = await import("../src/app.js");
    app = createApp();
    [adminU, mgrU, acctU] = await Promise.all([
      makeUser("admin", "admin"), makeUser("manager", "mgr"), makeUser("accountant", "acct"),
    ]);
    admin = request.agent(app); mgr = request.agent(app); acct = request.agent(app);
    await Promise.all([login(admin, adminU), login(mgr, mgrU), login(acct, acctU)]);
  });

  afterAll(async () => {
    // Dọn AuditEvent của các hồ sơ test (resourceId lưu String), rồi hồ sơ + user.
    if (createdRecIds.length) {
      await prisma.auditEvent.deleteMany({
        where: { resource: "personnel", resourceId: { in: createdRecIds.map(String) } },
      });
    }
    await prisma.personnelRecord.deleteMany({ where: { fullName: { startsWith: TAG } }, hardDelete: true });
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true });
  });

  it("KẾ TOÁN markPayment → AuditEvent 'personnel.pay' ghi before.paidAt=null + after.paidAt khác null", async () => {
    // manager (account) tạo hồ sơ — chưa thanh toán.
    const c = await mgr.post("/api/personnel").send(payload({ fullName: `${TAG} Pay` }));
    expect(c.status).toBe(201);
    const id = c.body.id;
    createdRecIds.push(id);

    // kế toán đánh dấu ĐÃ thanh toán.
    const r = await acct.post(`/api/personnel/${id}/payment`).send({ paid: true });
    expect(r.status).toBe(200);
    expect(r.body.paidAt).toBeTruthy();

    // AuditEvent mới nhất action personnel.pay phải có before/after đúng.
    const ev = await latestAudit(id, "personnel.pay");
    expect(ev).toBeTruthy();
    expect(ev.actorId).toBe(acctU.id);
    // before: chưa thanh toán → paidAt null (Json lưu null).
    expect(ev.before).toBeTruthy();
    expect(ev.before.paidAt ?? null).toBeNull();
    expect(ev.before.paidById ?? null).toBeNull();
    // after: đã thanh toán → paidAt KHÁC null + paidById = kế toán.
    expect(ev.after).toBeTruthy();
    expect(ev.after.paidAt ?? null).not.toBeNull();
    expect(ev.after.paidById).toBe(acctU.id);
  });

  it("ADMIN markConfirm → AuditEvent 'personnel.confirm' ghi before.confirmedAt=null + after.confirmedAt khác null", async () => {
    const c = await mgr.post("/api/personnel").send(payload({ fullName: `${TAG} Sign` }));
    expect(c.status).toBe(201);
    const id = c.body.id;
    createdRecIds.push(id);

    // admin xác nhận ĐÃ ký.
    const r = await admin.post(`/api/personnel/${id}/confirm`).send({ confirmed: true });
    expect(r.status).toBe(200);
    expect(r.body.confirmedAt).toBeTruthy();

    const ev = await latestAudit(id, "personnel.confirm");
    expect(ev).toBeTruthy();
    expect(ev.actorId).toBe(adminU.id);
    // before: chưa ký → confirmedAt null.
    expect(ev.before).toBeTruthy();
    expect(ev.before.confirmedAt ?? null).toBeNull();
    expect(ev.before.confirmedById ?? null).toBeNull();
    // after: đã ký → confirmedAt KHÁC null + confirmedById = admin.
    expect(ev.after).toBeTruthy();
    expect(ev.after.confirmedAt ?? null).not.toBeNull();
    expect(ev.after.confirmedById).toBe(adminU.id);
  });

  it("BỎ thanh toán (unpay) → AuditEvent 'personnel.unpay' ghi before.paidAt khác null + after.paidAt=null", async () => {
    const c = await mgr.post("/api/personnel").send(payload({ fullName: `${TAG} Unpay` }));
    expect(c.status).toBe(201);
    const id = c.body.id;
    createdRecIds.push(id);

    // đánh dấu rồi BỎ — before(after-unpay) phải có paidAt đã set trước đó.
    await acct.post(`/api/personnel/${id}/payment`).send({ paid: true });
    const r2 = await acct.post(`/api/personnel/${id}/payment`).send({ paid: false });
    expect(r2.status).toBe(200);
    expect(r2.body.paidAt ?? null).toBeNull();

    const ev = await latestAudit(id, "personnel.unpay");
    expect(ev).toBeTruthy();
    // before: vẫn đang đã-thanh-toán → paidAt khác null.
    expect(ev.before.paidAt ?? null).not.toBeNull();
    // after: bỏ → paidAt null + paidById null.
    expect(ev.after.paidAt ?? null).toBeNull();
    expect(ev.after.paidById ?? null).toBeNull();
  });

  it("GET /api/audit → cột Đối tượng có targetLabel = TÊN hồ sơ (admin thấy tên, KHÔNG phải '#id')", async () => {
    const name = `${TAG} Tên Hiện`;
    const c = await mgr.post("/api/personnel").send(payload({ fullName: name }));
    const id = c.body.id;
    createdRecIds.push(id);
    await acct.post(`/api/personnel/${id}/payment`).send({ paid: true }); // chắc chắn có 1 event personnel.pay

    const r = await admin.get("/api/audit").query({ resource: "personnel", size: 100 });
    expect(r.status).toBe(200);
    const row = r.body.data.find((x) => x.resourceId === String(id));
    expect(row).toBeTruthy();
    expect(row.targetLabel).toBe(name); // TÊN thật (resolve resourceId→fullName), không phải #id
  });

  it("targetLabel CÒN cho hồ sơ ĐÃ XÓA (includeDeleted) → action 'Xóa' admin vẫn biết xóa AI", async () => {
    const name = `${TAG} Sẽ Xóa`;
    const c = await mgr.post("/api/personnel").send(payload({ fullName: name }));
    const id = c.body.id;
    createdRecIds.push(id);
    const d = await mgr.delete(`/api/personnel/${id}`); // soft-delete
    expect(d.status).toBe(200);

    const r = await admin.get("/api/audit").query({ resource: "personnel", size: 100 });
    const row = r.body.data.find((x) => x.resourceId === String(id));
    expect(row).toBeTruthy();
    expect(row.targetLabel).toBe(name); // dù đã soft-delete, vẫn tra được tên qua includeDeleted
  });

  it("BẢO MẬT: manager KHÔNG nhận targetLabel (chống lộ tên chéo qua nhật ký; chỉ admin) + vẫn strip before/after", async () => {
    const name = `${TAG} Ẩn Với Mgr`;
    const c = await mgr.post("/api/personnel").send(payload({ fullName: name }));
    const id = c.body.id;
    createdRecIds.push(id);
    await acct.post(`/api/personnel/${id}/payment`).send({ paid: true });

    const r = await mgr.get("/api/audit").query({ resource: "personnel", size: 100 });
    expect(r.status).toBe(200); // manager có audit:view
    const row = r.body.data.find((x) => x.resourceId === String(id));
    expect(row).toBeTruthy();
    expect(row.targetLabel ?? null).toBeNull();   // KHÔNG lộ tên cho manager
    expect(row.before ?? null).toBeNull();        // least-privilege cũ giữ nguyên (PII strip)
    expect(row.after ?? null).toBeNull();
  });
});
