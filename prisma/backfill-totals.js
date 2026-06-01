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
    const t = computeQuoteTotals({ vatPercent: q.vatPercent, sheets: q.sheets });
    const same =
      q.subtotal.equals(t.subtotal) && q.vat.equals(t.vat) && q.total.equals(t.total);
    if (same) continue;
    await prisma.quote.update({
      where: { id: q.id },
      data: { subtotal: t.subtotal, vat: t.vat, total: t.total },
    });
    fixed++;
    console.log(`  ${q.quoteNumber}: total ${q.total} -> ${t.total}`);
  }
  console.log(`✓ Backfilled ${fixed}/${quotes.length} quotes.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
