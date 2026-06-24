import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { asyncHandler, requireAuth } from "../middleware.js";
import { validate } from "../validators.js";
import { audit } from "../audit.js";
import { can, canScoped, requirePermission, PERMISSIONS as P } from "../permissions.js";
import { buildProjectRef, computeTax, codeLabel, type ProjectRef } from "../services/projectRef.js";

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

// CHỈ field NHẬP TAY (🟡) mới nằm trong shape → API bỏ qua mọi field công thức/tham chiếu nếu client gửi.
// 🔵 Công thức (pit, taxableIncome) tính ở server. 🩷 Tham chiếu Dự án (projectNameContract,
// salesContractNo/Date, purchaseOrder, preTaxAmount, payment) lookup khi đọc — KHÔNG lưu, KHÔNG nhập.
const personnelShape = {
  fullName: z.string().min(1, "Vui lòng nhập Họ & Tên").max(200),
  taxCode: str(40), birthYear: str(40), idCard: str(40), idIssueDate: date, idIssuePlace: str(200),
  address: str(500), bankAccount: str(60), bankName: str(120), phone: str(40),
  salary: money,
  workStart: date, workEnd: date, workLocation: str(200),
  projectName: str(300), projectCode: str(80), teamNote: str(500), accountName: str(120), company: str(120),
  laborContractNo: str(80), laborContractDate: date,
  accountingNote: str(1000), confirmed: str(200), note: str(1000),
};
// Ràng buộc logic (chỉ kiểm khi field có mặt — dùng cho cả create lẫn update).
const refineLogic = (v: Record<string, unknown>, ctx: z.RefinementCtx) => {
  if (v.workStart && v.workEnd && new Date(v.workEnd as string) < new Date(v.workStart as string))
    ctx.addIssue({ code: "custom", path: ["workEnd"], message: "Ngày kết thúc phải từ ngày bắt đầu trở đi" });
  if (v.idIssueDate && new Date(v.idIssueDate as string) > new Date())
    ctx.addIssue({ code: "custom", path: ["idIssueDate"], message: "Ngày cấp không thể ở tương lai" });
};
// Tạo mới: BẮT BUỘC chọn Dự án (Mã dự án) — UI khoá nút Lưu khi chưa chọn; server chặn cứng để khỏi lách.
const PersonnelCreate = z.object({ ...personnelShape, projectCode: z.string().min(1, "Vui lòng chọn dự án (bắt buộc)").max(80) }).superRefine(refineLogic);
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

// 🔵 Gắn field công thức (pit, taxableIncome) + 🩷 field tham chiếu Dự án vào bản ghi khi TRẢ VỀ.
// Các field này KHÔNG lưu DB — luôn tính/tra lúc đọc nên không bao giờ lệch với Lương/Dự án.
function decorate<T extends { salary: unknown; projectCode: string | null; paidAt?: Date | null }>(rec: T, refMap: Map<string, ProjectRef>) {
  const { pit, taxableIncome } = computeTax(rec.salary == null ? null : Number(rec.salary));
  const ref = refMap.get((rec.projectCode ?? "").toString().trim());
  return {
    ...rec,
    pit, taxableIncome,
    projectNameContract: ref?.projectNameContract ?? null,
    salesContractNo: ref?.salesContractNo ?? null,
    salesContractDate: ref?.salesContractDate ?? null,
    purchaseOrder: ref?.purchaseOrder ?? null,
    preTaxAmount: ref?.preTaxAmount ?? null,
    // THANH TOÁN: KẾ TOÁN bấm đánh dấu (rec.paidAt). paidAt đi kèm (qua ...rec) để FE hiện ngày.
    payment: rec.paidAt ? "Đã thanh toán" : "Chưa thanh toán",
  };
}

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
      prisma.personnelRecord.aggregate({ where, _sum: { salary: true } }),
    ]);
    // 🩷 Tra cứu dữ liệu Dự án theo mã sản xuất — CHỈ cho các dòng đang hiển thị (truy vấn hẹp).
    const refMap = await buildProjectRef(data.map((r) => r.projectCode));
    const decorated = data.map((r) => decorate(r, refMap));
    // Tổng (toàn bộ lọc): Thuế TNCN = ΣLương/9, Thu nhập chịu thuế = ΣLương×10/9 (công thức đã chốt).
    const salarySum = Number(agg._sum.salary ?? 0);
    const tax = computeTax(salarySum);
    const summary = { salary: salarySum, pit: tax.pit ?? 0, taxableIncome: tax.taxableIncome ?? 0 };
    res.json({ data: decorated, meta: { total, page, size, pageCount: Math.ceil(total / size) }, summary });
  })
);

// Danh sách DỰ ÁN (báo giá ĐÃ CHỐT) để CHỌN khi tạo hồ sơ — tự điền Tên dự án / Mã dự án /
// Account / CTY / Tên dự án (HĐ). Account chỉ thấy dự án của CHÍNH MÌNH (createdById); admin/
// người có read:all thấy hết. Mỗi "mã sản xuất" (mỗi sheet, hậu tố _1/_2…) là 1 dòng chọn.
// PHẢI khai báo TRƯỚC "/:id" (kẻo "projects" lọt vào route :id).
const ProjectsQuery = z.object({ q: z.string().max(200).optional() });
router.get(
  "/projects",
  requirePermission(P.PERSONNEL_CREATE),
  validate({ query: ProjectsQuery }),
  asyncHandler(async (req: Request, res: Response) => {
    const { q } = req.query as any;
    const where: Record<string, any> = { status: "converted", deletedAt: null };
    if (!can(req.session, P.PERSONNEL_READ_ALL)) where.createdById = req.session.userId;   // Account: chỉ dự án của mình
    if (q) where.OR = [
      { title: { contains: q, mode: "insensitive" } },
      { projectCode: { contains: q, mode: "insensitive" } },
      { quoteNumber: { contains: q, mode: "insensitive" } },
    ];
    const quotes = await prisma.quote.findMany({
      where, take: 300, orderBy: { createdAt: "desc" },
      select: {
        quoteNumber: true, projectCode: true, projectVersion: true, title: true,
        company: { select: { name: true } },
        createdBy: { select: { displayName: true } },
        sheets: { orderBy: { order: "asc" }, select: { id: true, name: true } },
      },
    });
    const data: Array<Record<string, string>> = [];
    for (const qt of quotes) {
      const base = codeLabel(qt);
      const sheets = qt.sheets.length ? qt.sheets : [{ id: -1, name: "" } as any];
      const multi = sheets.length > 1;
      sheets.forEach((sh: any, i: number) => {
        data.push({
          projectCode: base + (multi ? `_${i + 1}` : ""),   // = mã sản xuất (khớp tra cứu cột HĐ)
          projectName: qt.title || "",                       // Tên dự án
          projectNameContract: qt.title || "",               // Tên dự án (HĐ)
          accountName: qt.createdBy?.displayName || "",       // Account (người tạo báo giá)
          company: qt.company?.name || "",                   // CTY
          sheetName: sh.name || "",                           // Hạng Mục (gợi ý khi nhiều sheet)
        });
      });
    }
    res.json({ data });
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
    const refMap = await buildProjectRef([rec.projectCode]);
    res.status(201).json(decorate(rec, refMap));
  })
);

router.get(
  "/:id",
  validate({ params: idParam }),
  asyncHandler(async (req: Request, res: Response) => {
    const rec = await loadAuthorized(req, res, "read");
    if (!rec) return;
    const full = await prisma.personnelRecord.findFirst({ where: { id: (req.params as any).id }, include: ownerSelect });
    if (!full) { res.status(404).json({ error: "Không tìm thấy hồ sơ nhân sự" }); return; }
    const refMap = await buildProjectRef([full.projectCode]);
    res.json(decorate(full, refMap));
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
    const refMap = await buildProjectRef([rec.projectCode]);
    res.json(decorate(rec, refMap));
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

// KẾ TOÁN (hoặc admin) đánh dấu ĐÃ / BỎ thanh toán cho 1 hồ sơ — lưu NGÀY + người đánh dấu.
// Quyền RIÊNG personnel:pay (KHÔNG cần manage, KHÔNG owner-scope → kế toán đánh dấu mọi hồ sơ).
const PaymentBody = z.object({ paid: z.boolean() });
router.post(
  "/:id/payment",
  requirePermission(P.PERSONNEL_MARK_PAYMENT),
  validate({ params: idParam, body: PaymentBody }),
  asyncHandler(async (req: Request, res: Response) => {
    const id = (req.params as any).id;
    const exists = await prisma.personnelRecord.findFirst({ where: { id }, select: { id: true } });
    if (!exists) { res.status(404).json({ error: "Không tìm thấy hồ sơ nhân sự" }); return; }
    const paid = (req.body as any).paid as boolean;
    const rec = await prisma.personnelRecord.update({
      where: { id },
      data: paid ? { paidAt: new Date(), paidById: req.session.userId } : { paidAt: null, paidById: null },
      include: { ...ownerSelect, paidBy: { select: { id: true, displayName: true } } },
    });
    await audit(req, paid ? "personnel.pay" : "personnel.unpay", { resource: "personnel", resourceId: id });
    const refMap = await buildProjectRef([rec.projectCode]);
    res.json(decorate(rec, refMap));
  })
);

export default router;
