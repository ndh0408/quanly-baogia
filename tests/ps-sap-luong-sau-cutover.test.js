// FILE-07 — sắp danh sách nhân sự theo Lương phải đúng cả khi cột thô đã bị null (cutover PII).
//
// ── LỖI ─────────────────────────────────────────────────────────────────────
// listPersonnel dùng `orderBy: { [sort]: order }` — với sort=salary là ORDER BY cột `salary` THÔ.
// Từ khi PII_PLAINTEXT_CUTOVER bật, mọi hồ sơ tạo/sửa sau đó có salary thô = NULL (giá trị chỉ còn
// ở salaryEnc) → Postgres dồn chúng về một đầu theo thứ tự tuỳ ý; chỉ hàng cũ còn cột thô mới được
// xếp. Kế toán sắp theo lương để rà chi trả nhận thứ tự sai mà không có dấu hiệu lỗi.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import { agentWithCsrf } from "./helpers/agent.js";

process.env.PII_ENC_KEY ||= "khoa-test-hop-dong-du-dai-cho-hkdf-0123456789";
process.env.PII_PLAINTEXT_CUTOVER = "1";

const { prisma } = await import("../src/db.js");
const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "PersonnelRecord" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");

const TAG = `pssapluong${Date.now()}`;
const PWD = "Test1234!a";

describe.runIf(dbAvailable)("sắp theo Lương sau cutover PII (integration)", () => {
  let mgr, mgrU;

  beforeAll(async () => {
    const { createApp } = await import("../src/app.js");
    const app = createApp();
    mgrU = await prisma.user.create({ data: { username: `${TAG}-mgr`, displayName: `${TAG} mgr`, role: "manager", passwordHash: await bcrypt.hash(PWD, 4) } });
    mgr = agentWithCsrf(app);
    expect((await mgr.post("/api/auth/login").send({ username: mgrU.username, password: PWD })).status).toBe(200);
    // Ba hồ sơ MỚI (qua API → cột thô null, lương chỉ ở salaryEnc) + một hồ sơ CŨ còn cột thô.
    for (const [ten, luong] of [["mot", 1_000_000], ["nam", 5_000_000], ["ba", 3_000_000]]) {
      const r = await mgr.post("/api/personnel").send({ fullName: `${TAG} ${ten}`, salary: luong, projectName: "DA", projectCode: "PRJ-SAPLUONG" });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
    }
    await prisma.personnelRecord.create({ data: { createdById: mgrU.id, fullName: `${TAG} hai`, salary: 2_000_000, searchText: `${TAG} hai`.toLowerCase() } });
    const raw = await prisma.personnelRecord.findFirst({ where: { fullName: `${TAG} nam` } });
    expect(raw.salary, "tiền đề: cutover phải null cột thô").toBeNull();
  });

  afterAll(async () => {
    await prisma.auditEvent.deleteMany({ where: { actorId: mgrU?.id } }).catch(() => {});
    await prisma.personnelRecord.deleteMany({ where: { fullName: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.loginAttempt.deleteMany({ where: { username: { startsWith: TAG } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
  });

  const ten = (r) => r.body.data.map((x) => x.fullName.replace(`${TAG} `, ""));

  it("sort=salary&order=asc → tăng dần theo lương THẬT", async () => {
    const r = await mgr.get(`/api/personnel?q=${TAG}&sort=salary&order=asc&size=50`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(ten(r)).toEqual(["mot", "hai", "ba", "nam"]);
    expect(r.body.meta.total).toBe(4);
    expect(r.body.summary.salary).toBe(11_000_000);
  });

  it("order=desc → giảm dần; phân trang lấy đúng lát", async () => {
    expect(ten(await mgr.get(`/api/personnel?q=${TAG}&sort=salary&order=desc&size=50`))).toEqual(["nam", "ba", "hai", "mot"]);
    expect(ten(await mgr.get(`/api/personnel?q=${TAG}&sort=salary&order=asc&size=2&page=2`))).toEqual(["ba", "nam"]);
  });
});
