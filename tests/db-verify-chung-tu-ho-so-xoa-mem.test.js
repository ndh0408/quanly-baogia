/**
 * DB-13 — verifyIntegrity --proof PHẢI ĐỐI CHIẾU CẢ CHỨNG TỪ CỦA HỒ SƠ ĐÃ XOÁ MỀM.
 *
 * Phần PII của công cụ đã cố ý dùng includeDeleted (hàng xoá mềm vẫn cần khôi phục), phần chứng từ thì
 * lọc `deletedAt: null` — object của hồ sơ xoá mềm không bao giờ được kiểm, nên một hồ sơ xoá mềm trỏ
 * vào object không tồn tại vẫn cho ra ✓.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../src/db.js";
import { isStorageEnabled } from "../src/storage.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "User" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") {
  throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");
}

const TAG = `dbvi${Date.now()}`;

describe.runIf(dbAvailable && isStorageEnabled())("DB-13 — verify chứng từ gồm hồ sơ xoá mềm", () => {
  let user, rec;
  beforeAll(async () => {
    user = await prisma.user.create({ data: { username: `${TAG}-u`, displayName: "U", passwordHash: "x" } });
    rec = await prisma.personnelRecord.create({
      data: { createdById: user.id, fullName: `${TAG} hồ sơ`, projectCode: "X", paymentProofKey: `proofs/${TAG}/khong-ton-tai.png`, paymentProofSha256: "0".repeat(64), deletedAt: new Date() },
    });
  });
  afterAll(async () => {
    await prisma.personnelRecord.deleteMany({ where: { id: rec?.id }, hardDelete: true, includeDeleted: true }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true, includeDeleted: true }).catch(() => {});
  });

  it("hồ sơ xoá mềm trỏ vào object không tồn tại → bị đếm THIẾU, kết quả không đạt", async () => {
    const { kiemChungTu } = await import("../src/tools/verifyIntegrity.js");
    const kq = await kiemChungTu({ chiId: [rec.id] });
    expect(kq.chiTiet, "hồ sơ xoá mềm bị bỏ khỏi đối chiếu").toMatch(/^1 hàng/);
    expect(kq.chiTiet).toMatch(/1 THIẾU object/);
    expect(kq.dat).toBe(false);
  });
});
