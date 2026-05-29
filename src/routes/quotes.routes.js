import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { asyncHandler, requireAuth, requireRole } from "../middleware.js";
import {
  validate,
  QuoteCreateSchema,
  QuoteUpdateSchema,
  ListQuerySchema,
} from "../validators.js";
import { computeQuoteTotals, totalsToJson, D } from "../money.js";
import { nextQuoteNumber } from "../quoteNumber.js";
import { audit } from "../audit.js";
import { snapshotQuoteVersion, diffVersions } from "../quoteVersion.js";
import { startApprovalChain, canApproveLevel, nextPendingLevel, hasEarlierPending, isChainComplete } from "../approval.js";
import { notify } from "../notifications.js";
import { emit as emitWebhook } from "../webhooks.js";

const router = Router();
router.use(requireAuth);

const idParam = z.object({ id: z.coerce.number().int().positive() });

function canEdit(quote, session) {
  if (session.role === "admin" || session.role === "manager") return true;
  return (
    quote.createdById === session.userId &&
    (quote.status === "draft" || quote.status === "rejected")
  );
}

const QUOTE_INCLUDE = {
  company: true,
  sheets: {
    orderBy: { order: "asc" },
    include: {
      template: true,
      items: { orderBy: { order: "asc" } },
    },
  },
  createdBy: { select: { id: true, username: true, displayName: true } },
  approvedBy: { select: { id: true, username: true, displayName: true } },
};

/** Re-serialize Decimal -> number for the API client. Adds computed totals snapshot. */
function presentQuote(q) {
  const totals = computeQuoteTotals(q);
  return {
    ...q,
    vatPercent: Number(q.vatPercent),
    subtotal: Number(q.subtotal ?? totals.subtotal),
    vat: Number(q.vat ?? totals.vat),
    total: Number(q.total ?? totals.total),
    sheets: (q.sheets || []).map((s) => ({
      ...s,
      items: (s.items || []).map((it) => ({
        ...it,
        quantity: Number(it.quantity),
        unitPrice: Number(it.unitPrice),
        days: it.days != null ? Number(it.days) : null,
      })),
    })),
    ...totalsToJson(totals),
  };
}

function buildSheetsCreate(sheets) {
  return (sheets || []).map((s, sIdx) => ({
    templateId: Number(s.templateId),
    name: s.name?.replace(/[\r\n]+/g, " ").trim() || null,
    order: s.order != null ? Number(s.order) : sIdx + 1,
    items: {
      create: (s.items || []).map((it, iIdx) => ({
        order: it.order != null ? Number(it.order) : iIdx + 1,
        name: (it.name || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim(),
        detail: it.detail ? String(it.detail).replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim() : null,
        unit: it.unit?.replace(/[\r\n]+/g, " ").trim() || null,
        quantity: D(it.quantity),
        unitPrice: D(it.unitPrice),
        days: it.days != null ? D(it.days) : null,
        notes: it.notes ? String(it.notes).replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim() : null,
      })),
    },
  }));
}

// LIST
router.get(
  "/",
  validate({ query: ListQuerySchema }),
  asyncHandler(async (req, res) => {
    const { q, status, companyId, from, to, page, size, sort, order } = req.query;
    const where = {};
    if (req.session.role === "employee") where.createdById = req.session.userId;
    if (status) where.status = status;
    if (companyId) where.companyId = companyId;
    if (from || to) {
      where.quoteDate = {};
      if (from) where.quoteDate.gte = from;
      if (to) where.quoteDate.lte = to;
    }
    if (q) {
      where.OR = [
        { quoteNumber: { contains: q, mode: "insensitive" } },
        { title: { contains: q, mode: "insensitive" } },
        { toCompany: { contains: q, mode: "insensitive" } },
      ];
    }
    const [total, rows] = await Promise.all([
      prisma.quote.count({ where }),
      prisma.quote.findMany({
        where,
        orderBy: { [sort]: order },
        include: QUOTE_INCLUDE,
        skip: (page - 1) * size,
        take: size,
      }),
    ]);
    res.json({
      data: rows.map(presentQuote),
      meta: {
        total,
        page,
        size,
        pageCount: Math.ceil(total / size),
        hasNext: page * size < total,
      },
    });
  })
);

// NEXT NUMBER (preview only - real allocation happens at POST time)
router.get(
  "/next-number",
  asyncHandler(async (_req, res) => {
    // Show what the NEXT number WOULD be without actually consuming it.
    const year = new Date().getFullYear();
    const c = await prisma.quoteCounter.findUnique({
      where: { prefix_year: { prefix: "GN", year } },
    });
    const yy = String(year).slice(-2);
    const nn = String((c?.value ?? 0) + 1).padStart(3, "0");
    res.json({ quoteNumber: `GN${yy}${nn}`, note: "Số thực sẽ cấp khi lưu" });
  })
);

// GET ONE
router.get(
  "/:id",
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const quote = await prisma.quote.findFirst({ where: { id }, include: QUOTE_INCLUDE });
    if (!quote) return res.status(404).json({ error: "Không tìm thấy báo giá" });
    if (req.session.role === "employee" && quote.createdById !== req.session.userId) {
      return res.status(403).json({ error: "Bạn không có quyền xem báo giá này" });
    }
    res.json(presentQuote(quote));
  })
);

// CREATE
router.post(
  "/",
  validate({ body: QuoteCreateSchema }),
  asyncHandler(async (req, res) => {
    const b = req.body;
    const company = await prisma.company.findFirst({ where: { id: b.companyId } });
    if (!company) return res.status(400).json({ error: "Không tìm thấy công ty" });

    // Auto-allocate quote number atomically if client didn't supply one
    let quoteNumber = b.quoteNumber;
    if (!quoteNumber) {
      quoteNumber = await nextQuoteNumber("GN");
    } else {
      // includeDeleted: the unique constraint on quoteNumber covers soft-deleted rows too,
      // so we must check across ALL rows — otherwise a number belonging to a soft-deleted
      // quote passes the (soft-delete-filtered) check and then hits the DB constraint as a 500.
      const dup = await prisma.quote.findFirst({ where: { quoteNumber }, includeDeleted: true });
      if (dup) {
        return res.status(409).json({
          error: dup.deletedAt ? "Số báo giá đã dùng (thuộc báo giá đã xoá)" : "Số báo giá đã tồn tại",
        });
      }
    }

    const draft = {
      quoteNumber,
      title: b.title,
      toCompany: b.toCompany,
      toContact: b.toContact || null,
      companyId: company.id,
      fromContact: b.fromContact || "",
      fromPhone: b.fromPhone || company.phone || null,
      fromTitle: b.fromTitle || null,
      fromAddress: b.fromAddress || company.address,
      city: b.city || company.city || "TP. Hồ Chí Minh",
      quoteDate: b.quoteDate || new Date(),
      greeting: b.greeting || undefined,
      vatPercent: D(b.vatPercent),
      notes: b.notes || null,
      status: "draft",
      createdById: req.session.userId,
    };

    // Compute totals from sheets+items BEFORE writing so we store snapshot
    const synthetic = { vatPercent: draft.vatPercent, sheets: b.sheets };
    const t = computeQuoteTotals(synthetic);
    draft.subtotal = t.subtotal;
    draft.vat = t.vat;
    draft.total = t.total;

    const quote = await prisma.$transaction(async (tx) => {
      const created = await tx.quote.create({
        data: { ...draft, sheets: { create: buildSheetsCreate(b.sheets) } },
        include: QUOTE_INCLUDE,
      });
      await snapshotQuoteVersion(tx, created.id, req.session.userId, "create");
      return created;
    });

    await audit(req, "quote.create", {
      resource: "quote",
      resourceId: quote.id,
      after: { quoteNumber: quote.quoteNumber, total: Number(quote.total), status: quote.status },
    });
    emitWebhook("quote.created", { id: quote.id, quoteNumber: quote.quoteNumber, total: Number(quote.total) }).catch(() => {});

    res.status(201).json(presentQuote(quote));
  })
);

// UPDATE
router.put(
  "/:id",
  validate({ params: idParam, body: QuoteUpdateSchema }),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const existing = await prisma.quote.findFirst({ where: { id }, include: QUOTE_INCLUDE });
    if (!existing) return res.status(404).json({ error: "Không tìm thấy báo giá" });
    if (!canEdit(existing, req.session)) {
      return res.status(403).json({ error: "Bạn không thể sửa báo giá này" });
    }

    const b = req.body;
    const data = {};
    // Required (non-null) columns: keep the value as-is; never coerce to null.
    for (const f of ["title", "toCompany", "fromContact", "fromAddress", "city", "greeting"]) {
      if (b[f] !== undefined && b[f] !== null) data[f] = b[f];
    }
    // Nullable columns: empty string clears them to null.
    for (const f of ["toContact", "fromPhone", "fromTitle", "notes"]) {
      if (b[f] !== undefined) data[f] = b[f] || null;
    }
    if (b.quoteDate) data.quoteDate = b.quoteDate;
    if (b.vatPercent !== undefined) data.vatPercent = D(b.vatPercent);
    if (b.companyId !== undefined) data.companyId = b.companyId;
    if (b.quoteNumber !== undefined && b.quoteNumber !== existing.quoteNumber) {
      const dup = await prisma.quote.findFirst({ where: { quoteNumber: b.quoteNumber }, includeDeleted: true });
      if (dup) {
        return res.status(409).json({
          error: dup.deletedAt ? "Số báo giá đã dùng (thuộc báo giá đã xoá)" : "Số báo giá đã tồn tại",
        });
      }
      data.quoteNumber = b.quoteNumber;
    }

    // Sheets full replace + recompute snapshot totals + bump version
    data.currentVersion = (existing.currentVersion ?? 1) + 1;
    let updated;
    if (Array.isArray(b.sheets)) {
      const vatPct = data.vatPercent ?? existing.vatPercent;
      const t = computeQuoteTotals({ vatPercent: vatPct, sheets: b.sheets });
      data.subtotal = t.subtotal;
      data.vat = t.vat;
      data.total = t.total;
      updated = await prisma.$transaction(async (tx) => {
        await tx.quoteSheet.deleteMany({ where: { quoteId: id } });
        const u = await tx.quote.update({
          where: { id },
          data: { ...data, sheets: { create: buildSheetsCreate(b.sheets) } },
          include: QUOTE_INCLUDE,
        });
        await snapshotQuoteVersion(tx, id, req.session.userId, "update");
        return u;
      });
    } else {
      if (data.vatPercent !== undefined) {
        const t = computeQuoteTotals({ vatPercent: data.vatPercent, sheets: existing.sheets });
        data.subtotal = t.subtotal;
        data.vat = t.vat;
        data.total = t.total;
      }
      updated = await prisma.$transaction(async (tx) => {
        const u = await tx.quote.update({ where: { id }, data, include: QUOTE_INCLUDE });
        await snapshotQuoteVersion(tx, id, req.session.userId, "update");
        return u;
      });
    }

    await audit(req, "quote.update", {
      resource: "quote",
      resourceId: id,
      before: { total: Number(existing.total), status: existing.status },
      after: { total: Number(updated.total), status: updated.status },
    });

    res.json(presentQuote(updated));
  })
);

// SUBMIT for approval (uses matrix engine: creates per-level Approval rows)
router.post(
  "/:id/submit",
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const existing = await prisma.quote.findFirst({ where: { id } });
    if (!existing) return res.status(404).json({ error: "Không tìm thấy" });
    if (req.session.role === "employee" && existing.createdById !== req.session.userId) {
      return res.status(403).json({ error: "Không có quyền" });
    }
    if (!["draft", "rejected"].includes(existing.status)) {
      return res.status(400).json({ error: "Chỉ trình duyệt được báo giá ở trạng thái Nháp hoặc Bị từ chối" });
    }
    const quote = await prisma.quote.update({
      where: { id },
      data: { status: "pending", approvedById: null },
      include: QUOTE_INCLUDE,
    });
    await startApprovalChain(id, quote.currentVersion);

    // Notify approvers (skip the creator if they happen to be an approver — they get
    // their own confirmation below).
    const approvers = await prisma.user.findMany({
      where: { active: true, role: { in: ["manager", "admin"] }, id: { not: existing.createdById } },
      select: { id: true },
    });
    for (const u of approvers) {
      await notify(u.id, {
        title: `Báo giá ${quote.quoteNumber} chờ duyệt`,
        body: `${quote.title} • Tổng ${Number(quote.total).toLocaleString("vi-VN")} VND`,
        link: `/#/quotes/${id}`,
        resource: "quote",
        resourceId: id,
        important: true,
      });
    }

    // Confirm to the creator that their quote is now pending.
    await notify(existing.createdById, {
      title: `Báo giá ${quote.quoteNumber} đã gửi duyệt`,
      body: `Đang chờ duyệt. Bạn sẽ được báo khi có kết quả.`,
      link: `/#/quotes/${id}`,
      resource: "quote",
      resourceId: id,
    });

    await audit(req, "quote.submit", { resource: "quote", resourceId: id });
    emitWebhook("quote.submitted", { id, quoteNumber: quote.quoteNumber, total: Number(quote.total) }).catch(() => {});
    res.json(presentQuote(quote));
  })
);

router.post(
  "/:id/approve",
  requireRole("admin", "manager"),
  validate({ params: idParam, body: z.object({ comment: z.string().max(2000).optional() }).default({}) }),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const existing = await prisma.quote.findFirst({ where: { id } });
    if (!existing) return res.status(404).json({ error: "Không tìm thấy" });
    if (existing.status !== "pending") return res.status(400).json({ error: "Báo giá chưa được trình duyệt" });

    const pending = await nextPendingLevel(id, existing.currentVersion);
    if (!pending) return res.status(400).json({ error: "Không có level chờ duyệt" });
    if (await hasEarlierPending(id, existing.currentVersion, pending.level)) {
      return res.status(400).json({ error: "Có level trước chưa duyệt" });
    }
    if (!(await canApproveLevel(id, existing.currentVersion, pending.level, req.session.role))) {
      return res.status(403).json({ error: "Vai trò không được duyệt level này" });
    }

    await prisma.approval.update({
      where: { id: pending.id },
      data: { decision: "approved", approverId: req.session.userId, comment: req.body.comment || null, decidedAt: new Date() },
    });

    const complete = await isChainComplete(id, existing.currentVersion);
    const quote = await prisma.quote.update({
      where: { id },
      data: complete ? { status: "approved", approvedById: req.session.userId } : {},
      include: QUOTE_INCLUDE,
    });

    await notify(existing.createdById, {
      title: `Báo giá ${quote.quoteNumber} ${complete ? "đã được duyệt" : `level ${pending.level} đã duyệt`}`,
      body: complete ? "Có thể gửi cho khách." : "Đang chờ level tiếp theo.",
      link: `/#/quotes/${id}`,
      resource: "quote",
      resourceId: id,
      important: complete,
    });

    await audit(req, "quote.approve", { resource: "quote", resourceId: id, after: { level: pending.level, complete } });
    if (complete) emitWebhook("quote.approved", { id, quoteNumber: quote.quoteNumber, total: Number(quote.total) }).catch(() => {});
    res.json(presentQuote(quote));
  })
);

router.post(
  "/:id/reject",
  requireRole("admin", "manager"),
  validate({ params: idParam, body: z.object({ comment: z.string().max(2000).optional() }).default({}) }),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const existing = await prisma.quote.findFirst({ where: { id } });
    if (!existing) return res.status(404).json({ error: "Không tìm thấy" });
    if (existing.status !== "pending") return res.status(400).json({ error: "Báo giá chưa được trình duyệt" });

    const pending = await nextPendingLevel(id, existing.currentVersion);
    if (pending) {
      await prisma.approval.update({
        where: { id: pending.id },
        data: { decision: "rejected", approverId: req.session.userId, comment: req.body.comment || null, decidedAt: new Date() },
      });
    }
    const quote = await prisma.quote.update({
      where: { id },
      data: { status: "rejected", approvedById: req.session.userId },
      include: QUOTE_INCLUDE,
    });

    await notify(existing.createdById, {
      title: `Báo giá ${quote.quoteNumber} bị từ chối`,
      body: req.body.comment || "Vui lòng kiểm tra lại.",
      link: `/#/quotes/${id}`,
      resource: "quote",
      resourceId: id,
      important: true,
    });

    await audit(req, "quote.reject", { resource: "quote", resourceId: id, after: { reason: req.body.comment || null } });
    emitWebhook("quote.rejected", { id, quoteNumber: quote.quoteNumber }).catch(() => {});
    res.json(presentQuote(quote));
  })
);

// SEND quote to customer (after approval)
router.post(
  "/:id/send",
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const existing = await prisma.quote.findFirst({ where: { id } });
    if (!existing) return res.status(404).json({ error: "Không tìm thấy" });
    if (existing.status !== "approved" && existing.status !== "sent") {
      return res.status(400).json({ error: "Chỉ gửi được sau khi duyệt" });
    }
    const quote = await prisma.quote.update({
      where: { id },
      data: { status: "sent", sentAt: new Date() },
      include: QUOTE_INCLUDE,
    });
    await audit(req, "quote.send", { resource: "quote", resourceId: id });
    emitWebhook("quote.sent", { id, quoteNumber: quote.quoteNumber, total: Number(quote.total) }).catch(() => {});
    res.json(presentQuote(quote));
  })
);

router.post(
  "/:id/mark-converted",
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const quote = await prisma.quote.update({
      where: { id },
      data: { status: "converted", convertedAt: new Date() },
      include: QUOTE_INCLUDE,
    });
    await audit(req, "quote.convert", { resource: "quote", resourceId: id });
    emitWebhook("quote.converted", { id, quoteNumber: quote.quoteNumber, total: Number(quote.total) }).catch(() => {});
    res.json(presentQuote(quote));
  })
);

// VERSIONS
router.get(
  "/:id/versions",
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const versions = await prisma.quoteVersion.findMany({
      where: { quoteId: id },
      orderBy: { versionNo: "desc" },
      select: { id: true, versionNo: true, total: true, createdAt: true, createdById: true },
    });
    res.json({
      data: versions.map((v) => ({ ...v, id: v.id.toString(), total: Number(v.total) })),
    });
  })
);

router.get(
  "/:id/versions/:v",
  validate({ params: z.object({ id: z.coerce.number().int().positive(), v: z.coerce.number().int().min(0) }) }),
  asyncHandler(async (req, res) => {
    const ver = await prisma.quoteVersion.findUnique({
      where: { quoteId_versionNo: { quoteId: req.params.id, versionNo: req.params.v } },
    });
    if (!ver) return res.status(404).json({ error: "Không tìm thấy version" });
    res.json({ ...ver, id: ver.id.toString(), total: Number(ver.total) });
  })
);

router.get(
  "/:id/versions/:a/diff/:b",
  validate({ params: z.object({
    id: z.coerce.number().int().positive(),
    a: z.coerce.number().int().min(0),
    b: z.coerce.number().int().min(0),
  }) }),
  asyncHandler(async (req, res) => {
    const [va, vb] = await Promise.all([
      prisma.quoteVersion.findUnique({ where: { quoteId_versionNo: { quoteId: req.params.id, versionNo: req.params.a } } }),
      prisma.quoteVersion.findUnique({ where: { quoteId_versionNo: { quoteId: req.params.id, versionNo: req.params.b } } }),
    ]);
    if (!va || !vb) return res.status(404).json({ error: "Version không tồn tại" });
    res.json({ from: req.params.a, to: req.params.b, changes: diffVersions(va.payload, vb.payload) });
  })
);

// APPROVAL trail for a quote
router.get(
  "/:id/approvals",
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const rows = await prisma.approval.findMany({
      where: { quoteId: req.params.id },
      orderBy: [{ versionNo: "asc" }, { level: "asc" }],
      include: { approver: { select: { id: true, username: true, displayName: true } } },
    });
    res.json({ data: rows });
  })
);

// SOFT DELETE
router.delete(
  "/:id",
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const existing = await prisma.quote.findFirst({ where: { id } });
    if (!existing) return res.status(404).json({ error: "Không tìm thấy" });
    const isOwnerDraft =
      existing.createdById === req.session.userId &&
      (existing.status === "draft" || existing.status === "rejected");
    if (!isOwnerDraft && req.session.role !== "admin") {
      return res.status(403).json({ error: "Chỉ admin hoặc người tạo (nháp/từ chối) mới được xóa" });
    }
    await prisma.quote.delete({ where: { id } }); // soft delete via middleware
    await audit(req, "quote.delete", { resource: "quote", resourceId: id, before: { status: existing.status } });
    res.json({ ok: true });
  })
);

// DUPLICATE
router.post(
  "/:id/duplicate",
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const src = await prisma.quote.findFirst({ where: { id }, include: QUOTE_INCLUDE });
    if (!src) return res.status(404).json({ error: "Không tìm thấy" });

    const newNumber = await nextQuoteNumber("GN");
    const synthetic = { vatPercent: src.vatPercent, sheets: src.sheets };
    const t = computeQuoteTotals(synthetic);

    const created = await prisma.quote.create({
      data: {
        quoteNumber: newNumber,
        title: src.title + " (copy)",
        toCompany: src.toCompany,
        toContact: src.toContact,
        companyId: src.companyId,
        fromContact: src.fromContact,
        fromPhone: src.fromPhone,
        fromTitle: src.fromTitle,
        fromAddress: src.fromAddress,
        city: src.city,
        quoteDate: new Date(),
        greeting: src.greeting,
        vatPercent: src.vatPercent,
        notes: src.notes,
        status: "draft",
        subtotal: t.subtotal,
        vat: t.vat,
        total: t.total,
        createdById: req.session.userId,
        sheets: {
          create: src.sheets.map((s, sIdx) => ({
            templateId: s.templateId,
            name: s.name,
            order: s.order != null ? s.order : sIdx + 1,
            items: {
              create: s.items.map((it, iIdx) => ({
                order: it.order != null ? it.order : iIdx + 1,
                name: it.name,
                detail: it.detail,
                unit: it.unit,
                quantity: it.quantity,
                unitPrice: it.unitPrice,
                days: it.days,
                notes: it.notes,
              })),
            },
          })),
        },
      },
      include: QUOTE_INCLUDE,
    });
    await audit(req, "quote.duplicate", { resource: "quote", resourceId: created.id, after: { from: src.id, quoteNumber: created.quoteNumber } });
    res.status(201).json(presentQuote(created));
  })
);

export default router;
