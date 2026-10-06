// Application service for the quote domain. Holds the heavy create/update business
// logic (transactions, number allocation, version snapshots, reopen-on-edit,
// audit/webhook/notify) so the route handlers stay thin: parse -> call service ->
// present. Business-rule failures are thrown as httpError(status,msg); the central
// errorHandler maps err.status<500 to that HTTP status + message.

import { Prisma } from "@prisma/client";
import type { Request } from "express";
import { prisma, type TxClient } from "../db.js";
import { config } from "../config.js";
import { computeQuoteTotals, assertTotalsStorable, tinhConvertedTotal, chuanHoaTheoCot, chuanHoaVat, D } from "../money.js";
import { nextQuoteNumber, nextProjectCode, syncQuoteCounter, syncProjectCodeCounter } from "../quoteNumber.js";
import { namVN, namNganVN, homNayVN } from "../vnTime.js";
import { normalizeSearch } from "../searchText.js";
import { audit } from "../audit.js";
import { randomUUID } from "node:crypto";
import { trungTren } from "../prismaLoi.js";
import { snapshotQuoteVersion, diffVersions } from "../quoteVersion.js";
import { notify } from "../notifications.js";
import { emit as emitWebhook } from "../webhooks.js";
import { codeLabel } from "../quoteCode.js";
import { can, canScoped, canOnQuote, biLuocView, quoteScopeWhereOrThrow, quoteScopesFor, laAccountPhu, locPhamVi, tenPhamVi, resolveUserPermissions, QUOTE_SCOPES, PERMISSIONS as P } from "../permissions.js";
import {
  canEdit,
  daXuatHoaDon,
  QUOTE_INCLUDE,
  QUOTE_LIST_SELECT,
  QUOTE_UPDATE_STATE_SELECT,
  templatesBelongToCompany,
  buildSheetsCreate,
  mocSoMaSheet,
  chuanHoaSoNgayTheoMau,
  sanitizeExtraTables,
  sanitizeHnTables,
  extraTableSum,
  bangNoiBoCoNgay,
  dsMauBangNoiBo,
  phangThanhVien, vanTayHn } from "../quoteUtils.js";
import { httpError } from "../httpError.js";
import { sheetKhongDoi } from "../quoteSheetDiff.js";
import { chuanHoaGhiChu, type MauGhiChu } from "../quoteListNote.js";
import { docBoLoc, locTheoChieu, ghepLoc, orderByTheoCot, sapIdTheoTieuDe, COT_SAP_XEP_CU, type ChieuLoc, type NguCanhLoc } from "../quoteListFilter.js";
import { hangHoaDonDauVao, hangKhoanBaoGiaDaXoa, type HangDauVao } from "../inputInvoices.js";
// Hai câu SQL đọc bảng nội bộ ĐÃ CẮT ảnh chứng từ — sống ở src/bangNoiBoSql.ts để dịch vụ kế toán dùng chung mà không
// import ngược vào tệp này [K4]. Export lại: listProjects / gdprService vẫn gọi qua đây như trước.
import { bangNoiBoTheoSheet, bangHnTheoBaoGia } from "../bangNoiBoSql.js";
export { bangNoiBoTheoSheet, bangHnTheoBaoGia };
import { bangCuaSheets, hangCuaPhia, tapDaChi, hangDaChiBiMat, tachRidTrung, loiHangDaChi, loiCoMa, chuanHoaRidTrung, hangVetThieuRid, loiVetThieuRid, sapTheoThuTu } from "../khoanChi.js";
import { docKhoanChiTrongTx, docKhoanChiTheoBaoGia, docAnhTheoKhoan, phuKeToanDanhSach, khoanDaChiCuaBaoGia } from "./inputInvoiceService.js";

/**
 * Caller có VIEW BỊ LƯỢC — `GET /quotes/:id` chỉ trả cho họ một phần báo giá:
 *   quote:hn:fill      → presentQuoteForAccountHn (chỉ bảng "hanoi")
 *   quote:internal:view → presentQuoteForInternal (chỉ các bảng nội bộ)
 * Cả hai CỐ Ý giấu tên/liên hệ khách, đơn giá bán và subtotal/vat/total.
 */
const viewBiLuoc = (session: any) => biLuocView(session);

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
    include: { members: { select: { userId: true, scopes: true } } },
  });
  if (!quote) throw httpError(404, "Không tìm thấy báo giá");
  if (!canOnQuote(req.session, action, quote)) throw httpError(403, "Bạn không có quyền với báo giá này");
  if (viewBiLuoc(req.session)) throw httpError(403, "Bạn chỉ được xem phần được giao của báo giá này");
  return quote;
}

// Duyệt theo HÀNG cho bảng nội bộ "hcm"/"khach": CHỈ ADMIN được đặt approved. Gọi TRƯỚC khi
// lưu (buildSheetsCreate) để: non-admin → GIỮ NGUYÊN trạng thái duyệt cũ theo `rid` (chống tự
// duyệt qua payload); admin → honor + đóng dấu approvedAt/approvedBy khi mới duyệt. Mutate sheets.
// Dấu vân tay SỐ TIỀN của một hàng — CÙNG hàm với `reconcileExtraPayments` ngay dưới (giữ một chỗ,
// đừng để hai bản trôi khỏi nhau). `null` = hàng KHÔNG GHI số tiền, khác hẳn "số tiền bằng 0".
function soTienHang(it: any): string | null {
  const q = it?.quantity, dg = it?.unitPrice;
  if ((q === undefined || q === null) && (dg === undefined || dg === null)) return null;
  return `${Number(q) || 0}|${Number(dg) || 0}|${it?.days != null ? Number(it.days) : ""}`;
}

export function reconcileExtraApprovals(sheets: any[], existingSheets: any[], isAdmin: boolean, approverId: number) {
  if (!Array.isArray(sheets)) return;
  const prior = new Map();   // rid -> { approved, approvedAt, approvedBy, tien }
  for (const s of (existingSheets || [])) {
    for (const t of (Array.isArray(s.extraTables) ? s.extraTables : [])) {
      if (!t || (t.category !== "hcm" && t.category !== "khach")) continue;
      for (const it of (t.items || [])) {
        // BẢN ĐẦU thắng (rid trùng có sẵn đã được chuanHoaRidTrung tách ở đường Lưu; đây là lưới thứ hai).
        if (it && it.rid && !prior.has(it.rid)) prior.set(it.rid, { approved: !!it.approved, approvedAt: it.approvedAt || null, approvedBy: it.approvedBy ?? null, tien: soTienHang(it) });
      }
    }
  }
  const now = new Date().toISOString();
  // rid ĐÃ kế thừa MỘT lần — chép rid của hàng đã duyệt sang một hàng BỊA thứ hai thì hàng thứ hai
  // không được ăn theo (cùng chốt "một lần" mà reconcileExtraPayments đã dùng, xem chú thích dưới).
  const daDung = new Set<string>();
  for (const s of sheets) {
    for (const t of (Array.isArray(s.extraTables) ? s.extraTables : [])) {
      if (!t || (t.category !== "hcm" && t.category !== "khach")) continue;
      for (const it of (t.items || [])) {
        if (!it) continue;
        let p = it.rid ? prior.get(it.rid) : null;
        if (p && it.rid) {
          if (daDung.has(it.rid)) p = null;
          else {
            daDung.add(it.rid);
            // NGƯỜI KHÔNG CÓ QUYỀN DUYỆT SỬA SỐ TIỀN CỦA HÀNG ĐÃ DUYỆT → TỪ CHỐI CẢ LẦN LƯU.
            //
            // Lỗ đo được: người có `quote:update:own` nhưng KHÔNG có `quote:internal:approve` mở
            // báo giá đã có hàng "hcm"/"khach" ĐÃ DUYỆT (approved:true), sửa unitPrice/quantity
            // của đúng rid đó rồi Lưu. Bản trước không so số tiền nên nhánh non-admin CHỈ kế thừa
            // `approved`/`approvedAt`/`approvedBy` theo rid — số tiền đi theo payload của họ, dấu
            // duyệt của người khác vẫn đứng nguyên trên số tiền họ vừa bịa ra. Cùng lỗ y hệt đã vá
            // ở `reconcileExtraPayments` (xem chú thích ở đó) — CHỈ khác chữ "thanh toán" → "duyệt".
            //
            // Cùng lý do chọn NÉM LỖI thay vì âm thầm khôi phục/xoá dấu duyệt: hỏng TO ngay lúc lưu,
            // không mất dữ liệu, không nuốt thay đổi. `p.tien === null` (hàng ghi trước khi
            // sanitizeExtraTables chuẩn hoá số) thì KHÔNG có gì để so — thiếu dữ liệu thì MỞ.
            if (!isAdmin && p.approved && p.tien !== null && p.tien !== soTienHang(it)) {
              throw httpError(
                400,
                `Không sửa được số tiền của hàng đã duyệt: "${String(it.name || "").slice(0, 80) || "(không tên)"}". ` +
                  `Hàng này đã được duyệt nên số lượng / đơn giá / số ngày phải giữ nguyên. ` +
                  `Cần đổi thì nhờ người có quyền duyệt bỏ duyệt trước, rồi sửa và duyệt lại.`
              );
            }
          }
        }
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

// THANH TOÁN theo HÀNG bảng nội bộ (mọi loại) — từ 2026-10-06 KHÔNG còn ai đặt được qua đường Lưu.
//
// Việc "đã chi" + ảnh chứng từ chuyển sang kế toán ở trang Hóa đơn đầu vào, vào bảng RIÊNG InputInvoiceEntry
// (src/services/inputInvoiceService.ts). Bốn cờ cũ `paid/paidAt/paidById/paidProof` còn nằm trong JSON hàng thì ĐÓNG
// BĂNG (KT-2): hàm này LUÔN chép lại chúng theo `rid` từ bản CSDL cho MỌI người, hàng mới luôn chưa chi — payload
// không đổi được chúng (zod cũng đã cắt, xem itemSchema ở src/validators.ts; đây là lớp thứ hai). Gọi TRƯỚC khi lưu.
//
// `opts.daChi` = tập rid ĐANG hiệu lực đã chi (khoản thắng cờ JSON — src/khoanChi.ts trangThaiHieuLuc), dùng cho chốt
// SỐ TIỀN bên dưới; vắng thì lùi về cờ JSON của bản CSDL. `opts.mienChotTien` = người có quyền tích (invoice:input:pay)
// — họ đổi được số tiền của hàng đã chi, trang kế toán sẽ báo "Số tiền đã đổi sau khi chi".
export function reconcileExtraPayments(sheets: any[], existingSheets: any[], opts: { daChi?: Set<string>; mienChotTien?: boolean } = {}) {
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
  // Bất biến đóng lỗ đó: AI KHÔNG ĐƯỢC TÍCH "ĐÃ CHI" THÌ CŨNG KHÔNG ĐƯỢC ĐỔI SỐ TIỀN CỦA HÀNG ĐÃ CHI.
  // Hàng nào lấy trạng thái đã-trả mà số tiền lệch so với bản CSDL thì KHÔNG kế thừa gì — nó không
  // còn là hàng đó nữa. Người có quyền tích (`invoice:input:pay`, trước là `quote:internal:pay`) không bị
  // ràng buộc này (`opts.mienChotTien`) — trang kế toán báo "Số tiền đã đổi sau khi chi" cho họ đối chiếu.
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
  // (hàm chung `soTienHang` khai báo ở trên, ngay trước reconcileExtraApprovals — xem chú thích ở đó)
  const soTien = soTienHang;
  const prior = new Map();   // rid -> { paid, paidAt, paidById, paidProof, tien }
  for (const s of (existingSheets || [])) {
    for (const t of (Array.isArray(s.extraTables) ? s.extraTables : [])) {
      for (const it of (t?.items || [])) {
        // BẢN ĐẦU thắng — cùng luật với khoản kế toán (khoá theo bản đầu) và công cụ chuyển dữ liệu (src/khoanChi.ts).
        if (it && it.rid && !prior.has(it.rid)) prior.set(it.rid, { paid: !!it.paid, paidAt: it.paidAt || null, paidById: it.paidById ?? null, paidProof: it.paidProof ?? null, tien: soTien(it) });
      }
    }
  }
  const daDung = new Set<string>();
  for (const s of sheets) {
    for (const t of (Array.isArray(s.extraTables) ? s.extraTables : [])) {
      for (const it of (t?.items || [])) {
        if (!it) continue;
        let p = it.rid ? prior.get(it.rid) : null;
        if (p && it.rid) {
          if (daDung.has(it.rid)) p = null;                                   // bản sao của cùng một rid
          else {
            daDung.add(it.rid);
            // Đổi số tiền của hàng ĐÃ CHI (hiệu lực) mà không có quyền tích → TỪ CHỐI CẢ LẦN LƯU.
            // `p.tien === null` = bản CSDL không ghi số tiền → không có gì để so, cho đi qua.
            //
            // ── VÌ SAO TỪ CHỐI, KHÔNG PHẢI "CẮT KẾ THỪA" ──────────────────────────────
            // Bản trước đặt `p = null`, tức `paid=false`, `paidAt/paidById=null` và
            // `paidProof=null`: XOÁ VĨNH VIỄN chứng từ tài chính THẬT, im lặng, vẫn trả 200. Nó
            // không đánh trúng kẻ tấn công mà đánh trúng thao tác BÌNH THƯỜNG — kế toán bấm /pay
            // đánh dấu một hàng chi phí đã trả (kèm ảnh uỷ nhiệm chi); sau đó sale, vốn KHÔNG có
            // `quote:internal:pay`, sửa số lượng hoặc đơn giá đúng hàng đó rồi bấm Lưu. Ảnh và cờ
            // đã-trả biến mất, không cảnh báo, không khôi phục được.
            //
            // Âm thầm KHÔI PHỤC số tiền theo CSDL cũng không đúng: người dùng tin là đã sửa giá,
            // thực tế không, và họ chỉ phát hiện khi tình cờ tải lại.
            //
            // Nên hỏng TO thay vì hỏng ÂM THẦM. Ba tính chất cùng đạt: không mất dữ liệu, không
            // nuốt thay đổi của người dùng, và kẻ chép `rid` sang hàng bịa không thu được gì (cả
            // lần ghi bị chặn). Người dùng có đường thoát rõ ràng — nhờ kế toán bỏ đánh dấu trước.
            //
            // Điều kiện `p.tien !== null` giữ nguyên có chủ ý: hàng ghi từ trước khi
            // `sanitizeExtraTables` chuẩn hoá (hoặc ghi qua route /pay cũ) không có
            // `quantity`/`unitPrice` trong JSON, và chặn chúng sẽ khoá người dùng khỏi chính dữ
            // liệu hợp lệ của họ. Thiếu dữ liệu thì MỞ, có dữ liệu thì SIẾT.
            //
            // "Đã chi" là trạng thái HIỆU LỰC (`opts.daChi`): kế toán đã BỎ tích thì cờ JSON cũ `paid:true` không
            // còn khoá số tiền; khoản đã tích mà JSON chưa có cờ thì vẫn khoá.
            const daChi = opts.daChi ? opts.daChi.has(it.rid) : p.paid;
            if (!opts.mienChotTien && daChi && p.tien !== null && p.tien !== soTien(it)) {
              throw httpError(
                400,
                `Không sửa được số tiền của hàng đã chi: "${String(it.name || "").slice(0, 80) || "(không tên)"}". ` +
                  `Hàng này đã được kế toán đánh dấu ĐÃ CHI nên số lượng / đơn giá / số ngày phải giữ nguyên. ` +
                  `Cần đổi thì nhờ kế toán bỏ đánh dấu ở trang Hóa đơn đầu vào trước, rồi sửa.`
              );
            }
          }
        }
        // ĐÓNG BĂNG (KT-2): cả bốn cờ theo bản CSDL, cho MỌI người; hàng mới / bản sao = chưa chi. Ảnh không bao giờ
        // đi qua đường Lưu (chống base64 chảy qua payload + giả mạo chứng từ).
        it.paidProof = p ? p.paidProof : null;
        it.paid = p ? p.paid : false;
        it.paidAt = p ? p.paidAt : null;
        it.paidById = p ? p.paidById : null;
      }
    }
  }
}

/**
 * KHÁCH HÀNG (danh mục) được GẮN vào báo giá phải (1) tồn tại và chưa bị xoá, (2) là khách mà người gắn ĐỌC được.
 *
 * Thiếu lớp này thì ai sửa/tạo được báo giá cũng gắn được khách của NGƯỜI KHÁC (chỉ cần đoán id) rồi đọc mã + tên khách qua chính
 * phản hồi của báo giá (`customerCode`/`customerName`) — trong khi danh mục khách chia theo chủ sở hữu (`customer:read:own`).
 * Cũng chặn id không có thật: trước đây nó đi thẳng xuống khoá ngoại và ra 500 thay vì một câu tiếng Việt.
 * 400 = khách không có / đã xoá; 403 = khách ngoài phạm vi của người gắn.
 *
 * CHỈ gọi khi `customerId` được ĐẶT MỚI hoặc ĐỔI (updateQuote so với giá trị đang lưu): màn soạn gửi lại cả báo giá mỗi lần Lưu,
 * kể cả `customerId` cũ — người được thêm vào báo giá của người khác, hay khách bị xoá sau khi đã gắn, vẫn phải lưu được.
 */
async function kiemKhachDuocGan(req: Request, customerId: number) {
  const kh = await prisma.customer.findFirst({ where: { id: customerId }, select: { id: true, ownerId: true } });
  if (!kh) throw httpError(400, "Khách hàng không tồn tại hoặc đã bị xóa");
  if (!canScoped(req.session, "customer", "read", kh)) throw httpError(403, "Bạn không có quyền chọn khách hàng này");
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
  if (b.customerId != null) await kiemKhachDuocGan(req, b.customerId);

  const company = await prisma.company.findFirst({ where: { id: b.companyId } });
  if (!company) throw httpError(400, "Không tìm thấy công ty");
  if (!(await templatesBelongToCompany(b.sheets, company.id))) {
    throw httpError(400, "Có mẫu báo giá không thuộc công ty đã chọn (hoặc đã ngừng dùng)");
  }
  // rid TRÙNG trong một phía → hàng sau nhận rid mới (KT-6): khoản kế toán khoá theo rid, không được trỏ vào hai hàng.
  tachRidTrung("sheet", bangCuaSheets(b.sheets));
  // Duyệt hàng (HCM/Khách) — tạo mới: ai KHÔNG có quyền duyệt nội bộ thì mọi hàng CHƯA duyệt; có quyền tick thì đóng dấu.
  reconcileExtraApprovals(b.sheets, [], can(req.session, P.QUOTE_INTERNAL_APPROVE), userId);
  // Đã chi: báo giá mới chưa có gì để kế thừa → mọi hàng chưa chi (cờ thanh toán không đi qua đường Lưu nữa).
  reconcileExtraPayments(b.sheets, [], {});
  // Phần Hà Nội gõ ngay lúc tạo: cùng hai chốt như đường Lưu (trước đây cờ duyệt / đã trả giả trong payload được ghi
  // nguyên trạng — `sanitizeHnTables` chỉ chuẩn hoá hình dạng, không phán quyền).
  let hnTaoMoi: any[] | undefined;
  if (b.hnTables !== undefined) {
    tachRidTrung("hn", b.hnTables);
    const bocHn = [{ extraTables: b.hnTables }];
    reconcileExtraPayments(bocHn, [], {});
    reconcileHnApprovals(bocHn, [], can(req.session, P.QUOTE_INTERNAL_APPROVE));
    hnTaoMoi = sanitizeHnTables(bocHn[0].extraTables);
  }

  // Client-supplied number: validate uniqueness across ALL rows (incl. soft-deleted)
  // BEFORE the write to return a clean 409.
  if (b.quoteNumber) {
    const dup = await prisma.quote.findFirst({ where: { quoteNumber: b.quoteNumber }, includeDeleted: true } as any);
    if (dup) {
      throw httpError(409, dup.deletedAt ? "Số báo giá đã dùng (thuộc báo giá đã xoá)" : "Số báo giá đã tồn tại");
    }
  }

  // Người TẠO báo giá — nguồn của khối "Người gửi" in ra Excel/PDF. Lấy đủ trường ngay đây thay vì
  // để `company.*` đỡ, xem chú thích ở `fromPhone` bên dưới.
  const creator = await prisma.user.findUnique({
    where: { id: userId },
    select: { projectCode: true, phone: true, title: true, senderName: true, displayName: true },
  });
  const draft: Record<string, any> = {
    title: b.title,
    shortTitle: b.shortTitle?.trim() || null,   // tuỳ chọn — dùng đặt tên file tải về
    toCompany: b.toCompany,
    toContact: b.toContact || null,
    toEmail: b.toEmail || null,
    toPhone: b.toPhone || null,
    toAddress: b.toAddress || null,
    companyId: company.id,
    // ── KHỐI "NGƯỜI GỬI" PHẢI THEO NGƯỜI TẠO, KHÔNG PHẢI THEO CÔNG TY ────────────────────
    // `fromPhone` trước đây lùi về `company.phone`. Hậu quả đo được trên production: báo giá do
    // bất kỳ ai tạo mà không kèm sẵn SĐT đều in ra số tổng đài của công ty (0914291951) ở dòng
    // "Người gửi" — khách gọi lại là gặp người khác, và trước đó đúng những tài khoản bị xoá
    // trắng `phone` (sự cố hồ sơ) là những người rơi vào nhánh này nhiều nhất.
    //
    // Giao diện tạo báo giá đã điền đúng từ hồ sơ người dùng (NewQuoteWizard.tsx: `me.phone`,
    // `me.senderName`, `me.title`), nên đường lùi này chỉ chạy khi client KHÔNG gửi trường đó —
    // và khi ấy câu trả lời đúng là hồ sơ NGƯỜI TẠO, không phải số của công ty. Hết đường thì để
    // TRỐNG: một dòng trống thì người đọc biết là thiếu, còn số của người khác thì không.
    //
    // `fromAddress` vẫn lùi về `company.address` — địa chỉ ĐÚNG là của công ty, không phải của
    // cá nhân, nên chỗ đó không cùng loại.
    fromContact: b.fromContact || creator?.senderName || creator?.displayName || "",
    fromPhone: b.fromPhone || creator?.phone || null,
    fromTitle: b.fromTitle || creator?.title || null,
    fromAddress: b.fromAddress || company.address,
    city: b.city || company.city || "TP. Hồ Chí Minh",
    quoteDate: b.quoteDate || homNayVN(),   // ngày VN, không phải ngày UTC (MONEY-07 / XLSX-11)
    executionDate: b.executionDate || null,
    customerId: b.customerId ?? null,
    greeting: b.greeting || undefined,
    vatPercent: chuanHoaVat(b.vatPercent),   // đúng thang Decimal(5,2) — MONEY-02
    showTotals: b.showTotals !== false,
    notes: b.notes || null,
    status: "draft",
    createdById: userId,
  };

  // Compute totals from sheets+items BEFORE writing so we store the snapshot.
  await chuanHoaSoNgayTheoMau(b.sheets);   // mẫu không có cột Số Ngày → days=null TRƯỚC khi tính (xem quoteUtils)
  chuanHoaTheoCot(b.sheets);   // SL/đơn giá/ngày về đúng thang cột CSDL → tổng lưu = tổng đọc lại (MONEY-02)
  const t = computeQuoteTotals({ vatPercent: draft.vatPercent, sheets: b.sheets });
  assertTotalsStorable(t, b.sheets); // 400 nói rõ trang nào âm, thay vì 500 mất trắng lần Lưu
  draft.subtotal = t.subtotal;
  draft.vat = t.vat;
  draft.discount = t.discount;   // = Σ giảm giá các sheet (suy ra, xem src/money.ts)
  draft.total = t.total;

  const prefix = company.quotePrefix || "GN";
  let quote;
  // Số của LƯỢT VỪA HỎNG, đọc lại được ở khối catch (xem lý do ở đó).
  const capSo: { so: string | null } = { so: null };
  for (let attempt = 0; ; attempt++) {
    try {
      quote = await prisma.$transaction(async (tx) => {
        // ── VÌ SAO CẤP SỐ Ở CUỐI, KHÔNG PHẢI Ở ĐẦU ──────────────────────────
        // `nextQuoteNumber` là một UPDATE lên MỘT hàng của `QuoteCounter` khoá theo (prefix, năm).
        // Postgres giữ khoá hàng đó tới HẾT transaction. Đặt nó ở câu lệnh ĐẦU nghĩa là khoá được
        // giữ suốt cả lượt tạo — và lượt tạo là phần nặng nhất của cả ứng dụng.
        //
        // ĐO ĐƯỢC (dev, 2026-09-16): một giao dịch giữ hàng bộ đếm 6 giây làm giao dịch xin số kế
        // tiếp phải CHỜ 5.077 ms. Mà POST /api/quotes 20.000 dòng ĐO ĐƯỢC mất 13,1s — tức mọi
        // người khác trong công ty không tạo nổi báo giá nào suốt 13 giây, vì MỘT người đang lưu
        // một báo giá lớn. Tất cả dùng chung một hàng: prefix của công ty là "GN".
        //
        // Đáng chú ý: cùng 20.000 dòng đó, phần CHÈN ở tầng CSDL chỉ mất 752 ms (đo bằng
        // `INSERT … SELECT generate_series` rồi ROLLBACK). Nghĩa là ~94% thời gian giữ khoá là
        // vòng gọi Prisma và việc JS — công việc KHÔNG CẦN giữ khoá đó chút nào.
        //
        // Nên: tạo báo giá với SỐ TẠM trước (phần nặng, KHÔNG chạm bộ đếm), rồi mới cấp số thật và
        // cập nhật một hàng. Khoá chỉ bị giữ từ lúc cấp tới lúc commit.
        //
        // VẪN KHÔNG "ĐỐT SỐ": cấp số vẫn nằm TRONG transaction, nên lượt tạo hỏng vẫn cuốn theo cả
        // lần tăng bộ đếm — đúng tính chất mà `nextQuoteNumber` cố ý giữ. Số tạm cũng không bao giờ
        // ra ngoài: nó chỉ tồn tại giữa hai câu lệnh của CÙNG một transaction chưa commit.
        const soTam = `__TAM__${randomUUID()}`;
        const sheetsTaoMoi = buildSheetsCreate(b.sheets, t.sheetTotals);
        const created = await tx.quote.create({
          // Báo giá MỚI: mốc nước xuất phát 0, và ghi luôn mốc sau khi cấp để lượt sửa đầu tiên
          // đã có sẵn (xem mocSoMaSheet / migration 20260908060000).
          data: {
            // `projectCode: null` PHẢI ĐÈ LÊN `...draft` — xem khối dưới, đây là lỗi đã tái hiện được.
            //
            // ── VÌ SAO ──────────────────────────────────────────────────────
            // `draft.projectCode` chỉ được gán ở `nextProjectCode` bên dưới, tức SAU lượt `create`
            // này. Ở LƯỢT THỬ LẠI, nó còn nguyên giá trị của lần vừa hỏng. Không đè thì `create`
            // ghi thẳng mã đã đụng vào `@@unique([projectCode, projectVersion])` → P2002 ngay tại
            // `create`, TRƯỚC khi `nextProjectCode` kịp cấp mã kế tiếp. Bốn lượt thử y hệt nhau rồi
            // 409 "Số báo giá bị trùng" — sai hẳn nguyên nhân (đụng MÃ DỰ ÁN, không phải số báo
            // giá), và mỗi lượt còn chèn rồi rollback TOÀN BỘ hạng mục (báo giá 20.000 dòng = 4
            // lượt chèn vô ích).
            //
            // Trước khi dời việc cấp số xuống cuối transaction, `nextProjectCode` chạy TRƯỚC
            // `create` nên mỗi lượt thử tự nhiên có mã mới. Dời xuống làm mất tính chất đó; dòng
            // này trả lại nó. Mã thật được ghi ở lượt `update` bên dưới.
            ...draft, projectCode: null,
            quoteNumber: soTam, searchText: "", sheetCodeSeq: mocSoMaSheet(sheetsTaoMoi as any, 0),
            // Phần Hà Nội gõ ngay lúc tạo — đã qua hai chốt cờ duyệt / đã chi ở đầu hàm (`hnTaoMoi`).
            ...(hnTaoMoi !== undefined ? { hnTables: hnTaoMoi } : {}),
            sheets: { create: sheetsTaoMoi },
            members: { create: { userId, scopes: [...QUOTE_SCOPES], addedById: userId } },
          } as any,
          // `include` NẶNG (toàn bộ sheet + item) nằm ở ĐÂY, tức NGOÀI vùng khoá. Đặt nó ở lượt
          // `update` bên dưới là đọc lại cả báo giá trong lúc đang giữ khoá bộ đếm — ĐO ĐƯỢC là
          // mất thêm ~13 điểm phần trăm thời gian giữ khoá.
          include: QUOTE_INCLUDE as any,
        });

        // ── TỪ ĐÂY KHOÁ BỘ ĐẾM BỊ GIỮ. Giữ đoạn này NGẮN NHẤT CÓ THỂ. ────────
        const quoteNumber = b.quoteNumber ?? await nextQuoteNumber(prefix, tx as any);
        capSo.so = quoteNumber;
        // Số do client gửi không đi qua bộ đếm → phải đẩy bộ đếm theo, nếu không lần cấp TỰ ĐỘNG
        // kế tiếp sinh lại số đã dùng và đốt sạch ngân sách thử lại (xem syncQuoteCounter).
        if (b.quoteNumber) await syncQuoteCounter(b.quoteNumber, prefix, tx as any);
        if (creator?.projectCode) draft.projectCode = await nextProjectCode(creator.projectCode, tx as any);
        const searchText = normalizeSearch(quoteNumber, draft.projectCode, draft.title, draft.toCompany, draft.toContact);
        // KHÔNG `include` ở đây: đây là câu lệnh nằm TRONG vùng khoá, nó chỉ cần ghi một hàng.
        await tx.quote.update({
          where: { id: created.id },
          data: { quoteNumber, searchText, ...(draft.projectCode ? { projectCode: draft.projectCode } : {}) },
        });
        // `snapshotQuoteVersion` đọc lại báo giá từ CSDL, nên phải chạy SAU lượt cập nhật trên —
        // nếu không, lịch sử phiên bản v1 sẽ ghi lại SỐ TẠM.
        await snapshotQuoteVersion(tx, created.id, userId, "create");
        // Trả về bản đã nạp đầy đủ từ lượt `create` (ngoài vùng khoá), vá lại đúng ba trường vừa
        // ghi. Đọc lại lần nữa chỉ để lấy ba giá trị mình vừa tự viết ra là tốn một lượt quét cả
        // báo giá — và tốn nó ở đúng chỗ đắt nhất.
        return { ...created, quoteNumber, searchText, ...(draft.projectCode ? { projectCode: draft.projectCode } : {}) };
      });
      break;
    } catch (e) {
      const code = e instanceof Prisma.PrismaClientKnownRequestError ? e.code : undefined;
      // ĐỤNG MÃ DỰ ÁN, KHÔNG PHẢI SỐ BÁO GIÁ. `@@unique([projectCode, projectVersion])` cũng ném
      // P2002, và khối dưới chỉ biết đẩy bộ đếm SỐ BÁO GIÁ — lượt sau sinh LẠI ĐÚNG mã dự án cũ,
      // bốn lượt y hệt rồi 409 với nội dung sai hẳn. Ghi nhận mã vừa bị chiếm vào bộ đếm mã dự án
      // (NGOÀI transaction, GREATEST nên không lùi) để lượt sau nhảy sang mã kế tiếp.
      // `meta.target` là UNDEFINED với driver adapter (Prisma 7) — ĐÃ ĐO. Đọc thẳng nó là để nhánh
      // này chết im lặng: bốn lượt thử y hệt nhau rồi 409 nói sai nguyên nhân. Xem src/prismaLoi.ts.
      const dungMaDuAn = trungTren(e, "projectCode");
      if (dungMaDuAn && attempt < 3) {
        if (draft.projectCode && creator?.projectCode) {
          await syncProjectCodeCounter(String(draft.projectCode), creator.projectCode).catch(() => {});
        }
        continue;
      }
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
/** Trường mức sheet cho thấy mã sản xuất của báo giá ĐÃ ĐI RA NGOÀI (hoá đơn, PO, thu tiền, chứng từ). */
const DAU_MA_DA_PHAT_HANH = ["invoiceNo", "hnInvoiceNo", "poNumber", "paidAt", "invoiceDate", "invoiceLink", "docSentAt", "orderClosedAt"] as const;

/**
 * Được ĐÁNH LẠI mã sản xuất (_01, _02…) theo thứ tự sheet mới không? — người dùng vừa kéo đổi thứ tự.
 *
 * Mã đóng băng (capSoMaSheet) để một mã đã phát hành không bao giờ trỏ sang sheet khác. Đánh lại chỉ
 * an toàn khi CHƯA mã nào của báo giá này được dùng: không sheet nào có số hoá đơn / PO / ngày thu /
 * chứng từ, và không hồ sơ nhân sự nào (kể cả đã xoá mềm) lưu mã của báo giá (`PersonnelRecord.projectCode`
 * lưu CỨNG chuỗi mã và buildProjectRef khớp BẰNG-ĐÚNG). Sai một trong hai → giữ mã cũ, chỉ đổi thứ tự.
 * Chạy TRONG transaction, sau khi đã khoá QuoteSheet (sheetsTuoi đọc sau khoá).
 */
async function coTheDanhLaiMaSheet(tx: any, quoteId: number, sheetsTuoi: any[]): Promise<boolean> {
  for (const s of sheetsTuoi || []) {
    for (const f of DAU_MA_DA_PHAT_HANH) {
      const v = s?.[f];
      if (v != null && String(v).trim() !== "") return false;
    }
  }
  const q = await tx.quote.findUnique({ where: { id: quoteId }, select: { projectCode: true, projectVersion: true, quoteNumber: true } });
  const base = q ? codeLabel(q) : "";
  if (!base) return true;
  const ds: { projectCode: string | null }[] = await tx.personnelRecord.findMany({
    where: { projectCode: { startsWith: base } }, select: { projectCode: true }, includeDeleted: true,
  } as any);
  return !ds.some((r) => {
    const duoi = String(r.projectCode || "").slice(base.length);
    return duoi === "" || /^_\d{2,}$/.test(duoi);   // đúng mã của báo giá này, không bắt nhầm bản _v2
  });
}

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
/**
 * Cờ DUYỆT của hàng bảng Hà Nội: ai KHÔNG có `quote:internal:approve` thì lấy lại theo `rid` từ CSDL.
 *
 * `reconcileExtraApprovals` CỐ Ý chỉ xử lý "hcm"/"khach" — duyệt Hà Nội là luồng riêng ở mức báo
 * giá (`hnStatus`), không phải theo hàng. Nhưng `sanitizeHnTables` vẫn ghi `approved*` xuống CSDL
 * nguyên trạng, nên không chặn ở đây thì người điền tự đóng dấu duyệt cho hàng của chính mình.
 * Hàng mới (chưa có `rid` trong CSDL) → chưa duyệt. Mutate tại chỗ, đối xứng với reconcileExtra*.
 *
 * Nhận cùng hình dạng `[{ extraTables }]` như hai hàm kia để hai đường gọi (saveHn của account Hà
 * Nội, và đường lưu của chủ báo giá) dùng chung đúng một luật.
 */
export function reconcileHnApprovals(list: any[], listDb: any[], canApprove: boolean) {
  if (canApprove) return;
  const prior = new Map<string, { approved: boolean; approvedAt: any; approvedBy: any }>();
  for (const s of listDb || []) {
    for (const t of Array.isArray(s.extraTables) ? s.extraTables : []) {
      for (const it of t?.items || []) {
        if (it && it.rid && !prior.has(it.rid)) prior.set(it.rid, { approved: !!it.approved, approvedAt: it.approvedAt || null, approvedBy: it.approvedBy ?? null });
      }
    }
  }
  for (const s of list) {
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

function chotHnTables(b: any, existing: any, canManage: boolean) {
  if (b.hnTables === undefined) return;                       // client không gửi → không đụng
  if (canManage) return;                                      // người duyệt phần HN thì được sửa
  if (!["submitted", "approved"].includes(existing.hnStatus ?? "")) return;
  // Giá HN đã gửi duyệt / đã duyệt: KHÔNG ai ghi đè qua đường lưu báo giá.
  // GIỐNG thì im lặng bỏ qua (client round-trip nguyên vẹn, không có gì để báo), KHÁC thì 409 —
  // tuyệt đối không vứt im lặng phần người ta vừa gõ.
  const moiNhat = vanTayHn(b.hnTables);
  const cu = vanTayHn(Array.isArray(existing.hnTables) ? existing.hnTables : []);
  if (moiNhat !== cu) {
    throw httpError(409, "Phần giá Hà Nội đã chốt nên không sửa được ở đây. Hãy chép lại phần vừa gõ, tải lại trang, rồi nhờ người phụ trách phần Hà Nội mở lại.");
  }
  delete b.hnTables;   // giống hệt CSDL → khỏi ghi lại
}

// ───────── PHẠM VI CỦA "ACCOUNT PHỤ" (QuoteMember.scopes) ─────────
// Chủ báo giá tick cho từng người: Báo giá chính · Chi phí HCM · Giá Hà Nội · Phí khách hàng.
// Không tick ô nào = chỉ xem (canOnQuote đã chặn từ trước, không xuống tới đây).

/** Field thuộc vùng "main" — thông tin khách, đầu trang, và DANH TÍNH người gửi. */
const FIELD_VUNG_MAIN = [
  "title", "shortTitle", "greeting", "notes",
  "toCompany", "toContact", "toEmail", "toPhone", "toAddress", "customerId",
  "fromContact", "fromAddress", "fromPhone", "fromTitle",
  "city", "quoteDate", "executionDate", "vatPercent", "showTotals", "companyId", "quoteNumber", "discount",
];

/**
 * Bảng thuộc category NGOÀI phạm vi → lấy lại bản CSDL, y khuôn `reconcileHanoiTables`.
 * Dùng cho account phụ CÓ vùng "main" (payload vẫn xoá-tạo-lại sheet) nhưng thiếu vài bảng nội bộ.
 */
export function reconcilePhamViTables(sheets: any[], carry: (Record<string, any> | undefined)[], choPhep: Set<string>) {
  const chan = ["hcm", "khach"].filter((c) => !choPhep.has(c));   // "hanoi" nay ở cấp báo giá
  if (!chan.length) return;
  (sheets || []).forEach((s: any, i: number) => {
    const list = Array.isArray(s?.extraTables) ? s.extraTables : [];
    const dbAll = Array.isArray(carry[i]?.extraTables) ? carry[i]!.extraTables : [];
    for (const cat of chan) {
      const db = dbAll.filter((t: any) => t && t.category === cat);
      const soTrongPayload = list.filter((t: any) => t && t.category === cat).length;
      if (!db.length && !soTrongPayload) continue;
      if (soTrongPayload > db.length) {
        throw httpError(409, `Bạn không được giao phần "${tenPhamVi(cat)}" của báo giá này nên không thêm được bảng ở đó. Hãy chép lại phần vừa gõ rồi tải lại trang.`);
      }
    }
    const conLai = dbAll.filter((t: any) => t && chan.includes(t.category));
    const out: any[] = [];
    let k = 0;
    for (const t of list) {
      if (t && chan.includes(t.category)) { if (k < conLai.length) out.push(conLai[k++]); }
      else out.push(t);
    }
    while (k < conLai.length) out.push(conLai[k++]);
    s.extraTables = out;
  });
}

/**
 * RID của hàng mà account phụ KHÔNG được đụng chỉ thuộc về hàng đó (KT-6 + phạm vi account phụ).
 *
 * Account phụ đọc được rid của MỌI bảng (presentQuote trả đủ), nên chép được rid của một hàng ngoài phạm vi của họ —
 * bảng loại không được giao, hay trang mà payload không nhắc tới — sang bảng của mình. Để nguyên cho `tachRidTrung` thì
 * luật "hàng ĐẦU giữ rid" quyết theo VỊ TRÍ: hàng chép đặt ở trang đứng trước là hàng GỐC mất rid → khoản kế toán
 * (khoá theo rid) dính sang hàng chép, hàng gốc thành "chưa chi" và kế toán chi lần hai. Ở đường có vùng "main" còn tệ
 * hơn: bảng ngoài phạm vi được `reconcilePhamViTables` lấy lại từ CSDL SAU khi tách, nên hai hàng trùng rid xuống đĩa —
 * và hàng chép đã kịp ăn theo dấu DUYỆT của hàng gốc (reconcileExtraApprovals kế thừa theo rid; duyệt là việc chỉ người
 * có quote:internal:approve được làm). ĐO ĐƯỢC ở tests/hddv-luu-khong-mat-khoan-chi.test.js.
 *
 * Nên: hàng của payload (`bangPayload`) mang rid CHỈ có ở phần CSDL giữ nguyên (`bangGiu`) nhận rid MỚI — gọi TRƯỚC
 * tachRidTrung và hai lần reconcile. Rid có cả ở phần được sửa (`bangSua`: dữ liệu cũ đã trùng sẵn) thì để luật hàng-đầu
 * lo như trước: không cắt cờ của một hàng hợp lệ đang được round-trip. Mutate tại chỗ; trả số hàng đã đổi rid.
 */
function catRidMuonNgoaiPhamVi(bangPayload: unknown[], bangGiu: unknown[], bangSua: unknown[]): number {
  const ridCua = (tables: unknown[]) => {
    const s = new Set<string>();
    for (const { it } of hangCuaPhia("sheet", tables)) if (typeof it.rid === "string" && it.rid.trim()) s.add(it.rid.trim());
    return s;
  };
  const giu = ridCua(bangGiu);
  if (!giu.size) return 0;
  const sua = ridCua(bangSua);
  let n = 0;
  for (const { it } of hangCuaPhia("sheet", bangPayload)) {
    const rid = typeof it.rid === "string" ? it.rid.trim() : "";
    if (rid && giu.has(rid) && !sua.has(rid)) { it.rid = randomUUID(); n++; }
  }
  return n;
}

/**
 * Account phụ KHÔNG có vùng "main": ghi ĐÚNG những bảng nội bộ được giao, không đụng sheet.
 *
 * Đi theo khuôn `saveHn` (src/hnWorkflow.ts) chứ KHÔNG theo đường xoá-sheet-tạo-lại của
 * `updateQuote`, vì ba lý do đều là mất dữ liệu nếu làm khác:
 *   · xoá-tạo-lại đổi mọi `QuoteSheet.id` và tiêu một số mã sản xuất cho việc không liên quan;
 *   · tổng tiền được tính TRƯỚC transaction từ `items` của payload — mà người này không được
 *     phép đổi items, nên để payload lái là mở đúng cửa hậu vừa khoá ở trên;
 *   · `carrySheetState` bê trạng thái mức sheet (số hoá đơn, chữ ký) — không xoá thì không phải bê.
 * Khoá QuoteSheet TRƯỚC Quote, đúng thứ tự mọi đường ghi khác đang dùng (chống deadlock).
 */
async function ghiVungNoiBoDuocGiao(tx: TxClient, id: number, ptSheets: any[], choPhep: Set<string>, req: Request) {
  await tx.$queryRaw`SELECT id FROM "QuoteSheet" WHERE "quoteId" = ${id} ORDER BY id FOR UPDATE`;
  const sheetsDb: any[] = await tx.quoteSheet.findMany({ where: { quoteId: id }, orderBy: { id: "asc" }, select: { id: true, order: true, extraTables: true } });
  // KT-5: khoá Quote (SAU QuoteSheet — đúng thứ tự mọi đường ghi) RỒI mới đọc khoản kế toán. Kế toán ghi khoản dưới
  // Quote FOR SHARE, nên từ đây tới lúc commit không ai tích chen vào được — chốt "hàng đã chi" bên dưới đọc bản tươi.
  await tx.$queryRaw`SELECT id FROM "Quote" WHERE id = ${id} FOR NO KEY UPDATE`;
  const khoan = await docKhoanChiTrongTx(tx, id);
  // Sheet ĐÃ CHẾT (chủ báo giá vừa bấm Lưu → id đổi hết) → 409, tuyệt đối không im lặng trả 200.
  // Cùng suy đoán theo dấu vết như saveHn: id NHỎ HƠN mọi sheet hiện có = dấu vết xoá-tạo-lại.
  const idNhoNhat = sheetsDb.length ? Math.min(...sheetsDb.map((s) => s.id)) : 0;
  const coSheetChet = (ptSheets || []).some((ps: any) => {
    const sid = Number(ps?.id);
    if (!Number.isFinite(sid) || sid <= 0) return false;
    return sheetsDb.length > 0 && !sheetsDb.some((s) => s.id === sid) && sid < idNhoNhat;
  });
  if (coSheetChet) throw httpError(409, "Chủ báo giá vừa lưu lại nên các trang đã được tạo mới. Hãy tải lại trang rồi nhập lại phần của bạn (đừng đóng tab trước khi chép phần vừa gõ).");

  // Ba phần cho chốt rid ngay dưới: CSDL GIỮ NGUYÊN (bảng ngoài phạm vi + trang payload không nhắc tới), CSDL ĐƯỢC SỬA
  // (bảng trong phạm vi của trang có trong payload — payload thay hẳn chúng) và bảng MỚI của payload.
  const bangGiu: any[] = [];
  const bangSua: any[] = [];
  const bangMoi: any[] = [];
  const toWrite = sheetsDb.map((sdb) => {
    const ps = (ptSheets || []).find((x: any) => Number(x?.id) === sdb.id);
    const dbAll = Array.isArray(sdb.extraTables) ? sdb.extraTables : [];
    // Payload KHÔNG nhắc tới trang này → giữ nguyên. (Chủ vừa thêm trang mới, hoặc client cũ.)
    if (!ps) { bangGiu.push(...dbAll); return { extraTables: dbAll }; }
    const giuNguyen = dbAll.filter((t: any) => t && !choPhep.has(t.category));
    const moi = sanitizeExtraTables((Array.isArray(ps.extraTables) ? ps.extraTables : []).filter((t: any) => t && choPhep.has(t.category))) || [];
    bangGiu.push(...giuNguyen);
    bangSua.push(...dbAll.filter((t: any) => t && choPhep.has(t.category)));
    bangMoi.push(...moi);
    return { extraTables: [...giuNguyen, ...moi] };
  });

  // rid TRÙNG CÓ SẴN trong CSDL (dữ liệu cũ): bản đầu theo thứ tự HIỂN THỊ giữ rid (chủ khoản kế toán), các bản sau nhận
  // rid mới — bảng giữ nguyên dùng chung đối tượng nên đổi luôn ở bản ghi xuống, cờ đi theo nguyên vẹn; hàng payload ghép
  // theo thứ tự với bản CSDL nó thay thế (src/khoanChi.ts chuanHoaRidTrung). Hàng đã trả (cũ) thiếu rid → từ chối.
  const dbTheoThuTu = sapTheoThuTu(sheetsDb);
  chuanHoaRidTrung("sheet", bangCuaSheets(dbTheoThuTu), bangCuaSheets(toWrite));
  const thieuMa = hangVetThieuRid("sheet", bangCuaSheets(dbTheoThuTu));
  if (thieuMa.length) throw loiVetThieuRid(thieuMa);
  // rid trùng (KT-6): hàng payload mượn rid của phần CSDL giữ nguyên → rid mới, KỂ CẢ khi nó đứng ở trang TRƯỚC hàng gốc
  // (thứ tự duyệt theo id trang — "bảng giữ nguyên đứng trước" chỉ đúng trong MỘT trang). Trùng còn lại: hàng đầu giữ.
  catRidMuonNgoaiPhamVi(bangMoi, bangGiu, bangSua);
  tachRidTrung("sheet", bangCuaSheets(toWrite));
  // Cờ duyệt theo CSDL trừ khi có quyền duyệt; cờ đã-chi / ảnh chứng từ LUÔN theo CSDL (đóng băng) — đúng bộ chốt mà
  // đường lưu thường đang chạy, chỉ khác là chạy trên bản đã lọc theo phạm vi.
  const daChi = tapDaChi("sheet", bangCuaSheets(sheetsDb), khoan);
  reconcileExtraApprovals(toWrite, sheetsDb, can(req.session, P.QUOTE_INTERNAL_APPROVE), req.session.userId!);
  reconcileExtraPayments(toWrite, sheetsDb, { daChi, mienChotTien: can(req.session, P.INVOICE_INPUT_PAY) });
  // KT-4: hàng ĐÃ CHI không được biến mất qua đường Lưu.
  const mat = hangDaChiBiMat("sheet", bangCuaSheets(sheetsDb), bangCuaSheets(toWrite), daChi);
  if (mat.length) throw loiHangDaChi(mat);

  for (let i = 0; i < sheetsDb.length; i++) {
    await tx.quoteSheet.update({ where: { id: sheetsDb[i].id }, data: { extraTables: toWrite[i].extraTables as any } });
  }
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

  // Bản đọc RÚT GỌN (QUOTE_UPDATE_STATE_SELECT, src/quoteUtils.ts): CỐ Ý không kèm `images` của
  // hạng mục lẫn `extraTables` của sheet — cả hai chứa base64 nặng mà đường lưu không hề đọc tới.
  // Ảnh vẫn về đủ ở phản hồi cuối hàm (lần đọc đó mới là lần editor cần).
  const existing: any = await prisma.quote.findFirst({ where: { id }, select: QUOTE_UPDATE_STATE_SELECT as any });
  if (!existing) throw httpError(404, "Không tìm thấy báo giá");
  if (!canEdit(existing, req.session)) throw httpError(403, "Bạn không thể sửa báo giá này");

  // ── PHẠM VI CỦA "ACCOUNT PHỤ" ─────────────────────────────────────────────────────────────
  // Chủ báo giá (và quote:update:all) luôn đủ 4 vùng → `duPhamVi` = true và mọi thứ dưới đây là
  // no-op, đường lưu chạy y hệt trước. Chỉ người ĐƯỢC THÊM VÀO mới bị lọc.
  //
  // Lọc ở ĐÂY chứ không ở trong transaction, vì ba thứ chạy trước đó và KHÔNG rollback được:
  // `syncQuoteCounter` (ghi bộ đếm số báo giá của công ty), `priceAffecting` (bump currentVersion,
  // kéo báo giá đã gửi về draft + báo cho người tạo), và `searchText` (nhiễm cả chỉ mục tìm kiếm).
  const phamVi = quoteScopesFor(req.session, existing) ?? [...QUOTE_SCOPES];
  const duPhamVi = QUOTE_SCOPES.every((c) => phamVi.includes(c));
  const catChoPhep = new Set(phamVi.filter((c) => c !== "main" && c !== "hanoi"));
  // Bảng Hà Nội nay là MỘT CỘT của báo giá, không nằm trong trang nào → không đi qua
  // `ghiVungNoiBoDuocGiao`/`reconcilePhamViTables` nữa mà xử lý thẳng ở đây.
  if (b.hnTables !== undefined && !phamVi.includes("hanoi")) delete (b as any).hnTables;
  // Account PHỤ có quote:hn:manage (mọi manager đều có) KHÔNG được sửa thẳng giá HN đã duyệt
  // (RBAC-07): reviewHn đã cấm phụ duyệt/trả phần HN, mà sửa thẳng số đã chốt còn nặng hơn.
  // (chotHnTables chạy TRONG transaction, trên bản Quote đã khoá — xem `hnTablesDeGhi` bên dưới.)
  const quanLyHn = can(req.session, P.QUOTE_HN_MANAGE) && !laAccountPhu(req.session, existing);
  let vungNoiBo: any[] | null = null;
  if (!duPhamVi && !phamVi.includes("main")) {
    // Không được giao "Báo giá chính": mọi field danh tính/khách/đầu trang bị GỠ khỏi payload —
    // kể cả `fromContact/fromTitle/fromPhone` ("Người gửi" in ra Excel) và `quoteNumber`. Báo giá
    // phải vẫn là của chủ, đầy đủ.
    for (const f of FIELD_VUNG_MAIN) delete (b as any)[f];
    // Và BỎ HẲN `sheets` khỏi payload: nhánh dưới sẽ không xoá-tạo-lại sheet, không tính lại tiền.
    // Phần bảng nội bộ được giao đi đường riêng (ghiVungNoiBoDuocGiao).
    if (Array.isArray(b.sheets)) { vungNoiBo = b.sheets; delete (b as any).sheets; }
  }
  // ĐỔI KHÁCH HÀNG (danh mục) ở màn soạn — chỉ kiểm khi giá trị THAY ĐỔI (xem kiemKhachDuocGan). Đặt SAU khối phạm vi trên: người
  // không có vùng "main" đã bị gỡ `customerId` khỏi payload nên không bao giờ tới đây. `null` = gỡ liên kết: luôn cho.
  const doiKhach = b.customerId !== undefined && (b.customerId ?? null) !== (existing.customerId ?? null);
  if (doiKhach && b.customerId != null) await kiemKhachDuocGan(req, b.customerId);

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
  // khoá QuoteSheet → Quote như các đường ghi khác (ghiVungNoiBoDuocGiao, saveHn) để không đẻ
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
  for (const f of ["toContact", "toEmail", "toPhone", "toAddress", "fromPhone", "fromTitle", "notes", "shortTitle"]) {
    if (b[f] !== undefined) data[f] = b[f] || null;
  }
  if (b.quoteDate) data.quoteDate = b.quoteDate;
  if (b.executionDate !== undefined) data.executionDate = b.executionDate || null;
  if (b.customerId !== undefined) data.customerId = b.customerId ?? null;
  if (b.vatPercent !== undefined) data.vatPercent = chuanHoaVat(b.vatPercent);   // đúng thang Decimal(5,2) — MONEY-02
  // `b.discount` (mức báo giá) CỐ Ý bị bỏ qua: giảm giá nay ở mức SHEET và `Quote.discount` được
  // computeQuoteTotals suy ra = Σ các sheet. Nhận số client gửi ở đây là mở đường ghi đè nó.
  if (b.showTotals !== undefined) data.showTotals = b.showTotals;
  // Bảng Hà Nội: chuẩn hoá rồi ghi thẳng cột của Quote. Cờ duyệt + cờ đã-chi + ảnh chứng từ do SERVER sở hữu nên
  // phải lấy lại từ CSDL trước khi ghi — `sanitizeHnTables` chỉ chuẩn hoá hình dạng, nó persist nguyên trạng mọi cờ
  // client gửi lên. Dùng ĐÚNG hai hàm mà saveHn dùng, để hai đường ghi (chủ báo giá ở đây, account Hà Nội ở
  // PUT /:id/hn) không trôi khỏi nhau.
  //
  // CHẠY TRONG TRANSACTION, trên bản Quote ĐÃ KHOÁ (KT-5): bản trước reconcile trên `existing` đọc NGOÀI transaction,
  // nên một lần ghi HN chen giữa (account HN lưu, kế toán tích) bị lần Lưu này đè bằng cờ cũ. Và chốt "hàng đã chi
  // không được biến mất" (KT-4) phải đọc khoản kế toán SAU khi khoá Quote — kế toán ghi dưới Quote FOR SHARE.
  const hnTablesDeGhi = (qTuoi: { hnStatus: string | null; hnTables: unknown }, khoan: Awaited<ReturnType<typeof docKhoanChiTrongTx>>) => {
    if (b.hnTables === undefined) return;
    chotHnTables(b, qTuoi, quanLyHn);                // HN đã chốt: giống CSDL → bỏ qua; khác → 409
    if (b.hnTables === undefined) return;
    const hnDb = Array.isArray(qTuoi.hnTables) ? qTuoi.hnTables : [];
    // rid trùng CÓ SẴN trong CSDL → ghép theo thứ tự trước reconcile; hàng đã trả (cũ) thiếu rid → từ chối (khoanChi.ts).
    chuanHoaRidTrung("hn", hnDb, b.hnTables);
    const thieuMa = hangVetThieuRid("hn", hnDb);
    if (thieuMa.length) throw loiVetThieuRid(thieuMa);
    tachRidTrung("hn", b.hnTables);
    const daChi = tapDaChi("hn", hnDb, khoan);
    const bocHn = [{ extraTables: b.hnTables }];
    const bocHnDb = [{ extraTables: hnDb }];
    reconcileExtraPayments(bocHn, bocHnDb, { daChi, mienChotTien: can(req.session, P.INVOICE_INPUT_PAY) });
    reconcileHnApprovals(bocHn, bocHnDb, can(req.session, P.QUOTE_INTERNAL_APPROVE));
    const mat = hangDaChiBiMat("hn", hnDb, bocHn[0].extraTables, daChi);
    if (mat.length) throw loiHangDaChi(mat);
    data.hnTables = sanitizeHnTables(bocHn[0].extraTables);
  };
  if (b.companyId !== undefined) data.companyId = b.companyId;
  let dongBoSo: { so: string; prefix: string } | null = null;
  if (b.quoteNumber !== undefined && b.quoteNumber !== existing.quoteNumber) {
    const dup = await prisma.quote.findFirst({ where: { quoteNumber: b.quoteNumber }, includeDeleted: true } as any);
    if (dup) {
      throw httpError(409, dup.deletedAt ? "Số báo giá đã dùng (thuộc báo giá đã xoá)" : "Số báo giá đã tồn tại");
    }
    data.quoteNumber = b.quoteNumber;
    // ĐỔI số cũng làm lệch bộ đếm y như lúc tạo: số mới có thể nằm CAO hơn vùng đã cấp, và lần
    // cấp tự động kế tiếp sẽ đâm vào nó. Prefix lấy theo công ty SẼ ghi (payload có thể đổi công ty).
    //
    // ĐẨY BỘ ĐẾM TRONG TRANSACTION GHI, KHÔNG PHẢI TRƯỚC NÓ (MONEY-08): bản trước gọi ngay đây, NGOÀI
    // transaction — lần Lưu sau đó hỏng (409 khoá lạc quan, 400 tổng âm…) vẫn để bộ đếm nhảy lên số
    // vừa gõ, và GREATEST không bao giờ lùi. Nay chỉ ghi nhớ; hai nhánh ghi bên dưới gọi trong tx.
    const cty = await prisma.company.findFirst({ where: { id: data.companyId ?? existing.companyId }, select: { quotePrefix: true } });
    dongBoSo = { so: b.quoteNumber, prefix: cty?.quotePrefix || "GN" };
  }

  // Price-affecting edit on a quote already in the pipeline -> reopen to draft.
  const priceAffecting = Array.isArray(b.sheets) || data.vatPercent !== undefined;
  // `increment` NGUYÊN TỬ thay vì `existing + 1` đọc ngoài transaction (MONEY-06): hai lần Lưu đồng
  // thời (client không gửi mốc) từng cùng ra một versionNo → snapshotQuoteVersion upsert đè mất một
  // phiên bản lịch sử. snapshotQuoteVersion đọc lại currentVersion TRONG tx sau lệnh update.
  if (priceAffecting) data.currentVersion = { increment: 1 };
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
    let vatPct = data.vatPercent ?? existing.vatPercent;
    // ── TAB CŨ KHÔNG ĐƯỢC XOÁ DISCOUNT ────────────────────────────────────────────────────────
    // `sheets[].discount` là trường MỚI và là optional trong sheetSchema, nên một tab trình duyệt
    // đang chạy bundle CŨ (mở trước lúc deploy) gửi payload KHÔNG có khoá đó. Không xử lý thì
    // `undefined` → 0 → một lần bấm Lưu ở tab đó XOÁ SẠCH giảm giá của mọi sheet, mà vẫn báo
    // "Đã lưu". Vắng mặt ⇒ GIỮ số đang có trong CSDL (ghép theo sheet.id); gửi 0 tường minh thì
    // mới là "xoá", và chỉ bundle mới gửi được như vậy (nó luôn gửi một con số).
    const discCu = new Map<number, unknown>((existing.sheets || []).map((sh: any) => [sh.id, sh.discount]));
    for (const sh of b.sheets as any[]) {
      if (sh && sh.discount === undefined && sh.id != null && discCu.has(Number(sh.id))) {
        sh.discount = discCu.get(Number(sh.id));
      }
    }
    await chuanHoaSoNgayTheoMau(b.sheets);   // mẫu không có cột Số Ngày → days=null TRƯỚC khi tính (xem quoteUtils)
    chuanHoaTheoCot(b.sheets);   // SL/đơn giá/ngày về đúng thang cột CSDL → tổng lưu = tổng đọc lại (MONEY-02)
    const t = computeQuoteTotals({ vatPercent: vatPct, sheets: b.sheets });
    assertTotalsStorable(t, b.sheets);
    data.subtotal = t.subtotal;
    data.vat = t.vat;
    data.discount = t.discount;
    data.total = t.total;
    updated = await prisma.$transaction(async (tx) => {
      // KHOÁ RỒI MỚI ĐỌC, TẤT CẢ TRONG TRANSACTION — y hệt `saveHn` (src/hnWorkflow.ts).
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
      // KT-5: khoá Quote NGAY SAU QuoteSheet (thứ tự mọi đường ghi vẫn là QuoteSheet → Quote) rồi mới đọc khoản kế
      // toán. Kế toán ghi khoản dưới Quote FOR SHARE — từ đây tới lúc commit không ai tích chen vào được, nên chốt
      // "hàng đã chi không được biến mất" bên dưới thấy bản TƯƠI. Đọc kèm bảng Hà Nội TƯƠI cho `hnTablesDeGhi`.
      const [qKhoa] = await tx.$queryRaw<{ hnStatus: string | null; hnTables: unknown }[]>`SELECT "hnStatus", "hnTables" FROM "Quote" WHERE id = ${id} FOR NO KEY UPDATE`;
      const khoan = await docKhoanChiTrongTx(tx, id);
      // VAT TƯƠI (MONEY-06): `vatPct` lấy từ `existing` đọc NGOÀI transaction. Một lần đổi RIÊNG VAT
      // chen giữa sẽ bị lần Lưu này ghi đè tổng bằng VAT cũ (Quote.vatPercent = 10 mà total tính 8%).
      // Mọi đường ghi đều khoá QuoteSheet trước, nên đọc SAU khoá là thấy VAT đã commit của lượt kia.
      if (data.vatPercent === undefined) {
        const [vq] = await tx.$queryRaw<{ vatPercent: unknown }[]>`SELECT "vatPercent" FROM "Quote" WHERE id = ${id}`;
        if (vq && !D(vq.vatPercent as any).equals(D(vatPct))) {
          const t2 = computeQuoteTotals({ vatPercent: vq.vatPercent as any, sheets: b.sheets });
          data.vat = t2.vat;
          data.total = t2.total;
          vatPct = vq.vatPercent as any;
        }
      }
      // Cờ BẬT thì phải đọc kèm `items` để so được "trang này có đổi không". Đo được
      // (scripts/bench/quote-save-bench.mjs): 94,7 ms cho 10.000 dòng — rẻ hơn hai bậc độ lớn so
      // với 3.940 ms của lần ghi mà nó giúp tránh. Cờ TẮT thì KHÔNG đọc, để đường mặc định không
      // gánh thêm một xu chi phí nào.
      const sheetsTuoi: any[] = await tx.quoteSheet.findMany({
        where: { quoteId: id },
        orderBy: { id: "asc" },
        ...(config.INCREMENTAL_QUOTE_SAVE ? { include: { items: { orderBy: { order: "asc" } } } } : {}),
      });

      // rid TRÙNG CÓ SẴN trong CSDL (dữ liệu cũ): ghép từng bản với bản tương ứng của payload theo thứ tự HIỂN THỊ, TRƯỚC
      // mọi reconcile — bản đầu (chủ khoản kế toán) giữ rid, các bản sau nhận rid mới ở CẢ hai phía nên mỗi hàng kế thừa
      // đúng cờ của chính nó (src/khoanChi.ts chuanHoaRidTrung). Bảng ngoài phạm vi được reconcilePhamViTables lấy lại từ
      // chính các đối tượng CSDL này nên mang rid đã tách. Hàng đã trả (cũ) thiếu rid → từ chối (lần Lưu sẽ xoá im cờ).
      chuanHoaRidTrung("sheet", bangCuaSheets(sapTheoThuTu(sheetsTuoi)), bangCuaSheets(b.sheets));
      const thieuMa = hangVetThieuRid("sheet", bangCuaSheets(sheetsTuoi));
      if (thieuMa.length) throw loiVetThieuRid(thieuMa);
      // Account phụ thiếu vài bảng nội bộ: bảng ngoài phạm vi sẽ được LẤY LẠI từ CSDL (reconcilePhamViTables, bên dưới) →
      // hàng trong phạm vi của họ không được mượn rid của những bảng đó (xem catRidMuonNgoaiPhamVi). Chủ / quote:update:all
      // (đủ phạm vi) không qua bước này.
      if (!duPhamVi) {
        const ngoai = (t: any) => t && (t.category === "hcm" || t.category === "khach") && !catChoPhep.has(t.category);
        const trong = (t: any) => t && catChoPhep.has(t.category);
        const bangDb = bangCuaSheets(sheetsTuoi);
        catRidMuonNgoaiPhamVi(bangCuaSheets(b.sheets).filter(trong), bangDb.filter(ngoai), bangDb.filter(trong));
      }
      // rid trùng trong phía "sheet" (KT-6) → hàng sau nhận rid mới, TRƯỚC hai lần reconcile (khớp luật "kế thừa một lần").
      tachRidTrung("sheet", bangCuaSheets(b.sheets));
      // CHỈ người có quyền DUYỆT NỘI BỘ được đổi trạng thái duyệt hàng (HCM/Khách); còn lại giữ nguyên theo DB.
      reconcileExtraApprovals(b.sheets, sheetsTuoi, can(req.session, P.QUOTE_INTERNAL_APPROVE), userId);
      // Cờ đã-chi + ảnh cũ: đóng băng theo DB cho MỌI người; chốt số tiền theo trạng thái HIỆU LỰC (khoản thắng JSON).
      const daChiSheet = tapDaChi("sheet", bangCuaSheets(sheetsTuoi), khoan);
      reconcileExtraPayments(b.sheets, sheetsTuoi, { daChi: daChiSheet, mienChotTien: can(req.session, P.INVOICE_INPUT_PAY) });
      // Lưu = XOÁ sheet rồi TẠO LẠI → phải BÊ trạng thái mức sheet sang bản mới (khách duyệt sheet,
      // chữ ký, số hoá đơn/thanh toán…), nếu không mỗi lần bấm Lưu là mất sạch.
      const carry = carrySheetState(b.sheets, sheetsTuoi);
      // DOANH THU CHỐT ĐI THEO GIÁ MỚI (MONEY-01/RBAC-05). canEdit cho sửa báo giá đã chốt tới khi
      // có hoá đơn ("cập nhật giá thương lượng"), mà trước đây convertedTotal chỉ được ghi MỘT lần ở
      // markConverted → Dashboard/Top sales lệch khỏi tổng thật sau mỗi lần thương lượng lại.
      // Tính NGAY TRONG lệnh update chính (không thêm lệnh ghi Quote thứ hai: extension realtime bắn
      // một sự kiện SSE cho mỗi lần ghi, kể cả khi rollback). Trạng thái đọc SAU khi đã giữ khoá
      // QuoteSheet — markConverted khoá cùng hàng nên không chen được giữa đây và lúc commit.
      // `convertedTotal` NULL (chốt trước khi có cột) → giữ null, nơi đọc vẫn COALESCE về total.
      const [qTuoi] = await tx.$queryRaw<{ status: string; convertedTotal: unknown }[]>`SELECT status, "convertedTotal" FROM "Quote" WHERE id = ${id}`;
      if (qTuoi?.status === "converted" && qTuoi.convertedTotal != null) {
        (data as any).convertedTotal = tinhConvertedTotal(
          t.sheetTotals.map((st, i) => ({ subtotal: st.subtotal, custStatus: (carry[i] as any)?.custStatus ?? null })),
          vatPct
        );
      }
      // Account phụ CÓ vùng "main" nhưng thiếu vài bảng nội bộ: lấy lại bản CSDL cho những bảng đó.
      if (!duPhamVi) reconcilePhamViTables(b.sheets, carry, catChoPhep);
      // ...VÀ KHÔNG được thêm/xoá TRANG. Lưu là `deleteMany` rồi tạo lại: một người chỉ có vùng
      // "main" bấm ✕ xoá trang là cuốn theo cả bảng hcm/hanoi/khach của trang đó — gồm hàng đã
      // duyệt, đã đánh dấu thanh toán và ảnh chứng từ — mà `reconcilePhamViTables` không cứu được
      // vì nó ghép theo VỊ TRÍ: trang biến mất thì không còn vị trí nào để lấy lại.
      if (!duPhamVi) {
        const idDb = new Set(sheetsTuoi.map((s: any) => Number(s.id)));
        const idPayload = (b.sheets || []).map((s: any) => Number(s?.id)).filter((n: number) => Number.isFinite(n) && n > 0);
        // So CẢ tổng số trang: trang MỚI chưa có `id` nên nó rơi khỏi `idPayload` — chỉ đếm id là
        // chặn được xoá mà vẫn cho thêm (đúng lỗi bài test tvphu bắt được lúc 2026-09-15).
        const tongPayload = (b.sheets || []).length;
        if (tongPayload !== idDb.size || idPayload.length !== idDb.size || idPayload.some((i: number) => !idDb.has(i))) {
          throw httpError(409, "Bạn được thêm vào làm cùng báo giá này nên chỉ sửa được nội dung, không thêm/xoá trang. Hãy nhờ người tạo báo giá làm việc đó.");
        }
      }
      // KT-4: hàng ĐÃ CHI (hiệu lực) không được biến mất qua đường Lưu — xoá dòng, xoá bảng, xoá trang, hay một client cũ
      // gửi `extraTables: []`. So TẬP rid của cả phía nên chuyển bảng / "Chuyển loại" / đổi thứ tự trang không bị chặn.
      // 400 (không 409): màn soạn giữ nguyên phần đang soạn và toast câu báo nêu tên hàng.
      const matSheet = hangDaChiBiMat("sheet", bangCuaSheets(sheetsTuoi), bangCuaSheets(b.sheets), daChiSheet);
      if (matSheet.length) throw loiHangDaChi(matSheet);
      // Bảng Hà Nội (nếu payload có): chốt + reconcile trên bản Quote vừa khoá — TRƯỚC khi xoá trang.
      hnTablesDeGhi(qKhoa ?? { hnStatus: null, hnTables: null }, khoan);

      const seqCu = Number((existing as any).sheetCodeSeq) || 0;
      // KÉO ĐỔI THỨ TỰ SHEET: mã sản xuất đi theo vị trí mới — nhưng CHỈ khi chưa mã nào của báo giá
      // được dùng (coTheDanhLaiMaSheet); account phụ (không đủ phạm vi) không được đánh lại mã.
      const danhLaiMa = b.danhLaiMaSheet === true && duPhamVi && (await coTheDanhLaiMaSheet(tx, id, sheetsTuoi));
      const sheetsGhi = buildSheetsCreate(b.sheets, t.sheetTotals, carry, seqCu, danhLaiMa);
      // Mốc nước CHỈ TĂNG: ghi lại để lượt lưu sau không cấp lại mã của sheet vừa bị xoá. Đánh lại mã
      // (đã kiểm không mã nào được dùng) thì mốc về đúng số sheet — sheet thêm sau nối tiếp liền mạch.
      (data as any).sheetCodeSeq = danhLaiMa ? sheetsGhi.length : mocSoMaSheet(sheetsGhi as any, seqCu);

      // ── GHI TĂNG DẦN Ở MỨC TRANG (cờ INCREMENTAL_QUOTE_SAVE) ──────────────
      // Trang nào ghi đè lên chính nó KHÔNG đổi một byte thì không xoá, không tạo lại. Lý lẽ và số
      // đo: src/quoteSheetDiff.ts. `carry[i]` CHÍNH LÀ hàng CSDL tương ứng với trang thứ i của
      // payload (carrySheetState dò theo sheet.id, không có id thì theo thứ tự) — nên phép ghép
      // dùng lại đúng thứ mà đường lưu vẫn dùng, không đẻ thêm luật ghép thứ hai.
      const giuLai: number[] = [];
      let sheetsTao = sheetsGhi;
      if (config.INCREMENTAL_QUOTE_SAVE) {
        const canTao: any[] = [];
        sheetsGhi.forEach((m: any, i: number) => {
          const cu = carry[i] as any;
          if (cu && sheetKhongDoi(m, cu)) giuLai.push(Number(cu.id));
          else canTao.push(m);
        });
        sheetsTao = canTao;
      }
      // Trang GIỮ LẠI phải nằm ngoài lệnh xoá. Danh sách rỗng thì `notIn: []` vẫn hợp lệ nhưng viết
      // tường minh cho rõ: không giữ gì thì xoá sạch, y như đường cũ.
      await tx.quoteSheet.deleteMany({
        where: { quoteId: id, ...(giuLai.length ? { id: { notIn: giuLai } } : {}) },
      });
      await chotKhoaLacQuan(tx);
      if (dongBoSo) await syncQuoteCounter(dongBoSo.so, dongBoSo.prefix, tx as any);
      const u = await tx.quote.update({
        where: { id },
        data: { ...data, sheets: { create: sheetsTao } },
        include: QUOTE_INCLUDE as any,
      });
      await snapshotQuoteVersion(tx, id, userId, "update");
      return u;
    });
  } else {
    let tVat: ReturnType<typeof computeQuoteTotals> | null = null;
    if (data.vatPercent !== undefined) {
      // Đổi RIÊNG VAT: giảm giá từng sheet lấy từ CSDL (QUOTE_UPDATE_STATE_SELECT có `discount`).
      const t = computeQuoteTotals({ vatPercent: data.vatPercent ?? existing.vatPercent, sheets: existing.sheets });
      assertTotalsStorable(t, existing.sheets);
      data.subtotal = t.subtotal;
      data.vat = t.vat;
      data.discount = t.discount;
      data.total = t.total;
      tVat = t;
    }
    updated = await prisma.$transaction(async (tx) => {
      // Khoá QuoteSheet TRƯỚC Quote (chotKhoaLacQuan) — đúng thứ tự của mọi đường ghi khác.
      if (vungNoiBo) await ghiVungNoiBoDuocGiao(tx, id, vungNoiBo, catChoPhep, req);
      if (tVat) {
        // TÍNH LẠI TỔNG TỪ HẠNG MỤC TƯƠI, SAU KHI ĐÃ KHOÁ QuoteSheet (MONEY-06). `existing` đọc NGOÀI
        // transaction: một lần Lưu sheet chen giữa lúc đó và lúc ghi làm lần đổi VAT này ghi tổng tính
        // từ hạng mục CŨ — Quote.total lệch hạng mục cho tới lần Lưu sau. Lần tính ngoài tx ở trên chỉ
        // còn là kiểm sớm (400 trước khi mở transaction).
        await tx.$queryRaw`SELECT id FROM "QuoteSheet" WHERE "quoteId" = ${id} ORDER BY id FOR UPDATE`;
        const sheetsTuoi = await tx.quoteSheet.findMany({
          where: { quoteId: id },
          orderBy: { order: "asc" },
          select: {
            id: true, name: true, groupSubtotal: true, discount: true, custStatus: true,
            items: { orderBy: { order: "asc" }, select: { kind: true, quantity: true, quantityExact: true, unitPrice: true, days: true } },
          },
        });
        const t = computeQuoteTotals({ vatPercent: data.vatPercent, sheets: sheetsTuoi as any });
        assertTotalsStorable(t, sheetsTuoi);
        data.subtotal = t.subtotal;
        data.vat = t.vat;
        data.discount = t.discount;
        data.total = t.total;
        // Đổi VAT trên báo giá đã chốt → doanh thu chốt đi theo (MONEY-01), cùng luật với nhánh trên.
        const [qTuoi] = await tx.$queryRaw<{ status: string; convertedTotal: unknown }[]>`SELECT status, "convertedTotal" FROM "Quote" WHERE id = ${id}`;
        if (qTuoi?.status === "converted" && qTuoi.convertedTotal != null) {
          (data as any).convertedTotal = tinhConvertedTotal(
            t.sheetTotals.map((st, i) => ({ subtotal: st.subtotal, custStatus: sheetsTuoi[i]?.custStatus ?? null })),
            data.vatPercent
          );
        }
      }
      if (b.hnTables !== undefined) {
        // KT-5: Quote FOR UPDATE (sau mọi khoá QuoteSheet phía trên) RỒI mới đọc bảng HN tươi + khoản kế toán.
        const [qKhoa] = await tx.$queryRaw<{ hnStatus: string | null; hnTables: unknown }[]>`SELECT "hnStatus", "hnTables" FROM "Quote" WHERE id = ${id} FOR NO KEY UPDATE`;
        hnTablesDeGhi(qKhoa ?? { hnStatus: null, hnTables: null }, await docKhoanChiTrongTx(tx, id));
      }
      await chotKhoaLacQuan(tx);
      if (dongBoSo) await syncQuoteCounter(dongBoSo.so, dongBoSo.prefix, tx as any);
      const u = await tx.quote.update({ where: { id }, data, include: QUOTE_INCLUDE as any });
      await snapshotQuoteVersion(tx, id, userId, "update");
      return u;
    });
  }

  // Đổi khách hàng (danh mục) là việc phải TRUY ĐƯỢC ("ai chuyển báo giá này sang khách khác?") — chỉ ghi khi có đổi, để nhật ký của
  // các lần Lưu thường giữ nguyên hình dạng cũ. Ghi cả MÃ + TÊN khách (`khachHang`) bên cạnh `customerId` kỹ thuật: người đọc trang
  // Nhật ký không đọc được số id. Khách cũ có thể đã bị xoá mềm → tra kèm `includeDeleted`.
  let khachNhatKy: { cu: string | null; moi: string | null } | null = null;
  if (doiKhach) {
    const tenKhach = async (cid: number | null | undefined) => {
      if (cid == null) return null;
      const k = await prisma.customer.findFirst({ where: { id: cid }, select: { code: true, name: true }, includeDeleted: true } as any);
      return k ? `${k.code} — ${k.name}` : `#${cid}`;
    };
    khachNhatKy = { cu: await tenKhach(existing.customerId), moi: await tenKhach(updated.customerId) };
  }
  await audit(req, "quote.update", {
    resource: "quote",
    resourceId: id,
    before: { total: Number(existing.total), status: existing.status, ...(khachNhatKy ? { customerId: existing.customerId ?? null, khachHang: khachNhatKy.cu } : {}) },
    after: { total: Number(updated.total), status: updated.status, reopened, ...(khachNhatKy ? { customerId: updated.customerId ?? null, khachHang: khachNhatKy.moi } : {}) },
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
  const page = Number(qy.page) || 1;
  const size = Number(qy.size) || config.DEFAULT_PAGE_SIZE;
  const sort = String(qy.sort);
  const order = qy.order;
  // Visibility scope (read:all = mọi báo giá, read:own = tự tạo/được thêm thành viên) kết hợp
  // với bộ lọc của user bằng AND để OR-phạm-vi không đụng OR-tìm-kiếm.
  // 🔒 CỔNG QUYỀN TRƯỚC PHẠM VI: không có quote:read:* nào → 403 (KHÔNG rơi xuống phạm vi own).
  // Nếu không, người bị gỡ sạch quyền báo giá vẫn thấy các báo giá mình tạo/được thêm thành viên.
  const filters: Prisma.QuoteWhereInput[] = [quoteScopeWhereOrThrow(req.session) as Prisma.QuoteWhereInput];
  // account_hn / xem-nội-bộ: cần BẢNG NỘI BỘ của từng sheet để tính SỐ SHEET HN + TỔNG HN (hoặc
  // số hàng nội bộ). Nhưng KHÔNG nạp qua `select` của Prisma: `extraTables` chứa cả `paidProof` —
  // ảnh chứng từ base64 hàng trăm KB mỗi cái — mà presentQuoteRow không hề đọc tới. Một trang danh
  // sách 12 báo giá đo được 7,2 MB base64 kéo về rồi vứt. Xem `bangNoiBoTheoBaoGia` bên dưới.
  // Đúng HAI quyền này cũng là thứ làm view bị LƯỢC (khối bộ lọc ngay dưới) nên `bienLuoc` chỉ là tên thứ hai của cùng một điều kiện
  // — tests/ops-cong-kiem.test.js khoá NGUYÊN VĂN dòng dưới (đường đo explain-hot-paths phải khớp nhánh này).
  const canBangNoiBo = can(req.session, P.QUOTE_HN_FILL) || can(req.session, P.QUOTE_INTERNAL_VIEW);
  const bienLuoc = canBangNoiBo;
  // BỘ LỌC + TÌM THÔNG MINH (chủ repo 2026-09-30) — luật ở src/quoteListFilter.ts. View lược (account HN / xem nội
  // bộ) giữ NGUYÊN cách tìm cũ và bị bỏ mọi bộ lọc chạm trường họ không thấy (tổng tiền, ghi chú, người tạo, khách
  // danh mục): lọc/tìm theo thứ người ta không được thấy là cách đọc trộm nó bằng cách dò.
  const loc = docBoLoc(qy);
  filters.push(...ghepLoc(locTheoChieu(loc, { ...(loc.q && !bienLuoc ? await nguoiVaCongTy() : { nguoi: [], congTy: [] }), bienLuoc })));
  const where = { AND: filters };
  // Đợt 5: danh sách mẫu CHỈ nhánh hnOnly của presentQuoteRow đọc (tính hnTotal). Route truyền
  // internalOnly = can(INTERNAL_VIEW) và presentQuoteRow xét nó TRƯỚC hnOnly → có INTERNAL_VIEW là không
  // bao giờ tới nhánh hnOnly; nạp mẫu cho họ là một truy vấn bỏ phí trên đường nóng, refetch thường xuyên.
  const canMauHn = can(req.session, P.QUOTE_HN_FILL) && !can(req.session, P.QUOTE_INTERNAL_VIEW);
  // Sắp theo "Tiêu đề": ô hiện tiêu đề RÚT GỌN (nếu có) hoặc tiêu đề chính cắt tiền tố — SQL không sắp được đúng chữ đó
  // (xem sapIdTheoTieuDe). Nên nạp (id, title, shortTitle) của đúng tập đã lọc, sắp ở JS, rồi chỉ nạp đủ dòng của TRANG này.
  // View lược không được sắp theo cột mới (như mọi cột mới) → rơi về createdAt ở nhánh dưới.
  let idTheoTieuDe: number[] | null = null;
  let tongTheoTieuDe = 0;
  if (!bienLuoc && sort === "title") {
    const ds = await prisma.quote.findMany({ where, select: { id: true, title: true, shortTitle: true } });
    tongTheoTieuDe = ds.length;
    idTheoTieuDe = sapIdTheoTieuDe(ds, order).slice((page - 1) * size, page * size);
  }
  const [total, rows] = await Promise.all([
    idTheoTieuDe ? tongTheoTieuDe : prisma.quote.count({ where }),
    prisma.quote.findMany({
      // Vẫn AND với `where` (phạm vi quyền) dù id đã lấy từ chính tập đó — không để một đường tắt nào nạp dòng ngoài phạm vi.
      where: idTheoTieuDe ? { AND: [...filters, { id: { in: idTheoTieuDe } }] } : where,
      orderBy: idTheoTieuDe ? undefined : orderByTheoCot(bienLuoc && !(COT_SAP_XEP_CU as readonly string[]).includes(sort) ? "createdAt" : sort, order),
      select: QUOTE_LIST_SELECT,   // slim projection — không sheets, không customerLogo
      ...(idTheoTieuDe ? {} : { skip: (page - 1) * size, take: size }),
    }),
  ]);
  if (idTheoTieuDe) {
    const viTri = new Map(idTheoTieuDe.map((id, i) => [id, i]));
    rows.sort((a, b) => (viTri.get(a.id) ?? 0) - (viTri.get(b.id) ?? 0));   // findMany không giữ thứ tự của `in`
  }
  // Số trang của từng báo giá — CHỈ cho id của trang này (vì sao không dùng `_count`: xem
  // QUOTE_LIST_SELECT). Gắn lại đúng hình dạng `_count.sheets` mà presentQuoteRow vẫn đọc.
  const soTrang = await soTrangTheoBaoGia(rows.map((r: any) => r.id));
  for (const r of rows as any[]) r._count = { sheets: soTrang.get(r.id) ?? 0 };
  // Ghi chú + màu ở dòng (QuoteListNote). CHỈ cho người đi nhánh đầy đủ của presentQuoteRow: hai nhánh lược
  // (account HN / xem nội bộ) chọn trường tường minh nên không có chỗ cho nó — không nạp thì đỡ một câu truy vấn.
  if (!canBangNoiBo && rows.length) {
    const ghiChu = await ghiChuTheoBaoGia(rows.map((r: any) => r.id));
    for (const r of rows as any[]) r.listNote = ghiChu.get(r.id) ?? null;
  }
  if (canBangNoiBo && rows.length) {
    // Bảng Hà Nội nay ở CẤP BÁO GIÁ nên phải nạp riêng — `presentQuoteRow` nhánh hnOnly đọc
    // `q.hnTables`. Cũng cắt ảnh ngay tại SQL, cùng lý do với bảng theo trang.
    const [hnTheoBaoGia, dsMau] = await Promise.all([bangHnTheoBaoGia(rows.map((r: any) => r.id)), canMauHn ? dsMauBangNoiBo() : null]);
    // Đợt 4: `hnTotal` của account HN tính theo mẫu của từng bảng như màn soạn (xem bangNoiBoCoNgay).
    // An toàn để gắn: người có bảng nội bộ luôn đi nhánh hnOnly/internalOnly của presentQuoteRow — hai
    // nhánh đó chọn trường tường minh, không trải `...q` ra phản hồi.
    for (const r of rows as any[]) { r.hnTables = hnTheoBaoGia.get(r.id) ?? []; if (dsMau) r._mauBangNoiBo = dsMau; }
    const theoBaoGia = await bangNoiBoTheoBaoGia(rows.map((r: any) => r.id));
    // Gắn vào ĐÚNG hình dạng mà presentQuoteRow vẫn đọc (`q.sheets[].extraTables`): cả hai nhánh
    // của nó đều flatMap qua MỌI sheet rồi mới đếm/cộng, nên gộp về một phần tử không đổi kết quả.
    for (const r of rows as any[]) r.sheets = [{ extraTables: theoBaoGia.get(r.id) ?? [] }];
    // Trạng thái đã-chi HIỆU LỰC (khoản kế toán thắng cờ JSON cũ — src/khoanChi.ts) để "Đã TT x/y" của tài khoản chi
    // phí đếm đúng thứ kế toán đã tích ở trang Hóa đơn đầu vào. CHỈ nhánh internalOnly của presentQuoteRow đếm đã chi
    // (route truyền internalOnly = can(INTERNAL_VIEW)); account HN đi nhánh hnOnly — không tốn câu đọc khoản trên đường nóng.
    if (can(req.session, P.QUOTE_INTERNAL_VIEW)) await phuKeToanDanhSach(rows as any[]);
  }
  return { rows, total, page, size };
}

/**
 * Số trang (QuoteSheet) của từng báo giá trong `ids`: MỘT câu `GROUP BY` lọc `quoteId IN (…)`, đi
 * index `QuoteSheet_quoteId_order_idx` — đọc đúng số trang của trang danh sách đang xem, không phải
 * cả bảng. Báo giá không có trang nào thì không có trong Map (người gọi lùi về 0).
 */
async function soTrangTheoBaoGia(ids: number[]): Promise<Map<number, number>> {
  if (!ids.length) return new Map();
  const nhom = await prisma.quoteSheet.groupBy({ by: ["quoteId"], where: { quoteId: { in: ids } }, _count: { _all: true } });
  return new Map(nhom.map((g) => [g.quoteId, g._count._all]));
}

/**
 * Bảng nội bộ GOM THEO BÁO GIÁ (thứ tự sheet: `order` rồi `id`) — hình dạng mà `presentQuoteRow`
 * đọc. Chỉ là lớp gộp trong JS trên `bangNoiBoTheoSheet`, để chỉ có MỘT câu SQL cắt `paidProof`
 * trong cả tệp: hai bản chép của quy tắc cắt ấy sẽ trôi khỏi nhau.
 */
async function bangNoiBoTheoBaoGia(ids: number[]) {
  const rows = await bangNoiBoTheoSheet(ids);
  rows.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.sheetId - b.sheetId);
  const out = new Map<number, any[]>();
  for (const r of rows) {
    const cu = out.get(r.quoteId);
    const them = Array.isArray(r.tables) ? r.tables : [];
    if (cu) cu.push(...them);
    else out.set(r.quoteId, [...them]);
  }
  return out;
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
  const year = namVN();   // NĂM THEO GIỜ VN — phải khớp nextQuoteNumber, nếu không xem-trước lệch số thật
  const c = await prisma.quoteCounter.findUnique({
    where: { prefix_year: { prefix, year } },
  });
  const yy = namNganVN();
  const nn = String((c?.value ?? 0) + 1).padStart(3, "0");
  return { quoteNumber: `${prefix}${yy}${nn}`, prefix, note: "Số chính thức sẽ được cấp khi lưu" };
}

/** Người dùng active có thể thêm làm thành viên/người gửi của báo giá. Chỉ trả tên/vai trò. */
export async function listAssignableUsers(req: Request) {
  // Minimal fields for the member/sender picker only. Do NOT leak the login
  // identifier (username) or phone of every employee to all authenticated users.
  const users = await prisma.user.findMany({
    where: { active: true },
    select: { id: true, displayName: true, role: true, title: true, senderName: true, permissions: true, canSign: true },
    orderBy: { displayName: "asc" },
  });
  // Cờ `coTheLamPhu`: tư cách thành viên KHÔNG tự cấp quyền — nhánh thành viên trong `canOnQuote`
  // nằm BÊN TRONG `if (can(…:own))` (chốt bảo mật cố ý, tests/security-regression.test.js). Nên
  // thêm một tài khoản không có `quote:read:own`/`update:own` (hr, kế toán) là NO-OP hoàn toàn
  // im lặng: họ vẫn không thấy báo giá. Trả cờ để giao diện nói trước thay vì để người dùng đoán.
  const data = users.map((u) => {
    const perms = new Set(resolveUserPermissions(u.role, u.permissions, u.canSign));
    const { permissions: _bo, canSign: _bo2, ...cong } = u as any;
    return { ...cong, coTheLamPhu: perms.has(P.QUOTE_READ_OWN) || perms.has(P.QUOTE_READ_ALL) };
  });
  return { data };
}

/** Danh sách tài khoản Account Hà Nội (cho manager chọn khi GIAO phần HN). */
export async function listHnAccounts(req: Request) {
  if (!can(req.session, P.QUOTE_HN_MANAGE)) throw httpError(403, "Không có quyền");
  // Tài khoản điền HN = ai có quyền quote:hn:fill (role account_hn mặc định HOẶC cấp riêng per-user).
  const data = await prisma.user.findMany({ where: { active: true, OR: [{ role: "account_hn" }, { permissions: { has: P.QUOTE_HN_FILL } }] }, select: { id: true, displayName: true, username: true }, orderBy: { displayName: "asc" } });
  return { data };
}

// Thay cho `{ … } satisfies Prisma.QuoteSelect`: toán tử `satisfies` làm parser của semgrep 1.97 bỏ vùng quanh nó
// (scripts/ci/security-scan.sh [S3] ghim số tệp quét dở). Hàm đồng nhất có tham số kiểu kiểm y hệt và giữ kiểu literal.
function chonBaoGiaDauVao<T extends Prisma.QuoteSelect>(s: T): T { return s; }

/**
 * HÓA ĐƠN ĐẦU VÀO — `GET /input-invoices`: mọi hàng bảng nội bộ ĐÃ DUYỆT (Chi phí HCM / Phí khách hàng theo
 * hàng, Báo giá Hà Nội theo `hnStatus = approved`), mỗi hàng là một khoản chi cần hoá đơn đầu vào. LUẬT chọn
 * hàng + tính tiền nằm ở `src/inputInvoices.ts` (thuần, có test); ở đây chỉ truy vấn.
 *
 * QUYỀN: `invoice:page` (kế toán, admin) — cùng cổng với trang Hoá đơn đầu ra. KHÔNG phạm vi theo người tạo:
 * kế toán phải thấy mọi khoản chi của công ty. Endpoint này chỉ ĐỌC và không chạm `Quote.updatedAt`.
 *
 * TRUY VẤN: một câu nhặt id báo giá CÓ hàng đã duyệt (toán tử chứa `@>` của jsonb — báo giá không có gì để
 * hiện thì không bị kéo bảng của nó về), rồi nạp bảng của đúng nhóm đó qua `bangNoiBoTheoSheet` /
 * `bangHnTheoBaoGia` (đã CẮT `paidProof` ngay tại SQL — ảnh ủy nhiệm chi không bao giờ đi qua dây ở đây).
 * Trần `TRAN_DU_AN` báo giá mới nhất, cờ `truncated` báo khi bị cắt (cùng trần và cùng cách báo với trang
 * Quản lý dự án / Hoá đơn, DB-12) — không cắt thầm.
 */
export async function listInputInvoices(req: Request) {
  if (!can(req.session, P.INVOICE_PAGE)) throw httpError(403, "Bạn không có quyền xem trang Hóa đơn đầu vào");
  // Báo giá xoá mềm bị loại (`deletedAt`) khỏi câu chính; HN chỉ tính khi đã duyệt. Không lọc theo `status`: người
  // duyệt hàng chi phí có thể làm việc đó từ lúc báo giá còn nháp, và trạng thái báo giá đi kèm từng dòng để kế toán
  // tự lọc. Báo giá CÓ dữ liệu kế toán (khoản, hoặc cờ "đã trả" JSON cũ) cũng được nhặt dù không còn hàng đã duyệt —
  // các dòng đó vào nhóm "Cần chú ý" thay vì biến mất khỏi trang của kế toán.
  const nhan = await prisma.$queryRaw<{ id: number }[]>`
    SELECT q.id
      FROM "Quote" q
     WHERE q."deletedAt" IS NULL
       AND (q."hnStatus" = 'approved'
            OR (jsonb_typeof(q."hnTables") = 'array' AND q."hnTables" @> '[{"items":[{"paid":true}]}]'::jsonb)
            OR EXISTS (SELECT 1 FROM "InputInvoiceEntry" e WHERE e."quoteId" = q.id)
            OR EXISTS (SELECT 1 FROM "QuoteSheet" s
                        WHERE s."quoteId" = q.id
                          AND jsonb_typeof(s."extraTables") = 'array'
                          AND (s."extraTables" @> '[{"items":[{"approved":true}]}]'::jsonb
                               OR s."extraTables" @> '[{"items":[{"paid":true}]}]'::jsonb)))
     ORDER BY q."quoteDate" DESC, q.id DESC
     LIMIT ${TRAN_DU_AN + 1}`;
  const truncated = nhan.length > TRAN_DU_AN;
  const ids = nhan.slice(0, TRAN_DU_AN).map((r) => r.id);
  // Báo giá ĐÃ XOÁ MỀM còn khoản kế toán: dòng chỉ-xem (tiền đã chi không được biến khỏi trang kế toán).
  const daXoa = await prisma.$queryRaw<{ id: number }[]>`
    SELECT q.id FROM "Quote" q
     WHERE q."deletedAt" IS NOT NULL AND EXISTS (SELECT 1 FROM "InputInvoiceEntry" e WHERE e."quoteId" = q.id)
     ORDER BY q.id DESC
     LIMIT ${TRAN_DU_AN}`;
  const idsDaXoa = daXoa.map((r) => r.id);
  if (!ids.length && !idsDaXoa.length) return { data: [] as HangDauVao[], meta: { quotes: 0, truncated: false } };

  const chonBaoGia = chonBaoGiaDauVao({
    id: true, companyId: true, status: true, projectCode: true, projectVersion: true, quoteNumber: true, title: true, shortTitle: true,
    hnStatus: true, hnReviewedAt: true, hnReviewerId: true,
    customer: { select: { code: true, name: true } },
    company: { select: { shortName: true, name: true } },
    createdBy: { select: { displayName: true } },
    sheets: { orderBy: [{ order: "asc" }, { id: "asc" }], select: { id: true, order: true, name: true, codeNo: true } },
  });
  const [quotes, quotesDaXoa, hnTheoBaoGia, bangSheet, dsMau, khoanTheoBaoGia] = await Promise.all([
    ids.length ? prisma.quote.findMany({ where: { id: { in: ids } }, select: chonBaoGia }) : [],
    idsDaXoa.length ? prisma.quote.findMany({ where: { id: { in: idsDaXoa } }, select: chonBaoGia, includeDeleted: true } as any) as Promise<any[]> : [],
    bangHnTheoBaoGia(ids),
    bangNoiBoTheoSheet(ids),
    dsMauBangNoiBo(),
    docKhoanChiTheoBaoGia([...ids, ...idsDaXoa]),
  ]);
  // Siêu dữ liệu ảnh (KHÔNG có ảnh) của mọi khoản đang hiện.
  const anhTheoKhoan = await docAnhTheoKhoan([...khoanTheoBaoGia.values()].flatMap((m) => [...m.values()].map((e) => e.id)));

  // Tên người: gom id ở MỘT chỗ rồi tra MỘT câu (hàng duyệt / cờ "đã trả" cũ lưu id, không lưu tên).
  const idNguoi = new Set<number>();
  const gomNguoi = (it: any) => {
    if (it && it.approved === true && typeof it.approvedBy === "number") idNguoi.add(it.approvedBy);
    if (it && it.paid === true && typeof it.paidById === "number") idNguoi.add(it.paidById);
  };
  for (const q of quotes) if (q.hnStatus === "approved" && q.hnReviewerId != null) idNguoi.add(q.hnReviewerId);
  for (const s of bangSheet) for (const t of Array.isArray(s.tables) ? s.tables : []) for (const it of Array.isArray(t?.items) ? t.items : []) gomNguoi(it);
  for (const tables of hnTheoBaoGia.values()) for (const t of tables) for (const it of Array.isArray(t?.items) ? t.items : []) gomNguoi(it);
  const tenNguoi = new Map<number, string>(
    idNguoi.size ? (await prisma.user.findMany({ where: { id: { in: [...idNguoi] } }, select: { id: true, displayName: true }, includeDeleted: true } as any) as { id: number; displayName: string }[]).map((u) => [u.id, u.displayName] as [number, string]) : [],
  );

  const theoBaoGia = new Map<number, { sheetId: number; order: number; tables: unknown[] }[]>();
  for (const s of [...bangSheet].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.sheetId - b.sheetId)) {
    (theoBaoGia.get(s.quoteId) ?? theoBaoGia.set(s.quoteId, []).get(s.quoteId)!).push({ sheetId: s.sheetId, order: s.order, tables: Array.isArray(s.tables) ? s.tables : [] });
  }
  const data = quotes.flatMap((q) => hangHoaDonDauVao({
    quote: q, sheets: q.sheets, sheetTables: theoBaoGia.get(q.id) ?? [], bangHn: hnTheoBaoGia.get(q.id) ?? [], dsMau, tenNguoi,
    khoan: khoanTheoBaoGia.get(q.id), anh: anhTheoKhoan,
  }));
  for (const q of quotesDaXoa) {
    data.push(...hangKhoanBaoGiaDaXoa({ quote: q, khoan: khoanTheoBaoGia.get(q.id) ?? new Map(), anh: anhTheoKhoan, tenNguoi }));
  }
  // Mới duyệt lên đầu; hàng không có ngày duyệt (dữ liệu cũ, nhóm "Cần chú ý") xuống cuối. Sắp ổn định: cùng ngày giữ
  // thứ tự bảng.
  data.sort((a, b) => (b.approvedAt ? Date.parse(b.approvedAt) : -Infinity) - (a.approvedAt ? Date.parse(a.approvedAt) : -Infinity) || b.quoteId - a.quoteId);
  return { data, meta: { quotes: ids.length, truncated } };
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
/** Trần số báo giá của trang Quản lý dự án / Hoá đơn (DB-12 — xem cờ `truncated` ở cuối hàm). */
export const TRAN_DU_AN = 2000;

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
    take: TRAN_DU_AN,
    select: {
      id: true, quoteNumber: true, projectCode: true, projectVersion: true,
      title: true, shortTitle: true, status: true, hnStatus: true,
      quoteDate: true, executionDate: true, vatPercent: true,
      subtotal: true, total: true, discount: true,
      companyId: true,   // luật chọn mẫu dự phòng của bảng nội bộ / HN (bangNoiBoCoNgay) — không trả ra
      company: { select: { name: true, shortName: true } },
      customer: { select: { code: true, name: true, debtDays: true } },
      createdBy: { select: { displayName: true } },
      sheets: {
        orderBy: { order: "asc" },
        select: {
          // KHÔNG kéo `extraTables` ở đây: cột jsonb đó chứa `paidProof` (ảnh chứng từ base64
          // hàng trăm KB) mà trang này chỉ dùng để CỘNG ba con số rồi vứt. Nạp riêng bằng
          // `bangNoiBoTheoSheet` (cắt ảnh NGAY TẠI SQL) ngay dưới — y như `listQuotes` đã làm.
          // Đo được (tests/b2-projects-no-proof.test.js, đếm byte tại socket): 8 báo giá × 3 bảng
          // × ảnh 400KB kéo về 9,6 MB; sau khi vá còn dưới 0,48 MB. Ở production trần là 2000 báo
          // giá, và người mở trang gồm cả kế toán (`invoice:page`).
          // LƯU Ý số block TOAST KHÔNG giảm: máy chủ vẫn phải giải TOAST cột đó để cắt `paidProof`.
          // Thứ bỏ đi là phần đi QUA DÂY và nằm trong heap của Node.
          id: true, order: true, name: true, subtotal: true, codeNo: true,
          signedAt: true, signedByName: true, invoiceNo: true, paidAt: true,
          poNumber: true, hnInvoiceNo: true, invoiceLink: true, docSentAt: true, docReturnedAt: true,
          invoiceDate: true, paymentMethod: true, orderClosedAt: true, invoiceYear: true, invoiceCompany: true, invoiceDesc: true, invoiceNote: true,
          // Ý kiến khách theo TRANG (FE-09): trang Hoá đơn / Dự án / "Cần xử lý" phải loại trang khách
          // "Không duyệt" khỏi Số tiền, Chưa thu, Tổng — đúng như convertedTotal đã loại. Thiếu cột này
          // thì bộ lọc phía giao diện không có gì để lọc.
          custStatus: true,
          template: { select: { company: { select: { shortName: true, name: true } } } },
        },
      },
    },
  });
  // Bảng nội bộ (đã cắt ảnh chứng từ) theo TỪNG sheet — chỉ để cộng hcm/hanoi/khach ngay dưới.
  // Bảng Hà Nội cấp báo giá: nạp qua câu SQL đã CẮT `paidProof` ngay tại SQL. KHÔNG `select` thô
  // cột `hnTables` — nó chứa ảnh uỷ nhiệm chi base64 mà trang này chỉ cần con số tổng (đúng hồi
  // quy 9,6 MB mà tests/b2-projects-no-proof.test.js đã chốt cho `extraTables`).
  const hnTheoBaoGia = quotes.length ? await bangHnTheoBaoGia(quotes.map((q: any) => q.id)) : new Map<number, any[]>();
  // Đợt 4 (L64 phía máy chủ): tổng hcm / hanoi / khach tính theo MẪU của từng bảng, y như màn soạn —
  // bảng mẫu không ngày mà CSDL còn days cũ không còn bị nhân ngày ở đây (xem bangNoiBoCoNgay).
  const dsMau = quotes.length ? await dsMauBangNoiBo() : [];
  const tongBang = (t: any, companyId: number) => extraTableSum(t, bangNoiBoCoNgay(t, companyId, dsMau));
  const bangTheoSheet = new Map<number, any[]>();
  if (quotes.length) {
    for (const r of await bangNoiBoTheoSheet(quotes.map((q: any) => q.id))) {
      bangTheoSheet.set(r.sheetId, Array.isArray(r.tables) ? r.tables : []);
    }
  }
  const data = quotes.map((q: any) => {
    // subtotal/sheet ĐÃ materialized (ghi lúc save) → KHÔNG kéo items + computeQuoteTotals nữa (perf).
    // Tổng HÀ NỘI nay là MỘT số cho cả báo giá (cột Quote.hnTables), còn bảng này liệt kê MỘT
    // DÒNG MỖI TRANG. Dồn trọn vào MỘT dòng, các dòng khác để 0: cộng cả cột vẫn ra đúng tổng.
    // Hiện cùng một số trên mọi dòng thì ai cộng cột sẽ ra gấp số-trang lần — con số sai mà trông
    // như tiền thật.
    const tongHnBaoGia = (hnTheoBaoGia.get(q.id) ?? []).reduce((acc: number, t: any) => acc + tongBang(t, q.companyId), 0);
    // `hnInvoiceNo` (Số HĐ Hà Nội) vẫn là cột THEO TRANG. Trên dữ liệu CŨ, bảng HN thường nằm ở
    // trang 2-3 và kế toán đã điền số hoá đơn vào ĐÚNG dòng đó — nếu dòng gánh tổng chỉ đọc
    // `hnInvoiceNo` của riêng nó thì cờ "thiếu số HĐ HN" (Projects.tsx + thẻ việc tồn đọng ở
    // Dashboard) bật ĐỎ VĨNH VIỄN cho mọi dự án cũ. Cho dòng đó thấy số hoá đơn HN ĐẦU TIÊN tìm
    // được trên cả báo giá — cùng phạm vi với con số tiền nó đang gánh.
    const hnInvoiceChung = q.sheets.map((x: any) => x.hnInvoiceNo).find((v: any) => String(v ?? "").trim() !== "") ?? null;
    // DÒNG GÁNH = trang ĐẦU mà giao diện KHÔNG ẩn (soát chéo money#4). Trang Dự án / "Cần xử lý" bỏ
    // dòng trang khách không duyệt (trangKhachTuChoi, web/src/lib/format.tsx) TRƯỚC khi đọc `hanoi`:
    // gánh vào trang 1 bị từ chối là mất cột "Báo Giá Hà Nội" lẫn cờ thiếu số HĐ HN, dù chi phí HN
    // vẫn là của cả báo giá. Điều kiện ẩn phải KHỚP hàm đó. Mọi trang đều bị ẩn → trang đầu, như cũ.
    const biAnTrenGiaoDien = (x: any) =>
      q.status === "converted" && x.custStatus === "rejected" && !String(x.invoiceNo ?? "").trim() && !x.paidAt;
    const idxGanHn = Math.max(0, q.sheets.findIndex((x: any) => !biAnTrenGiaoDien(x)));
    return {
      id: q.id,
      quoteNumber: q.quoteNumber,
      projectCode: q.projectCode,
      projectVersion: q.projectVersion,
      title: q.title,
      shortTitle: q.shortTitle ?? null,
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
      sheets: q.sheets.map((sh: any, sIdx: number) => {
        const ex = bangTheoSheet.get(sh.id) ?? [];
        const sumCat = (cat: string) => ex.filter((t: any) => t && t.category === cat).reduce((acc: number, t: any) => acc + tongBang(t, q.companyId), 0);
        return {
          id: sh.id,
          name: sh.name || null,
          codeNo: sh.codeNo ?? null,      // số thứ tự mã ĐÃ ĐÓNG BĂNG (trang Dự án / Hoá đơn dựng mã từ đây)
          subtotal: Number(sh.subtotal),
          custStatus: sh.custStatus ?? null,   // "approved" | "rejected" | null — xem chú thích ở select (FE-09)
          hcm: sumCat("hcm"),
          hanoi: sIdx === idxGanHn ? tongHnBaoGia : 0,
          khach: sumCat("khach"),
          cty: sh.template?.company?.shortName || sh.template?.company?.name || null,
          signedAt: sh.signedAt,
          signedByName: sh.signedByName,
          invoiceNo: sh.invoiceNo || null,
          paidAt: sh.paidAt || null,
          poNumber: sh.poNumber || null,
          hnInvoiceNo: (sIdx === idxGanHn ? (sh.hnInvoiceNo || hnInvoiceChung) : sh.hnInvoiceNo) || null,
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
  // BÁO KHI BỊ CẮT (DB-12): chạm trần thì dự án cũ nhất biến mất khỏi trang Hoá đơn/Quản lý dự án
  // (công nợ cũ chưa thu) mà không có dấu hiệu nào. Cờ này để giao diện hiện cảnh báo.
  return { data, truncated: quotes.length >= TRAN_DU_AN };
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
  // Ý kiến khách (duyệt/không duyệt từng trang) là dữ liệu của VÙNG MAIN — nó quyết định trang nào
  // đi vào chứng từ. Account phụ chỉ được giao bảng nội bộ không được đụng, nếu không lời hứa
  // "chỉ sửa phần được tick" thủng ngay ở endpoint này.
  const sheet = await prisma.quoteSheet.findUnique({
    where: { id: Number(req.params.sheetId) },
    select: {
      id: true, quoteId: true, name: true, order: true,
      quote: { select: { id: true, deletedAt: true, createdById: true, members: { select: { userId: true, scopes: true } } } },
    },
  });
  if (!sheet || sheet.quote?.deletedAt) throw httpError(404, "Không tìm thấy sheet");
  if (!canOnQuote(req.session, "update", sheet.quote)) throw httpError(403, "Bạn không có quyền với báo giá này");
  if (!(quoteScopesFor(req.session, sheet.quote) ?? []).includes("main")) {
    throw httpError(403, 'Bạn không được giao phần "Báo giá chính" của báo giá này');
  }

  // "" / null = gỡ đánh dấu (quay lại "chưa có ý kiến").
  const raw = req.body?.status;
  const status = raw === "approved" || raw === "rejected" ? raw : null;
  const note = typeof req.body?.note === "string" ? req.body.note.trim().slice(0, 1000) : null;
  // KHÁCH ĐỔI Ý MỘT TRANG SAU KHI ĐÃ CHỐT → doanh thu chốt phải tính lại (MONEY-01/RBAC-05).
  // Trong MỘT transaction, khoá QuoteSheet (ORDER BY id) TRƯỚC — cùng thứ tự khoá với updateQuote/
  // saveHn/markConverted để không đẻ deadlock 40P01 — rồi mới đọc lại các trang và ghi Quote.
  // Ghi convertedTotal bằng câu RAW: không đụng `updatedAt` (@updatedAt là phía client Prisma), nên
  // editor đang mở báo giá đó KHÔNG ăn 409 khoá lạc quan ở lần Lưu kế chỉ vì vừa bấm nút ý kiến khách.
  // convertedTotal NULL (chốt trước khi có cột) → giữ null như updateQuote.
  const updated = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "QuoteSheet" WHERE "quoteId" = ${sheet.quoteId} ORDER BY id FOR UPDATE`;
    // ĐÃ XUẤT HOÁ ĐƠN → KHOÁ, cùng mốc với canEdit (soát chéo money#1). Nhánh dưới tính lại
    // convertedTotal, nên đổi ý kiến lúc này là đổi doanh thu KPI sau khi con số đã đi ra chứng từ
    // kế toán — đúng thứ canEdit cấm với sửa giá. Kiểm SAU khoá: một lần nhập số HĐ đang chen vào
    // (updateSheetInvoice ghi hàng QuoteSheet) phải chờ khoá này, nên không lọt qua giữa kiểm và ghi.
    if (daXuatHoaDon({ sheets: await tx.quoteSheet.findMany({ where: { quoteId: sheet.quoteId }, select: { invoiceNo: true } }) })) {
      throw httpError(409, "Báo giá đã xuất hoá đơn — không đổi ý kiến khách được nữa");
    }
    const u = await tx.quoteSheet.update({
      where: { id: sheet.id },
      data: status
        ? { custStatus: status, custStatusAt: new Date(), custStatusById: req.session.userId, custNote: note || null }
        : { custStatus: null, custStatusAt: null, custStatusById: null, custNote: null },
      select: { id: true, custStatus: true, custStatusAt: true, custNote: true, custStatusBy: { select: { id: true, displayName: true } } },
    });
    const [q] = await tx.$queryRaw<{ status: string; convertedTotal: unknown; vatPercent: unknown }[]>`SELECT status, "convertedTotal", "vatPercent" FROM "Quote" WHERE id = ${sheet.quoteId}`;
    if (q?.status === "converted" && q.convertedTotal != null) {
      const trang = await tx.quoteSheet.findMany({ where: { quoteId: sheet.quoteId }, select: { subtotal: true, custStatus: true } });
      const moi = tinhConvertedTotal(trang, q.vatPercent as any);
      await tx.$executeRaw`UPDATE "Quote" SET "convertedTotal" = ${moi} WHERE id = ${sheet.quoteId}`;
    }
    return u;
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
  const existing = await prisma.quote.findFirst({ where: { id }, include: { members: { select: { userId: true, scopes: true } } } });
  if (!existing) throw httpError(404, "Không tìm thấy báo giá");
  if (!canOnQuote(req.session, "update", existing)) {
    throw httpError(403, "Không có quyền chốt báo giá này");
  }
  if (laAccountPhu(req.session, existing)) throw httpError(403, "Bạn được thêm vào làm cùng báo giá này, nhưng việc chốt deal thuộc về người tạo báo giá");
  if (["converted", "lost"].includes(existing.status)) {
    throw httpError(400, "Báo giá đã chốt / không chốt rồi");
  }
  // ── DOANH THU GHI NHẬN = TỔNG TRỪ NHỮNG TRANG KHÁCH KHÔNG DUYỆT ─────────
  // `QuoteSheet.custStatus` tồn tại từ lâu để ghi ý kiến khách cho TỪNG trang, nhưng trước
  // 2026-09-17 KHÔNG một dòng mã nào đọc nó: hàm này chuyển cả báo giá sang `converted` rồi phát
  // webhook kèm `Quote.total` — tổng của MỌI trang, gồm cả trang khách đã bấm "Không duyệt". Hệ
  // thống vì thế ghi nhận một đơn đã chốt với số tiền CAO HƠN mức khách thật sự đồng ý.
  //
  // TÍNH Ở MÁY CHỦ, KHÔNG NHẬN TỪ CLIENT. Đây là con số tiền; nhận nó qua thân request là mở một
  // đường cho bất kỳ ai gọi được API tự khai doanh thu của mình.
  //
  // `QuoteSheet.subtotal` là net ĐÃ TRỪ giảm giá của trang (xem chú thích ở chỗ ghi nó), nên chỉ
  // cần cộng phần không bị từ chối rồi tính VAT trên đó — đúng thứ tự Cộng → Discount → VAT của
  // shared/quote-math.ts. Trang `null` (chưa có ý kiến) VẪN TÍNH: khách chưa từ chối nó.
  //
  // ĐỌC TRANG VÀ GHI TRONG CÙNG MỘT TRANSACTION, khoá QuoteSheet (ORDER BY id) trước (MONEY-01):
  // bản trước đọc trang NGOÀI transaction rồi mới updateMany — một lần Lưu chen giữa làm doanh thu
  // chốt tính từ giá CŨ. Cùng thứ tự khoá với updateQuote/saveHn → không deadlock.
  // Tính bằng tinhConvertedTotal (Decimal, kẹp ≥ 0) — CÙNG hàm mà các đường tính lại sau khi chốt dùng.
  const { upd, trang } = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "QuoteSheet" WHERE "quoteId" = ${id} ORDER BY id FOR UPDATE`;
    const trang = await tx.quoteSheet.findMany({
      where: { quoteId: id },
      select: { subtotal: true, custStatus: true },
    });
    // VAT cũng phải đọc SAU khoá (soát chéo money#7): `existing` đọc ngoài transaction, và một lượt
    // đổi RIÊNG VAT của updateQuote có thể commit đúng khe đó — lúc ấy báo giá chưa converted nên
    // nó không tính convertedTotal, còn ở đây lại nhân VAT cũ. Cùng cách setSheetCustomerDecision
    // và nhánh có sheets của updateQuote đọc lại VAT sau khoá. Chiều ngược lại đã an toàn: lượt đổi
    // VAT đến sau phải chờ khoá này, rồi thấy converted và tự tính lại theo VAT mới.
    const [vq] = await tx.$queryRaw<{ vatPercent: unknown }[]>`SELECT "vatPercent" FROM "Quote" WHERE id = ${id}`;
    const convertedTotal = tinhConvertedTotal(trang, (vq?.vatPercent ?? existing.vatPercent) as any);
    // Optimistic guard: only convert if not already terminal — prevents a race with
    // a concurrent mark-lost / edit from producing a wrong terminal transition.
    const upd = await tx.quote.updateMany({
      where: { id, status: { notIn: ["converted", "lost"] } },
      data: { status: "converted", convertedAt: new Date(), convertedTotal },
    });
    return { upd, trang };
  });
  if (!upd.count) {
    throw httpError(409, "Báo giá vừa đổi trạng thái — vui lòng tải lại");
  }
  const quote = await prisma.quote.findFirst({ where: { id }, include: QUOTE_INCLUDE });
  if (!quote) throw httpError(404, "Không tìm thấy báo giá");
  await audit(req, "quote.convert", { resource: "quote", resourceId: id, before: { status: existing.status } });
  // `total` GIỮ NGUYÊN trong webhook (bên nhận cũ vẫn đọc được), và thêm `convertedTotal` —
  // số thật sự chốt. Đổi nghĩa `total` ở đây là làm sai mọi tích hợp đang chạy.
  emitWebhook("quote.converted", {
    id,
    quoteNumber: quote.quoteNumber,
    total: Number(quote.total),
    convertedTotal: Number(quote.convertedTotal ?? quote.total),
    soTrangKhachKhongDuyet: trang.filter((t) => t.custStatus === "rejected").length,
  }).catch(() => {});
  return quote;
}

/** MARK LOST — khách từ chối; ghi lý do cho báo cáo win/loss. Route present. */
export async function markLost(req: Request) {
  const id = Number(req.params.id);
  const existing = await prisma.quote.findFirst({ where: { id }, include: { members: { select: { userId: true, scopes: true } } } });
  if (!existing) throw httpError(404, "Không tìm thấy báo giá");
  if (!canOnQuote(req.session, "update", existing)) {
    throw httpError(403, "Không có quyền cập nhật báo giá này");
  }
  if (laAccountPhu(req.session, existing)) throw httpError(403, "Bạn được thêm vào làm cùng báo giá này, nhưng việc đánh dấu không chốt thuộc về người tạo báo giá");
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
 * GHI CHÚ + MÀU ở dòng Danh sách báo giá — `PUT /:id/list-note`, body đã qua `QuoteListNoteSchema`.
 *
 * Quyền = `loadAuthorizedQuote(req, "update")`: chủ báo giá, thành viên có ÍT NHẤT MỘT vùng, người có
 * `quote:update:all`. Thành viên chỉ-xem và người chỉ có `quote:read:all` không được đè ghi chú của chủ;
 * view bị lược (account HN, tài khoản chi phí) bị từ chối luôn — họ cũng không được trả cột này ở danh
 * sách (`presentQuoteRow` chọn trường tường minh cho hai nhánh đó).
 *
 * CỐ Ý KHÔNG dùng `canEdit` (khoá sửa sau khi xuất hoá đơn): ghi chú không phải nội dung báo giá, và dòng
 * đã xuất hoá đơn chính là dòng cần nhắc "chờ thu" nhất. CỐ Ý không chạm `Quote` (kể cả `data: {}`):
 * `Quote.updatedAt` là mốc khoá lạc quan của màn soạn — bump nó là đá văng lần Lưu của người đang soạn.
 *
 * Trường vắng trong body = GIỮ NGUYÊN, nên ghi bằng MỘT câu upsert nguyên tử (`update` chỉ liệt kê trường
 * được gửi) chứ không đọc-rồi-ghi: hai người đổi chữ và đổi màu cùng lúc không đè mất nhau.
 */
export async function setQuoteListNote(req: Request) {
  const quote = await loadAuthorizedQuote(req, "update");
  const quoteId = quote.id;
  const body = req.body as { note?: string; color?: MauGhiChu | null };
  const note = body.note !== undefined ? chuanHoaGhiChu(body.note) : undefined;
  const me = await prisma.user.findUnique({ where: { id: req.session.userId }, select: { displayName: true } });
  const updatedByName = me?.displayName || null;
  // `searchText` = chữ ghi chú đã bỏ dấu — để ô tìm của Danh sách báo giá tìm được chữ trong ghi chú; chỉ ghi khi
  // chữ thay đổi (đổi riêng màu không được xoá nó).
  const row = await prisma.quoteListNote.upsert({
    where: { quoteId },
    create: { quoteId, note: note ?? "", searchText: normalizeSearch(note ?? ""), color: body.color ?? null, updatedByName },
    update: { ...(note !== undefined && { note, searchText: normalizeSearch(note) }), ...(body.color !== undefined && { color: body.color }), updatedByName },
    select: { note: true, color: true, updatedByName: true, updatedAt: true },
  });
  // Cả chữ lẫn màu đều rỗng → không giữ hàng rỗng. Điều kiện nằm TRONG câu DELETE: nếu giữa hai câu có
  // người khác vừa gõ chữ vào thì hàng không còn rỗng và không bị xoá nhầm.
  if (!row.note && !row.color) {
    await prisma.quoteListNote.deleteMany({ where: { quoteId, note: "", color: null } });
    await audit(req, "quote.list-note", { resource: "quote", resourceId: quoteId, after: { note: "", color: null } });
    return { quoteId, note: "", color: null, updatedByName: null, updatedAt: null };
  }
  await audit(req, "quote.list-note", { resource: "quote", resourceId: quoteId, after: { note: row.note, color: row.color } });
  return { quoteId, ...row };
}

/** Ghi chú của các báo giá trong `ids` — MỘT câu `IN`, gắn vào đúng các dòng của trang danh sách đang xem. */
async function ghiChuTheoBaoGia(ids: number[]) {
  if (!ids.length) return new Map<number, { note: string; color: string | null; updatedByName: string | null; updatedAt: Date }>();
  const ds = await prisma.quoteListNote.findMany({
    where: { quoteId: { in: ids } },
    select: { quoteId: true, note: true, color: true, updatedByName: true, updatedAt: true },
  });
  return new Map(ds.map(({ quoteId, ...con }) => [quoteId, con]));
}

/** Người tạo + công ty với tên ĐÃ bỏ dấu, để tìm thông minh khớp "nguyen" ra "Nguyễn Văn Ánh" / "Gia Nguyễn". Hai bảng
 *  nhỏ (vài chục dòng) nên khớp trong JS mỗi lượt tìm — không đáng thêm cột searchText + backfill cho chúng. */
async function nguoiVaCongTy(): Promise<Pick<NguCanhLoc, "nguoi" | "congTy">> {
  const [us, cs] = await Promise.all([
    prisma.user.findMany({ select: { id: true, displayName: true, username: true } }),
    prisma.company.findMany({ select: { id: true, name: true, shortName: true, code: true } }),
  ]);
  return {
    nguoi: us.map((u) => ({ id: u.id, ten: normalizeSearch(u.displayName, u.username) })),
    congTy: cs.map((c) => ({ id: c.id, ten: normalizeSearch(c.name, c.shortName, c.code) })),
  };
}

/**
 * SỐ ĐẾM cho bộ lọc của Danh sách báo giá — `GET /facets`, nhận CÙNG bộ tham số với danh sách.
 *
 * Mỗi nhóm đếm theo MỌI bộ lọc KHÁC (trừ chính nó) trong phạm vi của người xem: đã chọn "Đã chốt" mà nhóm Công ty
 * vẫn đếm cả báo giá nháp thì con số trên nút nói dối; còn nhóm Trạng thái mà áp luôn bộ lọc trạng thái thì mọi nút
 * khác về 0 và không ai chọn thêm được. (Chuẩn của tìm kiếm có facet.) `mine` = của CHÍNH người xem — cho nút "Của tôi".
 *
 * Cổng: view lược (account HN / xem nội bộ) bị 403 — họ không có bộ lọc này, và đếm theo người tạo / ghi chú / công
 * ty là cách dò thứ họ không được thấy. Phạm vi quyền áp TRƯỚC: người chỉ có quote:read:own chỉ thấy số của mình.
 */
export async function listQuoteFacets(req: Request) {
  if (can(req.session, P.QUOTE_HN_FILL) || can(req.session, P.QUOTE_INTERNAL_VIEW)) throw httpError(403, "Bạn không có quyền xem thống kê bộ lọc");
  const scope = quoteScopeWhereOrThrow(req.session) as Prisma.QuoteWhereInput;
  const loc = docBoLoc(req.query as Record<string, any>);
  const parts = locTheoChieu(loc, { ...(loc.q ? await nguoiVaCongTy() : { nguoi: [], congTy: [] }), bienLuoc: false });
  const voi = (boQua?: ChieuLoc): Prisma.QuoteWhereInput => ({ AND: [scope, ...ghepLoc(parts, boQua)] });
  const toi = req.session.userId as number;
  const [theoTrangThai, theoNguoi, theoCongTy, coGhiChu, chuaGhiChu, theoMau, cuaToi, tong] = await Promise.all([
    prisma.quote.groupBy({ by: ["status"], where: voi("status"), _count: { _all: true } }),
    prisma.quote.groupBy({ by: ["createdById"], where: voi("creator"), _count: { _all: true } }),
    prisma.quote.groupBy({ by: ["companyId"], where: voi("company"), _count: { _all: true } }),
    prisma.quote.count({ where: { AND: [voi("note"), { listNote: { isNot: null } }] } }),
    prisma.quote.count({ where: { AND: [voi("note"), { listNote: { is: null } }] } }),
    // Quan hệ lồng không đi qua lớp xoá-mềm của db.ts (chỉ áp cho truy vấn cấp trên cùng) nên tự thêm deletedAt.
    prisma.quoteListNote.groupBy({ by: ["color"], where: { color: { not: null }, quote: { AND: [voi("note"), { deletedAt: null }] } }, _count: { _all: true } }),
    prisma.quote.count({ where: { AND: [voi("creator"), { createdById: toi }] } }),
    prisma.quote.count({ where: voi() }),
  ]);
  const [tenNguoi, tenCongTy] = await Promise.all([
    theoNguoi.length ? prisma.user.findMany({ where: { id: { in: theoNguoi.map((g) => g.createdById) } }, select: { id: true, displayName: true } }) : [],
    theoCongTy.length ? prisma.company.findMany({ where: { id: { in: theoCongTy.map((g) => g.companyId) } }, select: { id: true, name: true, shortName: true } }) : [],
  ]);
  const nguoi = new Map(tenNguoi.map((u) => [u.id, u.displayName]));
  const congTy = new Map(tenCongTy.map((c) => [c.id, c.shortName || c.name]));
  const xep = <T extends { name: string; count: number }>(ds: T[]) => ds.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "vi"));
  return {
    total: tong,
    mine: cuaToi,
    status: theoTrangThai.map((g) => ({ value: g.status, count: g._count._all })),
    creators: xep(theoNguoi.map((g) => ({ id: g.createdById, name: nguoi.get(g.createdById) ?? `#${g.createdById}`, count: g._count._all }))),
    companies: xep(theoCongTy.map((g) => ({ id: g.companyId, name: congTy.get(g.companyId) ?? `#${g.companyId}`, count: g._count._all }))),
    note: { has: coGhiChu, none: chuaGhiChu, colors: Object.fromEntries(theoMau.map((g) => [g.color as string, g._count._all])) },
  };
}

/**
 * MEMBERS — "account phụ": ai được vào làm cùng trên báo giá này, và được sửa VÙNG NÀO.
 * Chỉ người tạo (hoặc admin) mới quản lý được danh sách thành viên.
 *
 * Báo giá vẫn thuộc về người tạo trong mọi đường: `createdById`, mã dự án và "Người gửi" không
 * nằm trong tầm với của thành viên (xem lớp lọc theo phạm vi ở `updateQuote`).
 */
export async function updateMembers(req: Request) {
  const id = Number(req.params.id);
  const quote = await prisma.quote.findFirst({ where: { id }, include: { members: { select: { userId: true, scopes: true } } } });
  if (!quote) throw httpError(404, "Không tìm thấy báo giá");
  if (quote.createdById !== req.session.userId && !can(req.session, P.QUOTE_UPDATE_ALL)) {
    throw httpError(403, "Chỉ người tạo hoặc Quản trị mới quản lý được thành viên");
  }

  // HAI hình dạng payload cùng được nhận, cố ý:
  //   · `members: [{ userId, scopes }]` — client mới, có tick phạm vi.
  //   · `memberIds: number[]`           — client CŨ đang mở sẵn trong tab của ai đó. Nó không
  //     biết phạm vi là gì, nên hiểu là ĐỦ 4 VÙNG = đúng hành vi trước bản này. Bỏ nhánh này là
  //     mọi tab đang mở bỗng 400 giữa chừng.
  const muon = new Map<number, string[]>();
  for (const m of (req.body.members ?? [])) {
    const uid = Number(m?.userId);
    if (Number.isFinite(uid)) muon.set(uid, locPhamVi(m?.scopes));
  }
  // Client cũ không biết phạm vi là gì: người ĐANG là thành viên thì GIỮ NGUYÊN phạm vi đã tick
  // (nếu không, một tab cũ bấm Lưu là âm thầm nới mọi account phụ lên đủ 4 vùng), người MỚI thêm
  // mới nhận đủ 4 vùng — đúng hành vi trước bản này.
  const phamViCu = new Map(quote.members.map((m) => [m.userId, m.scopes]));
  for (const uid of (req.body.memberIds ?? [])) {
    const u = Number(uid);
    if (Number.isFinite(u) && !muon.has(u)) muon.set(u, locPhamVi(phamViCu.get(u) ?? [...QUOTE_SCOPES]));
  }
  muon.delete(quote.createdById); // người tạo xử lý riêng bên dưới, không tick bớt được

  // Người MỚI thêm phải tồn tại và còn hoạt động. Không kiểm thì Prisma ném P2003/P2025 và
  // errorHandler dịch thành 404 "Không tìm thấy bản ghi" — thông điệp trỏ sai chỗ, rất khó lần.
  const dangCo = new Set(quote.members.map((m) => m.userId));
  const themMoi = [...muon.keys()].filter((uid) => !dangCo.has(uid));
  if (themMoi.length) {
    const thay = await prisma.user.findMany({ where: { id: { in: themMoi }, active: true }, select: { id: true } });
    const co = new Set(thay.map((u) => u.id));
    const thieu = themMoi.filter((uid) => !co.has(uid));
    if (thieu.length) throw httpError(400, `Tài khoản không tồn tại hoặc đã bị khoá: ${thieu.join(", ")}`);
  }
  muon.set(quote.createdById, [...QUOTE_SCOPES]); // chủ báo giá LUÔN đủ quyền trên báo giá của mình
  // Người ĐANG được giao phần Hà Nội luôn giữ vùng "hanoi": luồng HN gác bằng `hnAssigneeId` chứ
  // không bằng phạm vi (src/hnWorkflow.ts saveHn/submitHn), nên bỏ tick ở đây sẽ là một lời hứa
  // sai — màn hình bảo đã khoá mà họ vẫn ghi được qua PUT /:id/hn. Muốn dừng thì GIAO LẠI phần HN.
  if (quote.hnAssigneeId && muon.has(quote.hnAssigneeId) && !muon.get(quote.hnAssigneeId)!.includes("hanoi")) {
    muon.set(quote.hnAssigneeId, locPhamVi([...muon.get(quote.hnAssigneeId)!, "hanoi"]));
  }

  const go = quote.members.filter((m) => !muon.has(m.userId)).map((m) => m.userId);
  const truoc = quote.members.map((m) => ({ userId: m.userId, scopes: m.scopes }));

  // MỘT lần ghi qua `prisma.quote.update`, không tách ra `prisma.quoteMember.*`: chỉ Quote nằm
  // trong RT_ENTITY (src/db.ts) nên chỉ đường này mới bắn sự kiện realtime cho tab đang mở của
  // người vừa được thêm. Ghi thẳng vào bảng con là phân công xong mà màn hình họ vẫn trống.
  await prisma.quote.update({
    where: { id },
    data: {
      members: {
        ...(go.length ? { deleteMany: { userId: { in: go } } } : {}),
        upsert: [...muon].map(([userId, scopes]) => ({
          where: { quoteId_userId: { quoteId: id, userId } },
          create: { userId, scopes, addedById: req.session.userId },
          update: { scopes },
        })),
      },
    },
  });

  const sau = [...muon].map(([userId, scopes]) => ({ userId, scopes }));
  await audit(req, "quote.members.update", { resource: "quote", resourceId: id, before: { members: truoc }, after: { members: sau } });

  // Báo cho người vừa được thêm — trước đây họ chỉ biết nhờ tình cờ mở danh sách thấy báo giá lạ.
  for (const uid of themMoi) {
    if (uid === req.session.userId) continue;
    const pv = muon.get(uid) ?? [];
    await notify(uid, {
      title: `Bạn được thêm vào báo giá: ${quote.quoteNumber}`,
      body: `${quote.title} — ${pv.length ? "được sửa: " + pv.map(tenPhamVi).join(", ") : "chỉ xem"}.`,
      link: `/#/quotes/${id}`, resource: "quote", resourceId: id, important: true,
    });
  }

  const updated = await prisma.quote.findFirst({
    where: { id },
    include: { members: { select: { userId: true, scopes: true, user: { select: { id: true, username: true, displayName: true, active: true, role: true } } } } },
  });
  if (!updated) throw httpError(404, "Không tìm thấy báo giá");
  return { members: updated.members.map(phangThanhVien) };
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
  // KT-4: báo giá chứa khoản kế toán ĐÃ CHI (trạng thái HIỆU LỰC — khoản thắng cờ JSON cũ, nên khoản đã bỏ tích không
  // chặn oan) không xoá mềm được: thùng rác là đường tới "Dọn rác", và tiền đã chi thì phải còn đối chiếu được. Kiểm và
  // xoá trong CÙNG transaction dưới Quote FOR NO KEY UPDATE — kế toán tích dưới Quote FOR SHARE nên không chen giữa được.
  // Xoá mềm bằng `tx.quote.update` chứ KHÔNG `tx.quote.delete` (extension soft-delete ở src/db.ts chạy ngoài tx).
  await prisma.$transaction(async (tx) => {
    const [tuoi] = await tx.$queryRaw<{ status: string; deletedAt: Date | null }[]>`SELECT status, "deletedAt" FROM "Quote" WHERE id = ${id} FOR NO KEY UPDATE`;
    // Kiểm LẠI trạng thái sau khi đã khoá: hai kiểm ở trên chạy NGOÀI giao dịch, một lần "Khách chốt" chen giữa sẽ để
    // báo giá ĐÃ CHỐT (kết thúc, không ai được xoá) lọt vào thùng rác (soát 2026-10-06, DT-3).
    if (!tuoi || tuoi.deletedAt) throw httpError(404, "Không tìm thấy báo giá");
    if (tuoi.status === "converted") throw httpError(400, "Không thể xóa báo giá đã chốt");
    if (!can(req.session, P.QUOTE_DELETE_ALL) && !(canOnQuote(req.session, "delete", existing) && (tuoi.status === "draft" || tuoi.status === "rejected"))) {
      throw httpError(403, "Chỉ Quản trị hoặc người tạo (báo giá ở trạng thái Nháp/Bị từ chối) mới được xóa");
    }
    const daChi = await khoanDaChiCuaBaoGia(tx, id);
    if (daChi.length) {
      const nhan = daChi.slice(0, 5).map((t) => `"${String(t).slice(0, 80)}"`).join(", ") + (daChi.length > 5 ? "…" : "");
      throw loiCoMa(400, "bao-gia-co-khoan-da-chi",
        `Không xoá được báo giá: có ${daChi.length} khoản kế toán đã đánh dấu ĐÃ CHI (${nhan}). Nhờ kế toán bỏ đánh dấu ở trang Hóa đơn đầu vào trước.`);
    }
    await tx.quote.update({ where: { id }, data: { deletedAt: new Date() } });
  });
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
  // View bị lược thì không nhân bản được (RBAC-06): bản sao là báo giá CỦA HỌ nên GET không còn lược,
  // và chính phản hồi 201 đã trả presentQuote đầy đủ — một cú bấm là đọc trọn giá bán/khách.
  if (viewBiLuoc(req.session)) throw httpError(403, "Bạn chỉ được xem phần được giao của báo giá này");
  // Bản sao mang `createdById` + mã dự án của NGƯỜI BẤM (xem phần tạo bản sao bên dưới). Với
  // account phụ thì đó đúng là đường lách "báo giá vẫn của tôi": một cú bấm là báo giá của chủ
  // thành báo giá của họ, mang mã dự án của họ.
  if (laAccountPhu(req.session, src)) throw httpError(403, "Bạn được thêm vào làm cùng báo giá này nên không nhân bản được. Hãy nhờ người tạo báo giá bấm Nhân bản.");

  const sameProject = req.body.sameProject === true;
  const t = computeQuoteTotals({ vatPercent: src.vatPercent, sheets: src.sheets });

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

  // CẮT TRẠNG THÁI DO SERVER SỞ HỮU khỏi một hàng bảng nội bộ (HN / HCM / phí khách): duyệt, đã
  // thanh toán, ảnh chứng từ, và `rid` (khoá khớp trạng thái — giữ rid cũ là mở cửa cho
  // reconcileExtra* kế thừa nhầm). Bản sao là báo giá MỚI chưa ai duyệt, chưa ai trả tiền.
  // MỘT hàm cho cả hnTables lẫn extraTables để hai chỗ không trôi khỏi nhau — đúng cái đã xảy ra:
  // hnTables được cắt từ lâu còn extraTables thì bị chép nguyên văn (MONEY-05/RBAC-02, 2026-09-23).
  // Ba cột nội bộ (4e24308) chia hai phe: LƯU KHO là TRẠNG THÁI công việc của dự án cũ (hàng đó đã vào kho
  // chưa) — như duyệt / đã trả, bản sao chưa có gì vào kho nên CẮT; còn NS (ai ứng / nguồn chi) và CHỨNG
  // TỪ (VAT / HĐNS / TM) là PHÂN LOẠI của dòng chi phí, dự án mới làm lại hạng mục đó vẫn theo cách ấy nên GIỮ.
  // Hàm này chạy cho CẢ HAI nút: "Nhân bản" (mã dự án mới) và "Bản mới" (sameProject — v2/v3 CÙNG mã dự án,
  // QuoteList gọi duplicateQuote(id, true)). Ở "Bản mới" hàng có thể VẪN đang nằm trong kho thật, nhưng LƯU KHO
  // là trạng thái thật của hạng mục đúng như ĐÃ THANH TOÁN — mà tiền của hạng mục đó cũng đã chi thật, vậy mà
  // "Bản mới" vẫn cắt đã trả / duyệt (chốt: tests/mn-nhan-ban-cat-trang-thai-bang-noi-bo.test.js): bản v2 theo
  // dõi trạng thái lại từ đầu. Nên LƯU KHO cắt theo cùng luật — giữ một cắt một là bản v2 hiện "đã lưu kho"
  // cạnh "chưa thanh toán" cho cùng một hàng. Muốn "Bản mới" mang trạng thái sang thì mang CẢ HAI, ở đúng hàm
  // này (tests/vdb-noi-bo-ba-truong-luu-tai-lai.test.js chốt hai thứ đi cùng nhau, cho cả hai nút).
  const catTrangThai = (it: any) => {
    const { rid: _rid, paid: _p, paidAt: _pa, paidById: _pb, paidProof: _pp, approved: _a, approvedAt: _aa, approvedBy: _ab, luuKho: _lk, ...con } = it || {};
    return con;
  };

  const buildData = (quoteNumber: string, projectCode: string | null, projectVersion: number) => ({
    quoteNumber,
    projectCode,
    projectVersion,
    searchText: normalizeSearch(quoteNumber, projectCode, newTitle, src.toCompany, src.toContact),
    title: newTitle,
    // Ba trường từng bị RƠI khi nhân bản: mất liên kết khách (tên tệp xuất mất mã KH), mất tên
    // ngắn, và `showTotals` về mặc định true — bản gốc đã ẩn bảng tổng thì bản sao lại hiện nó
    // trên tệp gửi khách.
    customerId: src.customerId ?? null,
    shortTitle: src.shortTitle ?? null,
    showTotals: src.showTotals,
    toCompany: src.toCompany,
    toContact: src.toContact,
    companyId: src.companyId,
    fromContact: src.fromContact,
    fromPhone: src.fromPhone,
    fromTitle: src.fromTitle,
    fromAddress: src.fromAddress,
    city: src.city,
    quoteDate: homNayVN(),   // ngày VN — nhân bản lúc 00:00–06:59 giờ VN từng mang ngày hôm qua (MONEY-07 / XLSX-11)
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
    members: { create: { userId: req.session.userId, scopes: [...QUOTE_SCOPES], addedById: req.session.userId } },
    // Phần Hà Nội đi theo bản sao — bỏ sót là người dùng nhân bản báo giá rồi mất trắng phần HN,
    // im lặng. CẮT trạng thái do server sở hữu (duyệt / đã thanh toán / ảnh chứng từ): bản sao là
    // báo giá MỚI chưa ai duyệt, chưa ai trả tiền — cùng tinh thần với `carrySheetState`.
    hnTables: (Array.isArray(src.hnTables) ? src.hnTables : []).map((t: any) => ({
      name: t?.name ?? null, templateId: t?.templateId ?? null, groupSubtotal: !!t?.groupSubtotal,
      items: (t?.items || []).map(catTrangThai),
    })),
    sheets: {
      create: src.sheets.map((s: any, sIdx: number) => ({
        templateId: s.templateId,
        name: s.name,
        order: s.order != null ? s.order : sIdx + 1,
        groupSubtotal: s.groupSubtotal,
        showImages: !!s.showImages,
        discount: t.sheetTotals[sIdx]?.discount ?? D(0),   // Discount riêng của sheet (đã kẹp)
        subtotal: t.sheetTotals[sIdx]?.subtotal ?? D(0),   // materialized (= subtotal ĐÃ trừ discount)
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
        // sanitizeExtraTables sinh rid MỚI (rid đã bị cắt ở trên) và trả undefined khi rỗng.
        extraTables: sanitizeExtraTables((Array.isArray(s.extraTables) ? s.extraTables : []).map((t: any) => ({
          ...t, items: (t?.items || []).map(catTrangThai),
        }))),
      })),
    },
  });

  // Allocate the number (+ per-employee project code) and create + snapshot v1
  // INSIDE one transaction with a P2002 retry — mirrors the main create path so a
  // failed insert rolls the counter back (no burned numbers) and the copy always
  // gets an initial QuoteVersion snapshot.
  let created;
  const prefixNhanBan = src.company?.quotePrefix || "GN";
  // Số VÀ MÃ DỰ ÁN của LƯỢT VỪA HỎNG — cùng lý do như createQuote, xem khối catch bên dưới.
  const capSoNhanBan: { so: string | null; ma: string | null } = { so: null, ma: null };
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
          capSoNhanBan.ma = projectCode;
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
        //
        // CHỈ KHI ĐỤNG ĐÚNG CỘT quoteNumber (MONEY-09). P2002 của `@@unique([projectCode,
        // projectVersion])` — hai người cùng bấm "Bản mới cùng dự án" — KHÔNG làm số báo giá bị
        // chiếm: số vừa cấp chưa ai dùng, rollback đã trả nó về bộ đếm. Đẩy bộ đếm lên số đó ở ca này
        // là ĐỐT một số báo giá, tạo lỗ trong dãy chứng từ. Cùng cách phân biệt createQuote đã dùng.
        if (capSoNhanBan.so && trungTren(e, "quoteNumber")) await syncQuoteCounter(capSoNhanBan.so, prefixNhanBan).catch(() => {});
        // ĐẨY CẢ BỘ ĐẾM MÃ DỰ ÁN — bị bỏ sót ở lượt vá trước, mà nhánh "nhân bản KHÔNG cùng dự án"
        // cấp mã mới bằng `nextProjectCode` NGAY TRONG transaction. Transaction hỏng cuốn theo lần
        // tăng bộ đếm đó, nên lượt thử lại sinh LẠI ĐÚNG mã vừa đụng `@@unique([projectCode,
        // projectVersion])` — bốn lượt cùng một mã rồi 409, và mỗi lần bấm đốt 4 số báo giá cho một
        // thao tác không bao giờ thành công. `createQuote` đã làm đúng (dòng ~354); đây là bản đối
        // xứng. GREATEST trong syncProjectCodeCounter nên bộ đếm không bao giờ lùi.
        if (capSoNhanBan.ma && dupCreatorProjectCode) {
          await syncProjectCodeCounter(capSoNhanBan.ma, dupCreatorProjectCode).catch(() => {});
        }
        continue;
      }
      if (code === "P2002") throw httpError(409, "Số báo giá bị trùng, vui lòng thử lại");
      throw e;
    }
  }
  await audit(req, "quote.duplicate", { resource: "quote", resourceId: created.id, after: { from: src.id, quoteNumber: created.quoteNumber } });
  return created;
}
