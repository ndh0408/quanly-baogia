import { prisma } from "./db.js";

export async function nextCustomerCode(prefix = "KH", db = prisma) {
  const year = new Date().getFullYear();
  const counter = await db.customerCounter.upsert({
    where: { prefix_year: { prefix, year } },
    create: { prefix, year, value: 1 },
    update: { value: { increment: 1 } },
  });
  const yy = String(year).slice(-2);
  return `${prefix}${yy}${String(counter.value).padStart(4, "0")}`;
}
