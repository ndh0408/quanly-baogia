/**
 * RBAC-01 — GỠ HẾT QUYỀN RIÊNG CỦA MỘT TÀI KHOẢN THÌ TÀI KHOẢN ĐÓ PHẢI HẾT QUYỀN, KHÔNG PHẢI NHẬN LẠI
 * TOÀN BỘ QUYỀN MẶC ĐỊNH CỦA VAI TRÒ.
 *
 * Trước bản vá: admin bỏ tích mọi ô → PUT permissions [] → CSDL lưu [] → middleware hiểu [] là
 * "chưa tuỳ biến" → resolveUserPermissions trả 30 quyền mặc định của manager (đọc danh bạ CCCD/số
 * tài khoản, khách hàng, báo giá). API trả 200 "Đã lưu" mà làm điều ngược lại.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import { agentWithCsrf } from "./helpers/agent.js";
import { prisma } from "../src/db.js";
import { resolveUserPermissions, PERMISSIONS } from "../src/permissions.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "User" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") {
  throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");
}

const TAG = `rbgo${Date.now()}`;
const MAT_KHAU = "GoQuyen1234!ok";

describe.runIf(dbAvailable)("RBAC-01 — permissions [] là tước hết quyền", () => {
  let app, quanTri, adminU, mgrU;

  const dangNhap = async (u) => {
    const ag = agentWithCsrf(app);
    const r = await ag.post("/api/auth/login").send({ username: u.username, password: MAT_KHAU });
    expect(r.status).toBe(200);
    return ag;
  };

  beforeAll(async () => {
    app = (await import("../src/app.js")).createApp();
    adminU = await prisma.user.create({ data: { username: `${TAG}-admin`, displayName: "A", role: "admin", passwordHash: await bcrypt.hash(MAT_KHAU, 4) } });
    mgrU = await prisma.user.create({ data: { username: `${TAG}-mgr`, displayName: "M", role: "manager", passwordHash: await bcrypt.hash(MAT_KHAU, 4) } });
    quanTri = await dangNhap(adminU);
  }, 60_000);

  afterAll(async () => {
    const ids = [adminU?.id, mgrU?.id].filter(Boolean);
    await prisma.auditEvent.deleteMany({ where: { OR: [{ actorId: { in: ids } }, { resourceId: { in: ids.map(String) } }] } }).catch(() => {});
    await prisma.loginAttempt.deleteMany({ where: { username: { startsWith: TAG } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true, includeDeleted: true }).catch(() => {});
  });

  it("tiền đề: manager mặc định đọc được danh bạ nhân viên và báo giá", async () => {
    const mgr = await dangNhap(mgrU);
    expect((await mgr.get("/api/employees")).status).toBe(200);
    expect((await mgr.get("/api/quotes")).status).toBe(200);
  });

  it("PUT permissions [] → GET /api/employees và /api/quotes đều 403", async () => {
    const r = await quanTri.put(`/api/users/${mgrU.id}`).send({ permissions: [] });
    expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(200);
    const mgr = await dangNhap(mgrU);
    expect((await mgr.get("/api/employees")).status, "tước hết quyền mà vẫn đọc được danh bạ CCCD/số tài khoản").toBe(403);
    expect((await mgr.get("/api/quotes")).status).toBe(403);
    // Danh sách tài khoản phải nói đúng: đã tuỳ biến, quyền hiệu lực rỗng.
    const ds = await quanTri.get("/api/users");
    const hang = ds.body.find((u) => u.id === mgrU.id);
    expect(hang.permCustom).toBe(true);
    expect(hang.effectivePermissions).toEqual([]);
  });

  it("chỉ tích quyền ADMIN_ONLY (bị lọc về rỗng) → cũng hết quyền, không leo thang, không về mặc định", async () => {
    const r = await quanTri.put(`/api/users/${mgrU.id}`).send({ permissions: [PERMISSIONS.USER_MANAGE] });
    expect(r.status).toBe(200);
    const mgr = await dangNhap(mgrU);
    expect((await mgr.get("/api/employees")).status).toBe(403);
    expect((await mgr.get("/api/users")).status).toBe(403);
  });

  it("PUT permissions null → quay về bộ mặc định của vai trò", async () => {
    const r = await quanTri.put(`/api/users/${mgrU.id}`).send({ permissions: null });
    expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(200);
    const mgr = await dangNhap(mgrU);
    expect((await mgr.get("/api/employees")).status).toBe(200);
    const hang = (await quanTri.get("/api/users")).body.find((u) => u.id === mgrU.id);
    expect(hang.permCustom).toBe(false);
  });

  it("vế đối trọng: nâng lên admin gửi [] vẫn là admin đủ quyền", async () => {
    const r = await quanTri.put(`/api/users/${mgrU.id}`).send({ role: "admin", permissions: [] });
    expect(r.status).toBe(200);
    const hang = await prisma.user.findUnique({ where: { id: mgrU.id }, select: { permissions: true, role: true } });
    expect(hang.permissions).toEqual([]);
    expect(resolveUserPermissions("admin", hang.permissions)).toContain(PERMISSIONS.USER_MANAGE);
  });
});
