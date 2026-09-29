/**
 * BA CỘT BẢNG NỘI BỘ — NS · CHỨNG TỪ (VAT/HĐNS/TM) · LƯU KHO (4e24308) — đi hết đường CSDL thật.
 *
 * Mỗi hàng bảng nội bộ phải qua ba cửa mới xuống tới cột Json (zod itemSchema loại khoá lạ im lặng;
 * sanitizeExtraTables / sanitizeHnTables dựng lại hàng bằng danh sách trường; presentQuote* khi đọc ra).
 * Bài đơn vị (tests/qc-quoteutils-extra.test.js) chỉ gọi từng hàm; ở đây là LƯU → TẢI LẠI qua HTTP cho
 * cả ba đường ghi: PUT /api/quotes/:id (chủ báo giá — bảng theo trang lẫn bảng Hà Nội), PUT /:id/hn
 * (account Hà Nội), và nhân bản.
 *
 * Nhân bản (luật chốt 2026-09-29): LƯU KHO là trạng thái công việc của dự án cũ — như duyệt / đã trả —
 * nên bị CẮT; NS và CHỨNG TỪ là phân loại của dòng chi phí nên GIỮ. Trước bản vá, catTrangThai chép nguyên
 * cả ba: bản sao mở ra đã "lưu kho" những thứ chưa hề mua.
 *
 * Phần Hà Nội ĐÃ CHỐT (gửi duyệt / đã duyệt): ba trường bị khoá như giá. Hai cửa riêng: saveHn chặn account
 * Hà Nội theo hnStatus; chotHnTables chặn người không được duyệt (account phụ) bằng vân tay vanTayHn — cửa
 * này mà vân tay quên một trong ba trường thì phần sửa "giống hệt CSDL" → bị BỎ IM LẶNG (200 + "Đã lưu",
 * tải lại thấy mất) thay vì 409. Bài đơn vị ở qc-quoteutils-extra chỉ gọi vanTayHn; đây là đường HTTP thật.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import { agentWithCsrf } from "./helpers/agent.js";
import { prisma } from "../src/db.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "Quote" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");

const TAG = `nb3t${Date.now()}`;
const PWD = "BaTruong1234!ok";
const PREFIX = `B${`${Date.now()}`.slice(-6)}`;

const muc = (name, o = {}) => ({ kind: "item", name, unit: "cái", quantity: 1, unitPrice: 100000, ...o });
/** Ba trường của một hàng như client đọc được sau khi tải lại. */
const ba = (it) => [it?.ns ?? null, it?.chungTu ?? null, !!it?.luuKho];
const hangTen = (items, name) => (items || []).find((it) => it?.name === name);

describe.runIf(dbAvailable)("Bảng nội bộ: NS · CHỨNG TỪ · LƯU KHO — lưu, tải lại, nhân bản trên CSDL thật", () => {
  let app, chuU, hnU, phuU, companyId, templateId, quoteId;

  const dangNhap = async (u) => {
    const a = agentWithCsrf(app);
    expect((await a.post("/api/auth/login").send({ username: u.username, password: PWD })).status).toBe(200);
    return a;
  };
  const docChu = async () => (await (await dangNhap(chuU)).get(`/api/quotes/${quoteId}`)).body;
  /** Payload y như trình soạn: `extraTables` null → [] (zod chỉ nhận mảng hoặc vắng mặt). */
  const nhuClient = (q) => ({ ...q, sheets: (q.sheets || []).map((s) => ({ ...s, extraTables: Array.isArray(s.extraTables) ? s.extraTables : [] })) });
  const bangCua = (q, cat) => (q.sheets?.[0]?.extraTables || []).find((t) => t.category === cat);

  beforeAll(async () => {
    app = (await import("../src/app.js")).createApp();
    const hash = await bcrypt.hash(PWD, 4);
    chuU = await prisma.user.create({ data: { username: `${TAG}-chu`, displayName: `${TAG} chu`, role: "admin", passwordHash: hash } });
    hnU = await prisma.user.create({ data: { username: `${TAG}-hn`, displayName: `${TAG} hn`, role: "account_hn", passwordHash: hash } });
    // Account PHỤ: manager mặc định (có quote:hn:manage) nhưng là phụ → chotHnTables vẫn chặn (RBAC-07).
    phuU = await prisma.user.create({ data: { username: `${TAG}-phu`, displayName: `${TAG} phu`, role: "manager", passwordHash: hash } });
    const co = await prisma.company.create({ data: { code: `${TAG}CO`, name: "Cty thử ba trường", address: "1 Thử", quotePrefix: PREFIX } });
    companyId = co.id;
    templateId = (await prisma.quoteTemplate.create({ data: { companyId, name: "Mẫu thử", code: `${TAG}k`, filePath: "templates/GN_KhongNgay.xlsx" } })).id;

    const chu = await dangNhap(chuU);
    const r = await chu.post("/api/quotes").send({
      title: `${TAG} gốc`, companyId, toCompany: "Khách thử", vatPercent: 8,
      sheets: [{
        name: "Trang 1", order: 0, templateId, items: [{ kind: "item", name: "Màn LED", quantity: 1, unitPrice: 5000000, order: 0 }],
        extraTables: [
          { category: "hcm", name: "HCM", items: [
            { kind: "section", name: "NHÓM A" },
            muc("Backdrop", { ns: "Anh Tuấn", chungTu: "VAT", luuKho: true }),
            muc("Standee"),
          ] },
          { category: "khach", name: "Phí KH", items: [muc("Phí vận chuyển", { ns: "Chị Lan", chungTu: "HDNS", luuKho: false })] },
        ],
      }],
      hnTables: [{ name: "HN", templateId, items: [muc("Nhân công HN", { ns: "Anh Nam", chungTu: "TM", luuKho: true })] }],
    });
    expect(r.status, JSON.stringify(r.body).slice(0, 400)).toBe(201);
    quoteId = r.body.id;
    expect((await chu.post(`/api/quotes/${quoteId}/hn/assign`).send({ accountId: hnU.id })).status).toBe(200);
  }, 60_000);

  afterAll(async () => {
    const qIds = (await prisma.quote.findMany({ where: { title: { startsWith: TAG } }, includeDeleted: true, select: { id: true } })).map((q) => q.id);
    await prisma.auditEvent.deleteMany({ where: { actorId: { in: [chuU?.id, hnU?.id, phuU?.id].filter(Boolean) } } }).catch(() => {});
    await prisma.notification.deleteMany({ where: { userId: { in: [chuU?.id, hnU?.id, phuU?.id].filter(Boolean) } } }).catch(() => {});
    await prisma.quote.deleteMany({ where: { id: { in: qIds } }, hardDelete: true }).catch(() => {});
    await prisma.quoteTemplate.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.company.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.quoteCounter.deleteMany({ where: { prefix: PREFIX } }).catch(() => {});
    await prisma.loginAttempt.deleteMany({ where: { username: { startsWith: TAG } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
  });

  it("tạo báo giá (POST) rồi tải lại: ba trường về đúng ở bảng HCM, Phí KH và bảng Hà Nội; hàng trống là mặc định", async () => {
    const q = await docChu();
    expect(ba(hangTen(bangCua(q, "hcm").items, "Backdrop"))).toEqual(["Anh Tuấn", "VAT", true]);
    expect(ba(hangTen(bangCua(q, "hcm").items, "Standee"))).toEqual([null, null, false]);
    expect(ba(hangTen(bangCua(q, "khach").items, "Phí vận chuyển"))).toEqual(["Chị Lan", "HDNS", false]);
    expect(ba(hangTen(q.hnTables[0].items, "Nhân công HN"))).toEqual(["Anh Nam", "TM", true]);
  });

  it("PUT /api/quotes/:id (chủ báo giá): sửa ba trường ở bảng theo trang và bảng Hà Nội → tải lại thấy đúng giá trị mới", async () => {
    const chu = await dangNhap(chuU);
    const q = nhuClient(await docChu());
    const hcm = bangCua(q, "hcm");
    Object.assign(hangTen(hcm.items, "Backdrop"), { ns: "Anh Tuấn (đã hoàn ứng)", chungTu: "TM", luuKho: false });
    Object.assign(hangTen(hcm.items, "Standee"), { ns: "Kho Q7\ntầng 2", chungTu: "HDNS", luuKho: true });
    Object.assign(hangTen(bangCua(q, "khach").items, "Phí vận chuyển"), { ns: null, chungTu: null, luuKho: true });
    const hnTables = q.hnTables.map((t) => ({ ...t, items: t.items.map((it) => ({ ...it, chungTu: "VAT", luuKho: false })) }));
    const luu = await chu.put(`/api/quotes/${quoteId}`).send({ ...q, hnTables, baseUpdatedAt: q.updatedAt });
    expect(luu.status, JSON.stringify(luu.body).slice(0, 400)).toBe(200);

    const sau = await docChu();
    expect(ba(hangTen(bangCua(sau, "hcm").items, "Backdrop"))).toEqual(["Anh Tuấn (đã hoàn ứng)", "TM", false]);
    expect(ba(hangTen(bangCua(sau, "hcm").items, "Standee")), "NS nhiều dòng / HĐNS / lưu kho mới").toEqual(["Kho Q7\ntầng 2", "HDNS", true]);
    expect(ba(hangTen(bangCua(sau, "khach").items, "Phí vận chuyển"))).toEqual([null, null, true]);
    expect(ba(hangTen(sau.hnTables[0].items, "Nhân công HN"))).toEqual(["Anh Nam", "VAT", false]);
    // Chốt tận CSDL — không phải chỉ lớp trình bày.
    const db = await prisma.quote.findUnique({ where: { id: quoteId }, include: { sheets: true } });
    const dbHcm = db.sheets[0].extraTables.find((t) => t.category === "hcm");
    expect(ba(hangTen(dbHcm.items, "Standee"))).toEqual(["Kho Q7\ntầng 2", "HDNS", true]);
    expect(ba(hangTen(db.hnTables[0].items, "Nhân công HN"))).toEqual(["Anh Nam", "VAT", false]);
  }, 60_000);

  it("PUT /api/quotes/:id/hn (account Hà Nội): sửa ba trường → account HN lẫn chủ báo giá tải lại đều thấy", async () => {
    const hn = await dangNhap(hnU);
    const q = (await hn.get(`/api/quotes/${quoteId}`)).body;
    expect(q._accountHnView).toBe(true);
    const hnTables = q.hnTables.map((t) => ({
      ...t,
      items: [...t.items.map((it) => ({ ...it, ns: "Tiên ứng", chungTu: "HDNS", luuKho: true })), muc("Xe tải HN", { ns: "Anh Hải", chungTu: "TM" })],
    }));
    const r = await hn.put(`/api/quotes/${quoteId}/hn`).send({ baseHnRev: q.hnRev, hnTables });
    expect(r.status, JSON.stringify(r.body).slice(0, 400)).toBe(200);

    const lai = (await hn.get(`/api/quotes/${quoteId}`)).body;
    expect(ba(hangTen(lai.hnTables[0].items, "Nhân công HN"))).toEqual(["Tiên ứng", "HDNS", true]);
    expect(ba(hangTen(lai.hnTables[0].items, "Xe tải HN")), "hàng mới: luuKho vắng mặt → false").toEqual(["Anh Hải", "TM", false]);
    const chu = await docChu();
    expect(ba(hangTen(chu.hnTables[0].items, "Nhân công HN"))).toEqual(["Tiên ứng", "HDNS", true]);
  }, 60_000);

  it("chứng từ lạ bị chặn (400) ở cả hai đường ghi — không lặng lẽ thành null", async () => {
    const chu = await dangNhap(chuU);
    const q = nhuClient(await docChu());
    hangTen(bangCua(q, "hcm").items, "Backdrop").chungTu = "CK";
    expect((await chu.put(`/api/quotes/${quoteId}`).send({ ...q, baseUpdatedAt: q.updatedAt })).status).toBe(400);
    const hn = await dangNhap(hnU);
    const qh = (await hn.get(`/api/quotes/${quoteId}`)).body;
    const r = await hn.put(`/api/quotes/${quoteId}/hn`).send({ baseHnRev: qh.hnRev, hnTables: qh.hnTables.map((t) => ({ ...t, items: t.items.map((it) => ({ ...it, chungTu: "CK" })) })) });
    expect(r.status).toBe(400);
  }, 60_000);

  it("nhân bản: GIỮ NS + chứng từ, XOÁ lưu kho — bảng theo trang lẫn bảng Hà Nội; bản gốc không đổi", async () => {
    const chu = await dangNhap(chuU);
    const r = await chu.post(`/api/quotes/${quoteId}/duplicate`).send({ sameProject: true });
    expect(r.status, JSON.stringify(r.body).slice(0, 400)).toBe(201);

    const moi = (await chu.get(`/api/quotes/${r.body.id}`)).body;
    expect(ba(hangTen(bangCua(moi, "hcm").items, "Standee")), "bản sao mang trạng thái lưu kho của dự án cũ").toEqual(["Kho Q7\ntầng 2", "HDNS", false]);
    expect(ba(hangTen(bangCua(moi, "khach").items, "Phí vận chuyển"))).toEqual([null, null, false]);
    expect(ba(hangTen(moi.hnTables[0].items, "Nhân công HN")), "bảng HN của bản sao còn lưu kho").toEqual(["Tiên ứng", "HDNS", false]);
    expect(ba(hangTen(moi.hnTables[0].items, "Xe tải HN"))).toEqual(["Anh Hải", "TM", false]);

    const goc = await docChu();
    expect(ba(hangTen(bangCua(goc, "hcm").items, "Standee")), "nhân bản đụng vào bản gốc").toEqual(["Kho Q7\ntầng 2", "HDNS", true]);
    expect(ba(hangTen(goc.hnTables[0].items, "Nhân công HN"))).toEqual(["Tiên ứng", "HDNS", true]);
  }, 60_000);

  // ── Phần Hà Nội ĐÃ CHỐT. Các bài dưới đổi hnStatus nên đứng SAU mọi bài cần phần HN còn mở. ──
  const hnTrongDb = async () => (await prisma.quote.findUnique({ where: { id: quoteId }, select: { hnTables: true } })).hnTables;

  it("phần HN ĐÃ GỬI DUYỆT: account Hà Nội sửa ba trường qua PUT /:id/hn bị chặn, CSDL giữ nguyên", async () => {
    await prisma.quote.update({ where: { id: quoteId }, data: { hnStatus: "submitted" } });
    const hn = await dangNhap(hnU);
    const q = (await hn.get(`/api/quotes/${quoteId}`)).body;
    const hnTables = q.hnTables.map((t) => ({ ...t, items: t.items.map((it) => ({ ...it, ns: "Sửa sau khi gửi", chungTu: "VAT", luuKho: false })) }));
    const r = await hn.put(`/api/quotes/${quoteId}/hn`).send({ baseHnRev: q.hnRev, hnTables });
    expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(400);
    expect(ba(hangTen((await hnTrongDb())[0].items, "Nhân công HN"))).toEqual(["Tiên ứng", "HDNS", true]);
  }, 60_000);

  it("phần HN ĐÃ DUYỆT: account phụ sửa CHỈ một trong ba trường qua PUT /api/quotes/:id → 409 (không bỏ im lặng), CSDL giữ nguyên", async () => {
    await prisma.quote.update({ where: { id: quoteId }, data: { hnStatus: "approved" } });
    await prisma.quoteMember.create({ data: { quoteId, userId: phuU.id, scopes: ["hanoi"], addedById: chuU.id } });
    const phu = await dangNhap(phuU);
    const q = nhuClient((await phu.get(`/api/quotes/${quoteId}`)).body);
    expect(ba(hangTen(q.hnTables?.[0]?.items, "Nhân công HN")), "phụ không thấy phần HN").toEqual(["Tiên ứng", "HDNS", true]);
    for (const doi of [{ ns: "Tiên ứng (sửa)" }, { chungTu: "VAT" }, { luuKho: false }]) {
      const hnTables = q.hnTables.map((t) => ({ ...t, items: t.items.map((it) => (it.name === "Nhân công HN" ? { ...it, ...doi } : it)) }));
      const r = await phu.put(`/api/quotes/${quoteId}`).send({ ...q, hnTables, baseUpdatedAt: q.updatedAt });
      expect(r.status, `${JSON.stringify(doi)} → ${JSON.stringify(r.body).slice(0, 200)}`).toBe(409);
    }
    const db = await hnTrongDb();
    expect(ba(hangTen(db[0].items, "Nhân công HN"))).toEqual(["Tiên ứng", "HDNS", true]);
    expect(ba(hangTen(db[0].items, "Xe tải HN"))).toEqual(["Anh Hải", "TM", false]);
  }, 60_000);

  it("phần HN ĐÃ DUYỆT: account phụ lưu lại NGUYÊN VẸN → 200, không 409 oan vì ba trường; ba trường còn nguyên", async () => {
    const phu = await dangNhap(phuU);
    const q = nhuClient((await phu.get(`/api/quotes/${quoteId}`)).body);
    const r = await phu.put(`/api/quotes/${quoteId}`).send({ ...q, baseUpdatedAt: q.updatedAt });
    expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(200);
    const db = await hnTrongDb();
    expect(ba(hangTen(db[0].items, "Nhân công HN"))).toEqual(["Tiên ứng", "HDNS", true]);
    expect(ba(hangTen(db[0].items, "Xe tải HN"))).toEqual(["Anh Hải", "TM", false]);
  }, 60_000);

  it("phần HN ĐÃ DUYỆT: chủ báo giá (người duyệt — có quote:hn:manage) vẫn sửa được ba trường, xuống tận CSDL", async () => {
    const chu = await dangNhap(chuU);
    const q = nhuClient(await docChu());
    const hnTables = q.hnTables.map((t) => ({ ...t, items: t.items.map((it) => (it.name === "Xe tải HN" ? { ...it, ns: "Anh Hải (đã hoàn)", chungTu: "HDNS", luuKho: true } : it)) }));
    const r = await chu.put(`/api/quotes/${quoteId}`).send({ ...q, hnTables, baseUpdatedAt: q.updatedAt });
    expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(200);
    expect(ba(hangTen((await hnTrongDb())[0].items, "Xe tải HN"))).toEqual(["Anh Hải (đã hoàn)", "HDNS", true]);
  }, 60_000);
});
