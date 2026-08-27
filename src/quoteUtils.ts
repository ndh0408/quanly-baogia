// Pure-ish helpers + presenters for the quotes domain, extracted from the
// (formerly 1100-line) quotes router so the route handlers stay thin and these
// pieces are unit-testable in isolation. No Express here — callers pass plain
// objects / sessions.

import { Prisma } from "@prisma/client";
import { prisma } from "./db.js";
import { computeQuoteTotals, totalsToJson, D, qtyRound } from "./money.js";
import { canOnQuote, can, PERMISSIONS } from "./permissions.js";

// Data-URL ảnh base64 hợp lệ TOÀN CHUỖI (không chỉ tiền tố). Dùng để lọc cột "Hình ảnh" khi lưu —
// khớp validators.customerLogo/itemSchema.images. Kiểm tiền tố sẽ lọt markup thoát thuộc tính src="".
const IMAGE_DATA_URL_RE = /^data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/i;

/**
 * TÊN FILE người dùng nhận được khi tải báo giá. MỘT nguồn cho CẢ HAI đường xuất.
 *
 * ── VÌ SAO PHẢI DÙNG CHUNG ──────────────────────────────────────────────────
 * Công thức này từng bị chép tay ở hai nơi và chúng ĐÃ LỆCH NHAU:
 *   · đường ĐỒNG BỘ (src/routes/export.routes.ts) cho ra "BaoGia_BG-2026-001.xlsx";
 *   · đường NỀN (src/worker.ts) không truyền `filename` vào `presignDownload` nên kho object lấy
 *     phần cuối của khoá — "BG-2026-001-1787803214822.xlsx", có cả dấu thời gian.
 * Cùng MỘT nút bấm mà ra hai kiểu tên, tuỳ báo giá to hay nhỏ — người dùng không hiểu vì sao.
 *
 * Chuyện đó quan trọng ở đường nền hơn hẳn: link tải là URL đã ký trỏ vào kho object, tức KHÁC
 * ORIGIN, mà trình duyệt BỎ QUA thuộc tính `download` của thẻ <a> khi khác origin. Nghĩa là tên
 * file do header Content-Disposition của KHO quyết định — client không sửa được.
 *
 * Bộ lọc `[^A-Za-z0-9_-]` cố ý HẸP: tên này đi thẳng vào một header HTTP
 * (`Content-Disposition: attachment; filename="..."`), nên mọi dấu nháy, chấm phẩy và dấu gạch
 * chéo phải chết ở đây. Đừng nới ra để "giữ dấu tiếng Việt" — đó là chèn header.
 */
export function tenFileXuat(quoteNumber: string | null | undefined, quoteId: number | string, ext: "xlsx" | "pdf"): string {
  const an = String(quoteNumber || `quote-${quoteId}`).replace(/[^A-Za-z0-9_-]/g, "_");
  return `BaoGia_${an}.${ext}`;
}

// Editing rule: holders of quote:update:all may edit anything; owners may edit
// their own only while it's still draft/rejected. converted/lost are terminal
// (immutable for everyone — duplicate to make a new revision instead).
export function canEdit(quote: any, session: { role?: string; userId?: number; permissions?: string[] }): boolean {
  if (quote.status === "converted" || quote.status === "lost") return false;
  if (canOnQuote(session, "update", quote)) {
    // Người có quyền "gửi khách" (admin/account mặc định) sửa được mọi trạng thái; còn lại chỉ nháp/trả lại.
    if (can(session, PERMISSIONS.QUOTE_SEND)) return true;
    return quote.status === "draft" || quote.status === "rejected";
  }
  return false;
}

// Full include for single-quote reads / write responses.
export const QUOTE_INCLUDE = {
  company: true,
  customer: { select: { code: true, name: true } },
  sheets: {
    orderBy: { order: "asc" },
    include: {
      template: true,
      items: { orderBy: { order: "asc" } },
    },
  },
  createdBy: { select: { id: true, username: true, displayName: true } },
  approvedBy: { select: { id: true, username: true, displayName: true } },
  members: { select: { id: true, username: true, displayName: true } },
} satisfies Prisma.QuoteInclude;

/**
 * Bản đọc "TRẠNG THÁI HIỆN TẠI" cho đường LƯU (`updateQuote`) — CỐ Ý liệt kê từng cột.
 *
 * `QUOTE_INCLUDE` ở trên lấy `items` bằng `include`, tức MỌI cột của QuoteItem, kể cả `images`
 * (mảng data-URL base64) và `QuoteSheet.extraTables` (jsonb chứa `paidProof` base64). Đường lưu
 * dùng bản đọc này cho ĐÚNG bốn việc: kiểm quyền sửa (`status`/`createdById`/`members`), so mốc
 * khoá lạc quan (`updatedAt`), lấy các cột vô hướng để dựng `searchText` + nhật ký, và — chỉ khi
 * payload KHÔNG kèm `sheets` — tính lại tổng tiền từ `items`. Không chỗ nào đọc ảnh.
 *
 * Đo được (tests/b2-update-quote-no-image-read.test.js, 12 hạng mục × ảnh 400KB): một lần Lưu
 * làm bảng QuoteItem đụng 1224 block TOAST, đúng GẤP ĐÔI một lần đọc đầy đủ (612) — vì cùng một
 * khối ảnh bị đọc ở đây rồi đọc lại lần nữa ở phản hồi. Bỏ ảnh khỏi lần đọc này còn 612.
 *
 * Lần đọc CUỐI (`tx.quote.update(... include: QUOTE_INCLUDE)`) thì PHẢI giữ nguyên ảnh: editor lấy
 * nguyên phản hồi làm state (`qRef.current = { ...saved }` — web/src/pages/QuoteEditor.tsx), cắt
 * ảnh ở đó là xoá trắng ảnh trên màn hình sau mỗi lần Lưu.
 *
 * `items` PHẢI giữ `orderBy: { order: "asc" }`: `computeQuoteTotals` đọc dòng "section" để đặt hệ
 * số nhân cho các dòng SAU nó, nên đảo thứ tự là ra tổng tiền khác.
 */
export const QUOTE_UPDATE_STATE_SELECT = {
  id: true, updatedAt: true, quoteNumber: true, projectCode: true, title: true,
  toCompany: true, toContact: true, status: true, hnStatus: true, currentVersion: true,
  companyId: true, vatPercent: true, discount: true, total: true, createdById: true,
  members: { select: { id: true } },
  sheets: {
    orderBy: { order: "asc" },
    select: {
      id: true, name: true, order: true, groupSubtotal: true,
      items: {
        orderBy: { order: "asc" },
        select: { kind: true, quantity: true, quantityExact: true, unitPrice: true, days: true },
      },
    },
  },
} satisfies Prisma.QuoteSelect;

// Account Hà Nội: CHỈ được thấy phần GIÁ HÀ NỘI. Trả về object TỐI GIẢN — KHÔNG có
// sheets/items/đơn giá/thành tiền/subtotal/vat/total/khách hàng (chống lộ nội dung báo giá
// qua API/devtools). Chỉ gồm: định danh dự án + trạng thái luồng HN + các bảng nội bộ loại
// "hanoi" (kèm sheetId để map khi lưu).
function presentQuoteForAccountHn(q: any) {
  const hnSheets = (q.sheets || []).map((s: any) => ({
    sheetId: s.id,
    sheetName: s.name || null,
    order: s.order,
    // stripExtraProofs: account Hà Nội KHÔNG có quote:internal:pay/internal:view, mà ảnh chứng từ
    // (base64) VẪN nằm được trên hàng bảng "hanoi" — route /pay khớp theo `rid`, không lọc category.
    // Hai presenter kia đều bọc; thiếu ở đây là vừa lộ chứng từ vừa phình payload mỗi lần mở báo giá.
    hnTables: stripExtraProofs((Array.isArray(s.extraTables) ? s.extraTables : []).filter((t: any) => t && t.category === "hanoi")),
  }));
  return {
    id: q.id,
    quoteNumber: q.quoteNumber,
    projectCode: q.projectCode,
    projectVersion: q.projectVersion,
    title: q.title,
    companyId: q.companyId,
    companyName: q.company?.shortName || q.company?.name || null,
    hnStatus: q.hnStatus || null,
    hnAssigneeId: q.hnAssigneeId || null,
    hnSubmittedAt: q.hnSubmittedAt || null,
    hnReviewedAt: q.hnReviewedAt || null,
    hnRejectNote: q.hnRejectNote || null,
    hnSheets,
    _accountHnView: true,
  };
}

// Lược ẢNH chứng từ thanh toán (base64 nặng) khỏi extraTables khi gửi client → chỉ gửi cờ hasPaidProof;
// ảnh tải on-demand qua route riêng (như personnelRecord.paymentProof).
function stripExtraProofs(extraTables: any): any {
  if (!Array.isArray(extraTables)) return extraTables;
  return extraTables.map((t: any) => ({
    ...t,
    items: (t?.items || []).map((it: any) => {
      if (!it) return it;
      const { paidProof, ...rest } = it;
      return { ...rest, hasPaidProof: !!paidProof };
    }),
  }));
}

// CHỈ XEM NỘI BỘ (quyền quote:internal:view): trả định danh dự án + CÁC BẢNG NỘI BỘ (mọi loại) — KHÔNG lộ
// giá/khách/subtotal/items báo giá chính. Ảnh chứng từ lược (hasPaidProof), tải on-demand.
function presentQuoteForInternal(q: any) {
  return {
    id: q.id,
    quoteNumber: q.quoteNumber,
    projectCode: q.projectCode,
    projectVersion: q.projectVersion,
    title: q.title,
    status: q.status,
    companyId: q.companyId,
    companyName: q.company?.shortName || q.company?.name || null,
    createdBy: q.createdBy ? { id: q.createdBy.id, displayName: q.createdBy.displayName } : null,
    internalSheets: (q.sheets || []).map((s: any) => ({
      sheetId: s.id, sheetName: s.name || null, order: s.order,
      tables: stripExtraProofs(Array.isArray(s.extraTables) ? s.extraTables : []),
    })),
    _internalView: true,
  };
}

/** Re-serialize Decimal -> number for the API client. Adds computed totals snapshot. */
export function presentQuote(q: any, { includeLogo = false, hnOnly = false, internalOnly = false }: { includeLogo?: boolean; hnOnly?: boolean; internalOnly?: boolean } = {}) {
  if (hnOnly) return presentQuoteForAccountHn(q);   // 🔒 quyền quote:hn:fill → lược chỉ còn phần HN
  if (internalOnly) return presentQuoteForInternal(q); // 🔒 quyền quote:internal:view → CHỈ bảng nội bộ
  const totals = computeQuoteTotals(q);
  const out = {
    ...q,
    vatPercent: Number(q.vatPercent),
    // subtotal/vat/total đến từ ...totalsToJson(totals) ở cuối object (ghi đè ...q) — KHÔNG đặt
    // lại ở đây vì sẽ bị spread cuối ghi đè (giá trị cuối = totals đã tính lại, y hệt hành vi cũ).
    customerCode: q.customer?.code ?? null,
    customerName: q.customer?.name ?? null,
    sheets: (q.sheets || []).map((s: any) => ({
      ...s,
      extraTables: stripExtraProofs(s.extraTables),   // lược ảnh chứng từ thanh toán (gửi hasPaidProof)
      items: (s.items || []).map((it: any) => ({
        ...it,
        quantity: Number(it.quantity),
        unitPrice: Number(it.unitPrice),
        days: it.days != null ? Number(it.days) : null,
      })),
    })),
    ...totalsToJson(totals),
  };
  // base64 logo is large — only ship it when explicitly needed (single quote fetch).
  if (!includeLogo) delete out.customerLogo;
  return out;
}

// Lightweight projection for the LIST view: NO customerLogo (base64, bloats the
// row) and NO sheets/items (the list only needs a sheet COUNT). Uses the stored
// snapshot totals — no per-row recompute. Hot, frequently-refetched query.
export const QUOTE_LIST_SELECT = {
  id: true, quoteNumber: true, projectCode: true, projectVersion: true,
  title: true, toCompany: true, status: true, quoteDate: true,
  subtotal: true, vat: true, discount: true, total: true, vatPercent: true,
  createdAt: true, createdById: true, hnStatus: true, hnAssigneeId: true,
  company: { select: { id: true, name: true, shortName: true } },
  customer: { select: { code: true, name: true } },
  createdBy: { select: { id: true, displayName: true } },
  _count: { select: { sheets: true } },
};

export function presentQuoteRow(q: any, { hnOnly = false, internalOnly = false }: { hnOnly?: boolean; internalOnly?: boolean } = {}) {
  // 🔒 quote:internal:view: danh sách CHỈ để chọn dự án quản thanh toán nội bộ — KHÔNG lộ giá/khách báo giá chính.
  if (internalOnly) {
    const allItems = (q.sheets || []).flatMap((s: any) => (Array.isArray(s.extraTables) ? s.extraTables : []).flatMap((t: any) => t?.items || []));
    const rows = allItems.filter((it: any) => it && it.kind !== "section" && it.kind !== "subsection" && it.kind !== "info");
    return {
      id: q.id, quoteNumber: q.quoteNumber, projectCode: q.projectCode, projectVersion: q.projectVersion,
      title: q.title, status: q.status, quoteDate: q.quoteDate, createdAt: q.createdAt,
      company: q.company ? { id: q.company.id, name: q.company.name, shortName: q.company.shortName } : null,
      createdBy: q.createdBy ? { id: q.createdBy.id, displayName: q.createdBy.displayName } : null,
      internalRows: rows.length,
      internalPaidRows: rows.filter((it: any) => it.paid).length,
      sheetCount: q._count?.sheets ?? 0,
      _internalRow: true,
    };
  }
  // 🔒 quote:hn:fill: danh sách CHỉ để biết có báo giá nào được giao — KHÔNG lộ tổng tiền/khách.
  if (hnOnly) {
    // Số SHEET HN + TỔNG HN = đúng phần account TỰ LÀM (gộp các bảng "hanoi" của mọi sheet).
    // Đây là số NỘI BỘ của chính account → hiện cho họ OK; vẫn KHÔNG lộ tiền/khách báo giá chính.
    const hanoi = (q.sheets || []).flatMap((s: any) => (Array.isArray(s.extraTables) ? s.extraTables : []).filter((t: any) => t && t.category === "hanoi"));
    return {
      id: q.id, quoteNumber: q.quoteNumber, projectCode: q.projectCode, projectVersion: q.projectVersion,
      title: q.title, status: q.status, quoteDate: q.quoteDate, createdAt: q.createdAt,
      company: q.company ? { id: q.company.id, name: q.company.name, shortName: q.company.shortName } : null,
      // "Người giao" — để account biết báo giá này của ai / ai kêu mình làm. KHÔNG lộ tiền/khách.
      createdBy: q.createdBy ? { id: q.createdBy.id, displayName: q.createdBy.displayName } : null,
      hnStatus: q.hnStatus ?? null,
      hnSheetCount: hanoi.length,
      hnTotal: hanoi.reduce((a: number, t: any) => a + extraTableSum(t), 0),
      sheetCount: q._count?.sheets ?? 0,
      _accountHnRow: true,
    };
  }
  return {
    ...q,
    vatPercent: Number(q.vatPercent),
    subtotal: Number(q.subtotal),
    vat: Number(q.vat),
    discount: Number(q.discount),
    total: Number(q.total),
    customerCode: q.customer?.code ?? null,
    customerName: q.customer?.name ?? null,
    sheetCount: q._count?.sheets ?? 0,
  };
}

/** True if every sheet's templateId is an active template belonging to companyId. */
export async function templatesBelongToCompany(sheets: any[], companyId: number) {
  const ids: number[] = [...new Set((sheets || []).map((s: any) => Number(s.templateId)).filter(Boolean))] as number[];
  if (!ids.length) return true;
  const found = await prisma.quoteTemplate.findMany({
    where: { id: { in: ids }, companyId, active: true },
    select: { id: true },
  });
  return found.length === ids.length;
}

// Làm sạch "bảng nội bộ" (extraTables) → JSON thuần cho cột Json của QuoteSheet.
// KHÔNG tạo QuoteItem nên KHÔNG vào Excel/tổng báo giá. Trả undefined nếu rỗng.
export function sanitizeExtraTables(tables: any) {
  if (!Array.isArray(tables) || !tables.length) return undefined;
  const VALID = new Set(["hcm", "hanoi", "khach"]);
  const out = tables.filter((t: any) => t && VALID.has(t.category)).map((t: any) => ({
    category: t.category,
    name: t.name ? String(t.name).replace(/[\r\n]+/g, " ").trim().slice(0, 120) : null,
    templateId: t.templateId != null ? Number(t.templateId) : null,   // mẫu cột (GN/CLF có/không ngày)
    groupSubtotal: !!t.groupSubtotal,
    items: (t.items || []).map((it: any) => ({
      kind: ["info", "sub", "section", "subsection"].includes(it.kind) ? it.kind : "item",
      label: it.label ? String(it.label).replace(/[\r\n]+/g, " ").trim().slice(0, 12) : null,   // nhãn nhóm tự gõ (A/B…) — đừng mất khi lưu
      name: (it.name || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim(),
      detail: it.detail ? String(it.detail).trim() : null,
      unit: it.unit ? String(it.unit).replace(/[\r\n]+/g, " ").trim() : null,
      quantity: Number(it.quantity) || 0,
      // Cờ "số lẻ chính xác" PHẢI theo được xuống DB: `extraTableSum` rẽ nhánh theo nó (giữ 4 chữ số
      // thập phân thay vì `qtyRound` cắt còn 1). Thiếu dòng này thì tổng bảng nội bộ NHẢY SỐ sau khi
      // tải lại trang, dù không ai sửa gì — đường lưới chính (buildSheetsCreate) vốn đã persist cờ này.
      quantityExact: !!it.quantityExact,
      unitPrice: Number(it.unitPrice) || 0,
      days: it.days != null ? Number(it.days) : null,
      notes: it.notes ? String(it.notes).trim() : null,
      formulas: (it.formulas && typeof it.formulas === "object" && Object.keys(it.formulas).length) ? it.formulas : undefined,
      // rid = id ỔN ĐỊNH cho từng hàng → server khớp được trạng thái DUYỆT khi non-admin lưu
      // (chống tự duyệt qua payload). approved/approvedAt/approvedBy do reconcileExtraApprovals
      // đặt TRƯỚC khi sanitize (chỉ admin được đổi) — ở đây chỉ persist nguyên trạng.
      rid: (typeof it.rid === "string" && it.rid) ? it.rid : globalThis.crypto.randomUUID(),
      approved: !!it.approved,
      approvedAt: it.approvedAt || null,
      approvedBy: it.approvedBy != null ? it.approvedBy : null,
      // THANH TOÁN per-hàng — reconcileExtraPayments đặt TRƯỚC sanitize; persist nguyên trạng (ảnh giữ trong DB,
      // presentQuote strip khi gửi client). Chỉ route /pay mới đổi paid/ảnh; quote-save không sửa được (chống giả).
      paid: !!it.paid,
      paidAt: it.paidAt || null,
      paidById: it.paidById != null ? it.paidById : null,
      paidProof: typeof it.paidProof === "string" ? it.paidProof : null,
    })),
  }));
  return out.length ? out : undefined;
}

// Tổng tiền 1 bảng nội bộ (cùng quy tắc với item báo giá; section/info không cộng).
// CHI PHÍ HCM + PHÍ KHÁCH HÀNG: CHỈ cộng hàng ĐÃ DUYỆT (approved). Hà Nội: cộng tất cả (luồng riêng).
export function extraTableSum(t: any) {
  const approvedOnly = t && (t.category === "hcm" || t.category === "khach");
  return (t?.items || []).reduce((acc: number, it: any) => {
    if (it.kind === "section" || it.kind === "subsection" || it.kind === "info") return acc;   // nhóm/nhóm con/info không cộng (đơn giá nhóm là tổng tự tính)
    if (approvedOnly && !it.approved) return acc;   // HCM/Phí KH: chưa duyệt → KHÔNG tính
    const qty = it.quantityExact ? Math.round((Number(it.quantity) || 0) * 10_000) / 10_000 : qtyRound(it.quantity);
    const price = Number(it.unitPrice) || 0;
    const days = it.days != null ? Number(it.days) : null;
    return acc + Math.round(days && days > 0 ? qty * days * price : qty * price);   // Thành Tiền làm tròn từng dòng
  }, 0);
}

// sheetTotals (theo ĐÚNG thứ tự sheets, từ computeQuoteTotals) → lưu materialized subtotal/sheet.
/** Lọc đúng các field được phép bê sang bản sheet mới (bỏ undefined/null để Prisma dùng mặc định). */
function pickCarry(src?: Record<string, any>) {
  if (!src) return {};
  const out: Record<string, any> = {};
  for (const f of SHEET_CARRY_FIELDS) if (src[f] != null) out[f] = src[f];
  return out;
}

/**
 * Trạng thái sống ở MỨC SHEET, do server giữ — client KHÔNG đặt được qua đường lưu thường.
 * Lưu báo giá là XOÁ SHEET rồi TẠO LẠI (updateQuote), nên các mốc này phải được BÊ SANG bản mới,
 * nếu không mỗi lần bấm Lưu là mất sạch: khách duyệt sheet, chữ ký, số hoá đơn, ngày thanh toán…
 * Mỗi phần tử của `carry` khớp theo VỊ TRÍ với `sheets` (updateQuote dò theo sheet.id, không có
 * id thì theo thứ tự) — `undefined` = sheet mới, không bê gì.
 */
export const SHEET_CARRY_FIELDS = [
  "custStatus", "custStatusAt", "custStatusById", "custNote",
  "signedAt", "signedById", "signedByName",
  "invoiceNo", "paidAt", "poNumber", "hnInvoiceNo", "invoiceLink", "docSentAt", "docReturnedAt",
  "invoiceDate", "paymentMethod", "orderClosedAt", "invoiceYear", "invoiceCompany", "invoiceDesc", "invoiceNote",
] as const;

export function buildSheetsCreate(sheets: any, sheetTotals?: any[], carry?: (Record<string, any> | undefined)[]) {
  return (sheets || []).map((s: any, sIdx: number) => ({
    templateId: Number(s.templateId),
    name: s.name?.replace(/[\r\n]+/g, " ").trim() || null,
    order: s.order != null ? Number(s.order) : sIdx + 1,
    groupSubtotal: !!s.groupSubtotal,
    showImages: !!s.showImages,   // BẬT cột "Hình ảnh" cho sheet
    subtotal: sheetTotals?.[sIdx]?.subtotal ?? D(0),
    ...pickCarry(carry?.[sIdx]),
    items: {
      create: (s.items || []).map((it: any, iIdx: number) => ({
        order: it.order != null ? Number(it.order) : iIdx + 1,
        // Preserve the catalog link so an edit (which deletes+recreates sheets)
        // doesn't lose productId and break product-level reporting/history.
        productId: it.productId != null ? Number(it.productId) : null,
        kind: ["info", "sub", "section", "subsection"].includes(it.kind) ? it.kind : "item",
        label: it.label ? String(it.label).replace(/[\r\n]+/g, " ").trim().slice(0, 12) : null,
        name: (it.name || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim(),
        detail: it.detail ? String(it.detail).replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim() : null,
        unit: it.unit?.replace(/[\r\n]+/g, " ").trim() || null,
        quantity: D(it.quantity),
        quantityExact: !!it.quantityExact,
        unitPrice: D(it.unitPrice),
        days: it.days != null ? D(it.days) : null,
        notes: it.notes ? String(it.notes).replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim() : null,
        internalNote: it.internalNote ? String(it.internalNote).replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim() : null,   // ghi chú nội bộ — KHÔNG xuất Excel
        formulas: (it.formulas && typeof it.formulas === "object" && Object.keys(it.formulas).length) ? it.formulas : undefined,
        // Cột "Hình ảnh": chỉ giữ data-URL ảnh base64 HỢP LỆ TOÀN CHUỖI (không chỉ tiền tố — kiểm tiền tố
        // để lọt markup thoát thuộc tính src="" → chèn HTML ở lưới editor). Tối đa 10 ảnh/hạng mục.
        images: (Array.isArray(it.images) && it.images.length) ? it.images.filter((x: any) => typeof x === "string" && IMAGE_DATA_URL_RE.test(x)).slice(0, 10) : undefined,
      })),
    },
    extraTables: sanitizeExtraTables(s.extraTables),
  }));
}
