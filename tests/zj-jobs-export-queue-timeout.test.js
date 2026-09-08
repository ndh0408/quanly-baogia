// POST /api/quotes/:id/export và GET /api/jobs/:queue/:id PHẢI CÓ TRẦN THỜI GIAN cho lệnh Redis —
// chốt hồi quy (ultracode audit 2026-09-09, finding H4).
//
// ── LỖI ──────────────────────────────────────────────────────────────────────
// `src/routes/jobs.routes.ts` gọi THẲNG `q.add`/`job.getState`/`job.remove`/`q.getJob`, không qua
// `xepViecCoHan` như `notifications.ts`/`webhooks.ts` đã dùng cho đúng lớp lỗi "Redis chạy nhưng
// chết" (TCP còn mở, lệnh không hồi đáp — `maxRetriesPerRequest: null` khiến lệnh đó TREO VÔ HẠN,
// không tự thất bại). Request xuất/poll vì thế có thể treo mãi.
//
// ⚠️ CÙNG BẪY ĐÃ GHI TRONG tests/zh-queue-add-timeout.test.js: nếu để `getQueue` dựng kết nối Redis
// THẬT trên máy không có Redis, lệnh lỗi ECONNREFUSED NGAY LẬP TỨC — bài sẽ xanh dù gỡ sạch trần
// đang muốn kiểm. Bài này vì vậy mock hẳn "../src/queue.js": `getQueue` trả về một hàng đợi GIẢ mà
// mọi lệnh treo VĨNH VIỄN (mô phỏng đúng "TCP mở, không hồi đáp"), còn `xepViecCoHan` giữ NGUYÊN
// bản THẬT (qua `importOriginal`) — để bài chứng minh chính CƠ CHẾ THẬT được NỐI vào route, không
// phải một double tự chế trong bài test.
process.env.QUEUE_ADD_TIMEOUT_MS = "150"; // đọc lúc nạp module — đặt TRƯỚC mọi import động bên dưới.

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import bcrypt from "bcryptjs";
import { agentWithCsrf } from "./helpers/agent.js";

const hangQueue = { add: () => new Promise(() => {}), getJob: () => new Promise(() => {}) };

vi.mock("../src/queue.js", async (importOriginal) => {
  const that = await importOriginal();
  return { ...that, isQueueEnabled: () => true, getQueue: () => hangQueue };
});

const { prisma } = await import("../src/db.js");

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "Quote" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");

const TAG = `zjjobs${Date.now()}`;
const PWD = "Test1234!a";

describe.runIf(dbAvailable)("jobs.routes.ts — Redis chạy-nhưng-chết không được treo request (integration)", () => {
  let app, mgr, quoteId;

  beforeAll(async () => {
    const { createApp } = await import("../src/app.js");
    app = createApp();
    const u = await prisma.user.create({ data: { username: `${TAG}-mgr`, displayName: `${TAG} mgr`, role: "manager", passwordHash: await bcrypt.hash(PWD, 4) } });
    mgr = agentWithCsrf(app);
    expect((await mgr.post("/api/auth/login").send({ username: u.username, password: PWD })).status).toBe(200);

    const co = await prisma.company.create({ data: { code: `${TAG}CO`, name: "Cty thử", address: "1 Thử", quotePrefix: `Q${TAG.slice(-5)}` } });
    const q = await prisma.quote.create({ data: {
      quoteNumber: `${TAG}-1`, title: `${TAG} bg`, searchText: TAG, toCompany: "Khách",
      companyId: co.id, fromContact: "x", fromAddress: "x", city: "TP. Hồ Chí Minh",
      quoteDate: new Date(), createdById: u.id, status: "draft", subtotal: 0, total: 0,
    } });
    quoteId = q.id;
  });

  afterAll(async () => {
    await prisma.quote.deleteMany({ where: { quoteNumber: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.company.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
  });

  it("POST /quotes/:id/export: Redis treo mãi → 503 quanh mốc trần, KHÔNG treo request", async () => {
    const t0 = Date.now();
    const r = await mgr.post(`/api/quotes/${quoteId}/export`);
    const ms = Date.now() - t0;
    expect(r.status, JSON.stringify(r.body)).toBe(503);
    expect(r.body.code).toBe("export_async_unavailable");
    // Phải trả lời QUANH mốc QUEUE_ADD_TIMEOUT_MS=150ms — không phải đợi test timeout (20s).
    expect(ms, `phải trả lời quanh 150ms, đo được ${ms}ms`).toBeLessThan(5_000);
  });

  it("GET /jobs/export/:id: Redis treo mãi → 404 (kèm gợi ý Redis) quanh mốc trần, KHÔNG treo request", async () => {
    const t0 = Date.now();
    const r = await mgr.get("/api/jobs/export/999");
    const ms = Date.now() - t0;
    expect(r.status, JSON.stringify(r.body)).toBe(404);
    expect(String(r.body.error)).toMatch(/redis|chậm|mất kết nối/i);
    expect(ms, `phải trả lời quanh 150ms, đo được ${ms}ms`).toBeLessThan(5_000);
  });
});
