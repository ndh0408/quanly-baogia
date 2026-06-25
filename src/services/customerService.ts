// Tầng SERVICE cho domain Khách hàng (CRM). Bê NGUYÊN logic từ customers.routes.ts (giữ hành vi
// y hệt) ra đây: phân quyền theo phạm vi (canScoped/READ_ALL/MANAGE_ALL), sinh mã, chống trùng
// mã/MST, audit. Route chỉ còn: validate → gọi service → res. Mẫu chuẩn theo quoteService.ts.
import type { Request } from "express";
import { prisma } from "../db.js";
import { audit } from "../audit.js";
import { nextCustomerCode } from "../codeAllocator.js";
import { can, canScoped, PERMISSIONS as P } from "../permissions.js";
import { httpError } from "../httpError.js";
import { normalizeSearch, searchTextFilter } from "../searchText.js";

type Action = "read" | "manage";

// Tải khách hàng + 403 nếu caller không được làm `action` (read|manage) với nó.
async function loadAuthorized(req: Request, action: Action) {
  const customer = await prisma.customer.findFirst({ where: { id: (req.params as any).id } });
  if (!customer) throw httpError(404, "Không tìm thấy khách hàng");
  if (!canScoped(req.session, "customer", action, customer)) throw httpError(403, "Bạn không có quyền với khách hàng này");
  return customer;
}

export async function listCustomers(req: Request) {
  const { q, status, tag, ownerId, page, size, sort, order } = req.query as any;
  const where: Record<string, any> = {};
  if (status) where.status = status;
  // Cô lập dữ liệu: ai không có "read all" chỉ thấy khách của MÌNH.
  if (can(req.session, P.CUSTOMER_READ_ALL)) {
    if (ownerId) where.ownerId = ownerId;
  } else {
    where.ownerId = req.session.userId;
  }
  if (tag) where.tags = { has: tag };
  // Tìm KHÔNG dấu / sai dấu: khớp trên cột searchText đã chuẩn-hóa (gồm name+code+phone+email+taxCode+contactName).
  if (q) where.searchText = searchTextFilter(q);
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
  return { data, meta: { total, page, size, pageCount: Math.ceil(total / size) } };
}

export async function createCustomer(req: Request) {
  let code = req.body.code;
  if (!code) code = await nextCustomerCode("KH");
  else {
    // includeDeleted: unique constraint trên `code` phủ cả bản xoá-mềm → check qua MỌI bản cho 409 sạch.
    const dup = await prisma.customer.findFirst({ where: { code }, includeDeleted: true } as any);
    if (dup) throw httpError(409, dup.deletedAt ? "Mã thuộc khách hàng đã xoá" : "Mã khách hàng đã tồn tại");
  }
  // Chống trùng MST: cùng công ty (cùng MST) nhập 2 lần làm phân mảnh doanh số/follow-up.
  if (req.body.taxCode) {
    const dupTax = await prisma.customer.findFirst({ where: { taxCode: req.body.taxCode.trim() } });
    if (dupTax) throw httpError(409, `Mã số thuế đã thuộc khách hàng ${dupTax.code} — ${dupTax.name}`);
  }
  const data = { ...req.body, code };
  if (data.taxCode) data.taxCode = data.taxCode.trim();
  // Chỉ user đặc quyền mới gán owner khác mình.
  if (!can(req.session, P.CUSTOMER_MANAGE_ALL)) data.ownerId = req.session.userId;
  else if (data.ownerId == null) data.ownerId = req.session.userId;
  data.searchText = normalizeSearch(data.name, data.code, data.phone, data.email, data.taxCode, data.contactName);
  const customer = await prisma.customer.create({
    data,
    include: { owner: { select: { id: true, displayName: true } } },
  });
  await audit(req, "customer.create", { resource: "customer", resourceId: customer.id, after: customer });
  return customer;
}

export async function getCustomer(req: Request) {
  await loadAuthorized(req, "read");
  const customer = await prisma.customer.findFirst({
    where: { id: (req.params as any).id },
    include: {
      owner: { select: { id: true, displayName: true, username: true } },
      notes: { orderBy: { createdAt: "desc" }, take: 50 },
      followUps: { orderBy: { dueAt: "asc" }, take: 50 },
    },
  });
  if (!customer) throw httpError(404, "Không tìm thấy khách hàng");
  const quoteCount = await prisma.quote.count({ where: { customerId: customer.id } });
  return { ...customer, quoteCount };
}

export async function updateCustomer(req: Request) {
  const before = await loadAuthorized(req, "manage");
  const data = { ...req.body };
  // Chỉ user đặc quyền mới đổi chủ sở hữu; còn lại strip.
  if (!can(req.session, P.CUSTOMER_MANAGE_ALL)) delete data.ownerId;
  // Tính lại searchText theo giá trị SẼ ghi: field có trong payload thì dùng nó (KỂ CẢ null = xóa),
  // không thì giữ giá trị cũ. Dùng `k in data` thay `?? before` để xóa-rỗng phản ánh đúng (không stale).
  const pick = (k: string) => (k in data ? data[k] : (before as any)[k]);
  data.searchText = normalizeSearch(pick("name"), pick("code"), pick("phone"), pick("email"), pick("taxCode"), pick("contactName"));
  const customer = await prisma.customer.update({ where: { id: (req.params as any).id }, data });
  await audit(req, "customer.update", { resource: "customer", resourceId: customer.id, before, after: customer });
  return customer;
}

export async function deleteCustomer(req: Request) {
  const before = await loadAuthorized(req, "manage");
  await prisma.customer.delete({ where: { id: (req.params as any).id } }); // soft delete (db middleware)
  await audit(req, "customer.delete", { resource: "customer", resourceId: (req.params as any).id, before });
  return { ok: true };
}

export async function addNote(req: Request) {
  await loadAuthorized(req, "manage");
  const note = await prisma.customerNote.create({
    data: { customerId: (req.params as any).id, body: req.body.body, authorId: req.session.userId },
  });
  await audit(req, "customer.note.add", { resource: "customer", resourceId: (req.params as any).id });
  return note;
}

export async function addFollowUp(req: Request) {
  await loadAuthorized(req, "manage");
  return prisma.followUp.create({
    data: {
      customerId: (req.params as any).id,
      dueAt: req.body.dueAt,
      note: req.body.note,
      assigneeId: req.body.assigneeId ?? req.session.userId,
    },
  });
}

export async function markFollowUpDone(req: Request) {
  const f = await prisma.followUp.findUnique({
    where: { id: (req.params as any).fid },
    include: { customer: { select: { ownerId: true } } },
  });
  if (!f) throw httpError(404, "Không tìm thấy công việc cần theo dõi");
  const owns = f.assigneeId === req.session.userId || canScoped(req.session, "customer", "manage", f.customer);
  if (!owns) throw httpError(403, "Không có quyền với công việc này");
  return prisma.followUp.update({ where: { id: (req.params as any).fid }, data: { doneAt: new Date() } });
}
