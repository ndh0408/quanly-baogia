/**
 * RBAC-04 (phần nhật ký) — SỬA MỤC DANH BẠ PHẢI ĐỂ LẠI GIÁ TRỊ TRƯỚC/SAU.
 *
 * Danh bạ nhân viên là kho DÙNG CHUNG có chủ đích (Account sửa được mục người khác thêm). Trước bản
 * vá nhật ký chỉ ghi "employee.update #id": một người đổi số tài khoản ngân hàng của đồng nghiệp,
 * Account khác tạo hồ sơ Nhân sự bằng picker (tự điền số tài khoản), kế toán trả lương vào đó — và
 * không còn giá trị cũ nào để truy. Số tài khoản/CCCD chỉ giữ 4 ký tự cuối trong nhật ký.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import { agentWithCsrf } from "./helpers/agent.js";
import { prisma } from "../src/db.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "User" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") {
  throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");
}

const TAG = `rbdb${Date.now()}`;
const MAT_KHAU = "DanhBa1234!ok";

describe.runIf(dbAvailable)("RBAC-04 — nhật ký employee.update có before/after, che số", () => {
  let app, aU, bU;

  const dangNhap = async (u) => {
    const ag = agentWithCsrf(app);
    expect((await ag.post("/api/auth/login").send({ username: u.username, password: MAT_KHAU })).status).toBe(200);
    return ag;
  };

  beforeAll(async () => {
    app = (await import("../src/app.js")).createApp();
    aU = await prisma.user.create({ data: { username: `${TAG}-a`, displayName: "A", role: "manager", passwordHash: await bcrypt.hash(MAT_KHAU, 4) } });
    bU = await prisma.user.create({ data: { username: `${TAG}-b`, displayName: "B", role: "manager", passwordHash: await bcrypt.hash(MAT_KHAU, 4) } });
  }, 60_000);

  afterAll(async () => {
    const ids = [aU?.id, bU?.id].filter(Boolean);
    await prisma.auditEvent.deleteMany({ where: { actorId: { in: ids } } }).catch(() => {});
    await prisma.employee.deleteMany({ where: { createdById: { in: ids } }, hardDelete: true, includeDeleted: true }).catch(() => {});
    await prisma.loginAttempt.deleteMany({ where: { username: { startsWith: TAG } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true, includeDeleted: true }).catch(() => {});
  });

  it("B đổi số tài khoản mục A thêm → nhật ký có trước/sau của ĐÚNG trường đổi, số bị che", async () => {
    const a = await dangNhap(aU);
    const tao = await a.post("/api/employees").send({ fullName: `${TAG} Nguyễn Văn A`, bankAccount: "0011223344", bankName: "VCB", phone: "0900000001" });
    expect(tao.status, JSON.stringify(tao.body).slice(0, 200)).toBe(201);

    const b = await dangNhap(bU);
    const r = await b.put(`/api/employees/${tao.body.id}`).send({ bankAccount: "9988776655", bankName: "VCB", phone: "0900000001" });
    expect(r.status).toBe(200);

    const nk = await prisma.auditEvent.findFirst({
      where: { action: "employee.update", resourceId: String(tao.body.id) }, orderBy: { id: "desc" },
    });
    expect(nk.before, "nhật ký không có giá trị trước — không truy được ai đổi số tài khoản").toBeTruthy();
    expect(nk.before).toEqual({ bankAccount: "…3344" });
    expect(nk.after).toEqual({ bankAccount: "…6655" });
    // Không nhân bản số đầy đủ vào bảng nhật ký.
    const vet = JSON.stringify({ before: nk.before, after: nk.after });
    expect(vet).not.toContain("0011223344");
    expect(vet).not.toContain("9988776655");
  }, 60_000);
});
