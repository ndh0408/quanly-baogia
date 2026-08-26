import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { config } from "../config.js";
import { asyncHandler, requireAuth } from "../middleware.js";
import { validate } from "../validators.js";
import { requirePermission, PERMISSIONS as P } from "../permissions.js";
import * as svc from "../services/employeeService.js";

// Danh bạ NHÂN VIÊN — chỉ chứa 10 trường cá nhân (khớp nhóm "Cá nhân" của trang Nhân sự).
// ĐỌC theo đúng phạm vi của quyền: `employee:read:all` (mọi vai trò mặc định đều có) → cả danh bạ
// để chọn khi tạo hồ sơ; `employee:read:own` → chỉ mục mình thêm — nếu không thì ô tích hẹp nhất
// lại mở CCCD + số tài khoản của cả công ty (tests/rbacscope-employee-directory.test.js).
// GHI (PUT/DELETE) vẫn là kho DÙNG CHUNG có chủ đích cho mọi tài khoản Account thật — nhưng phạm
// vi ghi bám theo PHẠM VI ĐỌC, không phải `employee:edit:*`: EMPLOYEE nền đã có `employee:read:all`
// nên sửa/xoá chéo không đổi, còn tài khoản bị bó về `employee:read:own` thì không PUT/DELETE được
// mục người khác nữa. Bỏ chốt đó thì PUT chính là một kênh ĐỌC PII đầy đủ (nó trả bản ghi đã giải
// mã, body rỗng vẫn hợp lệ) — chặn GET mà để ngỏ PUT là hàng rào rỗng.
const router = Router();
router.use(requireAuth);

const idParam = z.object({ id: z.coerce.number().int().positive() });
const str = (max = 1000) => z.preprocess((v) => (v === "" || v == null ? null : String(v)), z.string().max(max).nullable());
const date = z.preprocess((v) => (v === "" || v == null ? null : v), z.coerce.date().nullable());

const employeeShape = {
  fullName: z.string().min(1, "Vui lòng nhập Họ & Tên").max(200),
  taxCode: str(40), birthYear: str(40), idCard: str(40), idIssueDate: date, idIssuePlace: str(200),
  address: str(500), bankAccount: str(60), bankName: str(120), phone: str(40),
};
const EmployeeCreate = z.object(employeeShape);
const EmployeeUpdate = z.object(employeeShape).partial();

const ListQuery = z.object({
  q: z.string().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(config.MAX_PAGE_SIZE).default(50),
  sort: z.enum(["createdAt", "fullName", "updatedAt"]).default("fullName"),
  order: z.enum(["asc", "desc"]).default("asc"),
});

// QUYỀN RIÊNG cho Danh bạ (employee:*) — tách khỏi personnel:* (trước mượn nhờ).
// ĐỌC: phạm vi thật do listEmployees áp (readScopeWhereOrThrow). SỬA/XOÁ: `:own` trong TÊN QUYỀN
// vẫn không phải phạm vi dữ liệu — phạm vi dữ liệu của đường ghi do `assertEmployeeInReadScope`
// (employeeService.ts) áp theo `employee:read:*`. Xem khối chú thích đầu file.
router.get(
  "/",
  requirePermission(P.EMPLOYEE_READ_OWN),
  validate({ query: ListQuery }),
  asyncHandler(async (req: Request, res: Response) => res.json(await svc.listEmployees(req)))
);

router.post(
  "/",
  requirePermission(P.EMPLOYEE_CREATE),
  validate({ body: EmployeeCreate }),
  asyncHandler(async (req: Request, res: Response) => res.status(201).json(await svc.createEmployee(req)))
);

router.put(
  "/:id",
  requirePermission(P.EMPLOYEE_EDIT_OWN),
  validate({ params: idParam, body: EmployeeUpdate }),
  asyncHandler(async (req: Request, res: Response) => res.json(await svc.updateEmployee(req)))
);

router.delete(
  "/:id",
  requirePermission(P.EMPLOYEE_DELETE_OWN),
  validate({ params: idParam }),
  asyncHandler(async (req: Request, res: Response) => res.json(await svc.deleteEmployee(req)))
);

export default router;
