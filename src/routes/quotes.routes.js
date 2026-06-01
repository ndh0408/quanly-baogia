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
import { can, canOnQuote, requirePermission, quoteScopeWhere, PERMISSIONS as P } from "../permissions.js";

const router = Router();
router.use(requireAuth);

const idParam = z.object({ id: z.coerce.number().int().positive() });

// Editing rule: holders of quote:update:all may edit anything; owners may edit
// their own only while it's still draft/rejected.
function canEdit(quote, session) {
  if (canOnQuote(session, "update", quote)) {
    if (session.role === "admin" || session.role === "manager") return true;
    return quote.status === "draft" || quote.status === "rejected";
  }
  return false;
}

/** Load a quote by :id and 403 unless the caller may `action` it. Used by sub-resources. */
async function loadAuthorizedQuote(req, res, action = "read") {
  const quote = await prisma.quote.findFirst({
    where: { id: req.params.id },
    include: { members: { select: { id: true } } },
  });
  if (!quote) {
    res.status(404).json({ error: "Không tìm thấy báo giá" });
    return null;
  }
  if (!canOnQuote(req.session, action, quote)) {
    res.status(403).json({ error: "Bạn không có quyền với báo giá này" });
    return null;
  }
  return quote;
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
  members: { select: { id: true, username: true, displayName: true } },
};

/** Re-serialize Decimal -> number for the API client. Adds computed totals snapshot. */
function presentQuote(q, { includeLogo = false } = {}) {
  const totals = computeQuoteTotals(q);
  const out = {
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
  // base64 logo is large — only ship it when explicitly needed (single quote fetch).
  if (!includeLogo) delete out.customerLogo;
  return out;
}

/** True if every sheet's templateId is an active template belonging to companyId. */
async function templatesBelongToCompany(sheets, companyId) {
  const ids = [...new Set((sheets || []).map((s) => Number(s.templateId)).filter(Boolean))];
  if (!ids.length) return true;
  const found = await prisma.quoteTemplate.findMany({
    where: { id: { in: ids }, companyId, active: true },
    select: { id: true },
  });
  return found.length === ids.length;
}

function buildSheetsCreate(sheets) {
  return (sheets || []).map((s, sIdx) => ({
    templateId: Number(s.templateId),
    name: s.name?.replace(/[\r\n]+/g, " ").trim() || null,
    order: s.order != null ? Number(s.order) : sIdx + 1,
    items: {
      create: (s.items || []).map((it, iIdx) => ({
        order: it.order != null ? Number(it.order) : iIdx + 1,
        kind: ["info", "sub"].includes(it.kind) ? it.kind : "item",
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
    // Visibility scope (admin=all, manager=own, employee=member) combined with
    // the user's filters via AND so a scope-OR doesn't clash with the search-OR.
    const filters = [quoteScopeWhere(req.session)];
    if (status) filters.push({ status });
    if (companyId) filters.push({ companyId });
    if (from || to) {
      const range = {};
      if (from) range.gte = from;
      if (to) range.lte = to;
      filters.push({ quoteDate: range });
    }
    if (q) {
      filters.push({ OR: [
        { quoteNumber: { contains: q, mode: "insensitive" } },
        { title: { contains: q, mode: "insensitive" } },
        { toCompany: { contains: q, mode: "insensitive" } },
      ] });
    }
    const where = { AND: filters };
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
  validate({ query: z.object({ companyId: z.coerce.number().int().positive().optional() }) }),
  asyncHandler(async (req, res) => {
    // Show what the NEXT number WOULD be without actually consuming it.
    // Prefix is per-company (GN…, CLF…) so the preview matches the chosen company.
    let prefix = "GN";
    if (req.query.companyId) {
      const company = await prisma.company.findFirst({ where: { id: req.query.companyId } });
      if (company) prefix = company.quotePrefix || "GN";
    }
    const year = new Date().getFullYear();
    const c = await prisma.quoteCounter.findUnique({
      where: { prefix_year: { prefix, year } },
    });
    const yy = String(year).slice(-2);
    const nn = String((c?.value ?? 0) + 1).padStart(3, "0");
    res.json({ quoteNumber: `${prefix}${yy}${nn}`, prefix, note: "Số thực sẽ cấp khi lưu" });
  })
);

// Active users that can be added as members of a quote.
// Any authenticated user can read this (it only powers the "add members" picker
// on quotes they own); it returns names/roles only.
router.get(
  "/assignable-users",
  asyncHandler(async (req, res) => {
    const users = await prisma.user.findMany({
      where: { active: true },
      select: { id: true, displayName: true, username: true, role: true },
      orderBy: { displayName: "asc" },
    });
    res.json({ data: users });
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
    if (!canOnQuote(req.session, "read", quote)) {
      return res.status(403).json({ error: "Bạn không có quyền xem báo giá này" });
    }
    res.json(presentQuote(quote, { includeLogo: true }));
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
    if (!(await templatesBelongToCompany(b.sheets, company.id))) {
      return res.status(400).json({ error: "Có mẫu báo giá không thuộc công ty đã chọn (hoặc đã ngừng dùng)" });
    }

    // An employee must assign a manager to oversee the quote (so a manager is in the loop).
    const memberConnect = [{ id: req.session.userId }];
    if (req.session.role === "employee") {
      if (!b.managerId) return res.status(400).json({ error: "Nhân viên phải chọn 1 quản lý phụ trách báo giá" });
      const mgr = await prisma.user.findFirst({ where: { id: b.managerId, active: true } });
      if (!mgr || !["manager", "admin"].includes(mgr.role)) {
        return res.status(400).json({ error: "Quản lý phụ trách không hợp lệ" });
      }
      memberConnect.push({ id: mgr.id });
    }

    // Auto-allocate quote number atomically if client didn't supply one.
    // Each issuing company has its own prefix + sequence (GN…, CLF…).
    let quoteNumber = b.quoteNumber;
    if (!quoteNumber) {
      quoteNumber = await nextQuoteNumber(company.quotePrefix || "GN");
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
      toEmail: b.toEmail || null,
      companyId: company.id,
      fromContact: b.fromContact || "",
      fromPhone: b.fromPhone || company.phone || null,
      fromTitle: b.fromTitle || null,
      fromAddress: b.fromAddress || company.address,
      city: b.city || company.city || "TP. Hồ Chí Minh",
      quoteDate: b.quoteDate || new Date(),
      validUntil: b.validUntil || null,
      customerId: b.customerId ?? null,
      greeting: b.greeting || undefined,
      vatPercent: D(b.vatPercent),
      discount: D(b.discount || 0),
      showTotals: b.showTotals !== false,
      notes: b.notes || null,
      customerLogo: b.customerLogo || null,
      status: "draft",
      createdById: req.session.userId,
    };

    // Compute totals from sheets+items BEFORE writing so we store snapshot
    const synthetic = { vatPercent: draft.vatPercent, discount: draft.discount, sheets: b.sheets };
    const t = computeQuoteTotals(synthetic);
    draft.subtotal = t.subtotal;
    draft.vat = t.vat;
    draft.discount = t.discount;
    draft.total = t.total;

    const quote = await prisma.$transaction(async (tx) => {
      const created = await tx.quote.create({
        // Creator (+ overseeing manager for employee-created quotes) are members.
        data: { ...draft, sheets: { create: buildSheetsCreate(b.sheets) }, members: { connect: memberConnect } },
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

    res.status(201).json(presentQuote(quote, { includeLogo: true }));
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
    if (Array.isArray(b.sheets)) {
      const targetCompany = b.companyId ?? existing.companyId;
      if (!(await templatesBelongToCompany(b.sheets, targetCompany))) {
        return res.status(400).json({ error: "Có mẫu báo giá không thuộc công ty đã chọn (hoặc đã ngừng dùng)" });
      }
    }
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
    if (b.validUntil !== undefined) data.validUntil = b.validUntil || null;
    if (b.customerId !== undefined) data.customerId = b.customerId ?? null;
    if (b.vatPercent !== undefined) data.vatPercent = D(b.vatPercent);
    if (b.showTotals !== undefined) data.showTotals = b.showTotals;
    if (b.companyId !== undefined) data.companyId = b.companyId;
    if (b.customerLogo !== undefined) data.customerLogo = b.customerLogo || null;
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

    // If a price-affecting change is made to a quote that was already in the
    // approval pipeline (pending/approved/sent), the prior approval no longer
    // reflects the content — send it back to draft and clear the approval.
    const priceAffecting = Array.isArray(b.sheets) || data.vatPercent !== undefined || data.discount !== undefined;
    const wasLocked = ["pending", "approved", "sent"].includes(existing.status);
    const reopened = wasLocked && priceAffecting;
    if (reopened) {
      data.status = "draft";
      data.approvedById = null;
    }

    let updated;
    if (Array.isArray(b.sheets)) {
      const vatPct = data.vatPercent ?? existing.vatPercent;
      const t = computeQuoteTotals({ vatPercent: vatPct, discount: data.discount ?? existing.discount, sheets: b.sheets });
      data.subtotal = t.subtotal;
      data.vat = t.vat;
      data.discount = t.discount;
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
      // Recompute totals if VAT or discount changed (either shifts the grand total).
      if (data.vatPercent !== undefined || data.discount !== undefined) {
        const t = computeQuoteTotals({ vatPercent: data.vatPercent ?? existing.vatPercent, discount: data.discount ?? existing.discount, sheets: existing.sheets });
        data.subtotal = t.subtotal;
        data.vat = t.vat;
        data.discount = t.discount;
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
      after: { total: Number(updated.total), status: updated.status, reopened },
    });
    if (reopened) {
      await audit(req, "quote.reopened", { resource: "quote", resourceId: id });
      await notify(existing.createdById, {
        title: `Báo giá ${updated.quoteNumber} cần duyệt lại`,
        body: "Báo giá đã được chỉnh sửa nên quay về trạng thái Nháp, cần trình duyệt lại.",
        link: `/#/quotes/${id}`,
        resource: "quote",
        resourceId: id,
        important: true,
      }).catch(() => {});
    }

    res.json(presentQuote(updated, { includeLogo: true }));
  })
);

// SUBMIT for approval (uses matrix engine: creates per-level Approval rows)
router.post(
  "/:id/submit",
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const existing = await prisma.quote.findFirst({ where: { id }, include: { members: { select: { id: true } } } });
    if (!existing) return res.status(404).json({ error: "Không tìm thấy" });
    if (!can(req.session, P.QUOTE_SUBMIT) || !canOnQuote(req.session, "update", existing)) {
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
  requirePermission(P.QUOTE_APPROVE),
  validate({ params: idParam, body: z.object({ comment: z.string().max(2000).optional() }).default({}) }),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const existing = await prisma.quote.findFirst({ where: { id } });
    if (!existing) return res.status(404).json({ error: "Không tìm thấy" });
    if (existing.status !== "pending") return res.status(400).json({ error: "Báo giá chưa được trình duyệt" });

    // Segregation of duties: the creator may not approve their own quote.
    // (Admins are allowed as a last-resort override, but it is flagged in the audit trail.)
    const isCreator = existing.createdById === req.session.userId;
    if (isCreator && req.session.role !== "admin") {
      return res.status(403).json({ error: "Người tạo không được tự duyệt báo giá của mình" });
    }

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
      title: `Báo giá ${quote.quoteNumber} đã được duyệt`,
      body: "Có thể gửi cho khách.",
      link: `/#/quotes/${id}`,
      resource: "quote",
      resourceId: id,
      important: true,
    });

    await audit(req, "quote.approve", { resource: "quote", resourceId: id, after: { complete, selfApproved: isCreator } });
    if (complete) emitWebhook("quote.approved", { id, quoteNumber: quote.quoteNumber, total: Number(quote.total) }).catch(() => {});
    res.json(presentQuote(quote));
  })
);

router.post(
  "/:id/reject",
  requirePermission(P.QUOTE_REJECT),
  validate({ params: idParam, body: z.object({ comment: z.string().min(5, "Vui lòng nhập lý do từ chối (ít nhất 5 ký tự)").max(2000) }) }),
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
  requirePermission(P.QUOTE_SEND),
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const existing = await prisma.quote.findFirst({ where: { id }, include: { members: { select: { id: true } } } });
    if (!existing) return res.status(404).json({ error: "Không tìm thấy" });
    if (!canOnQuote(req.session, "read", existing)) {
      return res.status(403).json({ error: "Bạn không có quyền gửi báo giá này" });
    }
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
    const existing = await prisma.quote.findFirst({ where: { id }, include: { members: { select: { id: true } } } });
    if (!existing) return res.status(404).json({ error: "Không tìm thấy" });
    // Only the owner (or an all-scope editor) may convert, and only an already
    // approved/sent quote can be marked won.
    if (!canOnQuote(req.session, "update", existing)) {
      return res.status(403).json({ error: "Không có quyền chốt báo giá này" });
    }
    if (!["approved", "sent"].includes(existing.status)) {
      return res.status(400).json({ error: "Chỉ chốt được báo giá đã duyệt hoặc đã gửi" });
    }
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

// MARK LOST — customer declined. Records a reason for win/loss reporting.
router.post(
  "/:id/mark-lost",
  validate({ params: idParam, body: z.object({ reason: z.string().max(2000).optional() }).default({}) }),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const existing = await prisma.quote.findFirst({ where: { id }, include: { members: { select: { id: true } } } });
    if (!existing) return res.status(404).json({ error: "Không tìm thấy" });
    if (!canOnQuote(req.session, "update", existing)) {
      return res.status(403).json({ error: "Không có quyền cập nhật báo giá này" });
    }
    if (existing.status === "converted") {
      return res.status(400).json({ error: "Báo giá đã chốt, không thể đánh dấu thua" });
    }
    const quote = await prisma.quote.update({
      where: { id },
      data: { status: "lost", notes: req.body.reason ? `[Lý do không chốt] ${req.body.reason}\n${existing.notes || ""}`.slice(0, 4000) : existing.notes },
      include: QUOTE_INCLUDE,
    });
    await audit(req, "quote.lost", { resource: "quote", resourceId: id, after: { reason: req.body.reason || null } });
    res.json(presentQuote(quote));
  })
);

// VERSIONS
router.get(
  "/:id/versions",
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!(await loadAuthorizedQuote(req, res, "read"))) return;
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
    if (!(await loadAuthorizedQuote(req, res, "read"))) return;
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
    if (!(await loadAuthorizedQuote(req, res, "read"))) return;
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
    if (!(await loadAuthorizedQuote(req, res, "read"))) return;
    const rows = await prisma.approval.findMany({
      where: { quoteId: req.params.id },
      orderBy: [{ versionNo: "asc" }, { level: "asc" }],
      include: { approver: { select: { id: true, username: true, displayName: true } } },
    });
    res.json({ data: rows });
  })
);

// MEMBERS — add/remove the employees who may view & edit this quote.
// Only the creator (or an admin) may manage the member list.
router.put(
  "/:id/members",
  validate({ params: idParam, body: z.object({ memberIds: z.array(z.coerce.number().int().positive()).max(50).default([]) }) }),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const quote = await prisma.quote.findFirst({ where: { id } });
    if (!quote) return res.status(404).json({ error: "Không tìm thấy báo giá" });
    if (quote.createdById !== req.session.userId && !can(req.session, P.QUOTE_UPDATE_ALL)) {
      return res.status(403).json({ error: "Chỉ người tạo hoặc Giám đốc mới quản lý được thành viên" });
    }
    // The creator is always kept as a member.
    const ids = [...new Set([quote.createdById, ...req.body.memberIds])];
    await prisma.quote.update({
      where: { id },
      data: { members: { set: ids.map((uid) => ({ id: uid })) } },
    });
    await audit(req, "quote.members.update", { resource: "quote", resourceId: id, after: { members: ids } });
    const updated = await prisma.quote.findFirst({
      where: { id },
      include: { members: { select: { id: true, username: true, displayName: true, role: true } } },
    });
    res.json({ members: updated.members });
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
    // A won deal is terminal — nobody (not even delete:all) may remove it.
    if (existing.status === "converted") {
      return res.status(400).json({ error: "Không thể xóa báo giá đã chốt" });
    }
    const ownerDraftDelete =
      canOnQuote(req.session, "delete", existing) &&
      (existing.status === "draft" || existing.status === "rejected");
    if (!ownerDraftDelete && !can(req.session, P.QUOTE_DELETE_ALL)) {
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
    // Must be allowed to read the source AND to create quotes.
    if (!canOnQuote(req.session, "read", src)) {
      return res.status(403).json({ error: "Bạn không có quyền sao chép báo giá này" });
    }
    if (!can(req.session, P.QUOTE_CREATE)) {
      return res.status(403).json({ error: "Không có quyền tạo báo giá" });
    }

    const newNumber = await nextQuoteNumber(src.company?.quotePrefix || "GN");
    const synthetic = { vatPercent: src.vatPercent, discount: src.discount, sheets: src.sheets };
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
        discount: src.discount,
        toEmail: src.toEmail,
        notes: src.notes,
        status: "draft",
        subtotal: t.subtotal,
        vat: t.vat,
        discount: t.discount,
        total: t.total,
        createdById: req.session.userId,
        members: { connect: [{ id: req.session.userId }] },
        sheets: {
          create: src.sheets.map((s, sIdx) => ({
            templateId: s.templateId,
            name: s.name,
            order: s.order != null ? s.order : sIdx + 1,
            items: {
              create: s.items.map((it, iIdx) => ({
                order: it.order != null ? it.order : iIdx + 1,
                kind: it.kind || "item",
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
