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

  // Bản trước của ca này dùng `customer:read:own` với sự kiện trỏ vào khách #1 — KHÔNG phải khách của u —
  // và đòi before/after còn nguyên. Đó chính là đường lộ mà soát chéo files#4 chỉ ra: hạ quyền xuống
  // "Xem khách của mình" vẫn nhận bản chụp khách của NGƯỜI KHÁC. Nay: read:all giữ; read:own chỉ giữ
  // bản chụp của khách do chính mình sở hữu (ca riêng ở describe files#4 bên dưới).
  it("phiên CÒN quyền đọc MỌI khách hàng → giữ nguyên before/after", async () => {
    const out = await exportUser(u.id, { userId: u.id, role: "manager", permissions: ["customer:read:all"] });
    expect(JSON.stringify(out.auditEvents, (_k, v) => (typeof v === "bigint" ? String(v) : v))).toMatch(/Khách Bí Mật/);
  });
});

// Soát chéo files#4 (RBAC-04 × FILE-11): RBAC-04 cho employee.update ghi before/after (SĐT, địa chỉ, MST,
// năm sinh, nơi cấp CCCD… của người trong danh bạ). FILE-11 chỉ che nhật ký resource=customer khi phạm vi
// khách = null. Người đã sửa danh bạ rồi bị gỡ quyền (hoặc hạ xuống "Xem danh bạ của mình") vẫn lấy lại
// bản chụp đó qua GET /api/gdpr/me/export. Cùng lỗ có từ trước với personnel.*-note.
describe.runIf(dbAvailable)("files#4: xuất GDPR kẹp bản chụp nhật ký theo phạm vi đọc HIỆN TẠI của từng nhóm", () => {
  let u, khac, nvKhac, nvMinh, hsKhac, khMinh, khKhac;
  const J = (x) => JSON.stringify(x, (_k, v) => (typeof v === "bigint" ? String(v) : v));
  beforeAll(async () => {
    u = await prisma.user.create({ data: { username: `${TAG}-f4`, displayName: `${TAG} f4`, role: "manager", passwordHash: "x" } });
    khac = await prisma.user.create({ data: { username: `${TAG}-f4k`, displayName: `${TAG} f4k`, role: "manager", passwordHash: "x" } });
    nvKhac = await prisma.employee.create({ data: { fullName: `${TAG} nv khac`, createdById: khac.id } });
    nvMinh = await prisma.employee.create({ data: { fullName: `${TAG} nv minh`, createdById: u.id } });
    hsKhac = await prisma.personnelRecord.create({ data: { fullName: `${TAG} hs khac`, createdById: khac.id } });
    khMinh = await prisma.customer.create({ data: { code: `${TAG}KM`, name: `${TAG} kh minh`, ownerId: u.id } });
    khKhac = await prisma.customer.create({ data: { code: `${TAG}KK`, name: `${TAG} kh khac`, ownerId: khac.id } });
    const ev = (action, resource, resourceId, before, after) =>
      prisma.auditEvent.create({ data: { actorId: u.id, action, resource, resourceId: String(resourceId), before, after } });
    await ev("employee.update", "employee", nvKhac.id, { phone: "0911222333", address: "12 Đường Danh Bạ Khác" }, { phone: "0911222444" });
    await ev("employee.update", "employee", nvMinh.id, { phone: "0977888999" }, { phone: "0977888000" });
    await ev("personnel.team-note", "personnel", hsKhac.id, { teamNote: "Ghi chú hồ sơ khác" }, { teamNote: "Ghi chú hồ sơ khác 2" });
    await ev("customer.update", "customer", khMinh.id, { name: "Khách Của Mình" }, { name: "Khách Của Mình 2" });
    await ev("customer.update", "customer", khKhac.id, { name: "Khách Người Khác" }, { name: "Khách Người Khác 2" });
  });
  afterAll(async () => {
    await prisma.auditEvent.deleteMany({ where: { actorId: u?.id } }).catch(() => {});
    await prisma.employee.deleteMany({ where: { fullName: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.personnelRecord.deleteMany({ where: { fullName: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.customer.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: `${TAG}-f4` } }, hardDelete: true }).catch(() => {});
  });

  it("KHÔNG có employee:read → không còn bản chụp danh bạ nào; hành động + thời điểm vẫn giữ", async () => {
    const out = await exportUser(u.id, { userId: u.id, role: "manager", permissions: [] });
    const s = J(out.auditEvents);
    expect(s, "bản chụp danh bạ lọt qua nhật ký").not.toMatch(/0911222333|Đường Danh Bạ Khác|0977888999/);
    expect(out.auditEvents.filter((e) => e.action === "employee.update")).toHaveLength(2);
  });

  it("employee:read:own → chỉ giữ bản chụp mục danh bạ DO MÌNH TẠO", async () => {
    const out = await exportUser(u.id, { userId: u.id, role: "manager", permissions: ["employee:read:own"] });
    const s = J(out.auditEvents);
    expect(s, "hạ xuống 'Xem danh bạ của mình' vẫn lộ mục của người khác").not.toMatch(/0911222333|Đường Danh Bạ Khác/);
    expect(s).toMatch(/0977888999/);
  });

  it("employee:read:all → giữ nguyên cả hai", async () => {
    const out = await exportUser(u.id, { userId: u.id, role: "manager", permissions: ["employee:read:all"] });
    const s = J(out.auditEvents);
    expect(s).toMatch(/0911222333/);
    expect(s).toMatch(/0977888999/);
  });

  it("personnel.*-note: không có personnel:read → bỏ bản chụp; personnel:read:all → giữ", async () => {
    expect(J((await exportUser(u.id, { userId: u.id, role: "manager", permissions: [] })).auditEvents)).not.toMatch(/Ghi chú hồ sơ khác/);
    expect(J((await exportUser(u.id, { userId: u.id, role: "manager", permissions: ["personnel:read:own"] })).auditEvents)).not.toMatch(/Ghi chú hồ sơ khác/);
    expect(J((await exportUser(u.id, { userId: u.id, role: "manager", permissions: ["personnel:read:all"] })).auditEvents)).toMatch(/Ghi chú hồ sơ khác/);
  });

  it("customer:read:own → giữ khách của mình, bỏ khách người khác", async () => {
    const s = J((await exportUser(u.id, { userId: u.id, role: "manager", permissions: ["customer:read:own"] })).auditEvents);
    expect(s).toMatch(/Khách Của Mình/);
    expect(s).not.toMatch(/Khách Người Khác/);
  });

  it("đường admin (không truyền session) giữ nguyên hành vi: không kẹp gì", async () => {
    const s = J((await exportUser(u.id)).auditEvents);
    expect(s).toMatch(/0911222333/);
    expect(s).toMatch(/Ghi chú hồ sơ khác/);
    expect(s).toMatch(/Khách Người Khác/);
  });
});
