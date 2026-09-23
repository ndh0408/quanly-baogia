/**
 * MONEY-02 — TỔNG TIỀN LƯU PHẢI KHỚP TỔNG TÍNH LẠI TỪ HÀNG CSDL.
 *
 * Tổng lưu (Quote.total / QuoteSheet.subtotal — nguồn của danh sách, trang Dự án/Hoá đơn, KPI) từng
 * được tính trên payload THÔ, trong khi Postgres làm tròn từng cột lúc ghi và màn chi tiết / Excel /
 * PDF tính lại từ hàng CSDL. Nguồn kích hoạt thật: ô công thức chia (=10/3) lưu float nguyên văn.
 * Đo được: ngày =10/3 × 1.000.000, VAT 8% → lưu 3.600.000, đọc lại 3.596.400.
 * Ngoài ra số quá lớn làm tràn cột Decimal(18,2) → 500 thay vì 400.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import { agentWithCsrf } from "./helpers/agent.js";
import { prisma } from "../src/db.js";
import { chuanHoaTheoCot, chuanHoaVat, computeQuoteTotals } from "../src/money.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "User" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") {
  throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");
}

const TAG = `mntl${Date.now()}`;
const MAT_KHAU = "TongLuu1234!ok";

describe("chuanHoaTheoCot — hàm thuần", () => {
  it("tổng sau chuẩn hoá BẰNG tổng tính trên giá trị đã làm tròn như CSDL", () => {
    const tho = [{ id: 1, items: [
      { kind: "item", quantity: 1, unitPrice: 1_000_000, days: 10 / 3 },
      { kind: "item", quantity: 9999, unitPrice: 1000 / 7 },
      { kind: "item", quantity: 1.04996, unitPrice: 1_000_000 },
    ] }];
    const nhuCsdl = [{ id: 1, items: [
      { kind: "item", quantity: "1.0000", unitPrice: "1000000.0000", days: "3.33" },
      { kind: "item", quantity: "9999.0000", unitPrice: "142.8571" },
      { kind: "item", quantity: "1.0500", unitPrice: "1000000.0000" },
    ] }];
    chuanHoaTheoCot(tho);
    expect(tho[0].items[0].days).toBe(3.33);
    expect(tho[0].items[1].unitPrice).toBe(142.8571);
    expect(tho[0].items[2].quantity).toBe(1.05);
    const vat = chuanHoaVat(8.125);
    expect(vat.toString()).toBe("8.13");
    expect(computeQuoteTotals({ vatPercent: vat, sheets: tho }).total.toString())
      .toBe(computeQuoteTotals({ vatPercent: "8.13", sheets: nhuCsdl }).total.toString());
  });

  it("đầu vào lạ không ném", () => {
    expect(() => chuanHoaTheoCot(null)).not.toThrow();
    expect(() => chuanHoaTheoCot([{ items: null }, null, { items: [null, { quantity: null, days: null }] }])).not.toThrow();
  });
});

describe.runIf(dbAvailable)("MONEY-02 — tổng lưu = tổng đọc lại", () => {
  let app, company, template, adminU, admin;

  beforeAll(async () => {
    app = (await import("../src/app.js")).createApp();
    company = await prisma.company.create({ data: { code: `${TAG}-co`, name: "Co", address: "x", quotePrefix: "TL" } });
    template = await prisma.quoteTemplate.create({ data: { code: `${TAG}-tpl`, name: "T", companyId: company.id, filePath: "templates/Unibenfood.xlsx" } });
    adminU = await prisma.user.create({ data: { username: `${TAG}-ad`, displayName: "Ad", role: "admin", passwordHash: await bcrypt.hash(MAT_KHAU, 4) } });
    admin = agentWithCsrf(app);
    expect((await admin.post("/api/auth/login").send({ username: adminU.username, password: MAT_KHAU })).status).toBe(200);
  }, 60_000);

  afterAll(async () => {
    await prisma.auditEvent.deleteMany({ where: { actorId: adminU?.id } }).catch(() => {});
    await prisma.quote.deleteMany({ where: { title: { startsWith: TAG } }, hardDelete: true, includeDeleted: true }).catch(() => {});
    await prisma.loginAttempt.deleteMany({ where: { username: { startsWith: TAG } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true, includeDeleted: true }).catch(() => {});
    await prisma.quoteTemplate.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.company.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
  });

  it("ngày =10/3 × 1.000.000, VAT 8,125% → Quote.total và QuoteSheet.subtotal đã lưu khớp GET", async () => {
    const r = await admin.post("/api/quotes").send({
      title: `${TAG} bg`, toCompany: "K", companyId: company.id, vatPercent: 8.125,
      sheets: [{ templateId: template.id, items: [{ name: "A", quantity: 1, unitPrice: 1_000_000, days: 10 / 3 }] }],
    });
    expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(201);
    const luu = await prisma.quote.findUnique({ where: { id: r.body.id }, include: { sheets: true } });
    const doc = (await admin.get(`/api/quotes/${r.body.id}`)).body;
    expect(Number(luu.total), "tổng LƯU lệch tổng tính lại từ hàng CSDL").toBe(Number(doc.total));
    // 3,33 ngày × 1.000.000 = 3.330.000; VAT 8,13% = 270.729 → 3.600.729.
    expect(Number(luu.total)).toBe(3_600_729);
    expect(Number(luu.sheets[0].subtotal)).toBe(3_330_000);
    expect(Number(luu.vatPercent)).toBe(8.13);
  });

  it("tổng vượt trần cột → 400 nói rõ, không phải 500", async () => {
    const r = await admin.post("/api/quotes").send({
      title: `${TAG} tran`, toCompany: "K", companyId: company.id, vatPercent: 8,
      sheets: [{ templateId: template.id, items: [{ name: "A", quantity: 1e12, unitPrice: 1e12 }] }],
    });
    expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(400);
    expect(r.body.code ?? r.body.error).toBeTruthy();
  });

  it("số ngày quá lớn → 400 ở validator", async () => {
    const r = await admin.post("/api/quotes").send({
      title: `${TAG} ngay`, toCompany: "K", companyId: company.id, vatPercent: 8,
      sheets: [{ templateId: template.id, items: [{ name: "A", quantity: 1, unitPrice: 1, days: 1e9 }] }],
    });
    expect(r.status).toBe(400);
  });
});
