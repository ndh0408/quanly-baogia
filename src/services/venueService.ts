// Tầng SERVICE cho DANH MỤC KÍCH THƯỚC THEO RẠP (Venue + VenueItem).
// Dùng cho gợi ý khi gõ hạng mục trong báo giá + trang "Danh mục rạp".
// Mẫu chuẩn theo customerService.ts: quyền bằng can(), lỗi bằng httpError, ghi audit mọi thao tác ghi.
import type { Request } from "express";
import { prisma, type TxClient } from "../db.js";
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
      // tags đi kèm để gõ "hcm quay bap" trong ô Hạng Mục cũng ra đúng nhóm (không chỉ tên rạp).
      entries.push({ ...itemOut(it), venue: v.name, region: v.region, venueId: v.id, tags: v.tags });
    }
  }
  return { entries, venues: venues.map((v) => ({ id: v.id, name: v.name, region: v.region, cluster: v.cluster, code: v.code, tags: v.tags })) };
}

export async function listVenues(req: Request) {
  requireRead(req);
  const { q, region, full } = req.query as { q?: string; region?: string; full?: string };
  const where: Record<string, unknown> = {};
  if (region) where.region = region;
  if (q) where.OR = [{ name: { contains: q, mode: "insensitive" } }, { code: { contains: q, mode: "insensitive" } }, { cluster: { contains: q, mode: "insensitive" } }, { tags: { has: q } }];
  // full=1: trả KÈM hạng mục (trang quản lý tải 1 lần rồi tìm/lọc tức thì tại client — danh mục
  // chỉ vài trăm rạp/vài trăm hạng mục nên rẻ hơn nhiều so với gọi API mỗi lần gõ).
  const rows = await prisma.venue.findMany({
    where,
    orderBy: [{ region: "asc" }, { name: "asc" }],
    include: full === "1"
      ? { items: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] } }
      : { _count: { select: { items: true } } },
  });
  return {
    data: rows.map((v) => {
      const base = { id: v.id, name: v.name, region: v.region, cluster: v.cluster, code: v.code, tags: v.tags, note: v.note, active: v.active };
      const anyV = v as unknown as { items?: Record<string, any>[]; _count?: { items: number } };
      return anyV.items
        ? { ...base, itemCount: anyV.items.length, items: anyV.items.map(itemOut) }
        : { ...base, itemCount: anyV._count?.items ?? 0 };
    }),
  };
}

/** Mọi từ khóa đang dùng + số rạp mỗi từ — để vẽ hàng chip "Từ khóa nhanh". */
export async function listTags(req: Request) {
  requireRead(req);
  const rows = await prisma.venue.findMany({ select: { tags: true } });
  const count = new Map<string, number>();
  for (const r of rows) for (const t of r.tags) count.set(t, (count.get(t) ?? 0) + 1);
  return { data: [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "vi")).map(([tag, n]) => ({ tag, count: n })) };
}

/** Gắn/gỡ từ khóa cho NHIỀU rạp một lượt (chọn hàng loạt rồi đặt tên nhóm). */
export async function bulkTags(req: Request) {
  requireManage(req);
  const { venueIds, add = [], remove = [] } = req.body as { venueIds: number[]; add?: string[]; remove?: string[] };
  if (!add.length && !remove.length) throw httpError(400, "Chưa chọn từ khóa để gắn hoặc gỡ");
  const venues = await prisma.venue.findMany({ where: { id: { in: venueIds } }, select: { id: true, name: true, tags: true } });
  if (!venues.length) throw httpError(404, "Không tìm thấy rạp nào");
  // Nhãn mới tính ở JS để giữ NGUYÊN quy tắc thứ tự cũ (`new Set`: nhãn cũ giữ vị trí, nhãn mới nối
  // vào cuối) — hàng chip trên giao diện hiện đúng thứ tự này. Nhưng GHI bằng MỘT lệnh UPDATE:
  // vòng `for` cũ bắn tối đa 1000 lệnh rời rạc, không transaction, nên hỏng giữa chừng để lại nửa
  // danh mục mang nhãn mới, nửa kia không — mà người dùng chỉ thấy một lỗi. Một lệnh thì nguyên tử
  // sẵn, không cần transaction lồng (bọc 1000 round-trip vào interactive transaction lại đổi hỏng-
  // một-phần thành hỏng-toàn-phần khi chạm trần thời gian).
  const nhanMoi = venues.map((v) => ({ id: v.id, tags: [...new Set([...v.tags.filter((t) => !remove.includes(t)), ...add])] }));
  // "updatedAt" phải tự đặt: câu raw không đi qua `@updatedAt` của Prisma.
  await prisma.$executeRaw`
    UPDATE "Venue" v
       SET "tags" = ARRAY(SELECT jsonb_array_elements_text(d.tags)), "updatedAt" = now()
      FROM (SELECT (e->>'id')::int AS id, e->'tags' AS tags FROM jsonb_array_elements(${JSON.stringify(nhanMoi)}::jsonb) e) d
     WHERE v.id = d.id`;
  await audit(req, "venue.tags.bulk", { resource: "venue", resourceId: venues[0].id, before: venues, after: { add, remove, count: venues.length } });
  return { ok: true, updated: venues.length };
}

export async function getVenue(req: Request) {
  requireRead(req);
  const id = (req.params as any).id as number;
  const v = await prisma.venue.findUnique({ where: { id }, include: { items: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] } } });
  if (!v) throw httpError(404, "Không tìm thấy rạp");
  return { id: v.id, name: v.name, region: v.region, cluster: v.cluster, code: v.code, tags: v.tags, note: v.note, active: v.active, items: v.items.map(itemOut) };
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
  let venue;
  try {
    venue = await prisma.venue.create({ data: { ...(b as { name: string }), createdById: req.session.userId ?? null } });
  } catch (e) {
    if ((e as { code?: string })?.code === "P2002") throw httpError(409, `Đã có rạp "${b.name}" trong danh mục`);
    throw e;
  }
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
  let venue;
  try {
    venue = await prisma.venue.update({ where: { id }, data: b });
  } catch (e) {
    if ((e as { code?: string })?.code === "P2002") throw httpError(409, `Đã có rạp "${b.name ?? before.name}" trong danh mục`);
    throw e;
  }
  await audit(req, "venue.update", { resource: "venue", resourceId: id, before, after: venue });
  return venue;
}

export async function deleteVenue(req: Request) {
  requireManage(req);
  const id = (req.params as any).id as number;
  const before = await prisma.$transaction(async (tx) => {
    await lockVenueItems(tx, id);
    const before = await tx.venue.findUnique({ where: { id }, include: { items: true } });
    if (!before) throw httpError(404, "Không tìm thấy rạp");
    await tx.venue.delete({ where: { id } });   // items xoá theo (onDelete: Cascade)
    return before;
  });
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
  const result = await prisma.$transaction(async (tx) => {
    for (const venueId of [id, intoId].sort((a, b) => a - b)) await lockVenueItems(tx, venueId);
    const [from, into] = await Promise.all([
      tx.venue.findUnique({ where: { id }, include: { items: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] } } }),
      tx.venue.findUnique({ where: { id: intoId } }),
    ]);
    if (!from) throw httpError(404, "Không tìm thấy rạp nguồn");
    if (!into) throw httpError(404, "Không tìm thấy rạp đích");
    const targetItems = await tx.venueItem.findMany({ where: { venueId: intoId } });
    const max = await tx.venueItem.aggregate({ where: { venueId: intoId }, _max: { sortOrder: true } });
    let next = (max._max.sortOrder ?? 0) + 1;
    // PHÂN LOẠI TRƯỚC, thuần CPU — vòng lặp cũ bắn 1-2 round-trip MỖI hạng mục, tất cả nối đuôi
    // nhau bên trong transaction đang giữ advisory lock của cả hai rạp. Thứ tự duyệt và mọi quy
    // tắc (khớp trùng, gộp metadata, cấp sortOrder nối tiếp) giữ NGUYÊN: `targetItems` vẫn lớn dần
    // theo từng hạng mục đã chuyển, nên một hạng mục nguồn vẫn có thể khớp với hạng mục vừa chuyển.
    const chuyen: { id: number; sortOrder: number }[] = [];
    const xoa: number[] = [];
    const doiMeta: { id: number; data: Record<string, any> }[] = [];
    for (const it of from.items) {
      const target = targetItems.find((candidate) => sameVenueItem(candidate, it));
      if (target) {
        const merged = mergeVenueItemMetadata(target, it);
        // CHỈ ghi khi thật sự đổi. Gộp hai bản chép của cùng một hạng mục (ca thường gặp nhất)
        // cho ra y nguyên bản cũ — bản trước vẫn bắn một UPDATE cho mỗi hạng mục như thế.
        if (khacNhau(target, merged)) doiMeta.push({ id: target.id, data: merged });
        Object.assign(target, merged);
        xoa.push(it.id);
        continue;
      }
      chuyen.push({ id: it.id, sortOrder: next++ });
      targetItems.push(it);
    }
    const movedItems = chuyen.length;
    const removedDuplicates = xoa.length;

    // Một lệnh cho TOÀN BỘ hạng mục chuyển sang (đổi venueId + đánh lại sortOrder theo bảng ánh xạ).
    // "updatedAt" phải tự đặt: câu raw không đi qua `@updatedAt` của Prisma.
    if (chuyen.length) {
      await tx.$executeRaw`
        UPDATE "VenueItem" v
           SET "venueId" = ${intoId}, "sortOrder" = d."sortOrder", "updatedAt" = now()
          FROM (SELECT (e->>'id')::int AS id, (e->>'sortOrder')::int AS "sortOrder"
                  FROM jsonb_array_elements(${JSON.stringify(chuyen)}::jsonb) e) d
         WHERE v.id = d.id`;
    }
    for (const u of doiMeta) await tx.venueItem.update({ where: { id: u.id }, data: u.data });
    if (xoa.length) await tx.venueItem.deleteMany({ where: { id: { in: xoa } } });
    await tx.venue.delete({ where: { id } });
    return { from, into, movedItems, removedDuplicates };
  });
  await audit(req, "venue.merge", { resource: "venue", resourceId: intoId, before: result.from, after: { intoId, movedItems: result.movedItems, removedDuplicates: result.removedDuplicates } });
  return { ok: true, movedItems: result.movedItems, removedDuplicates: result.removedDuplicates, into: { id: result.into.id, name: result.into.name } };
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

const venueItemIdentitySelect = { id: true, name: true, dim: true, widthM: true, heightM: true, unit: true } as const;
const normItemText = (v: unknown) => String(v ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const normItemDim = (v: unknown) => normItemText(v).replace(/\s+/g, "").replace(/×/g, "x").replace(/,/g, ".");
const normItemUnit = (v: unknown) => {
  const unit = normItemText(v);
  return /^m\s*(?:\^?\s*2|²)$/.test(unit) ? "m2" : unit;
};
const normItemNumber = (v: unknown) => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const dimensionsFromText = (v: unknown): [number, number] | null => {
  const nums = normItemDim(v).match(/\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  return nums.length >= 2 ? [nums[0], nums[1]] : null;
};
const dimensionsOf = (it: Record<string, unknown>): [number, number] | null => {
  const w = normItemNumber(it.widthM);
  const h = normItemNumber(it.heightM);
  return w != null && h != null ? [w, h] : dimensionsFromText(it.dim);
};
const sameVenueItem = (a: Record<string, unknown>, b: Record<string, unknown>) => {
  if (normItemText(a.name) !== normItemText(b.name) || normItemUnit(a.unit) !== normItemUnit(b.unit)) return false;
  const ad = dimensionsOf(a);
  const bd = dimensionsOf(b);
  if (ad && bd) return ad[0] === bd[0] && ad[1] === bd[1];
  // Hàng nhập nhanh mới không có kích thước: cùng tên + đơn vị phải khớp hạng mục legacy.
  if (!normItemDim(a.dim) || !normItemDim(b.dim)) return true;
  return normItemDim(a.dim) === normItemDim(b.dim);
};

const mergeVenueItemMetadata = (target: Record<string, any>, source: Record<string, any>) => {
  const targetQty = normItemNumber(target.quantity);
  const sourceQty = normItemNumber(source.quantity);
  if (targetQty != null && sourceQty != null && targetQty !== sourceQty) {
    throw httpError(409, `Hạng mục "${source.name}" có số lượng khác nhau (${targetQty} và ${sourceQty}); hãy sửa cho khớp trước khi gộp rạp`);
  }
  const notes = [target.note, source.note]
    .map((v) => String(v ?? "").trim())
    .filter((v, i, arr) => v && arr.findIndex((x) => normItemText(x) === normItemText(v)) === i);
  const targetCategory = String(target.category ?? "").trim();
  const sourceCategory = String(source.category ?? "").trim();
  if (targetCategory && sourceCategory && normItemText(targetCategory) !== normItemText(sourceCategory)) {
    notes.push(`Nhóm ở rạp nguồn: ${sourceCategory}`);
  }
  const dimensions = dimensionsOf(target) ?? dimensionsOf(source);
  return {
    category: targetCategory || sourceCategory,
    dim: target.dim ?? source.dim,
    widthM: dimensions?.[0] ?? null,
    heightM: dimensions?.[1] ?? null,
    quantity: target.quantity ?? source.quantity,
    note: notes.join("\n") || null,
    active: Boolean(target.active || source.active),
  };
};

/**
 * Bản gộp có ĐỔI gì so với hạng mục đích không? So trên CHUỖI vì `widthM/heightM/quantity` là
 * `Decimal` của Prisma — `===` giữa hai Decimal cùng giá trị vẫn FALSE, và so kiểu đó thì mọi lần
 * gộp đều "có đổi", tức chẳng bỏ được lệnh ghi nào.
 */
const khacNhau = (target: Record<string, any>, merged: Record<string, any>) =>
  Object.keys(merged).some((k) => String(target[k] ?? "") !== String(merged[k] ?? ""));

class VenueItemMovedDuringLock extends Error {}

async function lockVenueItems(tx: TxClient, venueId: number) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`venue-items:${venueId}`})) IS NULL AS "locked"`;
}

export async function createItem(req: Request) {
  requireManage(req);
  const venueId = (req.params as any).id as number;
  const data = itemData(req.body as Record<string, any>);
  const item = await prisma.$transaction(async (tx) => {
    await lockVenueItems(tx, venueId);
    const venue = await tx.venue.findUnique({ where: { id: venueId }, select: { id: true } });
    if (!venue) throw httpError(404, "Không tìm thấy rạp");
    const existing = await tx.venueItem.findMany({ where: { venueId }, select: venueItemIdentitySelect });
    if (existing.some((it) => sameVenueItem(it, data))) throw httpError(409, `Đã có hạng mục "${String(data.name || "").trim()}" trong rạp này`);
    if (data.sortOrder === undefined) {
      const max = await tx.venueItem.aggregate({ where: { venueId }, _max: { sortOrder: true } });
      data.sortOrder = (max._max.sortOrder ?? 0) + 1;
    }
    return tx.venueItem.create({ data: { ...(data as any), venueId } });
  });
  await audit(req, "venue.item.create", { resource: "venueItem", resourceId: item.id, after: item });
  return itemOut(item);
}

export async function updateItem(req: Request) {
  requireManage(req);
  const itemId = (req.params as any).itemId as number;
  const data = itemData(req.body as Record<string, any>);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { before, item } = await prisma.$transaction(async (tx) => {
        const found = await tx.venueItem.findUnique({ where: { id: itemId }, select: { venueId: true } });
        if (!found) throw httpError(404, "Không tìm thấy hạng mục");
        await lockVenueItems(tx, found.venueId);
        const before = await tx.venueItem.findUnique({ where: { id: itemId } });
        if (!before) throw httpError(404, "Không tìm thấy hạng mục");
        if (before.venueId !== found.venueId) throw new VenueItemMovedDuringLock();
        const next = { ...before, ...data };
        const existing = await tx.venueItem.findMany({ where: { venueId: before.venueId, id: { not: itemId } }, select: venueItemIdentitySelect });
        if (!sameVenueItem(before, next) && existing.some((it) => sameVenueItem(it, next))) {
          throw httpError(409, `Đã có hạng mục "${String(next.name || "").trim()}" trong rạp này`);
        }
        const item = await tx.venueItem.update({ where: { id: itemId }, data });
        return { before, item };
      });
      await audit(req, "venue.item.update", { resource: "venueItem", resourceId: itemId, before, after: item });
      return itemOut(item);
    } catch (e) {
      if (e instanceof VenueItemMovedDuringLock && attempt === 0) continue;
      if (e instanceof VenueItemMovedDuringLock) throw httpError(409, "Hạng mục vừa được chuyển sang rạp khác, vui lòng thử lại");
      throw e;
    }
  }
  throw httpError(409, "Hạng mục vừa được chuyển sang rạp khác, vui lòng thử lại");
}

export async function deleteItem(req: Request) {
  requireManage(req);
  const itemId = (req.params as any).itemId as number;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const before = await prisma.$transaction(async (tx) => {
        const found = await tx.venueItem.findUnique({ where: { id: itemId }, select: { venueId: true } });
        if (!found) throw httpError(404, "Không tìm thấy hạng mục");
        await lockVenueItems(tx, found.venueId);
        const before = await tx.venueItem.findUnique({ where: { id: itemId } });
        if (!before) throw httpError(404, "Không tìm thấy hạng mục");
        if (before.venueId !== found.venueId) throw new VenueItemMovedDuringLock();
        await tx.venueItem.delete({ where: { id: itemId } });
        return before;
      });
      await audit(req, "venue.item.delete", { resource: "venueItem", resourceId: itemId, before });
      return { ok: true };
    } catch (e) {
      if (e instanceof VenueItemMovedDuringLock && attempt === 0) continue;
      if (e instanceof VenueItemMovedDuringLock) throw httpError(409, "Hạng mục vừa được chuyển sang rạp khác, vui lòng thử lại");
      throw e;
    }
  }
  throw httpError(409, "Hạng mục vừa được chuyển sang rạp khác, vui lòng thử lại");
}
