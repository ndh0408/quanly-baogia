// THANH TOÁN + ẢNH CHỨNG TỪ hàng bảng nội bộ KHÔNG kiểm phạm vi báo giá — chốt hồi quy (IDOR).
//
// ── LỖI ─────────────────────────────────────────────────────────────────────
// `POST /api/quotes/:id/extra/:sheetId/:rid/pay` chỉ gác NĂNG LỰC `quote:internal:pay` ở route,
// còn `markExtraTableRowPayment` (src/services/quoteService.ts) nhảy thẳng vào $transaction với
// ràng buộc duy nhất `WHERE id = :sheetId AND "quoteId" = :id` — không một lời gọi `canOnQuote`
// nào. `GET …/proof` cũng vậy: `getExtraTableRowProof` chỉ hỏi "có internal:view HOẶC internal:pay
// không?" rồi trả thẳng `it.paidProof`.
//
// Năng lực đó cấp được cho từng người qua ma trận phân quyền (PERMISSION_GROUPS, không thuộc
// ADMIN_ONLY). Tài khoản "chi phí" được cấp nó CHỈ nhìn thấy trong danh sách những báo giá mình
// là thành viên (listQuotes ép `quoteScopeWhereOrThrow`) — nhưng id báo giá là số tuần tự, nên
// chỉ cần đổi `:id` trên URL là:
//   • ĐỌC được ảnh chứng từ (ảnh chụp uỷ nhiệm chi: tên tài khoản, số tài khoản, số tiền) của
//     MỌI báo giá trong hệ thống, kể cả báo giá không liên quan gì tới họ;
//   • GHI được — tích/bỏ tích "đã thanh toán", xoá ảnh chứng từ (gửi paidProof: "") và làm
//     `Quote.updatedAt` nhảy (`tx.quote.update`), tức đá văng khoá lạc quan của người đang sửa
//     báo giá đó.
//
// ── TÁI HIỆN ────────────────────────────────────────────────────────────────
// Tạo báo giá của admin có 1 hàng bảng nội bộ đã thanh toán kèm ảnh. Đăng nhập bằng tài khoản
// chi phí KHÔNG phải thành viên báo giá đó → gọi hai endpoint trên. Trước khi vá: 200 + ảnh.
//
// ── CÁCH VÁ ─────────────────────────────────────────────────────────────────
// Thêm kiểm PHẠM VI (`canOnQuote(session, "read", quote)`) vào đầu cả hai hàm. CỐ Ý không dùng
// `loadAuthorizedQuote`: hàm đó từ chối luôn mọi caller có view bị lược (internal:view/hn:fill),
// mà đó lại chính là người dùng HỢP LỆ của hai endpoint này — dùng nó sẽ giết luôn tính năng.
//
// ── BA HÀNH VI ĐƯỢC CHỐT THÊM (không phải lỗi, là CHÍNH SÁCH) ───────────────
// 1. Có `internal:pay` mà KHÔNG có `quote:read:*` nào → 403 cả hai endpoint. Đây là cấu hình DUY
//    NHẤT bị bản vá làm chặt hơn hẳn, nên phải nói rõ 403 là ĐÚNG Ý: tài khoản như vậy vốn đã 403
//    ở `GET /api/quotes` (quoteScopeWhereOrThrow) và `GET /api/quotes/:id`, tức không có màn hình
//    nào dẫn tới hai endpoint này — không mất luồng nào.
// 2. `assertQuoteInScope` cố ý hỏi action "read" CHO CẢ đường GHI `/pay`. Lệch quy ước (mọi đường
//    ghi khác dùng `canOnQuote(update)`) nhưng CÓ CHỦ Ý: `quote:internal:pay` MỚI là cổng GHI, còn
//    "read" chỉ trả lời "được đụng tới báo giá nào". Siết lên "update" sẽ chặn đúng tài khoản chi
//    phí (chỉ có `quote:read:own`; tư cách thành viên không suy ra `quote:update:*` vì canOnQuote
//    kiểm quyền TRƯỚC khi xét thành viên). Ca "xem hết + internal:pay, KHÔNG update" khoá lại điều
//    đó — ai đổi sang "update" sẽ thấy test đỏ và biết mình đang đổi CHÍNH SÁCH, không phải sửa lỗi.
// 3. Báo giá ĐÃ XOÁ MỀM → 404. `prisma.quote.findFirst` đi qua extension soft-delete (src/db.ts) tự
//    thêm `deletedAt: null`, trong khi `QuoteSheet` không nằm trong SOFT_DELETE_MODELS. Giữ 404 là
//    NHẤT QUÁN với phần còn lại: `GET /api/quotes/:id` cũng 404 cho báo giá trong thùng rác, nên
//    trang chi tiết — lối vào duy nhất của hai endpoint này — vốn đã không mở được.
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

describe.runIf(dbAvailable)("bảng nội bộ: /pay và /proof phải kiểm phạm vi báo giá", () => {
  let app, adminU, ngoaiU, thanhVienU, khongDocU, xemHetU, companyId, templateId, quoteId, sheetId;
  let quoteXoaId, sheetXoaId;
  const PREFIX = `R${`${Date.now()}`.slice(-6)}`;   // counter RIÊNG cho lần chạy này, dọn được

  const dangNhap = async (u) => {
    const a = agentWithCsrf(app);
    expect((await a.post("/api/auth/login").send({ username: u.username, password: PWD })).status).toBe(200);
    return a;
  };

  beforeAll(async () => {
    const { createApp } = await import("../src/app.js");
    app = createApp();

    const hash = await bcrypt.hash(PWD, 4);
    adminU = await prisma.user.create({ data: { username: `${TAG}-admin`, displayName: `${TAG} admin`, role: "admin", passwordHash: hash } });
    // Tài khoản "chi phí" ĐÚNG như cấu hình thật: vai trò tối thiểu + 3 quyền cấp riêng per-user.
    const quyenChiPhi = [P.QUOTE_READ_OWN, P.QUOTE_INTERNAL_VIEW, P.QUOTE_INTERNAL_PAY];
    ngoaiU = await prisma.user.create({ data: { username: `${TAG}-ngoai`, displayName: `${TAG} ngoai`, role: "hr", passwordHash: hash, permissions: quyenChiPhi } });
    thanhVienU = await prisma.user.create({ data: { username: `${TAG}-tv`, displayName: `${TAG} tv`, role: "hr", passwordHash: hash, permissions: quyenChiPhi } });
    // Có NĂNG LỰC nội bộ nhưng KHÔNG một quyền đọc báo giá nào — cấu hình duy nhất bị siết hẳn.
    khongDocU = await prisma.user.create({ data: { username: `${TAG}-nodoc`, displayName: `${TAG} nodoc`, role: "hr", passwordHash: hash, permissions: [P.QUOTE_INTERNAL_VIEW, P.QUOTE_INTERNAL_PAY] } });
    // "Xem hết" (trợ lý giám đốc): read:all + internal:pay nhưng CỐ Ý không có quote:update:*.
    xemHetU = await prisma.user.create({ data: { username: `${TAG}-xemhet`, displayName: `${TAG} xemhet`, role: "hr", passwordHash: hash, permissions: [P.QUOTE_READ_ALL, P.QUOTE_INTERNAL_VIEW, P.QUOTE_INTERNAL_PAY] } });

    const co = await prisma.company.create({ data: { code: `${TAG}CO`, name: "Cty thử", address: "1 Thử", quotePrefix: PREFIX } });
    companyId = co.id;
    templateId = (await prisma.quoteTemplate.create({ data: { companyId: co.id, name: "Mẫu thử", code: `${TAG}k`, filePath: "templates/GN_KhongNgay.xlsx" } })).id;

    const admin = await dangNhap(adminU);
    const r = await admin.post("/api/quotes").send({
      title: `${TAG} báo giá`, companyId, toCompany: "Khách thử", vatPercent: 8,
      sheets: [{
        name: "Trang 1", order: 0, templateId,
        items: [{ kind: "item", name: "Màn LED", quantity: 1, unitPrice: 1000, order: 0 }],
        extraTables: [{ category: "hcm", name: "Chi phí HCM", items: [{ kind: "item", name: "Thuê xe", quantity: 1, unitPrice: 500, rid: RID }] }],
      }],
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    quoteId = r.body.id;
    sheetId = r.body.sheets[0].id;

    // Admin đánh dấu đã trả + nạp ảnh chứng từ (đường hợp lệ duy nhất để ảnh vào CSDL).
    const pay = await admin.post(`/api/quotes/${quoteId}/extra/${sheetId}/${RID}/pay`).send({ paid: true, paidProof: ANH });
    expect(pay.status, JSON.stringify(pay.body)).toBe(200);

    // Chỉ THÀNH VIÊN mới là người dùng hợp lệ của tính năng này.
    await prisma.quote.update({ where: { id: quoteId }, data: { members: { connect: { id: thanhVienU.id } } } });

    // Báo giá THỨ HAI, dành riêng cho ca "đã xoá mềm" — dùng chung báo giá kia thì thứ tự chạy
    // của các `it` sẽ quyết định kết quả, che mất lỗi thật.
    const r2 = await admin.post("/api/quotes").send({
      title: `${TAG} báo giá đã xoá`, companyId, toCompany: "Khách thử", vatPercent: 8,
      sheets: [{
        name: "Trang 1", order: 0, templateId,
        items: [{ kind: "item", name: "Màn LED", quantity: 1, unitPrice: 1000, order: 0 }],
        extraTables: [{ category: "hcm", name: "Chi phí HCM", items: [{ kind: "item", name: "Thuê xe", quantity: 1, unitPrice: 500, rid: RID }] }],
      }],
    });
    expect(r2.status, JSON.stringify(r2.body)).toBe(201);
    quoteXoaId = r2.body.id;
    sheetXoaId = r2.body.sheets[0].id;
    await prisma.quote.delete({ where: { id: quoteXoaId } });   // xoá MỀM (deletedAt), sheet vẫn còn
  });

  afterAll(async () => {
    await prisma.quote.deleteMany({ where: { title: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.quoteTemplate.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.company.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.quoteCounter.deleteMany({ where: { prefix: PREFIX } }).catch(() => {});
    // Dọn cả nhật ký: /pay và /proof đều ghi audit, để lại là rác mồ côi (FK actorId ON DELETE SET NULL).
    await prisma.auditEvent.deleteMany({ where: { actorId: { in: [adminU?.id, ngoaiU?.id, thanhVienU?.id, khongDocU?.id, xemHetU?.id].filter(Boolean) } } }).catch(() => {});
    await prisma.loginAttempt.deleteMany({ where: { username: { startsWith: TAG } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
  });

  it("điều kiện nền: người ngoài KHÔNG thấy báo giá này trong danh sách của mình", async () => {
    const ngoai = await dangNhap(ngoaiU);
    const ds = await ngoai.get("/api/quotes");
    expect(ds.status).toBe(200);
    expect(ds.body.data.some((q) => q.id === quoteId), "báo giá không thuộc phạm vi của họ").toBe(false);
  });

  it("người ngoài KHÔNG đọc được ảnh chứng từ qua /proof", async () => {
    const ngoai = await dangNhap(ngoaiU);
    const r = await ngoai.get(`/api/quotes/${quoteId}/extra/${sheetId}/${RID}/proof`);
    expect(r.status, "trước khi vá: 200 kèm ảnh chứng từ").toBe(403);
    expect(JSON.stringify(r.body)).not.toContain(ANH);
  });

  it("người ngoài KHÔNG tích/bỏ tích thanh toán được qua /pay", async () => {
    const ngoai = await dangNhap(ngoaiU);
    const r = await ngoai.post(`/api/quotes/${quoteId}/extra/${sheetId}/${RID}/pay`).send({ paid: false });
    expect(r.status, "trước khi vá: 200 và cờ paid bị gỡ").toBe(403);

    // Và trạng thái trong CSDL phải NGUYÊN VẸN (kể cả ảnh) — 403 mà vẫn ghi thì vô nghĩa.
    const sheet = await prisma.quoteSheet.findFirst({ where: { id: sheetId }, select: { extraTables: true } });
    const hang = sheet.extraTables.flatMap((t) => t.items).find((it) => it.rid === RID);
    expect(hang.paid).toBe(true);
    expect(hang.paidProof).toBe(ANH);
  });

  it("THÀNH VIÊN có quyền nội bộ vẫn dùng được cả hai endpoint (không chặn nhầm người thật)", async () => {
    const tv = await dangNhap(thanhVienU);
    const proof = await tv.get(`/api/quotes/${quoteId}/extra/${sheetId}/${RID}/proof`);
    expect(proof.status, JSON.stringify(proof.body)).toBe(200);
    expect(proof.body.paidProof).toBe(ANH);

    const bo = await tv.post(`/api/quotes/${quoteId}/extra/${sheetId}/${RID}/pay`).send({ paid: false });
    expect(bo.status, JSON.stringify(bo.body)).toBe(200);
    const lai = await tv.post(`/api/quotes/${quoteId}/extra/${sheetId}/${RID}/pay`).send({ paid: true, paidProof: ANH });
    expect(lai.status).toBe(200);
  });

  it("admin (quote:read:all) không bị ảnh hưởng", async () => {
    const admin = await dangNhap(adminU);
    const r = await admin.get(`/api/quotes/${quoteId}/extra/${sheetId}/${RID}/proof`);
    expect(r.status).toBe(200);
    expect(r.body.paidProof).toBe(ANH);
  });

  it("có internal:pay nhưng KHÔNG có quote:read:* nào → 403 cả hai (và vốn đã 403 ở danh sách)", async () => {
    const kd = await dangNhap(khongDocU);
    // Điều kiện nền: tài khoản này không có màn hình nào dẫn tới hai endpoint kia.
    expect((await kd.get("/api/quotes")).status, "quoteScopeWhereOrThrow đã từ chối từ trước").toBe(403);
    expect((await kd.get(`/api/quotes/${quoteId}`)).status).toBe(403);

    const proof = await kd.get(`/api/quotes/${quoteId}/extra/${sheetId}/${RID}/proof`);
    expect(proof.status, "không đọc được báo giá nào thì cũng không đọc được chứng từ của nó").toBe(403);
    expect(JSON.stringify(proof.body)).not.toContain(ANH);
    const pay = await kd.post(`/api/quotes/${quoteId}/extra/${sheetId}/${RID}/pay`).send({ paid: false });
    expect(pay.status).toBe(403);
  });

  it("CHÍNH SÁCH: quote:read:all + internal:pay mà KHÔNG có quote:update:* vẫn tích được /pay", async () => {
    // Chốt lựa chọn action "read" của assertQuoteInScope. Đổi sang "update" thì ca này đỏ —
    // đó là tín hiệu cố ý: đang ĐỔI CHÍNH SÁCH (khoá luôn tài khoản chi phí), không phải vá lỗi.
    const xh = await dangNhap(xemHetU);
    const r = await xh.post(`/api/quotes/${quoteId}/extra/${sheetId}/${RID}/pay`).send({ paid: true, paidProof: ANH });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect((await xh.get(`/api/quotes/${quoteId}/extra/${sheetId}/${RID}/proof`)).body.paidProof).toBe(ANH);
  });

  it("báo giá ĐÃ XOÁ MỀM → 404 cả hai, kể cả với admin", async () => {
    // Nhất quán với GET /api/quotes/:id (cũng 404 khi trong thùng rác): QuoteSheet không soft-delete
    // nên nếu không kiểm qua Quote thì sheet của báo giá đã xoá vẫn với tới được.
    const admin = await dangNhap(adminU);
    expect((await admin.get(`/api/quotes/${quoteXoaId}`)).status, "điều kiện nền").toBe(404);
    expect((await admin.get(`/api/quotes/${quoteXoaId}/extra/${sheetXoaId}/${RID}/proof`)).status).toBe(404);
    expect((await admin.post(`/api/quotes/${quoteXoaId}/extra/${sheetXoaId}/${RID}/pay`).send({ paid: true })).status).toBe(404);
  });

  it("ĐỌC ảnh chứng từ phải để lại dấu vết trong nhật ký", async () => {
    // /proof trả PII của bên thứ ba (ảnh uỷ nhiệm chi: tên + số tài khoản + số tiền). /pay ngay
    // trên đã ghi audit; đường ĐỌC mà không ghi thì không ai truy được ai đã xem chứng từ của ai.
    const tv = await dangNhap(thanhVienU);
    const r = await tv.get(`/api/quotes/${quoteId}/extra/${sheetId}/${RID}/proof`);
    expect(r.status).toBe(200);
    const ev = await prisma.auditEvent.findFirst({
      where: { actorId: thanhVienU.id, action: "quote.internal.proof-view", resourceId: String(quoteId) },
      orderBy: { id: "desc" },
    });
    expect(ev, "trước khi vá: không có bản ghi nhật ký nào cho lần đọc chứng từ").toBeTruthy();
    expect(ev.after?.sheetId).toBe(sheetId);
    expect(JSON.stringify(ev.after || {}), "nhật ký KHÔNG được chép lại chính ảnh").not.toContain(ANH);
  });
});
