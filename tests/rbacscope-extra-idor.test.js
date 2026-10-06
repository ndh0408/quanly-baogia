// ẢNH CHỨNG TỪ + "ĐÃ CHI" hàng bảng nội bộ — ai được đụng tới, chốt hồi quy (IDOR).
//
// ── LỊCH SỬ ─────────────────────────────────────────────────────────────────
// Trước 2026-10-06 việc tích "đã thanh toán" + ảnh ủy nhiệm chi đi qua bốn route theo báo giá
// (`POST /api/quotes/:id/extra/:sheetId/:rid/pay`, `GET …/proof`, cặp song sinh `/:id/hn/:rid/…`) gác bằng NĂNG LỰC
// `quote:internal:pay`. Bài này từng chốt lỗ IDOR của chúng: tài khoản "chi phí" đổi `:id` trên URL là đọc được ảnh và
// ghi được cờ của MỌI báo giá — vá bằng kiểm phạm vi `canOnQuote(read)`.
//
// ── NAY ─────────────────────────────────────────────────────────────────────
// Chủ repo 2026-10-06: "cái thanh toán bên đó là cho kế toán, không nằm trong kia nữa". Bốn route cũ ĐÃ GỠ; việc tích
// ĐÃ CHI + ảnh nằm ở `PUT /api/quotes/input-invoices/:quoteId/:side/:rid` (+ `GET …/proof`) của trang Hóa đơn đầu vào,
// ghi vào bảng RIÊNG InputInvoiceEntry / InputInvoiceProof (src/services/inputInvoiceService.ts). Cổng: `invoice:page`
// vào + `invoice:input:pay` (Kế toán + Admin) cho tích / ảnh. Phạm vi GLOBAL theo chủ ý (kế toán phải thấy mọi khoản chi
// của công ty — và kế toán không có quote:read:*), nên lỗ IDOR cũ không còn chỗ để tái diễn: tài khoản chi phí
// (quote:internal:view/pay, kể cả khi là THÀNH VIÊN hay "xem hết") không có hai quyền đó → 403 ở mọi báo giá.
//
// Bài khoá ba điều:
//   1. Bốn route cũ trả 404 cho MỌI người, kể cả admin — bundle cũ trong service worker gọi vào không ghi được gì.
//   2. Tài khoản chi phí 403 ở route mới (ghi lẫn xem ảnh) và CSDL không đổi.
//   3. Ảnh ủy nhiệm chi là PII của bên thứ ba: đọc phải để lại nhật ký, nhật ký không chép ảnh.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { agentWithCsrf } from "./helpers/agent.js";
import bcrypt from "bcryptjs";
import { prisma } from "../src/db.js";
import { PERMISSIONS as P } from "../src/permissions.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "Quote" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");

const TAG = `rbacidor${Date.now()}`;
const PWD = "Test1234!a";
const RID = "rid-thu-1";
const ANH = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg";

describe.runIf(dbAvailable)("ảnh chứng từ / đã chi hàng nội bộ: route cũ đã gỡ, route kế toán gác đúng người", () => {
  let app, adminU, ketoanU, ngoaiU, thanhVienU, khongDocU, xemHetU, companyId, templateId, quoteId, sheetId;
  let quoteXoaId;
  const PREFIX = `R${`${Date.now()}`.slice(-6)}`;   // counter RIÊNG cho lần chạy này, dọn được

  const dangNhap = async (u) => {
    const a = agentWithCsrf(app);
    expect((await a.post("/api/auth/login").send({ username: u.username, password: PWD })).status).toBe(200);
    return a;
  };
  const khoan = (qid = quoteId) => prisma.inputInvoiceEntry.findUnique({ where: { quoteId_side_rid: { quoteId: qid, side: "sheet", rid: RID } } });

  beforeAll(async () => {
    const { createApp } = await import("../src/app.js");
    app = createApp();

    const hash = await bcrypt.hash(PWD, 4);
    adminU = await prisma.user.create({ data: { username: `${TAG}-admin`, displayName: `${TAG} admin`, role: "admin", passwordHash: hash } });
    ketoanU = await prisma.user.create({ data: { username: `${TAG}-ketoan`, displayName: `${TAG} ketoan`, role: "accountant", passwordHash: hash } });
    // Tài khoản "chi phí" ĐÚNG như cấu hình thật: vai trò tối thiểu + 3 quyền cấp riêng per-user.
    const quyenChiPhi = [P.QUOTE_READ_OWN, P.QUOTE_INTERNAL_VIEW, P.QUOTE_INTERNAL_PAY];
    ngoaiU = await prisma.user.create({ data: { username: `${TAG}-ngoai`, displayName: `${TAG} ngoai`, role: "hr", passwordHash: hash, permissions: quyenChiPhi } });
    thanhVienU = await prisma.user.create({ data: { username: `${TAG}-tv`, displayName: `${TAG} tv`, role: "hr", passwordHash: hash, permissions: quyenChiPhi } });
    // Có NĂNG LỰC nội bộ nhưng KHÔNG một quyền đọc báo giá nào.
    khongDocU = await prisma.user.create({ data: { username: `${TAG}-nodoc`, displayName: `${TAG} nodoc`, role: "hr", passwordHash: hash, permissions: [P.QUOTE_INTERNAL_VIEW, P.QUOTE_INTERNAL_PAY] } });
    // "Xem hết" (trợ lý giám đốc): read:all + internal:pay nhưng CỐ Ý không có quote:update:*.
    xemHetU = await prisma.user.create({ data: { username: `${TAG}-xemhet`, displayName: `${TAG} xemhet`, role: "hr", passwordHash: hash, permissions: [P.QUOTE_READ_ALL, P.QUOTE_INTERNAL_VIEW, P.QUOTE_INTERNAL_PAY] } });

    const co = await prisma.company.create({ data: { code: `${TAG}CO`, name: "Cty thử", address: "1 Thử", quotePrefix: PREFIX } });
    companyId = co.id;
    templateId = (await prisma.quoteTemplate.create({ data: { companyId: co.id, name: "Mẫu thử", code: `${TAG}k`, filePath: "templates/GN_KhongNgay.xlsx" } })).id;

    const admin = await dangNhap(adminU);
    const tao = (title) => admin.post("/api/quotes").send({
      title, companyId, toCompany: "Khách thử", vatPercent: 8,
      sheets: [{
        name: "Trang 1", order: 0, templateId,
        items: [{ kind: "item", name: "Màn LED", quantity: 1, unitPrice: 1000, order: 0 }],
        // Admin có quote:internal:approve → cờ duyệt trong payload được tôn trọng (hàng ĐÃ DUYỆT = khoản chi).
        extraTables: [{ category: "hcm", name: "Chi phí HCM", items: [{ kind: "item", name: "Thuê xe", quantity: 1, unitPrice: 500, rid: RID, approved: true }] }],
      }],
    });
    const r = await tao(`${TAG} báo giá`);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    quoteId = r.body.id;
    sheetId = r.body.sheets[0].id;

    // Kế toán tích ĐÃ CHI + đính ảnh — đường hợp lệ DUY NHẤT để ảnh vào CSDL.
    const kt = await dangNhap(ketoanU);
    const pay = await kt.put(`/api/quotes/input-invoices/${quoteId}/sheet/${RID}`).send({ baseVersion: 0, paid: true, paidProof: ANH });
    expect(pay.status, JSON.stringify(pay.body)).toBe(200);

    // Chỉ THÀNH VIÊN — trước đây là người dùng hợp lệ của route cũ.
    await prisma.quote.update({ where: { id: quoteId }, data: { members: { create: { userId: thanhVienU.id, scopes: ["main", "hcm", "hanoi", "khach"] } } } });

    // Báo giá THỨ HAI cho ca "đã xoá mềm": có khoản đã chi rồi mới bị xoá (dữ liệu cũ / bản app cũ) — xoá thẳng ở
    // CSDL vì đường API nay chặn xoá báo giá có khoản đã chi.
    const r2 = await tao(`${TAG} báo giá đã xoá`);
    expect(r2.status, JSON.stringify(r2.body)).toBe(201);
    quoteXoaId = r2.body.id;
    expect((await kt.put(`/api/quotes/input-invoices/${quoteXoaId}/sheet/${RID}`).send({ baseVersion: 0, paid: true, paidProof: ANH })).status).toBe(200);
    await prisma.quote.delete({ where: { id: quoteXoaId } });   // xoá MỀM (deletedAt), sheet + khoản vẫn còn
  });

  afterAll(async () => {
    const ids = [quoteId, quoteXoaId].filter(Boolean);
    // Khoản kế toán RESTRICT báo giá: dọn ảnh → khoản trước khi xoá cứng báo giá.
    await prisma.inputInvoiceProof.deleteMany({ where: { entry: { quoteId: { in: ids } } } }).catch(() => {});
    await prisma.inputInvoiceEntry.deleteMany({ where: { quoteId: { in: ids } } }).catch(() => {});
    await prisma.quote.deleteMany({ where: { title: { startsWith: TAG } }, hardDelete: true, includeDeleted: true }).catch(() => {});
    await prisma.quoteTemplate.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.company.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.quoteCounter.deleteMany({ where: { prefix: PREFIX } }).catch(() => {});
    await prisma.auditEvent.deleteMany({ where: { actorId: { in: [adminU?.id, ketoanU?.id, ngoaiU?.id, thanhVienU?.id, khongDocU?.id, xemHetU?.id].filter(Boolean) } } }).catch(() => {});
    await prisma.loginAttempt.deleteMany({ where: { username: { startsWith: TAG } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
  });

  it("điều kiện nền: người ngoài KHÔNG thấy báo giá này trong danh sách của mình", async () => {
    const ngoai = await dangNhap(ngoaiU);
    const ds = await ngoai.get("/api/quotes");
    expect(ds.status).toBe(200);
    expect(ds.body.data.some((q) => q.id === quoteId), "báo giá không thuộc phạm vi của họ").toBe(false);
  });

  it("BỐN ROUTE CŨ → 404 với MỌI người, kể cả admin — và không ghi được gì", async () => {
    for (const u of [adminU, thanhVienU, xemHetU, ngoaiU, ketoanU]) {
      const a = await dangNhap(u);
      expect((await a.get(`/api/quotes/${quoteId}/extra/${sheetId}/${RID}/proof`)).status, u.username).toBe(404);
      expect((await a.post(`/api/quotes/${quoteId}/extra/${sheetId}/${RID}/pay`).send({ paid: false })).status, u.username).toBe(404);
      expect((await a.post(`/api/quotes/${quoteId}/hn/${RID}/pay`).send({ paid: false })).status, u.username).toBe(404);
      expect((await a.get(`/api/quotes/${quoteId}/hn/${RID}/proof`)).status, u.username).toBe(404);
    }
    const e = await khoan();
    expect(e.paid, "khoản phải NGUYÊN VẸN").toBe(true);
    expect(e.currentProofId).not.toBeNull();
  });

  it("tài khoản CHI PHÍ (thành viên, người ngoài, 'xem hết') → 403 ở route kế toán, cả ghi lẫn xem ảnh; CSDL không đổi", async () => {
    const truoc = await khoan();
    for (const u of [thanhVienU, ngoaiU, xemHetU, khongDocU]) {
      const a = await dangNhap(u);
      const ghi = await a.put(`/api/quotes/input-invoices/${quoteId}/sheet/${RID}`).send({ baseVersion: truoc.version, paid: false });
      expect(ghi.status, `${u.username}: ${JSON.stringify(ghi.body)}`).toBe(403);
      const xem = await a.get(`/api/quotes/input-invoices/${quoteId}/sheet/${RID}/proof`);
      expect(xem.status, u.username).toBe(403);
      expect(JSON.stringify(xem.body)).not.toContain(ANH);
    }
    const sau = await khoan();
    expect(sau.version).toBe(truoc.version);
    expect(sau.paid).toBe(true);
  });

  it("KẾ TOÁN (không là thành viên, không có quote:read) xem được ảnh — phạm vi global theo chủ ý; GET báo giá vẫn 403", async () => {
    const kt = await dangNhap(ketoanU);
    const r = await kt.get(`/api/quotes/input-invoices/${quoteId}/sheet/${RID}/proof`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.paidProof).toBe(ANH);
    expect((await kt.get(`/api/quotes/${quoteId}`)).status, "kế toán vẫn KHÔNG thấy báo giá").toBe(403);
  });

  it("chốt chặn: có internal:pay mà KHÔNG có quote:read:* → 403 ở danh sách và chi tiết báo giá", async () => {
    const kd = await dangNhap(khongDocU);
    expect((await kd.get("/api/quotes")).status).toBe(403);
    expect((await kd.get(`/api/quotes/${quoteId}`)).status).toBe(403);
  });

  it("báo giá ĐÃ XOÁ MỀM: khoản chỉ đọc — ghi 409 'bao-gia-da-xoa', ảnh vẫn xem được (bằng chứng tiền đã chi)", async () => {
    const kt = await dangNhap(ketoanU);
    const e = await khoan(quoteXoaId);
    const ghi = await kt.put(`/api/quotes/input-invoices/${quoteXoaId}/sheet/${RID}`).send({ baseVersion: e.version, accountingNote: "x" });
    expect(ghi.status, JSON.stringify(ghi.body)).toBe(409);
    expect(ghi.body.code).toBe("bao-gia-da-xoa");
    const xem = await kt.get(`/api/quotes/input-invoices/${quoteXoaId}/sheet/${RID}/proof`);
    expect(xem.status).toBe(200);
    expect(xem.body.paidProof).toBe(ANH);
  });

  it("ĐỌC ảnh chứng từ phải để lại dấu vết trong nhật ký — chỉ định danh, không chép ảnh", async () => {
    const kt = await dangNhap(ketoanU);
    expect((await kt.get(`/api/quotes/input-invoices/${quoteId}/sheet/${RID}/proof`)).status).toBe(200);
    const ev = await prisma.auditEvent.findFirst({
      where: { actorId: ketoanU.id, action: "quote.internal.proof-view", resourceId: String(quoteId) },
      orderBy: { id: "desc" },
    });
    expect(ev, "không có bản ghi nhật ký cho lần đọc chứng từ").toBeTruthy();
    expect(ev.after).toMatchObject({ side: "sheet", rid: RID, nguon: "bang" });
    expect(JSON.stringify(ev.after || {}), "nhật ký KHÔNG được chép lại chính ảnh").not.toContain(ANH);
  });
});
