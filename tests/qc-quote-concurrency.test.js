// Cụm quote-concurrency — ba chỗ LƯU BÁO GIÁ ghi đè việc của người khác, im lặng.
//
// ══ LỖI 1: khoá lạc quan kiểm NGOÀI transaction (TOCTOU) ════════════════════
// `updateQuote` (src/services/quoteService.ts) đọc `existing` rồi so `baseUpdatedAt` ở NGOÀI
// transaction, còn transaction ghi mở ra sau đó vài truy vấn. Hai người bấm Lưu cùng lúc thì CẢ HAI
// đọc cùng mốc, CẢ HAI qua cửa, và người ghi sau đè lên người ghi trước — UPDATE không hề kèm điều
// kiện `WHERE updatedAt = base`.
// TÁI HIỆN (tất định): giữ khoá hàng Quote bằng một transaction Postgres riêng, sửa `updatedAt`
// (đóng vai người kia vừa Lưu xong nhưng CHƯA commit), rồi bắn PUT với mốc CŨ. Request đọc được
// mốc cũ (bản kia chưa commit) → qua cửa → transaction của nó xếp hàng sau → commit đè.
// HẬU QUẢ: mất trắng một lần sửa báo giá, không ai được cảnh báo. Đúng thứ khoá lạc quan sinh ra
// để chặn, nhưng nó chỉ chặn được khi hai lần Lưu KHÔNG chồng nhau.
//
// ══ LỖI 2: bảng "hanoi" ĐÃ DUYỆT bị đường lưu chính ghi đè ══════════════════
// `reconcileExtraApprovals` CỐ Ý bỏ qua category "hanoi" (duyệt HN là luồng riêng ở mức báo giá:
// hnStatus). Nhưng `updateQuote` không hề đọc `existing.hnStatus`, còn `presentQuote` thì trả đủ
// bảng "hanoi" cho người không-bị-lược-view → client round-trip lại và `sanitizeExtraTables` ghi
// thẳng quantity/unitPrice từ payload.
// TÁI HIỆN: giá HN đã ở hnStatus="approved"; người làm báo giá KHÔNG có quote:hn:manage (quyền
// per-user — vai trò mặc định đều gói sẵn quyền này) Lưu báo giá với bảng "hanoi" bị sửa số.
// HẬU QUẢ: máy duyệt giá Hà Nội thành vô hiệu — giá đã duyệt đổi được qua PUT /api/quotes/:id mà
// hnStatus/hnReviewedAt không đổi, nhật ký `quote.update` chỉ ghi total+status.
//
// ══ LỖI 3: saveHn ghi lại bảng hcm/khách từ ẢNH CHỤP CŨ ═════════════════════
// `saveHn` (src/hnWorkflow.ts) đọc sheet NGOÀI transaction rồi trong transaction ghi
// `[...others, ...hanoi]`, với `others` lấy từ ảnh chụp cũ đó. Route /pay (markExtraTableRowPayment)
// có khoá hàng sheet FOR UPDATE đàng hoàng, nhưng saveHn KHÔNG lấy khoá nào — nó chỉ chờ ở lệnh
// UPDATE cuối rồi đè nguyên khối JSON cũ lên.
// TÁI HIỆN (tất định): kế toán đánh dấu ĐÃ TRẢ một hàng bảng "hcm" (giữ khoá, chưa commit), account
// Hà Nội bấm Lưu phần HN xen vào, commit sau.
// HẬU QUẢ: cờ đã-thanh-toán + ngày + người trả + ảnh chứng từ của kế toán BIẾN MẤT, dù account Hà
// Nội không hề được phép đụng bảng hcm.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { agentWithCsrf } from "./helpers/agent.js";
import bcrypt from "bcryptjs";
import pg from "pg";
import { prisma } from "../src/db.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "Quote" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");

const TAG = `qccon${Date.now()}`;
const PWD = "Test1234!a";
const nghi = (ms) => new Promise((r) => setTimeout(r, ms));
/** supertest gửi request LƯỜI (chỉ khi .then được gọi) — bài test đua phải BẮN NGAY rồi mới chờ. */
const banNgay = (t) => t.then((r) => r);

/** Mở một transaction Postgres RIÊNG (ngoài Prisma) để giữ khoá hàng — đóng vai "người kia". */
async function moKhoa() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query("BEGIN");
  return client;
}

describe.runIf(dbAvailable)("Lưu báo giá song song — không ai được ghi đè im lặng", () => {
  let app, admin, emp, adminU, empU, accU, companyId, templateId;

  const taoBaoGia = async (agent, title) => {
    const r = await agent.post("/api/quotes").send({
      title: `${TAG} ${title}`, companyId, toCompany: "Khách thử", vatPercent: 8,
      sheets: [{ name: "Trang 1", order: 1, templateId, items: [{ kind: "item", name: "Hạng mục", quantity: 1, unitPrice: 10_000, order: 1 }] }],
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return { id: r.body.id, sheetId: r.body.sheets[0].id };
  };

  // Lưu báo giá = XOÁ sheet rồi TẠO LẠI (id mới) → phải tra theo quoteId, không giữ id cũ.
  const bangCuaBaoGia = async (quoteId) =>
    (await prisma.quoteSheet.findFirst({ where: { quoteId }, orderBy: { order: "asc" }, select: { extraTables: true } })).extraTables || [];

  beforeAll(async () => {
    const { createApp } = await import("../src/app.js");
    app = createApp();
    adminU = await prisma.user.create({ data: { username: `${TAG}-admin`, displayName: `${TAG} admin`, role: "admin", passwordHash: await bcrypt.hash(PWD, 4) } });
    // Người LÀM báo giá nhưng KHÔNG có quote:hn:manage. Vai trò mặc định (admin/manager) đều gói
    // sẵn quyền đó, nên cấu hình duy nhất chạm tới được là quyền PER-USER — tính năng có thật, có
    // trang ma trận riêng (xem tests/per-user-permissions.test.js).
    empU = await prisma.user.create({ data: { username: `${TAG}-emp`, displayName: `${TAG} emp`, role: "manager", permissions: ["quote:create", "quote:read:own", "quote:update:own"], passwordHash: await bcrypt.hash(PWD, 4) } });
    accU = await prisma.user.create({ data: { username: `${TAG}-acc`, displayName: `${TAG} acc`, role: "account_hn", passwordHash: await bcrypt.hash(PWD, 4) } });
    const co = await prisma.company.create({ data: { code: `${TAG}CO`, name: "Cty thử", address: "1 Thử", quotePrefix: "QC" } });
    companyId = co.id;
    templateId = (await prisma.quoteTemplate.create({ data: { companyId: co.id, name: "Mẫu thử", code: `${TAG}k`, filePath: "templates/GN_KhongNgay.xlsx" } })).id;

    admin = agentWithCsrf(app);
    expect((await admin.post("/api/auth/login").send({ username: adminU.username, password: PWD })).status).toBe(200);
    emp = agentWithCsrf(app);
    expect((await emp.post("/api/auth/login").send({ username: empU.username, password: PWD })).status).toBe(200);
  });

  afterAll(async () => {
    await prisma.quote.deleteMany({ where: { title: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.quoteTemplate.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.company.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.loginAttempt.deleteMany({ where: { username: { startsWith: TAG } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
  });

  // ── LỖI 1 ────────────────────────────────────────────────────────────────
  it("người kia commit XEN VÀO GIỮA lúc mình đang lưu → 409, KHÔNG đè", async () => {
    const { id, sheetId } = await taoBaoGia(admin, "toctou");
    const truoc = await admin.get(`/api/quotes/${id}`);
    const moc = truoc.body.updatedAt;

    const kia = await moKhoa();
    try {
      // "Người kia" vừa lưu xong nhưng CHƯA commit: giữ khoá hàng Quote + đổi mốc updatedAt.
      await kia.query('SELECT id FROM "Quote" WHERE id = $1 FOR UPDATE', [id]);
      await kia.query('UPDATE "Quote" SET "updatedAt" = "updatedAt" + interval \'1 second\', title = $2 WHERE id = $1', [id, `${TAG} ban cua nguoi kia`]);

      const dangLuu = banNgay(admin.put(`/api/quotes/${id}`).send({
        baseUpdatedAt: moc,
        title: `${TAG} ban cua toi`,
        sheets: [{ id: sheetId, templateId, name: "Trang 1", order: 1, items: [{ kind: "item", name: "Hạng mục", quantity: 2, unitPrice: 10_000, order: 1 }] }],
      }));
      await nghi(500);   // đủ để request đọc xong `existing` (thấy mốc CŨ) rồi kẹt ở transaction ghi
      await kia.query("COMMIT");
      const r = await dangLuu;
      expect(r.status, "mốc đã đổi trước khi mình ghi → phải 409, không được ghi đè").toBe(409);
    } finally {
      await kia.query("ROLLBACK").catch(() => {});
      await kia.end().catch(() => {});
    }

    const q = await prisma.quote.findFirst({ where: { id }, select: { title: true, _count: { select: { sheets: true } } } });
    expect(q.title, "bản của người kia phải còn nguyên").toBe(`${TAG} ban cua nguoi kia`);
    // 409 ném ra GIỮA transaction (sau deleteMany) — rollback phải trả lại sheet, không để báo giá rỗng.
    expect(q._count.sheets, "409 mà mất sạch trang thì còn tệ hơn ghi đè").toBe(1);
  }, 30_000);

  it("không ai xen vào thì Lưu vẫn chạy bình thường (khoá lạc quan không chặn nhầm)", async () => {
    const { id, sheetId } = await taoBaoGia(admin, "binhthuong");
    const truoc = await admin.get(`/api/quotes/${id}`);
    const r = await admin.put(`/api/quotes/${id}`).send({
      baseUpdatedAt: truoc.body.updatedAt,
      title: `${TAG} da sua`,
      sheets: [{ id: sheetId, templateId, name: "Trang 1", order: 1, items: [{ kind: "item", name: "Hạng mục", quantity: 3, unitPrice: 10_000, order: 1 }] }],
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.title).toBe(`${TAG} da sua`);
  });

  // ── LỖI 2 ────────────────────────────────────────────────────────────────
  describe("bảng giá Hà Nội đã duyệt", () => {
    const HANG_HN = { kind: "item", rid: "hn1", name: "Thuê xe HN", quantity: 1, unitPrice: 5_000_000, approved: false, approvedAt: null, approvedBy: null, paid: false, paidAt: null, paidById: null, paidProof: null };
    const bangHN = (unitPrice) => ({ category: "hanoi", name: "Giá HN", templateId, groupSubtotal: true, items: [{ ...HANG_HN, unitPrice }] });

    /** Báo giá của SALE (emp) có sẵn bảng HN, đặt hnStatus theo yêu cầu. */
    const dungBaoGiaHN = async (hnStatus) => {
      const { id, sheetId } = await taoBaoGia(emp, `hn-${hnStatus}`);
      await prisma.quoteSheet.update({ where: { id: sheetId }, data: { extraTables: [bangHN(5_000_000)] } });
      await prisma.quote.update({ where: { id }, data: { hnStatus, hnAssigneeId: accU.id } });
      return { id, sheetId };
    };

    const luuDeGiaHN = (agent, id, sheetId, unitPrice) =>
      agent.put(`/api/quotes/${id}`).send({
        sheets: [{ id: sheetId, templateId, name: "Trang 1", order: 1, items: [{ kind: "item", name: "Hạng mục", quantity: 1, unitPrice: 10_000, order: 1 }], extraTables: [bangHN(unitPrice)] }],
      });

    it("người KHÔNG có quote:hn:manage KHÔNG sửa được giá HN đã duyệt", async () => {
      const { id, sheetId } = await dungBaoGiaHN("approved");
      const r = await luuDeGiaHN(emp, id, sheetId, 1);
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      const hn = (await bangCuaBaoGia(id)).find((t) => t.category === "hanoi");
      expect(hn.items[0].unitPrice, "giá HN đã DUYỆT không được đổi qua đường lưu báo giá thường").toBe(5_000_000);
    });

    it("người KHÔNG có quote:hn:manage KHÔNG sửa được giá HN đang CHỜ DUYỆT", async () => {
      const { id, sheetId } = await dungBaoGiaHN("submitted");
      expect((await luuDeGiaHN(emp, id, sheetId, 7)).status).toBe(200);
      const hn = (await bangCuaBaoGia(id)).find((t) => t.category === "hanoi");
      expect(hn.items[0].unitPrice).toBe(5_000_000);
    });

    it("HN mới GIAO (chưa gửi duyệt) thì vẫn sửa được — không siết quá tay", async () => {
      const { id, sheetId } = await dungBaoGiaHN("assigned");
      expect((await luuDeGiaHN(emp, id, sheetId, 9)).status).toBe(200);
      const hn = (await bangCuaBaoGia(id)).find((t) => t.category === "hanoi");
      expect(hn.items[0].unitPrice, "giai đoạn này chưa có gì để bảo vệ").toBe(9);
    });

    it("người CÓ quote:hn:manage (admin/quản lý) vẫn sửa được giá HN đã duyệt", async () => {
      const { id, sheetId } = await dungBaoGiaHN("approved");
      expect((await luuDeGiaHN(admin, id, sheetId, 3)).status).toBe(200);
      const hn = (await bangCuaBaoGia(id)).find((t) => t.category === "hanoi");
      expect(hn.items[0].unitPrice, "người duyệt phần HN thì được quyền sửa").toBe(3);
    });
  });

  // ── LỖI 3 ────────────────────────────────────────────────────────────────
  it("account HN lưu phần HN KHÔNG xoá mất thanh toán bảng HCM mà kế toán vừa ghi", async () => {
    const { id, sheetId } = await taoBaoGia(admin, "savehn");
    const hcm = { category: "hcm", name: "Chi phí HCM", templateId, groupSubtotal: true, items: [{ kind: "item", rid: "hcm1", name: "Thuê kho", quantity: 1, unitPrice: 1000, approved: true, approvedAt: null, approvedBy: null, paid: false, paidAt: null, paidById: null, paidProof: null }] };
    const hn = { category: "hanoi", name: "Giá HN", templateId, groupSubtotal: true, items: [{ kind: "item", rid: "hn1", name: "Thuê xe HN", quantity: 1, unitPrice: 2000, approved: false, approvedAt: null, approvedBy: null, paid: false, paidAt: null, paidById: null, paidProof: null }] };
    await prisma.quoteSheet.update({ where: { id: sheetId }, data: { extraTables: [hcm, hn] } });
    expect((await admin.post(`/api/quotes/${id}/hn/assign`).send({ accountId: accU.id })).status).toBe(200);

    const acc = agentWithCsrf(app);
    expect((await acc.post("/api/auth/login").send({ username: accU.username, password: PWD })).status).toBe(200);

    const keToan = await moKhoa();
    try {
      // Kế toán đang đánh dấu ĐÃ TRẢ hàng hcm1 (route /pay khoá hàng sheet y như thế) — chưa commit.
      await keToan.query('SELECT id FROM "QuoteSheet" WHERE id = $1 FOR UPDATE', [sheetId]);
      const daTra = [{ ...hcm, items: [{ ...hcm.items[0], paid: true, paidAt: "2026-08-01T00:00:00.000Z", paidById: adminU.id, paidProof: "data:image/png;base64,BBBB" }] }, hn];
      await keToan.query('UPDATE "QuoteSheet" SET "extraTables" = $2::jsonb WHERE id = $1', [sheetId, JSON.stringify(daTra)]);

      const dangLuu = banNgay(acc.put(`/api/quotes/${id}/hn`).send({
        hnSheets: [{ sheetId, hnTables: [{ ...hn, items: [{ ...hn.items[0], name: "Thuê xe HN (sửa)", unitPrice: 2500 }] }] }],
      }));
      await nghi(500);
      await keToan.query("COMMIT");
      const r = await dangLuu;
      expect(r.status, JSON.stringify(r.body)).toBe(200);
    } finally {
      await keToan.query("ROLLBACK").catch(() => {});
      await keToan.end().catch(() => {});
    }

    const bang = await bangCuaBaoGia(id);
    const hcmSau = bang.find((t) => t.category === "hcm");
    expect(hcmSau.items[0].paid, "cờ đã-trả của kế toán KHÔNG được biến mất").toBe(true);
    expect(hcmSau.items[0].paidById).toBe(adminU.id);
    expect(hcmSau.items[0].paidProof, "ảnh chứng từ phải còn").toBe("data:image/png;base64,BBBB");
    const hnSau = bang.find((t) => t.category === "hanoi");
    expect(hnSau.items[0].name, "phần account HN được sửa vẫn phải lưu").toBe("Thuê xe HN (sửa)");
    expect(hnSau.items[0].unitPrice).toBe(2500);
  }, 30_000);
});
