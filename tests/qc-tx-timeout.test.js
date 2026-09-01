// Cụm quote-concurrency — transaction dùng TIMEOUT MẶC ĐỊNH 5s của Prisma.
//
// ── LỖI ─────────────────────────────────────────────────────────────────────
// `src/db.ts` khởi tạo PrismaClient chỉ với `adapter` + `log`, KHÔNG có `transactionOptions`.
// Prisma mặc định `timeout: 5s` / `maxWait: 2s` cho MỌI `$transaction` tương tác.
//
// ── HẬU QUẢ ─────────────────────────────────────────────────────────────────
// Đường LƯU báo giá gói cả việc nặng vào MỘT transaction: xoá sạch sheet → tạo lại toàn bộ item →
// đọc lại cả báo giá qua QUOTE_INCLUDE (kèm cột `images` base64) → `snapshotQuoteVersion` đọc THÊM
// lần nữa rồi ghi một khối jsonb chứa mọi item. Trần payload cho phép 60 trang × 1000 dòng. Báo giá
// đủ lớn thì KHÔNG LƯU ĐƯỢC NỮA: rollback toàn bộ, người dùng mất trắng lần sửa.
//
// ── VÌ SAO BÀI TEST NÀY ĐI QUA `updateQuote` THẬT ───────────────────────────
// Bản trước chỉ chạy `pg_sleep` trong một `$transaction` TRỐNG — nó khẳng định lại đúng dòng cấu
// hình vừa viết và VẪN XANH nếu ai đó sau này truyền `{ timeout: 5000 }` rời rạc tại chính
// `$transaction` của `updateQuote` (option ở lời gọi ĐÈ cấu hình client), tức đúng cái hồi quy mà
// finding này nói tới. Nay câu `pg_sleep` được nhét vào BÊN TRONG transaction của `updateQuote` —
// qua HTTP, qua CSRF, qua Zod — bằng cách bọc `snapshotQuoteVersion` (bước cuối của transaction đó).
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { agentWithCsrf } from "./helpers/agent.js";
import bcrypt from "bcryptjs";
import { prisma } from "../src/db.js";

/** Chèn một câu chờ 6 GIÂY vào ĐÚNG transaction của updateQuote (bước snapshot là bước cuối của nó). */
vi.mock("../src/quoteVersion.js", async (importOriginal) => {
  const that = await importOriginal();
  return {
    ...that,
    snapshotQuoteVersion: async (tx, ...rest) => {
      if (process.env.QC_TX_SLEEP === "1") await tx.$queryRawUnsafe("SELECT 1 FROM pg_sleep(6)");
      return that.snapshotQuoteVersion(tx, ...rest);
    },
  };
});

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "Quote" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");

const TAG = `qctx${Date.now()}`;
const PWD = "Test1234!a";

describe.runIf(dbAvailable)("trần thời gian transaction áp được vào đường LƯU báo giá thật", () => {
  let app, admin, companyId, templateId, quoteId, sheetId;

  beforeAll(async () => {
    const { createApp } = await import("../src/app.js");
    app = createApp();
    const adminU = await prisma.user.create({ data: { username: `${TAG}-admin`, displayName: `${TAG} admin`, role: "admin", passwordHash: await bcrypt.hash(PWD, 4) } });
    const co = await prisma.company.create({ data: { code: `${TAG}CO`, name: "Cty thử", address: "1 Thử", quotePrefix: "QT" } });
    companyId = co.id;
    templateId = (await prisma.quoteTemplate.create({ data: { companyId: co.id, name: "Mẫu thử", code: `${TAG}k`, filePath: "templates/GN_KhongNgay.xlsx" } })).id;
    admin = agentWithCsrf(app);
    expect((await admin.post("/api/auth/login").send({ username: adminU.username, password: PWD })).status).toBe(200);
    const r = await admin.post("/api/quotes").send({
      title: `${TAG} báo giá`, companyId, toCompany: "Khách thử", vatPercent: 8,
      sheets: [{ name: "Trang 1", order: 1, templateId, items: [{ kind: "item", name: "Hạng mục", quantity: 1, unitPrice: 10_000, order: 1 }] }],
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    quoteId = r.body.id;
    sheetId = r.body.sheets[0].id;
  });

  afterAll(async () => {
    delete process.env.QC_TX_SLEEP;
    await prisma.quote.deleteMany({ where: { title: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.quoteTemplate.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.company.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.loginAttempt.deleteMany({ where: { username: { startsWith: TAG } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
  });

  const luu = (soLuong) =>
    admin.put(`/api/quotes/${quoteId}`).send({
      title: `${TAG} đã sửa`,
      sheets: [{ id: sheetId, templateId, name: "Trang 1", order: 1, items: [{ kind: "item", name: "Hạng mục", quantity: soLuong, unitPrice: 10_000, order: 1 }] }],
    });

  it("PUT /api/quotes/:id với transaction chạy 6 giây vẫn LƯU ĐƯỢC (trần mặc định 5s đã nới)", async () => {
    process.env.QC_TX_SLEEP = "1";
    try {
      const r = await luu(2);
      expect(r.status, `trần 5s cắt ngang → P2028, người dùng mất trắng lần sửa. Body: ${JSON.stringify(r.body)}`).toBe(200);
    } finally {
      delete process.env.QC_TX_SLEEP;
    }
    // Ghi thật sự vào CSDL, không chỉ trả 200 rồi rollback.
    const s = await prisma.quoteSheet.findFirst({ where: { quoteId }, orderBy: { order: "asc" } });
    expect(Number(s.subtotal)).toBe(20_000);
  }, 60_000);

  it("lưu bình thường (không chèn chờ) vẫn nhanh và vẫn 200", async () => {
    const r = await luu(3);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
  }, 30_000);
});
