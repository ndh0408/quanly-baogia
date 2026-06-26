// PHÂN QUYỀN ĐỘNG (A): admin sửa quyền vai-trò sẵn có (ghi đè DB) — KHÔNG override thì hành vi Y HỆT.
// Kiểm: mặc định đúng · PUT đổi quyền có hiệu lực LIVE (manager mất audit:view → /audit 403) · DELETE
// đặt lại · admin LUÔN full (PUT /roles/admin → 400) · validate quyền/role lạ · non-admin bị chặn (403).
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { prisma } from "../src/db.js";
import { reloadRoleOverrides } from "../src/roleOverrides.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "User" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres/schema User");

const TAG = `rbac${Date.now()}`;
const PWD = "Test1234!a";

describe.runIf(dbAvailable)("phân quyền động — role permission override (integration)", () => {
  let app, adminU, mgrU, admin, mgr;

  const makeUser = async (role, label) =>
    prisma.user.create({ data: { username: `${TAG}-${label}`, displayName: `${TAG} ${label}`, role, passwordHash: await bcrypt.hash(PWD, 4) } });
  const login = async (agent, u) => { const r = await agent.post("/api/auth/login").send({ username: u.username, password: PWD }); expect(r.status).toBe(200); };
  const managerRole = async () => (await admin.get("/api/permissions/catalog")).body.roles.find((r) => r.key === "manager");

  beforeAll(async () => {
    const { createApp } = await import("../src/app.js");
    app = createApp();
    [adminU, mgrU] = await Promise.all([makeUser("admin", "admin"), makeUser("manager", "mgr")]);
    admin = request.agent(app); mgr = request.agent(app);
    await Promise.all([login(admin, adminU), login(mgr, mgrU)]);
  });

  afterEach(async () => { await prisma.rolePermission.deleteMany({}); await reloadRoleOverrides(); }); // mọi role về MẶC ĐỊNH

  afterAll(async () => {
    await prisma.rolePermission.deleteMany({});
    await reloadRoleOverrides();
    await prisma.auditEvent.deleteMany({ where: { resource: "role" } });
    await prisma.loginAttempt.deleteMany({ where: { username: { startsWith: TAG } } });
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true });
  });

  it("MẶC ĐỊNH (không override): manager có audit:view + product:manage; overridden=false; xem /audit OK", async () => {
    const m = await managerRole();
    expect(m.permissions).toContain("audit:view");
    expect(m.permissions).toContain("product:manage");
    expect(m.overridden).toBe(false);
    expect(m.editable).toBe(true);
    expect((await mgr.get("/api/audit")).status).toBe(200); // thực thi: có quyền
  });

  it("PUT bỏ audit:view khỏi manager → hiệu lực LIVE: /audit 403 + /me không còn + catalog overridden", async () => {
    const m = await managerRole();
    const without = m.permissions.filter((p) => p !== "audit:view");
    const r = await admin.put("/api/permissions/roles/manager").send({ permissions: without });
    expect(r.status).toBe(200);
    expect(r.body.overridden).toBe(true);
    expect(r.body.permissions).not.toContain("audit:view");
    expect((await mgr.get("/api/audit")).status).toBe(403);                                  // chặn LIVE
    expect((await mgr.get("/api/permissions/me")).body.permissions).not.toContain("audit:view");
    expect((await managerRole()).overridden).toBe(true);
  });

  it("DELETE /roles/manager → đặt lại mặc định: manager xem /audit lại được (200)", async () => {
    const m = await managerRole();
    await admin.put("/api/permissions/roles/manager").send({ permissions: m.permissions.filter((p) => p !== "audit:view") });
    expect((await mgr.get("/api/audit")).status).toBe(403);
    const r = await admin.delete("/api/permissions/roles/manager");
    expect(r.status).toBe(200);
    expect(r.body.overridden).toBe(false);
    expect((await mgr.get("/api/audit")).status).toBe(200);                                  // khôi phục
    expect((await managerRole()).overridden).toBe(false);
  });

  it("ADMIN luôn full — PUT /roles/admin → 400 (không sửa được); admin giữ user:manage", async () => {
    expect((await admin.put("/api/permissions/roles/admin").send({ permissions: [] })).status).toBe(400);
    const a = (await admin.get("/api/permissions/catalog")).body.roles.find((r) => r.key === "admin");
    expect(a.editable).toBe(false);
    expect(a.permissions).toContain("user:manage");
  });

  it("VALIDATE: quyền không tồn tại → 400; vai trò lạ → 400", async () => {
    expect((await admin.put("/api/permissions/roles/manager").send({ permissions: ["khong:ton:tai"] })).status).toBe(400);
    expect((await admin.put("/api/permissions/roles/khong_co_role").send({ permissions: [] })).status).toBe(400);
  });

  it("KHÓA quyền admin-tier: cấp settings:manage/user:manage cho manager → bị LỌC BỎ (không cấp động được)", async () => {
    const m = await managerRole();
    const r = await admin.put("/api/permissions/roles/manager").send({ permissions: [...m.permissions, "settings:manage", "user:manage"] });
    expect(r.status).toBe(200);
    expect(r.body.permissions).not.toContain("settings:manage"); // bị lọc
    expect(r.body.permissions).not.toContain("user:manage");
    const cat = (await admin.get("/api/permissions/catalog")).body;
    expect(cat.adminOnlyPermissions).toEqual(expect.arrayContaining(["settings:manage", "user:manage", "role:assign", "template:manage", "company:manage"]));
  });

  it("BẢO MẬT: non-admin (manager) KHÔNG sửa được quyền + KHÔNG xem được catalog (403)", async () => {
    expect((await mgr.put("/api/permissions/roles/hr").send({ permissions: [] })).status).toBe(403);
    expect((await mgr.delete("/api/permissions/roles/hr")).status).toBe(403);
    expect((await mgr.get("/api/permissions/catalog")).status).toBe(403);
  });
});
