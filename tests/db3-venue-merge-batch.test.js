// Cụm csdl-truyvan — GỘP RẠP bắn N+1 lệnh bên trong một transaction.
//
// ── LỖI ─────────────────────────────────────────────────────────────────────
// `mergeVenue` (src/services/venueService.ts) chạy `for (const it of from.items)` và gọi
// `tx.venueItem.update` / `tx.venueItem.delete` cho TỪNG hạng mục — toàn bộ nằm trong một
// `prisma.$transaction` đã giữ advisory lock của CẢ HAI rạp. Rạp lớn (vài trăm hạng mục) là vài
// trăm round-trip nối đuôi nhau dưới khoá; chạm trần thời gian transaction thì rollback SẠCH
// (không mất dữ liệu) nhưng thao tác quản trị thất bại mà không có cách nào chia nhỏ.
//
// ── ĐO CÁI GÌ ───────────────────────────────────────────────────────────────
// Đếm SỐ CÂU LỆNH ghi thật sự chạm bảng `VenueItem` trong lúc gộp, bằng trigger mức STATEMENT
// (`FOR EACH STATEMENT`) — không phải mức hàng. Dùng transition table để CHỈ đếm câu lệnh động
// tới đúng hai rạp của bài test: các bộ test khác chạy song song cũng ghi `VenueItem`, đếm mù sẽ
// vừa nhiễu vừa chập chờn.
// Số HÀNG bị đổi thì giữ nguyên — bài test chốt cả kết quả gộp (số chuyển / số trùng bị xoá /
// dữ liệu hạng mục sau gộp), nên "gộp thành ít lệnh hơn" không được phép đổi kết quả.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { agentWithCsrf } from "./helpers/agent.js";
import bcrypt from "bcryptjs";
import { prisma } from "../src/db.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "VenueItem" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");

const TAG = `db3gop${Date.now()}`;
const PWD = "Test1234!a";
const BANG = `${TAG}_dem`;
const SO_TRUNG = 20;
const SO_RIENG = 20;

describe.runIf(dbAvailable)("Gộp rạp — số câu lệnh không được tỉ lệ với số hạng mục", () => {
  let app, admin, tuId, dichId;

  const hangMuc = (i, dau) => ({
    category: "Quầy vé", name: `${dau} hang ${i}`, dim: `(${i}W x 1H)m`,
    widthM: i, heightM: 1, unit: "m2", quantity: 1, sortOrder: i, active: true,
  });

  beforeAll(async () => {
    const { createApp } = await import("../src/app.js");
    app = createApp();
    await prisma.user.create({ data: { username: `${TAG}-admin`, displayName: `${TAG} admin`, role: "admin", passwordHash: await bcrypt.hash(PWD, 4) } });
    admin = agentWithCsrf(app);
    expect((await admin.post("/api/auth/login").send({ username: `${TAG}-admin`, password: PWD })).status).toBe(200);

    const dich = await prisma.venue.create({ data: { name: `${TAG} dich`, region: TAG } });
    const tu = await prisma.venue.create({ data: { name: `${TAG} nguon`, region: TAG } });
    dichId = dich.id;
    tuId = tu.id;
    // Rạp ĐÍCH: SO_TRUNG hạng mục. Rạp NGUỒN: đúng SO_TRUNG hạng mục ấy (trùng → gộp + xoá)
    // cộng SO_RIENG hạng mục riêng (chuyển sang). widthM/heightM đặt sẵn để `mergeVenueItemMetadata`
    // KHÔNG phải suy lại kích thước từ `dim` — tức bản gộp KHÔNG đổi gì, đúng ca gộp thường gặp.
    await prisma.venueItem.createMany({ data: Array.from({ length: SO_TRUNG }, (_, i) => ({ venueId: dichId, ...hangMuc(i + 1, "chung") })) });
    await prisma.venueItem.createMany({ data: Array.from({ length: SO_TRUNG }, (_, i) => ({ venueId: tuId, ...hangMuc(i + 1, "chung") })) });
    await prisma.venueItem.createMany({ data: Array.from({ length: SO_RIENG }, (_, i) => ({ venueId: tuId, ...hangMuc(i + 101, "rieng") })) });

    // Bộ đếm CÂU LỆNH, lọc theo đúng hai rạp của bài test (transition table).
    await prisma.$executeRawUnsafe(`CREATE TABLE "${BANG}" (n int NOT NULL)`);
    await prisma.$executeRawUnsafe(`INSERT INTO "${BANG}" VALUES (0)`);
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION ${TAG}_u() RETURNS trigger AS $fn$
      BEGIN
        IF EXISTS (SELECT 1 FROM nt WHERE "venueId" IN (${tuId}, ${dichId})) THEN UPDATE "${BANG}" SET n = n + 1; END IF;
        RETURN NULL;
      END $fn$ LANGUAGE plpgsql;`);
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION ${TAG}_d() RETURNS trigger AS $fn$
      BEGIN
        IF EXISTS (SELECT 1 FROM ot WHERE "venueId" IN (${tuId}, ${dichId})) THEN UPDATE "${BANG}" SET n = n + 1; END IF;
        RETURN NULL;
      END $fn$ LANGUAGE plpgsql;`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER ${TAG}_u_trg AFTER UPDATE ON "VenueItem" REFERENCING NEW TABLE AS nt FOR EACH STATEMENT EXECUTE FUNCTION ${TAG}_u()`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER ${TAG}_d_trg AFTER DELETE ON "VenueItem" REFERENCING OLD TABLE AS ot FOR EACH STATEMENT EXECUTE FUNCTION ${TAG}_d()`);
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${TAG}_u_trg ON "VenueItem"`).catch(() => {});
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${TAG}_d_trg ON "VenueItem"`).catch(() => {});
    await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${TAG}_u()`).catch(() => {});
    await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${TAG}_d()`).catch(() => {});
    await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "${BANG}"`).catch(() => {});
    await prisma.venue.deleteMany({ where: { region: TAG } }).catch(() => {});
    await prisma.loginAttempt.deleteMany({ where: { username: { startsWith: TAG } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
  });

  it("gộp 40 hạng mục chỉ tốn một nhúm câu lệnh, và ra ĐÚNG kết quả cũ", async () => {
    const r = await admin.post(`/api/venues/${tuId}/merge`).send({ intoId: dichId });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.movedItems).toBe(SO_RIENG);
    expect(r.body.removedDuplicates).toBe(SO_TRUNG);

    const [{ n }] = await prisma.$queryRawUnsafe(`SELECT n FROM "${BANG}"`);
    // Bản cũ: 1 update/hạng mục chuyển + (1 update + 1 delete)/hạng mục trùng = 60 câu lệnh.
    expect(Number(n), `gộp ${SO_RIENG + SO_TRUNG} hạng mục mà bắn ${n} câu lệnh — vẫn là N+1`).toBeLessThanOrEqual(6);

    // Kết quả gộp phải y hệt bản cũ: rạp nguồn biến mất, mọi hạng mục nằm ở rạp đích, không trùng.
    expect(await prisma.venue.findUnique({ where: { id: tuId } })).toBeNull();
    const conLai = await prisma.venueItem.findMany({ where: { venueId: dichId }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] });
    expect(conLai.length).toBe(SO_TRUNG + SO_RIENG);
    expect(new Set(conLai.map((x) => x.name)).size).toBe(SO_TRUNG + SO_RIENG);
    // Hạng mục chuyển sang phải được xếp SAU hạng mục sẵn có (sortOrder nối tiếp, không đè).
    const chuyen = conLai.filter((x) => x.name.startsWith("rieng"));
    expect(Math.min(...chuyen.map((x) => x.sortOrder))).toBeGreaterThan(SO_TRUNG);
    expect(new Set(chuyen.map((x) => x.sortOrder)).size).toBe(SO_RIENG);
  }, 60_000);
});
