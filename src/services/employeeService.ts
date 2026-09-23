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
import { normalizeSearch } from "../searchText.js";

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
    // TÌM KHÔNG DẤU (DB-08, audit 2026-09-23): trang Báo giá/Khách hàng/Nhân sự tìm trên cột
    // searchText đã chuẩn hoá ("nguyen" ra "Nguyễn"), còn Danh bạ thì ILIKE cột thô — gõ không dấu
    // là không ra ai. Employee KHÔNG có cột searchText; thêm cột thì phải backfill bằng một script
    // tay nằm ngoài quy trình deploy (đúng loại bước bị quên — xem DB-01/DB-02). Danh bạ là bảng nhỏ
    // (một công ty), nên chuẩn hoá ngay trong bộ nhớ trên TẬP ĐÃ LỌC PHẠM VI rồi lọc theo id. Giữ
    // nguyên các vế cũ (MST/SĐT chứa chuỗi thô, CCCD qua chỉ mục mù) để không mất kết quả nào.
    const nq = normalizeSearch(q);
    const ungVien = nq ? await prisma.employee.findMany({ where: { ...where }, select: { id: true, fullName: true, taxCode: true, phone: true } }) : [];
    const idKhop = ungVien.filter((e) => normalizeSearch(e.fullName, e.taxCode, e.phone).includes(nq)).map((e) => e.id);
    where.OR = [
      { id: { in: idKhop } },
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
 * và MANAGER/ADMIN kế thừa — đều có `employee:read:all` (src/permissions.ts, hằng EMPLOYEE), nên kho danh bạ
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

// Trường tài chính/định danh: nhật ký chỉ giữ 4 ký tự cuối — đủ để truy "ai đổi số tài khoản nhận
// lương từ …1234 sang …9876", không nhân bản PII đầy đủ sang bảng nhật ký (bảng đó không mã hoá).
const CHE_TRONG_NHAT_KY = new Set(["bankAccount", "idCard"]);
const cheBot = (v: unknown) => {
  if (v == null || v === "") return v ?? null;
  const s = String(v);
  return s.length <= 4 ? "•".repeat(s.length) : "…" + s.slice(-4);
};
const soSanhDuoc = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v));

/**
 * Giá trị TRƯỚC/SAU của đúng những trường vừa đổi (RBAC-04, audit 2026-09-23). Trước đây nhật ký
 * chỉ ghi "employee.update #id" — một Account đổi số tài khoản ngân hàng của người trong danh bạ
 * (kho dùng chung) rồi kế toán trả lương vào đó, mà không còn gì để truy giá trị cũ.
 */
function thayDoiDanhBa(truoc: Record<string, any>, than: Record<string, any>) {
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  for (const k of Object.keys(than)) {
    if (soSanhDuoc(truoc[k]) === soSanhDuoc(than[k])) continue;
    const che = CHE_TRONG_NHAT_KY.has(k);
    before[k] = che ? cheBot(truoc[k]) : truoc[k] ?? null;
    after[k] = che ? cheBot(than[k]) : than[k] ?? null;
  }
  return { before, after };
}

export async function updateEmployee(req: Request) {
  const before = await prisma.employee.findFirst({ where: { id: (req.params as any).id } });
  if (!before) throw httpError(404, "Không tìm thấy nhân viên");
  assertEmployeeInReadScope(req, before);
  const rec = await prisma.employee.update({ where: { id: (req.params as any).id }, data: encodePiiForWrite("Employee", req.body) as any, include: ownerSelect });
  const { before: truoc, after: sau } = thayDoiDanhBa(decodePiiOnRead("Employee", before) as Record<string, any>, req.body);
  await audit(req, "employee.update", { resource: "employee", resourceId: rec.id, before: truoc, after: sau });
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
