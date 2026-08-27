// Tầng SERVICE cho domain Admin (thống kê + dọn rác). Bê NGUYÊN logic THUẦN từ admin.routes.ts.
// LƯU Ý: handler `/backup.dump` GIỮ TRỌN ở route — nó spawn pg_dump + setHeader + pipe stream vào res
// (controller HTTP I/O, không phải logic thuần) nên KHÔNG tách. Service chỉ lo phần trả-dữ-liệu thuần.
// Mẫu theo customerService.ts.
import type { Request } from "express";
import { prisma } from "../db.js";
import { audit } from "../audit.js";

/** Thống kê dung lượng — đếm theo từng bảng. Hữu ích cho hoạch định dung lượng. */
export async function storageStats(_req: Request) {
  const [users, customers, products, quotes, items, audits, sessions] = await Promise.all([
    prisma.user.count(),
    prisma.customer.count(),
    prisma.product.count(),
    prisma.quote.count(),
    prisma.quoteItem.count(),
    prisma.auditEvent.count(),
    prisma.$queryRaw<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM user_sessions`.catch(() => [{ n: 0 }]),
  ]);
  return {
    users, customers, products, quotes, items,
    auditEvents: audits,
    sessions: sessions[0]?.n ?? 0,
  };
}

/** Hard-delete các bản xoá-mềm cũ hơn N ngày. */
export async function purgeSoftDeleted(req: Request) {
  const { days } = req.body;
  const cutoff = new Date(Date.now() - days * 86_400_000);
  const base = { deletedAt: { lt: cutoff } };

  // Purge in FK-dependency order, and ONLY hard-delete rows that are no longer
  // referenced by any LIVE row. The relation `none` guards prevent two failure
  // modes the old loop had: (1) hard-deleting a soft-deleted Customer/Company/
  // User still referenced by a live Quote would SET NULL / RESTRICT, silently
  // corrupting or failing; (2) errors were swallowed into the result string so
  // a blocked purge looked successful. Quotes cascade (sheets/items/versions/
  // approvals) so they go first and free up the downstream references.
  const result: Record<string, any> = {};
  const steps: [string, any][] = [
    ["quote", base],
    ["quoteTemplate", { ...base, sheets: { none: {} } }],
    ["customer", { ...base, quotes: { none: {} } }],
    ["company", { ...base, quotes: { none: {} }, templates: { none: {} } }],
    // `auditEvents: { none: {} }` KHÔNG phải một cửa nghiệp vụ như bốn cửa kia — nó giữ NHẬT KÝ.
    // Khoá ngoại AuditEvent_actorId_fkey là ON DELETE SET NULL
    // (prisma/migrations/0_init/migration.sql:695), nên mỗi hàng User xoá cứng kéo theo một UPDATE
    // hàng loạt đặt actorId = NULL trên mọi nhật ký của người đó: dòng còn, người mất.
    //
    // PHẠM VI cửa này RỘNG, không phải một nhóm vai trò hẹp, và cũng không chỉ là đăng nhập THÀNH
    // CÔNG. Sáu đường dưới đây đều truyền `actorId: user.id` vào `audit()`, tức đều để lại hàng
    // AuditEvent mang tên chính chủ tài khoản:
    //   · src/routes/auth.routes.ts:93/135/186 — login.success / logout / login.token
    //   · src/authCore.ts:173/214/245          — login.locked / login.failed / login.mfa.failed
    //   · src/services/authService.ts:248      — user.invite.accept
    //   · src/services/authService.ts:62/72/96 — profile.update / password.change.*
    // Nghĩa là gõ SAI mật khẩu đúng một lần, hoặc chỉ bấm nhận lời mời, là đã đủ để không qua được
    // bước "user" của purge nữa — cho tới khi src/retention.ts:92 dọn hết nhật ký của họ theo
    // RETAIN_AUDIT_DAYS (mặc định 730 ngày, src/config.ts:110). Trên thực tế bước "user" chỉ xoá
    // cứng được tài khoản chưa từng CHẠM vào form đăng nhập lẫn lời mời và cũng không dính bốn
    // quan hệ trên; `result.user = 0` là kết quả BÌNH THƯỜNG chứ không phải dấu hiệu purge hỏng.
    //
    // Đó là đánh đổi CỐ Ý và giữ nguyên: giữ danh tính trong nhật ký kiểm toán đáng hơn giải phóng
    // vài hàng User. Sửa ở tầng ỨNG DỤNG chứ KHÔNG đổi khoá ngoại sang RESTRICT: đường dọn dữ liệu
    // quá hạn (src/retention.ts) phải DELETE được hàng AuditEvent, và nhiều đường xoá cứng hợp lệ
    // khác sẽ ngã thành lỗi 500 thay vì bị bỏ qua êm như ở đây.
    ["user", { ...base, createdQuotes: { none: {} }, approvedQuotes: { none: {} }, ownedCustomers: { none: {} }, memberQuotes: { none: {} }, auditEvents: { none: {} } }],
  ];
  for (const [model, where] of steps) {
    // Let errors propagate to the global handler (500 + logged) instead of being
    // hidden — a failed purge must be visible, not reported as "done".
    const r = await (prisma as any)[model].deleteMany({ where, hardDelete: true });
    result[model] = r?.count ?? 0;
  }
  await audit(req, "admin.purge", { resource: "system", after: { cutoff, result } });
  return { cutoff, result };
}
