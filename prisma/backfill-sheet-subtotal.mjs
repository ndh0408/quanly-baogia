// Backfill QuoteSheet.subtotal cho rows CŨ (chạy 1 lần sau migration quotesheet_subtotal).
// Tính LẠI bằng CHÍNH computeQuoteTotals (như listProjects cũ) → giá trị materialized Y HỆT cách tính cũ
// → trang Quản lý dự án không đổi 1 số nào. Chạy: node --import tsx prisma/backfill-sheet-subtotal.mjs
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { computeQuoteTotals } from "../src/money.js";

const prisma = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })) });

async function main() {
  const quotes = await prisma.quote.findMany({
    select: {
      id: true, vatPercent: true, discount: true,
      sheets: { select: { id: true, groupSubtotal: true, items: { select: { kind: true, quantity: true, unitPrice: true, days: true } } } },
    },
  });
  let n = 0;
  for (const q of quotes) {
    const { sheetTotals } = computeQuoteTotals(q);
    const byId = new Map(sheetTotals.map((s) => [s.sheetId, s.subtotal]));
    for (const sh of q.sheets) {
      await prisma.quoteSheet.update({ where: { id: sh.id }, data: { subtotal: byId.get(sh.id) ?? 0 } });
      n++;
    }
  }
  console.log(`✓ backfill sheet.subtotal: ${n} sheets / ${quotes.length} quotes`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
