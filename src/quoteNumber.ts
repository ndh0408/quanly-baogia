import { prisma } from "./db.js";

/**
 * Atomically allocate the next quote number for the given prefix and year.
 *
 * Uses an upsert that increments a counter row inside a transaction. Postgres
 * guarantees row-level locking on UPDATE, so concurrent callers serialize on
 * the same (prefix, year) row and each receives a unique sequential value.
 *
 * Format: `${prefix}${YY}${NNN}` e.g. "GN26001". Two-digit year keeps the
 * legacy "GN90" style short while avoiding rollover surprises across decades.
 */
export async function nextQuoteNumber(prefix = "GN", db = prisma) {
  const year = new Date().getFullYear();
  // upsert + atomic increment in one round-trip. When a `db` (tx) is passed the
  // counter increment shares the caller's transaction, so a failed quote.create
  // rolls back the number too (no "burned"/gap numbers).
  const counter = await db.quoteCounter.upsert({
    where: { prefix_year: { prefix, year } },
    create: { prefix, year, value: 1 },
    update: { value: { increment: 1 } },
  });
  const yy = String(year).slice(-2);
  const nn = String(counter.value).padStart(3, "0");
  return `${prefix}${yy}${nn}`;
}

/**
 * Next per-employee project code: `${prefix}_${NNN}` e.g. "FE_A26_001".
 * Uses the same atomic counter table keyed by (prefix, year=0) so each employee's
 * project code increments independently of the company quote-number sequence.
 */
export async function nextProjectCode(prefix, db = prisma) {
  const counter = await db.quoteCounter.upsert({
    where: { prefix_year: { prefix, year: 0 } },
    create: { prefix, year: 0, value: 1 },
    update: { value: { increment: 1 } },
  });
  return `${prefix}_${String(counter.value).padStart(3, "0")}`;
}
