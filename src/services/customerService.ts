// Tầng SERVICE cho domain Khách hàng (CRM). Bê NGUYÊN logic từ customers.routes.ts (giữ hành vi
// y hệt) ra đây: phân quyền theo phạm vi (canScoped/READ_ALL/MANAGE_ALL), sinh mã, chống trùng
// mã/MST, audit. Route chỉ còn: validate → gọi service → res. Mẫu chuẩn theo quoteService.ts.
import { prisma } from "../db.js";
import { audit } from "../audit.js";
import { nextCustomerCode } from "../codeAllocator.js";
import { can, canScoped, PERMISSIONS as P } from "../permissions.js";
import { httpError } from "../quoteService.js";

// Tải khách hàng + 403 nếu caller không được làm `action` (read|manage) với nó.
async function loadAuthorized(req, action) {
  const customer = await prisma.customer.findFirst({ where: { id: req.params.id } });
  if (!customer) throw httpError(404, "Không tìm thấy khách hàng");
  if (!canScoped(req.session, "customer", action, customer)) throw httpError(403, "Bạn không có quyền với khách hàng này");
  return customer;
}

export async function listCustomers(req) {
  const { q, status, tag, ownerId, page, size, sort, order } = req.query;
  const where: Record<string, any> = {};
  if (status) where.status = status;
  // Cô lập dữ liệu: ai không có "read all" chỉ thấy khách của MÌNH.
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
  return { data, meta: { total, page, size, pageCount: Math.ceil(total / size) } };
}

export async function createCustomer(req) {
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
  const customer = await prisma.customer.create({
    data,
    include: { owner: { select: { id: true, displayName: true } } },
  });
  await audit(req, "customer.create", { resource: "customer", resourceId: customer.id, after: customer });
  return customer;
}

export async function getCustomer(req) {
  await loadAuthorized(req, "read");
  const customer = await prisma.customer.findFirst({
    where: { id: req.params.id },
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

export async function updateCustomer(req) {
  const before = await loadAuthorized(req, "manage");
  const data = { ...req.body };
  // Chỉ user đặc quyền mới đổi chủ sở hữu; còn lại strip.
  if (!can(req.session, P.CUSTOMER_MANAGE_ALL)) delete data.ownerId;
  const customer = await prisma.customer.update({ where: { id: req.params.id }, data });
  await audit(req, "customer.update", { resource: "customer", resourceId: customer.id, before, after: customer });
  return customer;
}

export async function deleteCustomer(req) {
  const before = await loadAuthorized(req, "manage");
  await prisma.customer.delete({ where: { id: req.params.id } }); // soft delete (db middleware)
  await audit(req, "customer.delete", { resource: "customer", resourceId: req.params.id, before });
  return { ok: true };
}

export async function addNote(req) {
  await loadAuthorized(req, "manage");
  const note = await prisma.customerNote.create({
    data: { customerId: req.params.id, body: req.body.body, authorId: req.session.userId },
  });
  await audit(req, "customer.note.add", { resource: "customer", resourceId: req.params.id });
  return note;
}

export async function addFollowUp(req) {
  await loadAuthorized(req, "manage");
  return prisma.followUp.create({
    data: {
      customerId: req.params.id,
      dueAt: req.body.dueAt,
      note: req.body.note,
      assigneeId: req.body.assigneeId ?? req.session.userId,
    },
  });
}

export async function markFollowUpDone(req) {
  const f = await prisma.followUp.findUnique({
    where: { id: req.params.fid },
    include: { customer: { select: { ownerId: true } } },
  });
  if (!f) throw httpError(404, "Không tìm thấy công việc cần theo dõi");
  const owns = f.assigneeId === req.session.userId || canScoped(req.session, "customer", "manage", f.customer);
  if (!owns) throw httpError(403, "Không có quyền với công việc này");
  return prisma.followUp.update({ where: { id: req.params.fid }, data: { doneAt: new Date() } });
}
