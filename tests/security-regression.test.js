// Hồi quy BẢO MẬT ở mức HTTP — bắn request THẬT vào app qua supertest, đúng như kẻ tấn công gõ
// thẳng API (không qua giao diện). Mỗi khối dưới đây khoá lại một lỗ đã được vá; nếu ai đó nới lại
// cổng quyền thì test này phải đỏ.
//
// Cần Postgres + schema. Máy dev không có DB thì tự bỏ qua; CI đặt REQUIRE_DB_TESTS=1 để BẮT BUỘC chạy.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { agentWithCsrf } from "./helpers/agent.js";
import bcrypt from "bcryptjs";
import { prisma } from "../src/db.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "User" LIMIT 1')
  .then(() => true)
  .catch(() => false);

if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") {
  throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres/schema — hồi quy bảo mật không được phép skip trong CI");
}

const TAG = `sec${Date.now()}`;
const PASSWORD = "Test1234!a";

describe.runIf(dbAvailable)("hồi quy bảo mật — phân quyền ở server (integration)", () => {
  let app, company, template;
  const U = {};   // bản ghi user
  const A = {};   // supertest agent (phiên cookie)

  /**
   * `permissions` KHÔNG rỗng → đó là TẬP QUYỀN HIỆU LỰC của tài khoản, thay hẳn quyền mặc định của
   * vai trò (resolveUserPermissions). Đây là cách dựng "người dùng bị gỡ sạch quyền" — kịch bản
   * thật khi giám đốc bỏ tick trong trang Phân quyền.
   */
  async function makeUser(key, role, permissions) {
    U[key] = await prisma.user.create({
      data: {
        username: `${TAG}-${key}`,
        displayName: `${TAG} ${key}`,
        email: `${TAG}-${key}@example.test`,
        role,
        ...(permissions ? { permissions } : {}),
        passwordHash: await bcrypt.hash(PASSWORD, 4),
      },
    });
    A[key] = agentWithCsrf(app);
    const res = await A[key].post("/api/auth/login").send({ username: U[key].username, password: PASSWORD });
    expect(res.status, `đăng nhập ${key}`).toBe(200);
    return U[key];
  }

  const quotePayload = (over = {}) => ({
    title: `${TAG} báo giá`,
    toCompany: "Khách Test",
    companyId: company.id,
    vatPercent: 8,
    sheets: [{ templateId: template.id, items: [{ name: "Hạng mục", quantity: 1, unitPrice: 1_000_000 }] }],
    ...over,
  });

  beforeAll(async () => {
    const { createApp } = await import("../src/app.js");
    app = createApp();

    company = await prisma.company.create({
      data: { code: `${TAG}-co`, name: `${TAG} Co`, address: "1 Test St", quotePrefix: "SC" },
    });
    template = await prisma.quoteTemplate.create({
      data: { code: `${TAG}-tpl`, name: `${TAG} Tpl`, companyId: company.id, filePath: "templates/Unibenfood.xlsx" },
    });

    await makeUser("admin", "admin");
    await makeUser("manager", "manager");
    await makeUser("hr", "hr");
    await makeUser("accountant", "accountant");
    await makeUser("hn", "account_hn");
    // "Người bị tước quyền": vai trò manager nhưng tập quyền hiệu lực chỉ còn một quyền vô hại.
    // Họ VẪN là người tạo báo giá + chủ khách hàng bên dưới → đúng kịch bản Finding B/C/E.
    await makeUser("stripped", "manager", ["venue:read"]);
    // Chỉ TẠO được báo giá, KHÔNG đọc được — chứng minh create không suy ra read.
    await makeUser("creator", "manager", ["quote:create"]);
  });

  afterAll(async () => {
    // Dọn theo thứ tự phụ thuộc khoá ngoại; hardDelete để không để lại rác xoá-mềm.
    const ids = Object.values(U).map((u) => u.id);
    await prisma.quote.deleteMany({ where: { createdById: { in: ids } }, hardDelete: true }).catch(() => {});
    await prisma.customer.deleteMany({ where: { ownerId: { in: ids } }, hardDelete: true }).catch(() => {});
    await prisma.auditEvent.deleteMany({ where: { actorId: { in: ids } } }).catch(() => {});
    await prisma.loginAttempt.deleteMany({ where: { username: { startsWith: TAG } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.quoteTemplate.deleteMany({ where: { code: `${TAG}-tpl` }, hardDelete: true }).catch(() => {});
    await prisma.company.deleteMany({ where: { code: `${TAG}-co` }, hardDelete: true }).catch(() => {});
  });

  // ── AUTH-001: tạo báo giá phải có quote:create ─────────────────────────────
  describe("AUTH-001 — POST /api/quotes đòi quote:create", () => {
    it("ẩn danh → 401", async () => {
      const res = await request(app).post("/api/quotes").send(quotePayload());
      expect(res.status).toBe(401);
    });

    it.each(["hr", "accountant", "hn", "stripped"])("%s → 403", async (who) => {
      const res = await A[who].post("/api/quotes").send(quotePayload());
      expect(res.status).toBe(403);
    });

    it.each(["admin", "manager", "creator"])("%s → 201", async (who) => {
      const res = await A[who].post("/api/quotes").send(quotePayload());
      expect(res.status).toBe(201);
      expect(res.body.id).toBeTruthy();
    });
  });

  // ── AUTH-002: danh sách báo giá — không quyền đọc thì KHÔNG thấy gì, kể cả của mình ──
  describe("AUTH-002 — GET /api/quotes: 'không có :all' KHÔNG suy ra ':own'", () => {
    let strippedQuoteId;

    beforeAll(async () => {
      // Người này TỪNG tạo báo giá (lúc còn quyền) → tạo hộ bằng đường DB để mô phỏng lịch sử.
      const q = await prisma.quote.create({
        data: {
          quoteNumber: `${TAG}-Q1`, title: `${TAG} của người bị tước quyền`, toCompany: "KH Mật",
          companyId: company.id, fromContact: "x", fromAddress: "y", city: "HCM",
          quoteDate: new Date(), vatPercent: 8, subtotal: 1000, vat: 80, discount: 0, total: 1080,
          status: "draft", createdById: U.stripped.id,
          members: { connect: [{ id: U.stripped.id }, { id: U.hr.id }] },   // hr là THÀNH VIÊN
        },
      });
      strippedQuoteId = q.id;
    });

    it("người bị tước quyền → 403 (trước đây: 200 kèm chính báo giá của họ)", async () => {
      const res = await A.stripped.get("/api/quotes");
      expect(res.status).toBe(403);
    });

    it("hr là THÀNH VIÊN của báo giá vẫn → 403 (rò metadata qua tư cách thành viên)", async () => {
      const res = await A.hr.get("/api/quotes");
      expect(res.status).toBe(403);
    });

    it("chỉ có quote:create, không có quyền đọc → 403", async () => {
      const res = await A.creator.get("/api/quotes");
      expect(res.status).toBe(403);
    });

    it("manager → 200 và KHÔNG thấy báo giá của người khác", async () => {
      const res = await A.manager.get("/api/quotes");
      expect(res.status).toBe(200);
      expect(res.body.data.some((r) => r.id === strippedQuoteId)).toBe(false);
    });

    it("admin → 200 và thấy được", async () => {
      const res = await A.admin.get("/api/quotes");
      expect(res.status).toBe(200);
      expect(res.body.data.some((r) => r.id === strippedQuoteId)).toBe(true);
    });

    it("đọc 1 báo giá của người khác → 403 (IDOR)", async () => {
      const res = await A.manager.get(`/api/quotes/${strippedQuoteId}`);
      expect(res.status).toBe(403);
    });
  });

  // ── AUTH-003: danh sách khách hàng ────────────────────────────────────────
  describe("AUTH-003 — GET /api/customers: không quyền đọc → 403, không phải 200-rỗng", () => {
    beforeAll(async () => {
      await prisma.customer.create({
        data: { code: `${TAG}-KH1`, name: `${TAG} Khách`, ownerId: U.stripped.id, phone: "0900000000" },
      });
    });

    it.each(["hr", "accountant", "hn", "stripped"])("%s → 403", async (who) => {
      const res = await A[who].get("/api/customers");
      expect(res.status).toBe(403);
    });

    it("manager (customer:read:all) → 200", async () => {
      const res = await A.manager.get("/api/customers");
      expect(res.status).toBe(200);
    });
  });

  // ── AUTH-004: tìm kiếm toàn cục phân quyền theo từng domain ───────────────
  describe("AUTH-004 — GET /api/search phân quyền theo domain", () => {
    it("hr hỏi product → KHÔNG có nhóm products, ghi nhận trong denied", async () => {
      const res = await A.hr.get("/api/search").query({ q: TAG, types: "product" });
      expect(res.status).toBe(200);
      expect(res.body.results.products).toBeUndefined();
      expect(res.body.denied).toContain("product");
    });

    it("hr hỏi cả 3 domain → không nhóm nào lọt", async () => {
      const res = await A.hr.get("/api/search").query({ q: TAG, types: "quote,customer,product" });
      expect(res.status).toBe(200);
      expect(res.body.results.quotes).toBeUndefined();
      expect(res.body.results.customers).toBeUndefined();
      expect(res.body.results.products).toBeUndefined();
      expect(res.body.denied.sort()).toEqual(["customer", "product", "quote"]);
    });

    it("người bị tước quyền → không thấy báo giá/khách của CHÍNH MÌNH qua search", async () => {
      const res = await A.stripped.get("/api/search").query({ q: TAG, types: "quote,customer" });
      expect(res.status).toBe(200);
      expect(res.body.results.quotes).toBeUndefined();
      expect(res.body.results.customers).toBeUndefined();
    });

    it("manager → có nhóm quotes + customers", async () => {
      const res = await A.manager.get("/api/search").query({ q: TAG, types: "quote,customer" });
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.results.quotes)).toBe(true);
      expect(Array.isArray(res.body.results.customers)).toBe(true);
      expect(res.body.denied).toEqual([]);
    });
  });

  // ── AUTH-005: trang Quản lý dự án ─────────────────────────────────────────
  describe("AUTH-005 — GET /api/quotes/projects", () => {
    it.each(["hr", "stripped"])("%s → 403", async (who) => {
      const res = await A[who].get("/api/quotes/projects");
      expect(res.status).toBe(403);
    });

    it("manager → 200 (phạm vi own)", async () => {
      const res = await A.manager.get("/api/quotes/projects");
      expect(res.status).toBe(200);
    });
  });

  // ── AUTH-006: số liệu kinh doanh ──────────────────────────────────────────
  describe("AUTH-006 — /api/analytics đòi quyền ĐỌC, không chỉ quyền tạo", () => {
    it("hr → 403 (không có quote:create)", async () => {
      expect((await A.hr.get("/api/analytics/overview")).status).toBe(403);
    });
    it("chỉ có quote:create → 403 (tạo được ≠ xem được doanh số)", async () => {
      for (const p of ["/overview", "/revenue-by-day", "/top-sales", "/funnel"]) {
        const res = await A.creator.get(`/api/analytics${p}`);
        expect(res.status, p).toBe(403);
      }
    });
    it("manager → 200", async () => {
      expect((await A.manager.get("/api/analytics/overview")).status).toBe(200);
    });
  });

  // ── GOV-001: tài khoản khẩn cấp không được ẩn ─────────────────────────────
  describe("GOV-001 — không tài khoản nào bị ẩn khỏi danh sách nhân viên", () => {
    it("admin thấy ĐỦ mọi tài khoản test, mỗi dòng có cờ breakGlass", async () => {
      const res = await A.admin.get("/api/users");
      expect(res.status).toBe(200);
      const names = res.body.map((u) => u.username);
      for (const u of Object.values(U)) expect(names).toContain(u.username);
      expect(res.body.every((u) => "breakGlass" in u)).toBe(true);
    });

    it("không tài khoản nào trong DB bị lọc ngầm khỏi kết quả", async () => {
      // So SỐ LƯỢNG là sai: vitest chạy các file test song song, file khác có thể tạo/xoá user xen
      // vào giữa hai truy vấn → đỏ giả. Kiểm đúng thứ cần kiểm: mọi user CÓ trong DB đều CÓ trong
      // response (đó chính là hành vi mà bộ lọc ẩn cũ vi phạm).
      const before = await prisma.user.findMany({ select: { id: true } });
      const res = await A.admin.get("/api/users");
      const after = await prisma.user.findMany({ select: { id: true } });
      const returned = new Set(res.body.map((u) => u.id));
      // Chỉ xét user tồn tại ở CẢ hai mốc → loại bỏ user do test song song tạo/xoá giữa chừng.
      const afterIds = new Set(after.map((u) => u.id));
      const stable = before.filter((u) => afterIds.has(u.id)).map((u) => u.id);
      const missing = stable.filter((id) => !returned.has(id));
      expect(missing).toEqual([]);
    });
  });

  // ── FILE-001: upload trực tiếp phải khai kích thước ───────────────────────
  describe("FILE-001 — POST /api/files/sign-upload ràng buộc kích thước", () => {
    it("thiếu size → 400", async () => {
      const res = await A.manager.post("/api/files/sign-upload").send({ contentType: "image/png" });
      expect(res.status).toBe(400);
    });
    it("size vượt 10MB → 400", async () => {
      const res = await A.manager.post("/api/files/sign-upload").send({ contentType: "image/png", size: 11 * 1024 * 1024 });
      expect(res.status).toBe(400);
    });
    it("kiểu ngoài allowlist → 400", async () => {
      const res = await A.manager.post("/api/files/sign-upload").send({ contentType: "text/html", size: 100 });
      expect(res.status).toBe(400);
    });
    it("finalize key ngoài namespace của mình → 403", async () => {
      const res = await A.manager.post("/api/files/finalize").send({ key: `uploads/u${U.admin.id}/x.png` });
      expect(res.status).toBe(403);
    });
  });

  // ── ADM-001: sao lưu CSDL ─────────────────────────────────────────────────
  describe("ADM-001 — /api/admin/backup.dump", () => {
    it.each(["manager", "hr", "accountant", "hn"])("%s → 403", async (who) => {
      const res = await A[who].get("/api/admin/backup.dump");
      expect(res.status).toBe(403);
    });
    it("ẩn danh → 401", async () => {
      expect((await request(app).get("/api/admin/backup.dump")).status).toBe(401);
    });
  });

  // ── GDPR-001: bản xuất PII không được cache ───────────────────────────────
  describe("GDPR-001 — bản xuất PII gắn no-store", () => {
    it("GET /api/gdpr/me/export → Cache-Control: no-store + nosniff", async () => {
      const res = await A.manager.get("/api/gdpr/me/export");
      expect(res.status).toBe(200);
      expect(res.headers["cache-control"]).toContain("no-store");
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
    });
    it("người khác không xuất hộ được", async () => {
      const res = await A.manager.get(`/api/gdpr/users/${U.admin.id}/export`);
      expect(res.status).toBe(403);
    });
  });
});
