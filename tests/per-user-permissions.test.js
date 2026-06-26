// PHÂN QUYỀN PER-USER (Phase A): User.permissions là nguồn quyền — GHI ĐÈ hoàn toàn quyền mặc định theo role.
// - cấp quyền VƯỢT role (HR vốn không tạo được → cấp create → tạo được)
// - giới hạn DƯỚI role (manager vốn tạo được → chỉ cho read:all → không tạo được)
// - admin CHỐNG TỰ KHÓA (gán quyền tí xíu vẫn full)
// - /me trả đúng tập quyền per-user (không phải role mặc định)
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { prisma } from "../src/db.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "User" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") {
  throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");
}

const TAG = `pup${Date.now()}`;
const PASSWORD = "Test1234!a";

describe.runIf(dbAvailable)("phân quyền PER-USER ghi đè role (integration)", () => {
  let app, hrGrant, mgrRestrict, adminMin;
  let hrGrantA, mgrRestrictA, adminMinA;

  const mk = async (role, label, permissions) =>
    prisma.user.create({ data: { username: `${TAG}-${label}`, displayName: `${TAG} ${label}`, role, permissions, passwordHash: await bcrypt.hash(PASSWORD, 4) } });
  const login = async (agent, u) => { const r = await agent.post("/api/auth/login").send({ username: u.username, password: PASSWORD }); expect(r.status).toBe(200); };
  const payload = (o = {}) => ({ fullName: `${TAG} NV`, salary: 10_000_000, projectName: "X", projectCode: "PRJ-X", ...o });

  beforeAll(async () => {
    app = (await import("../src/app.js")).createApp();
    // HR mặc định CHỈ read:all (không tạo) — cấp thêm create/own → phải TẠO được.
    hrGrant = await mk("hr", "hrgrant", ["personnel:create", "personnel:read:own", "personnel:manage:own"]);
    // MANAGER mặc định tạo được — giới hạn chỉ còn read:all → KHÔNG tạo được nhưng xem tất cả.
    mgrRestrict = await mk("manager", "mgrrestrict", ["personnel:read:all"]);
    // ADMIN gán quyền tí xíu → vẫn FULL (chống tự khóa).
    adminMin = await mk("admin", "adminmin", ["quote:create"]);
    hrGrantA = request.agent(app); mgrRestrictA = request.agent(app); adminMinA = request.agent(app);
    await Promise.all([login(hrGrantA, hrGrant), login(mgrRestrictA, mgrRestrict), login(adminMinA, adminMin)]);
  });

  afterAll(async () => {
    await prisma.personnelRecord.deleteMany({ where: { fullName: { startsWith: TAG } }, hardDelete: true });
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true });
  });

  it("GRANT vượt role: HR (mặc định KHÔNG tạo) + cấp 'personnel:create' → TẠO được (201)", async () => {
    const r = await hrGrantA.post("/api/personnel").send(payload());
    expect(r.status).toBe(201);
    expect(r.body.createdById).toBe(hrGrant.id);
  });

  it("RESTRICT dưới role: manager (mặc định tạo được) + chỉ 'personnel:read:all' → KHÔNG tạo (403) NHƯNG xem tất cả", async () => {
    const seen = await hrGrantA.post("/api/personnel").send(payload({ fullName: `${TAG} seen` }));
    expect(seen.status).toBe(201);
    // create bị gỡ khỏi tập quyền per-user → 403 (dù role manager mặc định có)
    expect((await mgrRestrictA.post("/api/personnel").send(payload())).status).toBe(403);
    // read:all vẫn còn → thấy hồ sơ người khác tạo
    const list = await mgrRestrictA.get("/api/personnel").query({ q: TAG });
    expect(list.status).toBe(200);
    expect(list.body.data.some((x) => x.id === seen.body.id)).toBe(true);
  });

  it("ADMIN chống tự khóa: dù chỉ gán 'quote:create' vẫn FULL (qua can: audit:view → 200)", async () => {
    const r = await adminMinA.get("/api/audit");
    expect(r.status).toBe(200);
  });

  it("/me trả tập quyền PER-USER (không phải role mặc định)", async () => {
    const me = await hrGrantA.get("/api/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.permissions).toContain("personnel:create");     // quyền được cấp
    expect(me.body.permissions).not.toContain("personnel:read:all"); // KHÔNG có cái của role HR mặc định
  });

  it("admin PUT /users/:id { permissions } → set quyền per-user + LỌC nhóm admin-tier + key rác (chống leo thang)", async () => {
    const target = await mk("manager", "target", []);
    const r = await adminMinA.put(`/api/users/${target.id}`).send({
      permissions: ["personnel:read:all", "quote:read:all", "user:manage", "settings:manage", "garbage:fake"],
    });
    expect(r.status).toBe(200);
    expect(r.body.permissions).toEqual(expect.arrayContaining(["personnel:read:all", "quote:read:all"]));
    expect(r.body.permissions).not.toContain("user:manage");    // admin-tier bị lọc
    expect(r.body.permissions).not.toContain("settings:manage"); // admin-tier bị lọc
    expect(r.body.permissions).not.toContain("garbage:fake");   // key không hợp lệ bị lọc
    // GET /api/users cũng trả effectivePermissions để pre-fill ma trận
    const list = await adminMinA.get("/api/users");
    const row = list.body.find((u) => u.id === target.id);
    expect(row.effectivePermissions).toContain("personnel:read:all");
  });
});
