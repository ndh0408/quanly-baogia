// MÃ DỰ PHÒNG MFA ĐÃ TIÊU THỤ KHÔNG ĐƯỢC SỐNG LẠI — chốt hồi quy (src/authCore.ts).
//
// ── LỖI (ultracode audit vòng 2, 2026-09-08) ────────────────────────────────
// `verifyMfaChallenge` từng gỡ mã bằng `data: { mfaBackupCodes: { set: hit.remaining } }`, mà
// `hit.remaining` tính từ bản mảng ĐÃ ĐỌC TRƯỚC ĐÓ. Điều kiện `has: matched` chặn được hai request
// trình CÙNG một mã, nhưng KHÔNG chặn hai request trình HAI MÃ KHÁC NHAU — và ca đó làm sống lại mã
// đã tiêu:
//     mảng [A,B,C]; req1 dùng A (remaining [B,C]); req2 dùng B (remaining [A,C]) — cả hai đọc [A,B,C].
//     req1 ghi [B,C]; req2 thấy `has: B` vẫn đúng nên ghi đè [A,C] → A QUAY LẠI dù vừa bị tiêu thụ.
// Mã dự phòng là chứng chỉ CUỐI CÙNG của tài khoản (đường vào khi mất điện thoại), một mã sống lại
// là một đường vào còn hiệu lực nằm ngoài sổ sách.
//
// Nay dùng `array_remove` trong một câu UPDATE: nó chạy trên GIÁ TRỊ HIỆN TẠI của hàng nên hai
// request gỡ hai phần tử khác nhau đều đúng, còn `= ANY(...)` giữ nguyên tính dùng-một-lần.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import { prisma } from "../src/db.js";
import { verifyMfaChallenge } from "../src/authCore.js";
import { generateBackupCodes } from "../src/mfa.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "User" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") {
  throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");
}

const TAG = `bkcode${Date.now()}`;

describe.runIf(dbAvailable)("mã dự phòng — hai mã dùng SONG SONG", () => {
  let userId, plain, hashed;

  beforeAll(async () => {
    ({ plain, hashed } = await generateBackupCodes());   // bcrypt: `hashed[i]` là bản lưu của `plain[i]`
    const u = await prisma.user.create({
      data: {
        username: `${TAG}-u`, displayName: TAG, role: "manager",
        passwordHash: await bcrypt.hash("Test1234!a", 4),
        mfaEnabled: true, mfaSecret: "JBSWY3DPEHPK3PXP", mfaBackupCodes: hashed,
      },
    });
    userId = u.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
  });

  it("hai mã KHÁC NHAU tiêu thụ song song → CẢ HAI biến mất, không mã nào sống lại", async () => {
    // Cả hai lượt đọc CÙNG một bản mảng (đúng hình dạng hai request song song).
    const anhChup = { id: userId, mfaSecret: null, mfaBackupCodes: [...hashed] };

    const [r1, r2] = await Promise.all([
      verifyMfaChallenge({ ...anhChup }, plain[0]),
      verifyMfaChallenge({ ...anhChup }, plain[1]),
    ]);
    expect(r1, "mã thứ nhất phải dùng được").toBe(true);
    expect(r2, "mã thứ hai phải dùng được").toBe(true);

    const sau = await prisma.user.findUnique({ where: { id: userId }, select: { mfaBackupCodes: true } });
    expect(sau.mfaBackupCodes, "trước khi vá: một trong hai mã đã tiêu bị ghi đè trở lại").toHaveLength(hashed.length - 2);
    expect(sau.mfaBackupCodes).not.toContain(hashed[0]);
    expect(sau.mfaBackupCodes).not.toContain(hashed[1]);
  });

  it("dùng LẠI mã đã tiêu → từ chối (tính dùng-một-lần còn nguyên)", async () => {
    const hienTai = (await prisma.user.findUnique({ where: { id: userId }, select: { mfaBackupCodes: true } })).mfaBackupCodes;
    const ok = await verifyMfaChallenge({ id: userId, mfaSecret: null, mfaBackupCodes: [...hienTai, hashed[0]] }, plain[0]);
    expect(ok, "mã đã bị gỡ khỏi CSDL thì không được chấp nhận nữa").toBe(false);
  });

  it("mã còn hiệu lực vẫn dùng được bình thường (không chặn nhầm)", async () => {
    const hienTai = (await prisma.user.findUnique({ where: { id: userId }, select: { mfaBackupCodes: true } })).mfaBackupCodes;
    const ok = await verifyMfaChallenge({ id: userId, mfaSecret: null, mfaBackupCodes: hienTai }, plain[2]);
    expect(ok).toBe(true);
    const sau = await prisma.user.findUnique({ where: { id: userId }, select: { mfaBackupCodes: true } });
    expect(sau.mfaBackupCodes).toHaveLength(hienTai.length - 1);
  });
});
