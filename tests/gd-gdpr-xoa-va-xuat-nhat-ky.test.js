// FILE-10 — POST /api/gdpr/me/delete vượt chốt "quản trị viên cuối cùng" và không đòi xác thực lại.
// FILE-11 — bản xuất GDPR tự phục vụ vẫn chứa bản chụp khách hàng đầy đủ qua auditEvents, vòng qua
//           chốt kẹp phạm vi khách hàng.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import bcrypt from "bcryptjs";
import { agentWithCsrf } from "./helpers/agent.js";
import { prisma } from "../src/db.js";
import { exportUser } from "../src/services/gdprService.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "User" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");

const TAG = `gdxoa${Date.now()}`;
const PWD = "Test1234!a";

describe.runIf(dbAvailable)("FILE-10: tự xoá tài khoản", () => {
  let app;
  const dangNhap = async (u) => {
    const a = agentWithCsrf(app);
    expect((await a.post("/api/auth/login").send({ username: u.username, password: PWD })).status).toBe(200);
    return a;
  };
  const taoUser = async (ten, role) => prisma.user.create({ data: { username: `${TAG}-${ten}`, displayName: `${TAG} ${ten}`, role, passwordHash: await bcrypt.hash(PWD, 4) } });

  beforeAll(async () => {
    const { createApp } = await import("../src/app.js");
    app = createApp();
  });
  afterAll(async () => {
    await prisma.auditEvent.deleteMany({ where: { actor: { username: { startsWith: TAG } } } }).catch(() => {});
    await prisma.loginAttempt.deleteMany({ where: { username: { startsWith: TAG } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { OR: [{ username: { startsWith: TAG } }, { displayName: { startsWith: TAG } }] }, hardDelete: true }).catch(() => {});
  });

  it("thiếu mật khẩu → 400; sai mật khẩu → 401; tài khoản còn nguyên", async () => {
    const u = await taoUser("nv", "manager");
    const a = await dangNhap(u);
    expect((await a.post("/api/gdpr/me/delete").send({ confirm: "DELETE-MY-ACCOUNT" })).status).toBe(400);
    expect((await a.post("/api/gdpr/me/delete").send({ confirm: "DELETE-MY-ACCOUNT", password: "sai-roi" })).status).toBe(401);
    expect((await prisma.user.findUnique({ where: { id: u.id } })).active).toBe(true);
  });

  it("người thường + đúng mật khẩu → 200", async () => {
    const u = await taoUser("nv2", "manager");
    const a = await dangNhap(u);
    const r = await a.post("/api/gdpr/me/delete").send({ confirm: "DELETE-MY-ACCOUNT", password: PWD });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
  });

  it("admin DUY NHẤT còn hoạt động → 400, không tự xoá được", async () => {
    // Dựng ca "admin cuối" bằng cách cho phép đếm admin KHÁC trả 0 — KHÔNG tắt admin thật của CSDL
    // test (các tệp test chạy song song đang dùng chúng).
    const ad = await taoUser("ad", "admin");
    const a = await dangNhap(ad);
    const dem = vi.spyOn(prisma.user, "count").mockResolvedValueOnce(0);
    try {
      const r = await a.post("/api/gdpr/me/delete").send({ confirm: "DELETE-MY-ACCOUNT", password: PWD });
      expect(r.status, "admin cuối tự xoá được → hệ thống không còn ai quản trị").toBe(400);
      expect(dem, "không hề đếm admin còn lại").toHaveBeenCalled();
      expect((await prisma.user.findUnique({ where: { id: ad.id } })).active).toBe(true);
    } finally {
      dem.mockRestore();
    }
  });
});

describe.runIf(dbAvailable)("FILE-11: xuất GDPR không lộ bản chụp khách qua nhật ký", () => {
  let u;
  beforeAll(async () => {
    u = await prisma.user.create({ data: { username: `${TAG}-xk`, displayName: `${TAG} xk`, role: "manager", passwordHash: "x" } });
    await prisma.auditEvent.create({ data: { actorId: u.id, action: "customer.update", resource: "customer", resourceId: "1", before: { name: "Khách Bí Mật", phone: "0909000111" }, after: { name: "Khách Bí Mật 2" } } });
    await prisma.auditEvent.create({ data: { actorId: u.id, action: "login.success", resource: "user", resourceId: String(u.id), after: { ip: "1.2.3.4" } } });
  });
  afterAll(async () => {
    await prisma.auditEvent.deleteMany({ where: { actorId: u?.id } }).catch(() => {});
  });

  it("phiên KHÔNG còn quyền khách hàng → auditEvents resource=customer không có before/after", async () => {
    const out = await exportUser(u.id, { userId: u.id, role: "manager", permissions: ["personnel:read:own"] });
    const kh = out.auditEvents.filter((e) => e.resource === "customer");
    expect(kh).toHaveLength(1);
    expect(kh[0].action).toBe("customer.update");
    expect(JSON.stringify(kh[0], (_k, v) => (typeof v === "bigint" ? String(v) : v)), "bản chụp khách hàng lọt qua nhật ký").not.toMatch(/Khách Bí Mật|0909000111/);
    // Nhật ký KHÔNG phải của khách vẫn nguyên.
    expect(out.auditEvents.find((e) => e.action === "login.success").after).toEqual({ ip: "1.2.3.4" });
  });

  it("phiên CÒN quyền khách hàng → giữ nguyên before/after", async () => {
    const out = await exportUser(u.id, { userId: u.id, role: "manager", permissions: ["customer:read:own"] });
    expect(JSON.stringify(out.auditEvents, (_k, v) => (typeof v === "bigint" ? String(v) : v))).toMatch(/Khách Bí Mật/);
  });
});
