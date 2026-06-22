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
import {
  canEdit,
  QUOTE_INCLUDE,
  templatesBelongToCompany,
  buildSheetsCreate,
  sanitizeExtraTables,
} from "./quoteUtils.js";

export const httpError = (status, message) => Object.assign(new Error(message), { status });

// Duyệt theo HÀNG cho bảng nội bộ "hcm"/"khach": CHỈ ADMIN được đặt approved. Gọi TRƯỚC khi
// lưu (buildSheetsCreate) để: non-admin → GIỮ NGUYÊN trạng thái duyệt cũ theo `rid` (chống tự
// duyệt qua payload); admin → honor + đóng dấu approvedAt/approvedBy khi mới duyệt. Mutate sheets.
export function reconcileExtraApprovals(sheets, existingSheets, isAdmin, approverId) {
  if (!Array.isArray(sheets)) return;
  const prior = new Map();   // rid -> { approved, approvedAt, approvedBy }
  for (const s of (existingSheets || [])) {
    for (const t of (Array.isArray(s.extraTables) ? s.extraTables : [])) {
      if (!t || (t.category !== "hcm" && t.category !== "khach")) continue;
      for (const it of (t.items || [])) {
        if (it && it.rid) prior.set(it.rid, { approved: !!it.approved, approvedAt: it.approvedAt || null, approvedBy: it.approvedBy ?? null });
      }
    }
  }
  const now = new Date().toISOString();
  for (const s of sheets) {
    for (const t of (Array.isArray(s.extraTables) ? s.extraTables : [])) {
      if (!t || (t.category !== "hcm" && t.category !== "khach")) continue;
      for (const it of (t.items || [])) {
        if (!it) continue;
        const p = it.rid ? prior.get(it.rid) : null;
        if (!isAdmin) {   // non-admin: bỏ qua mọi thay đổi duyệt từ client → theo DB (mới = chưa duyệt)
          it.approved = p ? p.approved : false;
          it.approvedAt = p ? p.approvedAt : null;
          it.approvedBy = p ? p.approvedBy : null;
        } else {          // admin: honor, đóng dấu khi MỚI duyệt, giữ dấu cũ nếu vẫn duyệt
          const want = !!it.approved;
          if (want && (!p || !p.approved)) { it.approvedAt = now; it.approvedBy = approverId; }
          else if (want) { it.approvedAt = p.approvedAt || now; it.approvedBy = p.approvedBy ?? approverId; }
          else { it.approvedAt = null; it.approvedBy = null; }
          it.approved = want;
        }
      }
    }
  }
}

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
  // Duyệt hàng (HCM/Khách) — tạo mới: non-admin thì mọi hàng CHƯA duyệt; admin tick thì đóng dấu.
  reconcileExtraApprovals(b.sheets, [], req.session.role === "admin", userId);

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
    // CHỈ ADMIN được đổi trạng thái duyệt hàng (HCM/Khách); non-admin giữ nguyên theo DB.
    reconcileExtraApprovals(b.sheets, existing.sheets, req.session.role === "admin", userId);
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

// Luồng DUYỆT NỘI BỘ (submitQuote/approveQuote/rejectQuote) ĐÃ BỎ 2026-06-22.
// Vòng đời mới: draft → converted ("Khách chốt") / lost ("Khách không chốt") — xem routes
// /:id/mark-converted, /:id/mark-lost. "Duyệt" thật = quyết định của khách.
