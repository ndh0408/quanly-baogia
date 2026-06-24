import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { asyncHandler, requireAuth } from "../middleware.js";
import { validate } from "../validators.js";
import { audit } from "../audit.js";
import { requirePermission, PERMISSIONS as P } from "../permissions.js";

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

const ownerSelect = { createdBy: { select: { id: true, displayName: true, username: true } } };

router.get(
  "/",
  requirePermission(P.PERSONNEL_READ_OWN),   // ai xem được Nhân sự thì xem được danh bạ (để chọn)
  validate({ query: ListQuery }),
  asyncHandler(async (req: Request, res: Response) => {
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
    res.json({ data, meta: { total, page, size, pageCount: Math.ceil(total / size) } });
  })
);

router.post(
  "/",
  requirePermission(P.PERSONNEL_CREATE),
  validate({ body: EmployeeCreate }),
  asyncHandler(async (req: Request, res: Response) => {
    const rec = await prisma.employee.create({ data: { ...req.body, createdById: req.session.userId }, include: ownerSelect });
    await audit(req, "employee.create", { resource: "employee", resourceId: rec.id });
    res.status(201).json(rec);
  })
);

router.put(
  "/:id",
  requirePermission(P.PERSONNEL_CREATE),
  validate({ params: idParam, body: EmployeeUpdate }),
  asyncHandler(async (req: Request, res: Response) => {
    const before = await prisma.employee.findFirst({ where: { id: (req.params as any).id } });
    if (!before) { res.status(404).json({ error: "Không tìm thấy nhân viên" }); return; }
    const rec = await prisma.employee.update({ where: { id: (req.params as any).id }, data: req.body, include: ownerSelect });
    await audit(req, "employee.update", { resource: "employee", resourceId: rec.id });
    res.json(rec);
  })
);

router.delete(
  "/:id",
  requirePermission(P.PERSONNEL_CREATE),
  validate({ params: idParam }),
  asyncHandler(async (req: Request, res: Response) => {
    const before = await prisma.employee.findFirst({ where: { id: (req.params as any).id } });
    if (!before) { res.status(404).json({ error: "Không tìm thấy nhân viên" }); return; }
    await prisma.employee.delete({ where: { id: (req.params as any).id } });   // soft delete (db.js)
    await audit(req, "employee.delete", { resource: "employee", resourceId: (req.params as any).id });
    res.json({ ok: true });
  })
);

export default router;
