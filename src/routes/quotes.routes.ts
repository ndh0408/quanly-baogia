import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import { asyncHandler, requireAuth } from "../middleware.js";
import {
  validate,
  zbool,
  QuoteCreateSchema,
  QuoteUpdateSchema,
  ListQuerySchema,
  HnSaveSchema,
  PAYMENT_PROOF_DATA_URL_RE,
} from "../validators.js";
import { requirePermission, requireAnyPermission, can, PERMISSIONS as P } from "../permissions.js";
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
  setSheetCustomerDecision,
  updateSheetInvoice,
  markExtraTableRowPayment,
  getExtraTableRowProof,
  markConverted,
  markLost,
  listVersions,
  getVersion,
  diffVersionsService,
  listApprovals,
  updateMembers,
  deleteQuote,
  duplicateQuote,
} from "../services/quoteService.js";
import { assignHn, saveHn, submitHn, reviewHn } from "../hnWorkflow.js";

const router = Router();
router.use(requireAuth);

const idParam = z.object({ id: z.coerce.number().int().positive() });

// LIST — validate → service → present rows + meta
router.get(
  "/",
  validate({ query: ListQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { rows, total, page: rawPage, size: rawSize } = await listQuotes(req);
    // page/size đã được coerce sang number runtime trong listQuotes (ListQuerySchema
    // dùng z.coerce.number()); Number() ở đây chỉ làm TS thấy đúng kiểu, giữ nguyên giá trị.
    const page = Number(rawPage);
    const size = Number(rawSize);
    res.json({
      data: rows.map((r) => presentQuoteRow(r, { hnOnly: can(req.session, P.QUOTE_HN_FILL), internalOnly: can(req.session, P.QUOTE_INTERNAL_VIEW) })),
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
  // Chỉ người TẠO được báo giá mới cần biết số kế tiếp. Không gác thì mọi tài khoản đăng nhập đều
  // đọc được nhịp phát hành báo giá của công ty (gọi hai lần cách nhau là suy ra số báo giá phát ra
  // trong khoảng đó) — thông tin kinh doanh, không phải thứ để lộ cho kế toán/nhân sự/account HN.
  requirePermission(P.QUOTE_CREATE),
  validate({ query: z.object({ companyId: z.coerce.number().int().positive().optional() }) }),
  asyncHandler(async (req: Request, res: Response) => res.json(await previewNextNumber(req)))
);

// Active users that can be added as members of a quote.
// CHỈ powers picker "thêm thành viên" trong luồng TẠO/SỬA báo giá (NewQuoteWizard, QuoteEditor) → gate
// theo QUOTE_CREATE để chặn liệt-kê-danh-bạ-nhân-viên (org-chart enumeration) bởi role không tạo BG
// (account_hn/hr/accountant). KHÔNG phá luồng nào: chỉ role tạo/sửa BG mới mở picker này.
router.get(
  "/assignable-users",
  requirePermission(P.QUOTE_CREATE),
  asyncHandler(async (req: Request, res: Response) => res.json(await listAssignableUsers(req)))
);

// PROJECTS (admin) — báo giá ĐÃ DUYỆT cho trang "Quản lý dự án", kèm breakdown theo
// từng sheet (tên + subtotal). Client tách mỗi sheet thành 1 dòng: >1 sheet thì Mã Sản
// Xuất thêm _1/_2…, Hạng Mục = tên sheet. Đặt TRƯỚC "/:id" để không bị nuốt vào param.
router.get(
  "/projects",
  asyncHandler(async (req: Request, res: Response) => res.json(await listProjects(req)))
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
  asyncHandler(async (req: Request, res: Response) => res.json(await signSheet(req)))
);

// KHÁCH DUYỆT TỪNG SHEET (báo giá nhiều sheet: khách chốt sheet này, chưa chốt sheet kia).
// Không đổi status cả báo giá — chỉ ghi ý kiến khách theo sheet. Đặt TRƯỚC "/:id".
router.post(
  "/sheets/:sheetId/customer-decision",
  validate({
    params: z.object({ sheetId: z.coerce.number().int().positive() }),
    body: z.object({
      status: z.enum(["approved", "rejected", ""]).nullable().default(null),
      note: z.string().max(1000).optional().nullable(),
    }),
  }),
  asyncHandler(async (req: Request, res: Response) => res.json(await setSheetCustomerDecision(req)))
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
      // CHỈ cho http/https: chặn lưu javascript:/data: … (khi render vào <a href> chỉ escapeHtml không
      // lọc scheme → href sống). Rỗng/null vẫn hợp lệ (xóa link).
      invoiceLink: z.string().max(1000).trim().refine((s) => !s || /^https?:\/\//i.test(s), "Link hóa đơn phải bắt đầu bằng http:// hoặc https://").optional().nullable(),
      docSentAt: z.coerce.date().nullable().optional().or(z.literal("")),
      docReturnedAt: z.coerce.date().nullable().optional().or(z.literal("")),
      // Trang Hóa đơn (kế toán nhập)
      invoiceDate: z.coerce.date().nullable().optional().or(z.literal("")),
      paymentMethod: z.string().max(40).trim().optional().nullable(),
      orderClosedAt: z.coerce.date().nullable().optional().or(z.literal("")),
      invoiceYear: z.coerce.number().int().min(2000).max(2100).optional().nullable().or(z.literal("")),
      invoiceCompany: z.enum(["GN", "SM", "CLF"]).optional().nullable().or(z.literal("")),
      invoiceDesc: z.string().max(2000).trim().optional().nullable(),
      invoiceNote: z.string().max(2000).trim().optional().nullable(),
    }),
  }),
  // Vào endpoint: người xem QLDA (invoice:read) HOẶC KẾ TOÁN trang Hóa đơn (invoice:page);
  // quyền SỬA vs THANH TOÁN check theo field trong service (invoice:edit / invoice:pay).
  requireAnyPermission(P.INVOICE_READ, P.INVOICE_PAGE),
  asyncHandler(async (req: Request, res: Response) => res.json(await updateSheetInvoice(req)))
);

// THANH TOÁN 1 HÀNG bảng nội bộ (quyền quote:internal:pay) — tích/bỏ + ảnh chứng từ. Đặt TRƯỚC /:id.
router.post(
  "/:id/extra/:sheetId/:rid/pay",
  validate({
    params: z.object({ id: z.coerce.number().int().positive(), sheetId: z.coerce.number().int().positive(), rid: z.string().min(1).max(60) }),
    // Kiểm TOÀN CHUỖI (hằng số dùng chung ở src/validators.ts): regex tiền tố cũ cho phần đuôi
    // `" onerror="…` đi thẳng vào CSDL, phá bất biến "chuỗi *Proof luôn là ảnh base64 hợp lệ".
    body: z.object({ paid: z.boolean(), paidProof: z.string().max(900_000).regex(PAYMENT_PROOF_DATA_URL_RE, "Ảnh chứng từ không hợp lệ").optional() }),
  }),
  requirePermission(P.QUOTE_INTERNAL_PAY),
  asyncHandler(async (req: Request, res: Response) => res.json(await markExtraTableRowPayment(req)))
);
// Ảnh chứng từ 1 hàng nội bộ (on-demand) — quyền check trong service (internal:view|pay).
router.get(
  "/:id/extra/:sheetId/:rid/proof",
  validate({ params: z.object({ id: z.coerce.number().int().positive(), sheetId: z.coerce.number().int().positive(), rid: z.string().min(1).max(60) }) }),
  asyncHandler(async (req: Request, res: Response) => res.json(await getExtraTableRowProof(req)))
);

// Danh sách tài khoản Account Hà Nội (cho manager chọn khi GIAO phần HN). Đặt TRƯỚC /:id.
router.get(
  "/hn/accounts",
  asyncHandler(async (req: Request, res: Response) => res.json(await listHnAccounts(req)))
);

// GET ONE
// 🔒 account_hn: presentQuote LƯỢC chỉ còn phần HN (không lộ nội dung báo giá khách).
router.get(
  "/:id",
  validate({ params: idParam }),
  asyncHandler(async (req: Request, res: Response) => {
    const quote = await getQuote(req);
    res.json(presentQuote(quote, { includeLogo: true, hnOnly: can(req.session, P.QUOTE_HN_FILL), internalOnly: can(req.session, P.QUOTE_INTERNAL_VIEW) }));
  })
);

// CREATE
// Cổng quyền BẮT BUỘC: trước đây route này chỉ validate body, `createQuote` cũng chỉ hỏi "đã đăng
// nhập chưa" → mọi tài khoản (kế toán/nhân sự/account HN) gõ thẳng #/rnew là tạo được báo giá thật.
// requirePermission đọc quyền HIỆU LỰC (session.permissions ← resolveUserPermissions: admin full →
// quyền riêng user → override vai trò từ bảng rolePermission), nên ai được cấp thêm quote:create ở
// trang Phân quyền vẫn tạo bình thường. Đối xứng với duplicateQuote (quoteService.ts:841).
router.post(
  "/",
  requirePermission(P.QUOTE_CREATE),
  validate({ body: QuoteCreateSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const quote = await createQuote(req);
    res.status(201).json(presentQuote(quote, { includeLogo: true }));
  })
);

// UPDATE
router.put(
  "/:id",
  validate({ params: idParam, body: QuoteUpdateSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    // 🔒 Người ĐIỀN phần HN KHÔNG được sửa báo giá chính (chỉ điền phần HN qua endpoint riêng bên dưới).
    //
    // Kiểm theo QUYỀN, không theo chuỗi role. `quote:hn:fill` cấp được per-user (trang Phân quyền)
    // và chính nó là cờ bật view lược: GET /:id trả `presentQuoteForAccountHn` cho BẤT KỲ ai có
    // quyền này, còn React SPA cũng nhận diện bằng `me.permissions.includes("quote:hn:fill")`
    // (web/src/components/Shell.tsx:355). Nếu ở đây vẫn so `role === "account_hn"` thì một manager
    // được cấp riêng quote:hn:fill sẽ: nhận editor CHỈ có phần HN, nhưng KHÔNG bị chặn ở PUT /:id —
    // bấm Lưu là gửi payload thiếu toàn bộ sheet báo giá chính và XOÁ TRẮNG báo giá.
    // Xem tests/hn-guard-by-permission.test.js.
    if (can(req.session, P.QUOTE_HN_FILL)) {
      return res.status(403).json({ error: "Account Hà Nội chỉ được điền phần Hà Nội, không sửa báo giá chính." });
    }
    const updated = await updateQuote(req);
    res.json(presentQuote(updated, { includeLogo: true, hnOnly: can(req.session, P.QUOTE_HN_FILL) }));
  })
);

// ===== Luồng GIÁ HÀ NỘI (role account_hn) — phân quyền + write-guard nằm TRONG service =====
// Quản lý giao account điền bảng "hanoi"; account chỉ thấy/sửa phần đó; gửi duyệt; quản lý duyệt/trả.
router.post("/:id/hn/assign", validate({ params: idParam, body: z.object({ accountId: z.coerce.number().int().positive() }) }),
  asyncHandler(async (req: Request, res: Response) => { const q = await assignHn(req); res.json(presentQuote(q, { hnOnly: can(req.session, P.QUOTE_HN_FILL) })); }));
// BODY PHẢI QUA SCHEMA. Trước đây route này chỉ kiểm `:id`, còn saveHn đọc thẳng req.body →
// sanitizeExtraTables persist nguyên trạng cờ duyệt/thanh toán do server sở hữu, và không có
// cap nào cho số bảng / số dòng / độ dài chuỗi. Xem tests/hn-save-forgery.test.js.
router.put("/:id/hn", validate({ params: idParam, body: HnSaveSchema }),   // account lưu phần HN (chỉ ghi bảng hanoi)
  asyncHandler(async (req: Request, res: Response) => { const q = await saveHn(req); res.json(presentQuote(q, { hnOnly: can(req.session, P.QUOTE_HN_FILL) })); }));
router.post("/:id/hn/submit", validate({ params: idParam }),
  asyncHandler(async (req: Request, res: Response) => { const q = await submitHn(req); res.json(presentQuote(q, { hnOnly: can(req.session, P.QUOTE_HN_FILL) })); }));
router.post("/:id/hn/review", validate({ params: idParam, body: z.object({ decision: z.enum(["approve", "reject"]), note: z.string().max(500).optional() }) }),
  asyncHandler(async (req: Request, res: Response) => { const q = await reviewHn(req); res.json(presentQuote(q, { hnOnly: can(req.session, P.QUOTE_HN_FILL) })); }));

// MARK CONVERTED — chốt deal (won).
// Segregation of duties: marking a deal WON is terminal, immutable and feeds
// revenue/leaderboard KPIs — require QUOTE_SEND authority (manager/admin) so the
// salesperson who benefits from the KPI can't self-close their own quote.
router.post(
  "/:id/mark-converted",
  requirePermission(P.QUOTE_SEND),
  validate({ params: idParam }),
  asyncHandler(async (req: Request, res: Response) => {
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
  asyncHandler(async (req: Request, res: Response) => {
    const quote = await markLost(req);
    res.json(presentQuote(quote));
  })
);

// VERSIONS
router.get(
  "/:id/versions",
  validate({ params: idParam }),
  asyncHandler(async (req: Request, res: Response) => res.json(await listVersions(req)))
);

router.get(
  "/:id/versions/:v",
  validate({ params: z.object({ id: z.coerce.number().int().positive(), v: z.coerce.number().int().min(0) }) }),
  asyncHandler(async (req: Request, res: Response) => res.json(await getVersion(req)))
);

router.get(
  "/:id/versions/:a/diff/:b",
  validate({ params: z.object({
    id: z.coerce.number().int().positive(),
    a: z.coerce.number().int().min(0),
    b: z.coerce.number().int().min(0),
  }) }),
  asyncHandler(async (req: Request, res: Response) => res.json(await diffVersionsService(req)))
);

// APPROVAL trail for a quote
router.get(
  "/:id/approvals",
  validate({ params: idParam }),
  asyncHandler(async (req: Request, res: Response) => res.json(await listApprovals(req)))
);

// MEMBERS — add/remove the employees who may view & edit this quote.
// Only the creator (or an admin) may manage the member list.
router.put(
  "/:id/members",
  validate({ params: idParam, body: z.object({ memberIds: z.array(z.coerce.number().int().positive()).max(50).default([]) }) }),
  asyncHandler(async (req: Request, res: Response) => res.json(await updateMembers(req)))
);

// SOFT DELETE
router.delete(
  "/:id",
  validate({ params: idParam }),
  asyncHandler(async (req: Request, res: Response) => res.json(await deleteQuote(req)))
);

// DUPLICATE
router.post(
  "/:id/duplicate",
  validate({ params: idParam, body: z.object({ sameProject: zbool.optional() }).default({}) }),
  asyncHandler(async (req: Request, res: Response) => {
    const created = await duplicateQuote(req);
    res.status(201).json(presentQuote(created));
  })
);

export default router;
