// Integration tests cho module Nhân sự (/api/personnel) + RBAC từng góc cạnh.
// Drives the REAL app qua supertest — cần Postgres có schema (CI cấp; local tự skip).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { prisma } from "../src/db.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "PersonnelRecord" LIMIT 1')
  .then(() => true)
  .catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") {
  throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres/schema PersonnelRecord");
}

const TAG = `hr${Date.now()}`;
const PASSWORD = "Test1234!a";

describe.runIf(dbAvailable)("personnel module + RBAC (integration)", () => {
  let app;
  let adminU, mgrAU, mgrBU, hrU, acctU;
  let admin, mgrA, mgrB, hr, acct; // supertest agents (cookie sessions)

  const makeUser = async (role, label) =>
    prisma.user.create({
      data: { username: `${TAG}-${label}`, displayName: `${TAG} ${label}`, role, passwordHash: await bcrypt.hash(PASSWORD, 4) },
    });
  const login = async (agent, user) => {
    const r = await agent.post("/api/auth/login").send({ username: user.username, password: PASSWORD });
    expect(r.status).toBe(200);
  };
  const payload = (o = {}) => ({ fullName: `${TAG} Nhân viên`, salary: 10_000_000, projectName: "Dự án X", ...o });

  beforeAll(async () => {
    const { createApp } = await import("../src/app.js");
    app = createApp();
    [adminU, mgrAU, mgrBU, hrU, acctU] = await Promise.all([
      makeUser("admin", "admin"), makeUser("manager", "mgrA"), makeUser("manager", "mgrB"),
      makeUser("hr", "hr"), makeUser("accountant", "acct"),
    ]);
    admin = request.agent(app); mgrA = request.agent(app); mgrB = request.agent(app);
    hr = request.agent(app); acct = request.agent(app);
    await Promise.all([login(admin, adminU), login(mgrA, mgrAU), login(mgrB, mgrBU), login(hr, hrU), login(acct, acctU)]);
  });

  afterAll(async () => {
    await prisma.personnelRecord.deleteMany({ where: { fullName: { startsWith: TAG } }, hardDelete: true });
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true });
  });

  let recAId;

  it("manager A tạo hồ sơ → 201 và SỞ HỮU nó (createdById = mình)", async () => {
    const r = await mgrA.post("/api/personnel").send(payload({ fullName: `${TAG} A1` }));
    expect(r.status).toBe(201);
    expect(r.body.fullName).toBe(`${TAG} A1`);
    expect(r.body.createdById).toBe(mgrAU.id);
    recAId = r.body.id;
  });

  it("thiếu Họ&Tên → 400 (validate)", async () => {
    const r = await mgrA.post("/api/personnel").send({ salary: 5 });
    expect(r.status).toBe(400);
  });

  it("OWNER-SCOPING: manager A chỉ thấy của mình; manager B KHÔNG thấy hồ sơ của A", async () => {
    await mgrB.post("/api/personnel").send(payload({ fullName: `${TAG} B1` }));
    const a = await mgrA.get("/api/personnel").query({ q: TAG });
    const b = await mgrB.get("/api/personnel").query({ q: TAG });
    expect(a.body.data.every((r) => r.createdById === mgrAU.id)).toBe(true);
    expect(b.body.data.every((r) => r.createdById === mgrBU.id)).toBe(true);
    expect(a.body.data.some((r) => r.id === recAId)).toBe(true);
    expect(b.body.data.some((r) => r.id === recAId)).toBe(false); // không lộ chéo
  });

  it("admin + hr + accountant thấy TẤT CẢ hồ sơ", async () => {
    for (const ag of [admin, hr, acct]) {
      const r = await ag.get("/api/personnel").query({ q: TAG });
      expect(r.status).toBe(200);
      expect(r.body.data.map((x) => x.id)).toContain(recAId);
    }
  });

  it("hr READ-ONLY: tạo/sửa/xóa đều 403", async () => {
    expect((await hr.post("/api/personnel").send(payload())).status).toBe(403);
    expect((await hr.put(`/api/personnel/${recAId}`).send({ note: "x" })).status).toBe(403);
    expect((await hr.delete(`/api/personnel/${recAId}`)).status).toBe(403);
  });

  it("accountant READ-ONLY: tạo/sửa đều 403", async () => {
    expect((await acct.post("/api/personnel").send(payload())).status).toBe(403);
    expect((await acct.put(`/api/personnel/${recAId}`).send({ payment: "x" })).status).toBe(403);
  });

  it("manager B KHÔNG sửa/xóa được hồ sơ của A → 403 (chống IDOR)", async () => {
    expect((await mgrB.put(`/api/personnel/${recAId}`).send({ note: "hack" })).status).toBe(403);
    expect((await mgrB.delete(`/api/personnel/${recAId}`)).status).toBe(403);
  });

  it("manager A sửa hồ sơ CỦA MÌNH → 200", async () => {
    const r = await mgrA.put(`/api/personnel/${recAId}`).send({ note: "đã cập nhật", salary: 12_000_000 });
    expect(r.status).toBe(200);
    expect(r.body.note).toBe("đã cập nhật");
    expect(Number(r.body.salary)).toBe(12_000_000);
  });

  it("admin sửa hồ sơ của BẤT KỲ ai → 200", async () => {
    const r = await admin.put(`/api/personnel/${recAId}`).send({ confirmed: "admin duyệt" });
    expect(r.status).toBe(200);
    expect(r.body.confirmed).toBe("admin duyệt");
  });

  it("round-trip nhiều cột (cá nhân + lương/thuế + hợp đồng) lưu + đọc đúng", async () => {
    const r = await mgrA.post("/api/personnel").send(payload({
      fullName: `${TAG} Full`, taxCode: "8801234567", idCard: "079123", bankName: "ACB", bankAccount: "216110189",
      salary: 20_000_000, pit: 2_000_000, taxableIncome: 18_000_000, laborContractNo: "HDLD-01",
      purchaseOrder: "PO-9", preTaxAmount: 50_000_000, payment: "Đã TT", confirmed: "OK",
    }));
    expect(r.status).toBe(201);
    expect(r.body.taxCode).toBe("8801234567");
    expect(Number(r.body.pit)).toBe(2_000_000);
    expect(r.body.laborContractNo).toBe("HDLD-01");
    expect(r.body.bankName).toBe("ACB");
  });

  it("manager A xóa hồ sơ của mình → 200, list KHÔNG còn (soft-delete ẩn)", async () => {
    const r = await mgrA.delete(`/api/personnel/${recAId}`);
    expect(r.status).toBe(200);
    const a = await mgrA.get("/api/personnel").query({ q: TAG });
    expect(a.body.data.some((x) => x.id === recAId)).toBe(false);
  });

  it("API yêu cầu đăng nhập (401 khi chưa auth)", async () => {
    const r = await request(app).get("/api/personnel");
    expect(r.status).toBe(401);
  });
});
