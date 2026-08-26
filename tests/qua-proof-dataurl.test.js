// Ảnh chứng từ thanh toán: hai route CHỈ kiểm TIỀN TỐ của data-URL — chốt hồi quy.
//
// ── LỖI ─────────────────────────────────────────────────────────────────────
// `POST /api/quotes/:id/extra/:sheetId/:rid/pay` và `POST /api/personnel/:id/payment` nhận
// `paidProof`/`paymentProof` qua regex KHÔNG neo cuối:
//     /^data:image\/(png|jpe?g|webp);base64,/
// Chuỗi `data:image/png;base64,iVBORw0KGgo" onerror="alert(1)` khớp tiền tố ấy, nên phần đuôi
// (dấu nháy + thuộc tính HTML) đi thẳng vào CSDL. Chính repo này đã kết luận ngược lại ở hai chỗ
// khác — `customerLogo` và `itemSchema.images` (src/validators.ts) đều kiểm TOÀN CHUỖI kèm bình
// luận nói rõ kiểm tiền tố là lỗ thoát-thuộc-tính `src=""`. Đường chứng từ bị sót.
//
// ── PHẠM VI: VÌ SAO ĐÂY LÀ BẤT BIẾN, KHÔNG PHẢI XSS SỐNG ────────────────────
// Nơi hiển thị duy nhất hiện nay là React (`web/src/components/ExtraTables.tsx`,
// `web/src/pages/Personnel.tsx`) — React gán `src` như DOM property nên đuôi rác KHÔNG thoát ra
// thuộc tính. Bài test này KHÔNG khẳng định đã chặn được một vụ khai thác. Nó khoá lại BẤT BIẾN mà
// phần còn lại của mã đang dựa vào: "chuỗi *Proof trong CSDL luôn là data-URL ảnh base64 hợp lệ".
// Bất biến đó phải được ép ở CỬA VÀO, vì nơi tiêu thụ có thể đổi (xuất PDF, ghép OOXML, email).
//
// ── NHÁNH DI SẢN ────────────────────────────────────────────────────────────
// `readProofDataUrl` (src/paymentProof.ts) rơi về cột base64 cũ cho hồ sơ chưa chuyển sang kho
// object. Hàng tồn đọng ấy được ghi TRƯỚC khi có `storeProof`, tức chưa từng qua decode+sniff —
// nên phải lọc ngay tại chỗ đọc, không thể tin dữ liệu đã nằm sẵn trong bảng.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { agentWithCsrf } from "./helpers/agent.js";
import bcrypt from "bcryptjs";
import { prisma } from "../src/db.js";
import { readProofDataUrl } from "../src/paymentProof.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "Quote" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");

const TAG = `quaproof${Date.now()}`;
const PWD = "Test1234!a";
const RID = "rid-chung-tu";
// PNG thật, 1x1 trong suốt — dùng cho ca HỢP LỆ (phải tiếp tục qua được sau khi vá).
const ANH_THAT =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
// Khớp TIỀN TỐ nhưng KHÔNG phải data-URL hợp lệ: đuôi thoát khỏi thuộc tính src="".
const ANH_DOC = `${ANH_THAT}" onerror="alert(1)`;

describe.runIf(dbAvailable)("chứng từ thanh toán: data-URL phải hợp lệ TOÀN CHUỖI", () => {
  let app, adminU, admin, quoteId, sheetId, recordId;
  const PREFIX = `Q${`${Date.now()}`.slice(-6)}`;

  beforeAll(async () => {
    const { createApp } = await import("../src/app.js");
    app = createApp();

    const hash = await bcrypt.hash(PWD, 4);
    adminU = await prisma.user.create({ data: { username: `${TAG}-admin`, displayName: `${TAG} admin`, role: "admin", passwordHash: hash } });
    admin = agentWithCsrf(app);
    expect((await admin.post("/api/auth/login").send({ username: adminU.username, password: PWD })).status).toBe(200);

    const co = await prisma.company.create({ data: { code: `${TAG}CO`, name: "Cty thử", address: "1 Thử", quotePrefix: PREFIX } });
    const templateId = (await prisma.quoteTemplate.create({ data: { companyId: co.id, name: "Mẫu thử", code: `${TAG}k`, filePath: "templates/GN_KhongNgay.xlsx" } })).id;

    const r = await admin.post("/api/quotes").send({
      title: `${TAG} báo giá`, companyId: co.id, toCompany: "Khách thử", vatPercent: 8,
      sheets: [{
        name: "Trang 1", order: 0, templateId,
        items: [{ kind: "item", name: "Màn LED", quantity: 1, unitPrice: 1000, order: 0 }],
        extraTables: [{ category: "hcm", name: "Chi phí HCM", items: [{ kind: "item", name: "Thuê xe", quantity: 1, unitPrice: 500, rid: RID }] }],
      }],
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    quoteId = r.body.id;
    sheetId = r.body.sheets[0].id;

    recordId = (await prisma.personnelRecord.create({ data: { createdById: adminU.id, fullName: `${TAG} Nhân sự` } })).id;
  });

  afterAll(async () => {
    await prisma.personnelRecord.deleteMany({ where: { fullName: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.quote.deleteMany({ where: { title: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.quoteTemplate.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.company.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.quoteCounter.deleteMany({ where: { prefix: PREFIX } }).catch(() => {});
    await prisma.auditEvent.deleteMany({ where: { actorId: adminU.id } }).catch(() => {});
    await prisma.loginAttempt.deleteMany({ where: { username: { startsWith: TAG } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.$disconnect();
  });

  it("báo giá /pay: data-URL có đuôi rác → 400 và KHÔNG ghi gì vào CSDL", async () => {
    const res = await admin.post(`/api/quotes/${quoteId}/extra/${sheetId}/${RID}/pay`).send({ paid: true, paidProof: ANH_DOC });
    expect(res.status, JSON.stringify(res.body)).toBe(400);

    // Chốt luôn ở lớp CSDL: 400 mà vẫn ghi được thì bất biến vẫn vỡ.
    const sheet = await prisma.quoteSheet.findUnique({ where: { id: sheetId } });
    const hang = (sheet.extraTables?.[0]?.items || []).find((it) => it.rid === RID);
    expect(hang?.paidProof ?? null).toBeNull();
  });

  it("báo giá /pay: ảnh PNG hợp lệ vẫn qua được (không siết nhầm luồng thật)", async () => {
    const res = await admin.post(`/api/quotes/${quoteId}/extra/${sheetId}/${RID}/pay`).send({ paid: true, paidProof: ANH_THAT });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });

  it("nhân sự /payment: data-URL có đuôi rác → 400", async () => {
    const res = await admin.post(`/api/personnel/${recordId}/payment`).send({ paid: true, paymentProof: ANH_DOC });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    const rec = await prisma.personnelRecord.findUnique({ where: { id: recordId } });
    expect(rec.paymentProof ?? null).toBeNull();
    expect(rec.paymentProofKey ?? null).toBeNull();
  });

  it("nhánh di sản: cột base64 cũ không hợp lệ → readProofDataUrl trả null", async () => {
    expect(await readProofDataUrl({ paymentProof: ANH_DOC })).toBeNull();
    expect(await readProofDataUrl({ paymentProof: ANH_THAT })).toBe(ANH_THAT);
    expect(await readProofDataUrl({ paymentProof: null })).toBeNull();
  });
});
