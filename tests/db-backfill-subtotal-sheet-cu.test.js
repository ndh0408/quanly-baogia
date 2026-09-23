/**
 * DB-01 — CỘT QuoteSheet.subtotal CỦA SHEET CŨ CÒN MANG 0: SỬA DỮ LIỆU MỘT LẦN, CÓ CHẾ ĐỘ KHÔ.
 *
 * Trang Hoá đơn / Quản lý dự án / Dashboard đọc thẳng cột này. Sheet lưu trước migration
 * 20260625000003 mang 0 cho tới khi có người bấm Lưu. Script backfill cũ thì ghi đè MỌI sheet (kể cả
 * sheet đúng), không có chế độ khô, nạp hàng không theo thứ tự (hệ số nhóm phụ thuộc thứ tự) và không
 * nằm trong image production.
 *
 * Bài này khoá: (1) kế hoạch chỉ gồm sheet `subtotal ≤ 0` có tiền thật, số mới = computeQuoteTotals
 * với hàng theo đúng thứ tự; (2) sheet đã đúng và sheet rỗng thật KHÔNG bị đụng; (3) lập kế hoạch
 * không ghi gì; (4) áp dụng thì ghi đúng số, và nhường cho một lần Lưu chen giữa.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import { prisma } from "../src/db.js";
import { keHoachBackfillSubtotal, apDungBackfillSubtotal } from "../src/sheetSubtotalBackfill.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "User" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") {
  throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");
}

const TAG = `dbbf${Date.now()}`;

describe.runIf(dbAvailable)("DB-01 — backfill subtotal sheet cũ", () => {
  let company, template, user, q;
  const id = {};

  beforeAll(async () => {
    company = await prisma.company.create({ data: { code: `${TAG}-co`, name: "Co", address: "x", quotePrefix: "BF" } });
    template = await prisma.quoteTemplate.create({ data: { code: `${TAG}-tpl`, name: "T", companyId: company.id, filePath: "templates/Unibenfood.xlsx" } });
    user = await prisma.user.create({ data: { username: `${TAG}-u`, displayName: "U", role: "admin", passwordHash: await bcrypt.hash("x", 4) } });
    q = await prisma.quote.create({
      data: {
        quoteNumber: `${TAG}-Q`, title: `${TAG} bg`, toCompany: "K", companyId: company.id, createdById: user.id,
        fromContact: "x", fromAddress: "x", city: "x", quoteDate: new Date(), status: "converted",
        subtotal: 0, vat: 0, total: 0,
        sheets: {
          create: [
            // Sheet cũ: nhóm hệ số 2 đứng TRƯỚC hai dòng → (1×1.000.000 + 3×500.000) × 2 = 5.000.000.
            { templateId: template.id, name: "cu", order: 1, groupSubtotal: true, subtotal: 0, items: { create: [
              { order: 1, kind: "section", name: "Nhóm", quantity: 2, unitPrice: 0 },
              { order: 2, kind: "item", name: "A", quantity: 1, unitPrice: 1_000_000 },
              { order: 3, kind: "item", name: "B", quantity: 3, unitPrice: 500_000 },
            ] } },
            // Sheet đã đúng — không được đụng.
            { templateId: template.id, name: "dung", order: 2, subtotal: 700_000, items: { create: [{ order: 1, kind: "item", name: "C", quantity: 1, unitPrice: 700_000 }] } },
            // Sheet rỗng thật — tổng 0 là đúng, không có gì để ghi.
            { templateId: template.id, name: "rong", order: 3, subtotal: 0 },
          ],
        },
      },
      include: { sheets: true },
    });
    for (const s of q.sheets) id[s.name] = s.id;
  }, 60_000);

  afterAll(async () => {
    await prisma.quote.deleteMany({ where: { title: { startsWith: TAG } }, hardDelete: true, includeDeleted: true }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true, includeDeleted: true }).catch(() => {});
    await prisma.quoteTemplate.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.company.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
  });

  const cot = async (sheetId) => Number((await prisma.quoteSheet.findUnique({ where: { id: sheetId }, select: { subtotal: true } })).subtotal);

  it("lập kế hoạch: chỉ sheet cũ mang 0 có tiền thật, số đúng theo thứ tự hàng; không ghi gì", async () => {
    const kh = await keHoachBackfillSubtotal({ quoteIds: [q.id] });
    expect(kh).toEqual([{ quoteId: q.id, sheetId: id.cu, cu: "0", moi: "5000000" }]);
    expect(await cot(id.cu), "chế độ khô đã ghi xuống CSDL").toBe(0);
  });

  it("áp dụng: ghi đúng sheet cũ, không đụng sheet đúng/rỗng; chạy lại không còn gì", async () => {
    const kh = await keHoachBackfillSubtotal({ quoteIds: [q.id] });
    expect(await apDungBackfillSubtotal(kh)).toBe(1);
    expect(await cot(id.cu)).toBe(5_000_000);
    expect(await cot(id.dung)).toBe(700_000);
    expect(await cot(id.rong)).toBe(0);
    expect(await keHoachBackfillSubtotal({ quoteIds: [q.id] })).toEqual([]);
  });

  it("một lần Lưu chen giữa lập kế hoạch và áp dụng → nhường, không đè số mới hơn", async () => {
    await prisma.quoteSheet.update({ where: { id: id.cu }, data: { subtotal: 0 } });
    const kh = await keHoachBackfillSubtotal({ quoteIds: [q.id] });
    await prisma.quoteSheet.update({ where: { id: id.cu }, data: { subtotal: 1_234_000 } });   // người dùng vừa Lưu
    expect(await apDungBackfillSubtotal(kh)).toBe(0);
    expect(await cot(id.cu)).toBe(1_234_000);
  });
});
