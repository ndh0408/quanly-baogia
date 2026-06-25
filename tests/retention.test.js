// Integration tests cho src/retention.ts → pruneOldRecords().
// Xoá theo TUỔI (AuditEvent/LoginAttempt/WebhookDelivery) + giữ N bản QuoteVersion mới nhất/quote.
// Gọi prisma + pruneOldRecords TRỰC TIẾP (không qua supertest). Cần Postgres có schema (CI cấp; local tự skip).
//
// AN TOÀN khi chạy chung DB với 275 test khác (vitest chạy song song): pruneOldRecords() là thao tác
// GLOBAL (xoá MỌI row cũ + trim version MỌI quote). Nên ta dùng NGƯỠNG MẶC ĐỊNH (audit 730 ngày /
// version 100) — KHÔNG hạ env xuống thấp — để prune chỉ đụng đúng data CỦA TEST (1 audit cố-tình-cũ
// 800 ngày + 1 quote cố-tình tạo >100 version). Quote/audit của test khác (đều "mới" + <100 version)
// KHÔNG bị ảnh hưởng → không gây fail giả.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../src/db.js";
import { pruneOldRecords } from "../src/retention.js";

const VERSION_KEEP = 100; // = mặc định RETAIN_VERSION_KEEP của retention.ts (giữ 100 bản mới nhất/quote)
const EXTRA = 3;          // tạo dư 3 bản (103) → prune phải xoá đúng 3 bản CŨ NHẤT (versionNo 1..3)

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "AuditEvent" LIMIT 1')
  .then(() => true)
  .catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") {
  throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres/schema AuditEvent — retention test không được skip trong CI");
}

const TAG = `ret${Date.now()}`;

describe.runIf(dbAvailable)("retention pruneOldRecords (integration)", () => {
  let oldAuditId, newAuditId;
  let company, quote;

  beforeAll(async () => {
    // --- AuditEvent: 1 CŨ (set createdAt ~800 ngày trước > ngưỡng 730) + 1 MỚI (default now()). ---
    // action là field BẮT BUỘC (String); resource/resourceId là tham chiếu để cô lập + dọn.
    const oldA = await prisma.auditEvent.create({ data: { action: `${TAG}.old`, resource: "RetentionTest", resourceId: TAG } });
    const newA = await prisma.auditEvent.create({ data: { action: `${TAG}.new`, resource: "RetentionTest", resourceId: TAG } });
    oldAuditId = oldA.id;
    newAuditId = newA.id;
    // createdAt @default(now()) → đẩy bản CŨ về quá khứ bằng raw UPDATE.
    await prisma.$executeRawUnsafe(`UPDATE "AuditEvent" SET "createdAt" = now() - interval '800 days' WHERE id = $1`, oldAuditId);

    // --- QuoteVersion: tạo 1 Quote tối thiểu + (KEEP+EXTRA)=103 version → prune giữ 100 mới nhất. ---
    company = await prisma.company.create({ data: { code: `${TAG}-co`, name: `${TAG} Co`, address: "1 Test St", quotePrefix: "RT" } });
    quote = await prisma.quote.create({
      data: {
        quoteNumber: `${TAG}-q1`, title: `${TAG} quote`, toCompany: "Khách Retention",
        companyId: company.id, fromContact: "Người gửi", fromAddress: "1 Test St", city: "TP. HCM", quoteDate: new Date(),
      },
    });
    const total = VERSION_KEEP + EXTRA; // 103
    await prisma.quoteVersion.createMany({
      data: Array.from({ length: total }, (_, i) => ({ quoteId: quote.id, versionNo: i + 1, payload: { tag: TAG, v: i + 1 }, total: 1_000_000 + i })),
    });
  });

  afterAll(async () => {
    // Dọn sạch — chính xác theo ID/TAG, idempotent (chạy lại nhiều lần OK).
    await prisma.auditEvent.deleteMany({ where: { resourceId: TAG } });
    if (quote) await prisma.quoteVersion.deleteMany({ where: { quoteId: quote.id } });
    if (quote) await prisma.quote.deleteMany({ where: { id: quote.id }, hardDelete: true });
    if (company) await prisma.company.deleteMany({ where: { id: company.id }, hardDelete: true });
  });

  it("AuditEvent: prune XOÁ bản cũ (>730 ngày), GIỮ bản mới", async () => {
    // Tiền điều kiện: cả 2 còn tồn tại trước khi prune.
    const before = await prisma.auditEvent.findMany({ where: { resourceId: TAG }, select: { id: true } });
    expect(before.map((r) => String(r.id)).sort()).toEqual([String(oldAuditId), String(newAuditId)].sort());

    const result = await pruneOldRecords();
    expect(result.audit).toBeGreaterThanOrEqual(1); // ít nhất bản CŨ của ta bị xoá

    expect(await prisma.auditEvent.findUnique({ where: { id: oldAuditId } })).toBeNull();    // cũ → xoá
    const newStill = await prisma.auditEvent.findUnique({ where: { id: newAuditId } });
    expect(newStill).not.toBeNull();                                                          // mới → giữ
    expect(newStill.action).toBe(`${TAG}.new`);
  });

  it("QuoteVersion: prune CHỈ GIỮ 100 bản mới nhất/quote (xoá bản cũ nhất)", async () => {
    await pruneOldRecords(); // idempotent — gọi lại, lần này kiểm phần version

    const remain = await prisma.quoteVersion.findMany({
      where: { quoteId: quote.id }, orderBy: { versionNo: "desc" }, select: { versionNo: true },
    });
    expect(remain.length).toBe(VERSION_KEEP);                       // chỉ còn 100 bản
    expect(remain[0].versionNo).toBe(VERSION_KEEP + EXTRA);         // mới nhất = 103
    expect(remain[remain.length - 1].versionNo).toBe(EXTRA + 1);    // cũ nhất còn lại = 4 (1,2,3 đã xoá)

    // Prune thêm lần nữa khi đã đúng 100 → KHÔNG xoá thêm (ổn định).
    await pruneOldRecords();
    expect(await prisma.quoteVersion.count({ where: { quoteId: quote.id } })).toBe(VERSION_KEEP);
  });
});
