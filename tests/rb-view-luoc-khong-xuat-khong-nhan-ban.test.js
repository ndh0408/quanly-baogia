/**
 * RBAC-06 — VIEW BỊ LƯỢC (quote:internal:view / quote:hn:fill) CHỈ ÁP Ở GET, KHÔNG ÁP Ở XUẤT FILE VÀ
 * NHÂN BẢN.
 *
 * Tài khoản "chi phí" được cấp per-user quote:internal:view + quote:read:all (+ quote:export,
 * quote:create) — tổ hợp mà ma trận cho tích không cảnh báo: GET /:id trả bản lược đúng, nhưng
 * GET /api/export/:id.xlsx|pdf, xuất nền và nhân bản đều trả/tạo báo giá ĐẦY ĐỦ giá bán + khách.
 * Với vai trò mặc định hiện chưa khai thác được (không vai trò nào có tổ hợp này) — đây là lỗ cấu hình.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import { agentWithCsrf } from "./helpers/agent.js";
import { prisma } from "../src/db.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "User" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") {
  throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");
}

const TAG = `rbvl${Date.now()}`;
const MAT_KHAU = "ViewLuoc1234!ok";

describe.runIf(dbAvailable)("RBAC-06 — view lược không xuất, không nhân bản", () => {
  let app, company, template, adminU, luocU, thuongU, admin, luoc, thuong, quoteId;

  const dangNhap = async (u) => {
    const ag = agentWithCsrf(app);
    expect((await ag.post("/api/auth/login").send({ username: u.username, password: MAT_KHAU })).status).toBe(200);
    return ag;
  };

  beforeAll(async () => {
    app = (await import("../src/app.js")).createApp();
    company = await prisma.company.create({ data: { code: `${TAG}-co`, name: "Co", address: "x", quotePrefix: "VL" } });
    template = await prisma.quoteTemplate.create({ data: { code: `${TAG}-tpl`, name: "T", companyId: company.id, filePath: "templates/Unibenfood.xlsx" } });
    const mk = await bcrypt.hash(MAT_KHAU, 4);
    adminU = await prisma.user.create({ data: { username: `${TAG}-ad`, displayName: "Ad", role: "admin", passwordHash: mk } });
    const quyen = ["quote:read:all", "quote:export", "quote:create"];
    luocU = await prisma.user.create({ data: { username: `${TAG}-luoc`, displayName: "L", role: "manager", passwordHash: mk, permissions: [...quyen, "quote:internal:view"] } });
    thuongU = await prisma.user.create({ data: { username: `${TAG}-thuong`, displayName: "T", role: "manager", passwordHash: mk, permissions: quyen } });
    admin = await dangNhap(adminU);
    luoc = await dangNhap(luocU);
    thuong = await dangNhap(thuongU);
    const r = await admin.post("/api/quotes").send({
      title: `${TAG} bg`, toCompany: "Khách bí mật", companyId: company.id, vatPercent: 8,
      sheets: [{ templateId: template.id, items: [{ name: "A", quantity: 1, unitPrice: 12_345_000 }] }],
    });
    expect(r.status).toBe(201);
    quoteId = r.body.id;
  }, 60_000);

  afterAll(async () => {
    const ids = [adminU?.id, luocU?.id, thuongU?.id].filter(Boolean);
    await prisma.auditEvent.deleteMany({ where: { actorId: { in: ids } } }).catch(() => {});
    await prisma.quote.deleteMany({ where: { title: { startsWith: TAG } }, hardDelete: true, includeDeleted: true }).catch(() => {});
    await prisma.loginAttempt.deleteMany({ where: { username: { startsWith: TAG } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true, includeDeleted: true }).catch(() => {});
    await prisma.quoteTemplate.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.company.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
  });

  it("tiền đề: GET chi tiết của tài khoản lược KHÔNG có tổng/giá bán", async () => {
    const r = await luoc.get(`/api/quotes/${quoteId}`);
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.body)).not.toContain("12345000");
  });

  it("xuất xlsx / pdf / xuất nền → 403", async () => {
    expect((await luoc.get(`/api/export/${quoteId}.xlsx`)).status, "tải được Excel đầy đủ giá bán").toBe(403);
    expect((await luoc.get(`/api/export/${quoteId}.pdf`)).status).toBe(403);
    expect((await luoc.post(`/api/quotes/${quoteId}/export`).send({ format: "xlsx" })).status).toBe(403);
  });

  // Hồi quy do gộp RBAC-06 × RT-02 (soát chéo 2026-09-23): route MỚI GET /api/jobs/:queue/:id/file
  // phát thẳng file đầy đủ giá qua cùng origin; job id của BullMQ tăng dần nên dò được job của người khác.
  it.runIf(!!process.env.REDIS_URL && !!process.env.S3_ENDPOINT)("job xuất nền của NGƯỜI KHÁC: trạng thái + /file → 403 cho tài khoản lược; tài khoản thường vẫn xem được", async () => {
    const x = await admin.post(`/api/quotes/${quoteId}/export`).send({ format: "xlsx" });
    expect(x.status, JSON.stringify(x.body)).toBe(202);
    const jid = x.body.jobId;
    expect((await luoc.get(`/api/jobs/export/${jid}`)).status, "đọc được trạng thái/khoá file của job").toBe(403);
    expect((await luoc.get(`/api/jobs/export/${jid}/file`)).status, "tải được file đầy đủ giá").toBe(403);
    expect((await thuong.get(`/api/jobs/export/${jid}`)).status).toBe(200);
  }, 60_000);

  it("nhân bản → 403; vế đối trọng: tài khoản cùng quyền nhưng KHÔNG lược thì nhân bản được", async () => {
    expect((await luoc.post(`/api/quotes/${quoteId}/duplicate`).send({})).status, "nhân bản ra bản sao đầy đủ của mình").toBe(403);
    expect((await thuong.post(`/api/quotes/${quoteId}/duplicate`).send({})).status).toBe(201);
  }, 60_000);
});
