import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { asyncHandler, requireAuth } from "../middleware.js";
import { validate } from "../validators.js";
import { audit } from "../audit.js";
import { can, canScoped, requirePermission, PERMISSIONS as P } from "../permissions.js";

// Trang "Nhân sự": hồ sơ nhân công theo dự án. Account (manager) TẠO + chỉ thấy/sửa của MÌNH
// (owner = createdById); hr + accountant XEM tất cả (read-only); admin toàn quyền.
// File .ts ĐẦU TIÊN của backend — mốc bắt đầu chuyển sang TypeScript (chạy bằng tsx).
const router = Router();
router.use(requireAuth);

const idParam = z.object({ id: z.coerce.number().int().positive() });

// "" / null → null cho mọi field optional (frontend hay gửi chuỗi rỗng).
const str = (max = 1000) => z.preprocess((v) => (v === "" || v == null ? null : String(v)), z.string().max(max).nullable());
const money = z.preprocess((v) => (v === "" || v == null ? null : v), z.coerce.number().nonnegative().nullable());
const date = z.preprocess((v) => (v === "" || v == null ? null : v), z.coerce.date().nullable());

const personnelShape = {
  fullName: z.string().min(1, "Vui lòng nhập Họ & Tên").max(200),
  taxCode: str(40), birthYear: str(40), idCard: str(40), idIssueDate: date, idIssuePlace: str(200),
  address: str(500), bankAccount: str(60), bankName: str(120), phone: str(40),
  salary: money, pit: money, taxableIncome: money,
  workStart: date, workEnd: date, workLocation: str(200),
  projectName: str(300), projectCode: str(80), teamNote: str(500), accountName: str(120), company: str(120),
  projectNameContract: str(300), laborContractNo: str(80), laborContractDate: date,
  salesContractNo: str(80), salesContractDate: date, purchaseOrder: str(120),
  preTaxAmount: money, accountingNote: str(1000), payment: str(200), confirmed: str(200), note: str(1000),
};
// Ràng buộc logic (chỉ kiểm khi field có mặt — dùng cho cả create lẫn update).
const refineLogic = (v: Record<string, unknown>, ctx: z.RefinementCtx) => {
  if (v.workStart && v.workEnd && new Date(v.workEnd as string) < new Date(v.workStart as string))
    ctx.addIssue({ code: "custom", path: ["workEnd"], message: "Ngày kết thúc phải từ ngày bắt đầu trở đi" });
  if (v.idIssueDate && new Date(v.idIssueDate as string) > new Date())
    ctx.addIssue({ code: "custom", path: ["idIssueDate"], message: "Ngày cấp không thể ở tương lai" });
  if (v.salary != null && v.pit != null && Number(v.pit) > Number(v.salary))
    ctx.addIssue({ code: "custom", path: ["pit"], message: "Thuế TNCN không thể lớn hơn lương" });
};
const PersonnelCreate = z.object(personnelShape).superRefine(refineLogic);
const PersonnelUpdate = z.object(personnelShape).partial().superRefine(refineLogic);

const ListQuery = z.object({
  q: z.string().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(config.MAX_PAGE_SIZE).default(50),
  sort: z.enum(["createdAt", "fullName", "updatedAt"]).default("createdAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
});

type Action = "read" | "manage";

/** Load a record and 403 unless the caller may `action` (read|manage) it (owner = createdById). */
async function loadAuthorized(req: Request, res: Response, action: Action) {
  const rec = await prisma.personnelRecord.findFirst({ where: { id: (req.params as any).id } });
  if (!rec) { res.status(404).json({ error: "Không tìm thấy hồ sơ nhân sự" }); return null; }
  if (!canScoped(req.session, "personnel", action, rec, "createdById")) {
    res.status(403).json({ error: "Bạn không có quyền với hồ sơ này" }); return null;
  }
  return rec;
}

const ownerSelect = { createdBy: { select: { id: true, displayName: true, username: true } } };

router.get(
  "/",
  // CỔNG QUYỀN: cần personnel:read:own (manager) — :all (hr/accountant/admin) tự bao :own.
  // Role không có quyền nhân sự (vd account_hn) → 403 ngay, không lọt vào lọc dữ liệu.
  requirePermission(P.PERSONNEL_READ_OWN),
  validate({ query: ListQuery }),
  asyncHandler(async (req: Request, res: Response) => {
    const { q, page, size, sort, order } = req.query as any;
    const where: Record<string, any> = {};
    // Phân quyền dữ liệu: ai KHÔNG có read:all (manager) chỉ thấy hồ sơ MÌNH tạo.
    if (!can(req.session, P.PERSONNEL_READ_ALL)) where.createdById = req.session.userId;
    if (q) {
      where.OR = [
        { fullName: { contains: q, mode: "insensitive" } },
        { projectName: { contains: q, mode: "insensitive" } },
        { projectCode: { contains: q, mode: "insensitive" } },
        { taxCode: { contains: q } },
        { phone: { contains: q } },
        { idCard: { contains: q } },
      ];
    }
    const [total, data, agg] = await Promise.all([
      prisma.personnelRecord.count({ where }),
      prisma.personnelRecord.findMany({
        where, orderBy: { [sort]: order }, skip: (page - 1) * size, take: size, include: ownerSelect,
      }),
      prisma.personnelRecord.aggregate({ where, _sum: { salary: true, pit: true, taxableIncome: true } }),
    ]);
    // Tổng lương/thuế/thu nhập của TOÀN bộ kết quả lọc (không chỉ trang hiện tại).
    const summary = {
      salary: Number(agg._sum.salary ?? 0),
      pit: Number(agg._sum.pit ?? 0),
      taxableIncome: Number(agg._sum.taxableIncome ?? 0),
    };
    res.json({ data, meta: { total, page, size, pageCount: Math.ceil(total / size) }, summary });
  })
);

router.post(
  "/",
  requirePermission(P.PERSONNEL_CREATE),   // chỉ Account (manager) + admin được TẠO; hr/accountant KHÔNG
  validate({ body: PersonnelCreate }),
  asyncHandler(async (req: Request, res: Response) => {
    const rec = await prisma.personnelRecord.create({
      data: { ...req.body, createdById: req.session.userId },   // người tạo = chủ sở hữu
      include: ownerSelect,
    });
    await audit(req, "personnel.create", { resource: "personnel", resourceId: rec.id });
    res.status(201).json(rec);
  })
);

router.get(
  "/:id",
  validate({ params: idParam }),
  asyncHandler(async (req: Request, res: Response) => {
    const rec = await loadAuthorized(req, res, "read");
    if (!rec) return;
    const full = await prisma.personnelRecord.findFirst({ where: { id: (req.params as any).id }, include: ownerSelect });
    res.json(full);
  })
);

router.put(
  "/:id",
  validate({ params: idParam, body: PersonnelUpdate }),
  asyncHandler(async (req: Request, res: Response) => {
    const before = await loadAuthorized(req, res, "manage");   // hr/accountant không có manage → 403
    if (!before) return;
    const rec = await prisma.personnelRecord.update({ where: { id: (req.params as any).id }, data: req.body, include: ownerSelect });
    await audit(req, "personnel.update", { resource: "personnel", resourceId: rec.id });
    res.json(rec);
  })
);

router.delete(
  "/:id",
  validate({ params: idParam }),
  asyncHandler(async (req: Request, res: Response) => {
    const before = await loadAuthorized(req, res, "manage");
    if (!before) return;
    await prisma.personnelRecord.delete({ where: { id: (req.params as any).id } });   // soft delete (db.js middleware)
    await audit(req, "personnel.delete", { resource: "personnel", resourceId: (req.params as any).id });
    res.json({ ok: true });
  })
);

export default router;
