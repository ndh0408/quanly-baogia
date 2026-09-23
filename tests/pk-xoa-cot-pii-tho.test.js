// FILE-04 / FILE-14 — xoá cột PII THÔ còn sót sau cutover, và backfill không ghi đè bản mã mới.
//
// ── FILE-04 ─────────────────────────────────────────────────────────────────
// Cutover (PII_PLAINTEXT_CUTOVER) chỉ đổi đường GHI. Hàng cũ và hàng đã backfill vẫn giữ nguyên
// idCard/bankAccount/salary thô cạnh bản mã → bản dump vẫn lộ CCCD/STK/lương, và không công cụ nào
// xoá hay đếm được chúng. src/tools/piiScrub.ts xoá cột thô CHỈ khi bản mã của chính hàng đó giải ra
// đúng giá trị; thiếu/lệch thì giữ nguyên. verifyIntegrity đếm số ô thô còn sót (demCotThoConLai).
//
// ── FILE-14 ─────────────────────────────────────────────────────────────────
// pii-backfill.mjs ghi mù `update({ where: { id } })` — ứng dụng sửa hàng giữa lúc đọc và ghi thì bản
// mã MỚI bị đè bằng bản mã của giá trị cũ. Script cần tsx + src/ nên không chạy trong bài test được;
// bài dưới khoá mã nguồn: lượt ghi của backfillModel phải là CAS trên `piiVersion: 0`.
process.env.PII_ENC_KEY ||= "khoa-test-hop-dong-du-dai-cho-hkdf-0123456789";

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";

const { prisma } = await import("../src/db.js");
const { encryptPii } = await import("../src/piiBox.js");
const { xoaCotThoDaMaHoa, demCotThoConLai } = await import("../src/tools/piiScrub.js");

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "PersonnelRecord" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");

const TAG = `pkxoatho${Date.now()}`;
const ma = (field, v) => encryptPii(String(v), `PersonnelRecord:${field}`);

describe.runIf(dbAvailable)("piiScrub — xoá cột thô đã có bản mã khớp", () => {
  const id = {};
  const phamVi = () => ({ chiTrongIds: { PersonnelRecord: Object.values(id), Employee: [] } });

  let uid;
  beforeAll(async () => {
    uid = (await prisma.user.create({ data: { username: `${TAG}-u`, displayName: TAG, role: "manager", passwordHash: "x" } })).id;
    const tao = async (ten, data) => (id[ten] = (await prisma.personnelRecord.create({ data: { createdById: uid, fullName: `${TAG} ${ten}`, piiVersion: 1, ...data } })).id);
    await tao("khop", { idCard: "079123456789", idCardEnc: ma("idCard", "079123456789"), bankAccount: "0011223344", bankAccountEnc: ma("bankAccount", "0011223344"), salary: 5000000, salaryEnc: ma("salary", "5000000") });
    await tao("khongBanMa", { idCard: "079000000001", piiVersion: 0 });
    await tao("lech", { idCard: "079000000002", idCardEnc: ma("idCard", "079999999999") });
    await tao("xoaMem", { idCard: "079000000003", idCardEnc: ma("idCard", "079000000003"), deletedAt: new Date() });
  });

  afterAll(async () => {
    await prisma.personnelRecord.deleteMany({ where: { fullName: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
  });

  const tho = (ten) => prisma.personnelRecord.findFirst({ where: { id: id[ten] }, includeDeleted: true, select: { idCard: true, bankAccount: true, salary: true, idCardEnc: true } });

  it("chạy thử (--dry-run) không ghi gì, nhưng đếm đúng", async () => {
    const truoc = await demCotThoConLai(phamVi());
    expect(truoc).toBe(6);   // khop: 3 ô · khongBanMa: 1 · lech: 1 · xoaMem: 1
    const kq = await xoaCotThoDaMaHoa({ chayThu: true, ...phamVi() });
    const idCard = kq.find((k) => k.model === "PersonnelRecord" && k.truong === "idCard");
    expect(idCard).toMatchObject({ daXoa: 2, khongBanMa: 1, lech: 1 });
    expect(await demCotThoConLai(phamVi())).toBe(6);
  });

  it("xoá thật: chỉ hàng có bản mã KHỚP bị null cột thô (kể cả hàng xoá mềm); hàng thiếu/lệch giữ nguyên", async () => {
    await xoaCotThoDaMaHoa(phamVi());
    const khop = await tho("khop");
    expect(khop.idCard).toBeNull();
    expect(khop.bankAccount).toBeNull();
    expect(khop.salary).toBeNull();
    expect(String(khop.idCardEnc)).toMatch(/^pii:v1:/);   // bản mã vẫn nguyên
    expect((await tho("xoaMem")).idCard, "hàng xoá mềm vẫn nằm trong dump — phải được dọn").toBeNull();
    expect((await tho("khongBanMa")).idCard, "KHÔNG có bản mã mà bị xoá là mất dữ liệu").toBe("079000000001");
    expect((await tho("lech")).idCard, "bản mã lệch mà bị xoá là mất giá trị đúng").toBe("079000000002");
    expect(await demCotThoConLai(phamVi())).toBe(2);
  });
});

describe("pii-backfill.mjs — ghi có điều kiện (FILE-14)", () => {
  it("backfillModel ghi bằng updateMany CAS trên piiVersion: 0, không update mù theo id", () => {
    const src = readFileSync(new URL("../scripts/migration/pii-backfill.mjs", import.meta.url), "utf8");
    const than = src.slice(src.indexOf("async function backfillModel"), src.indexOf("const mode ="));
    expect(than, "không tìm thấy thân backfillModel").toMatch(/for \(const row of batch\)/);
    expect(than).toMatch(/updateMany\(\{\s*where:\s*\{\s*id:\s*row\.id,\s*piiVersion:\s*0\s*\}/);
    expect(than, "còn lượt update mù theo id — bản mã mới của ứng dụng bị đè").not.toMatch(/client\.update\(\{\s*where:\s*\{\s*id:\s*row\.id\s*\}/);
  });
});
