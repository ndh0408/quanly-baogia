/**
 * MONEY-05 / RBAC-02 — NHÂN BẢN BÁO GIÁ KHÔNG ĐƯỢC BÊ DẤU DUYỆT / ĐÃ THANH TOÁN / ẢNH CHỨNG TỪ CỦA
 * BẢNG NỘI BỘ (chi phí HCM, phí khách) SANG BÁO GIÁ MỚI; VÀ KHÔNG ĐƯỢC LÀM RƠI customerId /
 * shortTitle / showTotals.
 *
 * Trước bản vá: duplicateQuote chép `extraTables: s.extraTables` NGUYÊN VĂN, trong khi ngay trên đó
 * hnTables được cắt trạng thái có chủ đích ("bản sao là báo giá MỚI chưa ai duyệt, chưa ai trả
 * tiền"). Hệ quả: bản v2 mang hàng "đã trả" kèm ảnh uỷ nhiệm chi thật của v1, chi phí HCM cộng ở
 * CẢ HAI dự án, và người không có quyền thanh toán không sửa được giá các hàng đó trên bản MỚI.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import { agentWithCsrf } from "./helpers/agent.js";
import { prisma } from "../src/db.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "User" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") {
  throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");
}

const TAG = `mnnb${Date.now()}`;
const MAT_KHAU = "NhanBan1234!ok";
const ANH = "data:image/png;base64,AAAA";

describe.runIf(dbAvailable)("MONEY-05/RBAC-02 — nhân bản cắt trạng thái server sở hữu", () => {
  let app, company, template, adminU, admin, customer;

  beforeAll(async () => {
    app = (await import("../src/app.js")).createApp();
    company = await prisma.company.create({ data: { code: `${TAG}-co`, name: `${TAG} Co`, address: "x", quotePrefix: "NB" } });
    template = await prisma.quoteTemplate.create({ data: { code: `${TAG}-tpl`, name: "T", companyId: company.id, filePath: "templates/Unibenfood.xlsx" } });
    adminU = await prisma.user.create({ data: { username: `${TAG}-admin`, displayName: "A", role: "admin", passwordHash: await bcrypt.hash(MAT_KHAU, 4) } });
    customer = await prisma.customer.create({ data: { code: `${TAG}-kh`, name: `${TAG} Khách` } });
    admin = agentWithCsrf(app);
    expect((await admin.post("/api/auth/login").send({ username: adminU.username, password: MAT_KHAU })).status).toBe(200);
  }, 60_000);

  afterAll(async () => {
    const qIds = (await prisma.quote.findMany({ where: { title: { startsWith: TAG } }, includeDeleted: true, select: { id: true } })).map((q) => q.id);
    await prisma.auditEvent.deleteMany({ where: { actorId: adminU?.id } }).catch(() => {});
    await prisma.quote.deleteMany({ where: { id: { in: qIds } }, hardDelete: true }).catch(() => {});
    await prisma.customer.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.loginAttempt.deleteMany({ where: { username: { startsWith: TAG } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.quoteTemplate.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.company.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
  });

  it("bản sao: mọi hàng bảng nội bộ CHƯA duyệt, CHƯA trả, không ảnh, rid mới; giữ customerId/shortTitle/showTotals", async () => {
    const tao = await admin.post("/api/quotes").send({
      title: `${TAG} gốc`, toCompany: "K", companyId: company.id, vatPercent: 8,
      sheets: [{ templateId: template.id, items: [{ name: "A", quantity: 1, unitPrice: 1_000_000 }] }],
    });
    expect(tao.status, JSON.stringify(tao.body).slice(0, 300)).toBe(201);
    const goc = tao.body;
    // Dựng đúng trạng thái sau khi kế toán /pay và admin duyệt một hàng HCM (ghi thẳng CSDL).
    await prisma.quoteSheet.update({
      where: { id: goc.sheets[0].id },
      data: {
        extraTables: [{
          category: "hcm", name: "Chi phí HCM", items: [{
            rid: "rid-goc", kind: "item", name: "Thi công", quantity: 1, unitPrice: 2_000_000,
            approved: true, approvedAt: "2026-09-01T00:00:00.000Z", approvedBy: adminU.id,
            paid: true, paidAt: "2026-09-02T00:00:00.000Z", paidById: adminU.id, paidProof: ANH,
          }],
        }],
      },
    });
    await prisma.quote.update({ where: { id: goc.id }, data: { customerId: customer.id, shortTitle: "Tên ngắn", showTotals: false } });

    const r = await admin.post(`/api/quotes/${goc.id}/duplicate`).send({ sameProject: true });
    expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(201);

    const moi = await prisma.quote.findUnique({ where: { id: r.body.id }, include: { sheets: true } });
    const hang = moi.sheets[0].extraTables?.[0]?.items?.[0];
    expect(hang, "bảng nội bộ phải đi theo bản sao (chỉ cắt TRẠNG THÁI, không cắt dữ liệu)").toBeTruthy();
    expect(hang.name).toBe("Thi công");
    expect(Number(hang.unitPrice)).toBe(2_000_000);
    expect(hang.paid, "cờ ĐÃ THANH TOÁN bị chép sang báo giá mới").toBe(false);
    expect(hang.paidProof ?? null, "ảnh uỷ nhiệm chi bị nhân bản").toBeNull();
    expect(hang.paidById ?? null).toBeNull();
    expect(hang.approved, "dấu DUYỆT bị chép sang báo giá mới").toBe(false);
    expect(hang.approvedBy ?? null).toBeNull();
    expect(hang.rid).not.toBe("rid-goc");

    expect(moi.customerId, "bản sao mất liên kết khách hàng").toBe(customer.id);
    expect(moi.shortTitle).toBe("Tên ngắn");
    expect(moi.showTotals, "bản gốc ẩn bảng tổng mà bản sao lại hiện").toBe(false);

    // Bản gốc giữ nguyên.
    const gocSau = await prisma.quoteSheet.findUnique({ where: { id: goc.sheets[0].id } });
    expect(gocSau.extraTables[0].items[0].paid).toBe(true);
    expect(gocSau.extraTables[0].items[0].paidProof).toBe(ANH);
  }, 60_000);
});
