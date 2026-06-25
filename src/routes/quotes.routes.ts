import { Router } from "express";
import { z } from "zod";
import { asyncHandler, requireAuth } from "../middleware.js";
import {
  validate,
  zbool,
  QuoteCreateSchema,
  QuoteUpdateSchema,
  ListQuerySchema,
} from "../validators.js";
import { requirePermission, PERMISSIONS as P } from "../permissions.js";
import { presentQuote, presentQuoteRow } from "../quoteUtils.js";
import {
  createQuote,
  updateQuote,
  listQuotes,
  previewNextNumber,
  listAssignableUsers,
  listHnAccounts,
  getQuote,
  listProjects,
  signSheet,
  updateSheetInvoice,
  markConverted,
  markLost,
  listVersions,
  getVersion,
  diffVersionsService,
  listApprovals,
  updateMembers,
  deleteQuote,
  duplicateQuote,
} from "../quoteService.js";
import { assignHn, saveHn, submitHn, reviewHn } from "../hnWorkflow.js";

const router = Router();
router.use(requireAuth);

const idParam = z.object({ id: z.coerce.number().int().positive() });

// LIST — validate → service → present rows + meta
router.get(
  "/",
  validate({ query: ListQuerySchema }),
  asyncHandler(async (req, res) => {
    const { rows, total, page, size } = await listQuotes(req);
    res.json({
      data: rows.map((r) => presentQuoteRow(r, { viewerRole: req.session.role })),
      meta: {
        total,
        page,
        size,
        pageCount: Math.ceil(total / size),
        hasNext: page * size < total,
      },
    });
  })
);

// NEXT NUMBER (preview only - real allocation happens at POST time)
router.get(
  "/next-number",
  validate({ query: z.object({ companyId: z.coerce.number().int().positive().optional() }) }),
  asyncHandler(async (req, res) => res.json(await previewNextNumber(req)))
);

// Active users that can be added as members of a quote.
// Any authenticated user can read this (it only powers the "add members" picker
// on quotes they own); it returns names/roles only.
router.get(
  "/assignable-users",
  asyncHandler(async (req, res) => res.json(await listAssignableUsers(req)))
);

// PROJECTS (admin) — báo giá ĐÃ DUYỆT cho trang "Quản lý dự án", kèm breakdown theo
// từng sheet (tên + subtotal). Client tách mỗi sheet thành 1 dòng: >1 sheet thì Mã Sản
// Xuất thêm _1/_2…, Hạng Mục = tên sheet. Đặt TRƯỚC "/:id" để không bị nuốt vào param.
router.get(
  "/projects",
  asyncHandler(async (req, res) => res.json(await listProjects(req)))
);

// SIGN documents for ONE sheet (Ký Chứng từ). Admin ký MỌI dự án; người có canSign (vd Lan Anh)
// chỉ ký dự án DO MÌNH TẠO. Chỉ quản lý nội bộ; không ảnh hưởng Excel/tổng. Đặt TRƯỚC "/:id".
router.post(
  "/sheets/:sheetId/sign",
  validate({
    params: z.object({ sheetId: z.coerce.number().int().positive() }),
    // z.boolean (KHÔNG coerce): tránh chuỗi "false" bị coerce thành true → ký nhầm.
    body: z.object({ signed: z.boolean().default(true) }).default({} as any),
  }),
  asyncHandler(async (req, res) => res.json(await signSheet(req)))
);

// HOÁ ĐƠN / THANH TOÁN cho 1 sheet (Quản lý dự án). CHỈ ADMIN. Số HĐ → "Thanh toán"; ngày
// thanh toán → "Done". Chỉ trên báo giá ĐÃ CHỐT. Đặt TRƯỚC "/:id".
router.put(
  "/sheets/:sheetId/invoice",
  validate({
    params: z.object({ sheetId: z.coerce.number().int().positive() }),
    body: z.object({
      invoiceNo: z.string().max(80).trim().optional().nullable(),
      paidAt: z.coerce.date().nullable().optional().or(z.literal("")),
      poNumber: z.string().max(80).trim().optional().nullable(),
      hnInvoiceNo: z.string().max(80).trim().optional().nullable(),
      invoiceLink: z.string().max(1000).trim().optional().nullable(),
      docSentAt: z.coerce.date().nullable().optional().or(z.literal("")),
      docReturnedAt: z.coerce.date().nullable().optional().or(z.literal("")),
    }),
  }),
  requirePermission(P.USER_MANAGE),   // chỉ admin (USER_MANAGE) — kế toán/giám đốc nhập
  asyncHandler(async (req, res) => res.json(await updateSheetInvoice(req)))
);

// Danh sách tài khoản Account Hà Nội (cho manager chọn khi GIAO phần HN). Đặt TRƯỚC /:id.
router.get(
  "/hn/accounts",
  asyncHandler(async (req, res) => res.json(await listHnAccounts(req)))
);

// GET ONE
// 🔒 account_hn: presentQuote LƯỢC chỉ còn phần HN (không lộ nội dung báo giá khách).
router.get(
  "/:id",
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const quote = await getQuote(req);
    res.json(presentQuote(quote, { includeLogo: true, viewerRole: req.session.role }));
  })
);

// CREATE
router.post(
  "/",
  validate({ body: QuoteCreateSchema }),
  asyncHandler(async (req, res) => {
    const quote = await createQuote(req);
    res.status(201).json(presentQuote(quote, { includeLogo: true }));
  })
);

// UPDATE
router.put(
  "/:id",
  validate({ params: idParam, body: QuoteUpdateSchema }),
  asyncHandler(async (req, res) => {
    // 🔒 account_hn KHÔNG được sửa báo giá chính (chỉ điền phần HN qua endpoint riêng bên dưới).
    if (req.session.role === "account_hn") {
      return res.status(403).json({ error: "Account Hà Nội chỉ được điền phần Hà Nội, không sửa báo giá chính." });
    }
    const updated = await updateQuote(req);
    res.json(presentQuote(updated, { includeLogo: true, viewerRole: req.session.role }));
  })
);

// ===== Luồng GIÁ HÀ NỘI (role account_hn) — phân quyền + write-guard nằm TRONG service =====
// Quản lý giao account điền bảng "hanoi"; account chỉ thấy/sửa phần đó; gửi duyệt; quản lý duyệt/trả.
router.post("/:id/hn/assign", validate({ params: idParam, body: z.object({ accountId: z.coerce.number().int().positive() }) }),
  asyncHandler(async (req, res) => { const q = await assignHn(req); res.json(presentQuote(q, { viewerRole: req.session.role })); }));
router.put("/:id/hn", validate({ params: idParam }),   // account lưu phần HN (chỉ ghi bảng hanoi)
  asyncHandler(async (req, res) => { const q = await saveHn(req); res.json(presentQuote(q, { viewerRole: req.session.role })); }));
router.post("/:id/hn/submit", validate({ params: idParam }),
  asyncHandler(async (req, res) => { const q = await submitHn(req); res.json(presentQuote(q, { viewerRole: req.session.role })); }));
router.post("/:id/hn/review", validate({ params: idParam, body: z.object({ decision: z.enum(["approve", "reject"]), note: z.string().max(500).optional() }) }),
  asyncHandler(async (req, res) => { const q = await reviewHn(req); res.json(presentQuote(q, { viewerRole: req.session.role })); }));

// MARK CONVERTED — chốt deal (won).
// Segregation of duties: marking a deal WON is terminal, immutable and feeds
// revenue/leaderboard KPIs — require QUOTE_SEND authority (manager/admin) so the
// salesperson who benefits from the KPI can't self-close their own quote.
router.post(
  "/:id/mark-converted",
  requirePermission(P.QUOTE_SEND),
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const quote = await markConverted(req);
    res.json(presentQuote(quote));
  })
);

// MARK LOST — customer declined. Records a reason for win/loss reporting.
// Terminal + feeds win/loss KPIs → requires QUOTE_SEND authority (manager/admin),
// matching mark-converted, so a plain member can't terminal-transition the deal.
router.post(
  "/:id/mark-lost",
  requirePermission(P.QUOTE_SEND),
  validate({ params: idParam, body: z.object({ reason: z.string().max(2000).optional() }).default({}) }),
  asyncHandler(async (req, res) => {
    const quote = await markLost(req);
    res.json(presentQuote(quote));
  })
);

// VERSIONS
router.get(
  "/:id/versions",
  validate({ params: idParam }),
  asyncHandler(async (req, res) => res.json(await listVersions(req)))
);

router.get(
  "/:id/versions/:v",
  validate({ params: z.object({ id: z.coerce.number().int().positive(), v: z.coerce.number().int().min(0) }) }),
  asyncHandler(async (req, res) => res.json(await getVersion(req)))
);

router.get(
  "/:id/versions/:a/diff/:b",
  validate({ params: z.object({
    id: z.coerce.number().int().positive(),
    a: z.coerce.number().int().min(0),
    b: z.coerce.number().int().min(0),
  }) }),
  asyncHandler(async (req, res) => res.json(await diffVersionsService(req)))
);

// APPROVAL trail for a quote
router.get(
  "/:id/approvals",
  validate({ params: idParam }),
  asyncHandler(async (req, res) => res.json(await listApprovals(req)))
);

// MEMBERS — add/remove the employees who may view & edit this quote.
// Only the creator (or an admin) may manage the member list.
router.put(
  "/:id/members",
  validate({ params: idParam, body: z.object({ memberIds: z.array(z.coerce.number().int().positive()).max(50).default([]) }) }),
  asyncHandler(async (req, res) => res.json(await updateMembers(req)))
);

// SOFT DELETE
router.delete(
  "/:id",
  validate({ params: idParam }),
  asyncHandler(async (req, res) => res.json(await deleteQuote(req)))
);

// DUPLICATE
router.post(
  "/:id/duplicate",
  validate({ params: idParam, body: z.object({ sameProject: zbool.optional() }).default({}) }),
  asyncHandler(async (req, res) => {
    const created = await duplicateQuote(req);
    res.status(201).json(presentQuote(created));
  })
);

export default router;
