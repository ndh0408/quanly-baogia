import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { asyncHandler, requireAuth } from "../middleware.js";
import { validate } from "../validators.js";
import { audit } from "../audit.js";
import { nextCustomerCode } from "../codeAllocator.js";
import { can, canScoped, PERMISSIONS as P } from "../permissions.js";

const router = Router();
router.use(requireAuth);

/** Load a customer and 403 unless the caller may perform `action` (read|manage) on it. */
async function loadAuthorizedCustomer(req, res, action) {
  const customer = await prisma.customer.findFirst({ where: { id: req.params.id } });
  if (!customer) {
    res.status(404).json({ error: "Không tìm thấy khách hàng" });
    return null;
  }
  if (!canScoped(req.session, "customer", action, customer)) {
    res.status(403).json({ error: "Bạn không có quyền với khách hàng này" });
    return null;
  }
  return customer;
}

const idParam = z.object({ id: z.coerce.number().int().positive() });

const CustomerCreate = z.object({
  code: z.string().max(40, "Mã khách hàng tối đa 40 ký tự").optional(),
  name: z.string().min(1, "Vui lòng nhập tên khách hàng").max(200, "Tên khách hàng tối đa 200 ký tự"),
  taxCode: z.string().max(40).optional().nullable(),
  email: z.string().email("Email không hợp lệ").max(120, "Email tối đa 120 ký tự").optional().nullable().or(z.literal("").transform(() => null)),
  phone: z.string().max(40).optional().nullable(),
  address: z.string().max(500).optional().nullable(),
  city: z.string().max(120).optional().nullable(),
  contactName: z.string().max(120).optional().nullable(),
  contactTitle: z.string().max(120).optional().nullable(),
  status: z.enum(["lead", "prospect", "active", "inactive"]).default("lead"),
  tags: z.array(z.string().max(40)).max(20).default([]),
  ownerId: z.coerce.number().int().positive().optional().nullable(),
});

const CustomerUpdate = CustomerCreate.partial();

const ListQuery = z.object({
  q: z.string().max(200).optional(),
  status: z.preprocess((v) => (v === "" ? undefined : v), z.enum(["lead", "prospect", "active", "inactive"]).optional()),
  tag: z.preprocess((v) => (v === "" ? undefined : v), z.string().max(40).optional()),
  ownerId: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(config.MAX_PAGE_SIZE).default(20),
  sort: z.enum(["createdAt", "name", "updatedAt"]).default("createdAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
});

const NoteCreate = z.object({ body: z.string().min(1, "Vui lòng nhập nội dung ghi chú").max(4000, "Ghi chú tối đa 4000 ký tự") });
const FollowUpCreate = z.object({
  dueAt: z.coerce.date({ error: "Vui lòng chọn ngày nhắc" }),
  note: z.string().min(1, "Vui lòng nhập nội dung nhắc").max(1000, "Nội dung tối đa 1000 ký tự"),
  assigneeId: z.coerce.number().int().positive().optional().nullable(),
});

router.get(
  "/",
  validate({ query: ListQuery }),
  asyncHandler(async (req, res) => {
    const { q, status, tag, ownerId, page, size, sort, order } = req.query;
    const where = {};
    if (status) where.status = status;
    // Data isolation: users without "read all" only ever see customers they own.
    if (can(req.session, P.CUSTOMER_READ_ALL)) {
      if (ownerId) where.ownerId = ownerId;
    } else {
      where.ownerId = req.session.userId;
    }
    if (tag) where.tags = { has: tag };
    if (q) {
      where.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { code: { contains: q, mode: "insensitive" } },
        { phone: { contains: q } },
        { email: { contains: q, mode: "insensitive" } },
        { taxCode: { contains: q } },
      ];
    }
    const [total, data] = await Promise.all([
      prisma.customer.count({ where }),
      prisma.customer.findMany({
        where,
        orderBy: { [sort]: order },
        skip: (page - 1) * size,
        take: size,
        include: { owner: { select: { id: true, displayName: true, username: true } } },
      }),
    ]);
    res.json({ data, meta: { total, page, size, pageCount: Math.ceil(total / size) } });
  })
);

router.post(
  "/",
  validate({ body: CustomerCreate }),
  asyncHandler(async (req, res) => {
    let code = req.body.code;
    if (!code) code = await nextCustomerCode("KH");
    else {
      // includeDeleted: the unique constraint on `code` covers soft-deleted rows,
      // so a plain (soft-delete-filtered) check would miss a deleted holder and
      // then hit the DB constraint as a 500. Check across ALL rows for a clean 409.
      const dup = await prisma.customer.findFirst({ where: { code }, includeDeleted: true });
      if (dup) return res.status(409).json({ error: dup.deletedAt ? "Mã thuộc khách hàng đã xoá" : "Mã khách hàng đã tồn tại" });
    }
    // De-dup by tax code: the same company (same MST) entered twice fragments
    // revenue/follow-ups across records. Warn (409) instead of silently duplicating.
    if (req.body.taxCode) {
      const dupTax = await prisma.customer.findFirst({ where: { taxCode: req.body.taxCode.trim() } });
      if (dupTax) return res.status(409).json({ error: `Mã số thuế đã thuộc khách hàng ${dupTax.code} — ${dupTax.name}` });
    }
    const data = { ...req.body, code };
    if (data.taxCode) data.taxCode = data.taxCode.trim();
    // Only privileged users may assign an owner other than themselves.
    if (!can(req.session, P.CUSTOMER_MANAGE_ALL)) data.ownerId = req.session.userId;
    else if (data.ownerId == null) data.ownerId = req.session.userId;
    const customer = await prisma.customer.create({
      data,
      include: { owner: { select: { id: true, displayName: true } } },
    });
    await audit(req, "customer.create", { resource: "customer", resourceId: customer.id, after: customer });
    res.status(201).json(customer);
  })
);

router.get(
  "/:id",
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    if (!(await loadAuthorizedCustomer(req, res, "read"))) return;
    const customer = await prisma.customer.findFirst({
      where: { id: req.params.id },
      include: {
        owner: { select: { id: true, displayName: true, username: true } },
        notes: { orderBy: { createdAt: "desc" }, take: 50 },
        followUps: { orderBy: { dueAt: "asc" }, take: 50 },
      },
    });
    if (!customer) return res.status(404).json({ error: "Không tìm thấy khách hàng" });
    const quoteCount = await prisma.quote.count({ where: { customerId: customer.id } });
    res.json({ ...customer, quoteCount });
  })
);

router.put(
  "/:id",
  validate({ params: idParam, body: CustomerUpdate }),
  asyncHandler(async (req, res) => {
    const before = await loadAuthorizedCustomer(req, res, "manage");
    if (!before) return;
    const data = { ...req.body };
    // Only privileged users may reassign ownership; strip it otherwise.
    if (!can(req.session, P.CUSTOMER_MANAGE_ALL)) delete data.ownerId;
    const customer = await prisma.customer.update({
      where: { id: req.params.id },
      data,
    });
    await audit(req, "customer.update", { resource: "customer", resourceId: customer.id, before, after: customer });
    res.json(customer);
  })
);

router.delete(
  "/:id",
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const before = await loadAuthorizedCustomer(req, res, "manage");
    if (!before) return;
    await prisma.customer.delete({ where: { id: req.params.id } }); // soft delete (db.js middleware)
    await audit(req, "customer.delete", { resource: "customer", resourceId: req.params.id, before });
    res.json({ ok: true });
  })
);

// === Notes ===
router.post(
  "/:id/notes",
  validate({ params: idParam, body: NoteCreate }),
  asyncHandler(async (req, res) => {
    if (!(await loadAuthorizedCustomer(req, res, "manage"))) return;
    const note = await prisma.customerNote.create({
      data: { customerId: req.params.id, body: req.body.body, authorId: req.session.userId },
    });
    await audit(req, "customer.note.add", { resource: "customer", resourceId: req.params.id });
    res.status(201).json(note);
  })
);

// === Follow-ups ===
router.post(
  "/:id/follow-ups",
  validate({ params: idParam, body: FollowUpCreate }),
  asyncHandler(async (req, res) => {
    if (!(await loadAuthorizedCustomer(req, res, "manage"))) return;
    const f = await prisma.followUp.create({
      data: {
        customerId: req.params.id,
        dueAt: req.body.dueAt,
        note: req.body.note,
        assigneeId: req.body.assigneeId ?? req.session.userId,
      },
    });
    res.status(201).json(f);
  })
);

router.post(
  "/follow-ups/:fid/done",
  validate({ params: z.object({ fid: z.coerce.number().int().positive() }) }),
  asyncHandler(async (req, res) => {
    const f = await prisma.followUp.findUnique({
      where: { id: req.params.fid },
      include: { customer: { select: { ownerId: true } } },
    });
    if (!f) return res.status(404).json({ error: "Không tìm thấy công việc cần theo dõi" });
    const owns =
      f.assigneeId === req.session.userId ||
      canScoped(req.session, "customer", "manage", f.customer);
    if (!owns) return res.status(403).json({ error: "Không có quyền với công việc này" });
    const updated = await prisma.followUp.update({
      where: { id: req.params.fid },
      data: { doneAt: new Date() },
    });
    res.json(updated);
  })
);

export default router;
