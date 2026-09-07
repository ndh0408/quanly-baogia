import { prisma } from "./db.js";
import { namVN, namNganVN } from "./vnTime.js";

export async function nextCustomerCode(prefix = "KH", db = prisma) {
  const year = namVN();   // NĂM THEO GIỜ VN (xem src/vnTime.ts)
  const counter = await db.customerCounter.upsert({
    where: { prefix_year: { prefix, year } },
    create: { prefix, year, value: 1 },
    update: { value: { increment: 1 } },
  });
  const yy = namNganVN();
  return `${prefix}${yy}${String(counter.value).padStart(4, "0")}`;
}
