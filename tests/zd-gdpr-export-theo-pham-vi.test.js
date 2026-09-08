// GDPR SELF-EXPORT PHẢI KẸP PHẠM VI QUYỀN HIỆN TẠI — chốt hồi quy, phát hiện qua ultracode audit
// 2026-09-07 (src/services/gdprService.ts exportUser).
//
// Nhân viên bị gỡ sạch quyền báo giá/khách hàng (chuyển sang tài khoản "chi phí") nhận 403 ở MỌI đường
// đọc bình thường, nhưng GET /api/gdpr/me/export chỉ có requireAuth và truy vấn thẳng createdById/
// ownerId → tải về toàn bộ báo giá + 5000 khách hàng đầy đủ liên hệ (dữ liệu bên thứ ba).
// Nay exportUser(userId, session) kẹp thêm quoteScopeWhere/readScopeWhere; đường admin xuất hộ
// (không truyền session) giữ nguyên.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../src/db.js";
import { exportUser } from "../src/services/gdprService.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "Customer" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");

const TAG = `gdprsc${Date.now()}`;

describe.runIf(dbAvailable)("gdpr exportUser — phạm vi quyền", () => {
  let u, khach;
  beforeAll(async () => {
    u = await prisma.user.create({ data: { username: `${TAG}-u`, displayName: TAG, role: "manager", passwordHash: "x" } });
    khach = await prisma.customer.create({ data: { code: `${TAG}-KH`, name: `${TAG} Khách`, ownerId: u.id } });
  });
  afterAll(async () => {
    await prisma.customer.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
  });

  it("phiên bị GỠ SẠCH quyền khách hàng/báo giá → bản xuất KHÔNG chứa khách hàng (fail-closed như mọi đường đọc)", async () => {
    // permissions KHÔNG rỗng để là nguồn quyền (rỗng = theo role) — và không có customer:read:*/quote:read:*.
    const phien = { userId: u.id, role: "manager", permissions: ["personnel:read:own"] };
    const out = await exportUser(u.id, phien);
    expect(out.customers, "trước khi vá: 1 khách hàng đầy đủ liên hệ").toEqual([]);
    expect(out.quotes).toEqual([]);
    expect(out.user?.id, "phần dữ liệu của CHÍNH người xin vẫn phải có").toBe(u.id);
  });

  it("phiên có customer:read:own → vẫn xuất khách hàng MÌNH sở hữu (không chặn nhầm)", async () => {
    const phien = { userId: u.id, role: "manager", permissions: ["customer:read:own"] };
    const out = await exportUser(u.id, phien);
    expect(out.customers.map((c) => c.id)).toEqual([khach.id]);
  });

  it("đường admin xuất hộ (không truyền session) → giữ nguyên hành vi cũ", async () => {
    const out = await exportUser(u.id);
    expect(out.customers.map((c) => c.id)).toEqual([khach.id]);
  });
});
