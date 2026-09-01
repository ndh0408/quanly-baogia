// DANH BẠ NHÂN SỰ: quyền `employee:read:own` KHÔNG hề giới hạn phạm vi — chốt hồi quy.
//
// ── LỖI ─────────────────────────────────────────────────────────────────────
// Ô tích trên ma trận phân quyền ghi "Xem danh bạ của mình" / "Xem danh bạ nhân sự MÌNH thêm."
// (src/permissions.ts), nhưng `listEmployees` (src/services/employeeService.ts) dựng
// `const where = {}` — KHÔNG có `createdById` — rồi trả `decodePiiList("Employee", data)`.
// Nghĩa là ai được cấp ĐÚNG ô tích đó cũng đọc được TOÀN BỘ danh bạ, kèm CCCD và SỐ TÀI KHOẢN
// NGÂN HÀNG của mọi người — đúng những trường mà src/piiFields.ts phải mã hoá khi lưu.
//
// Cột `createdById` đã có sẵn và đã được ghi lúc tạo (employeeService.ts:35), nên đây không phải
// chuyện "chưa có dữ liệu chủ sở hữu", mà là quên áp phạm vi lúc đọc.
//
// ── TÁI HIỆN ────────────────────────────────────────────────────────────────
// Cấp cho một tài khoản đúng 2 quyền `employee:read:own` + `employee:create`. Tài khoản đó thêm
// 1 người vào danh bạ; admin thêm 1 người khác. Gọi `GET /api/employees` bằng tài khoản kia:
// trước khi vá trả về CẢ HAI, kèm CCCD/STK của mục do admin thêm.
//
// ── CÁCH VÁ ─────────────────────────────────────────────────────────────────
// `listEmployees` dùng `readScopeWhereOrThrow(session, "employee", "createdById")` (permissions.ts):
//   employee:read:all → `{}` (KHÔNG đổi hành vi của mọi vai trò mặc định — EMPLOYEE/MANAGER/ADMIN
//   đều có :all), employee:read:own → `{ createdById: userId }`, không quyền nào → 403.
//
// ── LỖ THỦNG CÒN LẠI (vòng sau) ─────────────────────────────────────────────
// Chặn mỗi đường LIỆT KÊ là vô nghĩa: `PUT /api/employees/:id` chỉ gác NĂNG LỰC
// `employee:edit:own` ở route rồi trả `decodePiiOnRead("Employee", rec)` — tức BẢN GHI ĐÃ GIẢI MÃ
// của bất kỳ id nào. Body rỗng `{}` vẫn hợp lệ (EmployeeUpdate là `.partial()`) và
// `encodePiiForWrite("Employee", {})` → `{}`, nên `prisma.employee.update({ data: {} })` chạy trót
// lọt. `Employee.id` là autoincrement → đếm 1,2,3… là quét sạch CCCD + số tài khoản toàn công ty,
// đúng thứ vừa chặn ở GET. Vậy PHẠM VI GHI phải KHÔNG rộng hơn PHẠM VI ĐỌC.
//
// Siết theo phạm vi ĐỌC (không phải theo `employee:edit:*`) là chỗ then chốt để KHÔNG đổi hành vi
// production: EMPLOYEE nền — và MANAGER/ADMIN kế thừa — đều có `employee:read:all`
// (src/permissions.ts:266), nên mọi tài khoản Account thật vẫn sửa/xoá chéo được y như cũ. Chỉ tập
// quyền per-user bị bó về "Xem danh bạ của mình" mới mất đường ghi chéo — mà tài khoản đó vốn đã
// không nhìn thấy mục người khác để mà sửa.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { agentWithCsrf } from "./helpers/agent.js";
import bcrypt from "bcryptjs";
import { prisma } from "../src/db.js";
import { PERMISSIONS as P } from "../src/permissions.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "Employee" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");

const TAG = `rbacemp${Date.now()}`;
const PWD = "Test1234!a";
const CCCD_ADMIN = "079123456789";
const STK_ADMIN = "0011002233445";
const CCCD_KHAC = "079555444333";

describe.runIf(dbAvailable)("danh bạ nhân sự: employee:read:own phải giới hạn đúng phạm vi", () => {
  let app, adminU, ownU, allU, nhanVienU, empAdminId, empOwnId, empAdminXoaId, empAdminSuaId;

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
    ownU = await prisma.user.create({ data: { username: `${TAG}-own`, displayName: `${TAG} own`, role: "hr", passwordHash: hash, permissions: [P.EMPLOYEE_READ_OWN, P.EMPLOYEE_CREATE, P.EMPLOYEE_EDIT_OWN, P.EMPLOYEE_DELETE_OWN] } });
    allU = await prisma.user.create({ data: { username: `${TAG}-all`, displayName: `${TAG} all`, role: "hr", passwordHash: hash, permissions: [P.EMPLOYEE_READ_ALL] } });
    // Bản sao ĐÚNG tập quyền của EMPLOYEE nền (permissions.ts:266): read:all + edit/delete:own.
    // Đây là ca ĐỐI CHỨNG cho việc sửa/xoá CHÉO của mọi tài khoản Account thật vẫn phải chạy.
    nhanVienU = await prisma.user.create({ data: { username: `${TAG}-nv`, displayName: `${TAG} nv`, role: "hr", passwordHash: hash, permissions: [P.EMPLOYEE_READ_ALL, P.EMPLOYEE_CREATE, P.EMPLOYEE_EDIT_OWN, P.EMPLOYEE_DELETE_OWN] } });

    const admin = await dangNhap(adminU);
    const a = await admin.post("/api/employees").send({ fullName: `${TAG} Người của admin`, idCard: CCCD_ADMIN, bankAccount: STK_ADMIN, phone: "0900000001" });
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    empAdminId = a.body.id;
    // MỖI ca ghi dùng BẢN GHI RIÊNG: dùng chung thì ca chạy trước (xoá mềm được lúc chưa vá)
    // làm ca sau đỏ vì 404, che mất lỗi thật.
    const a2 = await admin.post("/api/employees").send({ fullName: `${TAG} Người của admin (để xoá)`, idCard: CCCD_KHAC, phone: "0900000003" });
    expect(a2.status, JSON.stringify(a2.body)).toBe(201);
    empAdminXoaId = a2.body.id;
    const a3 = await admin.post("/api/employees").send({ fullName: `${TAG} Người của admin (để sửa chéo)`, idCard: CCCD_KHAC, phone: "0900000004" });
    expect(a3.status, JSON.stringify(a3.body)).toBe(201);
    empAdminSuaId = a3.body.id;

    const own = await dangNhap(ownU);
    const b = await own.post("/api/employees").send({ fullName: `${TAG} Người của mình`, idCard: "079999999999", phone: "0900000002" });
    expect(b.status, JSON.stringify(b.body)).toBe(201);
    empOwnId = b.body.id;
  });

  afterAll(async () => {
    await prisma.employee.deleteMany({ where: { fullName: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.auditEvent.deleteMany({ where: { actorId: { in: [adminU?.id, ownU?.id, allU?.id, nhanVienU?.id].filter(Boolean) } } }).catch(() => {});
    await prisma.loginAttempt.deleteMany({ where: { username: { startsWith: TAG } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
  });

  it("chỉ có employee:read:own → CHỈ thấy mục mình thêm, không lộ CCCD/STK của người khác", async () => {
    const own = await dangNhap(ownU);
    const r = await own.get(`/api/employees?q=${TAG}&size=50`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);

    const ten = r.body.data.map((e) => e.fullName);
    expect(ten, "trước khi vá: thấy cả mục của admin").toEqual([`${TAG} Người của mình`]);

    const s = JSON.stringify(r.body);
    expect(s, "không được lộ CCCD của mục người khác").not.toContain(CCCD_ADMIN);
    expect(s, "không được lộ số tài khoản của mục người khác").not.toContain(STK_ADMIN);
  });

  it("có employee:read:all → vẫn thấy CẢ danh bạ (không chặn nhầm người có quyền thật)", async () => {
    const all = await dangNhap(allU);
    const r = await all.get(`/api/employees?q=${TAG}&size=50`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data.map((e) => e.fullName).sort()).toEqual([
      `${TAG} Người của admin`, `${TAG} Người của admin (để sửa chéo)`, `${TAG} Người của admin (để xoá)`, `${TAG} Người của mình`,
    ]);
    expect(r.body.data.find((e) => e.fullName.endsWith("admin")).idCard, "PII vẫn giải mã đúng cho người có quyền").toBe(CCCD_ADMIN);
  });

  it("admin (employee:read:all qua vai trò) không bị ảnh hưởng", async () => {
    const admin = await dangNhap(adminU);
    const r = await admin.get(`/api/employees?q=${TAG}&size=50`);
    expect(r.status).toBe(200);
    expect(r.body.data.length).toBe(4);
  });

  // ── ĐƯỜNG GHI: phạm vi GHI không được rộng hơn phạm vi ĐỌC ────────────────
  it("chỉ có employee:read:own → PUT mục người khác KHÔNG trả về CCCD/STK và KHÔNG ghi được", async () => {
    const own = await dangNhap(ownU);
    // Body RỖNG: `.partial()` chấp nhận, nên đây thuần tuý là một lời gọi ĐỌC trá hình.
    const r = await own.put(`/api/employees/${empAdminId}`).send({});
    const s = JSON.stringify(r.body);
    expect(s, "trước khi vá: 200 kèm CCCD giải mã của mục người khác").not.toContain(CCCD_ADMIN);
    expect(s, "trước khi vá: 200 kèm số tài khoản giải mã của mục người khác").not.toContain(STK_ADMIN);
    expect(r.status, "ngoài phạm vi đọc thì cũng ngoài phạm vi ghi").toBe(403);

    // Và phải KHÔNG ghi đè gì: gửi luôn tên mới để chắc chắn 403 xảy ra TRƯỚC update.
    const g = await own.put(`/api/employees/${empAdminId}`).send({ fullName: `${TAG} BỊ ĐỔI` });
    expect(g.status).toBe(403);
    const con = await prisma.employee.findFirst({ where: { id: empAdminId }, select: { fullName: true } });
    expect(con?.fullName, "403 mà vẫn ghi thì vô nghĩa").toBe(`${TAG} Người của admin`);
  });

  it("chỉ có employee:read:own → DELETE mục người khác bị chặn, bản ghi còn nguyên", async () => {
    const own = await dangNhap(ownU);
    const r = await own.delete(`/api/employees/${empAdminXoaId}`);
    expect(r.status, "trước khi vá: xoá mềm được mục của người khác").toBe(403);
    const con = await prisma.employee.findFirst({ where: { id: empAdminXoaId }, select: { id: true } });
    expect(con, "bản ghi phải còn").toBeTruthy();
  });

  it("chỉ có employee:read:own → vẫn sửa được mục CỦA MÌNH (không chặn nhầm)", async () => {
    const own = await dangNhap(ownU);
    const r = await own.put(`/api/employees/${empOwnId}`).send({ phone: "0911111111" });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.phone).toBe("0911111111");
  });

  it("tập quyền EMPLOYEE nền (read:all + edit:own) VẪN sửa chéo được — kho dùng chung không đổi", async () => {
    const nv = await dangNhap(nhanVienU);
    const r = await nv.put(`/api/employees/${empAdminSuaId}`).send({ phone: "0922222222" });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.phone).toBe("0922222222");
    expect(r.body.idCard, "có read:all thì vẫn được thấy PII như trước").toBe(CCCD_KHAC);
  });
});
