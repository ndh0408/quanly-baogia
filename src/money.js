import { Prisma } from "@prisma/client";

const { Decimal } = Prisma;

/**
 * Convert any numeric-ish value (Decimal, number, string) to Prisma.Decimal.
 * Returns Decimal(0) for null/undefined/empty so arithmetic stays safe.
 */
export function D(v) {
  if (v == null || v === "") return new Decimal(0);
  if (v instanceof Decimal) return v;
  return new Decimal(v);
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
export function computeQuoteTotals(quote) {
  const vatPct = D(quote.vatPercent);
  const sheetTotals = (quote.sheets || []).map((sh) => {
    let mult = 1;
    const subtotal = (sh.items || []).reduce((acc, it) => {
      if (it.kind === "section") {   // nhóm: ×Số Lượng chỉ khi bật groupSubtotal; dòng nhóm không tự cộng
        mult = sh.groupSubtotal ? Math.max(1, Number(it.quantity) || 1) : 1;
        return acc;
      }
      const qty = D(it.quantity);
      const price = D(it.unitPrice);
      const days = it.days != null ? D(it.days) : null;
      const line = (days && days.gt(0) ? qty.times(days).times(price) : qty.times(price)).times(mult);
      return acc.plus(line);
    }, new Decimal(0));
    return { sheetId: sh.id, subtotal };
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
export function totalsToJson(t) {
  return {
    subtotal: t.subtotal.toNumber(),
    vat: t.vat.toNumber(),
    discount: (t.discount ?? new Decimal(0)).toNumber(),
    total: t.total.toNumber(),
    sheetTotals: t.sheetTotals.map((s) => ({ sheetId: s.sheetId, subtotal: s.subtotal.toNumber() })),
  };
}
