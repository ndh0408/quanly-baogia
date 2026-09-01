// Tầng SERVICE cho domain GDPR (xuất dữ liệu + quyền-được-quên). Bê NGUYÊN logic THUẦN từ
// gdpr.routes.ts: truy vấn tổng hợp dữ liệu cá nhân, sinh các prisma-op vô danh hoá + thu hồi token.
// LƯU Ý: thao tác res (setHeader/end/clearCookie) và session.destroy GIỮ trong route — đó là controller
// HTTP, không phải logic thuần. Service chỉ trả DỮ LIỆU / thực thi transaction + audit. Mẫu theo customerService.ts.
import type { Request } from "express";
import { prisma } from "../db.js";
import { audit } from "../audit.js";
import { httpError } from "../httpError.js";
import { bangNoiBoTheoSheet } from "./quoteService.js";

/**
 * Tuần tự hoá khối xuất — MỘT lần stringify duy nhất cho cả đường xuất, và là chỗ DUY NHẤT xử lý
 * BigInt (AuditEvent/Notification/RefreshToken đều có id BigInt, thứ JSON.stringify trần sẽ ném).
 *
 * Trước đây việc này làm hai lần: `bigIntToString` chạy JSON.stringify + JSON.parse trên TOÀN BỘ cây
 * (dựng thêm một chuỗi đầy đủ và một cây object đầy đủ trong heap), rồi route lại JSON.stringify lần
 * nữa để gửi đi. Ba bản sao cho một lần tải về. Bỏ vòng parse ấy không đổi một byte nào của JSON gửi
 * ra: Decimal của Prisma có toJSON trả chuỗi và Date có toJSON trả ISO, y hệt vòng cũ tạo ra.
 */
export function serializeExport(data: unknown): string {
  return JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2);
}

/**
 * Prisma ops that erase a user's OWN personal data and lock the account.
 * Returns an array to be passed to prisma.$transaction([...]) so token revocation
 * and PII anonymization commit atomically. Shared by self-delete and admin-delete.
 *
 * Note: quotes/customers owned by the user are intentionally NOT touched here —
 * they are business records (and customer rows are other people's personal data),
 * so they are retained with their ownership link, not anonymized.
 */
function anonymizeUserOps(id: number) {
  return [
    prisma.refreshToken.updateMany({ where: { userId: id }, data: { revokedAt: new Date() } }),
    prisma.user.update({
      where: { id },
      data: {
        username: `deleted-${id}-${Date.now()}`,
        passwordHash: "DELETED",
        displayName: "(deleted user)",
        email: null,
        phone: null,
        title: null,
        mfaSecret: null,
        mfaBackupCodes: [],
        mfaEnabled: false,
        active: false,
        deletedAt: new Date(),
      },
    }),
  ];
}

/** Tổng hợp toàn bộ dữ liệu cá nhân của 1 user thành object xuất khẩu. Tuần tự hoá: `serializeExport`. */
export async function exportUser(userId: number) {
  const [user, quotes, customers, auditEvents, refreshTokens, notifications] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, username: true, displayName: true, email: true, phone: true,
        title: true, role: true, active: true,
        lastLoginAt: true, lastLoginIp: true, createdAt: true,
      },
    }),
    // Ba cột BLOB bị loại khỏi bản xuất — lý do KHÁC NHAU cho từng cột, không phải "cho nhẹ":
    //   · QuoteItem.images  — mảng data-URL base64, trần validator là 10 ảnh × 2.800.000 ký tự MỖI
    //     hạng mục (src/validators.ts:161-163). Một báo giá cỡ trung đã vượt xa bộ nhớ hợp lý, mà
    //     take ở đây là 1000 báo giá.
    //   · Quote.customerLogo — data-URL base64 logo của KHÁCH HÀNG, không phải dữ liệu cá nhân của
    //     người xin bản xuất: đưa vào một tệp tải-về là tự tạo đường rò.
    //
    // CÒN `QuoteSheet.extraTables` THÌ GIỮ — CHỈ CẮT RIÊNG ẢNH, VÀ CẮT NGAY TẠI SQL.
    //
    // Bản trước dùng `omit: { extraTables: true }` và chú thích đi kèm khẳng định "mọi trường
    // chữ/số của báo giá, sheet và hạng mục vẫn nguyên". Sai: `extraTables` là MỘT cột jsonb, cắt
    // nó là cắt cả nội dung — các bảng nội bộ Chi Phí HCM / Giá Hà Nội / Phí Khách Hàng, gồm
    // {name, detail, unit, quantity, unitPrice, days, notes} của từng dòng. Đó là dữ liệu do CHÍNH
    // người xin bản xuất nhập vào báo giá của họ; một bản xuất GDPR thiếu nó là thiếu thật.
    //
    // Nhưng cắt ở tầng JS cũng sai, và tests/b5-gdpr-export-anh.test.js đo được: ảnh `paidProof`
    // vẫn đi qua dây rồi mới bị bỏ (2,4 MB thay vì 0,36 MB cho cùng bộ dữ liệu). Nên dùng lại
    // `bangNoiBoTheoSheet` của quoteService — câu SQL DUY NHẤT trong repo cắt `paidProof` — thay vì
    // viết bản thứ hai. Hai bản chép của quy tắc cắt ấy chắc chắn sẽ trôi khỏi nhau.
    prisma.quote.findMany({
      where: { createdById: userId },
      omit: { customerLogo: true },
      include: { sheets: { omit: { extraTables: true }, include: { items: { omit: { images: true } } } } },
      take: 1000,
    }).then(async (qs: any[]) => {
      if (!qs.length) return qs;
      const bang = await bangNoiBoTheoSheet(qs.map((q) => q.id));
      const theoSheet = new Map<number, any>();
      for (const r of bang) theoSheet.set(r.sheetId, r.tables);
      return qs.map((q) => ({
        ...q,
        sheets: (q.sheets || []).map((sh: any) => ({ ...sh, extraTables: theoSheet.get(sh.id) ?? [] })),
      }));
    }),
    prisma.customer.findMany({ where: { ownerId: userId }, take: 5000 }),
    prisma.auditEvent.findMany({
      where: { actorId: userId },
      orderBy: { createdAt: "desc" },
      take: 5000,
    }),
    prisma.refreshToken.findMany({
      where: { userId },
      select: { id: true, family: true, ip: true, userAgent: true, expiresAt: true, revokedAt: true, createdAt: true },
    }),
    prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 5000,
    }),
  ]);

  return {
    exportedAt: new Date(),
    format: "qly-gdpr-export/1.0",
    user,
    quotes,
    customers,
    auditEvents,
    refreshTokens,
    notifications,
  };
}

/**
 * Xoá tài khoản của CHÍNH user (right-to-erasure) — phần LOGIC THUẦN: transaction vô danh hoá + audit.
 * Việc destroy session + clearCookie GIỮ ở route (controller HTTP) vì thao tác res/session.
 */
export async function deleteSelf(req: Request) {
  const id = (req.session as any).userId;
  await prisma.$transaction(anonymizeUserOps(id));
  await audit(req, "gdpr.delete.self", { resource: "user", resourceId: id, actorId: id });
}

/** Admin xoá tài khoản người dùng khác: chặn tự-xoá, 404 nếu không có, rồi transaction + audit. */
export async function deleteByAdmin(req: Request) {
  if ((req.params as any).id === req.session.userId) {
    throw httpError(400, "Không thể tự xóa chính mình ở đây. Vui lòng dùng chức năng \"Xóa tài khoản của tôi\".");
  }
  const target = await prisma.user.findUnique({ where: { id: (req.params as any).id }, select: { id: true } });
  if (!target) throw httpError(404, "Không tìm thấy người dùng");
  await prisma.$transaction(anonymizeUserOps((req.params as any).id));
  await audit(req, "gdpr.delete.by_admin", { resource: "user", resourceId: (req.params as any).id });
  return { ok: true };
}
