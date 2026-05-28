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
export async function nextQuoteNumber(prefix = "GN") {
  const year = new Date().getFullYear();
  const counter = await prisma.$transaction(async (tx) => {
    // upsert + atomic increment in one round-trip
    return tx.quoteCounter.upsert({
      where: { prefix_year: { prefix, year } },
      create: { prefix, year, value: 1 },
      update: { value: { increment: 1 } },
    });
  });
  const yy = String(year).slice(-2);
  const nn = String(counter.value).padStart(3, "0");
  return `${prefix}${yy}${nn}`;
}
