import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { prisma } from "../src/db.js";
import { nextQuoteNumber } from "../src/quoteNumber.js";

const isDbAvailable = !!process.env.DATABASE_URL;

describe.runIf(isDbAvailable)("nextQuoteNumber (DB-backed atomic counter)", () => {
  beforeAll(async () => {
    // Clean counter for the test prefix in current year
    const year = new Date().getFullYear();
    await prisma.quoteCounter.deleteMany({ where: { prefix: "TST", year } }).catch(() => {});
  });
  afterAll(async () => {
    const year = new Date().getFullYear();
    await prisma.quoteCounter.deleteMany({ where: { prefix: "TST", year } }).catch(() => {});
    await prisma.$disconnect();
  });

  it("allocates sequential numbers", async () => {
    const a = await nextQuoteNumber("TST");
    const b = await nextQuoteNumber("TST");
    const c = await nextQuoteNumber("TST");
    const yy = String(new Date().getFullYear()).slice(-2);
    expect(a).toBe(`TST${yy}001`);
    expect(b).toBe(`TST${yy}002`);
    expect(c).toBe(`TST${yy}003`);
  });

  it("survives concurrent allocation with no duplicates", async () => {
    const year = new Date().getFullYear();
    await prisma.quoteCounter.deleteMany({ where: { prefix: "TSC", year } }).catch(() => {});
    const results = await Promise.all(
      Array.from({ length: 25 }, () => nextQuoteNumber("TSC"))
    );
    const unique = new Set(results);
    expect(unique.size).toBe(results.length);
    // Final counter equals N
    const c = await prisma.quoteCounter.findUnique({
      where: { prefix_year: { prefix: "TSC", year } },
    });
    expect(c.value).toBe(25);
    await prisma.quoteCounter.deleteMany({ where: { prefix: "TSC", year } });
  });
});
