// Luồng GIÁ HÀ NỘI (role account_hn) — TÁCH khỏi quoteService cho gọn.
// Quản lý GIAO account điền bảng nội bộ loại "hanoi"; account CHỈ thấy/sửa phần đó
// (presentQuoteForAccountHn lược hết phần khác) rồi GỬI DUYỆT; quản lý DUYỆT/TRẢ.
// Tiền HN là NỘI BỘ — nằm trong extraTables nên KHÔNG bao giờ vào Excel.
import type { Request } from "express";
import { prisma } from "./db.js";
import { notify } from "./notifications.js";
import { audit } from "./audit.js";
import { canOnQuote } from "./permissions.js";
import { QUOTE_INCLUDE, sanitizeExtraTables } from "./quoteUtils.js";

const httpError = (status: number, message: string) => Object.assign(new Error(message), { status });
const isManagerLike = (role: string | null | undefined) => role === "admin" || role === "manager";

/** Manager GIAO 1 account_hn điền phần HN. Thêm account làm member (để thấy báo giá) +
 *  đặt hnStatus=assigned + thông báo. */
export async function assignHn(req: Request) {
  const id = (req.params as any).id;
  const accountId = Number(req.body?.accountId);
  const existing = await prisma.quote.findFirst({ where: { id }, include: { members: { select: { id: true } } } });
  if (!existing) throw httpError(404, "Không tìm thấy báo giá");
  if (!isManagerLike(req.session.role) || !canOnQuote(req.session, "update", existing)) throw httpError(403, "Bạn không có quyền giao phần Hà Nội");
  const acc = await prisma.user.findFirst({ where: { id: accountId, active: true, role: "account_hn" }, select: { id: true } });
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
  if (req.session.role !== "account_hn" || existing.hnAssigneeId !== req.session.userId) throw httpError(403, "Chỉ Account Hà Nội được giao mới điền được phần này");
  if (["submitted", "approved"].includes(existing.hnStatus ?? "")) throw httpError(400, "Phần HN đã gửi duyệt/đã duyệt — không sửa được");
  const hnSheets = Array.isArray(req.body?.hnSheets) ? req.body.hnSheets : [];
  await prisma.$transaction(async (tx) => {
    for (const hs of hnSheets) {
      const sheet = existing.sheets.find((s) => s.id === Number(hs.sheetId));
      if (!sheet) continue;   // chỉ sheet thuộc báo giá này
      const others = (Array.isArray(sheet.extraTables) ? sheet.extraTables : []).filter((t: any) => t && t.category !== "hanoi");
      const hanoi = sanitizeExtraTables((hs.hnTables || []).map((t: any) => ({ ...t, category: "hanoi" }))) || [];
      await tx.quoteSheet.update({ where: { id: sheet.id }, data: { extraTables: [...others, ...hanoi] } });
    }
    if (existing.hnStatus === "rejected") await tx.quote.update({ where: { id }, data: { hnStatus: "assigned", hnRejectNote: null } });
  });
  return prisma.quote.findFirst({ where: { id }, include: QUOTE_INCLUDE });
}

/** Account_hn GỬI DUYỆT phần HN → thông báo quản lý (người tạo báo giá). */
export async function submitHn(req: Request) {
  const id = (req.params as any).id;
  const existing = await prisma.quote.findFirst({ where: { id }, select: { id: true, quoteNumber: true, title: true, hnAssigneeId: true, hnStatus: true, createdById: true } });
  if (!existing) throw httpError(404, "Không tìm thấy báo giá");
  if (req.session.role !== "account_hn" || existing.hnAssigneeId !== req.session.userId) throw httpError(403, "Không có quyền gửi duyệt phần này");
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
  if (!isManagerLike(req.session.role) || !canOnQuote(req.session, "update", existing)) throw httpError(403, "Bạn không có quyền duyệt phần Hà Nội");
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
