import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { config } from "../config.js";
import { asyncHandler, requireAuth } from "../middleware.js";
import { validate } from "../validators.js";
import { requirePermission, PERMISSIONS as P } from "../permissions.js";
import * as svc from "../services/personnelService.js";

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
// 🔵 Công thức (pit, taxableIncome) tính ở server. 🩷 Tham chiếu Dự án (salesContractNo/Date,
// purchaseOrder, preTaxAmount, payment) lookup khi đọc — KHÔNG lưu, KHÔNG nhập.
const personnelShape = {
  fullName: z.string().min(1, "Vui lòng nhập Họ & Tên").max(200),
  taxCode: str(40), birthYear: str(40), idCard: str(40), idIssueDate: date, idIssuePlace: str(200),
  address: str(500), bankAccount: str(60), bankName: str(120), phone: str(40),
  salary: money,
  workStart: date, workEnd: date, workLocation: str(200),
  projectName: str(300), projectCode: str(80), teamNote: str(500), accountName: str(120), company: str(120),
  projectNameContract: str(300),
  laborContractNo: str(80), laborContractDate: date,
  // accountingNote (kế toán) / note (admin) / payment / confirmed KHÔNG nhập qua form chung — mỗi cái có
  // ENDPOINT RIÊNG gác đúng quyền (sửa-tại-chỗ). Form chỉ ghi field "hồ sơ" của Account sở hữu.
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
  // Cột sort: chỉ tên cột THẬT của PersonnelRecord (Prisma orderBy [sort]). UI cho phép
  // bấm sort trên các cột hiển thị tương ứng (Họ tên, MST, Lương, ngày làm việc).
  sort: z.enum(["createdAt", "fullName", "updatedAt", "salary", "taxCode", "workStart", "workEnd"]).default("createdAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
});

// Route MỎNG: chỉ validate (+ cổng quyền) → gọi tầng service (logic/quyền dữ liệu/tính thuế/
// tra cứu Dự án/audit ở personnelService.ts).

router.get(
  "/",
  // CỔNG QUYỀN: cần personnel:read:own (manager) — :all (hr/accountant/admin) tự bao :own.
  // Role không có quyền nhân sự (vd account_hn) → 403 ngay, không lọt vào lọc dữ liệu.
  requirePermission(P.PERSONNEL_READ_OWN),
  validate({ query: ListQuery }),
  asyncHandler(async (req: Request, res: Response) => res.json(await svc.listPersonnel(req)))
);

// Danh sách DỰ ÁN (báo giá ĐÃ CHỐT) để CHỌN khi tạo hồ sơ — tự điền Tên dự án / Mã dự án /
// Account / CTY. Account chỉ thấy dự án của CHÍNH MÌNH (createdById); admin/
// người có read:all thấy hết. Mỗi "mã sản xuất" (mỗi sheet, hậu tố _1/_2…) là 1 dòng chọn.
// PHẢI khai báo TRƯỚC "/:id" (kẻo "projects" lọt vào route :id).
const ProjectsQuery = z.object({ q: z.string().max(200).optional() });
router.get(
  "/projects",
  requirePermission(P.PERSONNEL_CREATE),
  validate({ query: ProjectsQuery }),
  asyncHandler(async (req: Request, res: Response) => res.json(await svc.listProjects(req)))
);

router.post(
  "/",
  requirePermission(P.PERSONNEL_CREATE),   // chỉ Account (manager) + admin được TẠO; hr/accountant KHÔNG
  validate({ body: PersonnelCreate }),
  asyncHandler(async (req: Request, res: Response) => res.status(201).json(await svc.createPersonnel(req)))
);

router.get(
  "/:id",
  validate({ params: idParam }),
  asyncHandler(async (req: Request, res: Response) => res.json(await svc.getPersonnel(req)))
);

router.put(
  "/:id",
  validate({ params: idParam, body: PersonnelUpdate }),
  asyncHandler(async (req: Request, res: Response) => res.json(await svc.updatePersonnel(req)))
);

router.delete(
  "/:id",
  validate({ params: idParam }),
  asyncHandler(async (req: Request, res: Response) => res.json(await svc.deletePersonnel(req)))
);

// SỬA-TẠI-CHỖ 1 cột theo QUYỀN: { value: string|null }.
const FieldBody = z.object({ value: str(1000) });
// TEAM GHI CHÚ — chỉ ACCOUNT sở hữu dòng (manage:own; service thêm owner-check) + admin.
router.post("/:id/team-note", requirePermission(P.PERSONNEL_EDIT_OWN), validate({ params: idParam, body: FieldBody }),
  asyncHandler(async (req: Request, res: Response) => res.json(await svc.writeTeamNote(req))));
// KẾ TOÁN GHI CHÚ — chỉ kế toán (+ admin) qua quyền personnel:accounting-note.
router.post("/:id/accounting-note", requirePermission(P.PERSONNEL_ACCOUNTING_NOTE), validate({ params: idParam, body: FieldBody }),
  asyncHandler(async (req: Request, res: Response) => res.json(await svc.writeAccountingNote(req))));
// NOTE — chỉ người sửa-được-mọi-hồ-sơ (admin) qua quyền personnel:edit:all.
router.post("/:id/note", requirePermission(P.PERSONNEL_EDIT_ALL), validate({ params: idParam, body: FieldBody }),
  asyncHandler(async (req: Request, res: Response) => res.json(await svc.writeNote(req))));

// Lấy ảnh chứng từ thanh toán (base64) on-demand — gác theo quyền XEM hồ sơ (service: loadAuthorized read).
router.get("/:id/payment-proof", validate({ params: idParam }),
  asyncHandler(async (req: Request, res: Response) => res.json(await svc.getPaymentProof(req))));

// TẢI HỢP ĐỒNG DỊCH VỤ (.docx) sinh từ mẫu công ty + dữ liệu hồ sơ — gác quyền XEM hồ sơ (service).
// Phiếu chi chỉ kèm khi hồ sơ ĐÃ thanh toán có ngày (paidAt).
router.get("/:id/contract", validate({ params: idParam }),
  asyncHandler(async (req: Request, res: Response) => {
    const { buffer, fileName } = await svc.downloadContract(req);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename="contract-${(req.params as any).id}.docx"; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    res.send(buffer);
  }));

// KẾ TOÁN (hoặc admin) đánh dấu ĐÃ / BỎ thanh toán — lưu NGÀY + người + ẢNH chứng từ (base64, tùy chọn).
// Quyền RIÊNG personnel:pay (KHÔNG cần manage, KHÔNG owner-scope → kế toán đánh dấu mọi hồ sơ).
const PaymentBody = z.object({
  paid: z.boolean(),
  // Ảnh chứng từ: data URL ảnh, ≤ ~675KB (client đã nén). Bỏ qua nếu không gửi.
  paymentProof: z.string().max(900_000).regex(/^data:image\/(png|jpe?g|webp);base64,/, "Ảnh không hợp lệ").optional(),
});
router.post(
  "/:id/payment",
  requirePermission(P.PERSONNEL_MARK_PAYMENT),
  validate({ params: idParam, body: PaymentBody }),
  asyncHandler(async (req: Request, res: Response) => res.json(await svc.markPayment(req)))
);

// ADMIN xác nhận "đã ký" / BỎ xác nhận cho 1 hồ sơ — lưu NGÀY + người. Quyền RIÊNG personnel:confirm (CHỈ admin).
const ConfirmBody = z.object({ confirmed: z.boolean() });
router.post(
  "/:id/confirm",
  requirePermission(P.PERSONNEL_CONFIRM),
  validate({ params: idParam, body: ConfirmBody }),
  asyncHandler(async (req: Request, res: Response) => res.json(await svc.markConfirm(req)))
);

export default router;
