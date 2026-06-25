// Backfill cột searchText cho rows CŨ (chạy 1 lần sau migration add_search_text).
// Dùng CHUNG normalizeSearch với app → khớp 100% cách app ghi khi create/update.
// Chạy: node --import tsx prisma/backfill-searchtext.mjs   (cần Prisma client đã generate có searchText)
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { normalizeSearch } from "../src/searchText.js";

const prisma = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })) });

async function main() {
  const customers = await prisma.customer.findMany({
    select: { id: true, name: true, code: true, phone: true, email: true, taxCode: true, contactName: true },
  });
  for (const c of customers) {
    await prisma.customer.update({
      where: { id: c.id },
      data: { searchText: normalizeSearch(c.name, c.code, c.phone, c.email, c.taxCode, c.contactName) },
    });
  }
  console.log(`✓ backfill searchText: ${customers.length} customers`);

  const quotes = await prisma.quote.findMany({
    select: { id: true, quoteNumber: true, projectCode: true, title: true, toCompany: true, toContact: true },
  });
  for (const q of quotes) {
    await prisma.quote.update({
      where: { id: q.id },
      data: { searchText: normalizeSearch(q.quoteNumber, q.projectCode, q.title, q.toCompany, q.toContact) },
    });
  }
  console.log(`✓ backfill searchText: ${quotes.length} quotes`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
