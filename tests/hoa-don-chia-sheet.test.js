// CHIA SHEET THÀNH HÓA ĐƠN — trang Hóa đơn đầu ra (chủ repo 2026-10-06: "cho chức năng chọn sheet nào là hóa đơn 1,
// sheet nào hóa đơn 2, và có thể bỏ cái nào chưa muốn xuất để xuất sau hay là không làm … để qua bên hóa đơn đầu ra cho
// kế toán biết làm").
//
// Hợp đồng (src/invoiceSplit.ts, src/services/invoiceSplitService.ts):
//   · Dữ liệu cũ (invoiceGroup / invoiceHold NULL hết) = "chưa chia": mỗi sheet một hóa đơn như trước.
//   · PUT /api/quotes/:id/invoice-split: kế toán (invoice:edit) / admin; người khác 403. Phải liệt kê đủ sheet tươi.
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
  let app, admin, keToan, account, companyId, templateId;

  const dangNhap = async (u) => {
    const a = agentWithCsrf(app);
    const r = await a.post("/api/auth/login").send({ username: u.username, password: PWD });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return a;
  };
  const taoUser = async (ten, role) => prisma.user.create({ data: { username: `${TAG}-${ten}`, displayName: `${TAG} ${ten}`, role, passwordHash: await bcrypt.hash(PWD, 4) } });

  /** Báo giá 3 sheet (A 1.000.000, B 2.000.000, C 4.000.000), VAT 8%, đã chốt. */
  const taoBaoGiaChot = async (title) => {
    const sh = (name, order, gia) => ({ name, order, templateId, items: [{ kind: "item", name: `HM ${name}`, quantity: 1, unitPrice: gia, order: 1 }] });
    const r = await admin.post("/api/quotes").send({
      title: `${TAG} ${title}`, companyId, toCompany: "Khách thử", vatPercent: 8,
      sheets: [sh("Sân khấu", 1, 1_000_000), sh("Âm thanh", 2, 2_000_000), sh("Ánh sáng", 3, 4_000_000)],
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const c = await admin.post(`/api/quotes/${r.body.id}/mark-converted`).send({});
    expect(c.status, JSON.stringify(c.body)).toBe(200);
    return r.body.id;
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
    account = await dangNhap(await taoUser("acc", "manager"));
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

  it("quyền: kế toán + admin được chia; account (không có invoice:page) 403; báo giá chưa chốt 403", async () => {
    const id = await taoBaoGiaChot("quyen");
    const [a, b, c] = await sheetsCua(id);
    const ds = [{ sheetId: a.id, group: 1, hold: null }, { sheetId: b.id, group: 1, hold: null }, { sheetId: c.id, group: 2, hold: null }];
    expect((await chia(account, id, ds)).status).toBe(403);
    expect((await sheetsCua(id)).every((s) => s.invoiceGroup == null), "403 không được ghi gì").toBe(true);
    expect((await chia(keToan, id, ds)).status).toBe(200);
    expect((await chia(admin, id, ds)).status).toBe(200);

    const nhap = await admin.post("/api/quotes").send({ title: `${TAG} nhap`, companyId, toCompany: "K", vatPercent: 8, sheets: [{ name: "X", order: 1, templateId, items: [] }] });
    expect(nhap.status).toBe(201);
    expect((await chia(keToan, nhap.body.id, [{ sheetId: nhap.body.sheets[0].id, group: 1, hold: null }])).status).toBe(403);

    // IDOR: sheet của báo giá KHÁC trong danh sách → 409 (không khớp tập sheet), không ghi gì.
    expect((await chia(keToan, id, [...ds.slice(0, 2), { sheetId: nhap.body.sheets[0].id, group: 2, hold: null }])).status).toBe(409);
  });

  it("gom A+B vào Hóa đơn 1, C Để sau: trường hóa đơn hợp nhất + ghi đồng loạt; C không nhận số HĐ", async () => {
    const id = await taoBaoGiaChot("gom");
    const [a, b, c] = await sheetsCua(id);
    // Kế toán đã gõ PO trên B trước khi chia — gom lại không được mất.
    expect((await keToan.put(`/api/quotes/sheets/${b.id}/invoice`).send({ poNumber: "PO-77" })).status).toBe(200);
    const r = await chia(keToan, id, [{ sheetId: a.id, group: 1, hold: null }, { sheetId: b.id, group: 1, hold: null }, { sheetId: c.id, group: null, hold: "later" }]);
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
    expect((await chia(keToan, id, [g(a, 1), g(b, 1), g(c, null, "later")])).status).toBe(200);
    expect((await keToan.put(`/api/quotes/sheets/${a.id}/invoice`).send({ invoiceNo: "0000456" })).status).toBe(200);

    expect((await chia(keToan, id, [g(a, 1), g(b, 1), g(c, 1)])).status, "gom thêm C vào HĐ đã xuất").toBe(409);
    expect((await chia(keToan, id, [g(a, 1), g(b, 2), g(c, null, "later")])).status, "tách B khỏi HĐ đã xuất").toBe(409);
    expect((await chia(keToan, id, [g(a, 2), g(b, 2), g(c, null, "later")])).status, "đổi số HĐ đã xuất (_01 → _02)").toBe(409);
    expect((await chia(keToan, id, [g(a, null), g(b, null), g(c, null)])).status, "bỏ chia = tách HĐ đã xuất thành từng sheet").toBe(409);
    expect((await sheetsCua(id)).map((s) => s.invoiceHold), "409 không ghi gì").toEqual([null, null, "later"]);

    expect((await chia(keToan, id, [g(a, 1), g(b, 1), g(c, 2)])).status).toBe(200);
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
    expect((await chia(keToan, id, [g(a, 1), g(b, 1), g(c, 3)])).status, "B (mã _02) bị gom vào HĐ 1").toBe(409);
    expect((await chia(keToan, id, [g(a, 1), g(b, 2), g(c, 1)])).status, "B giữ số 2 một mình — A+C gom HĐ 1").toBe(200);
    expect((await sheetsCua(id)).map((s) => s.invoiceNo)).toEqual([null, "B-OLD", null]);
  });

  it("sheet khách KHÔNG duyệt trong hóa đơn: không nhận số HĐ chép sang (tiền HĐ đã xuất không nhảy); đưa nó ra Không xuất vẫn được", async () => {
    const id = await taoBaoGiaChot("tuchoi");
    const [a, b, c] = await sheetsCua(id);
    const g = (x, group, hold = null) => ({ sheetId: x.id, group, hold });
    expect((await chia(keToan, id, [g(a, 1), g(b, 1), g(c, 2)])).status).toBe(200);
    const tc = await admin.post(`/api/quotes/sheets/${b.id}/customer-decision`).send({ status: "rejected" });
    expect(tc.status, JSON.stringify(tc.body)).toBe(200);
    expect((await keToan.put(`/api/quotes/sheets/${a.id}/invoice`).send({ invoiceNo: "TC-1" })).status).toBe(200);
    expect((await sheetsCua(id)).map((s) => s.invoiceNo)).toEqual(["TC-1", null, null]);
    expect((await chia(keToan, id, [g(a, 1), g(b, null, "skip"), g(c, 2)])).status).toBe(200);
  });

  it("LÀM LẠI HÓA ĐƠN: gỡ số HĐ + ngày + link khỏi MỌI sheet của hóa đơn, GIỮ ngày thu; audit; hết khoá sửa; chia lại được", async () => {
    const id = await taoBaoGiaChot("lamlai");
    const [a, b, c] = await sheetsCua(id);
    const g = (x, group, hold = null) => ({ sheetId: x.id, group, hold });
    expect((await chia(keToan, id, [g(a, 1), g(b, 1), g(c, 2)])).status).toBe(200);
    expect((await keToan.put(`/api/quotes/sheets/${a.id}/invoice`).send({ invoiceNo: "R-1", invoiceDate: "2026-10-01", invoiceLink: "https://hd.vn/r1", paidAt: "2026-10-05" })).status).toBe(200);
    const lamLai = (agent, sheetId) => agent.post(`/api/quotes/${id}/invoice-redo`).send({ sheetId });

    expect((await lamLai(account, b.id)).status, "không có invoice:page").toBe(403);
    expect((await lamLai(keToan, 999999999)).status, "sheet không thuộc báo giá").toBe(409);
    expect((await sheetsCua(id))[0].invoiceNo, "bị từ chối thì không gỡ gì").toBe("R-1");

    const r = await lamLai(keToan, b.id);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const sau = await sheetsCua(id);
    expect(sau.map((s) => [s.invoiceNo, s.invoiceDate, s.invoiceLink])).toEqual([[null, null, null], [null, null, null], [null, null, null]]);
    expect(sau.map((s) => s.paidAt?.toISOString().slice(0, 10) ?? null), "TIỀN ĐÃ THU giữ nguyên").toEqual(["2026-10-05", "2026-10-05", null]);
    const nk = await prisma.auditEvent.findFirst({ where: { action: "quote.invoice.redo", resourceId: String(id) }, orderBy: { id: "desc" } });
    expect(nk?.before).toMatchObject({ invoiceNo: ["R-1"], invoiceLink: ["https://hd.vn/r1"] });
    expect(nk.before.sheets.map((x) => x.sheetId)).toEqual([a.id, b.id]);
    expect((await lamLai(keToan, a.id)).status, "hết số HĐ → không có gì để làm lại").toBe(409);

    // Hết số HĐ → báo giá hết khoá sửa như luật cũ.
    const q0 = (await admin.get(`/api/quotes/${id}`)).body;
    expect((await admin.put(`/api/quotes/${id}`).send({ baseUpdatedAt: q0.updatedAt, title: `${TAG} lamlai v2` })).status).toBe(200);
    const [a2, b2, c2] = await sheetsCua(id);

    // Luật tiền đã thu: gom sheet đã thu với sheet chưa thu → 409; sheet đã thu Để sau / Không xuất → 409.
    expect((await chia(keToan, id, [g(a2, 1), g(b2, 1), g(c2, 1)])).status).toBe(409);
    expect((await chia(keToan, id, [g(a2, 1), g(b2, null, "later"), g(c2, 2)])).status).toBe(409);
    expect((await chia(keToan, id, [g(a2, 1), g(b2, null, "skip"), g(c2, 2)])).status).toBe(409);
    // Tách hai sheet đã thu thành hai hóa đơn: mỗi sheet giữ ngày thu của mình — được.
    expect((await chia(keToan, id, [g(a2, 1), g(b2, 2), g(c2, 3)])).status).toBe(200);
    expect((await sheetsCua(id)).map((s) => s.paidAt?.toISOString().slice(0, 10) ?? null)).toEqual(["2026-10-05", "2026-10-05", null]);
  });

  it("Không xuất: sheet skip giữ nguyên tiền/sheet, không nhận số HĐ", async () => {
    const id = await taoBaoGiaChot("skip");
    const [a, b, c] = await sheetsCua(id);
    expect((await chia(keToan, id, [{ sheetId: a.id, group: 1, hold: null }, { sheetId: b.id, group: null, hold: "skip" }, { sheetId: c.id, group: 1, hold: null }])).status).toBe(200);
    expect((await keToan.put(`/api/quotes/sheets/${b.id}/invoice`).send({ invoiceDate: "2026-10-06" })).status).toBe(409);
    const q = await duAn(id);
    expect(q.sheets.map((s) => s.subtotal)).toEqual([1_000_000, 2_000_000, 4_000_000]);
    expect(q.sheets[1].invoiceHold).toBe("skip");
  });

  it("thân yêu cầu sai: sheet vừa có số HĐ vừa Để sau / thiếu xếp / liệt kê thiếu → 400 / 409", async () => {
    const id = await taoBaoGiaChot("sai");
    const [a, b, c] = await sheetsCua(id);
    expect((await chia(keToan, id, [{ sheetId: a.id, group: 1, hold: "later" }, { sheetId: b.id, group: 1, hold: null }, { sheetId: c.id, group: 1, hold: null }])).status).toBe(400);
    expect((await chia(keToan, id, [{ sheetId: a.id, group: null, hold: null }, { sheetId: b.id, group: 1, hold: null }, { sheetId: c.id, group: 1, hold: null }])).status).toBe(400);
    expect((await chia(keToan, id, [{ sheetId: a.id, group: 1, hold: null }, { sheetId: b.id, group: 1, hold: null }])).status).toBe(409);
  });

  it("sale Lưu báo giá (xoá sheet rồi tạo lại) KHÔNG làm mất phép chia; đã xuất HĐ thì vẫn khoá sửa như cũ", async () => {
    const id = await taoBaoGiaChot("luu");
    const [a, b, c] = await sheetsCua(id);
    expect((await chia(keToan, id, [{ sheetId: a.id, group: 2, hold: null }, { sheetId: b.id, group: 1, hold: null }, { sheetId: c.id, group: null, hold: "later" }])).status).toBe(200);
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
