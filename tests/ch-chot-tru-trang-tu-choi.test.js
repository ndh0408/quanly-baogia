/**
 * ============================================================================
 * CHỐT BÁO GIÁ PHẢI TRỪ PHẦN KHÁCH KHÔNG DUYỆT.
 *
 * ── LỖ ─────────────────────────────────────────────────────────────────────
 * `QuoteSheet.custStatus` ("approved" / "rejected" / null) tồn tại từ lâu để ghi ý kiến khách cho
 * TỪNG trang. Nhưng tới 2026-09-17, `grep -rn custStatus src/` chỉ ra BA chỗ: danh sách trường,
 * một chú thích, và chỗ GHI nó. KHÔNG một dòng nào ĐỌC nó.
 *
 * Nên với báo giá 12 trang mà khách đã bấm "Không duyệt" 2 trang:
 *   · bấm "Khách chốt" → chạy bình thường, không cảnh báo gì
 *   · `Quote.status` → "converted", không đảo lại được
 *   · webhook `quote.converted` gửi `total` = tổng CẢ 12 trang, gồm cả 2 trang bị từ chối
 * Tức hệ thống ghi nhận một đơn đã chốt với số tiền CAO HƠN mức khách thật sự đồng ý.
 *
 * ── CÁCH CHỮA ──────────────────────────────────────────────────────────────
 * Cột MỚI `Quote.convertedTotal` = số tiền thật sự chốt. `Quote.total` GIỮ NGUYÊN nghĩa (tổng của
 * bản báo giá như nó được soạn và xuất ra file cho khách) — đổi nghĩa cột đó là làm sai xuất
 * Excel/PDF, lịch sử phiên bản và bản xuất GDPR.
 *
 * Trang `null` (chưa có ý kiến) VẪN TÍNH: khách chưa từ chối nó. Chỉ "rejected" mới bị trừ.
 *
 * ── TÍNH Ở MÁY CHỦ, KHÔNG NHẬN TỪ CLIENT ───────────────────────────────────
 * Đây là con số tiền. Nhận nó qua thân request là mở một đường cho bất kỳ ai gọi được API tự khai
 * doanh thu của mình — bài cuối trong cụm này khoá đúng điều đó.
 * ============================================================================
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { agentWithCsrf } from "./helpers/agent.js";
import bcrypt from "bcryptjs";
import { prisma } from "../src/db.js";

const dbAvailable = await prisma
  .$queryRawUnsafe('SELECT 1 FROM "Quote" LIMIT 1')
  .then(() => true)
  .catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") {
  throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");
}

const TAG = `chtru${Date.now()}`;
const PWD = "Test1234!a";
const VAT = 8;

describe.runIf(dbAvailable)("Chốt báo giá — trừ trang khách không duyệt", () => {
  let app, admin, userId, companyId, templateId;

  /** Dựng báo giá 3 trang, mỗi trang một mức tiền khác nhau để phép trừ phân biệt được. */
  async function dungBaoGia(nhan, netTheoTrang) {
    const q = await prisma.quote.create({
      data: {
        quoteNumber: `${TAG}-${nhan}`,
        title: `${TAG} ${nhan}`,
        searchText: TAG,
        companyId,
        createdById: userId,
        toCompany: "Khách thử",
        fromContact: "x",
        fromAddress: "x",
        city: "TP. Hồ Chí Minh",
        quoteDate: new Date(),
        status: "draft",
        vatPercent: VAT,
        subtotal: netTheoTrang.reduce((a, b) => a + b, 0),
        total: Math.round(netTheoTrang.reduce((a, b) => a + b, 0) * (1 + VAT / 100)),
        sheets: {
          create: netTheoTrang.map((net, i) => ({
            name: `Trang ${i + 1}`,
            order: i + 1,
            templateId,
            subtotal: net, // net ĐÃ trừ giảm giá — đúng cột máy chủ dùng để tính lại
            items: { create: [{ order: 1, kind: "item", name: `HM ${i + 1}`, quantity: 1, unitPrice: net }] },
          })),
        },
      },
      include: { sheets: { orderBy: { order: "asc" }, select: { id: true } } },
    });
    return q;
  }

  beforeAll(async () => {
    const { createApp } = await import("../src/app.js");
    app = createApp();
    const u = await prisma.user.create({
      data: { username: `${TAG}-ad`, displayName: `${TAG} ad`, role: "admin", passwordHash: await bcrypt.hash(PWD, 4) },
    });
    userId = u.id;
    const co = await prisma.company.create({ data: { code: `${TAG}CO`, name: "Cty thử", address: "1 Thử" } });
    companyId = co.id;
    templateId = (
      await prisma.quoteTemplate.create({
        data: { companyId: co.id, name: "Mẫu thử", code: `${TAG}k`, filePath: "templates/GN_KhongNgay.xlsx" },
      })
    ).id;
    admin = agentWithCsrf(app);
    expect((await admin.post("/api/auth/login").send({ username: `${TAG}-ad`, password: PWD })).status).toBe(200);
  }, 60_000);

  afterAll(async () => {
    await prisma.quote.deleteMany({ where: { title: { startsWith: TAG } }, hardDelete: true, includeDeleted: true }).catch(() => {});
    await prisma.quoteTemplate.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.company.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true, includeDeleted: true }).catch(() => {});
  });

  it("KHÔNG trang nào bị từ chối → ghi nhận ĐÚNG BẰNG total (không đổi hành vi cũ)", async () => {
    // Vế bảo vệ dữ liệu đang chạy: 12 báo giá trên production đều có custStatus null, nên bản vá
    // này KHÔNG được làm đổi con số của chúng.
    const q = await dungBaoGia("nguyen", [1_000_000, 2_000_000, 3_000_000]);
    const r = await admin.post(`/api/quotes/${q.id}/mark-converted`).send({});
    expect(r.status, JSON.stringify(r.body).slice(0, 200)).toBe(200);
    const sau = await prisma.quote.findUnique({ where: { id: q.id }, select: { total: true, convertedTotal: true } });
    expect(Number(sau.convertedTotal)).toBe(Number(sau.total));
    expect(Number(sau.convertedTotal)).toBe(Math.round(6_000_000 * 1.08));
  }, 60_000);

  it("MỘT trang bị từ chối → trừ đúng phần đó, VAT tính LẠI trên phần còn lại", async () => {
    const q = await dungBaoGia("tuchoi1", [1_000_000, 2_000_000, 3_000_000]);
    // Khách không duyệt trang 2 (2.000.000)
    await prisma.quoteSheet.update({ where: { id: q.sheets[1].id }, data: { custStatus: "rejected" } });

    const r = await admin.post(`/api/quotes/${q.id}/mark-converted`).send({});
    expect(r.status).toBe(200);
    const sau = await prisma.quote.findUnique({ where: { id: q.id }, select: { total: true, convertedTotal: true } });

    // Giữ lại 1tr + 3tr = 4tr; VAT 8% tính trên 4tr, KHÔNG phải trên 6tr rồi mới trừ.
    expect(Number(sau.convertedTotal)).toBe(Math.round(4_000_000 * 1.08));
    expect(Number(sau.total), "total phải GIỮ NGUYÊN — nó là tổng của bản báo giá gửi khách")
      .toBe(Math.round(6_000_000 * 1.08));
  }, 60_000);

  it("trang CHƯA CÓ Ý KIẾN vẫn được tính — khách chưa từ chối nó", async () => {
    // Vế dễ làm sai nhất: lọc theo `=== "approved"` thay vì `!== "rejected"` sẽ khiến mọi báo giá
    // chưa ai đánh dấu chốt ra 0 đồng.
    const q = await dungBaoGia("chuaykien", [5_000_000, 1_000_000]);
    await prisma.quoteSheet.update({ where: { id: q.sheets[0].id }, data: { custStatus: "approved" } });
    // trang thứ hai để null

    const r = await admin.post(`/api/quotes/${q.id}/mark-converted`).send({});
    expect(r.status).toBe(200);
    const sau = await prisma.quote.findUnique({ where: { id: q.id }, select: { convertedTotal: true } });
    expect(Number(sau.convertedTotal), "trang null bị loại → mọi báo giá chưa đánh dấu sẽ ra 0 đồng")
      .toBe(Math.round(6_000_000 * 1.08));
  }, 60_000);

  it("TẤT CẢ bị từ chối → ghi nhận 0, không âm, và vẫn chốt được", async () => {
    const q = await dungBaoGia("tatca", [1_000_000, 2_000_000]);
    for (const s of q.sheets) await prisma.quoteSheet.update({ where: { id: s.id }, data: { custStatus: "rejected" } });
    const r = await admin.post(`/api/quotes/${q.id}/mark-converted`).send({});
    expect(r.status).toBe(200);
    const sau = await prisma.quote.findUnique({ where: { id: q.id }, select: { convertedTotal: true, status: true } });
    expect(Number(sau.convertedTotal)).toBe(0);
    expect(sau.status).toBe("converted");
  }, 60_000);

  it("client KHÔNG tự khai được doanh thu", async () => {
    // Đây là con số tiền. Nhận nó qua thân request là mở đường cho bất kỳ ai gọi được API tự khai
    // doanh thu của mình.
    const q = await dungBaoGia("gianlan", [1_000_000]);
    await prisma.quoteSheet.update({ where: { id: q.sheets[0].id }, data: { custStatus: "rejected" } });
    const r = await admin.post(`/api/quotes/${q.id}/mark-converted`).send({ convertedTotal: 999_000_000, total: 999_000_000 });
    expect(r.status).toBe(200);
    const sau = await prisma.quote.findUnique({ where: { id: q.id }, select: { convertedTotal: true } });
    expect(Number(sau.convertedTotal), "máy chủ nhận số tiền do client gửi").toBe(0);
  }, 60_000);
});
