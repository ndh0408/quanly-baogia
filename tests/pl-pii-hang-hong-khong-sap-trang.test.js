// FILE-12 — MỘT bản mã PII hỏng làm sập TOÀN BỘ danh sách nhân sự/danh bạ (500).
//
// decodePiiList → decodePiiOnRead → decryptPiiOrThrow ném status 500 cho hàng hỏng (khoá cũ gỡ sớm,
// byte hỏng) → cả response hỏng, kể cả tổng lương. Nay hàng hỏng vẫn FAIL-CLOSED (trường PII null,
// không plaintext) nhưng mang cờ piiLoi, các hàng khác trả bình thường.
process.env.PII_ENC_KEY ||= "khoa-test-hop-dong-du-dai-cho-hkdf-0123456789";

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import { agentWithCsrf } from "./helpers/agent.js";

const { decodePiiList } = await import("../src/piiFields.js");
const { encryptPii } = await import("../src/piiBox.js");
const { prisma } = await import("../src/db.js");

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "PersonnelRecord" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");

describe("decodePiiList với một hàng hỏng", () => {
  it("trả đủ 2 hàng; hàng hỏng có piiLoi và KHÔNG có plaintext/bản mã", () => {
    const tot = { id: 1, fullName: "A", idCardEnc: encryptPii("079123456789", "PersonnelRecord:idCard"), idCard: null };
    const hong = { id: 2, fullName: "B", idCardEnc: "pii:v1:AAAA", idCard: "079000000009", salaryEnc: "pii:v1:AAAA", salary: 5 };
    const ra = decodePiiList("PersonnelRecord", [tot, hong]);
    expect(ra).toHaveLength(2);
    expect(ra[0].idCard).toBe("079123456789");
    expect(ra[0].piiLoi).toBeUndefined();
    expect(ra[1].piiLoi).toBe(true);
    expect(ra[1].idCard, "không được rơi về cột thô khi bản mã hỏng").toBeNull();
    expect(ra[1].salary).toBeNull();
    expect(JSON.stringify(ra[1])).not.toMatch(/pii:v1:|079000000009/);
  });
});

describe.runIf(dbAvailable)("GET /api/personnel có một hàng PII hỏng", () => {
  const TAG = `plhong${Date.now()}`;
  const PWD = "Test1234!a";
  let admin, u;
  beforeAll(async () => {
    const { createApp } = await import("../src/app.js");
    const app = createApp();
    u = await prisma.user.create({ data: { username: `${TAG}-a`, displayName: TAG, role: "admin", passwordHash: await bcrypt.hash(PWD, 4) } });
    admin = agentWithCsrf(app);
    expect((await admin.post("/api/auth/login").send({ username: u.username, password: PWD })).status).toBe(200);
    await prisma.personnelRecord.create({ data: { createdById: u.id, fullName: `${TAG} tot`, searchText: `${TAG} tot`, piiVersion: 1, salaryEnc: encryptPii("3000000", "PersonnelRecord:salary") } });
    await prisma.personnelRecord.create({ data: { createdById: u.id, fullName: `${TAG} hong`, searchText: `${TAG} hong`, piiVersion: 1, salaryEnc: "pii:v1:AAAA" } });
  });
  afterAll(async () => {
    await prisma.personnelRecord.deleteMany({ where: { fullName: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.auditEvent.deleteMany({ where: { actorId: u?.id } }).catch(() => {});
    await prisma.loginAttempt.deleteMany({ where: { username: { startsWith: TAG } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
  });

  it("trang vẫn 200; hàng hỏng mang piiLoi; tổng lương tính trên hàng đọc được", async () => {
    const r = await admin.get(`/api/personnel?q=${TAG}&size=50`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data).toHaveLength(2);
    expect(r.body.data.find((x) => x.fullName.endsWith("hong")).piiLoi).toBe(true);
    expect(r.body.summary.salary).toBe(3_000_000);
  });
});
