import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { config } from "../config.js";
import { asyncHandler, requireAuth } from "../middleware.js";
import { validate } from "../validators.js";
import { requirePermission, PERMISSIONS as P } from "../permissions.js";
import * as svc from "../services/employeeService.js";

// Danh bạ NHÂN VIÊN — kho thông tin cá nhân DÙNG CHUNG (không phân quyền theo owner): ai có
// quyền XEM nhân sự thì xem được cả danh bạ (để chọn khi tạo hồ sơ); ai TẠO được nhân sự thì
// thêm/sửa/xóa danh bạ. Chỉ chứa 10 trường cá nhân (khớp nhóm "Cá nhân" của trang Nhân sự).
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

// Route MỎNG: cổng quyền + validate → gọi tầng service (prisma + audit ở employeeService.ts).
router.get(
  "/",
  requirePermission(P.PERSONNEL_READ_OWN),   // ai xem được Nhân sự thì xem được danh bạ (để chọn)
  validate({ query: ListQuery }),
  asyncHandler(async (req: Request, res: Response) => res.json(await svc.listEmployees(req)))
);

router.post(
  "/",
  requirePermission(P.PERSONNEL_CREATE),
  validate({ body: EmployeeCreate }),
  asyncHandler(async (req: Request, res: Response) => res.status(201).json(await svc.createEmployee(req)))
);

router.put(
  "/:id",
  requirePermission(P.PERSONNEL_CREATE),
  validate({ params: idParam, body: EmployeeUpdate }),
  asyncHandler(async (req: Request, res: Response) => res.json(await svc.updateEmployee(req)))
);

router.delete(
  "/:id",
  requirePermission(P.PERSONNEL_CREATE),
  validate({ params: idParam }),
  asyncHandler(async (req: Request, res: Response) => res.json(await svc.deleteEmployee(req)))
);

export default router;
