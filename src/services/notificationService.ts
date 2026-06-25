// Tầng SERVICE cho domain Thông báo. Bê NGUYÊN logic từ notifications.routes.ts (giữ hành vi y hệt):
// truy vấn Prisma cô lập theo session.userId, phân trang, đánh dấu đã đọc. Route chỉ còn:
// validate → gọi service → res. Mẫu chuẩn theo customerService.ts.
import { prisma } from "../db.js";

export async function listNotifications(req) {
  const where: any = { userId: req.session.userId };
  if (req.query.unread) where.readAt = null;
  const [total, rows] = await Promise.all([
    prisma.notification.count({ where }),
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (req.query.page - 1) * req.query.size,
      take: req.query.size,
    }),
  ]);
  return {
    data: rows.map((r) => ({ ...r, id: r.id.toString() })),
    meta: { total, page: req.query.page, size: req.query.size, pageCount: Math.ceil(total / req.query.size) },
  };
}

export async function unreadCount(req) {
  const count = await prisma.notification.count({ where: { userId: req.session.userId, readAt: null } });
  return { count };
}

export async function markRead(req) {
  await prisma.notification.updateMany({
    where: { id: req.params.id, userId: req.session.userId },
    data: { readAt: new Date() },
  });
  return { ok: true };
}

export async function markAllRead(req) {
  await prisma.notification.updateMany({
    where: { userId: req.session.userId, readAt: null },
    data: { readAt: new Date() },
  });
  return { ok: true };
}
