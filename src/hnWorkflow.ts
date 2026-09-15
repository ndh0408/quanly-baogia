// Luồng GIÁ HÀ NỘI (role account_hn) — TÁCH khỏi quoteService cho gọn.
// Quản lý GIAO account điền bảng nội bộ loại "hanoi"; account CHỈ thấy/sửa phần đó
// (presentQuoteForAccountHn lược hết phần khác) rồi GỬI DUYỆT; quản lý DUYỆT/TRẢ.
// Tiền HN là NỘI BỘ — nằm trong extraTables nên KHÔNG bao giờ vào Excel.
import type { Request } from "express";
import { prisma } from "./db.js";
import { notify } from "./notifications.js";
import { audit } from "./audit.js";
import { canOnQuote, can, laAccountPhu, PERMISSIONS as P } from "./permissions.js";
import { QUOTE_INCLUDE, sanitizeHnTables } from "./quoteUtils.js";
import { reconcileExtraPayments, reconcileHnApprovals } from "./services/quoteService.js";

const httpError = (status: number, message: string) => Object.assign(new Error(message), { status });

// GIAO/DUYỆT phần HN = quyền quote:hn:manage. ĐIỀN = quyền quote:hn:fill.
// Tài khoản được giao điền = ai có quote:hn:fill (role account_hn mặc định HOẶC được cấp riêng per-user).
const hnFillWhere = { OR: [{ role: "account_hn" as const }, { permissions: { has: P.QUOTE_HN_FILL } }] };

/** Manager GIAO 1 account_hn điền phần HN. Thêm account làm member (để thấy báo giá) +
 *  đặt hnStatus=assigned + thông báo. */
export async function assignHn(req: Request) {
  const id = (req.params as any).id;
  const accountId = Number(req.body?.accountId);
  const existing = await prisma.quote.findFirst({ where: { id }, include: { members: { select: { userId: true, scopes: true } } } });
  if (!existing) throw httpError(404, "Không tìm thấy báo giá");
  if (!can(req.session, P.QUOTE_HN_MANAGE) || !canOnQuote(req.session, "update", existing)) throw httpError(403, "Bạn không có quyền giao phần Hà Nội");
  // Vai trò `manager` mặc định CÓ quote:hn:manage, nên nếu không chặn ở đây thì một account phụ
  // (dù chỉ được tick "Phí khách hàng") vẫn giao được phần HN — mà giao phần HN THÊM NGƯỜI vào
  // danh sách thành viên. Phân công là việc của chủ báo giá.
  if (laAccountPhu(req.session, existing)) throw httpError(403, "Bạn được thêm vào làm cùng báo giá này, việc giao phần Hà Nội thuộc về người tạo báo giá");
  const acc = await prisma.user.findFirst({ where: { id: accountId, active: true, ...hnFillWhere }, select: { id: true } });
  if (!acc) throw httpError(400, "Tài khoản Account Hà Nội không hợp lệ");
  const quote = await prisma.quote.update({
    where: { id },
    data: {
      hnAssigneeId: acc.id, hnStatus: "assigned",
      hnSubmittedAt: null, hnReviewedAt: null, hnReviewerId: null, hnRejectNote: null,
      // UPSERT chứ không create: `connect` của m2m ngầm vốn idempotent, `create` của model
      // tường minh thì KHÔNG — giao lại phần HN cho cùng một account sẽ ném P2002. Nhánh
      // `update` để RỖNG: nếu người này đã là account phụ với phạm vi rộng hơn thì giữ nguyên.
      members: {
        upsert: {
          where: { quoteId_userId: { quoteId: Number(id), userId: acc.id } },
          create: { userId: acc.id, scopes: ["hanoi"], addedById: req.session.userId },
          update: {},
        },
      },
    },
    include: QUOTE_INCLUDE,
  });
  await notify(acc.id, { title: `Bạn được giao phần Hà Nội: ${quote.quoteNumber}`, body: `${quote.title} — mở để điền giá HN rồi gửi duyệt.`, link: `/#/quotes/${id}`, resource: "quote", resourceId: id, important: true });
  await audit(req, "quote.hn.assign", { resource: "quote", resourceId: id, accountId: acc.id });
  return quote;
}

/**
 * Account Hà Nội LƯU phần của mình — `PUT /api/quotes/:id/hn`.
 *
 * Từ 2026-09-15 bảng HN nằm ở `Quote.hnTables` (cấp báo giá), KHÔNG còn rải trong
 * `QuoteSheet.extraTables` của từng trang. Ba thứ biến mất theo, và đó là mục đích:
 *   · không còn ghép theo `sheetId` → hết 409 "trang đã được tạo mới, hãy tải lại" mỗi lần chủ
 *     báo giá bấm Lưu (lưu = xoá trang rồi tạo lại nên id đổi hết);
 *   · không còn đọc/ghi hàng QuoteSheet → chỉ khoá MỘT hàng (Quote);
 *   · account HN không còn thấy trang nào của chủ (xem presentQuoteForAccountHn).
 *
 * Thay cho phép suy đoán "trang đã chết" là khoá lạc quan THẬT: client gửi lại `baseUpdatedAt` đã
 * tải; lệch là 409 kèm lời nhắc chép phần vừa gõ. Client cũ không gửi thì bỏ qua (tương thích
 * ngược, không tệ hơn trước).
 */
export async function saveHn(req: Request) {
  const id = Number((req.params as any).id);
  const existing = await prisma.quote.findFirst({ where: { id }, select: { id: true, hnStatus: true, hnAssigneeId: true, updatedAt: true } });
  if (!existing) throw httpError(404, "Không tìm thấy báo giá");
  if (!can(req.session, P.QUOTE_HN_FILL) || existing.hnAssigneeId !== req.session.userId) throw httpError(403, "Chỉ Account Hà Nội được giao mới điền được phần này");
  if (["submitted", "approved"].includes(existing.hnStatus ?? "")) throw httpError(400, "Phần HN đã gửi duyệt/đã duyệt — không sửa được");
  // Tab chạy bundle CŨ gửi `hnSheets` (hình dạng theo trang, đã bỏ). Không được hiểu thành "xoá
  // hết bảng": nói thẳng để họ tải lại, và nhắc chép phần vừa gõ trước khi tải.
  if (!Array.isArray(req.body?.hnTables)) {
    throw httpError(400, "Trang đang chạy bản giao diện cũ. Hãy CHÉP LẠI phần vừa gõ, tải lại trang rồi nhập lại — bản cũ lưu sẽ làm mất phần Hà Nội.");
  }
  const payload = req.body.hnTables;
  const mocClient = req.body?.baseUpdatedAt ? new Date(req.body.baseUpdatedAt) : null;

  // CHỐT LẠI TRẠNG THÁI DO SERVER SỞ HỮU TRƯỚC KHI GHI.
  //
  // `sanitizeHnTables` persist NGUYÊN TRẠNG `approved*` và `paid*`/`paidProof` (nó chỉ chuẩn hoá
  // hình dạng, không phán quyền), mà account Hà Nội KHÔNG có `quote:internal:approve` lẫn
  // `quote:internal:pay`. Không chốt lại thì họ tự đóng dấu duyệt cho hàng của mình, tự tích "đã
  // thanh toán", tự chọn ngày trả và tự trỏ `paidById` sang người khác, đồng thời nhét thẳng chuỗi
  // `paidProof` vào cột Json (route /pay chặn ở 900KB + bắt buộc data-URL ảnh; đường này thì không).
  const userId = req.session.userId!;
  const canPay = can(req.session, P.QUOTE_INTERNAL_PAY);
  const canApprove = can(req.session, P.QUOTE_INTERNAL_APPROVE);

  await prisma.$transaction(async (tx) => {
    // KHOÁ RỒI MỚI ĐỌC. Cột jsonb vẫn là read-modify-write nguyên khối, nên bỏ khoá QuoteSheet mà
    // không lấy khoá Quote là đổi một lỗ mất dữ liệu lấy một lỗ khác.
    //
    // CHỈ khoá hàng Quote, và KHÔNG đụng QuoteSheet sau đó: mọi đường ghi khác lấy khoá theo thứ tự
    // QuoteSheet → Quote (updateQuote, markExtraTableRowPayment), nên lấy ngược chiều là deadlock.
    // Dùng $queryRaw chứ không `tx.quote.updateMany`: extension realtime ở src/db.ts coi updateMany
    // là WRITE nên bắn thêm một sự kiện SSE, mà SSE đã bắn thì rollback không rút lại được.
    await tx.$queryRaw`SELECT id FROM "Quote" WHERE id = ${id} FOR UPDATE`;
    const tuoi = await tx.quote.findFirst({ where: { id }, select: { hnTables: true, hnStatus: true, hnAssigneeId: true, updatedAt: true } });
    if (!tuoi) throw httpError(404, "Không tìm thấy báo giá");
    // Kiểm LẠI sau khi đã giữ khoá: giữa lần đọc đầu và đây, quản lý có thể vừa duyệt/giao lại.
    if (["submitted", "approved"].includes(tuoi.hnStatus ?? "")) throw httpError(400, "Phần HN vừa được gửi duyệt/duyệt — không sửa được nữa");
    if (tuoi.hnAssigneeId !== userId) throw httpError(403, "Phần Hà Nội vừa được giao cho người khác");
    if (mocClient && tuoi.updatedAt && new Date(tuoi.updatedAt).getTime() !== mocClient.getTime()) {
      throw httpError(409, "Báo giá vừa được cập nhật ở nơi khác. Hãy chép lại phần vừa gõ, tải lại trang rồi nhập lại — đừng đóng tab trước khi chép.");
    }

    // Hai hàm reconcile nhận mảng "sheet" có `.extraTables`; bọc một phần tử là dùng lại được
    // nguyên vẹn, không phải đẻ bản sao thứ hai của luật (chúng không hề đọc sheet.id).
    const boc = [{ extraTables: payload }];
    const bocDb = [{ extraTables: Array.isArray(tuoi.hnTables) ? tuoi.hnTables : [] }];
    reconcileExtraPayments(boc, bocDb, canPay, userId);
    reconcileHnApprovals(boc, bocDb, canApprove);

    await tx.quote.update({
      where: { id },
      data: {
        hnTables: sanitizeHnTables(boc[0].extraTables) as any,
        // Bị trả lại rồi sửa tiếp → quay về "đang làm" (giữ đúng hành vi cũ).
        ...(tuoi.hnStatus === "rejected" ? { hnStatus: "assigned", hnRejectNote: null } : {}),
      },
    });
  });
  // Mất bảng phải có dấu vết: từ bản này account HN tự thêm/xoá bảng của chính họ.
  await audit(req, "quote.hn.save", { resource: "quote", resourceId: id, after: { soBang: payload.length } });
  return prisma.quote.findFirst({ where: { id }, include: QUOTE_INCLUDE });
}

/** Account_hn GỬI DUYỆT phần HN → thông báo quản lý (người tạo báo giá). */
export async function submitHn(req: Request) {
  const id = (req.params as any).id;
  const existing = await prisma.quote.findFirst({ where: { id }, select: { id: true, quoteNumber: true, title: true, hnAssigneeId: true, hnStatus: true, createdById: true } });
  if (!existing) throw httpError(404, "Không tìm thấy báo giá");
  if (!can(req.session, P.QUOTE_HN_FILL) || existing.hnAssigneeId !== req.session.userId) throw httpError(403, "Không có quyền gửi duyệt phần này");
  if (!["assigned", "rejected"].includes(existing.hnStatus ?? "")) throw httpError(400, "Phần HN không ở trạng thái có thể gửi duyệt");
  const quote = await prisma.quote.update({ where: { id }, data: { hnStatus: "submitted", hnSubmittedAt: new Date(), hnRejectNote: null }, include: QUOTE_INCLUDE });
  await notify(existing.createdById, { title: `Phần Hà Nội chờ duyệt: ${quote.quoteNumber}`, body: `${quote.title} — Account đã gửi giá HN, mở để duyệt/trả.`, link: `/#/quotes/${id}`, resource: "quote", resourceId: id, important: true });
  await audit(req, "quote.hn.submit", { resource: "quote", resourceId: id });
  return quote;
}

/**
 * Manager DUYỆT / TRẢ phần HN → thông báo account.
 *
 * NGUYÊN TỬ hoá bằng `updateMany` + kiểm `count` — ultracode audit 2026-09-09 (finding M-CONC).
 * Bản trước là check-then-update: đọc `hnStatus` rồi `update` KHÔNG kèm lại điều kiện đó, nên hai
 * lượt duyệt/trả gần như đồng thời (2 quản lý HN cùng bấm) đều đọc thấy "submitted" và đều ghi đè
 * — người thắng cuối cùng quyết định kết quả, mà audit log + thông báo cho account lại ghi CẢ HAI
 * quyết định như thể đều hợp lệ. `markConverted`/`markLost` (quoteService.ts) đã tự vá đúng khuôn
 * này cho một chuyển trạng thái terminal tương tự; `reviewHn` xử lý cùng LOẠI chuyển trạng thái
 * (submitted → approved/rejected) nhưng chưa áp dụng khuôn đó. Xem tests/zm-hn-review-atomic.test.js.
 */
export async function reviewHn(req: Request) {
  const id = (req.params as any).id;
  const decision = req.body?.decision;   // "approve" | "reject"
  const note = req.body?.note ? String(req.body.note).slice(0, 500) : null;
  const existing = await prisma.quote.findFirst({ where: { id }, include: { members: { select: { userId: true, scopes: true } } } });
  if (!existing) throw httpError(404, "Không tìm thấy báo giá");
  if (!can(req.session, P.QUOTE_HN_MANAGE) || !canOnQuote(req.session, "update", existing)) throw httpError(403, "Bạn không có quyền duyệt phần Hà Nội");
  // Như assignHn: duyệt/trả phần HN mở lại quyền ghi lên giá đã chốt, không phải việc của phụ.
  if (laAccountPhu(req.session, existing)) throw httpError(403, "Bạn được thêm vào làm cùng báo giá này, việc duyệt phần Hà Nội thuộc về người tạo báo giá");
  if (existing.hnStatus !== "submitted") throw httpError(400, "Phần HN chưa được gửi duyệt");
  if (!["approve", "reject"].includes(decision)) throw httpError(400, "Quyết định không hợp lệ");
  const approved = decision === "approve";
  // Optimistic guard: chỉ ghi nếu hnStatus VẪN LÀ "submitted" tại thời điểm ghi, không phải lúc đọc
  // ở trên — chặn đúng cửa sổ đua giữa findFirst và update.
  const upd = await prisma.quote.updateMany({
    where: { id, hnStatus: "submitted" },
    data: { hnStatus: approved ? "approved" : "rejected", hnReviewedAt: new Date(), hnReviewerId: req.session.userId, hnRejectNote: approved ? null : note },
  });
  if (!upd.count) {
    throw httpError(409, "Phần Hà Nội vừa được xử lý bởi người khác — vui lòng tải lại");
  }
  const quote = await prisma.quote.findFirst({ where: { id }, include: QUOTE_INCLUDE });
  if (!quote) throw httpError(404, "Không tìm thấy báo giá");
  if (existing.hnAssigneeId) {
    await notify(existing.hnAssigneeId, approved
      ? { title: `Phần Hà Nội ĐÃ DUYỆT: ${quote.quoteNumber}`, body: quote.title, link: `/#/quotes/${id}`, resource: "quote", resourceId: id }
      : { title: `Phần Hà Nội bị TRẢ LẠI: ${quote.quoteNumber}`, body: note || "Vui lòng chỉnh sửa rồi gửi lại.", link: `/#/quotes/${id}`, resource: "quote", resourceId: id, important: true });
  }
  await audit(req, "quote.hn.review", { resource: "quote", resourceId: id, decision });
  return quote;
}
