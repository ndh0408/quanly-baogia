// Tầng SERVICE cho domain Khách hàng (CRM). Bê NGUYÊN logic từ customers.routes.ts (giữ hành vi
// y hệt) ra đây: phân quyền theo phạm vi (canScoped/READ_ALL/MANAGE_ALL), sinh mã, chống trùng
// mã/MST, audit. Route chỉ còn: validate → gọi service → res. Mẫu chuẩn theo quoteService.ts.
import type { Request } from "express";
import { prisma } from "../db.js";
import { audit } from "../audit.js";
import { nextCustomerCode } from "../codeAllocator.js";
import { can, canScoped, readScopeWhereOrThrow, PERMISSIONS as P } from "../permissions.js";
import { httpError } from "../httpError.js";
import { normalizeSearch, searchTextFilter } from "../searchText.js";

type Action = "read" | "edit" | "delete"; // NGUYÊN TỬ: edit/delete riêng (trước gộp "manage")

/**
 * Dịch P2002 (đụng ràng buộc duy nhất ở CSDL) thành ĐÚNG thông điệp 409 mà người dùng vốn nhận.
 *
 * Các lần kiểm trùng phía dưới là check-then-write NGOÀI transaction: chúng cho lỗi 409 đọc được,
 * nhưng KHÔNG đóng được cửa sổ đua vài mili-giây khi hai người nhập cùng một MST. Cửa sổ đó nay do
 * index `Customer_taxCode_live_key` (migration 20260826120000) đóng — nhưng nếu để P2002 rơi thẳng
 * ra thì người thua cuộc nhận 500 "Lỗi server" thay vì câu tiếng Việt nói rõ MST thuộc về ai.
 */
async function nem409TuP2002(e: unknown, taxCode?: string | null): Promise<never> {
  const err = e as { code?: string; meta?: { target?: unknown } };
  if (err?.code !== "P2002") throw e;
  // `target` có thể là mảng cột (["taxCode"]) hoặc TÊN INDEX ("Customer_taxCode_live_key") tuỳ
  // ràng buộc là @unique của Prisma hay index thô — so trên chuỗi phủ được cả hai.
  const target = String(err.meta?.target ?? "");
  if (target.includes("taxCode")) {
    if (taxCode) {
      const chu = await prisma.customer.findFirst({ where: { taxCode } });
      if (chu) throw httpError(409, `Mã số thuế đã thuộc khách hàng ${chu.code} — ${chu.name}`);
    }
    throw httpError(409, "Mã số thuế đã thuộc khách hàng khác");
  }
  if (target.includes("code")) throw httpError(409, "Mã khách hàng đã tồn tại");
  throw e;
}

// Tải khách hàng + 403 nếu caller không được làm `action` (read|edit|delete) với nó.
async function loadAuthorized(req: Request, action: Action) {
  const customer = await prisma.customer.findFirst({ where: { id: (req.params as any).id } });
  if (!customer) throw httpError(404, "Không tìm thấy khách hàng");
  if (!canScoped(req.session, "customer", action, customer)) throw httpError(403, "Bạn không có quyền với khách hàng này");
  return customer;
}

export async function listCustomers(req: Request) {
  const { q, status, tag, ownerId, page, size, sort, order } = req.query as any;
  // 🔒 CỔNG QUYỀN TRƯỚC PHẠM VI (deny by default): read:all → mọi khách; read:own → khách của mình;
  // KHÔNG có quyền đọc nào → 403. Trước đây thiếu :all là rơi thẳng xuống phạm vi own, nên tài khoản
  // KHÔNG có quyền khách hàng nào (kế toán / nhân sự / account HN, hoặc người bị gỡ quyền) vẫn nhận
  // 200 kèm hồ sơ khách mình còn đứng tên — lộ tên/điện thoại/email/MST của khách.
  const where: Record<string, any> = { ...readScopeWhereOrThrow(req.session, "customer") };
  if (status) where.status = status;
  // read:all mới được lọc theo chủ sở hữu khác; read:own đã bị ghim vào ownerId của chính mình.
  if (ownerId && can(req.session, P.CUSTOMER_READ_ALL)) where.ownerId = ownerId;
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
  if (!can(req.session, P.CUSTOMER_CREATE)) throw httpError(403, "Bạn không có quyền tạo khách hàng");
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
  // Chỉ user sửa-được-mọi-KH mới gán owner khác mình.
  if (!can(req.session, P.CUSTOMER_EDIT_ALL)) data.ownerId = req.session.userId;
  else if (data.ownerId == null) data.ownerId = req.session.userId;
  data.searchText = normalizeSearch(data.name, data.code, data.phone, data.email, data.taxCode, data.contactName);
  const customer = await prisma.customer.create({
    data,
    include: { owner: { select: { id: true, displayName: true } } },
  }).catch((e) => nem409TuP2002(e, data.taxCode));
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
  const before = await loadAuthorized(req, "edit");
  const data = { ...req.body };
  // Chỉ user sửa-được-mọi-KH mới đổi chủ sở hữu; còn lại strip.
  if (!can(req.session, P.CUSTOMER_EDIT_ALL)) delete data.ownerId;
  // Đổi MÃ / MST: kiểm trùng TRƯỚC khi ghi để trả 409 rõ ràng (thay vì P2002 lộ ra như lỗi lạ) và
  // để không cướp mã của khách khác. includeDeleted vì unique phủ cả bản xoá-mềm — khớp createCustomer.
  if (data.code && data.code !== before.code) {
    const dup = await prisma.customer.findFirst({ where: { code: data.code }, includeDeleted: true } as any);
    if (dup) throw httpError(409, dup.deletedAt ? "Mã thuộc khách hàng đã xoá" : "Mã khách hàng đã tồn tại");
  }
  if (data.taxCode) {
    data.taxCode = String(data.taxCode).trim();
    if (data.taxCode !== before.taxCode) {
      const dupTax = await prisma.customer.findFirst({ where: { taxCode: data.taxCode, id: { not: before.id } } });
      if (dupTax) throw httpError(409, `Mã số thuế đã thuộc khách hàng ${dupTax.code} — ${dupTax.name}`);
    }
  }
  // Tính lại searchText theo giá trị SẼ ghi: field có trong payload thì dùng nó (KỂ CẢ null = xóa),
  // không thì giữ giá trị cũ. Dùng `k in data` thay `?? before` để xóa-rỗng phản ánh đúng (không stale).
  const pick = (k: string) => (k in data ? data[k] : (before as any)[k]);
  data.searchText = normalizeSearch(pick("name"), pick("code"), pick("phone"), pick("email"), pick("taxCode"), pick("contactName"));
  const customer = await prisma.customer.update({ where: { id: (req.params as any).id }, data })
    .catch((e) => nem409TuP2002(e, data.taxCode));
  await audit(req, "customer.update", { resource: "customer", resourceId: customer.id, before, after: customer });
  return customer;
}

export async function deleteCustomer(req: Request) {
  const before = await loadAuthorized(req, "delete");
  await prisma.customer.delete({ where: { id: (req.params as any).id } }); // soft delete (db middleware)
  await audit(req, "customer.delete", { resource: "customer", resourceId: (req.params as any).id, before });
  return { ok: true };
}

export async function addNote(req: Request) {
  await loadAuthorized(req, "read");
  if (!can(req.session, P.CUSTOMER_NOTE_ADD)) throw httpError(403, "Bạn không có quyền ghi chú khách hàng");
  const note = await prisma.customerNote.create({
    data: { customerId: (req.params as any).id, body: req.body.body, authorId: req.session.userId },
  });
  await audit(req, "customer.note.add", { resource: "customer", resourceId: (req.params as any).id });
  return note;
}

export async function addFollowUp(req: Request) {
  await loadAuthorized(req, "read");
  if (!can(req.session, P.CUSTOMER_NOTE_ADD)) throw httpError(403, "Bạn không có quyền thêm việc theo dõi");
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
  const owns = f.assigneeId === req.session.userId || canScoped(req.session, "customer", "edit", f.customer);
  if (!owns) throw httpError(403, "Không có quyền với công việc này");
  return prisma.followUp.update({ where: { id: (req.params as any).fid }, data: { doneAt: new Date() } });
}
