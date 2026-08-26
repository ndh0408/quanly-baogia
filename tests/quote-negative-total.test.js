// TỔNG TIỀN ÂM — chốt hồi quy cho một sự cố MẤT DỮ LIỆU đã tái hiện được.
//
// Lưới báo giá CHO PHÉP gõ số âm: `parseVN` trong shared/quote-math.ts xử lý "-5.000" đàng hoàng và
// người dùng vẫn dùng dòng âm để ghi khoản giảm trừ. Nhưng CSDL có ràng buộc `Quote_money_check`
// (subtotal/vat/total/discount ≥ 0). Một báo giá có tổng ròng âm làm INSERT vi phạm ràng buộc,
// Prisma ném lỗi, errorHandler trả đúng một cục "Lỗi server" 500 — TOÀN BỘ lần Lưu bị mất, người
// dùng không biết vì sao và không biết sửa ở đâu.
//
// Đã tái hiện trước khi sửa: một dòng đơn giá -5.000.000 →
//   500 {"error":"Lỗi server"}
//   DriverAdapterError: new row for relation "Quote" violates check constraint "Quote_money_check"
//
// Ràng buộc CSDL là ĐÚNG (báo giá xuất cho khách không thể có tổng âm). Cái sai là để người dùng
// đâm vào nó bằng một lỗi 500 vô nghĩa. Bộ test này chốt: 400 kèm thông điệp chỉ đúng chỗ, và dòng
// âm LẺ vẫn dùng được bình thường miễn tổng còn dương.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { prisma } from "../src/db.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "Quote" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");

const TAG = `negtot${Date.now()}`;
const PWD = "Test1234!a";

describe.runIf(dbAvailable)("báo giá có tổng ÂM", () => {
  let app, admin, adminU, companyId, templateId;

  const mkQuote = (items, extra = {}) => ({
    title: `${TAG} thử`,
    companyId,
    toCompany: "Khách hàng thử",
    vatPercent: 8,
    sheets: [{ name: "Trang giảm giá", order: 0, templateId, items }],
    ...extra,
  });

  beforeAll(async () => {
    const { createApp } = await import("../src/app.js");
    app = createApp();
    adminU = await prisma.user.create({
      data: { username: `${TAG}-admin`, displayName: `${TAG} admin`, role: "admin", passwordHash: await bcrypt.hash(PWD, 4) },
    });
    admin = request.agent(app);
    expect((await admin.post("/api/auth/login").send({ username: adminU.username, password: PWD })).status).toBe(200);

    const co = await prisma.company.create({ data: { code: `${TAG}CO`, name: "Cty thử", address: "1 Thử", quotePrefix: "TT" } });
    companyId = co.id;
    const tpl = await prisma.quoteTemplate.create({
      data: { companyId: co.id, name: "Mẫu thử", code: `${TAG}k`, filePath: "templates/GN_KhongNgay.xlsx" },
    });
    templateId = tpl.id;
  });

  afterAll(async () => {
    await prisma.quote.deleteMany({ where: { title: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.quoteTemplate.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.company.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.loginAttempt.deleteMany({ where: { username: { startsWith: TAG } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
  });

  it("TẠO với tổng âm → 400 chỉ rõ chỗ sai, KHÔNG phải 500 mất trắng", async () => {
    const r = await admin.post("/api/quotes").send(
      mkQuote([{ kind: "item", name: "Hạng mục âm", unit: "cái", quantity: 1, unitPrice: -5_000_000, order: 0 }])
    );
    expect(r.status).toBe(400); // trước khi sửa: 500
    expect(r.body.code).toBe("quote_negative_total");
    expect(r.body.error).toMatch(/ÂM/);
    expect(r.body.error).toMatch(/Trang giảm giá/); // nói đúng TRANG nào đang âm
    // và không được để lại rác trong CSDL
    expect(await prisma.quote.count({ where: { title: { startsWith: TAG } } })).toBe(0);
  });

  it("dòng âm LẺ vẫn dùng được khi tổng còn dương (đây là cách ghi khoản giảm trừ)", async () => {
    const r = await admin.post("/api/quotes").send(
      mkQuote([
        { kind: "item", name: "Sân khấu", unit: "gói", quantity: 1, unitPrice: 10_000_000, order: 0 },
        { kind: "item", name: "Giảm giá khách quen", unit: "gói", quantity: 1, unitPrice: -3_000_000, order: 1 },
      ])
    );
    expect(r.status).toBe(201);
    const q = await prisma.quote.findUnique({ where: { id: r.body.id }, select: { subtotal: true, total: true } });
    expect(Number(q.subtotal)).toBe(7_000_000);
    expect(Number(q.total)).toBe(7_560_000); // 7.000.000 + 8% VAT
  });

  it("SỬA một báo giá đang tốt thành tổng âm → 400, bản cũ KHÔNG bị hỏng", async () => {
    const created = await admin.post("/api/quotes").send(
      mkQuote([{ kind: "item", name: "Sân khấu", unit: "gói", quantity: 1, unitPrice: 8_000_000, order: 0 }])
    );
    expect(created.status).toBe(201);
    const id = created.body.id;

    const bad = await admin.put(`/api/quotes/${id}`).send({
      title: `${TAG} thử`,
      sheets: [{ name: "Trang giảm giá", order: 0, templateId, items: [
        { kind: "item", name: "Âm hết", unit: "gói", quantity: 1, unitPrice: -9_000_000, order: 0 },
      ] }],
    });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe("quote_negative_total");

    // Bản đang lưu phải còn NGUYÊN — lần Lưu hỏng không được phá dữ liệu cũ.
    const after = await prisma.quote.findUnique({ where: { id }, select: { subtotal: true, total: true } });
    expect(Number(after.subtotal)).toBe(8_000_000);
    const sheets = await prisma.quoteSheet.findMany({ where: { quoteId: id }, include: { items: true } });
    expect(sheets).toHaveLength(1);
    expect(sheets[0].items).toHaveLength(1);
    expect(sheets[0].items[0].name).toBe("Sân khấu");
  });
});
