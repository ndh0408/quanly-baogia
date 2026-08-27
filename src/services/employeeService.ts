// Tầng SERVICE cho domain Danh bạ NHÂN VIÊN (kho thông tin cá nhân dùng chung khi GHI). Bê NGUYÊN
// logic từ employees.routes.ts: prisma query + audit. Cổng quyền (requirePermission) GIỮ ở route,
// còn PHẠM VI thì ở đây — route chỉ biết "có quyền đọc/sửa không", không biết "được đụng của ai".
// PHẠM VI GHI (PUT/DELETE) bám theo đúng PHẠM VI ĐỌC, xem assertEmployeeInReadScope bên dưới.
import type { Request } from "express";
import { prisma } from "../db.js";
import { audit } from "../audit.js";
import { httpError } from "../httpError.js";
import { canScoped, readScopeWhereOrThrow } from "../permissions.js";
import { encodePiiForWrite, decodePiiOnRead, decodePiiList, idCardLookupWhere } from "../piiFields.js";
import { phanTrang } from "../pagination.js";

const ownerSelect = { createdBy: { select: { id: true, displayName: true, username: true } } };

export async function listEmployees(req: Request) {
  const { q, page, size, sort, order } = req.query as any;
  // `{}` cứng ở đây biến ô tích HẸP NHẤT trên ma trận phân quyền ("Xem danh bạ của mình") thành
  // quyền đọc CCCD + số tài khoản của TOÀN BỘ công ty — người cấp quyền tưởng đang giới hạn.
  // `:all` vẫn trả `{}` nên mọi vai trò mặc định (EMPLOYEE/MANAGER/ADMIN đều có employee:read:all)
  // giữ nguyên hành vi cũ. Xem tests/rbacscope-employee-directory.test.js.
  const where: Record<string, any> = readScopeWhereOrThrow(req.session, "employee", "createdById");
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
  return phanTrang(decodePiiList("Employee", data), total, page, size);
}

export async function createEmployee(req: Request) {
  const rec = await prisma.employee.create({ data: encodePiiForWrite("Employee", { ...req.body, createdById: req.session.userId }) as any, include: ownerSelect });
  await audit(req, "employee.create", { resource: "employee", resourceId: rec.id });
  return decodePiiOnRead("Employee", rec);
}

/**
 * PHẠM VI GHI KHÔNG ĐƯỢC RỘNG HƠN PHẠM VI ĐỌC.
 *
 * Chặn mỗi `listEmployees` là vô nghĩa: route PUT chỉ gác NĂNG LỰC `employee:edit:own` rồi
 * `updateEmployee` trả `decodePiiOnRead("Employee", rec)` — tức BẢN GHI ĐÃ GIẢI MÃ. Body rỗng `{}`
 * vẫn hợp lệ (`EmployeeUpdate` là `.partial()`) và `encodePiiForWrite("Employee", {})` → `{}`, nên
 * `update({ data: {} })` chạy trót lọt. `Employee.id` autoincrement → chỉ cần đếm 1,2,3… là moi
 * sạch CCCD + số tài khoản toàn công ty qua đúng cái endpoint GHI, đi vòng qua lớp chặn ở GET.
 *
 * Cố ý gác theo phạm vi ĐỌC (`employee:read:*`) chứ KHÔNG theo `employee:edit:*`: EMPLOYEE nền —
 * và MANAGER/ADMIN kế thừa — đều có `employee:read:all` (src/permissions.ts:266), nên kho danh bạ
 * DÙNG CHUNG khi ghi vẫn y nguyên cho mọi tài khoản Account thật. Nếu gác theo `edit:*` thì mọi
 * người chỉ có `edit:own` sẽ mất luôn việc sửa mục đồng nghiệp thêm — đổi hành vi đang chạy.
 * Chỉ tập quyền per-user bị bó về "Xem danh bạ của mình" mới hết ghi chéo, mà tài khoản đó vốn
 * đã không nhìn thấy mục người khác để mà sửa. Xem tests/rbacscope-employee-directory.test.js.
 */
function assertEmployeeInReadScope(req: Request, rec: { createdById: number | null }) {
  if (!canScoped(req.session, "employee", "read", rec, "createdById")) {
    throw httpError(403, "Bạn không có quyền với mục danh bạ này");
  }
}

export async function updateEmployee(req: Request) {
  const before = await prisma.employee.findFirst({ where: { id: (req.params as any).id } });
  if (!before) throw httpError(404, "Không tìm thấy nhân viên");
  assertEmployeeInReadScope(req, before);
  const rec = await prisma.employee.update({ where: { id: (req.params as any).id }, data: encodePiiForWrite("Employee", req.body) as any, include: ownerSelect });
  await audit(req, "employee.update", { resource: "employee", resourceId: rec.id });
  return decodePiiOnRead("Employee", rec);
}

export async function deleteEmployee(req: Request) {
  const before = await prisma.employee.findFirst({ where: { id: (req.params as any).id } });
  if (!before) throw httpError(404, "Không tìm thấy nhân viên");
  // Cùng lý do như updateEmployee: không đọc được thì cũng không xoá được. Để ngỏ XOÁ trong khi
  // đã chặn SỬA thì lớp chặn kia chỉ là nửa hàng rào.
  assertEmployeeInReadScope(req, before);
  await prisma.employee.delete({ where: { id: (req.params as any).id } });   // soft delete (db.js)
  await audit(req, "employee.delete", { resource: "employee", resourceId: (req.params as any).id });
  return { ok: true };
}
