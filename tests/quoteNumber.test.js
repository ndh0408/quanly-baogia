import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../src/db.js";
import { nextQuoteNumber } from "../src/quoteNumber.js";

// Probe the actual connection — DATABASE_URL is always set by tests/setup.js,
// so checking the env var alone made this guard useless (suite went red on any
// machine without a local Postgres instead of skipping).
const isDbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "QuoteCounter" LIMIT 1')
  .then(() => true)
  .catch(() => false);

// In CI we set REQUIRE_DB_TESTS=1 so a missing DB/schema FAILS loudly instead of
// silently skipping — otherwise the atomic-counter guarantee could regress green.
if (!isDbAvailable && process.env.REQUIRE_DB_TESTS === "1") {
  throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres/schema — DB integration test không được phép skip trong CI");
}

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
