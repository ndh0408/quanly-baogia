// Application service for the quote domain. Holds the heavy create/update business
// logic (transactions, number allocation, version snapshots, reopen-on-edit,
// audit/webhook/notify) so the route handlers stay thin: parse -> call service ->
// present. Business-rule failures are thrown as httpError(status,msg); the central
// errorHandler maps err.status<500 to that HTTP status + message.

import { Prisma } from "@prisma/client";
import type { Request } from "express";
import { prisma } from "./db.js";
import { config } from "./config.js";
import { computeQuoteTotals, D } from "./money.js";
import { nextQuoteNumber, nextProjectCode } from "./quoteNumber.js";
import { normalizeSearch, searchTextFilter } from "./searchText.js";
import { audit } from "./audit.js";
import { snapshotQuoteVersion, diffVersions } from "./quoteVersion.js";
import { notify } from "./notifications.js";
import { emit as emitWebhook } from "./webhooks.js";
import { can, canOnQuote, quoteScopeWhere, PERMISSIONS as P } from "./permissions.js";
import {
  canEdit,
  QUOTE_INCLUDE,
  QUOTE_LIST_SELECT,
  templatesBelongToCompany,
  buildSheetsCreate,
  sanitizeExtraTables,
  extraTableSum,
} from "./quoteUtils.js";
import { httpError } from "./httpError.js";

/** Tải báo giá theo :id và THROW 403/404 nếu caller không được `action`. Dùng cho sub-resource. */
async function loadAuthorizedQuote(req: Request, action: string = "read") {
  const id = Number(req.params.id);
  const quote = await prisma.quote.findFirst({
    where: { id },
    include: { members: { select: { id: true } } },
  });
  if (!quote) throw httpError(404, "Không tìm thấy báo giá");
  if (!canOnQuote(req.session, action, quote)) throw httpError(403, "Bạn không có quyền với báo giá này");
  return quote;
}

// Duyệt theo HÀNG cho bảng nội bộ "hcm"/"khach": CHỈ ADMIN được đặt approved. Gọi TRƯỚC khi
// lưu (buildSheetsCreate) để: non-admin → GIỮ NGUYÊN trạng thái duyệt cũ theo `rid` (chống tự
// duyệt qua payload); admin → honor + đóng dấu approvedAt/approvedBy khi mới duyệt. Mutate sheets.
export function reconcileExtraApprovals(sheets: any[], existingSheets: any[], isAdmin: boolean, approverId: number) {
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
export async function createQuote(req: Request) {
  const b = req.body;
  const userId = req.session.userId;
  if (userId === undefined) throw httpError(401, "Chưa đăng nhập");

  const company = await prisma.company.findFirst({ where: { id: b.companyId } });
  if (!company) throw httpError(400, "Không tìm thấy công ty");
  if (!(await templatesBelongToCompany(b.sheets, company.id))) {
    throw httpError(400, "Có mẫu báo giá không thuộc công ty đã chọn (hoặc đã ngừng dùng)");
  }
  // Duyệt hàng (HCM/Khách) — tạo mới: ai KHÔNG có quyền duyệt nội bộ thì mọi hàng CHƯA duyệt; có quyền tick thì đóng dấu.
  reconcileExtraApprovals(b.sheets, [], can(req.session, P.QUOTE_INTERNAL_APPROVE), userId);

  // Client-supplied number: validate uniqueness across ALL rows (incl. soft-deleted)
  // BEFORE the write to return a clean 409.
  if (b.quoteNumber) {
    const dup = await prisma.quote.findFirst({ where: { quoteNumber: b.quoteNumber }, includeDeleted: true } as any);
    if (dup) {
      throw httpError(409, dup.deletedAt ? "Số báo giá đã dùng (thuộc báo giá đã xoá)" : "Số báo giá đã tồn tại");
    }
  }

  const creator = await prisma.user.findUnique({ where: { id: userId }, select: { projectCode: true } });
  const draft: Record<string, any> = {
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
        const quoteNumber = b.quoteNumber ?? await nextQuoteNumber(prefix, tx as any);
        if (creator?.projectCode) draft.projectCode = await nextProjectCode(creator.projectCode, tx as any);
        const searchText = normalizeSearch(quoteNumber, draft.projectCode, draft.title, draft.toCompany, draft.toContact);
        const created = await tx.quote.create({
          data: { ...draft, quoteNumber, searchText, sheets: { create: buildSheetsCreate(b.sheets, t.sheetTotals) }, members: { connect: [{ id: userId }] } } as any,
          include: QUOTE_INCLUDE as any,
        });
        await snapshotQuoteVersion(tx, created.id, userId, "create");
        return created;
      });
      break;
    } catch (e) {
      const code = e instanceof Prisma.PrismaClientKnownRequestError ? e.code : undefined;
      if (code === "P2002" && !b.quoteNumber && attempt < 3) continue;
      if (code === "P2002") throw httpError(409, "Số báo giá bị trùng, vui lòng thử lại");
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
export async function updateQuote(req: Request) {
  const id = Number(req.params.id);
  const userId = req.session.userId;
  if (userId === undefined) throw httpError(401, "Chưa đăng nhập");
  const b = req.body;

  const existing: any = await prisma.quote.findFirst({ where: { id }, include: QUOTE_INCLUDE as any });
  if (!existing) throw httpError(404, "Không tìm thấy báo giá");
  if (!canEdit(existing, req.session)) throw httpError(403, "Bạn không thể sửa báo giá này");

  // KHÓA LẠC QUAN (chống MẤT DỮ LIỆU): nếu client gửi mốc updatedAt đã tải mà DB đã thay đổi
  // (người khác lưu xen vào giữa lúc đang mở editor) → 409, KHÔNG ghi đè im lặng. Client cũ
  // không gửi baseUpdatedAt → bỏ qua (tương thích ngược, không tệ hơn trước).
  if (b.baseUpdatedAt && existing.updatedAt &&
      new Date(b.baseUpdatedAt).getTime() !== new Date(existing.updatedAt).getTime()) {
    throw httpError(409, "Báo giá vừa được người khác cập nhật. Vui lòng tải lại để không ghi đè thay đổi của họ.");
  }

  if (Array.isArray(b.sheets)) {
    const targetCompany = b.companyId ?? existing.companyId;
    if (!(await templatesBelongToCompany(b.sheets, targetCompany))) {
      throw httpError(400, "Có mẫu báo giá không thuộc công ty đã chọn (hoặc đã ngừng dùng)");
    }
  }

  const data: Record<string, any> = {};
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
    const dup = await prisma.quote.findFirst({ where: { quoteNumber: b.quoteNumber }, includeDeleted: true } as any);
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

  // Cập nhật searchText: field có trong payload thì dùng nó (KỂ CẢ null = xóa, vd toContact), không thì
  // giữ cũ. Dùng `k in data` thay `?? existing` để xóa-rỗng phản ánh đúng vào index (không stale).
  const pick = (k: string, old: any) => (k in data ? (data as any)[k] : old);
  data.searchText = normalizeSearch(
    pick("quoteNumber", existing.quoteNumber), existing.projectCode,
    pick("title", existing.title), pick("toCompany", existing.toCompany), pick("toContact", existing.toContact)
  );

  let updated;
  if (Array.isArray(b.sheets)) {
    // CHỈ người có quyền DUYỆT NỘI BỘ được đổi trạng thái duyệt hàng (HCM/Khách); còn lại giữ nguyên theo DB.
    reconcileExtraApprovals(b.sheets, existing.sheets, can(req.session, P.QUOTE_INTERNAL_APPROVE), userId);
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
        data: { ...data, sheets: { create: buildSheetsCreate(b.sheets, t.sheetTotals) } },
        include: QUOTE_INCLUDE as any,
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
      const u = await tx.quote.update({ where: { id }, data, include: QUOTE_INCLUDE as any });
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

// ============================================================================
//  READ / LIST / lookup endpoints (DI CHUYỂN từ quotes.routes.ts — hành vi y hệt)
// ============================================================================

/**
 * LIST báo giá theo phạm vi (admin=all, manager=own, employee=member) + filter của user.
 * Trả về { rows, total, page, size } — route map qua presentQuoteRow + dựng meta.
 */
export async function listQuotes(req: Request) {
  // validate(ListQuerySchema) đã coerce: q/status/from/to/sort/order là chuỗi/Date,
  // companyId/page/size là number (có default page=1/size=DEFAULT). TS chỉ thấy ParsedQs
  // string → đọc lại với coercion tương đương runtime (Number của number = chính nó).
  const qy = req.query as Record<string, any>;
  const q: string | undefined = qy.q;
  const status: string | undefined = qy.status;
  const companyId = qy.companyId !== undefined ? Number(qy.companyId) : undefined;
  const from = qy.from;
  const to = qy.to;
  const page = Number(qy.page) || 1;
  const size = Number(qy.size) || config.DEFAULT_PAGE_SIZE;
  const sort = String(qy.sort);
  const order = qy.order;
  // Visibility scope (admin=all, manager=own, employee=member) combined with
  // the user's filters via AND so a scope-OR doesn't clash with the search-OR.
  const filters: Prisma.QuoteWhereInput[] = [quoteScopeWhere(req.session)];
  if (status) filters.push({ status: status as Prisma.QuoteWhereInput["status"] });
  if (companyId) filters.push({ companyId });
  if (from || to) {
    const range: Record<string, any> = {};
    if (from) range.gte = from;
    if (to) range.lte = to;
    filters.push({ quoteDate: range });
  }
  // Tìm KHÔNG dấu / sai dấu trên cột searchText chuẩn-hóa (quoteNumber+projectCode+title+toCompany+toContact).
  if (q) filters.push({ searchText: searchTextFilter(String(q)) });
  const where = { AND: filters };
  // account_hn: cần bảng "hanoi" của từng sheet để tính SỐ SHEET HN + TỔNG HN (số nội bộ của
  // họ). Account chỉ thấy ít báo giá (được giao) nên select nặng hơn không sao.
  const listSelect = can(req.session, P.QUOTE_HN_FILL)
    ? { ...QUOTE_LIST_SELECT, sheets: { select: { extraTables: true } } }
    : QUOTE_LIST_SELECT;
  const [total, rows] = await Promise.all([
    prisma.quote.count({ where }),
    prisma.quote.findMany({
      where,
      orderBy: { [sort]: order },
      select: listSelect,   // slim projection (account_hn: +sheets.extraTables để tính Tổng HN)
      skip: (page - 1) * size,
      take: size,
    }),
  ]);
  return { rows, total, page, size };
}

/** Xem trước SỐ báo giá KẾ TIẾP (không tiêu thụ counter). Prefix theo công ty đã chọn. */
export async function previewNextNumber(req: Request) {
  // Show what the NEXT number WOULD be without actually consuming it.
  // Prefix is per-company (GN…, CLF…) so the preview matches the chosen company.
  let prefix = "GN";
  if (req.query.companyId) {
    const company = await prisma.company.findFirst({ where: { id: Number(req.query.companyId) } });
    if (company) prefix = company.quotePrefix || "GN";
  }
  const year = new Date().getFullYear();
  const c = await prisma.quoteCounter.findUnique({
    where: { prefix_year: { prefix, year } },
  });
  const yy = String(year).slice(-2);
  const nn = String((c?.value ?? 0) + 1).padStart(3, "0");
  return { quoteNumber: `${prefix}${yy}${nn}`, prefix, note: "Số chính thức sẽ được cấp khi lưu" };
}

/** Người dùng active có thể thêm làm thành viên/người gửi của báo giá. Chỉ trả tên/vai trò. */
export async function listAssignableUsers(req: Request) {
  // Minimal fields for the member/sender picker only. Do NOT leak the login
  // identifier (username) or phone of every employee to all authenticated users.
  const users = await prisma.user.findMany({
    where: { active: true },
    select: { id: true, displayName: true, role: true, title: true, senderName: true },
    orderBy: { displayName: "asc" },
  });
  return { data: users };
}

/** Danh sách tài khoản Account Hà Nội (cho manager chọn khi GIAO phần HN). */
export async function listHnAccounts(req: Request) {
  if (!can(req.session, P.QUOTE_HN_MANAGE)) throw httpError(403, "Không có quyền");
  // Tài khoản điền HN = ai có quyền quote:hn:fill (role account_hn mặc định HOẶC cấp riêng per-user).
  const data = await prisma.user.findMany({ where: { active: true, OR: [{ role: "account_hn" }, { permissions: { has: P.QUOTE_HN_FILL } }] }, select: { id: true, displayName: true, username: true }, orderBy: { displayName: "asc" } });
  return { data };
}

/** GET ONE — báo giá đầy đủ (QUOTE_INCLUDE) + 403 nếu không được read. Route present. */
export async function getQuote(req: Request) {
  const id = Number(req.params.id);
  const quote = await prisma.quote.findFirst({ where: { id }, include: QUOTE_INCLUDE });
  if (!quote) throw httpError(404, "Không tìm thấy báo giá");
  if (!canOnQuote(req.session, "read", quote)) {
    throw httpError(403, "Bạn không có quyền xem báo giá này");
  }
  return quote;
}

// ============================================================================
//  Quản lý DỰ ÁN (báo giá đã chốt): danh sách projects + ký chứng từ + hoá đơn
// ============================================================================

/**
 * PROJECTS (admin) — báo giá ĐÃ DUYỆT cho trang "Quản lý dự án", kèm breakdown theo
 * từng sheet (tên + subtotal). ⚠️ GIỮ NGUYÊN take:2000 (chỉ DI CHUYỂN, không đổi).
 */
export async function listProjects(req: Request) {
  // CHỈ Admin (user:manage) → xem TẤT CẢ dự án đã duyệt. Mọi người khác — kể cả người có
  // canSign (vd Lan Anh) lẫn quản lý thường → CHỈ XEM dự án đã duyệt do CHÍNH MÌNH tạo.
  const seeAll = can(req.session, P.USER_MANAGE);
  const where: Record<string, any> = { status: "converted", deletedAt: null };
  if (!seeAll) where.createdById = req.session.userId;
  const quotes = await prisma.quote.findMany({
    where,
    orderBy: [{ quoteDate: "desc" }, { id: "desc" }],
    // Safety cap: this endpoint pulls every sheet+item into memory to compute
    // per-sheet subtotals. Bound it so a very large history can't blow up RAM
    // (newest 2000 approved projects; raise + paginate if ever needed).
    take: 2000,
    select: {
      id: true, quoteNumber: true, projectCode: true, projectVersion: true,
      title: true, status: true, hnStatus: true, quoteDate: true, executionDate: true, vatPercent: true,
      subtotal: true, total: true, discount: true,
      company: { select: { name: true, shortName: true } },
      customer: { select: { code: true, name: true } },
      createdBy: { select: { displayName: true } },
      sheets: {
        orderBy: { order: "asc" },
        select: {
          id: true, order: true, name: true, subtotal: true, extraTables: true,
          signedAt: true, signedByName: true, invoiceNo: true, paidAt: true,
          poNumber: true, hnInvoiceNo: true, invoiceLink: true, docSentAt: true, docReturnedAt: true,
          template: { select: { company: { select: { shortName: true, name: true } } } },
        },
      },
    },
  });
  const data = quotes.map((q: any) => {
    // subtotal/sheet ĐÃ materialized (ghi lúc save) → KHÔNG kéo items + computeQuoteTotals nữa (perf).
    return {
      id: q.id,
      quoteNumber: q.quoteNumber,
      projectCode: q.projectCode,
      projectVersion: q.projectVersion,
      title: q.title,
      status: q.status,
      hnStatus: q.hnStatus || null,
      quoteDate: q.quoteDate,
      executionDate: q.executionDate,
      vatPercent: Number(q.vatPercent),
      subtotal: Number(q.subtotal),
      total: Number(q.total),
      company: q.company,
      customerCode: q.customer?.code ?? null,
      customerName: q.customer?.name ?? null,
      createdBy: q.createdBy,
      sheets: q.sheets.map((sh: any) => {
        const ex = Array.isArray(sh.extraTables) ? sh.extraTables : [];
        const sumCat = (cat: string) => ex.filter((t: any) => t && t.category === cat).reduce((acc: number, t: any) => acc + extraTableSum(t), 0);
        return {
          id: sh.id,
          name: sh.name || null,
          subtotal: Number(sh.subtotal),
          hcm: sumCat("hcm"),
          hanoi: sumCat("hanoi"),
          khach: sumCat("khach"),
          cty: sh.template?.company?.shortName || sh.template?.company?.name || null,
          signedAt: sh.signedAt,
          signedByName: sh.signedByName,
          invoiceNo: sh.invoiceNo || null,
          paidAt: sh.paidAt || null,
          poNumber: sh.poNumber || null,
          hnInvoiceNo: sh.hnInvoiceNo || null,
          invoiceLink: sh.invoiceLink || null,
          docSentAt: sh.docSentAt || null,
          docReturnedAt: sh.docReturnedAt || null,
          // Trạng thái luồng hoá đơn: "Done" CHỈ khi có CẢ số HĐ + ngày TT; có số HĐ → "Thanh toán"; chưa → "Hoá đơn".
          invStatus: (sh.invoiceNo && sh.paidAt) ? "done" : (sh.invoiceNo ? "payment" : "invoice"),
        };
      }),
    };
  });
  return { data };
}

/**
 * SIGN documents for ONE sheet (Ký Chứng từ). Admin ký MỌI dự án; người có canSign (vd Lan Anh)
 * chỉ ký dự án DO MÌNH TẠO. Chỉ quản lý nội bộ; không ảnh hưởng Excel/tổng.
 */
export async function signSheet(req: Request) {
  const me = await prisma.user.findUnique({ where: { id: req.session.userId }, select: { canSign: true, displayName: true } });
  const isAdmin = can(req.session, P.USER_MANAGE);
  if (!isAdmin && !me?.canSign) {
    throw httpError(403, "Bạn không có quyền ký chứng từ");
  }
  const sheet = await prisma.quoteSheet.findUnique({
    where: { id: Number(req.params.sheetId) },
    select: { id: true, quoteId: true, quote: { select: { status: true, deletedAt: true, createdById: true } } },
  });
  if (!sheet) throw httpError(404, "Không tìm thấy sheet");
  // CHỐNG IDOR: chỉ cho ký sheet của báo giá ĐÃ DUYỆT & chưa xoá (trang Quản lý dự án chỉ
  // hiện dự án đã duyệt). Không cho ký theo sheetId tuỳ ý (id tuần tự → dễ dò).
  if (sheet.quote?.status !== "converted" || sheet.quote?.deletedAt) {
    throw httpError(403, "Chỉ ký được chứng từ của báo giá đã chốt");
  }
  // Admin ký mọi dự án; người có canSign (vd Lan Anh) CHỈ ký dự án DO MÌNH TẠO.
  if (!isAdmin && sheet.quote?.createdById !== req.session.userId) {
    throw httpError(403, "Bạn chỉ ký được chứng từ của dự án do mình tạo");
  }
  const signed = req.body.signed !== false;
  const updated = await prisma.quoteSheet.update({
    where: { id: sheet.id },
    data: signed
      ? { signedAt: new Date(), signedById: req.session.userId, signedByName: me?.displayName || null }
      : { signedAt: null, signedById: null, signedByName: null },
    select: { id: true, signedAt: true, signedByName: true },
  });
  await audit(req, signed ? "quote.sign" : "quote.unsign", { resource: "quote", resourceId: sheet.quoteId });
  return { id: updated.id, signedAt: updated.signedAt, signedByName: updated.signedByName };
}

/**
 * HOÁ ĐƠN / THANH TOÁN cho 1 sheet (Quản lý dự án). CHỈ ADMIN (quyền gác ở route).
 * Số HĐ → "Thanh toán"; ngày thanh toán → "Done". Chỉ trên báo giá ĐÃ CHỐT.
 */
export async function updateSheetInvoice(req: Request) {
  const sheet = await prisma.quoteSheet.findUnique({
    where: { id: Number(req.params.sheetId) },
    select: { id: true, quoteId: true, quote: { select: { status: true, deletedAt: true } } },
  });
  if (!sheet) throw httpError(404, "Không tìm thấy sheet");
  if (sheet.quote?.status !== "converted" || sheet.quote?.deletedAt) {
    throw httpError(403, "Chỉ nhập hoá đơn cho dự án đã chốt");
  }
  const data: Record<string, any> = {};
  const setStr = (k: string) => { if (req.body[k] !== undefined) data[k] = req.body[k] ? String(req.body[k]).trim() : null; };
  const setDate = (k: string) => { if (req.body[k] !== undefined) data[k] = req.body[k] ? new Date(req.body[k]) : null; };
  setStr("invoiceNo"); setStr("poNumber"); setStr("hnInvoiceNo"); setStr("invoiceLink");
  setDate("paidAt"); setDate("docSentAt"); setDate("docReturnedAt");
  const updated = await prisma.quoteSheet.update({
    where: { id: sheet.id }, data,
    select: { id: true, invoiceNo: true, paidAt: true },
  });
  await audit(req, "quote.invoice", { resource: "quote", resourceId: sheet.quoteId, after: { sheetId: sheet.id, ...data } });
  const invStatus = (updated.invoiceNo && updated.paidAt) ? "done" : (updated.invoiceNo ? "payment" : "invoice");
  return { id: updated.id, invoiceNo: updated.invoiceNo, paidAt: updated.paidAt, invStatus };
}

// ============================================================================
//  Chốt / Không chốt (terminal transitions) — quyền gác ở route (QUOTE_SEND)
// ============================================================================

/** Đánh dấu báo giá ĐÃ CHỐT (won) — terminal, immutable, feed KPI. Route present. */
export async function markConverted(req: Request) {
  const id = Number(req.params.id);
  const existing = await prisma.quote.findFirst({ where: { id }, include: { members: { select: { id: true } } } });
  if (!existing) throw httpError(404, "Không tìm thấy báo giá");
  if (!canOnQuote(req.session, "update", existing)) {
    throw httpError(403, "Không có quyền chốt báo giá này");
  }
  if (["converted", "lost"].includes(existing.status)) {
    throw httpError(400, "Báo giá đã chốt / không chốt rồi");
  }
  // Optimistic guard: only convert if not already terminal — prevents a race with
  // a concurrent mark-lost / edit from producing a wrong terminal transition.
  const upd = await prisma.quote.updateMany({
    where: { id, status: { notIn: ["converted", "lost"] } },
    data: { status: "converted", convertedAt: new Date() },
  });
  if (!upd.count) {
    throw httpError(409, "Báo giá vừa đổi trạng thái — vui lòng tải lại");
  }
  const quote = await prisma.quote.findFirst({ where: { id }, include: QUOTE_INCLUDE });
  if (!quote) throw httpError(404, "Không tìm thấy báo giá");
  await audit(req, "quote.convert", { resource: "quote", resourceId: id, before: { status: existing.status } });
  emitWebhook("quote.converted", { id, quoteNumber: quote.quoteNumber, total: Number(quote.total) }).catch(() => {});
  return quote;
}

/** MARK LOST — khách từ chối; ghi lý do cho báo cáo win/loss. Route present. */
export async function markLost(req: Request) {
  const id = Number(req.params.id);
  const existing = await prisma.quote.findFirst({ where: { id }, include: { members: { select: { id: true } } } });
  if (!existing) throw httpError(404, "Không tìm thấy báo giá");
  if (!canOnQuote(req.session, "update", existing)) {
    throw httpError(403, "Không có quyền cập nhật báo giá này");
  }
  if (existing.status === "converted") {
    throw httpError(400, "Báo giá đã chốt, không thể đánh dấu thua");
  }
  if (existing.status === "lost") {
    throw httpError(400, "Báo giá đã được đánh dấu thua");
  }
  // Optimistic guard: only flip if still NOT terminal — also stops a re-mark from
  // prepending the reason to notes twice under a race.
  const newNotes = req.body.reason
    ? `[Lý do không chốt] ${req.body.reason}\n${existing.notes || ""}`.slice(0, 4000)
    : existing.notes;
  const upd = await prisma.quote.updateMany({
    where: { id, status: { notIn: ["converted", "lost"] } },
    data: { status: "lost", notes: newNotes },
  });
  if (!upd.count) {
    throw httpError(409, "Báo giá vừa đổi trạng thái — vui lòng tải lại");
  }
  const quote = await prisma.quote.findFirst({ where: { id }, include: QUOTE_INCLUDE });
  await audit(req, "quote.lost", { resource: "quote", resourceId: id, before: { status: existing.status }, after: { reason: req.body.reason || null } });
  return quote;
}

// ============================================================================
//  VERSIONS / APPROVALS / MEMBERS / DELETE / DUPLICATE
// ============================================================================

/** Danh sách phiên bản của báo giá (đã 403/404 qua loadAuthorizedQuote). */
export async function listVersions(req: Request) {
  const id = Number(req.params.id);
  await loadAuthorizedQuote(req, "read");
  const versions = await prisma.quoteVersion.findMany({
    where: { quoteId: id },
    orderBy: { versionNo: "desc" },
    select: { id: true, versionNo: true, total: true, createdAt: true, createdById: true },
  });
  return {
    data: versions.map((v) => ({ ...v, id: v.id.toString(), total: Number(v.total) })),
  };
}

/** Lấy 1 phiên bản theo versionNo. */
export async function getVersion(req: Request) {
  await loadAuthorizedQuote(req, "read");
  const ver = await prisma.quoteVersion.findUnique({
    where: { quoteId_versionNo: { quoteId: Number(req.params.id), versionNo: Number(req.params.v) } },
  });
  if (!ver) throw httpError(404, "Không tìm thấy phiên bản");
  return { ...ver, id: ver.id.toString(), total: Number(ver.total) };
}

/** Diff 2 phiên bản (a→b). */
export async function diffVersionsService(req: Request) {
  await loadAuthorizedQuote(req, "read");
  const id = Number(req.params.id);
  const a = Number(req.params.a);
  const b = Number(req.params.b);
  const [va, vb] = await Promise.all([
    prisma.quoteVersion.findUnique({ where: { quoteId_versionNo: { quoteId: id, versionNo: a } } }),
    prisma.quoteVersion.findUnique({ where: { quoteId_versionNo: { quoteId: id, versionNo: b } } }),
  ]);
  if (!va || !vb) throw httpError(404, "Phiên bản không tồn tại");
  return { from: a, to: b, changes: diffVersions(va.payload, vb.payload) };
}

/** APPROVAL trail của báo giá. */
export async function listApprovals(req: Request) {
  await loadAuthorizedQuote(req, "read");
  const rows = await prisma.approval.findMany({
    where: { quoteId: Number(req.params.id) },
    orderBy: [{ versionNo: "asc" }, { level: "asc" }],
    include: { approver: { select: { id: true, username: true, displayName: true } } },
  });
  return { data: rows };
}

/**
 * MEMBERS — add/remove employees who may view & edit this quote.
 * Chỉ người tạo (hoặc admin) mới quản lý được danh sách thành viên.
 */
export async function updateMembers(req: Request) {
  const id = Number(req.params.id);
  const quote = await prisma.quote.findFirst({ where: { id } });
  if (!quote) throw httpError(404, "Không tìm thấy báo giá");
  if (quote.createdById !== req.session.userId && !can(req.session, P.QUOTE_UPDATE_ALL)) {
    throw httpError(403, "Chỉ người tạo hoặc Quản trị mới quản lý được thành viên");
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
  if (!updated) throw httpError(404, "Không tìm thấy báo giá");
  return { members: updated.members };
}

/** SOFT DELETE báo giá (db middleware). Won deal terminal — không ai xoá được. */
export async function deleteQuote(req: Request) {
  const id = Number(req.params.id);
  const existing = await prisma.quote.findFirst({ where: { id } });
  if (!existing) throw httpError(404, "Không tìm thấy báo giá");
  // A won deal is terminal — nobody (not even delete:all) may remove it.
  if (existing.status === "converted") {
    throw httpError(400, "Không thể xóa báo giá đã chốt");
  }
  const ownerDraftDelete =
    canOnQuote(req.session, "delete", existing) &&
    (existing.status === "draft" || existing.status === "rejected");
  if (!ownerDraftDelete && !can(req.session, P.QUOTE_DELETE_ALL)) {
    throw httpError(403, "Chỉ Quản trị hoặc người tạo (báo giá ở trạng thái Nháp/Bị từ chối) mới được xóa");
  }
  await prisma.quote.delete({ where: { id } }); // soft delete via middleware
  await audit(req, "quote.delete", { resource: "quote", resourceId: id, before: { status: existing.status } });
  return { ok: true };
}

/**
 * DUPLICATE báo giá. sameProject=true → bản mới CÙNG mã dự án (v2/v3…) gửi khách; ngược lại
 * → mã dự án mới theo người tạo. Cấp số + tạo + snapshot v1 trong 1 transaction, retry P2002.
 * Route present (presentQuote) kết quả.
 */
export async function duplicateQuote(req: Request) {
  const id = Number(req.params.id);
  const src: any = await prisma.quote.findFirst({ where: { id }, include: QUOTE_INCLUDE });
  if (!src) throw httpError(404, "Không tìm thấy báo giá");
  // Must be allowed to read the source AND to create quotes.
  if (!canOnQuote(req.session, "read", src)) {
    throw httpError(403, "Bạn không có quyền sao chép báo giá này");
  }
  if (!can(req.session, P.QUOTE_CREATE)) {
    throw httpError(403, "Không có quyền tạo báo giá");
  }

  const sameProject = req.body.sameProject === true;
  const t = computeQuoteTotals({ vatPercent: src.vatPercent, discount: src.discount, sheets: src.sheets });

  // Resolve title + project-code base. The version number is computed INSIDE the tx
  // (below) so a P2002 from the @@unique([projectCode, projectVersion]) constraint retries
  // onto the next free version instead of two concurrent "Bản mới" both landing on _v2.
  let newTitle = src.title + " (copy)";
  let sameProjectCode = null;
  let dupCreatorProjectCode: string | null = null;
  if (sameProject) {
    // Bản mới CÙNG mã dự án (v2, v3…) để gửi khách — giữ projectCode.
    sameProjectCode = src.projectCode || src.quoteNumber;
    newTitle = src.title; // giữ nguyên tiêu đề; phân biệt bằng nhãn v{n}
  } else {
    const dupCreator = await prisma.user.findUnique({ where: { id: req.session.userId }, select: { projectCode: true } });
    dupCreatorProjectCode = dupCreator?.projectCode || null;
  }

  const buildData = (quoteNumber: string, projectCode: string | null, projectVersion: number) => ({
    quoteNumber,
    projectCode,
    projectVersion,
    searchText: normalizeSearch(quoteNumber, projectCode, newTitle, src.toCompany, src.toContact),
    title: newTitle,
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
    toEmail: src.toEmail,
    toPhone: src.toPhone,
    toAddress: src.toAddress,
    notes: src.notes,
    status: "draft",
    subtotal: t.subtotal,
    vat: t.vat,
    discount: t.discount,
    total: t.total,
    createdById: req.session.userId,
    members: { connect: [{ id: req.session.userId }] },
    sheets: {
      create: src.sheets.map((s: any, sIdx: number) => ({
        templateId: s.templateId,
        name: s.name,
        order: s.order != null ? s.order : sIdx + 1,
        groupSubtotal: s.groupSubtotal,
        subtotal: t.sheetTotals[sIdx]?.subtotal ?? D(0),   // materialized (= subtotal nguồn)
        items: {
          create: s.items.map((it: any, iIdx: number) => ({
            order: it.order != null ? it.order : iIdx + 1,
            productId: it.productId ?? null,   // keep the catalog link on copy
            kind: it.kind || "item",
            label: it.label,
            name: it.name,
            detail: it.detail,
            unit: it.unit,
            quantity: it.quantity,
            unitPrice: it.unitPrice,
            days: it.days,
            notes: it.notes,
            internalNote: it.internalNote,
          })),
        },
        extraTables: s.extraTables ?? undefined,
      })),
    },
  });

  // Allocate the number (+ per-employee project code) and create + snapshot v1
  // INSIDE one transaction with a P2002 retry — mirrors the main create path so a
  // failed insert rolls the counter back (no burned numbers) and the copy always
  // gets an initial QuoteVersion snapshot.
  let created;
  for (let attempt = 0; ; attempt++) {
    try {
      created = await prisma.$transaction(async (tx: any) => {
        const quoteNumber = await nextQuoteNumber(src.company?.quotePrefix || "GN", tx);
        let projectCode, projectVersion;
        if (sameProject) {
          projectCode = sameProjectCode;
          // Tính version trong tx + includeDeleted → đơn điệu, không tái dùng số của bản
          // xóa-mềm; khi 2 request đua nhau, P2002 đẩy lần retry sang version kế tiếp.
          const agg = await tx.quote.aggregate({ where: { projectCode: sameProjectCode }, _max: { projectVersion: true }, includeDeleted: true });
          projectVersion = Math.max(src.projectVersion || 1, agg._max.projectVersion || 0) + 1;
        } else {
          projectCode = dupCreatorProjectCode ? await nextProjectCode(dupCreatorProjectCode, tx) : null;
          projectVersion = 1;
        }
        const c = await tx.quote.create({ data: buildData(quoteNumber, projectCode, projectVersion), include: QUOTE_INCLUDE });
        await snapshotQuoteVersion(tx, c.id, req.session.userId, "duplicate");
        return c;
      });
      break;
    } catch (e) {
      const code = e instanceof Prisma.PrismaClientKnownRequestError ? e.code : undefined;
      if (code === "P2002" && attempt < 3) continue;
      if (code === "P2002") throw httpError(409, "Số báo giá bị trùng, vui lòng thử lại");
      throw e;
    }
  }
  await audit(req, "quote.duplicate", { resource: "quote", resourceId: created.id, after: { from: src.id, quoteNumber: created.quoteNumber } });
  return created;
}
