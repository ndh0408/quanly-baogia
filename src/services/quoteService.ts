// Application service for the quote domain. Holds the heavy create/update business
// logic (transactions, number allocation, version snapshots, reopen-on-edit,
// audit/webhook/notify) so the route handlers stay thin: parse -> call service ->
// present. Business-rule failures are thrown as httpError(status,msg); the central
// errorHandler maps err.status<500 to that HTTP status + message.

import { Prisma } from "@prisma/client";
import type { Request } from "express";
import { prisma, type TxClient } from "../db.js";
import { config } from "../config.js";
import { computeQuoteTotals, assertTotalsStorable, D } from "../money.js";
import { nextQuoteNumber, nextProjectCode, syncQuoteCounter } from "../quoteNumber.js";
import { normalizeSearch, searchTextFilter } from "../searchText.js";
import { audit } from "../audit.js";
import { snapshotQuoteVersion, diffVersions } from "../quoteVersion.js";
import { notify } from "../notifications.js";
import { emit as emitWebhook } from "../webhooks.js";
import { can, canOnQuote, quoteScopeWhereOrThrow, PERMISSIONS as P } from "../permissions.js";
import {
  canEdit,
  QUOTE_INCLUDE,
  QUOTE_LIST_SELECT,
  templatesBelongToCompany,
  buildSheetsCreate,
  sanitizeExtraTables,
  extraTableSum,
} from "../quoteUtils.js";
import { httpError } from "../httpError.js";

/**
 * Caller có VIEW BỊ LƯỢC — `GET /quotes/:id` chỉ trả cho họ một phần báo giá:
 *   quote:hn:fill      → presentQuoteForAccountHn (chỉ bảng "hanoi")
 *   quote:internal:view → presentQuoteForInternal (chỉ các bảng nội bộ)
 * Cả hai CỐ Ý giấu tên/liên hệ khách, đơn giá bán và subtotal/vat/total.
 */
const viewBiLuoc = (session: any) => can(session, P.QUOTE_HN_FILL) || can(session, P.QUOTE_INTERNAL_VIEW);

/**
 * Tải báo giá theo :id và THROW 403/404 nếu caller không được `action`. Dùng cho sub-resource.
 *
 * TỪ CHỐI LUÔN caller có view bị lược. `canOnQuote` cho THÀNH VIÊN đi qua với `quote:read:own`, mà
 * `assignHn` thì `members: { connect: … }` — account Hà Nội LUÔN là thành viên của báo giá được
 * giao. Không có lớp này thì họ chỉ cần đổi URL `/quotes/7` → `/quotes/7/versions/1` là đọc được
 * nguyên `QuoteVersion.payload`: toCompany, toEmail, toPhone, toAddress, subtotal, vat, total và
 * toàn bộ sheets[].items[] kèm unitPrice — đúng những thứ projection sinh ra để giấu.
 *
 * Đặt ở helper CHUNG chứ không rải ở từng handler là cố ý: cả bốn caller hiện tại (listVersions,
 * getVersion, diffVersionsService, listApprovals) đều là lịch sử/duyệt ở MỨC BÁO GIÁ, và caller
 * thứ năm thêm sau này nên thừa hưởng "từ chối mặc định" thay vì thừa hưởng lỗ rò.
 * Xem tests/version-projection-leak.test.js.
 */
async function loadAuthorizedQuote(req: Request, action: string = "read") {
  const id = Number(req.params.id);
  const quote = await prisma.quote.findFirst({
    where: { id },
    include: { members: { select: { id: true } } },
  });
  if (!quote) throw httpError(404, "Không tìm thấy báo giá");
  if (!canOnQuote(req.session, action, quote)) throw httpError(403, "Bạn không có quyền với báo giá này");
  if (viewBiLuoc(req.session)) throw httpError(403, "Bạn chỉ được xem phần được giao của báo giá này");
  return quote;
}

// Duyệt theo HÀNG cho bảng nội bộ "hcm"/"khach": CHỈ ADMIN được đặt approved. Gọi TRƯỚC khi
// lưu (buildSheetsCreate) để: non-admin → GIỮ NGUYÊN trạng thái duyệt cũ theo `rid` (chống tự
// duyệt qua payload); admin → honor + đóng dấu approvedAt/approvedBy khi mới duyệt. Mutate sheets.
export function reconcileExtraApprovals(sheets: any[], existingSheets: any[], isAdmin: boolean, approverId: number) {
  if (!Array.isArray(sheets)) return;
  const prior = new Map();   // rid -> { approved, approvedAt, approvedBy }
  for (const s of (existingSheets || [])) {
    for (const t of (Array.isArray(s.extraTables) ? s.extraTables : [])) {
      if (!t || (t.category !== "hcm" && t.category !== "khach")) continue;
      for (const it of (t.items || [])) {
        if (it && it.rid) prior.set(it.rid, { approved: !!it.approved, approvedAt: it.approvedAt || null, approvedBy: it.approvedBy ?? null });
      }
    }
  }
  const now = new Date().toISOString();
  for (const s of sheets) {
    for (const t of (Array.isArray(s.extraTables) ? s.extraTables : [])) {
      if (!t || (t.category !== "hcm" && t.category !== "khach")) continue;
      for (const it of (t.items || [])) {
        if (!it) continue;
        const p = it.rid ? prior.get(it.rid) : null;
        if (!isAdmin) {   // non-admin: bỏ qua mọi thay đổi duyệt từ client → theo DB (mới = chưa duyệt)
          it.approved = p ? p.approved : false;
          it.approvedAt = p ? p.approvedAt : null;
          it.approvedBy = p ? p.approvedBy : null;
        } else {          // admin: honor, đóng dấu khi MỚI duyệt, giữ dấu cũ nếu vẫn duyệt
          const want = !!it.approved;
          if (want && (!p || !p.approved)) { it.approvedAt = now; it.approvedBy = approverId; }
          else if (want) { it.approvedAt = p.approvedAt || now; it.approvedBy = p.approvedBy ?? approverId; }
          else { it.approvedAt = null; it.approvedBy = null; }
          it.approved = want;
        }
      }
    }
  }
}

// THANH TOÁN theo HÀNG bảng nội bộ (mọi loại): CHỈ người có quote:internal:pay được đặt `paid`. Gọi TRƯỚC
// khi lưu để: không-quyền → GIỮ trạng thái thanh toán cũ theo `rid` (chống tự đánh dấu qua payload);
// có-quyền → honor + đóng dấu paidAt/paidById. ẢNH (paidProof) LUÔN theo DB ở đây — chỉ route /pay ghi ảnh.
export function reconcileExtraPayments(sheets: any[], existingSheets: any[], canPay: boolean, payerId: number) {
  if (!Array.isArray(sheets)) return;
  // rid -> trạng thái thanh toán CỘNG số tiền tại thời điểm đó.
  //
  // ── VÌ SAO PHẢI GHIM CẢ SỐ TIỀN ─────────────────────────────────────────────
  // `rid` do CHÍNH CLIENT gửi lên và được `sanitizeExtraTables` (src/quoteUtils.ts) giữ NGUYÊN VĂN
  // khi ghi. Bản trước chỉ tra `prior.get(it.rid)`, nên tin cậy hoàn toàn vào một chuỗi client
  // kiểm soát. ĐÃ ĐO hai chiều:
  //   • rid BỊA (chưa từng có trong CSDL) → `p` là null → `paid` bị ép về false. Chiều này AN TOÀN
  //     từ trước, và cần nói đúng như vậy: nó KHÔNG phải lỗ.
  //   • CHÉP LẠI rid của một hàng ĐÃ THANH TOÁN sang một hàng BỊA giá 50.000.000đ → hàng bịa nhận
  //     `paid: true` cùng `paidAt`/`paidById` của người trả thật VÀ cả ẢNH CHỨNG TỪ thật. Đó là
  //     giả mạo chứng từ tài chính, làm được bởi đúng lớp tài khoản mà lớp gác này sinh ra để chặn
  //     (account_hn đọc được rid trong payload trả về của chính họ).
  //
  // Bất biến đóng lỗ đó: AI KHÔNG ĐƯỢC ĐẶT `paid` THÌ CŨNG KHÔNG ĐƯỢC ĐỔI SỐ TIỀN CỦA HÀNG ĐÃ TRẢ.
  // Hàng nào lấy trạng thái đã-trả mà số tiền lệch so với bản CSDL thì KHÔNG kế thừa gì — nó không
  // còn là hàng đó nữa. Người có quyền `quote:internal:pay` không bị ràng buộc này (họ vốn đặt được
  // `paid` trực tiếp), nên luồng kế toán bình thường không đổi.
  //
  // Cộng thêm: mỗi rid chỉ được kế thừa MỘT lần. Gửi hai hàng cùng rid thì hàng thứ hai trở đi là
  // bản sao, không phải hàng gốc.
  // Dấu vân tay SỐ TIỀN của một hàng — `null` nghĩa là "hàng này KHÔNG GHI số tiền", khác hẳn "số
  // tiền bằng 0".
  //
  // PHẢI PHÂN BIỆT HAI THỨ ĐÓ. Bản đầu của chốt này quy cả hai về `0|0|`, và nó lập tức phá một ca
  // THẬT: hàng bảng nội bộ ghi từ trước khi `sanitizeExtraTables` chuẩn hoá (hoặc ghi qua route
  // /pay) không có `quantity`/`unitPrice` trong JSON, trong khi payload gửi lên thì luôn có số sau
  // khi sanitize. So ra "lệch" ⇒ chốt cắt trạng thái đã-trả của một hàng HỢP LỆ — tức tự tay xoá
  // chứng từ tài chính thật, hại hơn hẳn thứ nó đi chặn. tests/extra-paid-preserved.test.js bắt
  // đúng ca này.
  //
  // Nên: thiếu dữ liệu thì MỞ (không áp phép so), có dữ liệu thì SIẾT. Phần dư lại rất hẹp — kẻ
  // tấn công phải chép rid của một hàng vừa ĐÃ THANH TOÁN vừa KHÔNG GHI số tiền — và đánh đổi đó
  // đúng chiều: không bao giờ hi sinh dữ liệu thật để chặn một đường khai thác hẹp.
  const soTien = (it: any) => {
    const q = it?.quantity, dg = it?.unitPrice;
    if ((q === undefined || q === null) && (dg === undefined || dg === null)) return null;
    return `${Number(q) || 0}|${Number(dg) || 0}|${it?.days != null ? Number(it.days) : ""}`;
  };
  const prior = new Map();   // rid -> { paid, paidAt, paidById, paidProof, tien }
  for (const s of (existingSheets || [])) {
    for (const t of (Array.isArray(s.extraTables) ? s.extraTables : [])) {
      for (const it of (t?.items || [])) {
        if (it && it.rid) prior.set(it.rid, { paid: !!it.paid, paidAt: it.paidAt || null, paidById: it.paidById ?? null, paidProof: it.paidProof ?? null, tien: soTien(it) });
      }
    }
  }
  const daDung = new Set<string>();
  const now = new Date().toISOString();
  for (const s of sheets) {
    for (const t of (Array.isArray(s.extraTables) ? s.extraTables : [])) {
      for (const it of (t?.items || [])) {
        if (!it) continue;
        let p = it.rid ? prior.get(it.rid) : null;
        if (p && it.rid) {
          if (daDung.has(it.rid)) p = null;                                   // bản sao của cùng một rid
          else {
            daDung.add(it.rid);
            // Đổi số tiền của hàng ĐÃ TRẢ mà không có quyền đặt `paid` → cắt mọi kế thừa.
            // `p.tien === null` = bản CSDL không ghi số tiền → không có gì để so, giữ nguyên kế thừa.
            if (!canPay && p.paid && p.tien !== null && p.tien !== soTien(it)) p = null;
          }
        }
        it.paidProof = p ? p.paidProof : null;  // ảnh không đi qua quote-save (chống base64 chảy + giả mạo)
        if (!canPay) {
          it.paid = p ? p.paid : false;
          it.paidAt = p ? p.paidAt : null;
          it.paidById = p ? p.paidById : null;
        } else {
          const want = !!it.paid;
          if (want && (!p || !p.paid)) { it.paidAt = now; it.paidById = payerId; }
          else if (want) { it.paidAt = p.paidAt || now; it.paidById = p.paidById ?? payerId; }
          else { it.paidAt = null; it.paidById = null; }
          it.paid = want;
        }
      }
    }
  }
}

/**
 * Create a quote from a validated body (req.body). Allocates the quote number +
 * per-employee project code and snapshots v1 INSIDE one transaction (failed insert
 * rolls the counter back — no burned numbers), retrying the rare P2002 collision.
 * Returns the created quote (QUOTE_INCLUDE).
 */
export async function createQuote(req: Request) {
  const b = req.body;
  const userId = req.session.userId;
  if (userId === undefined) throw httpError(401, "Chưa đăng nhập");
  // PHÒNG THỦ NHIỀU LỚP: route đã gác requirePermission(QUOTE_CREATE), nhưng service cũng phải tự
  // kiểm — mọi đường gọi mới (job/script/route khác) đều đi qua đây. Đối xứng duplicateQuote().
  if (!can(req.session, P.QUOTE_CREATE)) throw httpError(403, "Không có quyền tạo báo giá");

  const company = await prisma.company.findFirst({ where: { id: b.companyId } });
  if (!company) throw httpError(400, "Không tìm thấy công ty");
  if (!(await templatesBelongToCompany(b.sheets, company.id))) {
    throw httpError(400, "Có mẫu báo giá không thuộc công ty đã chọn (hoặc đã ngừng dùng)");
  }
  // Duyệt hàng (HCM/Khách) — tạo mới: ai KHÔNG có quyền duyệt nội bộ thì mọi hàng CHƯA duyệt; có quyền tick thì đóng dấu.
  reconcileExtraApprovals(b.sheets, [], can(req.session, P.QUOTE_INTERNAL_APPROVE), userId);
  reconcileExtraPayments(b.sheets, [], can(req.session, P.QUOTE_INTERNAL_PAY), userId);

  // Client-supplied number: validate uniqueness across ALL rows (incl. soft-deleted)
  // BEFORE the write to return a clean 409.
  if (b.quoteNumber) {
    const dup = await prisma.quote.findFirst({ where: { quoteNumber: b.quoteNumber }, includeDeleted: true } as any);
    if (dup) {
      throw httpError(409, dup.deletedAt ? "Số báo giá đã dùng (thuộc báo giá đã xoá)" : "Số báo giá đã tồn tại");
    }
  }

  const creator = await prisma.user.findUnique({ where: { id: userId }, select: { projectCode: true } });
  const draft: Record<string, any> = {
    title: b.title,
    toCompany: b.toCompany,
    toContact: b.toContact || null,
    toEmail: b.toEmail || null,
    toPhone: b.toPhone || null,
    toAddress: b.toAddress || null,
    companyId: company.id,
    fromContact: b.fromContact || "",
    fromPhone: b.fromPhone || company.phone || null,
    fromTitle: b.fromTitle || null,
    fromAddress: b.fromAddress || company.address,
    city: b.city || company.city || "TP. Hồ Chí Minh",
    quoteDate: b.quoteDate || new Date(),
    executionDate: b.executionDate || null,
    customerId: b.customerId ?? null,
    greeting: b.greeting || undefined,
    vatPercent: D(b.vatPercent),
    discount: D(b.discount || 0),
    showTotals: b.showTotals !== false,
    notes: b.notes || null,
    customerLogo: b.customerLogo || null,
    status: "draft",
    createdById: userId,
  };

  // Compute totals from sheets+items BEFORE writing so we store the snapshot.
  const t = computeQuoteTotals({ vatPercent: draft.vatPercent, discount: draft.discount, sheets: b.sheets });
  assertTotalsStorable(t, b.sheets); // 400 nói rõ trang nào âm, thay vì 500 mất trắng lần Lưu
  draft.subtotal = t.subtotal;
  draft.vat = t.vat;
  draft.discount = t.discount;
  draft.total = t.total;

  const prefix = company.quotePrefix || "GN";
  let quote;
  // Số của LƯỢT VỪA HỎNG, đọc lại được ở khối catch (xem lý do ở đó).
  const capSo: { so: string | null } = { so: null };
  for (let attempt = 0; ; attempt++) {
    try {
      quote = await prisma.$transaction(async (tx) => {
        const quoteNumber = b.quoteNumber ?? await nextQuoteNumber(prefix, tx as any);
        capSo.so = quoteNumber;
        // Số do client gửi không đi qua bộ đếm → phải đẩy bộ đếm theo, nếu không lần cấp TỰ ĐỘNG
        // kế tiếp sinh lại số đã dùng và đốt sạch ngân sách thử lại (xem syncQuoteCounter).
        if (b.quoteNumber) await syncQuoteCounter(b.quoteNumber, prefix, tx as any);
        if (creator?.projectCode) draft.projectCode = await nextProjectCode(creator.projectCode, tx as any);
        const searchText = normalizeSearch(quoteNumber, draft.projectCode, draft.title, draft.toCompany, draft.toContact);
        const created = await tx.quote.create({
          data: { ...draft, quoteNumber, searchText, sheets: { create: buildSheetsCreate(b.sheets, t.sheetTotals) }, members: { connect: [{ id: userId }] } } as any,
          include: QUOTE_INCLUDE as any,
        });
        await snapshotQuoteVersion(tx, created.id, userId, "create");
        return created;
      });
      break;
    } catch (e) {
      const code = e instanceof Prisma.PrismaClientKnownRequestError ? e.code : undefined;
      if (code === "P2002" && !b.quoteNumber && attempt < 3) {
        // Thử lại KHÔNG tự khỏi: transaction hỏng cuốn theo cả lần tăng bộ đếm (chủ ý "không đốt
        // số" của nextQuoteNumber), nên lượt sau sinh LẠI ĐÚNG số vừa đụng — bốn lượt cùng một số,
        // rồi 409. Ghi nhận số đã bị chiếm vào bộ đếm NGOÀI transaction (GREATEST nên không lùi)
        // để lượt sau nhảy sang số kế tiếp. Đây là ca CÓ THẬT bất cứ khi nào tồn tại báo giá mang
        // số không do bộ đếm cấp: nhập tay qua API, hoặc dữ liệu chuyển từ hệ cũ.
        if (capSo.so) await syncQuoteCounter(capSo.so, prefix).catch(() => {});
        continue;
      }
      if (code === "P2002") throw httpError(409, "Số báo giá bị trùng, vui lòng thử lại");
      throw e;
    }
  }

  await audit(req, "quote.create", {
    resource: "quote",
    resourceId: quote.id,
    after: { quoteNumber: quote.quoteNumber, total: Number(quote.total), status: quote.status },
  });
  emitWebhook("quote.created", { id: quote.id, quoteNumber: quote.quoteNumber, total: Number(quote.total) }).catch(() => {});
  return quote;
}

/**
 * Ghép sheet GỬI LÊN với sheet ĐANG CÓ trong DB để bê trạng thái mức sheet (SHEET_CARRY_FIELDS).
 *
 * Ghép theo `id` khi client gửi kèm (React editor gửi) — chắc chắn đúng dù người dùng đổi thứ tự
 * hay chèn/xoá sheet. Client CŨ không gửi id thì chỉ ghép theo VỊ TRÍ và chỉ khi SỐ SHEET không
 * đổi + cùng mẫu (đúng ca "chỉ sửa hạng mục"); mọi ca khác bỏ qua, thà mất mốc còn hơn gán nhầm
 * "khách đã duyệt" sang sheet khác.
 */
function carrySheetState(incoming: any[], existingSheets: any[]): (Record<string, any> | undefined)[] {
  const list = Array.isArray(incoming) ? incoming : [];
  const byId = new Map<number, any>((existingSheets || []).map((s: any) => [Number(s.id), s]));
  const anyId = list.some((s: any) => Number(s?.id) > 0);
  if (anyId) {
    // Mỗi sheet cũ chỉ được bê MỘT lần: client gửi trùng id (vd nhân bản sheet trên màn hình) thì
    // sheet thứ hai coi như MỚI — không nhân đôi số hoá đơn / trạng thái khách duyệt sang sheet khác.
    const used = new Set<number>();
    return list.map((s: any) => {
      const id = Number(s?.id);
      if (!byId.has(id) || used.has(id)) return undefined;
      used.add(id);
      return byId.get(id);
    });
  }
  const sameShape = list.length === (existingSheets || []).length
    && list.every((s: any, i: number) => Number(s?.templateId) === Number(existingSheets[i]?.templateId));
  return sameShape ? list.map((_s: any, i: number) => existingSheets[i]) : list.map(() => undefined);
}

/**
 * Bảng "hanoi" ĐÃ GỬI DUYỆT / ĐÃ DUYỆT: lấy lại nguyên bản từ CSDL, BỎ QUA payload.
 *
 * `reconcileExtraApprovals` CỐ Ý không đụng "hanoi" (duyệt HN là luồng riêng ở MỨC BÁO GIÁ —
 * `hnStatus`), nên đường lưu chính không còn lớp nào canh phần này: `presentQuote` trả đủ bảng
 * "hanoi" cho người không-bị-lược-view, client round-trip lại, rồi `sanitizeExtraTables` ghi thẳng
 * quantity/unitPrice từ payload. Giá HN đã duyệt đổi được qua PUT /api/quotes/:id mà
 * hnStatus/hnReviewedAt không đổi và nhật ký `quote.update` chỉ ghi total+status → máy duyệt giá
 * Hà Nội thành vô hiệu.
 *
 * CHỈ chặn người KHÔNG có `quote:hn:manage` — người CÓ chính là người duyệt, họ sửa là hợp lệ (vai
 * trò mặc định admin/manager đều có; chạm tới nhánh chặn này là cấu hình quyền per-user). Và chỉ
 * khi phần HN đã chốt ("submitted"/"approved"); giai đoạn "assigned" chưa có gì để bảo vệ.
 *
 * Thay TẠI CHỖ để giữ nguyên THỨ TỰ bảng trên màn hình; bảng HN có trong CSDL mà payload bỏ sót
 * thì trả lại ở cuối — mất bảng cũng là mất dữ liệu. Mutate `sheets`, đối xứng với reconcileExtra*.
 *
 * Payload có NHIỀU bảng "hanoi" HƠN CSDL → 409, KHÔNG vứt im lặng. Hai ca có thật dẫn tới đây:
 * người dùng bấm "nhân bản trang" (client gửi trùng sheet id, `carrySheetState` trả undefined cho
 * bản thứ hai nên `db` rỗng) và người dùng THÊM một bảng HN mới khi phần HN đã chốt. Trước đây cả
 * hai đều nhận 200 + toast "Đã lưu" rồi tải lại thấy bảng biến mất — mất phần vừa gõ, không một lời
 * cảnh báo. Dữ liệu ĐANG CÓ trong CSDL không hề mất, nhưng im lặng là lựa chọn tệ nhất trong ba.
 * Chiều NGƯỢC LẠI (payload ÍT bảng hơn) KHÔNG chặn: client cũ không round-trip `extraTables` thì
 * `list` rỗng, và chặn nó sẽ làm mọi lần Lưu từ những client đó hỏng.
 */
function reconcileHanoiTables(sheets: any[], carry: (Record<string, any> | undefined)[], canManage: boolean, hnStatus: string | null | undefined) {
  if (canManage || !["submitted", "approved"].includes(hnStatus ?? "")) return;
  (sheets || []).forEach((s: any, i: number) => {
    const db = (Array.isArray(carry[i]?.extraTables) ? carry[i]!.extraTables : []).filter((t: any) => t && t.category === "hanoi");
    const list = Array.isArray(s?.extraTables) ? s.extraTables : [];
    const soTrongPayload = list.filter((t: any) => t && t.category === "hanoi").length;
    if (!db.length && !soTrongPayload) return;
    if (soTrongPayload > db.length) {
      throw httpError(409, "Phần giá Hà Nội đã chốt nên không thêm được bảng mới ở đây. Hãy chép lại phần vừa gõ, tải lại trang, rồi nhờ người phụ trách phần Hà Nội mở lại.");
    }
    const out: any[] = [];
    let k = 0;
    for (const t of list) {
      if (t && t.category === "hanoi") { if (k < db.length) out.push(db[k++]); }   // thay bằng bản CSDL
      else out.push(t);
    }
    while (k < db.length) out.push(db[k++]);
    s.extraTables = out;
  });
}

/**
 * Update a quote from a validated body. Recomputes totals server-side; a
 * price-affecting edit to a quote already in the approval pipeline reopens it to
 * draft (clears approval, bumps version, notifies creator). Returns the updated quote.
 */
export async function updateQuote(req: Request) {
  const id = Number(req.params.id);
  const userId = req.session.userId;
  if (userId === undefined) throw httpError(401, "Chưa đăng nhập");
  const b = req.body;

  const existing: any = await prisma.quote.findFirst({ where: { id }, include: QUOTE_INCLUDE as any });
  if (!existing) throw httpError(404, "Không tìm thấy báo giá");
  if (!canEdit(existing, req.session)) throw httpError(403, "Bạn không thể sửa báo giá này");

  // KHÓA LẠC QUAN (chống MẤT DỮ LIỆU): nếu client gửi mốc updatedAt đã tải mà DB đã thay đổi
  // (người khác lưu xen vào giữa lúc đang mở editor) → 409, KHÔNG ghi đè im lặng. Client cũ
  // không gửi baseUpdatedAt → bỏ qua (tương thích ngược, không tệ hơn trước).
  if (b.baseUpdatedAt && existing.updatedAt &&
      new Date(b.baseUpdatedAt).getTime() !== new Date(existing.updatedAt).getTime()) {
    throw httpError(409, "Báo giá vừa được người khác cập nhật. Vui lòng tải lại để không ghi đè thay đổi của họ.");
  }

  // Kiểm khoá lạc quan LẦN NỮA, ở TRONG transaction ghi. Lần kiểm phía trên chạy NGOÀI transaction
  // nên hai người bấm Lưu chồng nhau vẫn lọt qua CẢ HAI (cùng đọc một mốc) rồi người ghi sau đè im
  // lặng — UPDATE không hề kèm điều kiện mốc. `UPDATE … WHERE updatedAt = <mốc>` vừa KIỂM vừa KHOÁ
  // hàng Quote: bên đến sau phải xếp hàng, tới lượt thì mốc đã đổi → 0 dòng → 409.
  // ĐẶT SAU khi đã lấy khoá QuoteSheet (không phải đầu transaction) là CỐ Ý: giữ đúng thứ tự lấy
  // khoá QuoteSheet → Quote như các đường ghi khác (markExtraTableRowPayment, saveHn) để không đẻ
  // ra deadlock. Rollback dọn hết phần đã làm trước đó nên không để lại dấu vết.
  //
  // Dùng `$executeRaw` chứ KHÔNG dùng `tx.quote.updateMany`: extension realtime ở src/db.ts coi
  // `updateMany` là WRITE nên mỗi lần Lưu bắn HAI sự kiện SSE thay vì một — và tệ hơn, khi guard
  // ném 409 thì transaction ROLLBACK nhưng sự kiện SSE đã bắn rồi (emit nằm NGOÀI vòng đời
  // transaction), tức một lần Lưu THẤT BẠI vẫn bắt mọi client đang mở danh sách tải lại. Câu raw
  // không đi qua extension. Mốc mới do chính `tx.quote.update` phía sau bump (@updatedAt), nên ở
  // đây chỉ cần KHOÁ + KIỂM, không cần ghi giá trị mới.
  const mocClient = b.baseUpdatedAt ? new Date(b.baseUpdatedAt) : null;
  const chotKhoaLacQuan = async (tx: TxClient) => {
    if (!mocClient) return;   // client cũ không gửi mốc → bỏ qua, y như lần kiểm phía trên
    const n = await tx.$executeRaw`UPDATE "Quote" SET "updatedAt" = "updatedAt" WHERE id = ${id} AND "updatedAt" = ${mocClient}`;
    if (!n) throw httpError(409, "Báo giá vừa được người khác cập nhật. Vui lòng tải lại để không ghi đè thay đổi của họ.");
  };

  if (Array.isArray(b.sheets)) {
    const targetCompany = b.companyId ?? existing.companyId;
    if (!(await templatesBelongToCompany(b.sheets, targetCompany))) {
      throw httpError(400, "Có mẫu báo giá không thuộc công ty đã chọn (hoặc đã ngừng dùng)");
    }
  }

  const data: Record<string, any> = {};
  for (const f of ["title", "toCompany", "fromContact", "fromAddress", "city", "greeting"]) {
    if (b[f] !== undefined && b[f] !== null) data[f] = b[f];
  }
  for (const f of ["toContact", "toEmail", "toPhone", "toAddress", "fromPhone", "fromTitle", "notes"]) {
    if (b[f] !== undefined) data[f] = b[f] || null;
  }
  if (b.quoteDate) data.quoteDate = b.quoteDate;
  if (b.executionDate !== undefined) data.executionDate = b.executionDate || null;
  if (b.customerId !== undefined) data.customerId = b.customerId ?? null;
  if (b.vatPercent !== undefined) data.vatPercent = D(b.vatPercent);
  if (b.discount !== undefined) data.discount = D(b.discount);
  if (b.showTotals !== undefined) data.showTotals = b.showTotals;
  if (b.companyId !== undefined) data.companyId = b.companyId;
  if (b.customerLogo !== undefined) data.customerLogo = b.customerLogo || null;
  if (b.quoteNumber !== undefined && b.quoteNumber !== existing.quoteNumber) {
    const dup = await prisma.quote.findFirst({ where: { quoteNumber: b.quoteNumber }, includeDeleted: true } as any);
    if (dup) {
      throw httpError(409, dup.deletedAt ? "Số báo giá đã dùng (thuộc báo giá đã xoá)" : "Số báo giá đã tồn tại");
    }
    data.quoteNumber = b.quoteNumber;
    // ĐỔI số cũng làm lệch bộ đếm y như lúc tạo: số mới có thể nằm CAO hơn vùng đã cấp, và lần
    // cấp tự động kế tiếp sẽ đâm vào nó. Prefix lấy theo công ty SẼ ghi (payload có thể đổi công ty).
    const cty = await prisma.company.findFirst({ where: { id: data.companyId ?? existing.companyId }, select: { quotePrefix: true } });
    await syncQuoteCounter(b.quoteNumber, cty?.quotePrefix || "GN");
  }

  // Price-affecting edit on a quote already in the pipeline -> reopen to draft.
  const priceAffecting = Array.isArray(b.sheets) || data.vatPercent !== undefined || data.discount !== undefined;
  if (priceAffecting) data.currentVersion = (existing.currentVersion ?? 1) + 1;
  const wasLocked = ["pending", "approved", "sent"].includes(existing.status);
  const reopened = wasLocked && priceAffecting;
  if (reopened) {
    data.status = "draft";
    data.approvedById = null;
  }

  // Cập nhật searchText: field có trong payload thì dùng nó (KỂ CẢ null = xóa, vd toContact), không thì
  // giữ cũ. Dùng `k in data` thay `?? existing` để xóa-rỗng phản ánh đúng vào index (không stale).
  const pick = (k: string, old: any) => (k in data ? (data as any)[k] : old);
  data.searchText = normalizeSearch(
    pick("quoteNumber", existing.quoteNumber), existing.projectCode,
    pick("title", existing.title), pick("toCompany", existing.toCompany), pick("toContact", existing.toContact)
  );

  let updated;
  if (Array.isArray(b.sheets)) {
    // Tiền KHÔNG phụ thuộc extraTables (computeQuoteTotals chỉ đọc `sh.items` — src/money.ts:54),
    // nên tính tổng ở NGOÀI transaction là an toàn và giữ transaction ngắn nhất có thể.
    const vatPct = data.vatPercent ?? existing.vatPercent;
    const t = computeQuoteTotals({ vatPercent: vatPct, discount: data.discount ?? existing.discount, sheets: b.sheets });
    assertTotalsStorable(t, b.sheets);
    data.subtotal = t.subtotal;
    data.vat = t.vat;
    data.discount = t.discount;
    data.total = t.total;
    updated = await prisma.$transaction(async (tx) => {
      // KHOÁ RỒI MỚI ĐỌC, TẤT CẢ TRONG TRANSACTION — y hệt saveHn (src/hnWorkflow.ts:112).
      //
      // Vì sao KHÔNG dùng được `existing.sheets` (đọc ở đầu hàm, NGOÀI transaction): có BA đường ghi
      // QuoteSheet KHÔNG hề chạm Quote — customerDecision (custStatus…), signSheet (signedAt…),
      // updateSheetInvoice (invoiceNo/paidAt/poNumber…). Đúng những field nằm trong
      // SHEET_CARRY_FIELDS. Kế toán ghi số hoá đơn xen vào giữa lúc sale đang Lưu thì
      // `Quote.updatedAt` KHÔNG đổi → khoá lạc quan không thấy gì → `carry` dựng từ ảnh chụp cũ →
      // sheet tạo lại MẤT số hoá đơn, ngày thanh toán và chữ ký, im lặng, vẫn trả 200. Đọc lại SAU
      // khi đã giữ khoá thì thấy bản TƯƠI, và người kia không chen vào được nữa cho tới lúc commit.
      //
      // `ORDER BY id` để mọi đường ghi lấy khoá CÙNG THỨ TỰ: `deleteMany` khoá theo thứ tự quét vật
      // lý (không xác định), nên thiếu câu này thì nó và saveHn có thể lấy khoá ngược chiều nhau
      // trên cùng báo giá → deadlock 40P01 → Prisma P2034.
      await tx.$queryRaw`SELECT id FROM "QuoteSheet" WHERE "quoteId" = ${id} ORDER BY id FOR UPDATE`;
      const sheetsTuoi: any[] = await tx.quoteSheet.findMany({ where: { quoteId: id }, orderBy: { id: "asc" } });

      // CHỈ người có quyền DUYỆT NỘI BỘ được đổi trạng thái duyệt hàng (HCM/Khách); còn lại giữ nguyên theo DB.
      reconcileExtraApprovals(b.sheets, sheetsTuoi, can(req.session, P.QUOTE_INTERNAL_APPROVE), userId);
      reconcileExtraPayments(b.sheets, sheetsTuoi, can(req.session, P.QUOTE_INTERNAL_PAY), userId);
      // Lưu = XOÁ sheet rồi TẠO LẠI → phải BÊ trạng thái mức sheet sang bản mới (khách duyệt sheet,
      // chữ ký, số hoá đơn/thanh toán…), nếu không mỗi lần bấm Lưu là mất sạch.
      const carry = carrySheetState(b.sheets, sheetsTuoi);
      // Giá HN đã chốt: lấy lại từ CSDL trước khi ghi (xem reconcileHanoiTables).
      reconcileHanoiTables(b.sheets, carry, can(req.session, P.QUOTE_HN_MANAGE), existing.hnStatus);

      await tx.quoteSheet.deleteMany({ where: { quoteId: id } });
      await chotKhoaLacQuan(tx);
      const u = await tx.quote.update({
        where: { id },
        data: { ...data, sheets: { create: buildSheetsCreate(b.sheets, t.sheetTotals, carry) } },
        include: QUOTE_INCLUDE as any,
      });
      await snapshotQuoteVersion(tx, id, userId, "update");
      return u;
    });
  } else {
    if (data.vatPercent !== undefined || data.discount !== undefined) {
      const t = computeQuoteTotals({ vatPercent: data.vatPercent ?? existing.vatPercent, discount: data.discount ?? existing.discount, sheets: existing.sheets });
      assertTotalsStorable(t, existing.sheets);
      data.subtotal = t.subtotal;
      data.vat = t.vat;
      data.discount = t.discount;
      data.total = t.total;
    }
    updated = await prisma.$transaction(async (tx) => {
      await chotKhoaLacQuan(tx);
      const u = await tx.quote.update({ where: { id }, data, include: QUOTE_INCLUDE as any });
      await snapshotQuoteVersion(tx, id, userId, "update");
      return u;
    });
  }

  await audit(req, "quote.update", {
    resource: "quote",
    resourceId: id,
    before: { total: Number(existing.total), status: existing.status },
    after: { total: Number(updated.total), status: updated.status, reopened },
  });
  if (reopened) {
    await audit(req, "quote.reopened", { resource: "quote", resourceId: id });
    await notify(existing.createdById, {
      title: `Báo giá ${updated.quoteNumber} cần duyệt lại`,
      body: "Báo giá đã được chỉnh sửa nên quay về trạng thái Nháp, cần trình duyệt lại.",
      link: `/#/quotes/${id}`,
      resource: "quote",
      resourceId: id,
      important: true,
    }).catch(() => {});
  }
  return updated;
}

// Luồng DUYỆT NỘI BỘ (submitQuote/approveQuote/rejectQuote) ĐÃ BỎ 2026-06-22.
// Vòng đời mới: draft → converted ("Khách chốt") / lost ("Khách không chốt") — xem routes
// /:id/mark-converted, /:id/mark-lost. "Duyệt" thật = quyết định của khách.

// ============================================================================
//  READ / LIST / lookup endpoints (DI CHUYỂN từ quotes.routes.ts — hành vi y hệt)
// ============================================================================

/**
 * LIST báo giá theo phạm vi (admin=all, manager=own, employee=member) + filter của user.
 * Trả về { rows, total, page, size } — route map qua presentQuoteRow + dựng meta.
 */
export async function listQuotes(req: Request) {
  // validate(ListQuerySchema) đã coerce: q/status/from/to/sort/order là chuỗi/Date,
  // companyId/page/size là number (có default page=1/size=DEFAULT). TS chỉ thấy ParsedQs
  // string → đọc lại với coercion tương đương runtime (Number của number = chính nó).
  const qy = req.query as Record<string, any>;
  const q: string | undefined = qy.q;
  const status: string | undefined = qy.status;
  const companyId = qy.companyId !== undefined ? Number(qy.companyId) : undefined;
  const from = qy.from;
  const to = qy.to;
  const page = Number(qy.page) || 1;
  const size = Number(qy.size) || config.DEFAULT_PAGE_SIZE;
  const sort = String(qy.sort);
  const order = qy.order;
  // Visibility scope (read:all = mọi báo giá, read:own = tự tạo/được thêm thành viên) kết hợp
  // với bộ lọc của user bằng AND để OR-phạm-vi không đụng OR-tìm-kiếm.
  // 🔒 CỔNG QUYỀN TRƯỚC PHẠM VI: không có quote:read:* nào → 403 (KHÔNG rơi xuống phạm vi own).
  // Nếu không, người bị gỡ sạch quyền báo giá vẫn thấy các báo giá mình tạo/được thêm thành viên.
  const filters: Prisma.QuoteWhereInput[] = [quoteScopeWhereOrThrow(req.session) as Prisma.QuoteWhereInput];
  if (status) filters.push({ status: status as Prisma.QuoteWhereInput["status"] });
  if (companyId) filters.push({ companyId });
  if (from || to) {
    const range: Record<string, any> = {};
    if (from) range.gte = from;
    if (to) range.lte = to;
    filters.push({ quoteDate: range });
  }
  // Tìm KHÔNG dấu / sai dấu trên cột searchText chuẩn-hóa (quoteNumber+projectCode+title+toCompany+toContact).
  if (q) filters.push({ searchText: searchTextFilter(String(q)) });
  const where = { AND: filters };
  // account_hn / xem-nội-bộ: cần BẢNG NỘI BỘ của từng sheet để tính SỐ SHEET HN + TỔNG HN (hoặc
  // số hàng nội bộ). Nhưng KHÔNG nạp qua `select` của Prisma: `extraTables` chứa cả `paidProof` —
  // ảnh chứng từ base64 hàng trăm KB mỗi cái — mà presentQuoteRow không hề đọc tới. Một trang danh
  // sách 12 báo giá đo được 7,2 MB base64 kéo về rồi vứt. Xem `bangNoiBoTheoBaoGia` bên dưới.
  const canBangNoiBo = can(req.session, P.QUOTE_HN_FILL) || can(req.session, P.QUOTE_INTERNAL_VIEW);
  const [total, rows] = await Promise.all([
    prisma.quote.count({ where }),
    prisma.quote.findMany({
      where,
      orderBy: { [sort]: order },
      select: QUOTE_LIST_SELECT,   // slim projection — không sheets, không customerLogo
      skip: (page - 1) * size,
      take: size,
    }),
  ]);
  if (canBangNoiBo && rows.length) {
    const theoBaoGia = await bangNoiBoTheoBaoGia(rows.map((r: any) => r.id));
    // Gắn vào ĐÚNG hình dạng mà presentQuoteRow vẫn đọc (`q.sheets[].extraTables`): cả hai nhánh
    // của nó đều flatMap qua MỌI sheet rồi mới đếm/cộng, nên gộp về một phần tử không đổi kết quả.
    for (const r of rows as any[]) r.sheets = [{ extraTables: theoBaoGia.get(r.id) ?? [] }];
  }
  return { rows, total, page, size };
}

/**
 * Bảng nội bộ của một trang danh sách, ĐÃ CẮT `paidProof` NGAY TẠI SQL.
 *
 * Vì sao phải cắt ở tầng SQL chứ không lọc sau khi nạp: lọc ở JS thì base64 đã đi qua dây và đã
 * nằm trong heap rồi — đúng chi phí cần bỏ. Ảnh vẫn sống trong CSDL và vẫn tải được on-demand qua
 * GET /:id/extra/:sheetId/:rid/proof, y như trước.
 *
 * Phép tính TIỀN/ĐẾM vẫn do `extraTableSum`/`presentQuoteRow` ở JS làm, KHÔNG dịch sang SQL: quy
 * tắc ở đó (làm tròn từng dòng, cờ `quantityExact`, `days`, chỉ cộng hàng đã duyệt với hcm/khách)
 * là quy tắc TIỀN — dựng lại nó bằng SQL là mở đường cho hai nguồn số lệch nhau.
 *
 * `extraTables` là cột Json TỰ DO (đường ghi ở hnWorkflow và lúc nhân bản không qua
 * sanitizeExtraTables), nên phải phòng cả ca không phải mảng: CASE ở ngoài chặn `jsonb_array_elements`
 * ném lỗi trên object/chuỗi, và bảng có `items` không phải mảng thì để nguyên.
 */
async function bangNoiBoTheoBaoGia(ids: number[]) {
  const rows = await prisma.$queryRaw<{ quoteId: number; tables: any }[]>`
    SELECT s."quoteId" AS "quoteId", jsonb_agg(x.t ORDER BY s."order", s.id) AS "tables"
      FROM "QuoteSheet" s
      CROSS JOIN LATERAL (
        SELECT CASE WHEN jsonb_typeof(t->'items') = 'array'
                    THEN jsonb_set(t, '{items}', (SELECT coalesce(jsonb_agg(
                                                           -- Phep tru jsonb-text NEM LOI 22023 "cannot delete from
                                                           -- scalar" khi phan tu KHONG phai object/array. CASE ben
                                                           -- ngoai chi phong extraTables khong phai mang va items
                                                           -- khong phai mang - KHONG phong PHAN TU vo huong ben trong
                                                           -- items (null, chuoi, so). Cot nay la jsonb tu do, da qua
                                                           -- nhieu doi ma ghi, nen phan tu di dang la chuyen co that.
                                                           -- Duong JS cu chiu duoc hoan toan, nen chuyen sang SQL ma
                                                           -- thieu lop nay la lam HONG CA TRANG DANH SACH bao gia vi
                                                           -- mot hang du lieu cu. (Chu thich khong dau: khoi SQL nay
                                                           -- nam trong template literal, backtick se lam dut chuoi.)
                                                           CASE WHEN jsonb_typeof(it) = 'object' THEN it - 'paidProof' ELSE it END
                                                         ), '[]'::jsonb)
                                                    FROM jsonb_array_elements(t->'items') it))
                    ELSE t END AS t
          FROM jsonb_array_elements(CASE WHEN jsonb_typeof(s."extraTables") = 'array'
                                         THEN s."extraTables" ELSE '[]'::jsonb END) t
      ) x
     WHERE s."quoteId" = ANY(${ids})
     GROUP BY s."quoteId"`;
  return new Map<number, any[]>(rows.map((r) => [r.quoteId, Array.isArray(r.tables) ? r.tables : []]));
}

/** Xem trước SỐ báo giá KẾ TIẾP (không tiêu thụ counter). Prefix theo công ty đã chọn. */
export async function previewNextNumber(req: Request) {
  // Show what the NEXT number WOULD be without actually consuming it.
  // Prefix is per-company (GN…, CLF…) so the preview matches the chosen company.
  let prefix = "GN";
  if (req.query.companyId) {
    const company = await prisma.company.findFirst({ where: { id: Number(req.query.companyId) } });
    if (company) prefix = company.quotePrefix || "GN";
  }
  const year = new Date().getFullYear();
  const c = await prisma.quoteCounter.findUnique({
    where: { prefix_year: { prefix, year } },
  });
  const yy = String(year).slice(-2);
  const nn = String((c?.value ?? 0) + 1).padStart(3, "0");
  return { quoteNumber: `${prefix}${yy}${nn}`, prefix, note: "Số chính thức sẽ được cấp khi lưu" };
}

/** Người dùng active có thể thêm làm thành viên/người gửi của báo giá. Chỉ trả tên/vai trò. */
export async function listAssignableUsers(req: Request) {
  // Minimal fields for the member/sender picker only. Do NOT leak the login
  // identifier (username) or phone of every employee to all authenticated users.
  const users = await prisma.user.findMany({
    where: { active: true },
    select: { id: true, displayName: true, role: true, title: true, senderName: true },
    orderBy: { displayName: "asc" },
  });
  return { data: users };
}

/** Danh sách tài khoản Account Hà Nội (cho manager chọn khi GIAO phần HN). */
export async function listHnAccounts(req: Request) {
  if (!can(req.session, P.QUOTE_HN_MANAGE)) throw httpError(403, "Không có quyền");
  // Tài khoản điền HN = ai có quyền quote:hn:fill (role account_hn mặc định HOẶC cấp riêng per-user).
  const data = await prisma.user.findMany({ where: { active: true, OR: [{ role: "account_hn" }, { permissions: { has: P.QUOTE_HN_FILL } }] }, select: { id: true, displayName: true, username: true }, orderBy: { displayName: "asc" } });
  return { data };
}

/** GET ONE — báo giá đầy đủ (QUOTE_INCLUDE) + 403 nếu không được read. Route present. */
export async function getQuote(req: Request) {
  const id = Number(req.params.id);
  const quote = await prisma.quote.findFirst({ where: { id }, include: QUOTE_INCLUDE });
  if (!quote) throw httpError(404, "Không tìm thấy báo giá");
  if (!canOnQuote(req.session, "read", quote)) {
    throw httpError(403, "Bạn không có quyền xem báo giá này");
  }
  return quote;
}

// ============================================================================
//  Quản lý DỰ ÁN (báo giá đã chốt): danh sách projects + ký chứng từ + hoá đơn
// ============================================================================

/**
 * PROJECTS (admin) — báo giá ĐÃ DUYỆT cho trang "Quản lý dự án", kèm breakdown theo
 * từng sheet (tên + subtotal). ⚠️ GIỮ NGUYÊN take:2000 (chỉ DI CHUYỂN, không đổi).
 */
export async function listProjects(req: Request) {
  // CHỈ Admin (user:manage) → xem TẤT CẢ dự án đã duyệt. Mọi người khác — kể cả người có
  // canSign (vd Lan Anh) lẫn quản lý thường → CHỈ XEM dự án đã duyệt do CHÍNH MÌNH tạo.
  const seeAll = can(req.session, P.USER_MANAGE) || can(req.session, P.INVOICE_READ) || can(req.session, P.INVOICE_PAGE); // admin / người xem QLDA / KẾ TOÁN (trang Hóa đơn — cùng nguồn dữ liệu)
  // 🔒 Deny-by-default: không thuộc nhóm "xem hết" thì PHẢI có quote:read:own mới rơi xuống phạm vi
  // own. Trang này trả tên/mã KHÁCH HÀNG + tổng tiền + số hóa đơn — không được lọt cho tài khoản
  // đã bị gỡ sạch quyền báo giá nhưng còn là người tạo cũ.
  if (!seeAll && !can(req.session, P.QUOTE_READ_OWN)) throw httpError(403, "Bạn không có quyền xem danh sách dự án");
  const where: Record<string, any> = { status: "converted", deletedAt: null };
  if (!seeAll) where.createdById = req.session.userId;
  const quotes = await prisma.quote.findMany({
    where,
    orderBy: [{ quoteDate: "desc" }, { id: "desc" }],
    // Safety cap: this endpoint pulls every sheet+item into memory to compute
    // per-sheet subtotals. Bound it so a very large history can't blow up RAM
    // (newest 2000 approved projects; raise + paginate if ever needed).
    take: 2000,
    select: {
      id: true, quoteNumber: true, projectCode: true, projectVersion: true,
      title: true, status: true, hnStatus: true, quoteDate: true, executionDate: true, vatPercent: true,
      subtotal: true, total: true, discount: true,
      company: { select: { name: true, shortName: true } },
      customer: { select: { code: true, name: true, debtDays: true } },
      createdBy: { select: { displayName: true } },
      sheets: {
        orderBy: { order: "asc" },
        select: {
          id: true, order: true, name: true, subtotal: true, extraTables: true,
          signedAt: true, signedByName: true, invoiceNo: true, paidAt: true,
          poNumber: true, hnInvoiceNo: true, invoiceLink: true, docSentAt: true, docReturnedAt: true,
          invoiceDate: true, paymentMethod: true, orderClosedAt: true, invoiceYear: true, invoiceCompany: true, invoiceDesc: true, invoiceNote: true,
          template: { select: { company: { select: { shortName: true, name: true } } } },
        },
      },
    },
  });
  const data = quotes.map((q: any) => {
    // subtotal/sheet ĐÃ materialized (ghi lúc save) → KHÔNG kéo items + computeQuoteTotals nữa (perf).
    return {
      id: q.id,
      quoteNumber: q.quoteNumber,
      projectCode: q.projectCode,
      projectVersion: q.projectVersion,
      title: q.title,
      status: q.status,
      hnStatus: q.hnStatus || null,
      quoteDate: q.quoteDate,
      executionDate: q.executionDate,
      vatPercent: Number(q.vatPercent),
      subtotal: Number(q.subtotal),
      total: Number(q.total),
      company: q.company,
      customerCode: q.customer?.code ?? null,
      customerName: q.customer?.name ?? null,
      customerDebtDays: q.customer?.debtDays ?? null,   // hạn công nợ riêng của khách (trang Hóa đơn)
      createdBy: q.createdBy,
      sheets: q.sheets.map((sh: any) => {
        const ex = Array.isArray(sh.extraTables) ? sh.extraTables : [];
        const sumCat = (cat: string) => ex.filter((t: any) => t && t.category === cat).reduce((acc: number, t: any) => acc + extraTableSum(t), 0);
        return {
          id: sh.id,
          name: sh.name || null,
          subtotal: Number(sh.subtotal),
          hcm: sumCat("hcm"),
          hanoi: sumCat("hanoi"),
          khach: sumCat("khach"),
          cty: sh.template?.company?.shortName || sh.template?.company?.name || null,
          signedAt: sh.signedAt,
          signedByName: sh.signedByName,
          invoiceNo: sh.invoiceNo || null,
          paidAt: sh.paidAt || null,
          poNumber: sh.poNumber || null,
          hnInvoiceNo: sh.hnInvoiceNo || null,
          invoiceLink: sh.invoiceLink || null,
          docSentAt: sh.docSentAt || null,
          docReturnedAt: sh.docReturnedAt || null,
          // Trang Hóa đơn (kế toán nhập — QLDA chỉ tham chiếu)
          invoiceDate: sh.invoiceDate || null,
          paymentMethod: sh.paymentMethod || null,
          orderClosedAt: sh.orderClosedAt || null,
          invoiceYear: sh.invoiceYear ?? null,
          invoiceCompany: sh.invoiceCompany || null,
          invoiceDesc: sh.invoiceDesc || null,
          invoiceNote: sh.invoiceNote || null,
          // Trạng thái luồng hoá đơn: "Done" CHỈ khi có CẢ số HĐ + ngày TT; có số HĐ → "Thanh toán"; chưa → "Hoá đơn".
          invStatus: (sh.invoiceNo && sh.paidAt) ? "done" : (sh.invoiceNo ? "payment" : "invoice"),
        };
      }),
    };
  });
  return { data };
}

/**
 * KHÁCH DUYỆT / KHÔNG DUYỆT **MỘT SHEET** của báo giá nhiều sheet.
 *
 * Vì sao tách riêng khỏi `Quote.status`: khách hay chốt từng phần ("đồng ý phần Décor, phần Banner
 * để sau"). `status` vẫn là trạng thái CẢ báo giá (do người phụ trách bấm Chốt/Không chốt); cờ này
 * chỉ ghi Ý KIẾN KHÁCH theo từng sheet để theo dõi — KHÔNG tự đổi status, KHÔNG đụng tổng tiền.
 *
 * Quyền: đúng người được "gửi khách / chốt đơn" (quote:send) VÀ sửa được báo giá đó (chống IDOR).
 */
export async function setSheetCustomerDecision(req: Request) {
  if (!can(req.session, P.QUOTE_SEND)) throw httpError(403, "Bạn không có quyền ghi nhận ý kiến khách");
  const sheet = await prisma.quoteSheet.findUnique({
    where: { id: Number(req.params.sheetId) },
    select: {
      id: true, quoteId: true, name: true, order: true,
      quote: { select: { id: true, deletedAt: true, createdById: true, members: { select: { id: true } } } },
    },
  });
  if (!sheet || sheet.quote?.deletedAt) throw httpError(404, "Không tìm thấy sheet");
  if (!canOnQuote(req.session, "update", sheet.quote)) throw httpError(403, "Bạn không có quyền với báo giá này");

  // "" / null = gỡ đánh dấu (quay lại "chưa có ý kiến").
  const raw = req.body?.status;
  const status = raw === "approved" || raw === "rejected" ? raw : null;
  const note = typeof req.body?.note === "string" ? req.body.note.trim().slice(0, 1000) : null;
  const updated = await prisma.quoteSheet.update({
    where: { id: sheet.id },
    data: status
      ? { custStatus: status, custStatusAt: new Date(), custStatusById: req.session.userId, custNote: note || null }
      : { custStatus: null, custStatusAt: null, custStatusById: null, custNote: null },
    select: { id: true, custStatus: true, custStatusAt: true, custNote: true, custStatusBy: { select: { id: true, displayName: true } } },
  });
  await audit(req, "quote.sheet.customerDecision", {
    resource: "quote", resourceId: sheet.quoteId,
    after: { sheetId: sheet.id, sheet: sheet.name || `Sheet ${sheet.order}`, status: status || "cleared", note: note || undefined },
  });
  return updated;
}

/**
 * SIGN documents for ONE sheet (Ký Chứng từ). Admin ký MỌI dự án; người có canSign (vd Lan Anh)
 * chỉ ký dự án DO MÌNH TẠO. Chỉ quản lý nội bộ; không ảnh hưởng Excel/tổng.
 */
export async function signSheet(req: Request) {
  const me = await prisma.user.findUnique({ where: { id: req.session.userId }, select: { displayName: true } });
  // Quyền KÝ giờ là quote:sign:all (mọi dự án) / quote:sign:own (chỉ dự án mình tạo). Cờ canSign cũ đã
  // được bắc cầu thành quote:sign:own ở middleware → tương thích ngược.
  const signAll = can(req.session, P.QUOTE_SIGN_ALL);
  const signOwn = can(req.session, P.QUOTE_SIGN_OWN);
  if (!signAll && !signOwn) {
    throw httpError(403, "Bạn không có quyền ký chứng từ");
  }
  const sheet = await prisma.quoteSheet.findUnique({
    where: { id: Number(req.params.sheetId) },
    select: { id: true, quoteId: true, quote: { select: { status: true, deletedAt: true, createdById: true } } },
  });
  if (!sheet) throw httpError(404, "Không tìm thấy sheet");
  // CHỐNG IDOR: chỉ cho ký sheet của báo giá ĐÃ DUYỆT & chưa xoá (trang Quản lý dự án chỉ
  // hiện dự án đã duyệt). Không cho ký theo sheetId tuỳ ý (id tuần tự → dễ dò).
  if (sheet.quote?.status !== "converted" || sheet.quote?.deletedAt) {
    throw httpError(403, "Chỉ ký được chứng từ của báo giá đã chốt");
  }
  // sign:all ký mọi dự án; sign:own CHỈ ký dự án DO MÌNH TẠO.
  if (!signAll && sheet.quote?.createdById !== req.session.userId) {
    throw httpError(403, "Bạn chỉ ký được chứng từ của dự án do mình tạo");
  }
  const signed = req.body.signed !== false;
  const updated = await prisma.quoteSheet.update({
    where: { id: sheet.id },
    data: signed
      ? { signedAt: new Date(), signedById: req.session.userId, signedByName: me?.displayName || null }
      : { signedAt: null, signedById: null, signedByName: null },
    select: { id: true, signedAt: true, signedByName: true },
  });
  await audit(req, signed ? "quote.sign" : "quote.unsign", { resource: "quote", resourceId: sheet.quoteId });
  return { id: updated.id, signedAt: updated.signedAt, signedByName: updated.signedByName };
}

// `quote:internal:*` là NĂNG LỰC ("được xem/tích thanh toán bảng nội bộ"), KHÔNG phải phạm vi dữ
// liệu: thiếu lớp này thì tài khoản chi phí chỉ cần đổi `:id` trên URL (id báo giá tuần tự) là đọc
// được ảnh uỷ nhiệm chi — và ghi được cờ paid — của MỌI báo giá, trong khi danh sách báo giá của
// chính họ vẫn bị `quoteScopeWhereOrThrow` giới hạn. CỐ Ý KHÔNG dùng `loadAuthorizedQuote`: hàm đó
// từ chối luôn caller có view bị lược (internal:view / hn:fill) — mà đó chính là người dùng HỢP LỆ
// của hai endpoint này, dùng nó sẽ khoá chết tính năng. Xem tests/rbacscope-extra-idor.test.js.
//
// VÌ SAO action "read" CHO CẢ ĐƯỜNG GHI `/pay` (lệch quy ước `canOnQuote(update)` của các đường ghi
// khác — hnWorkflow.ts, /customer-decision): ở đây `quote:internal:pay` MỚI là cổng GHI, còn hàm
// này chỉ trả lời "được đụng tới BÁO GIÁ NÀO". Siết lên "update" sẽ chặn đúng tài khoản chi phí —
// họ chỉ có `quote:read:own`, và tư cách thành viên KHÔNG suy ra `quote:update:*` vì `canOnQuote`
// kiểm quyền trước rồi mới xét thành viên. Đó là đổi CHÍNH SÁCH, không phải sửa lỗi; ca test
// "read:all + internal:pay, KHÔNG update → 200" khoá lựa chọn này lại để lần sau ai siết thì biết.
//
// BÁO GIÁ ĐÃ XOÁ MỀM → 404: `findFirst` đi qua extension soft-delete (src/db.ts) nên tự có
// `deletedAt: null`. CỐ Ý giữ vậy — `QuoteSheet` không soft-delete, nếu không chốt qua Quote thì
// sheet của báo giá trong thùng rác vẫn với tới được, trong khi `GET /api/quotes/:id` (lối vào duy
// nhất của hai endpoint này) đã 404 từ lâu.
async function assertQuoteInScope(req: Request, quoteId: number) {
  const quote = await prisma.quote.findFirst({ where: { id: quoteId }, include: { members: { select: { id: true } } } });
  if (!quote) throw httpError(404, "Không tìm thấy báo giá");
  if (!canOnQuote(req.session, "read", quote)) throw httpError(403, "Bạn không có quyền với báo giá này");
}

// THANH TOÁN 1 HÀNG bảng nội bộ (quyền quote:internal:pay) — tích/bỏ paid + ảnh chứng từ, KHÔNG cần lưu cả
// báo giá (tài khoản chi phí chỉ đụng được phần này). Khớp hàng theo `rid` (id ổn định).
export async function markExtraTableRowPayment(req: Request) {
  const quoteId = Number(req.params.id);
  const sheetId = Number(req.params.sheetId);
  const rid = String((req.params as any).rid);
  const paid = req.body.paid !== false;
  const proof = typeof req.body.paidProof === "string" ? req.body.paidProof : undefined;
  await assertQuoteInScope(req, quoteId);
  // TUẦN TỰ HÓA read-modify-write khối JSON extraTables: khóa HÀNG sheet (SELECT … FOR UPDATE) trong
  // 1 transaction để 2 request đánh dấu 2 HÀNG KHÁC NHAU của CÙNG sheet không cùng đọc 1 snapshot rồi
  // ghi đè mất bản ghi thanh toán (+ ảnh chứng từ) của nhau. Ngoài ra "chạm" báo giá cha để bump
  // updatedAt → khóa lạc quan của updateQuote phát hiện được thay đổi này (chống lost-update chéo).
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "QuoteSheet" WHERE id = ${sheetId} AND "quoteId" = ${quoteId} FOR UPDATE`;
    const sheet = await tx.quoteSheet.findFirst({ where: { id: sheetId, quoteId }, select: { id: true, extraTables: true } });
    if (!sheet) throw httpError(404, "Không tìm thấy sheet");
    const tables = (Array.isArray(sheet.extraTables) ? sheet.extraTables : []) as any[];
    let found = false;
    for (const t of tables) for (const it of (t?.items || [])) {
      if (it && it.rid === rid) {
        found = true;
        if (paid) {
          if (!it.paid) { it.paidAt = new Date().toISOString(); it.paidById = req.session.userId; }
          it.paid = true;
          if (proof !== undefined) it.paidProof = proof || null;   // gửi "" = xóa ảnh; bỏ qua = giữ ảnh cũ
        } else { it.paid = false; it.paidAt = null; it.paidById = null; it.paidProof = null; }
      }
    }
    if (!found) throw httpError(404, "Không tìm thấy dòng nội bộ");
    await tx.quoteSheet.update({ where: { id: sheetId }, data: { extraTables: tables } });
    await tx.quote.update({ where: { id: quoteId }, data: {} }); // bump Quote.updatedAt (khóa lạc quan)
  });
  await audit(req, paid ? "quote.internal.pay" : "quote.internal.unpay", { resource: "quote", resourceId: quoteId, after: { sheetId, rid, hasProof: proof !== undefined ? !!proof : undefined } });
  return { ok: true, rid, paid };
}

// Lấy ẢNH chứng từ 1 hàng nội bộ (on-demand) — quyền internal:view HOẶC internal:pay.
export async function getExtraTableRowProof(req: Request) {
  if (!can(req.session, P.QUOTE_INTERNAL_VIEW) && !can(req.session, P.QUOTE_INTERNAL_PAY)) throw httpError(403, "Không có quyền");
  await assertQuoteInScope(req, Number(req.params.id));
  const sheet = await prisma.quoteSheet.findFirst({ where: { id: Number(req.params.sheetId), quoteId: Number(req.params.id) }, select: { extraTables: true } });
  if (!sheet) throw httpError(404, "Không tìm thấy");
  const rid = String((req.params as any).rid);
  for (const t of (Array.isArray(sheet.extraTables) ? sheet.extraTables : []) as any[]) for (const it of (t?.items || [])) {
    if (it && it.rid === rid) {
      // GHI NHẬT KÝ đường ĐỌC: ảnh uỷ nhiệm chi là PII của bên thứ ba (tên + số tài khoản + số
      // tiền). `/pay` ngay trên đã ghi audit; nếu đường đọc không ghi thì không truy được ai đã
      // xem chứng từ của báo giá nào. CỐ Ý chỉ ghi ĐỊNH DANH (sheetId/rid + có ảnh hay không) —
      // chép cả `paidProof` vào AuditEvent là nhân bản chính cái PII đang muốn kiểm soát.
      await audit(req, "quote.internal.proof-view", {
        resource: "quote", resourceId: Number(req.params.id),
        after: { sheetId: Number(req.params.sheetId), rid, hasProof: !!it.paidProof },
      });
      return { paidProof: it.paidProof || null };
    }
  }
  throw httpError(404, "Không tìm thấy dòng");
}

/**
 * HOÁ ĐƠN / THANH TOÁN cho 1 sheet (Quản lý dự án). CHỈ ADMIN (quyền gác ở route).
 * Số HĐ → "Thanh toán"; ngày thanh toán → "Done". Chỉ trên báo giá ĐÃ CHỐT.
 */
export async function updateSheetInvoice(req: Request) {
  const sheet = await prisma.quoteSheet.findUnique({
    where: { id: Number(req.params.sheetId) },
    select: { id: true, quoteId: true, quote: { select: { status: true, deletedAt: true } } },
  });
  if (!sheet) throw httpError(404, "Không tìm thấy sheet");
  if (sheet.quote?.status !== "converted" || sheet.quote?.deletedAt) {
    throw httpError(403, "Chỉ nhập hoá đơn cho dự án đã chốt");
  }
  // PHÂN QUYỀN NGUYÊN TỬ: đánh dấu thanh toán (paidAt) cần invoice:pay; sửa field hóa đơn khác cần invoice:edit.
  // → cho phép "kế toán A chỉ đánh dấu thanh toán, kế toán B chỉ nhập số HĐ" v.v.
  const touchesPaid = req.body.paidAt !== undefined;
  const touchesEdit = ["invoiceNo", "poNumber", "hnInvoiceNo", "invoiceLink", "docSentAt", "docReturnedAt",
    "invoiceDate", "paymentMethod", "orderClosedAt", "invoiceYear", "invoiceCompany", "invoiceDesc", "invoiceNote"].some((k) => req.body[k] !== undefined);
  if (touchesPaid && !can(req.session, P.INVOICE_PAY)) throw httpError(403, "Bạn không có quyền đánh dấu thanh toán hóa đơn");
  if (touchesEdit && !can(req.session, P.INVOICE_EDIT)) throw httpError(403, "Bạn không có quyền sửa thông tin hóa đơn");
  const data: Record<string, any> = {};
  const setStr = (k: string) => { if (req.body[k] !== undefined) data[k] = req.body[k] ? String(req.body[k]).trim() : null; };
  const setDate = (k: string) => { if (req.body[k] !== undefined) data[k] = req.body[k] ? new Date(req.body[k]) : null; };
  setStr("invoiceNo"); setStr("poNumber"); setStr("hnInvoiceNo"); setStr("invoiceLink");
  setDate("paidAt"); setDate("docSentAt"); setDate("docReturnedAt");
  // Trang Hóa đơn (kế toán nhập)
  setStr("paymentMethod"); setStr("invoiceCompany"); setStr("invoiceDesc"); setStr("invoiceNote");
  setDate("invoiceDate"); setDate("orderClosedAt");
  if (req.body.invoiceYear !== undefined) data.invoiceYear = req.body.invoiceYear ? Number(req.body.invoiceYear) : null;
  const updated = await prisma.quoteSheet.update({
    where: { id: sheet.id }, data,
    select: { id: true, invoiceNo: true, paidAt: true },
  });
  await audit(req, "quote.invoice", { resource: "quote", resourceId: sheet.quoteId, after: { sheetId: sheet.id, ...data } });
  const invStatus = (updated.invoiceNo && updated.paidAt) ? "done" : (updated.invoiceNo ? "payment" : "invoice");
  return { id: updated.id, invoiceNo: updated.invoiceNo, paidAt: updated.paidAt, invStatus };
}

// ============================================================================
//  Chốt / Không chốt (terminal transitions) — quyền gác ở route (QUOTE_SEND)
// ============================================================================

/** Đánh dấu báo giá ĐÃ CHỐT (won) — terminal, immutable, feed KPI. Route present. */
export async function markConverted(req: Request) {
  const id = Number(req.params.id);
  const existing = await prisma.quote.findFirst({ where: { id }, include: { members: { select: { id: true } } } });
  if (!existing) throw httpError(404, "Không tìm thấy báo giá");
  if (!canOnQuote(req.session, "update", existing)) {
    throw httpError(403, "Không có quyền chốt báo giá này");
  }
  if (["converted", "lost"].includes(existing.status)) {
    throw httpError(400, "Báo giá đã chốt / không chốt rồi");
  }
  // Optimistic guard: only convert if not already terminal — prevents a race with
  // a concurrent mark-lost / edit from producing a wrong terminal transition.
  const upd = await prisma.quote.updateMany({
    where: { id, status: { notIn: ["converted", "lost"] } },
    data: { status: "converted", convertedAt: new Date() },
  });
  if (!upd.count) {
    throw httpError(409, "Báo giá vừa đổi trạng thái — vui lòng tải lại");
  }
  const quote = await prisma.quote.findFirst({ where: { id }, include: QUOTE_INCLUDE });
  if (!quote) throw httpError(404, "Không tìm thấy báo giá");
  await audit(req, "quote.convert", { resource: "quote", resourceId: id, before: { status: existing.status } });
  emitWebhook("quote.converted", { id, quoteNumber: quote.quoteNumber, total: Number(quote.total) }).catch(() => {});
  return quote;
}

/** MARK LOST — khách từ chối; ghi lý do cho báo cáo win/loss. Route present. */
export async function markLost(req: Request) {
  const id = Number(req.params.id);
  const existing = await prisma.quote.findFirst({ where: { id }, include: { members: { select: { id: true } } } });
  if (!existing) throw httpError(404, "Không tìm thấy báo giá");
  if (!canOnQuote(req.session, "update", existing)) {
    throw httpError(403, "Không có quyền cập nhật báo giá này");
  }
  if (existing.status === "converted") {
    throw httpError(400, "Báo giá đã chốt, không thể đánh dấu thua");
  }
  if (existing.status === "lost") {
    throw httpError(400, "Báo giá đã được đánh dấu thua");
  }
  // Optimistic guard: only flip if still NOT terminal — also stops a re-mark from
  // prepending the reason to notes twice under a race.
  const newNotes = req.body.reason
    ? `[Lý do không chốt] ${req.body.reason}\n${existing.notes || ""}`.slice(0, 4000)
    : existing.notes;
  const upd = await prisma.quote.updateMany({
    where: { id, status: { notIn: ["converted", "lost"] } },
    data: { status: "lost", notes: newNotes },
  });
  if (!upd.count) {
    throw httpError(409, "Báo giá vừa đổi trạng thái — vui lòng tải lại");
  }
  const quote = await prisma.quote.findFirst({ where: { id }, include: QUOTE_INCLUDE });
  await audit(req, "quote.lost", { resource: "quote", resourceId: id, before: { status: existing.status }, after: { reason: req.body.reason || null } });
  return quote;
}

// ============================================================================
//  VERSIONS / APPROVALS / MEMBERS / DELETE / DUPLICATE
// ============================================================================

/** Danh sách phiên bản của báo giá (đã 403/404 qua loadAuthorizedQuote). */
export async function listVersions(req: Request) {
  const id = Number(req.params.id);
  await loadAuthorizedQuote(req, "read");
  const versions = await prisma.quoteVersion.findMany({
    where: { quoteId: id },
    orderBy: { versionNo: "desc" },
    select: { id: true, versionNo: true, total: true, createdAt: true, createdById: true },
  });
  return {
    data: versions.map((v) => ({ ...v, id: v.id.toString(), total: Number(v.total) })),
  };
}

/** Lấy 1 phiên bản theo versionNo. */
export async function getVersion(req: Request) {
  await loadAuthorizedQuote(req, "read");
  const ver = await prisma.quoteVersion.findUnique({
    where: { quoteId_versionNo: { quoteId: Number(req.params.id), versionNo: Number(req.params.v) } },
  });
  if (!ver) throw httpError(404, "Không tìm thấy phiên bản");
  return { ...ver, id: ver.id.toString(), total: Number(ver.total) };
}

/** Diff 2 phiên bản (a→b). */
export async function diffVersionsService(req: Request) {
  await loadAuthorizedQuote(req, "read");
  const id = Number(req.params.id);
  const a = Number(req.params.a);
  const b = Number(req.params.b);
  const [va, vb] = await Promise.all([
    prisma.quoteVersion.findUnique({ where: { quoteId_versionNo: { quoteId: id, versionNo: a } } }),
    prisma.quoteVersion.findUnique({ where: { quoteId_versionNo: { quoteId: id, versionNo: b } } }),
  ]);
  if (!va || !vb) throw httpError(404, "Phiên bản không tồn tại");
  return { from: a, to: b, changes: diffVersions(va.payload, vb.payload) };
}

/** APPROVAL trail của báo giá. */
export async function listApprovals(req: Request) {
  await loadAuthorizedQuote(req, "read");
  const rows = await prisma.approval.findMany({
    where: { quoteId: Number(req.params.id) },
    orderBy: [{ versionNo: "asc" }, { level: "asc" }],
    include: { approver: { select: { id: true, username: true, displayName: true } } },
  });
  return { data: rows };
}

/**
 * MEMBERS — add/remove employees who may view & edit this quote.
 * Chỉ người tạo (hoặc admin) mới quản lý được danh sách thành viên.
 */
export async function updateMembers(req: Request) {
  const id = Number(req.params.id);
  const quote = await prisma.quote.findFirst({ where: { id } });
  if (!quote) throw httpError(404, "Không tìm thấy báo giá");
  if (quote.createdById !== req.session.userId && !can(req.session, P.QUOTE_UPDATE_ALL)) {
    throw httpError(403, "Chỉ người tạo hoặc Quản trị mới quản lý được thành viên");
  }
  // The creator is always kept as a member.
  const ids = [...new Set([quote.createdById, ...req.body.memberIds])];
  await prisma.quote.update({
    where: { id },
    data: { members: { set: ids.map((uid) => ({ id: uid })) } },
  });
  await audit(req, "quote.members.update", { resource: "quote", resourceId: id, after: { members: ids } });
  const updated = await prisma.quote.findFirst({
    where: { id },
    include: { members: { select: { id: true, username: true, displayName: true, role: true } } },
  });
  if (!updated) throw httpError(404, "Không tìm thấy báo giá");
  return { members: updated.members };
}

/** SOFT DELETE báo giá (db middleware). Won deal terminal — không ai xoá được. */
export async function deleteQuote(req: Request) {
  const id = Number(req.params.id);
  const existing = await prisma.quote.findFirst({ where: { id } });
  if (!existing) throw httpError(404, "Không tìm thấy báo giá");
  // A won deal is terminal — nobody (not even delete:all) may remove it.
  if (existing.status === "converted") {
    throw httpError(400, "Không thể xóa báo giá đã chốt");
  }
  const ownerDraftDelete =
    canOnQuote(req.session, "delete", existing) &&
    (existing.status === "draft" || existing.status === "rejected");
  if (!ownerDraftDelete && !can(req.session, P.QUOTE_DELETE_ALL)) {
    throw httpError(403, "Chỉ Quản trị hoặc người tạo (báo giá ở trạng thái Nháp/Bị từ chối) mới được xóa");
  }
  await prisma.quote.delete({ where: { id } }); // soft delete via middleware
  await audit(req, "quote.delete", { resource: "quote", resourceId: id, before: { status: existing.status } });
  return { ok: true };
}

/**
 * DUPLICATE báo giá. sameProject=true → bản mới CÙNG mã dự án (v2/v3…) gửi khách; ngược lại
 * → mã dự án mới theo người tạo. Cấp số + tạo + snapshot v1 trong 1 transaction, retry P2002.
 * Route present (presentQuote) kết quả.
 */
export async function duplicateQuote(req: Request) {
  const id = Number(req.params.id);
  const src: any = await prisma.quote.findFirst({ where: { id }, include: QUOTE_INCLUDE });
  if (!src) throw httpError(404, "Không tìm thấy báo giá");
  // Must be allowed to read the source AND to create quotes.
  if (!canOnQuote(req.session, "read", src)) {
    throw httpError(403, "Bạn không có quyền sao chép báo giá này");
  }
  if (!can(req.session, P.QUOTE_CREATE)) {
    throw httpError(403, "Không có quyền tạo báo giá");
  }

  const sameProject = req.body.sameProject === true;
  const t = computeQuoteTotals({ vatPercent: src.vatPercent, discount: src.discount, sheets: src.sheets });

  // Resolve title + project-code base. The version number is computed INSIDE the tx
  // (below) so a P2002 from the @@unique([projectCode, projectVersion]) constraint retries
  // onto the next free version instead of two concurrent "Bản mới" both landing on _v2.
  let newTitle = src.title + " (copy)";
  let sameProjectCode = null;
  let dupCreatorProjectCode: string | null = null;
  if (sameProject) {
    // Bản mới CÙNG mã dự án (v2, v3…) để gửi khách — giữ projectCode.
    sameProjectCode = src.projectCode || src.quoteNumber;
    newTitle = src.title; // giữ nguyên tiêu đề; phân biệt bằng nhãn v{n}
  } else {
    const dupCreator = await prisma.user.findUnique({ where: { id: req.session.userId }, select: { projectCode: true } });
    dupCreatorProjectCode = dupCreator?.projectCode || null;
  }

  const buildData = (quoteNumber: string, projectCode: string | null, projectVersion: number) => ({
    quoteNumber,
    projectCode,
    projectVersion,
    searchText: normalizeSearch(quoteNumber, projectCode, newTitle, src.toCompany, src.toContact),
    title: newTitle,
    toCompany: src.toCompany,
    toContact: src.toContact,
    companyId: src.companyId,
    fromContact: src.fromContact,
    fromPhone: src.fromPhone,
    fromTitle: src.fromTitle,
    fromAddress: src.fromAddress,
    city: src.city,
    quoteDate: new Date(),
    greeting: src.greeting,
    vatPercent: src.vatPercent,
    toEmail: src.toEmail,
    toPhone: src.toPhone,
    toAddress: src.toAddress,
    notes: src.notes,
    status: "draft",
    subtotal: t.subtotal,
    vat: t.vat,
    discount: t.discount,
    total: t.total,
    createdById: req.session.userId,
    members: { connect: [{ id: req.session.userId }] },
    sheets: {
      create: src.sheets.map((s: any, sIdx: number) => ({
        templateId: s.templateId,
        name: s.name,
        order: s.order != null ? s.order : sIdx + 1,
        groupSubtotal: s.groupSubtotal,
        showImages: !!s.showImages,
        subtotal: t.sheetTotals[sIdx]?.subtotal ?? D(0),   // materialized (= subtotal nguồn)
        items: {
          create: s.items.map((it: any, iIdx: number) => ({
            order: it.order != null ? it.order : iIdx + 1,
            productId: it.productId ?? null,   // keep the catalog link on copy
            kind: it.kind || "item",
            label: it.label,
            name: it.name,
            detail: it.detail,
            unit: it.unit,
            quantity: it.quantity,
            quantityExact: !!it.quantityExact,
            unitPrice: it.unitPrice,
            days: it.days,
            notes: it.notes,
            internalNote: it.internalNote,
            formulas: it.formulas ?? undefined,
            images: (Array.isArray(it.images) && it.images.length) ? it.images : undefined,
          })),
        },
        extraTables: s.extraTables ?? undefined,
      })),
    },
  });

  // Allocate the number (+ per-employee project code) and create + snapshot v1
  // INSIDE one transaction with a P2002 retry — mirrors the main create path so a
  // failed insert rolls the counter back (no burned numbers) and the copy always
  // gets an initial QuoteVersion snapshot.
  let created;
  const prefixNhanBan = src.company?.quotePrefix || "GN";
  // Số của LƯỢT VỪA HỎNG — cùng lý do như createQuote, xem khối catch bên dưới.
  const capSoNhanBan: { so: string | null } = { so: null };
  for (let attempt = 0; ; attempt++) {
    try {
      created = await prisma.$transaction(async (tx: any) => {
        const quoteNumber = await nextQuoteNumber(prefixNhanBan, tx);
        capSoNhanBan.so = quoteNumber;
        let projectCode, projectVersion;
        if (sameProject) {
          projectCode = sameProjectCode;
          // Tính version trong tx + includeDeleted → đơn điệu, không tái dùng số của bản
          // xóa-mềm; khi 2 request đua nhau, P2002 đẩy lần retry sang version kế tiếp.
          const agg = await tx.quote.aggregate({ where: { projectCode: sameProjectCode }, _max: { projectVersion: true }, includeDeleted: true });
          projectVersion = Math.max(src.projectVersion || 1, agg._max.projectVersion || 0) + 1;
        } else {
          projectCode = dupCreatorProjectCode ? await nextProjectCode(dupCreatorProjectCode, tx) : null;
          projectVersion = 1;
        }
        const c = await tx.quote.create({ data: buildData(quoteNumber, projectCode, projectVersion), include: QUOTE_INCLUDE });
        await snapshotQuoteVersion(tx, c.id, req.session.userId, "duplicate");
        return c;
      });
      break;
    } catch (e) {
      const code = e instanceof Prisma.PrismaClientKnownRequestError ? e.code : undefined;
      if (code === "P2002" && attempt < 3) {
        // CÙNG LỖI VỚI createQuote, và đường này bị BỎ SÓT ở lượt vá trước: transaction hỏng cuốn
        // theo cả lần tăng bộ đếm (chủ ý "không đốt số" của nextQuoteNumber), nên lượt thử lại sinh
        // LẠI ĐÚNG số vừa đụng — bốn lượt cùng một số rồi 409, tức vòng thử lại không có tác dụng
        // gì. Đẩy số đã bị chiếm vào bộ đếm NGOÀI transaction (GREATEST nên không lùi) để lượt sau
        // nhảy sang số kế tiếp.
        if (capSoNhanBan.so) await syncQuoteCounter(capSoNhanBan.so, prefixNhanBan).catch(() => {});
        continue;
      }
      if (code === "P2002") throw httpError(409, "Số báo giá bị trùng, vui lòng thử lại");
      throw e;
    }
  }
  await audit(req, "quote.duplicate", { resource: "quote", resourceId: created.id, after: { from: src.id, quoteNumber: created.quoteNumber } });
  return created;
}
