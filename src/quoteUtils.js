// Pure-ish helpers + presenters for the quotes domain, extracted from the
// (formerly 1100-line) quotes router so the route handlers stay thin and these
// pieces are unit-testable in isolation. No Express here — callers pass plain
// objects / sessions.

import { prisma } from "./db.js";
import { computeQuoteTotals, totalsToJson, D } from "./money.js";
import { canOnQuote } from "./permissions.js";

// Editing rule: holders of quote:update:all may edit anything; owners may edit
// their own only while it's still draft/rejected. converted/lost are terminal
// (immutable for everyone — duplicate to make a new revision instead).
export function canEdit(quote, session) {
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
};

/** Re-serialize Decimal -> number for the API client. Adds computed totals snapshot. */
export function presentQuote(q, { includeLogo = false } = {}) {
  const totals = computeQuoteTotals(q);
  const out = {
    ...q,
    vatPercent: Number(q.vatPercent),
    subtotal: Number(q.subtotal ?? totals.subtotal),
    vat: Number(q.vat ?? totals.vat),
    total: Number(q.total ?? totals.total),
    customerCode: q.customer?.code ?? null,
    customerName: q.customer?.name ?? null,
    sheets: (q.sheets || []).map((s) => ({
      ...s,
      items: (s.items || []).map((it) => ({
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
  createdAt: true, createdById: true,
  company: { select: { id: true, name: true, shortName: true } },
  customer: { select: { code: true, name: true } },
  createdBy: { select: { id: true, displayName: true } },
  _count: { select: { sheets: true } },
};

export function presentQuoteRow(q) {
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
export async function templatesBelongToCompany(sheets, companyId) {
  const ids = [...new Set((sheets || []).map((s) => Number(s.templateId)).filter(Boolean))];
  if (!ids.length) return true;
  const found = await prisma.quoteTemplate.findMany({
    where: { id: { in: ids }, companyId, active: true },
    select: { id: true },
  });
  return found.length === ids.length;
}

// Làm sạch "bảng nội bộ" (extraTables) → JSON thuần cho cột Json của QuoteSheet.
// KHÔNG tạo QuoteItem nên KHÔNG vào Excel/tổng báo giá. Trả undefined nếu rỗng.
export function sanitizeExtraTables(tables) {
  if (!Array.isArray(tables) || !tables.length) return undefined;
  const VALID = new Set(["hcm", "hanoi", "khach"]);
  const out = tables.filter((t) => t && VALID.has(t.category)).map((t) => ({
    category: t.category,
    name: t.name ? String(t.name).replace(/[\r\n]+/g, " ").trim().slice(0, 120) : null,
    templateId: t.templateId != null ? Number(t.templateId) : null,   // mẫu cột (GN/CLF có/không ngày)
    groupSubtotal: !!t.groupSubtotal,
    items: (t.items || []).map((it) => ({
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
    })),
  }));
  return out.length ? out : undefined;
}

// Tổng tiền 1 bảng nội bộ (cùng quy tắc với item báo giá; section/info không cộng).
export function extraTableSum(t) {
  return (t?.items || []).reduce((acc, it) => {
    if (it.kind === "section" || it.kind === "subsection" || it.kind === "info") return acc;   // nhóm/nhóm con/info không cộng (đơn giá nhóm là tổng tự tính)
    const qty = Number(it.quantity) || 0;
    const price = Number(it.unitPrice) || 0;
    const days = it.days != null ? Number(it.days) : null;
    return acc + (days && days > 0 ? qty * days * price : qty * price);
  }, 0);
}

export function buildSheetsCreate(sheets) {
  return (sheets || []).map((s, sIdx) => ({
    templateId: Number(s.templateId),
    name: s.name?.replace(/[\r\n]+/g, " ").trim() || null,
    order: s.order != null ? Number(s.order) : sIdx + 1,
    groupSubtotal: !!s.groupSubtotal,
    items: {
      create: (s.items || []).map((it, iIdx) => ({
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
