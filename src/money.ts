import { Prisma } from "@prisma/client";

const { Decimal } = Prisma;

/**
 * Convert any numeric-ish value (Decimal, number, string) to Prisma.Decimal.
 * Returns Decimal(0) for null/undefined/empty so arithmetic stays safe.
 */
export function D(v: Prisma.Decimal.Value | null | undefined) {
  if (v == null || v === "") return new Decimal(0);
  if (v instanceof Decimal) return v;
  return new Decimal(v);
}

/** CẮT số về 2 chữ số thập phân — KHÔNG làm tròn (5,6375→5,63). Cho code dùng number (quoteUtils/excel). */
export function trunc2(x: unknown) {
  const n = Number(x) || 0;
  const t = Math.trunc(Math.abs(n) * 100 + 1e-6) / 100;   // +1e-6 khử nhiễu float, vẫn CẮT
  return n < 0 ? -t : t;
}

/**
 * Recompute snapshot totals for a Quote (with sheets/items eager-loaded).
 * Returns { subtotal, vat, total, sheetTotals } all as Decimal — caller stores them.
 *
 * Per-item amount:
 *   - days null/0  → quantity × unitPrice
 *   - days > 0     → quantity × days × unitPrice
 *
 * Rounding policy: half-up to 0 dp for VAT and total (VND has no fractional units).
 */
// Structural shape of what the body actually reads. The full Prisma `Quote & {sheets:[...]}`
// row satisfies this, and so does the slim `{ vatPercent, discount, sheets }` built by callers
// (computed totals before a write). Widening the param to this structural type is a pure
// type relaxation — no runtime change.
type QuoteTotalsInput = {
  vatPercent: Prisma.Decimal.Value | null | undefined;
  discount?: Prisma.Decimal.Value | null | undefined;
  sheets?: ({
    id?: number;
    groupSubtotal?: boolean | null;
    items?: {
      kind?: string | null;
      quantity?: Prisma.Decimal.Value | null | undefined;
      unitPrice?: Prisma.Decimal.Value | null | undefined;
      days?: Prisma.Decimal.Value | null | undefined;
    }[] | null;
  })[] | null;
};

export function computeQuoteTotals(quote: QuoteTotalsInput) {
  const vatPct = D(quote.vatPercent);
  const sheetTotals = (quote.sheets || []).map((sh) => {
    let mult = 1;
    const subtotal = (sh.items || []).reduce((acc, it) => {
      if (it.kind === "section" || it.kind === "subsection") {   // nhóm/nhóm con: header — đặt mult, không tự cộng. Item con vẫn vào tổng cộng.
        mult = sh.groupSubtotal ? Math.max(1, Number(it.quantity) || 1) : 1;
        return acc;
      }
      if (it.kind === "info") return acc;   // dòng thông tin: không tính tiền (khớp với Excel + client)
      // Số Lượng CẮT còn 2 số (ROUND_DOWN = cắt, không làm tròn) — khớp hiển thị + Excel TRUNC.
      const qty = D(it.quantity).toDecimalPlaces(2, Decimal.ROUND_DOWN);
      const price = D(it.unitPrice);
      const days = it.days != null ? D(it.days) : null;
      // Thành Tiền 1 dòng làm tròn số nguyên (khớp hiển thị + Excel) RỒI mới nhân hệ số nhóm
      // → dòng cộng lại đúng bằng tổng, không lệch sub-đồng.
      const base = (days && days.gt(0) ? qty.times(days).times(price) : qty.times(price)).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
      return acc.plus(base.times(mult));
    }, new Decimal(0));
    return { sheetId: sh.id ?? 0, subtotal };
  });
  // Round subtotal to 0 dp too (VND has no fractional unit) so the stored
  // subtotal column matches what we recompute on read — no sub-đồng drift.
  const subtotal = sheetTotals
    .reduce((s, x) => s.plus(x.subtotal), new Decimal(0))
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  const vat = subtotal.times(vatPct).dividedBy(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  const gross = subtotal.plus(vat);
  // Optional negotiated discount (giảm giá), in VNĐ, subtracted from the grand total.
  // Clamped to the gross so the total never goes negative.
  const discInput = D(quote.discount).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  const discount = discInput.greaterThan(gross) ? gross : (discInput.lessThan(0) ? new Decimal(0) : discInput);
  const total = gross.minus(discount).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  return { subtotal, vat, discount, total, sheetTotals };
}

/** Serialize Decimal fields as JS numbers for JSON response. Loses precision on huge numbers but UI-safe. */
export function totalsToJson(t: {
  subtotal: Prisma.Decimal;
  vat: Prisma.Decimal;
  discount?: Prisma.Decimal | null;
  total: Prisma.Decimal;
  sheetTotals: { sheetId: number; subtotal: Prisma.Decimal }[];
}) {
  return {
    subtotal: t.subtotal.toNumber(),
    vat: t.vat.toNumber(),
    discount: (t.discount ?? new Decimal(0)).toNumber(),
    total: t.total.toNumber(),
    sheetTotals: t.sheetTotals.map((s) => ({ sheetId: s.sheetId, subtotal: s.subtotal.toNumber() })),
  };
}
