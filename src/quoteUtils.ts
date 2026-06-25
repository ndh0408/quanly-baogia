// Pure-ish helpers + presenters for the quotes domain, extracted from the
// (formerly 1100-line) quotes router so the route handlers stay thin and these
// pieces are unit-testable in isolation. No Express here — callers pass plain
// objects / sessions.

import { Prisma } from "@prisma/client";
import { prisma } from "./db.js";
import { computeQuoteTotals, totalsToJson, D, trunc2 } from "./money.js";
import { canOnQuote } from "./permissions.js";

// Editing rule: holders of quote:update:all may edit anything; owners may edit
// their own only while it's still draft/rejected. converted/lost are terminal
// (immutable for everyone — duplicate to make a new revision instead).
export function canEdit(quote: any, session: { role?: string; userId?: number }): boolean {
  if (quote.status === "converted" || quote.status === "lost") return false;
  if (canOnQuote(session, "update", quote)) {
    if (session.role === "admin" || session.role === "manager") return true;
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

// Account Hà Nội: CHỈ được thấy phần GIÁ HÀ NỘI. Trả về object TỐI GIẢN — KHÔNG có
// sheets/items/đơn giá/thành tiền/subtotal/vat/total/khách hàng (chống lộ nội dung báo giá
// qua API/devtools). Chỉ gồm: định danh dự án + trạng thái luồng HN + các bảng nội bộ loại
// "hanoi" (kèm sheetId để map khi lưu).
function presentQuoteForAccountHn(q: any) {
  const hnSheets = (q.sheets || []).map((s: any) => ({
    sheetId: s.id,
    sheetName: s.name || null,
    order: s.order,
    hnTables: (Array.isArray(s.extraTables) ? s.extraTables : []).filter((t: any) => t && t.category === "hanoi"),
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

/** Re-serialize Decimal -> number for the API client. Adds computed totals snapshot. */
export function presentQuote(q: any, { includeLogo = false, viewerRole = null }: { includeLogo?: boolean; viewerRole?: string | null } = {}) {
  if (viewerRole === "account_hn") return presentQuoteForAccountHn(q);   // 🔒 lược chỉ còn phần HN
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

export function presentQuoteRow(q: any, { viewerRole = null }: { viewerRole?: string | null } = {}) {
  // 🔒 account_hn: danh sách CHỈ để biết có báo giá nào được giao — KHÔNG lộ tổng tiền/khách.
  if (viewerRole === "account_hn") {
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
    const qty = trunc2(it.quantity);   // Số Lượng CẮT 2 số — KHỚP CHÍNH XÁC extraTableSumLocal (client)
    const price = Number(it.unitPrice) || 0;
    const days = it.days != null ? Number(it.days) : null;
    return acc + Math.round(days && days > 0 ? qty * days * price : qty * price);   // Thành Tiền làm tròn từng dòng
  }, 0);
}

// sheetTotals (theo ĐÚNG thứ tự sheets, từ computeQuoteTotals) → lưu materialized subtotal/sheet.
export function buildSheetsCreate(sheets: any, sheetTotals?: any[]) {
  return (sheets || []).map((s: any, sIdx: number) => ({
    templateId: Number(s.templateId),
    name: s.name?.replace(/[\r\n]+/g, " ").trim() || null,
    order: s.order != null ? Number(s.order) : sIdx + 1,
    groupSubtotal: !!s.groupSubtotal,
    subtotal: sheetTotals?.[sIdx]?.subtotal ?? D(0),
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
        unitPrice: D(it.unitPrice),
        days: it.days != null ? D(it.days) : null,
        notes: it.notes ? String(it.notes).replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim() : null,
        internalNote: it.internalNote ? String(it.internalNote).replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim() : null,   // ghi chú nội bộ — KHÔNG xuất Excel
        formulas: (it.formulas && typeof it.formulas === "object" && Object.keys(it.formulas).length) ? it.formulas : undefined,
      })),
    },
    extraTables: sanitizeExtraTables(s.extraTables),
  }));
}
