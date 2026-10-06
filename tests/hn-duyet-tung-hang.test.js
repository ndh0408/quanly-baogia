/**
 * DUYỆT TỪNG HÀNG BẢNG HÀ NỘI (chủ repo 2026-10-06): "Thêm cột Duyệt từng hàng … gửi duyệt từng hàng hay trả lại gì cũng
 * vậy, cái nào đã duyệt thì không cho sửa nhé, có sửa từng hàng và qua đầu vào nữa chứ".
 *
 * Chốt trên CSDL thật:
 *   · Account HN gửi duyệt TỪNG HÀNG (chọn rid) hoặc hàng loạt; một lần gửi = MỘT thông báo cho chủ báo giá.
 *   · Duyệt / trả / bỏ duyệt GIỮ QUYỀN CŨ của duyệt cả phần: quote:hn:manage (admin, manager/Account — chủ báo giá);
 *     chỉ có quote:internal:approve thì 403; Account HN được giao không tự duyệt (kể cả khi được cấp quote:hn:manage).
 *   · Hàng đã duyệt KHOÁ ở MÁY CHỦ với mọi đường Lưu (PUT /:id/hn, PUT /:id — kể cả admin): sửa / xoá → 409
 *     'hang-hn-da-khoa'; hàng đã gửi khoá với Account HN; bỏ duyệt thì mở lại.
 *   · Hóa đơn đầu vào: hàng HN đã duyệt hiện NGAY (không chờ cả phần), kế toán tích đã chi được; bỏ duyệt hàng đã chi →
 *     nhóm "Cần chú ý", khoản giữ nguyên.
 *   · DỮ LIỆU CŨ: báo giá đã duyệt CẢ PHẦN (hnStatus=approved, hàng chưa có trạng thái riêng, đã có khoản ĐÃ CHI) — mọi
 *     hàng vẫn là đã duyệt, không biến khỏi Hóa đơn đầu vào, khoản giữ nguyên; Lưu / giao lại không mở khoá; bỏ duyệt
 *     tường minh một hàng thì cờ riêng thắng trạng thái cả phần.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import { agentWithCsrf } from "./helpers/agent.js";
import { prisma } from "../src/db.js";
import { PERMISSIONS as P } from "../src/permissions.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "Quote" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");

const TAG = `hndth${Date.now()}`;
const PWD = "Test1234!a";
const PREFIX = `D${`${Date.now()}`.slice(-6)}`;

describe.runIf(dbAvailable)("Bảng Hà Nội — gửi / duyệt / trả / bỏ duyệt TỪNG HÀNG", () => {
  let app, soanU, adminU, admin2U, hnU, ketoanU, chiDuyetNoiBoU, companyId, templateId, quoteId;
  const dangNhap = async (u) => {
    const a = agentWithCsrf(app);
    expect((await a.post("/api/auth/login").send({ username: u.username, password: PWD })).status).toBe(200);
    return a;
  };
  const taoUser = (ten, role, permissions) => bcrypt.hash(PWD, 4).then((passwordHash) => prisma.user.create({
    data: { username: `${TAG}-${ten}`, displayName: `${TAG} ${ten}`, role, passwordHash, ...(permissions ? { permissions } : {}) },
  }));
  const hnDb = async (id = quoteId) => (await prisma.quote.findUnique({ where: { id }, select: { hnTables: true } })).hnTables;
  const hangDb = async (ten, id = quoteId) => (await hnDb(id)).flatMap((t) => t.items).find((it) => it.name === ten);
  const nhuClient = (q) => ({ ...q, sheets: (q.sheets || []).map((s) => ({ ...s, extraTables: Array.isArray(s.extraTables) ? s.extraTables : [] })) });
  const soThongBao = (userId) => prisma.notification.count({ where: { userId } });
  /** Dòng HN của báo giá này trên trang Hóa đơn đầu vào. */
  const dongDauVao = async (ag, id = quoteId) => (await ag.get("/api/quotes/input-invoices")).body.data.filter((r) => r.quoteId === id && r.side === "hn");
  /** Account HN lưu bảng HN với `sua(items)` áp lên bản đang có. */
  const hnLuu = async (sua) => {
    const hn = await dangNhap(hnU);
    const q = (await hn.get(`/api/quotes/${quoteId}`)).body;
    const tables = JSON.parse(JSON.stringify(q.hnTables));
    sua(tables[0].items, tables);
    return hn.put(`/api/quotes/${quoteId}/hn`).send({ baseHnRev: q.hnRev, hnTables: tables });
  };
  /** Đường Lưu báo giá (chủ / admin) với `sua(items)` áp lên bảng HN. */
  const luuBaoGia = async (ag, sua) => {
    const q = nhuClient((await ag.get(`/api/quotes/${quoteId}`)).body);
    const hnTables = JSON.parse(JSON.stringify(q.hnTables));
    sua(hnTables[0].items, hnTables);
    return ag.put(`/api/quotes/${quoteId}`).send({ ...q, hnTables, baseUpdatedAt: q.updatedAt });
  };
  const rid = async (ten) => (await hangDb(ten)).rid;

  beforeAll(async () => {
    app = (await import("../src/app.js")).createApp();
    soanU = await taoUser("soan", "manager");                     // chủ báo giá: quote:hn:manage (vai trò mặc định) — người duyệt HN
    adminU = await taoUser("admin", "admin");                     // người duyệt (quote:internal:approve)
    admin2U = await taoUser("admin2", "admin");
    hnU = await taoUser("hn", "account_hn", undefined);
    ketoanU = await taoUser("ketoan", "accountant");
    chiDuyetNoiBoU = await taoUser("duyetnb", "manager", [P.QUOTE_READ_ALL, P.QUOTE_UPDATE_ALL, P.QUOTE_INTERNAL_APPROVE]);   // không có hn:manage
    companyId = (await prisma.company.create({ data: { code: `${TAG}CO`, name: "Cty thử", address: "1 Thử", quotePrefix: PREFIX } })).id;
    templateId = (await prisma.quoteTemplate.create({ data: { companyId, name: "Mẫu thử", code: `${TAG}k`, filePath: "templates/GN_KhongNgay.xlsx" } })).id;
    const soan = await dangNhap(soanU);
    const r = await soan.post("/api/quotes").send({
      title: `${TAG} bg`, toCompany: "Khách", companyId, vatPercent: 8,
      sheets: [{ name: "Trang 1", order: 0, templateId, items: [{ kind: "item", name: "Màn LED", quantity: 1, unitPrice: 1000, order: 0 }] }],
    });
    expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(201);
    quoteId = r.body.id;
    expect((await soan.post(`/api/quotes/${quoteId}/hn/assign`).send({ accountId: hnU.id })).status).toBe(200);
  }, 60_000);

  afterAll(async () => {
    const ids = [soanU, adminU, admin2U, hnU, ketoanU, chiDuyetNoiBoU].filter(Boolean).map((u) => u.id);
    const qIds = (await prisma.quote.findMany({ where: { title: { startsWith: TAG } }, includeDeleted: true, select: { id: true } })).map((q) => q.id);
    await prisma.inputInvoiceEntry.deleteMany({ where: { quoteId: { in: qIds } } }).catch(() => {});
    await prisma.auditEvent.deleteMany({ where: { actorId: { in: ids } } }).catch(() => {});
    await prisma.notification.deleteMany({ where: { userId: { in: ids } } }).catch(() => {});
    await prisma.quote.deleteMany({ where: { id: { in: qIds } }, hardDelete: true, includeDeleted: true }).catch(() => {});
    await prisma.quoteTemplate.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.company.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.quoteCounter.deleteMany({ where: { prefix: PREFIX } }).catch(() => {});
    await prisma.loginAttempt.deleteMany({ where: { username: { startsWith: TAG } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true, includeDeleted: true }).catch(() => {});
  });

  it("Account HN điền 3 hàng rồi GỬI DUYỆT đúng 2 hàng đã chọn — MỘT thông báo cho chủ, hàng còn lại vẫn đang làm", async () => {
    const hn = await dangNhap(hnU);
    const q = (await hn.get(`/api/quotes/${quoteId}`)).body;
    const luu = await hn.put(`/api/quotes/${quoteId}/hn`).send({ baseHnRev: q.hnRev, hnTables: [{ name: "Giá HN", templateId, items: [
      { kind: "section", name: "NHÓM" },
      { kind: "item", name: "A", quantity: 1, unitPrice: 1000 },
      { kind: "item", name: "B", quantity: 2, unitPrice: 500 },
      { kind: "item", name: "C", quantity: 1, unitPrice: 300 },
    ] }] });
    expect(luu.status, JSON.stringify(luu.body).slice(0, 300)).toBe(200);
    expect((await hangDb("A")).trangThaiDuyet).toBe("dang-lam");

    const truoc = await soThongBao(soanU.id);
    const r = await hn.post(`/api/quotes/${quoteId}/hn/submit`).send({ rids: [await rid("A"), await rid("B")] });
    expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(200);
    expect(await soThongBao(soanU.id), "gửi 2 hàng = 1 thông báo, không spam").toBe(truoc + 1);
    expect((await hangDb("A")).trangThaiDuyet).toBe("cho-duyet");
    expect((await hangDb("B")).trangThaiDuyet).toBe("cho-duyet");
    expect((await hangDb("C")).trangThaiDuyet).toBe("dang-lam");
    expect((await hnDb())[0].items[0].trangThaiDuyet, "dòng nhóm không có trạng thái duyệt").toBeUndefined();
    expect((await prisma.quote.findUnique({ where: { id: quoteId } })).hnStatus).toBe("submitted");
  });

  it("hàng ĐÃ GỬI khoá với Account HN ở máy chủ (409), hàng đang làm vẫn sửa được", async () => {
    const sua = await hnLuu((items) => { items.find((x) => x.name === "A").unitPrice = 9999; });
    expect(sua.status, JSON.stringify(sua.body).slice(0, 300)).toBe(409);
    expect(sua.body.code).toBe("hang-hn-da-khoa");
    expect((await hangDb("A")).unitPrice).toBe(1000);
    const ok = await hnLuu((items) => { items.find((x) => x.name === "C").unitPrice = 350; });
    expect(ok.status, JSON.stringify(ok.body).slice(0, 300)).toBe(200);
    expect((await hangDb("C")).unitPrice).toBe(350);
  });

  it("QUYỀN: chỉ có quote:internal:approve (không quote:hn:manage) → 403; Account HN được giao KHÔNG tự duyệt kể cả khi được cấp quote:hn:manage", async () => {
    const nb = await dangNhap(chiDuyetNoiBoU);
    expect((await nb.post(`/api/quotes/${quoteId}/hn/review`).send({ decision: "approve", rids: [await rid("A")] })).status).toBe(403);
    await prisma.user.update({ where: { id: hnU.id }, data: { permissions: [P.QUOTE_HN_FILL, P.QUOTE_HN_MANAGE, P.QUOTE_READ_OWN] } });
    try {
      const hn = await dangNhap(hnU);
      const r = await hn.post(`/api/quotes/${quoteId}/hn/review`).send({ decision: "approve", rids: [await rid("A")] });
      expect(r.status, JSON.stringify(r.body)).toBe(403);
    } finally {
      await prisma.user.update({ where: { id: hnU.id }, data: { permissions: [] } });
    }
    expect((await hangDb("A")).trangThaiDuyet).toBe("cho-duyet");
  });

  it("CHỦ báo giá (manager — quyền cũ quote:hn:manage) DUYỆT một hàng → hàng đó vào Hóa đơn đầu vào NGAY (phần HN chưa duyệt hết); MỘT thông báo cho Account HN", async () => {
    const admin = await dangNhap(soanU);
    const truoc = await soThongBao(hnU.id);
    const r = await admin.post(`/api/quotes/${quoteId}/hn/review`).send({ decision: "approve", rids: [await rid("A")] });
    expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(200);
    expect(await soThongBao(hnU.id)).toBe(truoc + 1);
    const a = await hangDb("A");
    expect(a).toMatchObject({ trangThaiDuyet: "da-duyet", approved: true, approvedBy: soanU.id });
    expect((await prisma.quote.findUnique({ where: { id: quoteId } })).hnStatus, "còn B đang chờ").toBe("submitted");

    const kt = await dangNhap(ketoanU);
    const dong = await dongDauVao(kt);
    expect(dong.map((d) => d.name)).toEqual(["A"]);
    expect(dong[0]).toMatchObject({ trangThaiHang: "binh-thuong", amount: 1000, approvedByName: `${TAG} soan`, coTheGhi: true });
    // Kế toán tích ĐÃ CHI được ngay trên hàng đã duyệt theo hàng.
    const chi = await kt.put(`/api/quotes/input-invoices/${quoteId}/hn/${encodeURIComponent(a.rid)}`).send({ baseVersion: 0, paid: true });
    expect(chi.status, JSON.stringify(chi.body).slice(0, 300)).toBe(200);
    // Hàng chưa duyệt thì chưa là khoản chi.
    const chua = await kt.put(`/api/quotes/input-invoices/${quoteId}/hn/${encodeURIComponent(await rid("B"))}`).send({ baseVersion: 0, paid: true });
    expect(chua.status).toBe(409);
    expect(chua.body.code).toBe("hang-chua-duyet");
  });

  it("hàng ĐÃ DUYỆT khoá với MỌI người qua đường Lưu báo giá (chủ lẫn admin), xoá cũng không được; hàng khác vẫn sửa được, khoản đã chi giữ nguyên", async () => {
    for (const u of [soanU, adminU]) {
      const ag = await dangNhap(u);
      // Sửa phần KHÔNG phải tiền (tiền của hàng đã chi còn bị chốt kế toán chặn trước — 400 riêng).
      const sua = await luuBaoGia(ag, (items) => { items.find((x) => x.name === "A").detail = "sửa sau duyệt"; });
      expect(sua.status, `${u.username}: ${JSON.stringify(sua.body).slice(0, 200)}`).toBe(409);
      expect(sua.body.code).toBe("hang-hn-da-khoa");
      // A còn ĐÃ CHI: xoá bị chốt kế toán chặn trước (400 'hang-da-chi'); xoá hàng đã duyệt CHƯA chi → 409 ở bài cuối.
      const xoa = await luuBaoGia(ag, (items, tables) => { tables[0].items = items.filter((x) => x.name !== "A"); });
      expect(xoa.status).toBe(400);
      expect(xoa.body.code).toBe("hang-da-chi");
    }
    expect((await hnLuu((items, tables) => { tables[0].items = items.filter((x) => x.name !== "A"); })).status).toBe(400);
    expect(await hangDb("A")).toMatchObject({ quantity: 1, detail: null });

    const soan = await dangNhap(soanU);
    const ok = await luuBaoGia(soan, (items) => { items.find((x) => x.name === "C").unitPrice = 400; });
    expect(ok.status, JSON.stringify(ok.body).slice(0, 300)).toBe(200);
    const a = await hangDb("A");
    expect(a.trangThaiDuyet, "Lưu báo giá không đổi được trạng thái duyệt").toBe("da-duyet");
    const khoan = await prisma.inputInvoiceEntry.findUnique({ where: { quoteId_side_rid: { quoteId, side: "hn", rid: a.rid } } });
    expect(khoan.paid).toBe(true);
  });

  it("payload GIẢ trạng thái (Account HN / chủ tự đặt trangThaiDuyet, approved) → bị bỏ qua, theo CSDL", async () => {
    const r = await hnLuu((items) => { const c = items.find((x) => x.name === "C"); Object.assign(c, { trangThaiDuyet: "da-duyet", approved: true, approvedBy: adminU.id }); });
    expect(r.status).toBe(200);
    expect(await hangDb("C")).toMatchObject({ trangThaiDuyet: "dang-lam", approved: false, approvedBy: null });
  });

  it("TRẢ LẠI một hàng kèm lý do → Account HN sửa được, gửi lại hàng loạt (gồm cả hàng đang làm)", async () => {
    const admin = await dangNhap(adminU);
    const truoc = await soThongBao(hnU.id);
    const r = await admin.post(`/api/quotes/${quoteId}/hn/review`).send({ decision: "reject", rids: [await rid("B")], note: "Giá B cao" });
    expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(200);
    expect(await soThongBao(hnU.id)).toBe(truoc + 1);
    expect(await hangDb("B")).toMatchObject({ trangThaiDuyet: "tra-lai", lyDoTra: "Giá B cao" });
    expect((await hnLuu((items) => { items.find((x) => x.name === "B").unitPrice = 450; })).status).toBe(200);
    expect(await hangDb("B")).toMatchObject({ unitPrice: 450, trangThaiDuyet: "tra-lai" });
    const hn = await dangNhap(hnU);
    expect((await hn.post(`/api/quotes/${quoteId}/hn/submit`).send({})).status).toBe(200);
    expect((await hangDb("B")).trangThaiDuyet).toBe("cho-duyet");
    expect((await hangDb("C")).trangThaiDuyet).toBe("cho-duyet");
    expect((await hangDb("A")).trangThaiDuyet, "hàng đã duyệt không bị gửi lại").toBe("da-duyet");
    // Gửi lại lần nữa: không còn gì để gửi.
    expect((await hn.post(`/api/quotes/${quoteId}/hn/submit`).send({})).status).toBe(400);
  });

  it("ĐỒNG THỜI: hai người cùng duyệt một hàng → một 200, một 400; duyệt hàng loạt các hàng đang chờ → cả phần 'approved'", async () => {
    const [a1, a2] = await Promise.all([dangNhap(adminU), dangNhap(admin2U)]);
    const b = await rid("B");
    const kq = await Promise.all([
      a1.post(`/api/quotes/${quoteId}/hn/review`).send({ decision: "approve", rids: [b] }),
      a2.post(`/api/quotes/${quoteId}/hn/review`).send({ decision: "approve", rids: [b] }),
    ]);
    expect(kq.map((r) => r.status).sort()).toEqual([200, 400]);
    expect((await a1.post(`/api/quotes/${quoteId}/hn/review`).send({ decision: "approve" })).status).toBe(200);
    expect((await prisma.quote.findUnique({ where: { id: quoteId } })).hnStatus).toBe("approved");
    const kt = await dangNhap(ketoanU);
    expect((await dongDauVao(kt)).map((d) => d.name).sort()).toEqual(["A", "B", "C"]);
  });

  it("BỎ DUYỆT (chọn hàng) mở khoá: hàng đã chi chuyển sang 'Cần chú ý' (khoản giữ nguyên), sửa lại được; bỏ duyệt không chọn hàng → 400", async () => {
    const admin = await dangNhap(adminU);
    expect((await admin.post(`/api/quotes/${quoteId}/hn/review`).send({ decision: "unapprove" })).status).toBe(400);
    const a = await rid("A");
    const r = await admin.post(`/api/quotes/${quoteId}/hn/review`).send({ decision: "unapprove", rids: [a] });
    expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(200);
    expect(await hangDb("A")).toMatchObject({ trangThaiDuyet: "dang-lam", approved: false });
    const kt = await dangNhap(ketoanU);
    const dongA = (await dongDauVao(kt)).find((d) => d.name === "A");
    expect(dongA).toMatchObject({ trangThaiHang: "hn-chua-duyet", paid: true });
    // Đã mở: Account HN đổi được tên hàng (tiền hàng đã chi thì chốt tiền của kế toán vẫn giữ — không thuộc bài này).
    expect((await hnLuu((items) => { items.find((x) => x.name === "A").notes = "ghi chú sau bỏ duyệt"; })).status).toBe(200);
    expect((await prisma.quote.findUnique({ where: { id: quoteId } })).hnStatus).toBe("assigned");
  });

  it("NS · Chứng từ · Lưu kho của hàng đã duyệt: chủ (quote:hn:manage) vẫn cập nhật được — tiền thì không", async () => {
    const soan = await dangNhap(soanU);
    const r = await luuBaoGia(soan, (items) => { Object.assign(items.find((x) => x.name === "B"), { ns: "Đã hoàn", chungTu: "VAT", luuKho: true }); });
    expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(200);
    expect(await hangDb("B")).toMatchObject({ ns: "Đã hoàn", chungTu: "VAT", luuKho: true, trangThaiDuyet: "da-duyet" });
    // Account HN thì không (hàng đã duyệt khoá trọn với họ).
    expect((await hnLuu((items) => { items.find((x) => x.name === "B").ns = "HN sửa"; })).status).toBe(409);
    // XOÁ hàng đã duyệt (chưa chi) → 409, ở cả hai đường Lưu.
    const xoaHn = await hnLuu((items, tables) => { tables[0].items = items.filter((x) => x.name !== "B"); });
    expect(xoaHn.status).toBe(409);
    expect(xoaHn.body.code).toBe("hang-hn-da-khoa");
    expect((await luuBaoGia(soan, (items, tables) => { tables[0].items = items.filter((x) => x.name !== "B"); })).status).toBe(409);
    expect(await hangDb("B")).toBeTruthy();
  });
});

describe.runIf(dbAvailable)("Bảng Hà Nội — TƯƠNG THÍCH dữ liệu cũ đã duyệt CẢ PHẦN (không migration)", () => {
  let app, chuU, hnU, ketoanU, companyId, quoteId;
  const T2 = `${TAG}c`;
  const dangNhap = async (u) => {
    const a = agentWithCsrf(app);
    expect((await a.post("/api/auth/login").send({ username: u.username, password: PWD })).status).toBe(200);
    return a;
  };
  const taoUser = (ten, role) => bcrypt.hash(PWD, 4).then((passwordHash) => prisma.user.create({ data: { username: `${T2}-${ten}`, displayName: `${T2} ${ten}`, role, passwordHash } }));
  const hangDb = async (r) => (await prisma.quote.findUnique({ where: { id: quoteId }, select: { hnTables: true } })).hnTables.flatMap((t) => t.items).find((it) => it.rid === r);
  const dong = async () => (await (await dangNhap(ketoanU)).get("/api/quotes/input-invoices")).body.data.filter((r) => r.quoteId === quoteId && r.side === "hn");
  const DUYET_LUC = new Date("2026-09-25T01:00:00.000Z");

  beforeAll(async () => {
    app = (await import("../src/app.js")).createApp();
    chuU = await taoUser("chu", "admin");
    hnU = await taoUser("hn", "account_hn");
    ketoanU = await taoUser("ketoan", "accountant");
    companyId = (await prisma.company.create({ data: { code: `${T2}CO`, name: "Cty cũ", address: "1 Thử", quotePrefix: `E${`${Date.now()}`.slice(-6)}` } })).id;
    // Hình dạng ĐÚNG như production trước bản này: sanitize ghi approved:false cho mọi hàng HN, KHÔNG có trangThaiDuyet;
    // phần HN duyệt bằng hnStatus/hnReviewedAt/hnReviewerId.
    const hang = (r, name, unitPrice) => ({ kind: "item", rid: r, name, quantity: 1, unitPrice, days: null, approved: false, approvedAt: null, approvedBy: null, paid: false, paidAt: null, paidById: null, paidProof: null, ns: null, luuKho: false, chungTu: null });
    const q = await prisma.quote.create({ data: {
      quoteNumber: `${T2}-1`, title: `${T2} cũ`, searchText: T2, toCompany: "Khách", companyId, fromContact: "x", fromAddress: "x",
      city: "TP. Hồ Chí Minh", quoteDate: new Date(), createdById: chuU.id, status: "draft", subtotal: 0, total: 0,
      hnStatus: "approved", hnAssigneeId: hnU.id, hnReviewedAt: DUYET_LUC, hnReviewerId: chuU.id,
      hnTables: [{ name: "Giá HN cũ", templateId: null, groupSubtotal: false, items: [hang("L1", "Thuê sàn cũ", 2_000_000), hang("L2", "Xe cũ", 500_000)] }],
      members: { create: [{ userId: chuU.id, scopes: ["main", "hcm", "hanoi", "khach"] }, { userId: hnU.id, scopes: ["hanoi"] }] },
      sheets: { create: [{ name: "Trang 1", order: 0, codeNo: 1, templateId: (await prisma.quoteTemplate.create({ data: { companyId, name: "Mẫu", code: `${T2}k`, filePath: "templates/GN_KhongNgay.xlsx" } })).id }] },
    } });
    quoteId = q.id;
    // Khoản ĐÃ CHI trên production cho L1.
    await prisma.inputInvoiceEntry.create({ data: { quoteId, side: "hn", rid: "L1", paid: true, paidAt: new Date(), paidById: ketoanU.id, paidByName: "kt", rowSnapshot: { name: "Thuê sàn cũ" }, version: 1 } });
  }, 60_000);

  afterAll(async () => {
    const ids = [chuU, hnU, ketoanU].filter(Boolean).map((u) => u.id);
    await prisma.inputInvoiceEntry.deleteMany({ where: { quoteId } }).catch(() => {});
    await prisma.auditEvent.deleteMany({ where: { actorId: { in: ids } } }).catch(() => {});
    await prisma.notification.deleteMany({ where: { userId: { in: ids } } }).catch(() => {});
    await prisma.quote.deleteMany({ where: { title: { startsWith: T2 } }, hardDelete: true, includeDeleted: true }).catch(() => {});
    await prisma.quoteTemplate.deleteMany({ where: { code: { startsWith: T2 } }, hardDelete: true }).catch(() => {});
    await prisma.company.deleteMany({ where: { code: { startsWith: T2 } }, hardDelete: true }).catch(() => {});
    await prisma.loginAttempt.deleteMany({ where: { username: { startsWith: T2 } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: T2 } }, hardDelete: true, includeDeleted: true }).catch(() => {});
  });

  it("mọi hàng của phần đã duyệt cả phần là ĐÃ DUYỆT: Hóa đơn đầu vào đủ hai dòng, ngày/người duyệt theo cả phần, khoản đã chi giữ", async () => {
    const ds = await dong();
    expect(ds.map((d) => d.rid).sort()).toEqual(["L1", "L2"]);
    for (const d of ds) expect(d).toMatchObject({ trangThaiHang: "binh-thuong", approvedAt: DUYET_LUC.toISOString(), approvedByName: `${T2} chu` });
    expect(ds.find((d) => d.rid === "L1").paid).toBe(true);
    // Trình bày cho màn soạn: trạng thái hiệu lực đã suy sẵn.
    const q = (await (await dangNhap(chuU)).get(`/api/quotes/${quoteId}`)).body;
    expect(q.hnTables[0].items.map((it) => it.trangThaiDuyet)).toEqual(["da-duyet", "da-duyet"]);
    // CSDL CHƯA bị ghi gì (đọc không vật chất hoá).
    expect((await hangDb("L1")).trangThaiDuyet).toBeUndefined();
  });

  it("chủ Lưu lại nguyên vẹn → 200, trạng thái được VẬT CHẤT HOÁ (đã duyệt, người duyệt cũ); sửa tiền → 409; khoản giữ", async () => {
    const chu = await dangNhap(chuU);
    const q = (await chu.get(`/api/quotes/${quoteId}`)).body;
    const nhu = { ...q, sheets: q.sheets.map((s) => ({ ...s, extraTables: Array.isArray(s.extraTables) ? s.extraTables : [] })) };
    const r = await chu.put(`/api/quotes/${quoteId}`).send({ ...nhu, baseUpdatedAt: q.updatedAt });
    expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(200);
    expect(await hangDb("L1")).toMatchObject({ trangThaiDuyet: "da-duyet", approved: true, approvedBy: chuU.id, approvedAt: DUYET_LUC.toISOString() });
    expect((await prisma.quote.findUnique({ where: { id: quoteId } })).hnStatus).toBe("approved");

    const q2 = (await chu.get(`/api/quotes/${quoteId}`)).body;
    const hn = JSON.parse(JSON.stringify(q2.hnTables));
    hn[0].items[1].unitPrice = 1;
    const sua = await chu.put(`/api/quotes/${quoteId}`).send({ ...nhu, hnTables: hn, baseUpdatedAt: q2.updatedAt });
    expect(sua.status).toBe(409);
    expect((await prisma.inputInvoiceEntry.findFirst({ where: { quoteId, rid: "L1" } })).paid).toBe(true);
    expect((await dong()).length).toBe(2);
  });

  it("GIAO LẠI phần HN không mở khoá hàng đã duyệt (bản cả phần cũ: approved → assigned là mở cả phần)", async () => {
    // Đưa về đúng hình dạng cũ (chưa vật chất hoá) để đo đường giao.
    const bang = (await prisma.quote.findUnique({ where: { id: quoteId }, select: { hnTables: true } })).hnTables;
    await prisma.quote.update({ where: { id: quoteId }, data: { hnStatus: "approved", hnTables: bang.map((t) => ({ ...t, items: t.items.map(({ trangThaiDuyet: _a, lyDoTra: _b, ...it }) => ({ ...it, approved: false, approvedAt: null, approvedBy: null })) })) } });
    const chu = await dangNhap(chuU);
    expect((await chu.post(`/api/quotes/${quoteId}/hn/assign`).send({ accountId: hnU.id })).status).toBe(200);
    expect((await hangDb("L2")).trangThaiDuyet).toBe("da-duyet");
    expect((await dong()).map((d) => d.trangThaiHang)).toEqual(["binh-thuong", "binh-thuong"]);
    // Account HN không sửa được hàng cũ đã duyệt.
    const hn = await dangNhap(hnU);
    const qh = (await hn.get(`/api/quotes/${quoteId}`)).body;
    const t = JSON.parse(JSON.stringify(qh.hnTables));
    t[0].items[1].unitPrice = 7;
    expect((await hn.put(`/api/quotes/${quoteId}/hn`).send({ baseHnRev: qh.hnRev, hnTables: t })).status).toBe(409);
  });

  it("BỎ DUYỆT tường minh một hàng của phần đã duyệt cả phần: cờ riêng THẮNG hnStatus — hàng đó rời Hóa đơn đầu vào, hàng kia ở lại", async () => {
    // Lại hình dạng cũ + hnStatus=approved: bỏ duyệt L2 phải vật chất hoá L1 (đã duyệt) và ghi L2 = đang làm.
    const bang = (await prisma.quote.findUnique({ where: { id: quoteId }, select: { hnTables: true } })).hnTables;
    await prisma.quote.update({ where: { id: quoteId }, data: { hnStatus: "approved", hnTables: bang.map((t) => ({ ...t, items: t.items.map(({ trangThaiDuyet: _a, lyDoTra: _b, ...it }) => it) })) } });
    const chu = await dangNhap(chuU);
    const r = await chu.post(`/api/quotes/${quoteId}/hn/review`).send({ decision: "unapprove", rids: ["L2"] });
    expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(200);
    expect((await hangDb("L2")).trangThaiDuyet).toBe("dang-lam");
    expect((await hangDb("L1")).trangThaiDuyet).toBe("da-duyet");
    // hnStatus vẫn có thể là bất cứ gì — giả lập dữ liệu "approved" còn sót: cờ riêng vẫn thắng.
    await prisma.quote.update({ where: { id: quoteId }, data: { hnStatus: "approved" } });
    const ds = await dong();
    expect(ds.map((d) => d.rid)).toEqual(["L1"]);
    expect(ds[0].paid).toBe(true);
  });
});
