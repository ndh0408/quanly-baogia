import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { asyncHandler } from "../middleware.js";
import { validate } from "../validators.js";
import { requirePermission, PERMISSIONS } from "../permissions.js";

const router = Router();
// Honour the permission map (manager holds audit:view) instead of admin-only,
// so the nav gate (can('audit:view')) and the route agree.
router.use(requirePermission(PERMISSIONS.AUDIT_VIEW));

const Query = z.object({
  actorId: z.coerce.number().int().positive().optional(),
  action: z.string().max(80).optional(),
  resource: z.string().max(40).optional(),
  resourceId: z.string().max(80).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(config.MAX_PAGE_SIZE).default(50),
});

// Resolve resourceId → TÊN người-đọc-được (admin không phải dân code → cần thấy "Báo giá GN26043 — Đại
// nhạc hội" thay vì "#114"; "Nhân sự: Nguyễn Văn A" thay vì "#1"). Gộp truy vấn theo loại;
// includeDeleted để lấy tên cả bản ghi ĐÃ XÓA (vd action "Xóa báo giá").
async function resolveTargetLabels(rows: { resource: string | null; resourceId: string | null }[]) {
  const ids: Record<string, Set<number>> = { quote: new Set(), personnel: new Set(), user: new Set(), customer: new Set(), employee: new Set() };
  for (const r of rows) {
    if (!r.resource || !r.resourceId || !(r.resource in ids)) continue;
    const n = Number(r.resourceId);
    if (Number.isInteger(n) && n > 0) ids[r.resource]!.add(n);
  }
  const map = new Map<string, string>();
  const inc = { includeDeleted: true };
  await Promise.all(([
    ids.quote.size && prisma.quote.findMany({ where: { id: { in: [...ids.quote] } }, select: { id: true, projectCode: true, quoteNumber: true, title: true }, ...inc } as any)
      .then((qs: any[]) => qs.forEach((q) => map.set(`quote:${q.id}`, `${q.projectCode || q.quoteNumber || "#" + q.id}${q.title ? " — " + q.title : ""}`))),
    ids.personnel.size && prisma.personnelRecord.findMany({ where: { id: { in: [...ids.personnel] } }, select: { id: true, fullName: true }, ...inc } as any)
      .then((ps: any[]) => ps.forEach((p) => map.set(`personnel:${p.id}`, p.fullName))),
    ids.user.size && prisma.user.findMany({ where: { id: { in: [...ids.user] } }, select: { id: true, displayName: true, username: true }, ...inc } as any)
      .then((us: any[]) => us.forEach((u) => map.set(`user:${u.id}`, u.displayName || u.username))),
    ids.customer.size && prisma.customer.findMany({ where: { id: { in: [...ids.customer] } }, select: { id: true, code: true, name: true }, ...inc } as any)
      .then((cs: any[]) => cs.forEach((c) => map.set(`customer:${c.id}`, `${c.code} — ${c.name}`))),
    ids.employee.size && prisma.employee.findMany({ where: { id: { in: [...ids.employee] } }, select: { id: true, fullName: true }, ...inc } as any)
      .then((es: any[]) => es.forEach((e) => map.set(`employee:${e.id}`, e.fullName))),
  ].filter(Boolean)) as Promise<void>[]);
  return map;
}

router.get(
  "/",
  validate({ query: Query }),
  asyncHandler(async (req: Request, res: Response) => {
    const { actorId, action, resource, resourceId, from, to } = req.query;
    // page/size đã được validate() coerce sang number runtime (z.coerce.number().default).
    // Number() giữ nguyên giá trị + giữ default cũ (1 / 50) nếu thiếu.
    const page = Number(req.query.page) || 1;
    const size = Number(req.query.size) || 50;
    const where: Record<string, any> = {};
    if (actorId) where.actorId = actorId;
    if (action) where.action = action;
    if (resource) where.resource = resource;
    if (resourceId) where.resourceId = resourceId;
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = from;
      if (to) where.createdAt.lte = to;
    }

    const [total, rows] = await Promise.all([
      prisma.auditEvent.count({ where }),
      prisma.auditEvent.findMany({
        where,
        orderBy: { createdAt: "desc" },
        include: { actor: { select: { id: true, username: true, displayName: true } } },
        skip: (page - 1) * size,
        take: size,
      }),
    ]);

    // Least-privilege: the before/after snapshots (and IP/UA) can contain full PII
    // of other users/customers. Only admins see the raw payload; managers get the
    // who/what/when trail with PII stripped.
    const isAdmin = req.session.role === "admin";
    // Tên thật cho cột "Đối tượng" — CHỈ admin (cùng nhóm bị strip với before/after/ip). Lý do: tên
    // hồ sơ/khách/báo giá là PII; manager bị owner-scoping (không thấy hồ sơ người khác) nên KHÔNG được
    // lộ tên chéo qua nhật ký → manager giữ '#id'. Bỏ luôn truy vấn resolve cho non-admin (đỡ tải).
    const targets = isAdmin ? await resolveTargetLabels(rows) : null;
    const data = rows.map((r) => {
      if (!isAdmin) {
        // Strip PII-bearing fields for non-admins via destructuring (these props
        // are required on the row type, so `delete` is not permitted under strict).
        const { before, after, ip, userAgent, ...rest } = r;
        return { ...rest, id: r.id.toString(), targetLabel: null }; // BigInt id → string for JSON
      }
      const targetLabel = r.resource && r.resourceId ? (targets!.get(`${r.resource}:${r.resourceId}`) ?? null) : null;
      return { ...r, id: r.id.toString(), targetLabel }; // BigInt id → string for JSON
    });
    res.json({ data, meta: { total, page, size, pageCount: Math.ceil(total / size) } });
  })
);

export default router;
