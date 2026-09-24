/**
 * FE-09 (phía máy chủ) — GET /api/quotes/projects PHẢI TRẢ `custStatus` CỦA TỪNG TRANG.
 *
 * Trang Hoá đơn / Quản lý dự án / "Cần xử lý" dựng một dòng cho mỗi trang của báo giá đã chốt và cộng
 * Số tiền, Chưa thu, Tổng từ `subtotal` từng trang — tức cộng cả trang khách "Không duyệt", trong khi
 * doanh thu ghi nhận (convertedTotal) đã trừ nó. Giao diện đã có bộ lọc, nhưng máy chủ không trả
 * `custStatus` nên bộ lọc không có gì để lọc. Máy chủ không tự cộng các con số đó cho ba trang này
 * (chúng tính ở client từ `sheets[].subtotal`), nên phần sửa phía máy chủ là trả đủ trường.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import { agentWithCsrf } from "./helpers/agent.js";
import { prisma } from "../src/db.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "User" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") {
  throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");
}

const TAG = `fe09${Date.now()}`;
const MAT_KHAU = "YKienKhach1234!ok";

describe.runIf(dbAvailable)("FE-09 — /quotes/projects trả custStatus", () => {
  let app, company, template, adminU, ag, quoteId;

  beforeAll(async () => {
    app = (await import("../src/app.js")).createApp();
    company = await prisma.company.create({ data: { code: `${TAG}-co`, name: "Co", address: "x", quotePrefix: "FE" } });
    template = await prisma.quoteTemplate.create({ data: { code: `${TAG}-tpl`, name: "T", companyId: company.id, filePath: "templates/Unibenfood.xlsx" } });
    adminU = await prisma.user.create({ data: { username: `${TAG}-ad`, displayName: "Ad", role: "admin", passwordHash: await bcrypt.hash(MAT_KHAU, 4) } });
    ag = agentWithCsrf(app);
    expect((await ag.post("/api/auth/login").send({ username: adminU.username, password: MAT_KHAU })).status).toBe(200);
    const r = await ag.post("/api/quotes").send({
      title: `${TAG} bg`, toCompany: "K", companyId: company.id, vatPercent: 8,
      sheets: [
        { templateId: template.id, name: "Duyệt", items: [{ name: "A", quantity: 1, unitPrice: 10_000_000 }] },
        { templateId: template.id, name: "Từ chối", items: [{ name: "B", quantity: 1, unitPrice: 5_000_000 }] },
        { templateId: template.id, name: "Chưa ý kiến", items: [{ name: "C", quantity: 1, unitPrice: 1_000_000 }] },
      ],
    });
    expect(r.status).toBe(201);
    quoteId = r.body.id;
    const doc = (await ag.get(`/api/quotes/${quoteId}`)).body;
    expect((await ag.post(`/api/quotes/sheets/${doc.sheets[0].id}/customer-decision`).send({ status: "approved" })).status).toBe(200);
    expect((await ag.post(`/api/quotes/sheets/${doc.sheets[1].id}/customer-decision`).send({ status: "rejected" })).status).toBe(200);
    expect((await ag.post(`/api/quotes/${quoteId}/mark-converted`).send({})).status).toBe(200);
  }, 60_000);

  afterAll(async () => {
    await prisma.auditEvent.deleteMany({ where: { actorId: adminU?.id } }).catch(() => {});
    await prisma.quote.deleteMany({ where: { title: { startsWith: TAG } }, hardDelete: true, includeDeleted: true }).catch(() => {});
    await prisma.loginAttempt.deleteMany({ where: { username: { startsWith: TAG } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true, includeDeleted: true }).catch(() => {});
    await prisma.quoteTemplate.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.company.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
  });

  it("mỗi trang mang custStatus đúng; cộng các trang KHÔNG bị từ chối khớp doanh thu đã chốt", async () => {
    const r = await ag.get("/api/quotes/projects");
    expect(r.status).toBe(200);
    const q = r.body.data.find((x) => x.id === quoteId);
    expect(q, "báo giá đã chốt không có trong danh sách dự án").toBeTruthy();
    expect(q.sheets.map((s) => s.custStatus), "máy chủ không trả ý kiến khách theo trang").toEqual(["approved", "rejected", null]);

    // Đối chiếu: lọc đúng như giao diện sẽ lọc thì Số tiền (trước VAT) khớp phần convertedTotal chốt.
    const net = q.sheets.filter((s) => s.custStatus !== "rejected").reduce((a, s) => a + s.subtotal, 0);
    const chot = await prisma.quote.findUnique({ where: { id: quoteId }, select: { convertedTotal: true } });
    expect(Math.round(net * 1.08)).toBe(Number(chot.convertedTotal));
  }, 60_000);

  // Soát chéo money#4: tổng Hà Nội là MỘT số của cả báo giá, dồn vào dòng trang ĐẦU. Giao diện nay
  // bỏ dòng trang bị từ chối (trangKhachTuChoi) TRƯỚC khi đọc `hanoi`. Trang đầu bị từ chối thì cột
  // "Báo Giá Hà Nội" và cờ "HN đã duyệt · thiếu số HĐ HN" mất theo, dù chi phí HN vẫn là của cả báo giá.
  it("trang ĐẦU bị từ chối → tổng HN và số HĐ HN dồn vào trang đầu còn HIỆN, không vào dòng bị ẩn", async () => {
    const r0 = await ag.post("/api/quotes").send({
      title: `${TAG} hn`, toCompany: "K", companyId: company.id, vatPercent: 8,
      sheets: [
        { templateId: template.id, name: "Từ chối", items: [{ name: "A", quantity: 1, unitPrice: 2_000_000 }] },
        { templateId: template.id, name: "Duyệt", items: [{ name: "B", quantity: 1, unitPrice: 3_000_000 }] },
      ],
    });
    expect(r0.status).toBe(201);
    const doc = (await ag.get(`/api/quotes/${r0.body.id}`)).body;
    expect((await ag.post(`/api/quotes/sheets/${doc.sheets[0].id}/customer-decision`).send({ status: "rejected" })).status).toBe(200);
    expect((await ag.post(`/api/quotes/sheets/${doc.sheets[1].id}/customer-decision`).send({ status: "approved" })).status).toBe(200);
    expect((await ag.post(`/api/quotes/${r0.body.id}/mark-converted`).send({})).status).toBe(200);
    await prisma.quote.update({
      where: { id: r0.body.id },
      data: { hnStatus: "approved", hnTables: [{ category: "hanoi", items: [{ kind: "item", name: "HN", quantity: 1, unitPrice: 5_000_000 }] }] },
    });
    const layTrang = async () => (await ag.get("/api/quotes/projects")).body.data.find((x) => x.id === r0.body.id).sheets;

    const s1 = await layTrang();
    expect(s1.map((s) => s.hanoi), "tổng HN nằm trên dòng giao diện sẽ ẩn").toEqual([0, 5_000_000]);
    expect(s1[1].hnInvoiceNo).toBeNull();

    // Kế toán từng gõ số HĐ HN vào dòng trang 1 (dữ liệu cũ) → dòng gánh tổng vẫn phải thấy nó.
    await prisma.quoteSheet.update({ where: { id: doc.sheets[0].id }, data: { hnInvoiceNo: "HN-01" } });
    expect((await layTrang())[1].hnInvoiceNo, "cờ 'thiếu số HĐ HN' bật đỏ dù đã có số").toBe("HN-01");

    // Trang bị từ chối mà ĐÃ có số HĐ thì giao diện vẫn hiện (money#1) → nó là dòng đầu, gánh như cũ.
    await prisma.quoteSheet.update({ where: { id: doc.sheets[0].id }, data: { invoiceNo: "HD-01" } });
    expect((await layTrang()).map((s) => s.hanoi)).toEqual([5_000_000, 0]);
  }, 60_000);
});
