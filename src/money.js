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
    const subtotal = (sh.items || []).reduce((acc, it) => {
      const qty = D(it.quantity);
      const price = D(it.unitPrice);
      const days = it.days != null ? D(it.days) : null;
      const line = days && days.gt(0) ? qty.times(days).times(price) : qty.times(price);
      return acc.plus(line);
    }, new Decimal(0));
    return { sheetId: sh.id, subtotal };
  });
  const subtotal = sheetTotals.reduce((s, x) => s.plus(x.subtotal), new Decimal(0));
  const vat = subtotal.times(vatPct).dividedBy(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  const total = subtotal.plus(vat).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  return { subtotal, vat, total, sheetTotals };
}

/** Serialize Decimal fields as JS numbers for JSON response. Loses precision on huge numbers but UI-safe. */
export function totalsToJson(t) {
  return {
    subtotal: t.subtotal.toNumber(),
    vat: t.vat.toNumber(),
    total: t.total.toNumber(),
    sheetTotals: t.sheetTotals.map((s) => ({ sheetId: s.sheetId, subtotal: s.subtotal.toNumber() })),
  };
}
