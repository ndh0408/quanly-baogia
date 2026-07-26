// Tầng SERVICE cho DANH MỤC KÍCH THƯỚC THEO RẠP (Venue + VenueItem).
// Dùng cho gợi ý khi gõ hạng mục trong báo giá + trang "Danh mục rạp".
// Mẫu chuẩn theo customerService.ts: quyền bằng can(), lỗi bằng httpError, ghi audit mọi thao tác ghi.
import type { Request } from "express";
import { prisma } from "../db.js";
import { audit } from "../audit.js";
import { can, PERMISSIONS as P } from "../permissions.js";
import { httpError } from "../httpError.js";

const requireRead = (req: Request) => {
  if (!can(req.session, P.VENUE_READ) && !can(req.session, P.VENUE_MANAGE)) throw httpError(403, "Bạn không có quyền xem danh mục rạp");
};
const requireManage = (req: Request) => {
  if (!can(req.session, P.VENUE_MANAGE)) throw httpError(403, "Bạn không có quyền sửa danh mục rạp");
};

// Decimal của Prisma → number|null cho JSON gọn (frontend tính m² = w×h).
const num = (v: unknown): number | null => (v == null ? null : Number(v));

const itemOut = (it: Record<string, any>) => ({
  id: it.id,
  venueId: it.venueId,
  cat: it.category,
  name: it.name,
  dim: it.dim,
  w: num(it.widthM),
  h: num(it.heightM),
  unit: it.unit,
  qty: num(it.quantity),
  note: it.note,
  sortOrder: it.sortOrder,
  active: it.active,
});

/**
 * Toàn bộ danh mục PHẲNG cho dropdown gợi ý (mỗi hạng mục kèm tên rạp + vùng).
 * Chỉ trả bản ĐANG DÙNG (active) — bản tắt vẫn nằm trong trang quản lý.
 * Đây là dữ liệu kinh doanh → BẮT BUỘC qua auth (trước đây là file tĩnh public/, ai cũng tải được).
 */
export async function getCatalog(req: Request) {
  requireRead(req);
  const venues = await prisma.venue.findMany({
    where: { active: true },
    orderBy: [{ region: "asc" }, { name: "asc" }],
    include: { items: { where: { active: true }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] } },
  });
  const entries: Record<string, unknown>[] = [];
  for (const v of venues) {
    for (const it of v.items) {
      entries.push({ ...itemOut(it), venue: v.name, region: v.region, venueId: v.id });
    }
  }
  return { entries, venues: venues.map((v) => ({ id: v.id, name: v.name, region: v.region, cluster: v.cluster, code: v.code })) };
}

export async function listVenues(req: Request) {
  requireRead(req);
  const { q, region } = req.query as { q?: string; region?: string };
  const where: Record<string, unknown> = {};
  if (region) where.region = region;
  if (q) where.OR = [{ name: { contains: q, mode: "insensitive" } }, { code: { contains: q, mode: "insensitive" } }, { cluster: { contains: q, mode: "insensitive" } }];
  const rows = await prisma.venue.findMany({
    where,
    orderBy: [{ region: "asc" }, { name: "asc" }],
    include: { _count: { select: { items: true } } },
  });
  // Danh mục nhỏ (vài trăm rạp) → trả hết, không phân trang: trang quản lý lọc/tìm ngay tại client.
  return { data: rows.map((v) => ({ id: v.id, name: v.name, region: v.region, cluster: v.cluster, code: v.code, note: v.note, active: v.active, itemCount: v._count.items })) };
}

export async function getVenue(req: Request) {
  requireRead(req);
  const id = (req.params as any).id as number;
  const v = await prisma.venue.findUnique({ where: { id }, include: { items: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] } } });
  if (!v) throw httpError(404, "Không tìm thấy rạp");
  return { id: v.id, name: v.name, region: v.region, cluster: v.cluster, code: v.code, note: v.note, active: v.active, items: v.items.map(itemOut) };
}

// Trùng tên+vùng → 409 (unique [name, region]) — bắt trước để trả lỗi tiếng Việt rõ ràng.
async function assertNoDup(name: string, region: string, exceptId?: number) {
  const dup = await prisma.venue.findFirst({ where: { name, region, ...(exceptId ? { id: { not: exceptId } } : {}) } });
  if (dup) throw httpError(409, `Đã có rạp "${name}"${region ? ` (${region})` : ""} trong danh mục`);
}

export async function createVenue(req: Request) {
  requireManage(req);
  const b = req.body as Record<string, any>;
  await assertNoDup(b.name, b.region ?? "");
  const venue = await prisma.venue.create({ data: { ...(b as { name: string }), createdById: req.session.userId ?? null } });
  await audit(req, "venue.create", { resource: "venue", resourceId: venue.id, after: venue });
  return venue;
}

export async function updateVenue(req: Request) {
  requireManage(req);
  const id = (req.params as any).id as number;
  const before = await prisma.venue.findUnique({ where: { id } });
  if (!before) throw httpError(404, "Không tìm thấy rạp");
  const b = req.body as Record<string, any>;
  if (b.name != null || b.region != null) await assertNoDup(b.name ?? before.name, b.region ?? before.region, id);
  const venue = await prisma.venue.update({ where: { id }, data: b });
  await audit(req, "venue.update", { resource: "venue", resourceId: id, before, after: venue });
  return venue;
}

export async function deleteVenue(req: Request) {
  requireManage(req);
  const id = (req.params as any).id as number;
  const before = await prisma.venue.findUnique({ where: { id }, include: { items: true } });
  if (!before) throw httpError(404, "Không tìm thấy rạp");
  await prisma.venue.delete({ where: { id } });   // items xoá theo (onDelete: Cascade)
  await audit(req, "venue.delete", { resource: "venue", resourceId: id, before });
  return { ok: true, removedItems: before.items.length };
}

/**
 * GỘP rạp: chuyển hết hạng mục của `id` sang `intoId` rồi xoá `id`.
 * Sinh ra vì sheet gốc gọi cùng một rạp bằng nhiều tên ("LM81" / "Landmark" / "CGV Landmark 81").
 */
export async function mergeVenue(req: Request) {
  requireManage(req);
  const id = (req.params as any).id as number;
  const intoId = (req.body as any).intoId as number;
  if (id === intoId) throw httpError(400, "Không thể gộp một rạp vào chính nó");
  const [from, into] = await Promise.all([
    prisma.venue.findUnique({ where: { id }, include: { items: true } }),
    prisma.venue.findUnique({ where: { id: intoId } }),
  ]);
  if (!from) throw httpError(404, "Không tìm thấy rạp nguồn");
  if (!into) throw httpError(404, "Không tìm thấy rạp đích");
  const moved = await prisma.$transaction(async (tx) => {
    // Nối tiếp sortOrder của rạp đích để thứ tự hạng mục không bị trộn lẫn.
    const max = await tx.venueItem.aggregate({ where: { venueId: intoId }, _max: { sortOrder: true } });
    let next = (max._max.sortOrder ?? 0) + 1;
    for (const it of from.items) {
      await tx.venueItem.update({ where: { id: it.id }, data: { venueId: intoId, sortOrder: next++ } });
    }
    await tx.venue.delete({ where: { id } });
    return from.items.length;
  });
  await audit(req, "venue.merge", { resource: "venue", resourceId: intoId, before: from, after: { intoId, movedItems: moved } });
  return { ok: true, movedItems: moved, into: { id: into.id, name: into.name } };
}

// ── Hạng mục ────────────────────────────────────────────────────────────────
// Body dùng tên NGẮN như frontend (cat/w/h/qty) → map sang cột DB.
const itemData = (b: Record<string, any>) => {
  const d: Record<string, unknown> = {};
  if (b.cat !== undefined) d.category = b.cat;
  if (b.name !== undefined) d.name = b.name;
  if (b.dim !== undefined) d.dim = b.dim;
  if (b.w !== undefined) d.widthM = b.w;
  if (b.h !== undefined) d.heightM = b.h;
  if (b.unit !== undefined) d.unit = b.unit;
  if (b.qty !== undefined) d.quantity = b.qty;
  if (b.note !== undefined) d.note = b.note;
  if (b.sortOrder !== undefined) d.sortOrder = b.sortOrder;
  if (b.active !== undefined) d.active = b.active;
  return d;
};

export async function createItem(req: Request) {
  requireManage(req);
  const venueId = (req.params as any).id as number;
  const venue = await prisma.venue.findUnique({ where: { id: venueId } });
  if (!venue) throw httpError(404, "Không tìm thấy rạp");
  const data = itemData(req.body as Record<string, any>);
  if (data.sortOrder === undefined) {
    const max = await prisma.venueItem.aggregate({ where: { venueId }, _max: { sortOrder: true } });
    data.sortOrder = (max._max.sortOrder ?? 0) + 1;
  }
  const item = await prisma.venueItem.create({ data: { ...(data as any), venueId } });
  await audit(req, "venue.item.create", { resource: "venueItem", resourceId: item.id, after: item });
  return itemOut(item);
}

export async function updateItem(req: Request) {
  requireManage(req);
  const itemId = (req.params as any).itemId as number;
  const before = await prisma.venueItem.findUnique({ where: { id: itemId } });
  if (!before) throw httpError(404, "Không tìm thấy hạng mục");
  const item = await prisma.venueItem.update({ where: { id: itemId }, data: itemData(req.body as Record<string, any>) });
  await audit(req, "venue.item.update", { resource: "venueItem", resourceId: itemId, before, after: item });
  return itemOut(item);
}

export async function deleteItem(req: Request) {
  requireManage(req);
  const itemId = (req.params as any).itemId as number;
  const before = await prisma.venueItem.findUnique({ where: { id: itemId } });
  if (!before) throw httpError(404, "Không tìm thấy hạng mục");
  await prisma.venueItem.delete({ where: { id: itemId } });
  await audit(req, "venue.item.delete", { resource: "venueItem", resourceId: itemId, before });
  return { ok: true };
}
