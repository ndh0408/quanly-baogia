// Tầng SERVICE cho domain Danh bạ NHÂN VIÊN (kho thông tin cá nhân DÙNG CHUNG, không phân quyền
// theo owner). Bê NGUYÊN logic từ employees.routes.ts (giữ hành vi y hệt): prisma query + audit.
// Cổng quyền (requirePermission) GIỮ ở route. Route chỉ còn: validate → gọi service → res.
import type { Request } from "express";
import { prisma } from "../db.js";
import { audit } from "../audit.js";
import { httpError } from "../quoteService.js";

const ownerSelect = { createdBy: { select: { id: true, displayName: true, username: true } } };

export async function listEmployees(req: Request) {
  const { q, page, size, sort, order } = req.query as any;
  const where: Record<string, any> = {};
  if (q) {
    where.OR = [
      { fullName: { contains: q, mode: "insensitive" } },
      { taxCode: { contains: q } },
      { phone: { contains: q } },
      { idCard: { contains: q } },
      { bankAccount: { contains: q } },
    ];
  }
  const [total, data] = await Promise.all([
    prisma.employee.count({ where }),
    prisma.employee.findMany({ where, orderBy: { [sort]: order }, skip: (page - 1) * size, take: size, include: ownerSelect }),
  ]);
  return { data, meta: { total, page, size, pageCount: Math.ceil(total / size) } };
}

export async function createEmployee(req: Request) {
  const rec = await prisma.employee.create({ data: { ...req.body, createdById: req.session.userId }, include: ownerSelect });
  await audit(req, "employee.create", { resource: "employee", resourceId: rec.id });
  return rec;
}

export async function updateEmployee(req: Request) {
  const before = await prisma.employee.findFirst({ where: { id: (req.params as any).id } });
  if (!before) throw httpError(404, "Không tìm thấy nhân viên");
  const rec = await prisma.employee.update({ where: { id: (req.params as any).id }, data: req.body, include: ownerSelect });
  await audit(req, "employee.update", { resource: "employee", resourceId: rec.id });
  return rec;
}

export async function deleteEmployee(req: Request) {
  const before = await prisma.employee.findFirst({ where: { id: (req.params as any).id } });
  if (!before) throw httpError(404, "Không tìm thấy nhân viên");
  await prisma.employee.delete({ where: { id: (req.params as any).id } });   // soft delete (db.js)
  await audit(req, "employee.delete", { resource: "employee", resourceId: (req.params as any).id });
  return { ok: true };
}
