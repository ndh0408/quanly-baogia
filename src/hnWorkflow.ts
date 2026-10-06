// Luồng GIÁ HÀ NỘI (role account_hn) — TÁCH khỏi quoteService cho gọn.
// Quản lý GIAO account điền bảng nội bộ loại "hanoi"; account CHỈ thấy/sửa phần đó
// (presentQuoteForAccountHn lược hết phần khác) rồi GỬI DUYỆT; người có quyền duyệt DUYỆT/TRẢ.
// Tiền HN là NỘI BỘ — nằm trong extraTables nên KHÔNG bao giờ vào Excel.
//
// TỪ 2026-10-06 GỬI / DUYỆT / TRẢ / BỎ DUYỆT THEO TỪNG HÀNG (luật thuần: src/hnDuyetHang.ts). `Quote.hnStatus` chỉ còn
// là TÓM TẮT; hàng đã duyệt khoá với mọi người; hàng cũ (trước bản này) suy trạng thái từ cả phần lúc đọc. Thao tác
// trạng thái hàng ghi bằng SQL thô dưới khoá Quote: KHÔNG bump `Quote.updatedAt` (mốc khoá lạc quan của màn soạn —
// bấm Duyệt một hàng không được đá văng lần Lưu của người đang soạn; đường Lưu vẫn lấy lại trạng thái hàng từ CSDL)
// và không đổi `hnRev` (vân tay HN không tính trạng thái) — rồi tự phát SSE sau khi commit.
import type { Request } from "express";
import { prisma } from "./db.js";
import { notify } from "./notifications.js";
import { audit } from "./audit.js";
import { canOnQuote, can, laAccountPhu, quoteScopesFor, PERMISSIONS as P } from "./permissions.js";
import { QUOTE_INCLUDE, sanitizeHnTables, hnRevCua, dsMauBangNoiBo, bangNoiBoCoNgay } from "./quoteUtils.js";
import { reconcileExtraPayments } from "./services/quoteService.js";
import { emitChange } from "./sse.js";
import { reconcileTrangThaiHn, vatChatHoaHn, apThaoTacHangHn, tomTatHn, hangTienHn, type ThaoTacHangHn } from "./hnDuyetHang.js";
import { docKhoanChiTrongTx } from "./services/inputInvoiceService.js";
import { tachRidTrung, tapDaChi, hangDaChiBiMat, loiHangDaChi, chuanHoaRidTrung, hangVetThieuRid, loiVetThieuRid } from "./khoanChi.js";

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
  const quote = await prisma.$transaction(async (tx) => {
    // Đổi `hnStatus` mà hàng cũ còn suy trạng thái từ nó → VẬT CHẤT HOÁ trước (dưới khoá Quote): giao lại phần HN không
    // được "mở khoá" hàng đã duyệt như bản cả phần cũ (approved → assigned là mở cả phần). Hàng đã duyệt giữ nguyên.
    await tx.$queryRaw`SELECT id FROM "Quote" WHERE id = ${Number(id)} FOR UPDATE`;
    const tuoi = await tx.quote.findFirst({ where: { id: Number(id) }, select: { hnTables: true, hnStatus: true, hnReviewedAt: true, hnReviewerId: true, hnRejectNote: true } });
    const bang: any[] = Array.isArray(tuoi?.hnTables) ? (tuoi!.hnTables as any[]) : [];
    vatChatHoaHn(bang, tuoi);
    return tx.quote.update({
      where: { id: Number(id) },
      data: {
        hnAssigneeId: acc.id, hnStatus: tomTatHn(bang, true, "assigned"),
        ...(bang.length ? { hnTables: bang } : {}),
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
  });
  await notify(acc.id, { title: `Bạn được giao phần Hà Nội: ${quote.quoteNumber}`, body: `${quote.title} — mở để điền giá HN rồi gửi duyệt.`, link: `/#/quotes/${id}`, resource: "quote", resourceId: id, important: true });
  await audit(req, "quote.hn.assign", { resource: "quote", resourceId: id, accountId: acc.id });
  return quote;
}

/**
 * `hnAssigneeId` KHÔNG ĐỦ để ghi phần Hà Nội (RBAC-08, audit 2026-09-23): chủ báo giá gỡ account HN
 * khỏi danh sách thành viên thì GET /:id của họ đã 403, nhưng hnAssigneeId không đổi nên trước đây
 * họ vẫn lưu/gửi duyệt được. Đường ghi phải đòi đúng điều kiện của đường đọc: còn đọc được báo giá
 * (canOnQuote "read" — thành viên, hoặc có quote:read:all).
 */
function assertConLaThanhVien(req: Request, q: { createdById: number; members: { userId: number; scopes: string[] }[] }) {
  if (!canOnQuote(req.session, "read", q)) throw httpError(403, "Bạn không còn được giao báo giá này");
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
  const existing = await prisma.quote.findFirst({ where: { id }, select: { id: true, hnStatus: true, hnAssigneeId: true, updatedAt: true, createdById: true, companyId: true, members: { select: { userId: true, scopes: true } } } });
  if (!existing) throw httpError(404, "Không tìm thấy báo giá");
  if (!can(req.session, P.QUOTE_HN_FILL) || existing.hnAssigneeId !== req.session.userId) throw httpError(403, "Chỉ Account Hà Nội được giao mới điền được phần này");
  assertConLaThanhVien(req, existing);
  // Không còn chặn CẢ PHẦN khi "đã gửi / đã duyệt" (2026-10-06): khoá theo TỪNG HÀNG — hàng đã gửi / đã duyệt không
  // sửa / xoá được (reconcileTrangThaiHn, 409), hàng đang làm / bị trả và hàng MỚI thì vẫn làm tiếp được.
  // Tab chạy bundle CŨ gửi `hnSheets` (hình dạng theo trang, đã bỏ). Không được hiểu thành "xoá
  // hết bảng": nói thẳng để họ tải lại, và nhắc chép phần vừa gõ trước khi tải.
  if (!Array.isArray(req.body?.hnTables)) {
    throw httpError(400, "Trang đang chạy bản giao diện cũ. Hãy CHÉP LẠI phần vừa gõ, tải lại trang rồi nhập lại — bản cũ lưu sẽ làm mất phần Hà Nội.");
  }
  const payload = req.body.hnTables;
  const mocClient = req.body?.baseUpdatedAt ? new Date(req.body.baseUpdatedAt) : null;
  const revClient: string | null = typeof req.body?.baseHnRev === "string" ? req.body.baseHnRev.trim() : null;

  // CHỐT LẠI TRẠNG THÁI DO SERVER SỞ HỮU TRƯỚC KHI GHI.
  //
  // `sanitizeHnTables` persist NGUYÊN TRẠNG `approved*` và `paid*`/`paidProof` (nó chỉ chuẩn hoá
  // hình dạng, không phán quyền), mà account Hà Nội KHÔNG có `quote:internal:approve`. Không chốt lại
  // thì họ tự đóng dấu duyệt cho hàng của mình, tự tích "đã thanh toán", tự chọn ngày trả và tự trỏ
  // `paidById` sang người khác, đồng thời nhét thẳng chuỗi `paidProof` vào cột Json. Từ 2026-10-06 cờ
  // đã-chi cũ ĐÓNG BĂNG cho mọi người (kế toán ghi ở bảng InputInvoiceEntry — src/khoanChi.ts).
  const userId = req.session.userId!;
  const mienChotTien = can(req.session, P.INVOICE_INPUT_PAY);
  const dsMau = await dsMauBangNoiBo();   // luật cột Số Ngày theo mẫu — để so tiền hàng đã khoá đúng như máy tính tiền
  const coNgay = (t: Record<string, any>) => bangNoiBoCoNgay(t, existing.companyId, dsMau);

  await prisma.$transaction(async (tx) => {
    // KHOÁ RỒI MỚI ĐỌC. Cột jsonb vẫn là read-modify-write nguyên khối, nên bỏ khoá QuoteSheet mà
    // không lấy khoá Quote là đổi một lỗ mất dữ liệu lấy một lỗ khác.
    //
    // CHỈ khoá hàng Quote, và KHÔNG đụng QuoteSheet sau đó: mọi đường ghi khác lấy khoá theo thứ tự
    // QuoteSheet → Quote (updateQuote, ghiVungNoiBoDuocGiao), nên lấy ngược chiều là deadlock.
    // Dùng $queryRaw chứ không `tx.quote.updateMany`: extension realtime ở src/db.ts coi updateMany
    // là WRITE nên bắn thêm một sự kiện SSE, mà SSE đã bắn thì rollback không rút lại được.
    await tx.$queryRaw`SELECT id FROM "Quote" WHERE id = ${id} FOR UPDATE`;
    const tuoi = await tx.quote.findFirst({ where: { id }, select: { hnTables: true, hnStatus: true, hnAssigneeId: true, updatedAt: true, hnReviewedAt: true, hnReviewerId: true, hnRejectNote: true } });
    if (!tuoi) throw httpError(404, "Không tìm thấy báo giá");
    // Kiểm LẠI sau khi đã giữ khoá: giữa lần đọc đầu và đây, quản lý có thể vừa giao lại. (Duyệt chen giữa thì
    // reconcileTrangThaiHn bên dưới thấy trạng thái hàng TƯƠI — đọc sau khoá.)
    if (tuoi.hnAssigneeId !== userId) throw httpError(403, "Phần Hà Nội vừa được giao cho người khác");
    // ── 409 PHẢI DỰA TRÊN BẢNG HÀ NỘI, KHÔNG DỰA TRÊN `Quote.updatedAt` ────────────────────
    // `updatedAt` đổi khi CHỦ báo giá lưu BẤT CỨ thứ gì: đổi tên khách, sửa một dòng ở trang 3,
    // tích một ô thanh toán. Lấy nó làm mốc thì account HN gõ nửa tiếng, chủ bấm Lưu một cái là
    // họ ăn 409 — và màn của họ KHÔNG có bản nháp cục bộ như trình soạn báo giá, nên 409 ở đây
    // đồng nghĩa MẤT TRẮNG. Đúng kiểu hỏng mà đợt chuyển HN lên cấp báo giá sinh ra để diệt
    // (bản cũ nó đến từ `sheetId` đổi sau mỗi lần chủ lưu).
    //
    // `hnRev` chỉ đổi khi bảng HN đổi thật. Nó KHÔNG tính `paid*`/`approved*`/`paidProof`/`rid`
    // (xem quoteUtils.vanTayHn) — mấy trường đó do server sở hữu và đã được
    // reconcileExtraPayments/reconcileTrangThaiHn giữ nguyên bên dưới, nên người khác tích thanh
    // toán KHÔNG được phép hất phần người này đang gõ.
    //
    // Tab mở TRƯỚC lần deploy này chỉ gửi `baseUpdatedAt`; vẫn tôn trọng nó để họ không mất việc,
    // nhưng chỉ khi không có `baseHnRev`.
    if (revClient) {
      if (revClient !== hnRevCua(tuoi.hnTables)) {
        throw httpError(409, "Bảng Hà Nội vừa được sửa ở nơi khác. Hãy chép lại phần vừa gõ, tải lại trang rồi nhập lại — đừng đóng tab trước khi chép.");
      }
    } else if (mocClient && tuoi.updatedAt && new Date(tuoi.updatedAt).getTime() !== mocClient.getTime()) {
      throw httpError(409, "Báo giá vừa được cập nhật ở nơi khác. Hãy chép lại phần vừa gõ, tải lại trang rồi nhập lại — đừng đóng tab trước khi chép.");
    }

    // Hai hàm reconcile nhận mảng "sheet" có `.extraTables`; bọc một phần tử là dùng lại được
    // nguyên vẹn, không phải đẻ bản sao thứ hai của luật (chúng không hề đọc sheet.id).
    //
    // Khoản kế toán đọc SAU khi đã khoá Quote (KT-5): kế toán tích dưới Quote FOR SHARE nên không chen giữa được.
    const khoan = await docKhoanChiTrongTx(tx, id);
    const hnDb = Array.isArray(tuoi.hnTables) ? tuoi.hnTables : [];
    // rid trùng CÓ SẴN trong CSDL → ghép theo thứ tự với payload trước reconcile; hàng đã trả (cũ) thiếu rid → từ chối
    // (src/khoanChi.ts chuanHoaRidTrung / hangVetThieuRid).
    chuanHoaRidTrung("hn", hnDb, payload);
    const thieuMa = hangVetThieuRid("hn", hnDb);
    if (thieuMa.length) throw loiVetThieuRid(thieuMa);
    tachRidTrung("hn", payload);                       // KT-6 — trước reconcile, khớp luật "kế thừa một lần"
    const daChi = tapDaChi("hn", hnDb, khoan);
    const boc = [{ extraTables: payload }];
    const bocDb = [{ extraTables: hnDb }];
    reconcileExtraPayments(boc, bocDb, { daChi, mienChotTien });
    // KT-4: hàng ĐÃ CHI không được biến mất qua đường Lưu (400 nêu tên hàng — màn account HN chỉ toast, giữ phần gõ).
    // Báo trước chốt duyệt bên dưới (cùng thứ tự với đường Lưu báo giá).
    const mat = hangDaChiBiMat("hn", hnDb, payload, daChi);
    if (mat.length) throw loiHangDaChi(mat);
    // Trạng thái duyệt từng hàng do server sở hữu: lấy lại theo rid; hàng đã gửi / đã duyệt mà bị sửa / xoá → 409.
    reconcileTrangThaiHn(boc[0].extraTables, hnDb, tuoi, { khoaChoDuyet: true, coNgayDb: coNgay });

    const moi = sanitizeHnTables(boc[0].extraTables);
    // `hnStatus` = TÓM TẮT các hàng (mọi hàng vừa mang trạng thái riêng). Hàng bị trả vẫn "bị trả" tới khi gửi lại.
    const tomTat = tomTatHn(moi, true, "assigned");
    await tx.quote.update({
      where: { id },
      data: {
        hnTables: moi as any,
        hnStatus: tomTat,
        ...(tomTat !== "rejected" ? { hnRejectNote: null } : {}),
      },
    });
  });
  // Mất bảng phải có dấu vết: từ bản này account HN tự thêm/xoá bảng của chính họ.
  await audit(req, "quote.hn.save", { resource: "quote", resourceId: id, after: { soBang: payload.length } });
  return prisma.quote.findFirst({ where: { id }, include: QUOTE_INCLUDE });
}

/** `rids` client gửi (tuỳ chọn): mảng chuỗi rid, tối đa 2000, bỏ rỗng / trùng. Vắng hoặc rỗng = thao tác hàng loạt. */
function docRids(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const ds = [...new Set(v.filter((x) => typeof x === "string").map((x) => x.trim()).filter((x) => x && x.length <= 64))].slice(0, 2000);
  return ds.length ? ds : null;
}

const nhanHang = (ds: string[]) => ds.slice(0, 4).map((t) => `"${String(t).slice(0, 60)}"`).join(", ") + (ds.length > 4 ? ` và ${ds.length - 4} hàng khác` : "");

/**
 * ĐỔI TRẠNG THÁI HÀNG dưới khoá Quote — lõi chung của gửi / duyệt / trả / bỏ duyệt.
 *
 * Khoá CHỈ hàng Quote (cùng thứ tự với saveHn; mọi đường khác lấy QuoteSheet → Quote nên không ngược chiều). Đọc bảng
 * TƯƠI sau khoá, vật chất hoá trạng thái hàng cũ (hnStatus sắp đổi), áp thao tác, ghi bằng SQL THÔ: không bump
 * `updatedAt`, không qua extension realtime (SSE phát SAU commit, rollback không rút lại được). `kiem` chạy trên bản
 * tươi để kiểm lại điều kiện phụ thuộc trạng thái (vd phần HN vừa được giao cho người khác).
 *
 * Phần CHƯA CÓ hàng nào (dữ liệu cũ, hoặc chỉ toàn dòng nhóm): không có gì để đổi theo hàng → `rong` quyết trạng thái
 * cả phần như luồng cũ (giữ tương thích cho báo giá cũ gửi duyệt khi bảng còn trống).
 */
async function doiTrangThaiHang(id: number, p: {
  loai: ThaoTacHangHn; rids: string[] | null; nguoi: number; lyDo?: string | null;
  kiem?: (tuoi: { hnStatus: string | null; hnAssigneeId: number | null }) => void;
  /** Trạng thái cả phần mới khi phần không có hàng nào (hoặc ném lỗi). */
  rong: (hnStatus: string | null) => string;
  /** Câu báo khi có hàng nhưng không hàng nào hợp lệ cho thao tác. */
  khongCoHang: string;
  them: { hnSubmittedAt?: boolean; hnReviewed?: boolean; hnRejectNote?: string | null };
}) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Quote" WHERE id = ${id} FOR UPDATE`;
    const tuoi = await tx.quote.findFirst({ where: { id }, select: { hnTables: true, hnStatus: true, hnAssigneeId: true, hnReviewedAt: true, hnReviewerId: true, hnRejectNote: true } });
    if (!tuoi) throw httpError(404, "Không tìm thấy báo giá");
    p.kiem?.(tuoi);
    const bang: any[] = Array.isArray(tuoi.hnTables) ? (tuoi.hnTables as any[]) : [];
    const coHang = [...hangTienHn(bang)].length > 0;
    let ten: string[] = [];
    let hnStatus: string | null;
    if (!coHang) {
      hnStatus = p.rong(tuoi.hnStatus);
    } else {
      vatChatHoaHn(bang, tuoi);
      const kq = apThaoTacHangHn(bang, p.loai, { rids: p.rids, nguoi: p.nguoi, luc: new Date().toISOString(), lyDo: p.lyDo });
      if (!kq.ten.length) throw httpError(400, p.khongCoHang);
      ten = kq.ten;
      hnStatus = tomTatHn(bang, tuoi.hnAssigneeId != null, tuoi.hnStatus);
    }
    const t = p.them;
    const doiGhiChu = t.hnRejectNote !== undefined;
    await tx.$executeRaw`
      UPDATE "Quote" SET
        "hnTables" = CASE WHEN ${coHang} THEN ${JSON.stringify(bang)}::jsonb ELSE "hnTables" END,
        "hnStatus" = ${hnStatus},
        "hnSubmittedAt" = CASE WHEN ${!!t.hnSubmittedAt} THEN now() ELSE "hnSubmittedAt" END,
        "hnReviewedAt" = CASE WHEN ${!!t.hnReviewed} THEN now() ELSE "hnReviewedAt" END,
        "hnReviewerId" = CASE WHEN ${!!t.hnReviewed} THEN ${p.nguoi}::int ELSE "hnReviewerId" END,
        "hnRejectNote" = CASE WHEN ${doiGhiChu} THEN ${t.hnRejectNote ?? null}::text ELSE "hnRejectNote" END
      WHERE id = ${id}`;
    return { ten, hnStatus, assigneeId: tuoi.hnAssigneeId };
  });
}

/** Báo cho mọi màn đang mở (danh sách, trình soạn, Hóa đơn đầu vào) — SQL thô không qua extension realtime. */
function phatThayDoi(id: number) {
  emitChange("quote", "update", id);
  emitChange("inputInvoice", "update");
}

/**
 * Account HN GỬI DUYỆT — `POST /:id/hn/submit`, body `{ rids? }`. Có `rids` = gửi đúng các hàng đó; vắng = gửi mọi
 * hàng đang làm / bị trả (nút "Gửi duyệt" cũ, nay là thao tác hàng loạt). MỘT thông báo cho chủ báo giá mỗi lần gửi.
 * Hàng phải ĐÃ LƯU (có rid trên máy chủ) — màn Account HN lưu trước rồi mới gửi.
 */
export async function submitHn(req: Request) {
  const id = Number((req.params as any).id);
  const rids = docRids(req.body?.rids);
  const existing = await prisma.quote.findFirst({ where: { id }, select: { id: true, quoteNumber: true, title: true, hnAssigneeId: true, hnStatus: true, createdById: true, members: { select: { userId: true, scopes: true } } } });
  if (!existing) throw httpError(404, "Không tìm thấy báo giá");
  const me = req.session.userId!;
  if (!can(req.session, P.QUOTE_HN_FILL) || existing.hnAssigneeId !== me) throw httpError(403, "Không có quyền gửi duyệt phần này");
  assertConLaThanhVien(req, existing);
  const kq = await doiTrangThaiHang(id, {
    loai: "gui", rids, nguoi: me,
    kiem: (t) => { if (t.hnAssigneeId !== me) throw httpError(403, "Phần Hà Nội vừa được giao cho người khác"); },
    rong: (st) => {
      if (!["assigned", "rejected"].includes(st ?? "")) throw httpError(400, "Phần HN không ở trạng thái có thể gửi duyệt");
      return "submitted";
    },
    khongCoHang: rids
      ? "Các hàng đã chọn không gửi duyệt được — đã gửi / đã duyệt rồi, hoặc chưa Lưu."
      : "Không còn hàng nào để gửi duyệt — mọi hàng đã gửi hoặc đã duyệt (hàng mới phải Lưu trước).",
    them: { hnSubmittedAt: true, hnRejectNote: null },
  });
  phatThayDoi(id);
  const quote = await prisma.quote.findFirst({ where: { id }, include: QUOTE_INCLUDE });
  if (!quote) throw httpError(404, "Không tìm thấy báo giá");
  const so = kq.ten.length;
  await notify(existing.createdById, {
    title: so ? `Hà Nội chờ duyệt ${so} hàng: ${quote.quoteNumber}` : `Phần Hà Nội chờ duyệt: ${quote.quoteNumber}`,
    body: so ? `${quote.title} — ${nhanHang(kq.ten)}. Mở để duyệt / trả từng hàng.` : `${quote.title} — Account đã gửi giá HN, mở để duyệt/trả.`,
    link: `/#/quotes/${id}`, resource: "quote", resourceId: id, important: true,
  });
  await audit(req, "quote.hn.submit", { resource: "quote", resourceId: id, after: { soHang: so, hang: kq.ten.slice(0, 50) } });
  return quote;
}

/**
 * DUYỆT / TRẢ / BỎ DUYỆT hàng Hà Nội — `POST /:id/hn/review`, body `{ decision: approve|reject|unapprove, note?, rids? }`.
 *
 * QUYỀN = quyền duyệt dòng bảng nội bộ như Chi phí HCM (`quote:internal:approve`) + sửa được báo giá + được giao vùng
 * "Giá Hà Nội". Thêm hai chốt riêng của phần HN: account phụ không duyệt (giữ luật cũ của reviewHn — duyệt là mở /
 * đóng khoá giá đã chốt, việc của chủ), và ACCOUNT HN ĐƯỢC GIAO KHÔNG TỰ DUYỆT hàng mình điền (kể cả khi được cấp
 * riêng quyền duyệt).
 *
 * `rids` vắng: duyệt / trả MỌI hàng đang chờ (nút cả phần cũ, nay là thao tác hàng loạt). Có: đúng các hàng đó — duyệt
 * thẳng được cả hàng chưa gửi (người duyệt tự điền), trả được cả hàng đã duyệt; bỏ duyệt BẮT BUỘC chọn hàng. MỘT
 * thông báo cho Account HN mỗi lần bấm, dù bao nhiêu hàng.
 *
 * Đồng thời: kiểm-rồi-ghi dưới khoá Quote (FOR UPDATE) trên bản TƯƠI, nên hai người cùng bấm thì người sau thấy hàng
 * đã đổi trạng thái → 400 thay vì ghi đè (finding M-CONC của bản cả phần, tests/zm-hn-review-atomic). Phần chưa có
 * hàng nào giữ hành vi cả phần cũ: chỉ từ "submitted", lượt bị chen giữa → 409.
 */
export async function reviewHn(req: Request) {
  const id = Number((req.params as any).id);
  const decision = req.body?.decision;   // "approve" | "reject" | "unapprove"
  const note = req.body?.note ? String(req.body.note).trim().slice(0, 500) || null : null;
  const rids = docRids(req.body?.rids);
  const existing = await prisma.quote.findFirst({ where: { id }, include: { members: { select: { userId: true, scopes: true } } } });
  if (!existing) throw httpError(404, "Không tìm thấy báo giá");
  const me = req.session.userId!;
  if (!can(req.session, P.QUOTE_INTERNAL_APPROVE) || !canOnQuote(req.session, "update", existing)) throw httpError(403, "Bạn không có quyền duyệt hàng Hà Nội");
  if (!(quoteScopesFor(req.session, existing) ?? []).includes("hanoi")) throw httpError(403, 'Bạn không được giao phần "Giá Hà Nội" của báo giá này');
  // Như assignHn: duyệt/trả phần HN mở lại quyền ghi lên giá đã chốt, không phải việc của phụ.
  if (laAccountPhu(req.session, existing)) throw httpError(403, "Bạn được thêm vào làm cùng báo giá này, việc duyệt phần Hà Nội thuộc về người tạo báo giá");
  const tuDuyet = "Account Hà Nội không tự duyệt hàng mình điền — nhờ người tạo báo giá duyệt";
  if (existing.hnAssigneeId === me) throw httpError(403, tuDuyet);
  if (!["approve", "reject", "unapprove"].includes(decision)) throw httpError(400, "Quyết định không hợp lệ");
  if (decision === "unapprove" && !rids) throw httpError(400, "Chọn hàng cần bỏ duyệt");
  const loai: ThaoTacHangHn = decision === "approve" ? "duyet" : decision === "reject" ? "tra" : "bo-duyet";
  const daThayCho = existing.hnStatus === "submitted";
  const kq = await doiTrangThaiHang(id, {
    loai, rids, nguoi: me, lyDo: note,
    kiem: (t) => { if (t.hnAssigneeId === me) throw httpError(403, tuDuyet); },
    rong: (st) => {
      if (decision === "unapprove") throw httpError(400, "Phần Hà Nội chưa có hàng nào");
      if (st !== "submitted") {
        if (daThayCho) throw httpError(409, "Phần Hà Nội vừa được xử lý bởi người khác — vui lòng tải lại");
        throw httpError(400, "Phần HN chưa được gửi duyệt");
      }
      return decision === "approve" ? "approved" : "rejected";
    },
    khongCoHang: decision === "unapprove" ? "Các hàng đã chọn không ở trạng thái đã duyệt."
      : rids ? (decision === "approve" ? "Các hàng đã chọn đã được duyệt rồi (hoặc chưa Lưu)." : "Các hàng đã chọn không ở trạng thái chờ duyệt / đã duyệt.")
      : "Không có hàng nào đang chờ duyệt — phần HN chưa được gửi duyệt, hoặc vừa được người khác xử lý.",
    them: { hnReviewed: true, ...(decision === "reject" ? { hnRejectNote: note } : {}) },
  });
  phatThayDoi(id);
  const quote = await prisma.quote.findFirst({ where: { id }, include: QUOTE_INCLUDE });
  if (!quote) throw httpError(404, "Không tìm thấy báo giá");
  if (kq.assigneeId && kq.assigneeId !== me) {
    const so = kq.ten.length;
    const cacHang = so ? `${so} hàng — ${nhanHang(kq.ten)}` : "cả phần";
    const chung = { link: `/#/quotes/${id}`, resource: "quote", resourceId: id };
    await notify(kq.assigneeId, decision === "approve"
      ? { ...chung, title: `Hà Nội ĐÃ DUYỆT ${so ? `${so} hàng` : "cả phần"}: ${quote.quoteNumber}`, body: `${quote.title} — ${cacHang}` }
      : decision === "reject"
        ? { ...chung, title: `Hà Nội bị TRẢ LẠI ${so ? `${so} hàng` : "cả phần"}: ${quote.quoteNumber}`, body: `${note || "Vui lòng chỉnh sửa rồi gửi lại."} (${cacHang})`, important: true }
        : { ...chung, title: `Hà Nội BỎ DUYỆT ${so} hàng: ${quote.quoteNumber}`, body: `${quote.title} — ${cacHang}. Hàng mở lại để sửa.` });
  }
  await audit(req, "quote.hn.review", { resource: "quote", resourceId: id, decision, after: { soHang: kq.ten.length, hang: kq.ten.slice(0, 50), note } });
  return quote;
}
