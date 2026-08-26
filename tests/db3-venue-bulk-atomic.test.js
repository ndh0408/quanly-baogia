// Cụm csdl-truyvan — gắn/gỡ từ khóa HÀNG LOẠT cho danh mục rạp phải NGUYÊN TỬ.
//
// ── LỖI ─────────────────────────────────────────────────────────────────────
// `bulkTags` (src/services/venueService.ts) đọc danh sách rạp rồi chạy một vòng `for` gọi
// `prisma.venue.update` TỪNG rạp một — không `$transaction`, không lệnh gộp. Trần payload là 1000
// rạp (`src/routes/venues.routes.ts`). Hỏng giữa chừng (kết nối rớt, lỗi ở tầng CSDL) để lại đúng
// một nửa danh mục mang nhãn mới, nửa kia không — mà lời báo cho người dùng là một lỗi duy nhất.
// Không mất dữ liệu, nhưng trạng thái nửa vời trên DANH MỤC DÙNG CHUNG thì người sau không có cách
// nào biết đợt gắn nhãn đã chạy tới đâu.
//
// ── TÁI HIỆN (tất định) ─────────────────────────────────────────────────────
// Dựng một trigger CHỈ ném lỗi khi rạp THỨ HAI trong đợt bị ghi. Vòng `for` đã kịp commit rạp thứ
// nhất trước khi vấp → nhãn dính lại. Một lệnh UPDATE gộp thì cả đợt cùng sống hoặc cùng chết.
// Trigger chỉ khớp đúng dữ liệu mang TAG của bài test nên không đụng agent/bộ test chạy song song.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { agentWithCsrf } from "./helpers/agent.js";
import bcrypt from "bcryptjs";
import { prisma } from "../src/db.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "Venue" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");

const TAG = `db3rap${Date.now()}`;
const PWD = "Test1234!a";
const NHAN = `${TAG}-nhan`;

describe.runIf(dbAvailable)("Gắn từ khóa hàng loạt cho rạp — cả đợt sống hoặc cả đợt chết", () => {
  let app, admin, ids;

  /** Trả nhãn của 3 rạp về mốc gốc — mỗi bài test tự dựng điều kiện của mình, không ăn theo bài trước. */
  const datLai = async () => { for (let i = 0; i < ids.length; i++) await prisma.venue.update({ where: { id: ids[i] }, data: { tags: ["HCM", `cu${i + 1}`] } }); };

  const tagsCua = async () => (await prisma.venue.findMany({ where: { id: { in: ids } }, orderBy: { id: "asc" }, select: { tags: true } })).map((v) => v.tags);

  beforeAll(async () => {
    const { createApp } = await import("../src/app.js");
    app = createApp();
    await prisma.user.create({ data: { username: `${TAG}-admin`, displayName: `${TAG} admin`, role: "admin", passwordHash: await bcrypt.hash(PWD, 4) } });
    admin = agentWithCsrf(app);
    expect((await admin.post("/api/auth/login").send({ username: `${TAG}-admin`, password: PWD })).status).toBe(200);
    ids = [];
    for (let i = 1; i <= 3; i++) {
      const v = await prisma.venue.create({ data: { name: `${TAG} rap ${i}`, region: TAG, tags: ["HCM", `cu${i}`] } });
      ids.push(v.id);
    }
    ids.sort((a, b) => a - b);
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${TAG}_no_trg ON "Venue"`).catch(() => {});
    await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${TAG}_no()`).catch(() => {});
    await prisma.venue.deleteMany({ where: { region: TAG } }).catch(() => {});
    await prisma.loginAttempt.deleteMany({ where: { username: { startsWith: TAG } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
  });

  it("một rạp giữa đợt ghi hỏng → KHÔNG rạp nào bị đổi nhãn", async () => {
    const truoc = await tagsCua();
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION ${TAG}_no() RETURNS trigger AS $fn$
      BEGIN
        IF NEW.id = ${ids[1]} AND '${NHAN}' = ANY(NEW.tags) THEN RAISE EXCEPTION 'db3: chan rap giua dot'; END IF;
        RETURN NEW;
      END $fn$ LANGUAGE plpgsql;`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER ${TAG}_no_trg BEFORE UPDATE ON "Venue" FOR EACH ROW EXECUTE FUNCTION ${TAG}_no();`);
    let r;
    try {
      r = await admin.post("/api/venues/tags/bulk").send({ venueIds: ids, add: [NHAN] });
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${TAG}_no_trg ON "Venue"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${TAG}_no()`);
    }
    expect(r.status, "ghi hỏng thì phải báo hỏng").toBeGreaterThanOrEqual(400);
    expect(await tagsCua(), "đợt hỏng KHÔNG được để lại nhãn nửa vời").toEqual(truoc);
  }, 30_000);

  it("đợt chạy trót lọt: gắn rồi gỡ giữ ĐÚNG thứ tự nhãn cũ (không xáo trộn)", async () => {
    await datLai();
    const them = await admin.post("/api/venues/tags/bulk").send({ venueIds: ids, add: ["Zed", "HCM"] });
    expect(them.status, JSON.stringify(them.body)).toBe(200);
    expect(them.body.updated).toBe(3);
    // `[...new Set([...giữ lại, ...thêm])]`: nhãn cũ giữ nguyên VỊ TRÍ, nhãn mới nối vào cuối,
    // nhãn đã có (HCM) KHÔNG bị đẩy xuống cuối. Người dùng nhìn hàng chip theo đúng thứ tự này.
    expect(await tagsCua()).toEqual([["HCM", "cu1", "Zed"], ["HCM", "cu2", "Zed"], ["HCM", "cu3", "Zed"]]);

    const go = await admin.post("/api/venues/tags/bulk").send({ venueIds: ids, add: [], remove: ["HCM"] });
    expect(go.status, JSON.stringify(go.body)).toBe(200);
    expect(await tagsCua()).toEqual([["cu1", "Zed"], ["cu2", "Zed"], ["cu3", "Zed"]]);
  }, 30_000);

  it("gắn + gỡ CÙNG một nhãn trong một lượt: gắn thắng (y như trước)", async () => {
    await datLai();
    const r = await admin.post("/api/venues/tags/bulk").send({ venueIds: [ids[0]], add: ["X"], remove: ["X", "cu1"] });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const v = await prisma.venue.findUnique({ where: { id: ids[0] }, select: { tags: true } });
    expect(v.tags).toEqual(["HCM", "X"]);
  });
});
