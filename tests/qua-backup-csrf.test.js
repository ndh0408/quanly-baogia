// Sao lưu toàn bộ CSDL nằm sau một GET — chốt hồi quy CSRF.
//
// ── LỖI ─────────────────────────────────────────────────────────────────────
// `/api/admin/backup.dump` khai bằng `router.get(...)` nhưng thân hàm SPAWN `pg_dump` và ghi một
// hàng audit `admin.backup` — tức GET có side effect. Ba mắt xích ghép lại:
//   • csrfGuard (src/app.ts) bỏ qua VÔ ĐIỀU KIỆN mọi method trong CSRF_SAFE_METHODS (GET/HEAD/OPTIONS);
//   • cookie phiên đặt `sameSite: "lax"`, mà Lax VẪN gửi cookie khi điều hướng top-level cross-site
//     bằng GET (`<a href>`, `location =`, `window.open`);
//   • không frontend nào gọi endpoint này (grep `backup.dump` trong web/src: không có), nên đổi
//     method không làm hỏng màn hình nào.
// Hệ quả: dụ được một tài khoản `settings:manage` bấm vào link lạ là ép được server fork pg_dump và
// đẻ ra hàng audit giả, tới trần 5 lần/15 phút của backupLimiter.
//
// ── KHÔNG NÓI QUÁ ───────────────────────────────────────────────────────────
// Đây KHÔNG phải lỗ rò dữ liệu: repo không bật CORS nên trang tấn công không đọc được nội dung
// phản hồi, và `Content-Disposition: attachment` khiến bản dump rơi vào thư mục Tải về của chính
// admin. Tác hại đo được là ÉP HÀNH ĐỘNG + đốt tài nguyên + làm bẩn nhật ký.
//
// ── CÁCH VÁ ─────────────────────────────────────────────────────────────────
// Đổi sang `router.post(...)`: endpoint thừa hưởng csrfGuard. Client Bearer (`req.viaJwt`) vẫn
// vào được vì csrfGuard chỉ áp cho phiên cookie.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { agentWithCsrf } from "./helpers/agent.js";
import bcrypt from "bcryptjs";
import { prisma } from "../src/db.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "User" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");

const TAG = `quabackup${Date.now()}`;
const PWD = "Test1234!a";

describe.runIf(dbAvailable)("/api/admin/backup.dump: thao tác ghi phải qua cổng CSRF", () => {
  let app, adminU, managerU, admin, manager;

  const dangNhap = async (u) => {
    const a = agentWithCsrf(app);
    expect((await a.post("/api/auth/login").send({ username: u.username, password: PWD })).status).toBe(200);
    return a;
  };

  beforeAll(async () => {
    const { createApp } = await import("../src/app.js");
    app = createApp();
    const hash = await bcrypt.hash(PWD, 4);
    adminU = await prisma.user.create({ data: { username: `${TAG}-admin`, displayName: `${TAG} admin`, role: "admin", passwordHash: hash } });
    managerU = await prisma.user.create({ data: { username: `${TAG}-mgr`, displayName: `${TAG} mgr`, role: "manager", passwordHash: hash } });
    admin = await dangNhap(adminU);
    manager = await dangNhap(managerU);
  });

  afterAll(async () => {
    await prisma.auditEvent.deleteMany({ where: { actorId: { in: [adminU?.id, managerU?.id].filter(Boolean) } } }).catch(() => {});
    await prisma.loginAttempt.deleteMany({ where: { username: { startsWith: TAG } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.$disconnect();
  });

  it("GET (method mà csrfGuard cho qua vô điều kiện) KHÔNG còn chạy sao lưu", async () => {
    const res = await admin.get("/api/admin/backup.dump");
    // 404 = không còn route GET nào khớp. Cố tình KHÔNG chấp nhận 200/500: cả hai đều nghĩa là
    // pg_dump đã được gọi từ một GET.
    expect(res.status).toBe(404);
    expect(await prisma.auditEvent.count({ where: { actorId: adminU.id, action: "admin.backup" } })).toBe(0);
  });

  it("POST không kèm mã CSRF hợp lệ → 403, không chạy pg_dump", async () => {
    // Đặt tay mã sai → helper agent KHÔNG ghi đè (xem tests/helpers/agent.js).
    const res = await admin.post("/api/admin/backup.dump").set("X-CSRF-Token", "sai-be-bet");
    expect(res.status).toBe(403);
    expect(await prisma.auditEvent.count({ where: { actorId: adminU.id, action: "admin.backup" } })).toBe(0);
  });

  it("POST có mã CSRF nhưng thiếu quyền settings:manage → 403 (cổng quyền không đổi)", async () => {
    const res = await manager.post("/api/admin/backup.dump");
    expect(res.status).toBe(403);
  });

  it("ẩn danh → 401", async () => {
    expect((await request(app).post("/api/admin/backup.dump")).status).toBe(401);
  });
});
