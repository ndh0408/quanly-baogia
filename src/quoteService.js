// Application service for the quote domain. Holds the heavy create/update business
// logic (transactions, number allocation, version snapshots, reopen-on-edit,
// audit/webhook/notify) so the route handlers stay thin: parse -> call service ->
// present. Business-rule failures are thrown as httpError(status,msg); the central
// errorHandler maps err.status<500 to that HTTP status + message.

import { prisma } from "./db.js";
import { computeQuoteTotals, D } from "./money.js";
import { nextQuoteNumber, nextProjectCode } from "./quoteNumber.js";
import { audit } from "./audit.js";
import { snapshotQuoteVersion } from "./quoteVersion.js";
import { notify } from "./notifications.js";
import { emit as emitWebhook } from "./webhooks.js";
import { can, canOnQuote, PERMISSIONS as P } from "./permissions.js";
import { startApprovalChain, canApproveLevel, nextPendingLevel, hasEarlierPending, isChainComplete } from "./approval.js";
import {
  canEdit,
  QUOTE_INCLUDE,
  templatesBelongToCompany,
  buildSheetsCreate,
  sanitizeExtraTables,
} from "./quoteUtils.js";

export const httpError = (status, message) => Object.assign(new Error(message), { status });

/**
 * Create a quote from a validated body (req.body). Allocates the quote number +
 * per-employee project code and snapshots v1 INSIDE one transaction (failed insert
 * rolls the counter back — no burned numbers), retrying the rare P2002 collision.
 * Returns the created quote (QUOTE_INCLUDE).
 */
export async function createQuote(req) {
  const b = req.body;
  const userId = req.session.userId;

  const company = await prisma.company.findFirst({ where: { id: b.companyId } });
  if (!company) throw httpError(400, "Không tìm thấy công ty");
  if (!(await templatesBelongToCompany(b.sheets, company.id))) {
    throw httpError(400, "Có mẫu báo giá không thuộc công ty đã chọn (hoặc đã ngừng dùng)");
  }

  // Client-supplied number: validate uniqueness across ALL rows (incl. soft-deleted)
  // BEFORE the write to return a clean 409.
  if (b.quoteNumber) {
    const dup = await prisma.quote.findFirst({ where: { quoteNumber: b.quoteNumber }, includeDeleted: true });
    if (dup) {
      throw httpError(409, dup.deletedAt ? "Số báo giá đã dùng (thuộc báo giá đã xoá)" : "Số báo giá đã tồn tại");
    }
  }

  const creator = await prisma.user.findUnique({ where: { id: userId }, select: { projectCode: true } });
  const draft = {
    title: b.title,
    toCompany: b.toCompany,
    toContact: b.toContact || null,
    toEmail: b.toEmail || null,
    toPhone: b.toPhone || null,
    toAddress: b.toAddress || null,
    companyId: company.id,
    fromContact: b.fromContact || "",
    fromPhone: b.fromPhone || company.phone || null,
    fromTitle: b.fromTitle || null,
    fromAddress: b.fromAddress || company.address,
    city: b.city || company.city || "TP. Hồ Chí Minh",
    quoteDate: b.quoteDate || new Date(),
    executionDate: b.executionDate || null,
    customerId: b.customerId ?? null,
    greeting: b.greeting || undefined,
    vatPercent: D(b.vatPercent),
    discount: D(b.discount || 0),
    showTotals: b.showTotals !== false,
    notes: b.notes || null,
    customerLogo: b.customerLogo || null,
    status: "draft",
    createdById: userId,
  };

  // Compute totals from sheets+items BEFORE writing so we store the snapshot.
  const t = computeQuoteTotals({ vatPercent: draft.vatPercent, discount: draft.discount, sheets: b.sheets });
  draft.subtotal = t.subtotal;
  draft.vat = t.vat;
  draft.discount = t.discount;
  draft.total = t.total;

  const prefix = company.quotePrefix || "GN";
  let quote;
  for (let attempt = 0; ; attempt++) {
    try {
      quote = await prisma.$transaction(async (tx) => {
        const quoteNumber = b.quoteNumber ?? await nextQuoteNumber(prefix, tx);
        if (creator?.projectCode) draft.projectCode = await nextProjectCode(creator.projectCode, tx);
        const created = await tx.quote.create({
          data: { ...draft, quoteNumber, sheets: { create: buildSheetsCreate(b.sheets) }, members: { connect: [{ id: userId }] } },
          include: QUOTE_INCLUDE,
        });
        await snapshotQuoteVersion(tx, created.id, userId, "create");
        return created;
      });
      break;
    } catch (e) {
      if (e.code === "P2002" && !b.quoteNumber && attempt < 3) continue;
      if (e.code === "P2002") throw httpError(409, "Số báo giá bị trùng, vui lòng thử lại");
      throw e;
    }
  }

  await audit(req, "quote.create", {
    resource: "quote",
    resourceId: quote.id,
    after: { quoteNumber: quote.quoteNumber, total: Number(quote.total), status: quote.status },
  });
  emitWebhook("quote.created", { id: quote.id, quoteNumber: quote.quoteNumber, total: Number(quote.total) }).catch(() => {});
  return quote;
}

/**
 * Update a quote from a validated body. Recomputes totals server-side; a
 * price-affecting edit to a quote already in the approval pipeline reopens it to
 * draft (clears approval, bumps version, notifies creator). Returns the updated quote.
 */
export async function updateQuote(req) {
  const id = req.params.id;
  const userId = req.session.userId;
  const b = req.body;

  const existing = await prisma.quote.findFirst({ where: { id }, include: QUOTE_INCLUDE });
  if (!existing) throw httpError(404, "Không tìm thấy báo giá");
  if (!canEdit(existing, req.session)) throw httpError(403, "Bạn không thể sửa báo giá này");

  if (Array.isArray(b.sheets)) {
    const targetCompany = b.companyId ?? existing.companyId;
    if (!(await templatesBelongToCompany(b.sheets, targetCompany))) {
      throw httpError(400, "Có mẫu báo giá không thuộc công ty đã chọn (hoặc đã ngừng dùng)");
    }
  }

  const data = {};
  for (const f of ["title", "toCompany", "fromContact", "fromAddress", "city", "greeting"]) {
    if (b[f] !== undefined && b[f] !== null) data[f] = b[f];
  }
  for (const f of ["toContact", "toEmail", "toPhone", "toAddress", "fromPhone", "fromTitle", "notes"]) {
    if (b[f] !== undefined) data[f] = b[f] || null;
  }
  if (b.quoteDate) data.quoteDate = b.quoteDate;
  if (b.executionDate !== undefined) data.executionDate = b.executionDate || null;
  if (b.customerId !== undefined) data.customerId = b.customerId ?? null;
  if (b.vatPercent !== undefined) data.vatPercent = D(b.vatPercent);
  if (b.discount !== undefined) data.discount = D(b.discount);
  if (b.showTotals !== undefined) data.showTotals = b.showTotals;
  if (b.companyId !== undefined) data.companyId = b.companyId;
  if (b.customerLogo !== undefined) data.customerLogo = b.customerLogo || null;
  if (b.quoteNumber !== undefined && b.quoteNumber !== existing.quoteNumber) {
    const dup = await prisma.quote.findFirst({ where: { quoteNumber: b.quoteNumber }, includeDeleted: true });
    if (dup) {
      throw httpError(409, dup.deletedAt ? "Số báo giá đã dùng (thuộc báo giá đã xoá)" : "Số báo giá đã tồn tại");
    }
    data.quoteNumber = b.quoteNumber;
  }

  // Price-affecting edit on a quote already in the pipeline -> reopen to draft.
  const priceAffecting = Array.isArray(b.sheets) || data.vatPercent !== undefined || data.discount !== undefined;
  if (priceAffecting) data.currentVersion = (existing.currentVersion ?? 1) + 1;
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
      await snapshotQuoteVersion(tx, id, userId, "update");
      return u;
    });
  } else {
    if (data.vatPercent !== undefined || data.discount !== undefined) {
      const t = computeQuoteTotals({ vatPercent: data.vatPercent ?? existing.vatPercent, discount: data.discount ?? existing.discount, sheets: existing.sheets });
      data.subtotal = t.subtotal;
      data.vat = t.vat;
      data.discount = t.discount;
      data.total = t.total;
    }
    updated = await prisma.$transaction(async (tx) => {
      const u = await tx.quote.update({ where: { id }, data, include: QUOTE_INCLUDE });
      await snapshotQuoteVersion(tx, id, userId, "update");
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
  return updated;
}

/** Submit a draft/rejected quote for approval: flip to pending + (re)create the
 * pending Approval row atomically, then notify approvers + the creator. */
export async function submitQuote(req) {
  const id = req.params.id;
  const existing = await prisma.quote.findFirst({ where: { id }, include: { members: { select: { id: true } } } });
  if (!existing) throw httpError(404, "Không tìm thấy báo giá");
  if (!can(req.session, P.QUOTE_SUBMIT) || !canOnQuote(req.session, "update", existing)) {
    throw httpError(403, "Bạn không có quyền trình duyệt báo giá này");
  }
  if (!["draft", "rejected"].includes(existing.status)) {
    throw httpError(400, "Chỉ trình duyệt được báo giá ở trạng thái Nháp hoặc Bị từ chối");
  }
  const quote = await prisma.$transaction(async (tx) => {
    const q = await tx.quote.update({ where: { id }, data: { status: "pending", approvedById: null }, include: QUOTE_INCLUDE });
    await startApprovalChain(id, q.currentVersion, tx);
    return q;
  });

  const approvers = await prisma.user.findMany({
    where: { active: true, role: { in: ["manager", "admin"] }, id: { not: existing.createdById } },
    select: { id: true },
  });
  await Promise.all([
    ...approvers.map((u) => notify(u.id, {
      title: `Báo giá ${quote.quoteNumber} chờ duyệt`,
      body: `${quote.title} • Tổng ${Number(quote.total).toLocaleString("vi-VN")} VND`,
      link: `/#/quotes/${id}`, resource: "quote", resourceId: id, important: true,
    })),
    notify(existing.createdById, {
      title: `Báo giá ${quote.quoteNumber} đã gửi duyệt`,
      body: "Đang chờ duyệt. Bạn sẽ được báo khi có kết quả.",
      link: `/#/quotes/${id}`, resource: "quote", resourceId: id,
    }),
  ]);
  await audit(req, "quote.submit", { resource: "quote", resourceId: id });
  emitWebhook("quote.submitted", { id, quoteNumber: quote.quoteNumber, total: Number(quote.total) }).catch(() => {});
  return quote;
}

/** Approve a pending quote. admin (quote:approve) approves any; manager
 * (quote:approve:own) only their own. Optimistic-guarded transaction so Approval
 * and Quote never drift; throws 409 on conflict. */
export async function approveQuote(req) {
  const id = req.params.id;
  const userId = req.session.userId;
  const existing = await prisma.quote.findFirst({ where: { id } });
  if (!existing) throw httpError(404, "Không tìm thấy báo giá");
  if (existing.status !== "pending") throw httpError(400, "Báo giá chưa được trình duyệt");

  const isCreator = existing.createdById === userId;
  const canApproveAll = can(req.session, P.QUOTE_APPROVE);
  const canApproveOwn = can(req.session, P.QUOTE_APPROVE_OWN);
  if (!canApproveAll && !(canApproveOwn && isCreator)) {
    throw httpError(403, "Bạn không có quyền duyệt báo giá này");
  }

  const pending = await nextPendingLevel(id, existing.currentVersion);
  if (!pending) throw httpError(400, "Không có cấp duyệt nào đang chờ");
  if (await hasEarlierPending(id, existing.currentVersion, pending.level)) {
    throw httpError(400, "Còn cấp duyệt trước đó chưa được duyệt");
  }
  if (!(await canApproveLevel(id, existing.currentVersion, pending.level, req.session.role))) {
    throw httpError(403, "Vai trò của bạn không được phép duyệt cấp này");
  }

  let complete = false;
  try {
    await prisma.$transaction(async (tx) => {
      const ap = await tx.approval.updateMany({
        where: { id: pending.id, decision: "pending" },
        data: { decision: "approved", approverId: userId, comment: req.body.comment || null, decidedAt: new Date() },
      });
      if (!ap.count) throw new Error("APPROVAL_CONFLICT");
      complete = await isChainComplete(id, existing.currentVersion, tx);
      const qu = await tx.quote.updateMany({
        where: { id, status: "pending", currentVersion: existing.currentVersion },
        data: complete ? { status: "approved", approvedById: userId } : { approvedById: existing.approvedById },
      });
      if (!qu.count) throw new Error("APPROVAL_CONFLICT");
    });
  } catch (e) {
    if (e.message === "APPROVAL_CONFLICT") {
      throw httpError(409, "Báo giá vừa thay đổi hoặc đã được người khác xử lý — vui lòng tải lại");
    }
    throw e;
  }
  const quote = await prisma.quote.findFirst({ where: { id }, include: QUOTE_INCLUDE });

  if (existing.createdById !== userId) {
    await notify(existing.createdById, {
      title: `Báo giá ${quote.quoteNumber} đã được duyệt`,
      body: "Có thể gửi cho khách.",
      link: `/#/quotes/${id}`, resource: "quote", resourceId: id, important: true,
    });
  }
  await audit(req, "quote.approve", { resource: "quote", resourceId: id, after: { complete, selfApproved: isCreator } });
  if (complete) emitWebhook("quote.approved", { id, quoteNumber: quote.quoteNumber, total: Number(quote.total) }).catch(() => {});
  return quote;
}

/** Reject a pending quote (route enforces QUOTE_REJECT). Same transactional guard. */
export async function rejectQuote(req) {
  const id = req.params.id;
  const userId = req.session.userId;
  const existing = await prisma.quote.findFirst({ where: { id } });
  if (!existing) throw httpError(404, "Không tìm thấy báo giá");
  if (existing.status !== "pending") throw httpError(400, "Báo giá chưa được trình duyệt");

  const pending = await nextPendingLevel(id, existing.currentVersion);
  try {
    await prisma.$transaction(async (tx) => {
      if (pending) {
        const ap = await tx.approval.updateMany({
          where: { id: pending.id, decision: "pending" },
          data: { decision: "rejected", approverId: userId, comment: req.body.comment || null, decidedAt: new Date() },
        });
        if (!ap.count) throw new Error("APPROVAL_CONFLICT");
      }
      const qu = await tx.quote.updateMany({
        where: { id, status: "pending" },
        data: { status: "rejected", approvedById: userId },
      });
      if (!qu.count) throw new Error("APPROVAL_CONFLICT");
    });
  } catch (e) {
    if (e.message === "APPROVAL_CONFLICT") {
      throw httpError(409, "Báo giá vừa thay đổi hoặc đã được người khác xử lý — vui lòng tải lại");
    }
    throw e;
  }
  const quote = await prisma.quote.findFirst({ where: { id }, include: QUOTE_INCLUDE });

  await notify(existing.createdById, {
    title: `Báo giá ${quote.quoteNumber} bị từ chối`,
    body: req.body.comment || "Vui lòng kiểm tra lại.",
    link: `/#/quotes/${id}`, resource: "quote", resourceId: id, important: true,
  });
  await audit(req, "quote.reject", { resource: "quote", resourceId: id, after: { reason: req.body.comment || null } });
  emitWebhook("quote.rejected", { id, quoteNumber: quote.quoteNumber }).catch(() => {});
  return quote;
}
