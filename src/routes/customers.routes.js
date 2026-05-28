import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { asyncHandler, requireAuth } from "../middleware.js";
import { validate } from "../validators.js";
import { audit } from "../audit.js";
import { nextCustomerCode } from "../codeAllocator.js";

const router = Router();
router.use(requireAuth);

const idParam = z.object({ id: z.coerce.number().int().positive() });

const CustomerCreate = z.object({
  code: z.string().max(40).optional(),
  name: z.string().min(1, "Thiếu tên").max(200),
  taxCode: z.string().max(40).optional().nullable(),
  email: z.string().email().max(120).optional().nullable().or(z.literal("").transform(() => null)),
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
  status: z.enum(["lead", "prospect", "active", "inactive"]).optional(),
  tag: z.string().max(40).optional(),
  ownerId: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(config.MAX_PAGE_SIZE).default(20),
  sort: z.enum(["createdAt", "name", "updatedAt"]).default("createdAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
});

const NoteCreate = z.object({ body: z.string().min(1).max(4000) });
const FollowUpCreate = z.object({
  dueAt: z.coerce.date(),
  note: z.string().min(1).max(1000),
  assigneeId: z.coerce.number().int().positive().optional().nullable(),
});

router.get(
  "/",
  validate({ query: ListQuery }),
  asyncHandler(async (req, res) => {
    const { q, status, tag, ownerId, page, size, sort, order } = req.query;
    const where = {};
    if (status) where.status = status;
    if (ownerId) where.ownerId = ownerId;
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
      const dup = await prisma.customer.findUnique({ where: { code } });
      if (dup) return res.status(409).json({ error: "Mã khách hàng đã tồn tại" });
    }
    const customer = await prisma.customer.create({
      data: { ...req.body, code },
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
    const customer = await prisma.customer.findFirst({
      where: { id: req.params.id },
      include: {
        owner: { select: { id: true, displayName: true, username: true } },
        notes: { orderBy: { createdAt: "desc" }, take: 50 },
        followUps: { orderBy: { dueAt: "asc" }, take: 50 },
      },
    });
    if (!customer) return res.status(404).json({ error: "Không tìm thấy" });
    const quoteCount = await prisma.quote.count({ where: { customerId: customer.id } });
    res.json({ ...customer, quoteCount });
  })
);

router.put(
  "/:id",
  validate({ params: idParam, body: CustomerUpdate }),
  asyncHandler(async (req, res) => {
    const before = await prisma.customer.findFirst({ where: { id: req.params.id } });
    if (!before) return res.status(404).json({ error: "Không tìm thấy" });
    const customer = await prisma.customer.update({
      where: { id: req.params.id },
      data: req.body,
    });
    await audit(req, "customer.update", { resource: "customer", resourceId: customer.id, before, after: customer });
    res.json(customer);
  })
);

router.delete(
  "/:id",
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const before = await prisma.customer.findFirst({ where: { id: req.params.id } });
    if (!before) return res.status(404).json({ error: "Không tìm thấy" });
    await prisma.customer.delete({ where: { id: req.params.id } }); // soft delete
    await audit(req, "customer.delete", { resource: "customer", resourceId: req.params.id, before });
    res.json({ ok: true });
  })
);

// === Notes ===
router.post(
  "/:id/notes",
  validate({ params: idParam, body: NoteCreate }),
  asyncHandler(async (req, res) => {
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
    const updated = await prisma.followUp.update({
      where: { id: req.params.fid },
      data: { doneAt: new Date() },
    });
    res.json(updated);
  })
);

export default router;
