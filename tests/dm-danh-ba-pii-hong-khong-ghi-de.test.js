// Hồi quy do GỘP FILE-12 × RBAC-04 (soát chéo 2026-09-23, P1 — mất dữ liệu).
//
// FILE-12 cho danh sách Danh bạ trả hàng có bản mã PII hỏng (khoá cũ gỡ sớm, byte hỏng) với
// idCard/bankAccount = null + cờ piiLoi, thay vì 500 cả trang. Form Sửa lấy giá trị từ chính hàng đó
// và gửi NGUYÊN form → idCard:"" / bankAccount:"" → null. updateEmployee trước bản vá GHI trước
// (encodePiiForWrite null → xoá bản mã) rồi mới giải mã `before` cho nhật ký RBAC-04 — ném 500 SAU
// khi lệnh ghi đã commit. Bản mã DUY NHẤT (khôi phục được nếu đặt lại khoá cũ) mất vĩnh viễn, nhật ký
// không ghi gì. Nay: giải mã `before` TRƯỚC, trong cùng transaction; không giải mã được → 409, không
// ghi byte nào.
process.env.PII_ENC_KEY ||= "khoa-test-hop-dong-du-dai-cho-hkdf-0123456789";

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import { agentWithCsrf } from "./helpers/agent.js";

const { encryptPii } = await import("../src/piiBox.js");
const { prisma } = await import("../src/db.js");

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "Employee" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");

describe.runIf(dbAvailable)("PUT /api/employees/:id trên hàng có bản mã PII hỏng", () => {
  const TAG = `dmhong${Date.now()}`;
  const PWD = "Test1234!a";
  const HONG = "pii:v1:AAAA";
  let admin, u, hong, tot;

  beforeAll(async () => {
    const { createApp } = await import("../src/app.js");
    const app = createApp();
    u = await prisma.user.create({ data: { username: `${TAG}-a`, displayName: TAG, role: "admin", passwordHash: await bcrypt.hash(PWD, 4) } });
    admin = agentWithCsrf(app);
    expect((await admin.post("/api/auth/login").send({ username: u.username, password: PWD })).status).toBe(200);
    hong = await prisma.employee.create({ data: { createdById: u.id, fullName: `${TAG} hong`, piiVersion: 1, idCardEnc: HONG, bankAccountEnc: HONG } });
    tot = await prisma.employee.create({
      data: { createdById: u.id, fullName: `${TAG} tot`, piiVersion: 1, idCardEnc: encryptPii("079123456789", "Employee:idCard"), bankAccountEnc: encryptPii("0123456789", "Employee:bankAccount") },
    });
  });
  afterAll(async () => {
    await prisma.employee.deleteMany({ where: { fullName: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.auditEvent.deleteMany({ where: { actorId: u?.id } }).catch(() => {});
    await prisma.loginAttempt.deleteMany({ where: { username: { startsWith: TAG } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
  });

  it("gửi lại form (CCCD/STK trống như giao diện đang hiện) → 409 và bản mã KHÔNG bị ghi đè", async () => {
    const r = await admin.put(`/api/employees/${hong.id}`).send({ fullName: `${TAG} hong`, idCard: "", bankAccount: "", phone: "0900000000" });
    expect(r.status, JSON.stringify(r.body)).toBe(409);
    const sau = await prisma.employee.findUnique({ where: { id: hong.id } });
    expect(sau.idCardEnc, "bản mã CCCD bị xoá").toBe(HONG);
    expect(sau.bankAccountEnc, "bản mã STK bị xoá").toBe(HONG);
    expect(sau.phone, "không được ghi nửa chừng").toBeNull();
  });

  it("hàng đọc được vẫn sửa bình thường và nhật ký có trước/sau (RBAC-04 còn nguyên)", async () => {
    const r = await admin.put(`/api/employees/${tot.id}`).send({ fullName: `${TAG} tot`, phone: "0911111111" });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.idCard).toBe("079123456789");
    const nk = await prisma.auditEvent.findFirst({ where: { action: "employee.update", resourceId: String(tot.id) }, orderBy: { id: "desc" } });
    expect(nk, "thiếu dòng nhật ký").toBeTruthy();
    expect(JSON.stringify(nk.after)).toMatch(/0911111111/);
  });
});
