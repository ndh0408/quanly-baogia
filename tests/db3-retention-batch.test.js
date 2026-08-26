// Cụm csdl-truyvan — job dọn bảng append-only xoá cả khối trong MỘT câu lệnh.
//
// ── LỖI ─────────────────────────────────────────────────────────────────────
// `pruneOldRecords` (src/retention.ts) gọi `deleteMany` thuần theo `createdAt <` cho AuditEvent /
// LoginAttempt / WebhookDelivery. Đó là MỘT câu lệnh xoá sạch phần quá hạn: lượt prune ĐẦU TIÊN
// trên bảng đã tích tụ (AuditEvent giữ 2 năm) là hàng triệu hàng trong một transaction — khoá giữ
// suốt câu lệnh, WAL phình bằng đúng lượng xoá, replica/backup phải nuốt trọn khối đó. Đứt giữa
// chừng thì rollback toàn bộ, lượt sau làm lại từ đầu.
//
// ── ĐO CÁI GÌ ───────────────────────────────────────────────────────────────
// Trigger mức STATEMENT ghi lại SỐ HÀNG mà TỪNG câu lệnh DELETE động tới (transition table, lọc
// theo `action` mang TAG của bài test nên không đếm nhầm dữ liệu bộ test khác chạy song song).
// Khẳng định: không câu lệnh nào xoá quá PRUNE_BATCH hàng, và tổng vẫn xoá đủ.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../src/db.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "AuditEvent" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");

const TAG = `db3ret${Date.now()}`;
const BANG = `${TAG}_lo`;
const SO_HANG = 12_000;   // > 2 lô để thấy rõ việc chia lô
const TRAN_LO = 5_000;    // PRUNE_BATCH trong src/retention.ts

describe.runIf(dbAvailable)("Dọn nhật ký quá hạn phải chia lô", () => {
  beforeAll(async () => {
    await prisma.$executeRawUnsafe(`CREATE TABLE "${BANG}" (n int NOT NULL)`);
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION ${TAG}_ghi() RETURNS trigger AS $fn$
      BEGIN
        INSERT INTO "${BANG}" (n) SELECT count(*) FROM ot WHERE "action" LIKE '${TAG}%' HAVING count(*) > 0;
        RETURN NULL;
      END $fn$ LANGUAGE plpgsql;`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER ${TAG}_trg AFTER DELETE ON "AuditEvent" REFERENCING OLD TABLE AS ot FOR EACH STATEMENT EXECUTE FUNCTION ${TAG}_ghi()`);
    // Nhật ký "cũ 3 năm" — quá hạn giữ 2 năm mặc định (RETAIN_AUDIT_DAYS=730).
    await prisma.$executeRawUnsafe(
      `INSERT INTO "AuditEvent" ("action", "createdAt")
       SELECT '${TAG}-' || i, now() - interval '1100 days' FROM generate_series(1, ${SO_HANG}) AS i`,
    );
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${TAG}_trg ON "AuditEvent"`).catch(() => {});
    await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${TAG}_ghi()`).catch(() => {});
    await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "${BANG}"`).catch(() => {});
    await prisma.auditEvent.deleteMany({ where: { action: { startsWith: TAG } } }).catch(() => {});
  });

  it("không câu lệnh DELETE nào ôm quá một lô, và vẫn xoá hết phần quá hạn", async () => {
    const { pruneOldRecords } = await import("../src/retention.js");
    const kq = await pruneOldRecords();
    expect(kq.audit, "phải xoá đủ số hàng quá hạn").toBeGreaterThanOrEqual(SO_HANG);
    expect(await prisma.auditEvent.count({ where: { action: { startsWith: TAG } } })).toBe(0);

    const lo = await prisma.$queryRawUnsafe(`SELECT n FROM "${BANG}" ORDER BY n DESC`);
    const soHangMoiLenh = lo.map((r) => Number(r.n));
    expect(soHangMoiLenh.length, "phải có ít nhất một câu lệnh chạm tới dữ liệu của bài test").toBeGreaterThan(0);
    expect(soHangMoiLenh[0], `một câu lệnh ôm ${soHangMoiLenh[0]} hàng — chưa chia lô`).toBeLessThanOrEqual(TRAN_LO);
    expect(soHangMoiLenh.reduce((a, b) => a + b, 0)).toBe(SO_HANG);
  }, 60_000);
});
