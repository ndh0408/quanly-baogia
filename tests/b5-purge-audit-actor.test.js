// Cụm B5 — dọn bản xoá-mềm KHÔNG được làm rỗng người-thực-hiện trong nhật ký kiểm toán.
//
// ── LỖI ─────────────────────────────────────────────────────────────────────
// `purgeSoftDeleted` (src/services/adminService.ts) xoá CỨNG hàng User đã xoá-mềm quá hạn. Bộ chặn
// `none: {}` của nó chỉ liệt kê bốn quan hệ NGHIỆP VỤ (createdQuotes / approvedQuotes /
// ownedCustomers / memberQuotes) — KHÔNG có `auditEvents`. Mà khoá ngoại
// `AuditEvent_actorId_fkey` là ON DELETE SET NULL (prisma/migrations/0_init/migration.sql:695),
// nên mỗi hàng User bị xoá cứng kéo theo một lệnh UPDATE hàng loạt đặt `actorId = NULL` trên MỌI
// nhật ký của người đó.
//
// Người trúng đòn đúng là nhóm KHÔNG tạo báo giá bao giờ: hr / accountant / account_hn. Họ vượt cả
// bốn cửa `none: {}`, nên chỉ cần xoá-mềm quá hạn là nhật ký "ai đã làm gì" của họ mất danh tính —
// vẫn còn dòng, nhưng không còn người. Nhật ký kiểm toán chỉ-ghi-thêm mà sửa được bằng một thao tác
// quản trị bình thường thì không còn là bằng chứng.
//
// ── ĐO CÁI GÌ ───────────────────────────────────────────────────────────────
// Dựng một user KHÔNG có báo giá/khách hàng nào (đúng ca hr/kế toán), xoá-mềm với mốc rất xa quá
// khứ, gắn cho họ MỘT hàng AuditEvent, rồi gọi THẲNG purgeSoftDeleted. Khẳng định hai điều bằng SQL
// thô (đọc qua Prisma bị lớp soft-delete lọc mất): hàng User CÒN, và `actorId` của hàng nhật ký VẪN
// trỏ đúng người. Trên mã cũ cả hai đều sai — user biến mất và actorId thành NULL.
//
// MỐC THỜI GIAN CỰC XA (deletedAt năm 1900, days ≈ 110 năm) là CỐ Ý: purgeSoftDeleted quét TOÀN
// BẢNG chứ không lọc theo bài test, nên nếu lấy cutoff gần hiện tại thì nó sẽ xoá cứng dữ liệu
// xoá-mềm của các bộ test khác đang chạy song song. Không hàng thật nào có deletedAt trước 1916.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../src/db.js";
import { purgeSoftDeleted } from "../src/services/adminService.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "AuditEvent" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");

const TAG = `b5purge${Date.now()}`;
const XOA_MEM_LUC = new Date("1900-01-01T00:00:00Z");
const SO_NGAY = 40_000; // ≈ 109 năm → cutoff ≈ 1916, chỉ hàng của bài này lọt vào

describe.runIf(dbAvailable)("purgeSoftDeleted không được làm rỗng actorId của nhật ký", () => {
  let userId;
  let auditId;

  const req = () => ({ body: { days: SO_NGAY }, session: {}, ip: "127.0.0.1", headers: {} });

  beforeAll(async () => {
    const u = await prisma.user.create({
      // role "accountant": đúng nhóm không bao giờ tạo báo giá, tức lọt hết bốn cửa `none: {}` cũ.
      data: { username: `${TAG}-u`, displayName: `${TAG} ketoan`, role: "accountant", passwordHash: "x", deletedAt: XOA_MEM_LUC },
    });
    userId = u.id;
    const ev = await prisma.auditEvent.create({ data: { actorId: userId, action: `${TAG}.hanhdong`, resource: "personnel" } });
    auditId = ev.id;
  });

  afterAll(async () => {
    await prisma.auditEvent.deleteMany({ where: { action: { startsWith: TAG } } }).catch(() => {});
    await prisma.$executeRawUnsafe(`DELETE FROM "User" WHERE id = $1`, userId).catch(() => {});
  });

  it("giữ nguyên hàng User có nhật ký, và actorId vẫn trỏ đúng người", async () => {
    const kq = await purgeSoftDeleted(req());
    expect(kq.result).toBeTruthy();

    const conUser = await prisma.$queryRawUnsafe(`SELECT id FROM "User" WHERE id = $1`, userId);
    expect(conUser.length, "user có nhật ký kiểm toán không được xoá cứng").toBe(1);

    const hang = await prisma.$queryRawUnsafe(`SELECT "actorId" FROM "AuditEvent" WHERE id = $1`, auditId);
    expect(hang.length, "hàng nhật ký phải còn").toBe(1);
    expect(Number(hang[0].actorId), "actorId bị SET NULL → nhật ký mất danh tính người thực hiện").toBe(userId);
  }, 60_000);
});
