// Cụm B2 — GỘP RẠP: nhánh "hạng mục trùng có metadata KHÁC nhau" vẫn bắn N+1 lệnh dưới khoá.
//
// ── LỖI ─────────────────────────────────────────────────────────────────────
// `mergeVenue` (src/services/venueService.ts) đã gộp được hai việc thành một lệnh (chuyển hạng mục
// bằng một UPDATE … FROM jsonb_array_elements, xoá trùng bằng một deleteMany), nhưng phần GHI LẠI
// metadata của hạng mục đích thì vẫn là
//     `for (const u of doiMeta) await tx.venueItem.update({ where: { id: u.id }, data: u.data });`
// tức MỘT round-trip cho MỖI hạng mục có metadata thay đổi, nối đuôi nhau bên trong
// `prisma.$transaction` đang giữ advisory lock của CẢ HAI rạp.
//
// Bài test sẵn có (tests/db3-venue-merge-batch.test.js) KHÔNG phủ nhánh này: nó CỐ Ý dựng dữ liệu
// sao cho bản gộp y hệt bản cũ (`khacNhau` = false → `doiMeta` rỗng). Bài này dựng ca ngược lại —
// hạng mục nguồn có `note` và `category` khác — tức đúng ca "gộp hai rạp gọi cùng một hạng mục
// bằng hai cách ghi khác nhau", vốn là LÝ DO tồn tại của chức năng gộp.
//
// ── ĐO CÁI GÌ ───────────────────────────────────────────────────────────────
// Đếm SỐ CÂU LỆNH ghi thật sự chạm bảng `VenueItem`, bằng trigger mức STATEMENT + transition table
// lọc theo đúng hai rạp của bài test (các bộ test khác chạy song song cũng ghi `VenueItem`).
// Cách đo giống hệt tests/db3-venue-merge-batch.test.js. Kèm khẳng định KẾT QUẢ GỘP không đổi:
// note phải được nối, nhóm khác phải ghi thành ghi chú, kích thước/số lượng giữ nguyên.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { agentWithCsrf } from "./helpers/agent.js";
import bcrypt from "bcryptjs";
import { prisma } from "../src/db.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "VenueItem" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");

const TAG = `b2gop${Date.now()}`;
const PWD = "Test1234!a";
const BANG = `${TAG}_dem`;
const SO_TRUNG = 20;

describe.runIf(dbAvailable)("Gộp rạp — nhánh metadata đổi cũng không được N+1", () => {
  let app, admin, tuId, dichId;

  // Hai bản của CÙNG một hạng mục (cùng tên + đơn vị + kích thước ⇒ `sameVenueItem` khớp), nhưng
  // ghi chú và nhóm khác nhau ⇒ `mergeVenueItemMetadata` cho ra bản KHÁC ⇒ rơi vào `doiMeta`.
  const hangMucDich = (i) => ({
    category: "Quầy vé", name: `chung hang ${i}`, dim: `(${i}W x 1H)m`,
    widthM: i, heightM: 1, unit: "m2", quantity: 1, note: `ghi chu dich ${i}`, sortOrder: i, active: true,
  });
  const hangMucNguon = (i) => ({
    ...hangMucDich(i), category: "Quay ve (ban cu)", note: `ghi chu nguon ${i}`,
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
    await prisma.venueItem.createMany({ data: Array.from({ length: SO_TRUNG }, (_, i) => ({ venueId: dichId, ...hangMucDich(i + 1) })) });
    await prisma.venueItem.createMany({ data: Array.from({ length: SO_TRUNG }, (_, i) => ({ venueId: tuId, ...hangMucNguon(i + 1) })) });

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

  it("20 hạng mục trùng NHƯNG metadata khác: vẫn chỉ một nhúm câu lệnh, kết quả gộp y nguyên", async () => {
    const r = await admin.post(`/api/venues/${tuId}/merge`).send({ intoId: dichId });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.movedItems).toBe(0);
    expect(r.body.removedDuplicates).toBe(SO_TRUNG);

    const [{ n }] = await prisma.$queryRawUnsafe(`SELECT n FROM "${BANG}"`);
    // Bản cũ: 20 UPDATE (một cho mỗi hạng mục đổi metadata) + 1 DELETE = 21 câu lệnh.
    expect(Number(n), `gộp ${SO_TRUNG} hạng mục đổi metadata mà bắn ${n} câu lệnh — vẫn là N+1`).toBeLessThanOrEqual(4);

    expect(await prisma.venue.findUnique({ where: { id: tuId } })).toBeNull();
    const conLai = await prisma.venueItem.findMany({ where: { venueId: dichId }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] });
    expect(conLai.length).toBe(SO_TRUNG);
    for (const [i, it] of conLai.entries()) {
      const k = i + 1;
      // mergeVenueItemMetadata: hai ghi chú khác nhau được NỐI, nhóm ở rạp nguồn thành một dòng ghi chú.
      expect(it.note).toBe(`ghi chu dich ${k}\nghi chu nguon ${k}\nNhóm ở rạp nguồn: Quay ve (ban cu)`);
      expect(it.category).toBe("Quầy vé");        // nhóm của rạp ĐÍCH được giữ
      expect(Number(it.widthM)).toBe(k);
      expect(Number(it.heightM)).toBe(1);
      expect(Number(it.quantity)).toBe(1);
      expect(it.dim).toBe(`(${k}W x 1H)m`);
      expect(it.active).toBe(true);
      expect(it.unit).toBe("m2");                 // cột KHÔNG nằm trong bản gộp → phải nguyên vẹn
      expect(it.sortOrder).toBe(k);
    }
  }, 60_000);
});
