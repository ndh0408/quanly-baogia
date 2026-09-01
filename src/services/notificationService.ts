// Tầng SERVICE cho domain Thông báo. Bê NGUYÊN logic từ notifications.routes.ts (giữ hành vi y hệt):
// truy vấn Prisma cô lập theo session.userId, phân trang, đánh dấu đã đọc. Route chỉ còn:
// validate → gọi service → res. Mẫu chuẩn theo customerService.ts.
import type { Request } from "express";
import { prisma } from "../db.js";
import { phanTrang } from "../pagination.js";

export async function listNotifications(req: Request) {
  const where: any = { userId: req.session.userId };
  if (req.query.unread) where.readAt = null;
  const [total, rows] = await Promise.all([
    prisma.notification.count({ where }),
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: ((req.query as any).page - 1) * (req.query as any).size,
      take: (req.query as any).size,
    }),
  ]);
  return phanTrang(
    rows.map((r) => ({ ...r, id: r.id.toString() })),
    total,
    (req.query as any).page,
    (req.query as any).size,
  );
}

export async function unreadCount(req: Request) {
  const count = await prisma.notification.count({ where: { userId: req.session.userId, readAt: null } });
  return { count };
}

export async function markRead(req: Request) {
  await prisma.notification.updateMany({
    where: { id: (req.params as any).id, userId: req.session.userId },
    data: { readAt: new Date() },
  });
  return { ok: true };
}

export async function markAllRead(req: Request) {
  await prisma.notification.updateMany({
    where: { userId: req.session.userId, readAt: null },
    data: { readAt: new Date() },
  });
  return { ok: true };
}
