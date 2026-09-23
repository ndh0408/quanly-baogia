/**
 * MONEY-01 / RBAC-05 — DOANH THU ĐÃ CHỐT (`convertedTotal`) PHẢI ĐI THEO GIÁ MỚI.
 *
 * canEdit cho sửa báo giá đã chốt tới khi có số hoá đơn — chính chú thích ở đó nói lý do là "cập nhật
 * giá thương lượng". Nhưng convertedTotal chỉ được ghi MỘT lần trong markConverted, nên sau mỗi lần
 * sửa giá hoặc khách đổi ý một trang, Dashboard/Top sales (COALESCE(convertedTotal, total)) lệch
 * khỏi Quote.total, trang Hoá đơn và tệp gửi khách — im lặng, không tự hồi phục.
 *
 * Hướng đã chọn: số chốt ĐI THEO giá mới (khớp chú thích nghiệp vụ ở canEdit). Nếu chủ dự án muốn
 * GIỮ số lúc chốt thì phải khoá sửa giá khi converted — xem báo cáo.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import { agentWithCsrf } from "./helpers/agent.js";
import { prisma } from "../src/db.js";
import { tinhConvertedTotal, computeQuoteTotals } from "../src/money.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "User" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") {
  throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");
}

const TAG = `mndt${Date.now()}`;
const MAT_KHAU = "DoanhThu1234!ok";

describe("tinhConvertedTotal — hàm thuần", () => {
  it("không trang nào bị từ chối → BẰNG total của computeQuoteTotals", () => {
    const sheets = [
      { id: 1, items: [{ kind: "item", quantity: 1, unitPrice: 10_000_001 }] },
      { id: 2, items: [{ kind: "item", quantity: 3, unitPrice: 1_666_667 }] },
    ];
    const t = computeQuoteTotals({ vatPercent: 8, sheets });
    const ct = tinhConvertedTotal(t.sheetTotals.map((s) => ({ subtotal: s.subtotal, custStatus: null })), 8);
    expect(ct.toString()).toBe(t.total.toString());
  });

  it("trang giảm trừ âm + trang dương bị từ chối → 0, không âm", () => {
    expect(tinhConvertedTotal([{ subtotal: 10_000_000, custStatus: "rejected" }, { subtotal: -3_000_000, custStatus: null }], 8).toString()).toBe("0");
  });
});

describe.runIf(dbAvailable)("MONEY-01 — convertedTotal đi theo giá mới sau khi chốt", () => {
  let app, company, template, adminU, admin;

  const taoBaoGia = async (gia1, gia2) => {
    const r = await admin.post("/api/quotes").send({
      title: `${TAG} bg`, toCompany: "K", companyId: company.id, vatPercent: 8,
      sheets: [
        { templateId: template.id, name: "T1", items: [{ name: "A", quantity: 1, unitPrice: gia1 }] },
        { templateId: template.id, name: "T2", items: [{ name: "B", quantity: 1, unitPrice: gia2 }] },
      ],
    });
    expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(201);
    return r.body;
  };
  const payloadTu = (q, gia1) => ({
    baseUpdatedAt: q.updatedAt, vatPercent: 8,
    sheets: q.sheets.map((s, i) => ({
      id: s.id, templateId: s.templateId, name: s.name,
      items: s.items.map((it) => ({ name: it.name, kind: it.kind, quantity: Number(it.quantity), unitPrice: i === 0 && gia1 != null ? gia1 : Number(it.unitPrice) })),
    })),
  });
  const ctDb = async (id) => {
    const q = await prisma.quote.findUnique({ where: { id }, select: { convertedTotal: true, total: true, updatedAt: true } });
    return { ct: q.convertedTotal == null ? null : Number(q.convertedTotal), total: Number(q.total), updatedAt: q.updatedAt };
  };

  beforeAll(async () => {
    app = (await import("../src/app.js")).createApp();
    company = await prisma.company.create({ data: { code: `${TAG}-co`, name: "Co", address: "x", quotePrefix: "DT" } });
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

  it("chốt rồi sửa giá → convertedTotal = tổng mới trừ trang bị từ chối", async () => {
    const q = await taoBaoGia(10_000_000, 5_000_000);
    expect((await admin.post(`/api/quotes/${q.id}/mark-converted`).send({})).status).toBe(200);
    expect((await ctDb(q.id)).ct).toBe(16_200_000);

    const doc = (await admin.get(`/api/quotes/${q.id}`)).body;
    const r = await admin.put(`/api/quotes/${q.id}`).send(payloadTu(doc, 20_000_000));
    expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(200);
    const sau = await ctDb(q.id);
    expect(sau.total).toBe(27_000_000);
    expect(sau.ct, "doanh thu chốt đóng băng ở giá cũ sau khi thương lượng lại").toBe(27_000_000);

    // Khách từ chối trang 2 SAU khi chốt → trừ ra; editor đang mở không bị 409 vì bấm nút này.
    const doc2 = (await admin.get(`/api/quotes/${q.id}`)).body;
    const tuChoi = await admin.post(`/api/quotes/sheets/${doc2.sheets[1].id}/customer-decision`).send({ status: "rejected" });
    expect(tuChoi.status, JSON.stringify(tuChoi.body)).toBe(200);
    const sauTuChoi = await ctDb(q.id);
    expect(sauTuChoi.ct, "khách đổi ý một trang sau khi chốt mà doanh thu chốt không đổi").toBe(21_600_000);
    expect(sauTuChoi.updatedAt.getTime(), "ghi doanh thu chốt không được làm editor đang mở ăn 409").toBe(new Date(doc2.updatedAt).getTime());

    // Sửa giá tiếp: trang 2 vẫn bị từ chối (carry custStatus) → vẫn trừ.
    const doc3 = (await admin.get(`/api/quotes/${q.id}`)).body;
    expect((await admin.put(`/api/quotes/${q.id}`).send(payloadTu(doc3, 30_000_000))).status).toBe(200);
    expect((await ctDb(q.id)).ct).toBe(32_400_000);

    // Đổi RIÊNG VAT cũng tính lại.
    const doc4 = (await admin.get(`/api/quotes/${q.id}`)).body;
    expect((await admin.put(`/api/quotes/${q.id}`).send({ baseUpdatedAt: doc4.updatedAt, vatPercent: 10 })).status).toBe(200);
    expect((await ctDb(q.id)).ct).toBe(33_000_000);
  }, 60_000);

  it("trang giảm trừ âm + trang dương bị từ chối → chốt ghi 0, không âm", async () => {
    const q = await taoBaoGia(10_000_000, -3_000_000);
    const doc = (await admin.get(`/api/quotes/${q.id}`)).body;
    expect((await admin.post(`/api/quotes/sheets/${doc.sheets[0].id}/customer-decision`).send({ status: "rejected" })).status).toBe(200);
    expect((await admin.post(`/api/quotes/${q.id}/mark-converted`).send({})).status).toBe(200);
    expect((await ctDb(q.id)).ct).toBe(0);
  }, 60_000);

  // Soát chéo money#1: canEdit khoá mọi sửa giá khi đã có số HĐ ("con số đã đi ra chứng từ kế toán"),
  // nhưng endpoint ý kiến khách vẫn nhận và TÍNH LẠI convertedTotal — doanh thu KPI đổi sau mốc khoá.
  it("đã xuất hoá đơn → đổi / gỡ ý kiến khách bị 409, không đụng custStatus lẫn doanh thu chốt", async () => {
    const q = await taoBaoGia(10_000_000, 5_000_000);
    expect((await admin.post(`/api/quotes/${q.id}/mark-converted`).send({})).status).toBe(200);
    const doc = (await admin.get(`/api/quotes/${q.id}`)).body;
    expect((await admin.put(`/api/quotes/sheets/${doc.sheets[0].id}/invoice`).send({ invoiceNo: "HD0001" })).status).toBe(200);
    const truoc = await ctDb(q.id);

    const tuChoi = await admin.post(`/api/quotes/sheets/${doc.sheets[1].id}/customer-decision`).send({ status: "rejected" });
    expect(tuChoi.status, JSON.stringify(tuChoi.body)).toBe(409);
    const go = await admin.post(`/api/quotes/sheets/${doc.sheets[0].id}/customer-decision`).send({ status: "" });
    expect(go.status, JSON.stringify(go.body)).toBe(409);

    const trang = await prisma.quoteSheet.findMany({ where: { quoteId: q.id }, orderBy: { id: "asc" }, select: { custStatus: true } });
    expect(trang.map((t) => t.custStatus)).toEqual([null, null]);
    expect((await ctDb(q.id)).ct, "doanh thu chốt đổi sau khi đã xuất hoá đơn").toBe(truoc.ct);
  }, 60_000);

  it("báo giá chốt TRƯỚC khi có cột (convertedTotal NULL) → sửa giá vẫn để NULL, nơi đọc COALESCE về total", async () => {
    const q = await taoBaoGia(1_000_000, 1_000_000);
    await prisma.quote.update({ where: { id: q.id }, data: { status: "converted", convertedAt: new Date(), convertedTotal: null } });
    const doc = (await admin.get(`/api/quotes/${q.id}`)).body;
    expect((await admin.put(`/api/quotes/${q.id}`).send(payloadTu(doc, 2_000_000))).status).toBe(200);
    expect((await ctDb(q.id)).ct).toBeNull();
  }, 60_000);
});
