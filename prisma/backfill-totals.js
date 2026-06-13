// One-off: recompute and persist subtotal/vat/total for every quote from its
// items. Legacy/seed rows were stored with total=0 while the UI recomputed from
// items on the fly, so analytics (which reads the column) showed revenue 0.
import { prisma } from "../src/db.js";
import { computeQuoteTotals } from "../src/money.js";

async function main() {
  const quotes = await prisma.quote.findMany({
    include: { sheets: { include: { items: true } } },
  });
  let fixed = 0;
  for (const q of quotes) {
    // Must pass the existing discount so total = subtotal + vat − discount is
    // correct AND the clamped discount is persisted (omitting it computed total
    // without discount and would overwrite the discount column with 0).
    const t = computeQuoteTotals({ vatPercent: q.vatPercent, discount: q.discount, sheets: q.sheets });
    const same =
      q.subtotal.equals(t.subtotal) && q.vat.equals(t.vat) && q.discount.equals(t.discount) && q.total.equals(t.total);
    if (same) continue;
    await prisma.quote.update({
      where: { id: q.id },
      data: { subtotal: t.subtotal, vat: t.vat, discount: t.discount, total: t.total },
    });
    fixed++;
    console.log(`  ${q.quoteNumber}: total ${q.total} -> ${t.total}`);
  }
  console.log(`✓ Backfilled ${fixed}/${quotes.length} quotes.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
