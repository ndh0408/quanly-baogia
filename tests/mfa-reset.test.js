// GỠ MFA HỘ — đường phục hồi cho người mất cả điện thoại lẫn mã dự phòng.
//
// ── LỖI ĐƯỢC ĐÓNG ───────────────────────────────────────────────────────────
// Cổng MFA ở `/auth/accept-invite` (src/services/authService.ts) là ĐÚNG về bảo mật: ai chiếm được
// hộp thư nạn nhân không được phép vô hiệu hoá lớp thứ hai mà nạn nhân đã chủ động bật. Nhưng cộng
// với `POST /api/mfa/disable` — vốn đòi đúng một mã TOTP hoặc một mã dự phòng — nó tạo ra một cái
// bẫy không lối ra: mã dự phòng chỉ hiện MỘT LẦN lúc bật, `UserUpdateSchema` không nhận trường MFA
// nào, nên người mất điện thoại và không còn giữ mã dự phòng mất tài khoản VĨNH VIỄN. Trước bản
// này, cách duy nhất là chạy SQL tay trên Postgres production. Chú thích trong
// tests/authsess-web-mfa-recovery.test.js tự thừa nhận điều đó nhưng chỉ vá phía giao diện.
//
// ── VÌ SAO ĐÂY KHÔNG PHẢI LỖ MỚI ────────────────────────────────────────────
// Endpoint đòi `user:manage` — đúng nhóm đã đặt lại được mật khẩu của người khác qua
// `PUT /api/users/:id` (`UserUpdateSchema.password`). Nó không mở thêm quyền nào cho ai; nó chỉ đưa
// một thao tác vốn phải làm bằng SQL tay vào trong hệ thống, nơi có kiểm quyền và có nhật ký.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { agentWithCsrf } from "./helpers/agent.js";
import bcrypt from "bcryptjs";
import { prisma } from "../src/db.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "User" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") {
  throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");
}

const TAG = `mfar${Date.now()}`;
const PASSWORD = "Test1234!a";

describe.runIf(dbAvailable)("POST /api/users/:id/mfa-reset", () => {
  let app, adminA, nhanVienA;
  let admin, keToan, nguoiThuong;

  const mk = async (role, label, extra = {}) =>
    prisma.user.create({
      data: {
        username: `${TAG}-${label}`, displayName: `${TAG} ${label}`, role,
        passwordHash: await bcrypt.hash(PASSWORD, 4), ...extra,
      },
    });
  const login = async (agent, u) => {
    const r = await agent.post("/api/auth/login").send({ username: u.username, password: PASSWORD });
    expect(r.status, `đăng nhập ${u.username} hỏng`).toBe(200);
  };

  beforeAll(async () => {
    app = (await import("../src/app.js")).createApp();
    admin = await mk("admin", "admin");
    // Kế toán đã bật MFA và — đúng kịch bản đời thật — không còn mã dự phòng nào.
    keToan = await mk("accountant", "ketoan", {
      mfaEnabled: true, mfaSecret: "JBSWY3DPEHPK3PXP", mfaBackupCodes: [], mfaLastStep: 12345,
    });
    nguoiThuong = await mk("manager", "thuong");
    adminA = agentWithCsrf(app); nhanVienA = agentWithCsrf(app);
    await login(adminA, admin);
    await login(nhanVienA, nguoiThuong);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true });
  });

  it("người có user:manage gỡ được MFA, và bí mật lẫn mã dự phòng bị xoá sạch", async () => {
    const r = await adminA.post(`/api/users/${keToan.id}/mfa-reset`);
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);

    const sau = await prisma.user.findUnique({
      where: { id: keToan.id },
      select: { mfaEnabled: true, mfaSecret: true, mfaBackupCodes: true, mfaLastStep: true },
    });
    expect(sau.mfaEnabled).toBe(false);
    // Bí mật phải MẤT HẲN, không chỉ hạ cờ: giữ lại thì bật lại lần sau dùng đúng bí mật cũ mà
    // người dùng không còn kiểm soát (điện thoại đã mất có thể vẫn còn trong tay ai đó).
    expect(sau.mfaSecret).toBeNull();
    expect(sau.mfaBackupCodes).toEqual([]);
    // `mfaLastStep` về null cùng lý do như POST /api/mfa/disable — xem chú thích ở mfaService.
    expect(sau.mfaLastStep).toBeNull();
  });

  it("sau khi gỡ, người đó đăng nhập lại được BẰNG MẬT KHẨU, không bị hỏi mã", async () => {
    const a = agentWithCsrf(app);
    const r = await a.post("/api/auth/login").send({ username: keToan.username, password: PASSWORD });
    expect(r.status, "gỡ MFA rồi mà vẫn không vào được thì đường phục hồi vô nghĩa").toBe(200);
  });

  it("gỡ lần hai → 400 (tài khoản chưa bật MFA), không im lặng báo thành công", async () => {
    const r = await adminA.post(`/api/users/${keToan.id}/mfa-reset`);
    expect(r.status).toBe(400);
  });

  it("người KHÔNG có user:manage bị từ chối", async () => {
    const nanNhan = await mk("accountant", "nannhan", { mfaEnabled: true, mfaSecret: "JBSWY3DPEHPK3PXP" });
    const r = await nhanVienA.post(`/api/users/${nanNhan.id}/mfa-reset`);
    expect(r.status).toBe(403);
    const sau = await prisma.user.findUnique({ where: { id: nanNhan.id }, select: { mfaEnabled: true } });
    expect(sau.mfaEnabled, "bị từ chối rồi mà cờ vẫn đổi").toBe(true);
  });

  it("tài khoản không tồn tại → 404", async () => {
    const r = await adminA.post(`/api/users/999999999/mfa-reset`);
    expect(r.status).toBe(404);
  });

  it("ghi nhật ký kiểm toán — thao tác này phải truy được ai làm, lúc nào", async () => {
    const ev = await prisma.auditEvent.findFirst({
      where: { action: "user.mfa.reset", resourceId: String(keToan.id) },
      orderBy: { id: "desc" },
    });
    expect(ev, "không có bản ghi kiểm toán nào cho user.mfa.reset").toBeTruthy();
    expect(ev.actorId).toBe(admin.id);
  });
});
