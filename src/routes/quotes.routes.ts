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
  QuoteListNoteSchema,
  QuoteFacetsQuerySchema,
  KhoanChiParams,
  KhoanChiSchema,
} from "../validators.js";
import { requirePermission, requireAnyPermission, can, PERMISSIONS as P } from "../permissions.js";
// Hai chốt của đường lưu — ĐẶT SAU `validate` (cần body đã parse để đếm dòng) và TRƯỚC handler.
import { gacKichThuocLuu, gacNganSachLuu, gacNganSachDoc } from "../saveBudget.js";
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
  listInputInvoices,
  listQuoteFacets,
  signSheet,
  setSheetCustomerDecision,
  updateSheetInvoice,
  markConverted,
  markLost,
  listVersions,
  getVersion,
  diffVersionsService,
  listApprovals,
  updateMembers,
  setQuoteListNote,
  deleteQuote,
  duplicateQuote,
} from "../services/quoteService.js";
import { assignHn, saveHn, submitHn, reviewHn } from "../hnWorkflow.js";
import { ghiKhoanChi, docAnhKhoanChi, phuKeToanBanTrinhBay, daChiCuaBaoGia } from "../services/inputInvoiceService.js";

const router = Router();
router.use(requireAuth);

const idParam = z.object({ id: z.coerce.number().int().positive() });

// MỌI phản hồi báo giá đầy đủ / nội bộ / account Hà Nội đi qua LỚP PHỦ trạng thái đã-chi HIỆU LỰC: khoản kế toán
// (trang Hóa đơn đầu vào) thắng cờ JSON cũ đã đóng băng (src/khoanChi.ts). Một helper cho mọi chỗ — sót một đường là
// màn soạn / màn chi phí hiện trạng thái cũ (máy chủ vẫn chốt đúng bằng dữ liệu tươi, nhưng hiển thị thì sai).
const trinhBay = (q: any, opts?: Parameters<typeof presentQuote>[1]) => phuKeToanBanTrinhBay(q.id, presentQuote(q, opts));

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

// SỐ ĐẾM cho bộ lọc của danh sách (theo trạng thái / người tạo / công ty / ghi chú + "của tôi"): cùng tham số với
// GET /, mỗi nhóm đếm theo mọi bộ lọc KHÁC. View lược bị 403 trong service. Đặt TRƯỚC "/:id".
router.get(
  "/facets",
  validate({ query: QuoteFacetsQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => res.json(await listQuoteFacets(req)))
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

// HÓA ĐƠN ĐẦU VÀO (kế toán) — mọi hàng bảng nội bộ ĐÃ DUYỆT, mỗi hàng là một khoản chi cần hoá đơn đầu vào, cộng
// các hàng đã có dữ liệu kế toán mà nay "Cần chú ý" (bỏ duyệt, không còn trong báo giá, báo giá đã xoá).
// Cổng: invoice:page (cùng trang Hoá đơn đầu ra). Đặt TRƯỚC "/:id" để không bị nuốt vào param.
router.get(
  "/input-invoices",
  requirePermission(P.INVOICE_PAGE),
  asyncHandler(async (req: Request, res: Response) => res.json(await listInputInvoices(req)))
);
// KHOẢN CHI của một hàng (chủ repo 2026-10-06): tích ĐÃ CHI + ảnh chứng từ (invoice:input:pay), Ngày hóa đơn + Ghi
// chú kế toán (invoice:edit) — quyền kiểm THEO TỪNG TRƯỜNG trong service. Định vị bằng (báo giá, phía, rid), không
// bằng sheetId (id trang đổi sau mỗi lần Lưu). Ghi vào bảng RIÊNG InputInvoiceEntry: không bump Quote.updatedAt nên
// người đang soạn báo giá không ăn 409. Phạm vi global như GET ở trên (kế toán không có quote:read:*).
router.put(
  "/input-invoices/:quoteId/:side/:rid",
  requirePermission(P.INVOICE_PAGE),
  validate({ params: KhoanChiParams, body: KhoanChiSchema }),
  asyncHandler(async (req: Request, res: Response) => res.json(await ghiKhoanChi(req)))
);
// Ảnh ủy nhiệm chi của khoản (dữ liệu cá nhân bên thứ ba) — service đòi thêm invoice:input:pay. `?proofId=` mở một
// ảnh cũ đã rút vào lịch sử. Mỗi lần xem ghi nhật ký.
router.get(
  "/input-invoices/:quoteId/:side/:rid/proof",
  requirePermission(P.INVOICE_PAGE),
  validate({ params: KhoanChiParams, query: z.object({ proofId: z.coerce.number().int().positive().optional() }) }),
  asyncHandler(async (req: Request, res: Response) => res.json(await docAnhKhoanChi(req)))
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

// (Bốn route thanh toán cũ theo hàng — POST /:id/extra/:sheetId/:rid/pay, GET …/proof, POST /:id/hn/:rid/pay,
// GET /:id/hn/:rid/proof — ĐÃ GỠ 2026-10-06: tích đã chi + ảnh chứng từ chuyển sang kế toán ở PUT /input-invoices/…
// phía trên. Bundle cũ gọi vào nhận 404 và không ghi được gì.)

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
  // Đường ĐỌC cũng phải có trần đồng thời: một GET 0 byte lặp lại được vô hạn và song song được
  // vô hạn, trong khi mỗi lượt giữ BA bản sao báo giá trong heap. Cổng tự bỏ qua báo giá nhỏ
  // (READ_GATE_THRESHOLD_ROWS) nên endpoint nóng nhất không trả phí cho một rủi ro chưa hoạt động.
  gacNganSachDoc,
  asyncHandler(async (req: Request, res: Response) => {
    const quote = await getQuote(req);
    res.json(await trinhBay(quote, { hnOnly: can(req.session, P.QUOTE_HN_FILL), internalOnly: can(req.session, P.QUOTE_INTERNAL_VIEW) }));
  })
);

// CREATE
// Cổng quyền BẮT BUỘC: trước đây route này chỉ validate body, `createQuote` cũng chỉ hỏi "đã đăng
// nhập chưa" → mọi tài khoản (kế toán/nhân sự/account HN) gõ thẳng #/rnew là tạo được báo giá thật.
// requirePermission đọc quyền HIỆU LỰC (session.permissions ← resolveUserPermissions: admin full →
// quyền riêng user → override vai trò từ bảng rolePermission), nên ai được cấp thêm quote:create ở
// trang Phân quyền vẫn tạo bình thường. Đối xứng với duplicateQuote (src/services/quoteService.ts — kiểm QUOTE_CREATE).
router.post(
  "/",
  requirePermission(P.QUOTE_CREATE),
  validate({ body: QuoteCreateSchema }),
  gacKichThuocLuu,
  gacNganSachLuu,
  asyncHandler(async (req: Request, res: Response) => {
    const quote = await createQuote(req);
    res.status(201).json(await trinhBay(quote));
  })
);

// UPDATE
router.put(
  "/:id",
  validate({ params: idParam, body: QuoteUpdateSchema }),
  gacKichThuocLuu,
  gacNganSachLuu,
  asyncHandler(async (req: Request, res: Response) => {
    // 🔒 Người ĐIỀN phần HN KHÔNG được sửa báo giá chính (chỉ điền phần HN qua endpoint riêng bên dưới).
    //
    // Kiểm theo QUYỀN, không theo chuỗi role. `quote:hn:fill` cấp được per-user (trang Phân quyền)
    // và chính nó là cờ bật view lược: GET /:id trả `presentQuoteForAccountHn` cho BẤT KỲ ai có
    // quyền này, còn React SPA cũng nhận diện bằng `me.permissions.includes("quote:hn:fill")`
    // (web/src/components/Shell.tsx, hằng `isAccountHn`). Nếu ở đây vẫn so `role === "account_hn"` thì một manager
    // được cấp riêng quote:hn:fill sẽ: nhận editor CHỈ có phần HN, nhưng KHÔNG bị chặn ở PUT /:id —
    // bấm Lưu là gửi payload thiếu toàn bộ sheet báo giá chính và XOÁ TRẮNG báo giá.
    // Xem tests/hn-guard-by-permission.test.js.
    if (can(req.session, P.QUOTE_HN_FILL)) {
      return res.status(403).json({ error: "Account Hà Nội chỉ được điền phần Hà Nội, không sửa báo giá chính." });
    }
    const updated = await updateQuote(req);
    res.json(await trinhBay(updated, { hnOnly: can(req.session, P.QUOTE_HN_FILL) }));
  })
);

// ===== Luồng GIÁ HÀ NỘI (role account_hn) — phân quyền + write-guard nằm TRONG service =====
// Quản lý giao account điền bảng "hanoi"; account chỉ thấy/sửa phần đó; gửi duyệt; quản lý duyệt/trả.
router.post("/:id/hn/assign", validate({ params: idParam, body: z.object({ accountId: z.coerce.number().int().positive() }) }),
  asyncHandler(async (req: Request, res: Response) => { const q = await assignHn(req); res.json(await trinhBay(q, { hnOnly: can(req.session, P.QUOTE_HN_FILL) })); }));
// BODY PHẢI QUA SCHEMA. Trước đây route này chỉ kiểm `:id`, còn saveHn đọc thẳng req.body →
// sanitizeExtraTables persist nguyên trạng cờ duyệt/thanh toán do server sở hữu, và không có
// cap nào cho số bảng / số dòng / độ dài chuỗi. Xem tests/hn-save-forgery.test.js.
router.put("/:id/hn", validate({ params: idParam, body: HnSaveSchema }),   // account lưu phần HN (chỉ ghi bảng hanoi)
  asyncHandler(async (req: Request, res: Response) => { const q = await saveHn(req); res.json(await trinhBay(q, { hnOnly: can(req.session, P.QUOTE_HN_FILL) })); }));
router.post("/:id/hn/submit", validate({ params: idParam }),
  asyncHandler(async (req: Request, res: Response) => { const q = await submitHn(req); res.json(await trinhBay(q, { hnOnly: can(req.session, P.QUOTE_HN_FILL) })); }));
router.post("/:id/hn/review", validate({ params: idParam, body: z.object({ decision: z.enum(["approve", "reject"]), note: z.string().max(500).optional() }) }),
  asyncHandler(async (req: Request, res: Response) => { const q = await reviewHn(req); res.json(await trinhBay(q, { hnOnly: can(req.session, P.QUOTE_HN_FILL) })); }));

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
    res.json(await trinhBay(quote));
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
    res.json(await trinhBay(quote));
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

// ĐÃ CHI từng hàng bảng nội bộ của MỘT báo giá — CHỈ XEM (cột "Thanh toán" ở màn soạn / Account HN, chủ repo
// 2026-10-06). Quyền + phần thấy được y GET /:id (canOnQuote read; account HN chỉ phía "hn") — xem daChiCuaBaoGia.
// Không ảnh, không Ngày HĐ / ghi chú kế toán. Việc tích vẫn ở PUT /input-invoices/… của kế toán.
router.get(
  "/:id/khoan-chi",
  validate({ params: idParam }),
  asyncHandler(async (req: Request, res: Response) => res.json(await daChiCuaBaoGia(req)))
);

// APPROVAL trail for a quote
router.get(
  "/:id/approvals",
  validate({ params: idParam }),
  asyncHandler(async (req: Request, res: Response) => res.json(await listApprovals(req)))
);

// MEMBERS — "account phụ": ai được vào làm cùng báo giá này, và được sửa VÙNG nào.
// Only the creator (or an admin) may manage the member list.
//
// Hai hình dạng body cùng hợp lệ, cố ý: `members` (client mới, có phạm vi) và `memberIds`
// (client CŨ đang mở sẵn trong tab người khác — hiểu là đủ 4 vùng, đúng hành vi trước bản này).
// Zod v4 loại bỏ khoá lạ và `validate()` GÁN LẠI req.body, nên thiếu khai `members` ở đây là
// phạm vi bị xoá im lặng trên đường vào service.
router.put(
  "/:id/members",
  validate({
    params: idParam,
    body: z.object({
      memberIds: z.array(z.coerce.number().int().positive()).max(50).default([]),
      members: z.array(z.object({
        userId: z.coerce.number().int().positive(),
        scopes: z.array(z.enum(["main", "hcm", "hanoi", "khach"])).max(4).default([]),
      })).max(50).optional(),
    }),
  }),
  asyncHandler(async (req: Request, res: Response) => res.json(await updateMembers(req)))
);

// GHI CHÚ + MÀU ở dòng Danh sách báo giá (bảng riêng QuoteListNote — KHÔNG chạm Quote.updatedAt nên không
// đá văng khoá lạc quan của người đang soạn). Quyền kiểm TRONG service: chủ / thành viên có vùng /
// quote:update:all, và không phải view bị lược. Trường vắng = giữ nguyên.
router.put(
  "/:id/list-note",
  validate({ params: idParam, body: QuoteListNoteSchema }),
  asyncHandler(async (req: Request, res: Response) => res.json(await setQuoteListNote(req)))
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
    res.status(201).json(await trinhBay(created));
  })
);

export default router;
