// CHIA SHEET THÀNH HÓA ĐƠN (chủ repo 2026-10-06: "cho chức năng chọn sheet nào là hóa đơn 1, sheet nào hóa đơn 2, và có
// thể bỏ cái nào chưa muốn xuất để xuất sau hay là không làm"; 2026-10-07: "không nó phải nằm ở chỗ duyệt cơ", "account
// chủ báo giá là người làm cái đó, chọn xuất hóa đơn chia như nào; trang hóa đơn là tách ra theo mã khi mà account chọn").
//
// Hợp đồng (src/invoiceSplit.ts, src/services/invoiceSplitService.ts):
//   · Dữ liệu cũ (invoiceGroup / invoiceHold NULL hết) = "chưa chia": mỗi sheet một hóa đơn như trước.
//   · Ai chia / làm lại: CHỦ BÁO GIÁ + admin (cùng luật nút chốt). Kế toán, account phụ, account khác → 403.
//   · Chia ngay lúc chốt: POST /mark-converted kèm `invoiceSplit` — chốt + chia trong MỘT transaction (chia sai → không chốt).
//   · PUT /api/quotes/:id/invoice-split sau khi chốt. Phải liệt kê đủ sheet tươi.
//   · Hóa đơn gom nhiều sheet: trường hóa đơn hợp nhất rồi ghi ĐỒNG LOẠT; nhập số HĐ trên một sheet = cả hóa đơn.
//   · Sheet Để sau / Không xuất không nhận trường hóa đơn (409).
//   · Hóa đơn ĐÃ XUẤT đứng yên (tập sheet + số thứ tự); khoá sửa báo giá khi đã xuất giữ nguyên.
//   · Lưu báo giá (xoá sheet rồi tạo lại) KHÔNG làm mất phép chia.
// ĐỎ trên mã cũ: route chưa có (404), /projects không trả invoiceGroup, không ghi đồng loạt.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { agentWithCsrf } from "./helpers/agent.js";
import bcrypt from "bcryptjs";
import { prisma } from "../src/db.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "Quote" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");

const TAG = `hdchia${Date.now()}`;
const PWD = "Test1234!a";

describe.runIf(dbAvailable)("chia sheet thành hóa đơn — trang Hóa đơn đầu ra", () => {
  let app, admin, keToan, chu, phu, accKhac, phuU, companyId, templateId;

  const dangNhap = async (u) => {
    const a = agentWithCsrf(app);
    const r = await a.post("/api/auth/login").send({ username: u.username, password: PWD });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return a;
  };
  const taoUser = async (ten, role) => prisma.user.create({ data: { username: `${TAG}-${ten}`, displayName: `${TAG} ${ten}`, role, passwordHash: await bcrypt.hash(PWD, 4) } });

  /** Báo giá 3 sheet (A 1.000.000, B 2.000.000, C 4.000.000), VAT 8%, CHỦ = account `chu` (manager), chưa chốt. */
  const taoBaoGia = async (title) => {
    const sh = (name, order, gia) => ({ name, order, templateId, items: [{ kind: "item", name: `HM ${name}`, quantity: 1, unitPrice: gia, order: 1 }] });
    const r = await chu.post("/api/quotes").send({
      title: `${TAG} ${title}`, companyId, toCompany: "Khách thử", vatPercent: 8,
      sheets: [sh("Sân khấu", 1, 1_000_000), sh("Âm thanh", 2, 2_000_000), sh("Ánh sáng", 3, 4_000_000)],
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body.id;
  };
  const taoBaoGiaChot = async (title) => {
    const id = await taoBaoGia(title);
    const c = await chu.post(`/api/quotes/${id}/mark-converted`).send({});
    expect(c.status, JSON.stringify(c.body)).toBe(200);
    return id;
  };
  const sheetsCua = (quoteId) => prisma.quoteSheet.findMany({ where: { quoteId }, orderBy: { order: "asc" } });
  const chia = (agent, quoteId, ds) => agent.put(`/api/quotes/${quoteId}/invoice-split`).send({ sheets: ds });
  const duAn = async (quoteId) => (await keToan.get("/api/quotes/projects")).body.data.find((q) => q.id === quoteId);

  beforeAll(async () => {
    const { createApp } = await import("../src/app.js");
    app = createApp();
    const co = await prisma.company.create({ data: { code: `${TAG}CO`, name: "Cty thử", address: "1 Thử", quotePrefix: "HC" } });
    companyId = co.id;
    templateId = (await prisma.quoteTemplate.create({ data: { companyId: co.id, name: "Mẫu thử", code: `${TAG}k`, filePath: "templates/GN_KhongNgay.xlsx" } })).id;
    admin = await dangNhap(await taoUser("admin", "admin"));
    keToan = await dangNhap(await taoUser("kt", "accountant"));
    chu = await dangNhap(await taoUser("chu", "manager"));
    phuU = await taoUser("phu", "manager");
    phu = await dangNhap(phuU);
    accKhac = await dangNhap(await taoUser("acckhac", "manager"));
  }, 120_000);

  afterAll(async () => {
    await prisma.quote.deleteMany({ where: { title: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.quoteTemplate.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.company.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.loginAttempt.deleteMany({ where: { username: { startsWith: TAG } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
  });

  it("dữ liệu cũ = chưa chia: /projects trả invoiceGroup / invoiceHold NULL cho mọi sheet", async () => {
    const id = await taoBaoGiaChot("cu");
    const q = await duAn(id);
    expect(q.sheets).toHaveLength(3);
    for (const s of q.sheets) {
      expect(s).toHaveProperty("invoiceGroup", null);
      expect(s).toHaveProperty("invoiceHold", null);
    }
  });

  it("quyền: CHỦ báo giá + admin được chia / làm lại; kế toán, account phụ (đủ 4 vùng), account khác → 403; chưa chốt → 403", async () => {
    const id = await taoBaoGiaChot("quyen");
    const [a, b, c] = await sheetsCua(id);
    expect((await chu.put(`/api/quotes/${id}/members`).send({ members: [{ userId: phuU.id, scopes: ["main", "hcm", "hanoi", "khach"] }] })).status).toBe(200);
    const ds = [{ sheetId: a.id, group: 1, hold: null }, { sheetId: b.id, group: 1, hold: null }, { sheetId: c.id, group: 2, hold: null }];
    expect((await chia(keToan, id, ds)).status, "kế toán KHÔNG còn chia (trang Hóa đơn chỉ hiển thị)").toBe(403);
    expect((await chia(phu, id, ds)).status, "account phụ được thêm vào báo giá").toBe(403);
    expect((await chia(accKhac, id, ds)).status, "account không liên quan (IDOR)").toBe(403);
    expect((await sheetsCua(id)).every((s) => s.invoiceGroup == null), "403 không được ghi gì").toBe(true);
    expect((await chia(chu, id, ds)).status).toBe(200);
    expect((await chia(admin, id, ds)).status).toBe(200);

    // Làm lại hóa đơn: cùng luật.
    expect((await keToan.put(`/api/quotes/sheets/${a.id}/invoice`).send({ invoiceNo: "Q-1" })).status, "kế toán VẪN nhập số HĐ").toBe(200);
    const lamLai = (agent) => agent.post(`/api/quotes/${id}/invoice-redo`).send({ sheetId: a.id });
    expect((await lamLai(keToan)).status).toBe(403);
    expect((await lamLai(phu)).status).toBe(403);
    expect((await lamLai(accKhac)).status).toBe(403);
    expect((await sheetsCua(id))[0].invoiceNo, "403 không gỡ gì").toBe("Q-1");
    expect((await lamLai(admin)).status).toBe(200);

    const nhap = await taoBaoGia("nhap");
    const sNhap = await sheetsCua(nhap);
    expect((await chia(chu, nhap, sNhap.map((s) => ({ sheetId: s.id, group: 1, hold: null })))).status, "chưa chốt — chọn trong hộp chốt").toBe(403);

    // IDOR: sheet của báo giá KHÁC trong danh sách → 409 (không khớp tập sheet), không ghi gì.
    expect((await chia(chu, id, [...ds.slice(0, 2), { sheetId: sNhap[0].id, group: 2, hold: null }])).status).toBe(409);
  });

  it("CHIA LÚC CHỐT: mark-converted kèm invoiceSplit → chốt + chia cùng lúc, có nhật ký; phép chia sai → KHÔNG chốt dở", async () => {
    const id = await taoBaoGia("chot");
    const [a, b, c] = await sheetsCua(id);
    // Sai: liệt kê thiếu sheet → 409, báo giá VẪN chưa chốt, không phép chia nào được ghi.
    const sai = await chu.post(`/api/quotes/${id}/mark-converted`).send({ invoiceSplit: [{ sheetId: a.id, group: 1, hold: null }, { sheetId: b.id, group: 1, hold: null }] });
    expect(sai.status).toBe(409);
    expect((await prisma.quote.findUnique({ where: { id } })).status, "chia lỗi thì không được chốt dở").not.toBe("converted");
    expect((await sheetsCua(id)).every((s) => s.invoiceGroup == null && s.invoiceHold == null)).toBe(true);
    // Sai hình dạng → 400, cũng không chốt.
    expect((await chu.post(`/api/quotes/${id}/mark-converted`).send({ invoiceSplit: [{ sheetId: a.id, group: 1, hold: "later" }, { sheetId: b.id, group: 1, hold: null }, { sheetId: c.id, group: 1, hold: null }] })).status).toBe(400);
    expect((await prisma.quote.findUnique({ where: { id } })).status).not.toBe("converted");

    const r = await chu.post(`/api/quotes/${id}/mark-converted`).send({ invoiceSplit: [{ sheetId: a.id, group: 1, hold: null }, { sheetId: b.id, group: 1, hold: null }, { sheetId: c.id, group: null, hold: "later" }] });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.status).toBe("converted");
    expect((await sheetsCua(id)).map((s) => [s.invoiceGroup, s.invoiceHold])).toEqual([[1, null], [1, null], [null, "later"]]);
    const nk = await prisma.auditEvent.findFirst({ where: { action: "quote.invoice.split", resourceId: String(id) }, orderBy: { id: "desc" } });
    expect(nk?.after).toMatchObject({ luc: "chot" });

    // Chốt KHÔNG kèm invoiceSplit (báo giá 1 sheet / không đổi gì) → y như cũ: chưa chia.
    const id2 = await taoBaoGiaChot("chot-cu");
    expect((await sheetsCua(id2)).every((s) => s.invoiceGroup == null && s.invoiceHold == null)).toBe(true);
  });

  it("gom A+B vào Hóa đơn 1, C Để sau: trường hóa đơn hợp nhất + ghi đồng loạt; C không nhận số HĐ", async () => {
    const id = await taoBaoGiaChot("gom");
    const [a, b, c] = await sheetsCua(id);
    // Kế toán đã gõ PO trên B trước khi chia — gom lại không được mất.
    expect((await keToan.put(`/api/quotes/sheets/${b.id}/invoice`).send({ poNumber: "PO-77" })).status).toBe(200);
    const r = await chia(chu, id, [{ sheetId: a.id, group: 1, hold: null }, { sheetId: b.id, group: 1, hold: null }, { sheetId: c.id, group: null, hold: "later" }]);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    let [a1, b1, c1] = await sheetsCua(id);
    expect([a1.invoiceGroup, b1.invoiceGroup, c1.invoiceHold]).toEqual([1, 1, "later"]);
    expect(a1.poNumber, "PO gõ trên B phải sang cả A (một hóa đơn một PO)").toBe("PO-77");

    // Nhập số HĐ + ngày trên A → B cũng mang (một hóa đơn = một số HĐ).
    expect((await keToan.put(`/api/quotes/sheets/${a.id}/invoice`).send({ invoiceNo: "0000123", invoiceDate: "2026-10-06" })).status).toBe(200);
    [, b1, c1] = await sheetsCua(id);
    expect(b1.invoiceNo).toBe("0000123");
    expect(b1.invoiceDate?.toISOString().slice(0, 10)).toBe("2026-10-06");
    expect(c1.invoiceNo, "sheet Để sau không bị kéo theo").toBeNull();

    // Sheet Để sau không nhận trường hóa đơn — phải xếp vào hóa đơn trước.
    expect((await keToan.put(`/api/quotes/sheets/${c.id}/invoice`).send({ invoiceNo: "999" })).status).toBe(409);
    // Số HĐ Hà Nội vẫn theo sheet — không bị chặn.
    expect((await keToan.put(`/api/quotes/sheets/${c.id}/invoice`).send({ hnInvoiceNo: "HN-1" })).status).toBe(200);

    // /projects mang phép chia cho giao diện.
    const q = await duAn(id);
    expect(q.sheets.map((s) => [s.invoiceGroup, s.invoiceHold])).toEqual([[1, null], [1, null], [null, "later"]]);
  });

  it("hóa đơn ĐÃ XUẤT đứng yên: không gom thêm, không tách, không đổi số, không bỏ chia; xếp sheet Để sau thành HĐ 2 thì được", async () => {
    const id = await taoBaoGiaChot("daxuat");
    const [a, b, c] = await sheetsCua(id);
    const g = (x, group, hold = null) => ({ sheetId: x.id, group, hold });
    expect((await chia(chu, id, [g(a, 1), g(b, 1), g(c, null, "later")])).status).toBe(200);
    expect((await keToan.put(`/api/quotes/sheets/${a.id}/invoice`).send({ invoiceNo: "0000456" })).status).toBe(200);

    expect((await chia(chu, id, [g(a, 1), g(b, 1), g(c, 1)])).status, "gom thêm C vào HĐ đã xuất").toBe(409);
    expect((await chia(chu, id, [g(a, 1), g(b, 2), g(c, null, "later")])).status, "tách B khỏi HĐ đã xuất").toBe(409);
    expect((await chia(chu, id, [g(a, 2), g(b, 2), g(c, null, "later")])).status, "đổi số HĐ đã xuất (_01 → _02)").toBe(409);
    expect((await chia(chu, id, [g(a, null), g(b, null), g(c, null)])).status, "bỏ chia = tách HĐ đã xuất thành từng sheet").toBe(409);
    expect((await sheetsCua(id)).map((s) => s.invoiceHold), "409 không ghi gì").toEqual([null, null, "later"]);

    expect((await chia(chu, id, [g(a, 1), g(b, 1), g(c, 2)])).status).toBe(200);
    expect((await sheetsCua(id)).map((s) => s.invoiceGroup)).toEqual([1, 1, 2]);
    // C nay là hóa đơn riêng → nhận số HĐ riêng, không đụng HĐ 1.
    expect((await keToan.put(`/api/quotes/sheets/${c.id}/invoice`).send({ invoiceNo: "0000789" })).status).toBe(200);
    expect((await sheetsCua(id)).map((s) => s.invoiceNo)).toEqual(["0000456", "0000456", "0000789"]);
  });

  it("dữ liệu cũ đã xuất theo từng sheet: chia được nếu giữ sheet đó một mình đúng số cũ (codeNo)", async () => {
    const id = await taoBaoGiaChot("cuxuat");
    const [a, b, c] = await sheetsCua(id);
    expect((await keToan.put(`/api/quotes/sheets/${b.id}/invoice`).send({ invoiceNo: "B-OLD" })).status).toBe(200);
    const g = (x, group, hold = null) => ({ sheetId: x.id, group, hold });
    expect((await chia(chu, id, [g(a, 1), g(b, 1), g(c, 3)])).status, "B (mã _02) bị gom vào HĐ 1").toBe(409);
    expect((await chia(chu, id, [g(a, 1), g(b, 2), g(c, 1)])).status, "B giữ số 2 một mình — A+C gom HĐ 1").toBe(200);
    expect((await sheetsCua(id)).map((s) => s.invoiceNo)).toEqual([null, "B-OLD", null]);
  });

  it("sheet khách KHÔNG duyệt trong hóa đơn: không nhận số HĐ chép sang (tiền HĐ đã xuất không nhảy); đưa nó ra Không xuất vẫn được", async () => {
    const id = await taoBaoGiaChot("tuchoi");
    const [a, b, c] = await sheetsCua(id);
    const g = (x, group, hold = null) => ({ sheetId: x.id, group, hold });
    expect((await chia(chu, id, [g(a, 1), g(b, 1), g(c, 2)])).status).toBe(200);
    const tc = await admin.post(`/api/quotes/sheets/${b.id}/customer-decision`).send({ status: "rejected" });
    expect(tc.status, JSON.stringify(tc.body)).toBe(200);
    expect((await keToan.put(`/api/quotes/sheets/${a.id}/invoice`).send({ invoiceNo: "TC-1" })).status).toBe(200);
    expect((await sheetsCua(id)).map((s) => s.invoiceNo)).toEqual(["TC-1", null, null]);
    expect((await chia(chu, id, [g(a, 1), g(b, null, "skip"), g(c, 2)])).status).toBe(200);
  });

  it("LÀM LẠI HÓA ĐƠN: gỡ số HĐ + ngày + link khỏi MỌI sheet của hóa đơn, GIỮ ngày thu; audit; hết khoá sửa; chia lại được", async () => {
    const id = await taoBaoGiaChot("lamlai");
    const [a, b, c] = await sheetsCua(id);
    const g = (x, group, hold = null) => ({ sheetId: x.id, group, hold });
    expect((await chia(chu, id, [g(a, 1), g(b, 1), g(c, 2)])).status).toBe(200);
    expect((await keToan.put(`/api/quotes/sheets/${a.id}/invoice`).send({ invoiceNo: "R-1", invoiceDate: "2026-10-01", invoiceLink: "https://hd.vn/r1", paidAt: "2026-10-05" })).status).toBe(200);
    const lamLai = (agent, sheetId) => agent.post(`/api/quotes/${id}/invoice-redo`).send({ sheetId });

    expect((await lamLai(keToan, b.id)).status, "kế toán không làm lại — báo chủ báo giá").toBe(403);
    expect((await lamLai(chu, 999999999)).status, "sheet không thuộc báo giá").toBe(409);
    expect((await sheetsCua(id))[0].invoiceNo, "bị từ chối thì không gỡ gì").toBe("R-1");

    const r = await lamLai(chu, b.id);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const sau = await sheetsCua(id);
    expect(sau.map((s) => [s.invoiceNo, s.invoiceDate, s.invoiceLink])).toEqual([[null, null, null], [null, null, null], [null, null, null]]);
    expect(sau.map((s) => s.paidAt?.toISOString().slice(0, 10) ?? null), "TIỀN ĐÃ THU giữ nguyên").toEqual(["2026-10-05", "2026-10-05", null]);
    const nk = await prisma.auditEvent.findFirst({ where: { action: "quote.invoice.redo", resourceId: String(id) }, orderBy: { id: "desc" } });
    expect(nk?.before).toMatchObject({ invoiceNo: ["R-1"], invoiceLink: ["https://hd.vn/r1"] });
    expect(nk.before.sheets.map((x) => x.sheetId)).toEqual([a.id, b.id]);
    expect((await lamLai(chu, a.id)).status, "hết số HĐ → không có gì để làm lại").toBe(409);

    // Hết số HĐ → báo giá hết khoá sửa như luật cũ.
    const q0 = (await admin.get(`/api/quotes/${id}`)).body;
    expect((await admin.put(`/api/quotes/${id}`).send({ baseUpdatedAt: q0.updatedAt, title: `${TAG} lamlai v2` })).status).toBe(200);
    const [a2, b2, c2] = await sheetsCua(id);

    // Luật tiền đã thu: gom sheet đã thu với sheet chưa thu → 409; sheet đã thu Để sau / Không xuất → 409.
    expect((await chia(chu, id, [g(a2, 1), g(b2, 1), g(c2, 1)])).status).toBe(409);
    expect((await chia(chu, id, [g(a2, 1), g(b2, null, "later"), g(c2, 2)])).status).toBe(409);
    expect((await chia(chu, id, [g(a2, 1), g(b2, null, "skip"), g(c2, 2)])).status).toBe(409);
    // Tách hai sheet đã thu thành hai hóa đơn: mỗi sheet giữ ngày thu của mình — được.
    expect((await chia(chu, id, [g(a2, 1), g(b2, 2), g(c2, 3)])).status).toBe(200);
    expect((await sheetsCua(id)).map((s) => s.paidAt?.toISOString().slice(0, 10) ?? null)).toEqual(["2026-10-05", "2026-10-05", null]);
  });

  it("CHỨNG TỪ Ô TÍCH: docSent/docReturned = true → máy chủ đóng dấu giờ, ghi đồng loạt cả mã; tích lại giữ dấu cũ; bỏ tích = null; quyền invoice:edit; có nhật ký", async () => {
    const id = await taoBaoGiaChot("chungtu");
    const [a, b, c] = await sheetsCua(id);
    const g = (x, group, hold = null) => ({ sheetId: x.id, group, hold });
    expect((await chia(chu, id, [g(a, 1), g(b, 1), g(c, null, "later")])).status).toBe(200);
    const tich = (agent, x, body) => agent.put(`/api/quotes/sheets/${x.id}/invoice`).send(body);

    expect((await tich(chu, a, { docSent: true })).status, "account không có invoice:edit / invoice:page").toBe(403);
    expect((await tich(keToan, a, { docSent: "true" })).status, "z.boolean không coerce chuỗi").toBe(400);
    const truoc = Date.now();
    const r = await tich(keToan, b, { docSent: true });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.docSentAt, "máy chủ trả dấu giờ").toBeTruthy();
    let [a1, b1, c1] = await sheetsCua(id);
    expect(b1.docSentAt.getTime()).toBeGreaterThanOrEqual(truoc - 5_000);
    expect(a1.docSentAt?.getTime(), "tích một lần cho cả mã — sheet A cùng hóa đơn mang cùng dấu").toBe(b1.docSentAt.getTime());
    expect(c1.docSentAt, "sheet Để sau không bị kéo theo").toBeNull();
    const dau = b1.docSentAt.getTime();

    await new Promise((res) => setTimeout(res, 20));
    expect((await tich(keToan, a, { docSent: true })).status).toBe(200);
    [a1] = await sheetsCua(id);
    expect(a1.docSentAt.getTime(), "tích lại GIỮ dấu cũ").toBe(dau);

    expect((await tich(keToan, a, { docReturned: true })).status).toBe(200);
    expect((await tich(keToan, a, { docSent: false })).status).toBe(200);
    [a1, b1] = await sheetsCua(id);
    expect([a1.docSentAt, b1.docSentAt], "bỏ tích = null cả mã").toEqual([null, null]);
    expect(a1.docReturnedAt).not.toBeNull();
    expect(b1.docReturnedAt?.getTime()).toBe(a1.docReturnedAt.getTime());

    expect((await tich(keToan, c, { docSent: true })).status, "sheet Để sau chưa là hóa đơn").toBe(409);
    const nk = await prisma.auditEvent.findFirst({ where: { action: "quote.invoice", resourceId: String(id) }, orderBy: { id: "desc" } });
    expect(nk?.after).toMatchObject({ docSentAt: null });
  });

  it("Không xuất: sheet skip giữ nguyên tiền/sheet, không nhận số HĐ", async () => {
    const id = await taoBaoGiaChot("skip");
    const [a, b, c] = await sheetsCua(id);
    expect((await chia(chu, id, [{ sheetId: a.id, group: 1, hold: null }, { sheetId: b.id, group: null, hold: "skip" }, { sheetId: c.id, group: 1, hold: null }])).status).toBe(200);
    expect((await keToan.put(`/api/quotes/sheets/${b.id}/invoice`).send({ invoiceDate: "2026-10-06" })).status).toBe(409);
    const q = await duAn(id);
    expect(q.sheets.map((s) => s.subtotal)).toEqual([1_000_000, 2_000_000, 4_000_000]);
    expect(q.sheets[1].invoiceHold).toBe("skip");
  });

  it("thân yêu cầu sai: sheet vừa có số HĐ vừa Để sau / thiếu xếp / liệt kê thiếu → 400 / 409", async () => {
    const id = await taoBaoGiaChot("sai");
    const [a, b, c] = await sheetsCua(id);
    expect((await chia(chu, id, [{ sheetId: a.id, group: 1, hold: "later" }, { sheetId: b.id, group: 1, hold: null }, { sheetId: c.id, group: 1, hold: null }])).status).toBe(400);
    expect((await chia(chu, id, [{ sheetId: a.id, group: null, hold: null }, { sheetId: b.id, group: 1, hold: null }, { sheetId: c.id, group: 1, hold: null }])).status).toBe(400);
    expect((await chia(chu, id, [{ sheetId: a.id, group: 1, hold: null }, { sheetId: b.id, group: 1, hold: null }])).status).toBe(409);
  });

  it("sale Lưu báo giá (xoá sheet rồi tạo lại) KHÔNG làm mất phép chia; đã xuất HĐ thì vẫn khoá sửa như cũ", async () => {
    const id = await taoBaoGiaChot("luu");
    const [a, b, c] = await sheetsCua(id);
    expect((await chia(chu, id, [{ sheetId: a.id, group: 2, hold: null }, { sheetId: b.id, group: 1, hold: null }, { sheetId: c.id, group: null, hold: "later" }])).status).toBe(200);
    const q0 = (await admin.get(`/api/quotes/${id}`)).body;
    const luu = await admin.put(`/api/quotes/${id}`).send({
      baseUpdatedAt: q0.updatedAt, title: `${TAG} luu v2`,
      sheets: q0.sheets.map((s) => ({ id: s.id, name: s.name, order: s.order, templateId, items: s.items.map((it) => ({ kind: it.kind, name: it.name, quantity: it.quantity, unitPrice: it.unitPrice, order: it.order })) })),
    });
    expect(luu.status, JSON.stringify(luu.body)).toBe(200);
    const sau = await sheetsCua(id);
    expect(sau.map((s) => [s.invoiceGroup, s.invoiceHold])).toEqual([[2, null], [1, null], [null, "later"]]);

    // Xuất HĐ 1 (sheet B) → cả báo giá khoá sửa như trước (kể cả còn sheet Để sau chưa xuất).
    expect((await keToan.put(`/api/quotes/sheets/${sau[1].id}/invoice`).send({ invoiceNo: "LOCK-1" })).status).toBe(200);
    const q1 = (await admin.get(`/api/quotes/${id}`)).body;
    const khoa = await admin.put(`/api/quotes/${id}`).send({ baseUpdatedAt: q1.updatedAt, title: `${TAG} luu v3` });
    expect(khoa.status).toBeGreaterThanOrEqual(400);
  });
});
