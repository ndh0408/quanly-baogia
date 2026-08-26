// Luồng GIÁ HÀ NỘI (role account_hn) — TÁCH khỏi quoteService cho gọn.
// Quản lý GIAO account điền bảng nội bộ loại "hanoi"; account CHỈ thấy/sửa phần đó
// (presentQuoteForAccountHn lược hết phần khác) rồi GỬI DUYỆT; quản lý DUYỆT/TRẢ.
// Tiền HN là NỘI BỘ — nằm trong extraTables nên KHÔNG bao giờ vào Excel.
import type { Request } from "express";
import { prisma } from "./db.js";
import { notify } from "./notifications.js";
import { audit } from "./audit.js";
import { canOnQuote, can, PERMISSIONS as P } from "./permissions.js";
import { QUOTE_INCLUDE, sanitizeExtraTables } from "./quoteUtils.js";
import { reconcileExtraPayments } from "./services/quoteService.js";

const httpError = (status: number, message: string) => Object.assign(new Error(message), { status });

/**
 * Cờ DUYỆT của bảng "hanoi": ai KHÔNG có `quote:internal:approve` thì lấy lại theo `rid` từ CSDL.
 *
 * `reconcileExtraApprovals` (quoteService) CỐ Ý chỉ xử lý "hcm"/"khach" — duyệt Hà Nội là luồng
 * riêng ở mức báo giá (`hnStatus`), không phải theo hàng. Nhưng `sanitizeExtraTables` vẫn ghi
 * `approved/approvedAt/approvedBy` xuống DB nguyên trạng, nên nếu không chặn ở đây thì account
 * Hà Nội tự đóng dấu duyệt cho hàng của chính mình được. Hàng mới (chưa có `rid` trong DB) →
 * chưa duyệt. Mutate tại chỗ, đối xứng với reconcileExtra*.
 */
function reconcileHanoiApprovals(sheets: any[], existingSheets: any[], canApprove: boolean) {
  if (canApprove) return;   // có quyền → giữ nguyên payload, giống nhánh admin của reconcileExtraApprovals
  const prior = new Map<string, { approved: boolean; approvedAt: any; approvedBy: any }>();
  for (const s of existingSheets || []) {
    for (const t of Array.isArray(s.extraTables) ? s.extraTables : []) {
      if (!t || t.category !== "hanoi") continue;
      for (const it of t.items || []) {
        if (it && it.rid) prior.set(it.rid, { approved: !!it.approved, approvedAt: it.approvedAt || null, approvedBy: it.approvedBy ?? null });
      }
    }
  }
  for (const s of sheets) {
    for (const t of Array.isArray(s.extraTables) ? s.extraTables : []) {
      for (const it of t?.items || []) {
        if (!it) continue;
        const p = it.rid ? prior.get(it.rid) : null;
        it.approved = p ? p.approved : false;
        it.approvedAt = p ? p.approvedAt : null;
        it.approvedBy = p ? p.approvedBy : null;
      }
    }
  }
}
// GIAO/DUYỆT phần HN = quyền quote:hn:manage. ĐIỀN = quyền quote:hn:fill.
// Tài khoản được giao điền = ai có quote:hn:fill (role account_hn mặc định HOẶC được cấp riêng per-user).
const hnFillWhere = { OR: [{ role: "account_hn" as const }, { permissions: { has: P.QUOTE_HN_FILL } }] };

/** Manager GIAO 1 account_hn điền phần HN. Thêm account làm member (để thấy báo giá) +
 *  đặt hnStatus=assigned + thông báo. */
export async function assignHn(req: Request) {
  const id = (req.params as any).id;
  const accountId = Number(req.body?.accountId);
  const existing = await prisma.quote.findFirst({ where: { id }, include: { members: { select: { id: true } } } });
  if (!existing) throw httpError(404, "Không tìm thấy báo giá");
  if (!can(req.session, P.QUOTE_HN_MANAGE) || !canOnQuote(req.session, "update", existing)) throw httpError(403, "Bạn không có quyền giao phần Hà Nội");
  const acc = await prisma.user.findFirst({ where: { id: accountId, active: true, ...hnFillWhere }, select: { id: true } });
  if (!acc) throw httpError(400, "Tài khoản Account Hà Nội không hợp lệ");
  const quote = await prisma.quote.update({
    where: { id },
    data: {
      hnAssigneeId: acc.id, hnStatus: "assigned",
      hnSubmittedAt: null, hnReviewedAt: null, hnReviewerId: null, hnRejectNote: null,
      members: { connect: { id: acc.id } },
    },
    include: QUOTE_INCLUDE,
  });
  await notify(acc.id, { title: `Bạn được giao phần Hà Nội: ${quote.quoteNumber}`, body: `${quote.title} — mở để điền giá HN rồi gửi duyệt.`, link: `/#/quotes/${id}`, resource: "quote", resourceId: id, important: true });
  await audit(req, "quote.hn.assign", { resource: "quote", resourceId: id, accountId: acc.id });
  return quote;
}

/** Account_hn LƯU phần HN: CHỈ ghi bảng "hanoi" của từng sheet, GIỮ NGUYÊN mọi thứ khác
 *  (hcm/khach + items/giá báo giá chính không hề bị account đụng tới). */
export async function saveHn(req: Request) {
  const id = (req.params as any).id;
  const existing = await prisma.quote.findFirst({ where: { id }, include: { sheets: { select: { id: true, extraTables: true } } } });
  if (!existing) throw httpError(404, "Không tìm thấy báo giá");
  if (!can(req.session, P.QUOTE_HN_FILL) || existing.hnAssigneeId !== req.session.userId) throw httpError(403, "Chỉ Account Hà Nội được giao mới điền được phần này");
  if (["submitted", "approved"].includes(existing.hnStatus ?? "")) throw httpError(400, "Phần HN đã gửi duyệt/đã duyệt — không sửa được");
  const hnSheets = Array.isArray(req.body?.hnSheets) ? req.body.hnSheets : [];

  // CHỐT LẠI TRẠNG THÁI DO SERVER SỞ HỮU TRƯỚC KHI GHI.
  //
  // `sanitizeExtraTables` persist NGUYÊN TRẠNG `approved/approvedAt/approvedBy` và
  // `paid/paidAt/paidById/paidProof` — chú thích trong hàm ghi rõ giả định: reconcile* đã chạy
  // TRƯỚC. Đường lưu báo giá chính (updateQuote) có gọi; saveHn thì KHÔNG, nên account Hà Nội —
  // vai trò không hề có `quote:internal:pay`/`quote:internal:approve` — tự đặt được cờ "đã thanh
  // toán", tự chọn ngày trả và tự trỏ `paidById` sang người khác, đồng thời nhét thẳng chuỗi
  // `paidProof` vào cột Json (route /pay chặn ở 900KB + bắt buộc data-URL ảnh; đường này thì không).
  //
  // `reconcileExtraPayments` KHÔNG lọc theo category nên dùng được nguyên vẹn cho bảng "hanoi".
  // Duyệt thì phải làm riêng: `reconcileExtraApprovals` cố ý chỉ xử lý "hcm"/"khach".
  const userId = req.session.userId!;
  const canPay = can(req.session, P.QUOTE_INTERNAL_PAY);
  const canApprove = can(req.session, P.QUOTE_INTERNAL_APPROVE);
  const toWrite = hnSheets
    .map((hs: any) => ({ sheet: existing.sheets.find((s) => s.id === Number(hs.sheetId)), extraTables: (hs.hnTables || []).map((t: any) => ({ ...t, category: "hanoi" })) }))
    .filter((x: any) => x.sheet);   // chỉ sheet thuộc báo giá này
  reconcileExtraPayments(toWrite, existing.sheets, canPay, userId);
  reconcileHanoiApprovals(toWrite, existing.sheets, canApprove);

  await prisma.$transaction(async (tx) => {
    for (const { sheet, extraTables } of toWrite) {
      const others = (Array.isArray(sheet!.extraTables) ? sheet!.extraTables : []).filter((t: any) => t && t.category !== "hanoi");
      const hanoi = sanitizeExtraTables(extraTables) || [];
      await tx.quoteSheet.update({ where: { id: sheet!.id }, data: { extraTables: [...others, ...hanoi] } });
    }
    // LUÔN "chạm" báo giá cha để bump Quote.updatedAt. Ghi bảng HN là ghi hàng CON (QuoteSheet) nên KHÔNG
    // tự bump updatedAt của Quote → nếu không làm, khóa lạc quan (baseUpdatedAt) của updateQuote sẽ không
    // phát hiện phần HN vừa lưu và deleteMany+recreate của manager sẽ ghi đè im lặng. Bump ở đây → 409 đúng lúc.
    await tx.quote.update({
      where: { id },
      data: existing.hnStatus === "rejected" ? { hnStatus: "assigned", hnRejectNote: null } : {},
    });
  });
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

/** Manager DUYỆT / TRẢ phần HN → thông báo account. */
export async function reviewHn(req: Request) {
  const id = (req.params as any).id;
  const decision = req.body?.decision;   // "approve" | "reject"
  const note = req.body?.note ? String(req.body.note).slice(0, 500) : null;
  const existing = await prisma.quote.findFirst({ where: { id }, include: { members: { select: { id: true } } } });
  if (!existing) throw httpError(404, "Không tìm thấy báo giá");
  if (!can(req.session, P.QUOTE_HN_MANAGE) || !canOnQuote(req.session, "update", existing)) throw httpError(403, "Bạn không có quyền duyệt phần Hà Nội");
  if (existing.hnStatus !== "submitted") throw httpError(400, "Phần HN chưa được gửi duyệt");
  if (!["approve", "reject"].includes(decision)) throw httpError(400, "Quyết định không hợp lệ");
  const approved = decision === "approve";
  const quote = await prisma.quote.update({
    where: { id },
    data: { hnStatus: approved ? "approved" : "rejected", hnReviewedAt: new Date(), hnReviewerId: req.session.userId, hnRejectNote: approved ? null : note },
    include: QUOTE_INCLUDE,
  });
  if (existing.hnAssigneeId) {
    await notify(existing.hnAssigneeId, approved
      ? { title: `Phần Hà Nội ĐÃ DUYỆT: ${quote.quoteNumber}`, body: quote.title, link: `/#/quotes/${id}`, resource: "quote", resourceId: id }
      : { title: `Phần Hà Nội bị TRẢ LẠI: ${quote.quoteNumber}`, body: note || "Vui lòng chỉnh sửa rồi gửi lại.", link: `/#/quotes/${id}`, resource: "quote", resourceId: id, important: true });
  }
  await audit(req, "quote.hn.review", { resource: "quote", resourceId: id, decision });
  return quote;
}
