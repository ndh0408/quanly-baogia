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
    await pruneOldRecords();

    // ── KHÔNG khẳng định trên `kq.audit` ──────────────────────────────────
    // Đó là số ĐẾM TOÀN CỤC của cả bảng. BỐN tệp test cùng gọi `pruneOldRecords()`
    // (b1-retention-staging-fail · db3-retention-batch · qs-retention-objects · retention), mà
    // vitest chạy các tệp SONG SONG — lượt prune của tệp khác xoá xong 12.000 hàng này trước thì
    // lời gọi ở đây trả 0 và bài ĐỎ, dù mọi thứ đều đúng. ĐÃ ĐỎ THẬT ở một lượt chạy đầy đủ
    // ("expected 0 to be greater than or equal to 12000"), chạy riêng thì xanh.
    //
    // Hai khẳng định bên dưới đã phủ TRỌN tên của bài này, và cả hai đều chỉ nhìn dữ liệu MANG
    // TAG của chính nó:
    //   · không còn hàng nào của bài này sót lại  → "xoá hết phần quá hạn";
    //   · tổng theo trigger = đúng 12.000, câu lệnh lớn nhất ≤ một lô → "không lệnh nào ôm quá".
    // Trigger nằm trên BẢNG nên nó ghi lại mọi lượt DELETE, kể cả lượt do tệp khác kích hoạt —
    // mà lượt đó cũng là chính `pruneOldRecords`, nên tính chất cần chứng minh vẫn được chứng minh.
    expect(await prisma.auditEvent.count({ where: { action: { startsWith: TAG } } })).toBe(0);

    const lo = await prisma.$queryRawUnsafe(`SELECT n FROM "${BANG}" ORDER BY n DESC`);
    const soHangMoiLenh = lo.map((r) => Number(r.n));
    expect(soHangMoiLenh.length, "phải có ít nhất một câu lệnh chạm tới dữ liệu của bài test").toBeGreaterThan(0);
    expect(soHangMoiLenh[0], `một câu lệnh ôm ${soHangMoiLenh[0]} hàng — chưa chia lô`).toBeLessThanOrEqual(TRAN_LO);
    expect(soHangMoiLenh.reduce((a, b) => a + b, 0)).toBe(SO_HANG);
  }, 60_000);
});
