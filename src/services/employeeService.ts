// Tầng SERVICE cho domain Danh bạ NHÂN VIÊN (kho thông tin cá nhân DÙNG CHUNG, không phân quyền
// theo owner). Bê NGUYÊN logic từ employees.routes.ts (giữ hành vi y hệt): prisma query + audit.
// Cổng quyền (requirePermission) GIỮ ở route. Route chỉ còn: validate → gọi service → res.
import type { Request } from "express";
import { prisma } from "../db.js";
import { audit } from "../audit.js";
import { httpError } from "../httpError.js";
import { encodePiiForWrite, decodePiiOnRead, decodePiiList, idCardLookupWhere } from "../piiFields.js";

const ownerSelect = { createdBy: { select: { id: true, displayName: true, username: true } } };

export async function listEmployees(req: Request) {
  const { q, page, size, sort, order } = req.query as any;
  const where: Record<string, any> = {};
  if (q) {
    // idCard/bankAccount đã mã hoá thì KHÔNG còn tìm "chứa" được — bản mã không giữ thứ tự ký tự.
    // Đổi sang khớp CHÍNH XÁC qua chỉ mục mù cho CCCD; số tài khoản bỏ khỏi tìm kiếm (không ai tìm
    // nhân viên theo một phần số tài khoản). Chưa bật mã hoá thì giữ nguyên hành vi cũ.
    const byIdCard = idCardLookupWhere(q);
    where.OR = [
      { fullName: { contains: q, mode: "insensitive" } },
      { taxCode: { contains: q } },
      { phone: { contains: q } },
      ...(byIdCard ? [byIdCard] : [{ idCard: { contains: q } }, { bankAccount: { contains: q } }]),
    ];
  }
  const [total, data] = await Promise.all([
    prisma.employee.count({ where }),
    prisma.employee.findMany({ where, orderBy: { [sort]: order }, skip: (page - 1) * size, take: size, include: ownerSelect }),
  ]);
  return { data: decodePiiList("Employee", data), meta: { total, page, size, pageCount: Math.ceil(total / size) } };
}

export async function createEmployee(req: Request) {
  const rec = await prisma.employee.create({ data: encodePiiForWrite("Employee", { ...req.body, createdById: req.session.userId }) as any, include: ownerSelect });
  await audit(req, "employee.create", { resource: "employee", resourceId: rec.id });
  return decodePiiOnRead("Employee", rec);
}

export async function updateEmployee(req: Request) {
  const before = await prisma.employee.findFirst({ where: { id: (req.params as any).id } });
  if (!before) throw httpError(404, "Không tìm thấy nhân viên");
  const rec = await prisma.employee.update({ where: { id: (req.params as any).id }, data: encodePiiForWrite("Employee", req.body) as any, include: ownerSelect });
  await audit(req, "employee.update", { resource: "employee", resourceId: rec.id });
  return decodePiiOnRead("Employee", rec);
}

export async function deleteEmployee(req: Request) {
  const before = await prisma.employee.findFirst({ where: { id: (req.params as any).id } });
  if (!before) throw httpError(404, "Không tìm thấy nhân viên");
  await prisma.employee.delete({ where: { id: (req.params as any).id } });   // soft delete (db.js)
  await audit(req, "employee.delete", { resource: "employee", resourceId: (req.params as any).id });
  return { ok: true };
}
