// BẢNG GIÁ HÀ NỘI Ở CẤP BÁO GIÁ (`Quote.hnTables`) — chốt cho đợt chuyển 2026-09-15.
//
// ── BA LỖI ĐƯỢC VÁ ──────────────────────────────────────────────────────────
// Trước đây bảng HN nằm trong `QuoteSheet.extraTables` với `category:"hanoi"`, tức THEO TỪNG TRANG
// của chủ báo giá:
//   1. LỘ CẤU TRÚC — màn account Hà Nội lặp theo trang và trả kèm `sheetName`/`sheetId`, nên người
//      chỉ được giao điền giá biết luôn báo giá có mấy trang và tên từng trang.
//   2. 409 OAN — lưu phải ghép theo `sheetId`, mà lưu báo giá là XOÁ TRANG RỒI TẠO LẠI nên id đổi
//      hết: account HN gõ nửa tiếng, bấm Lưu, nhận "trang đã được tạo mới, hãy tải lại".
//   3. CHẾT THEO TRANG — chủ xoá một trang là bảng HN nằm trên trang đó mất luôn, im lặng.
//
// ── ĐIỀU DỄ HIỂU NHẦM ───────────────────────────────────────────────────────
// "Bỏ ghép theo sheetId" KHÔNG phải là bỏ chống ghi đè: thay vào đó là khoá lạc quan THẬT
// (`baseUpdatedAt`) + khoá hàng Quote trong transaction. Bỏ cái cũ mà không có cái mới là đổi một
// lỗ mất dữ liệu lấy một lỗ khác.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { agentWithCsrf } from "./helpers/agent.js";
import bcrypt from "bcryptjs";
import { prisma } from "../src/db.js";
import { PERMISSIONS as P } from "../src/permissions.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "Quote" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");

const TAG = `hncap${Date.now()}`;
const PWD = "Test1234!a";

describe.runIf(dbAvailable)("Phần Hà Nội ở cấp báo giá — không lộ trang, không 409 oan, trả về đúng", () => {
  let app, chuU, hnU, companyId, templateId, quoteId;
  const PREFIX = `H${`${Date.now()}`.slice(-6)}`;

  const dangNhap = async (u) => {
    const a = agentWithCsrf(app);
    expect((await a.post("/api/auth/login").send({ username: u.username, password: PWD })).status).toBe(200);
    return a;
  };
  const docChu = async () => (await (await dangNhap(chuU)).get(`/api/quotes/${quoteId}`)).body;
  /** Chuẩn hoá payload y như trình soạn thật: `extraTables` null → [] (presentQuote trả null khi
   *  trang không có bảng nội bộ nào, còn zod chỉ nhận mảng hoặc vắng mặt). */
  const nhuClient = (q) => ({ ...q, sheets: (q.sheets || []).map((s) => ({ ...s, extraTables: Array.isArray(s.extraTables) ? s.extraTables : [] })) });
  const docHn = async () => (await (await dangNhap(hnU)).get(`/api/quotes/${quoteId}`)).body;

  beforeAll(async () => {
    const { createApp } = await import("../src/app.js");
    app = createApp();
    const hash = await bcrypt.hash(PWD, 4);
    chuU = await prisma.user.create({ data: { username: `${TAG}-chu`, displayName: `${TAG} chu`, role: "admin", passwordHash: hash } });
    hnU = await prisma.user.create({ data: { username: `${TAG}-hn`, displayName: `${TAG} hn`, role: "account_hn", passwordHash: hash } });

    const co = await prisma.company.create({ data: { code: `${TAG}CO`, name: "Cty thử", address: "1 Thử", quotePrefix: PREFIX } });
    companyId = co.id;
    templateId = (await prisma.quoteTemplate.create({ data: { companyId: co.id, name: "Mẫu thử", code: `${TAG}k`, filePath: "templates/GN_KhongNgay.xlsx" } })).id;

    const chu = await dangNhap(chuU);
    // HAI trang, tên trang rất dễ nhận ra — để bài "không lộ" bên dưới có cái mà tìm.
    const r = await chu.post("/api/quotes").send({
      title: `${TAG} báo giá`, companyId, toCompany: "Khách BÍ MẬT", vatPercent: 8,
      sheets: [
        { name: "TRANG BÍ MẬT 1", order: 0, templateId, items: [{ kind: "item", name: "Màn LED", quantity: 1, unitPrice: 1000, order: 0 }],
          extraTables: [{ category: "hcm", name: "HCM gốc", items: [{ kind: "item", name: "Thuê xe", quantity: 1, unitPrice: 500 }] }] },
        { name: "TRANG BÍ MẬT 2", order: 1, templateId, items: [{ kind: "item", name: "Sàn", quantity: 1, unitPrice: 2000, order: 0 }], extraTables: [] },
      ],
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    quoteId = r.body.id;
    expect((await chu.post(`/api/quotes/${quoteId}/hn/assign`).send({ accountId: hnU.id })).status).toBe(200);
  });

  afterAll(async () => {
    await prisma.quote.deleteMany({ where: { title: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.quoteTemplate.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.company.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.quoteCounter.deleteMany({ where: { prefix: PREFIX } }).catch(() => {});
    await prisma.auditEvent.deleteMany({ where: { actorId: { in: [chuU?.id, hnU?.id].filter(Boolean) } } }).catch(() => {});
    await prisma.notification.deleteMany({ where: { userId: { in: [chuU?.id, hnU?.id].filter(Boolean) } } }).catch(() => {});
    await prisma.loginAttempt.deleteMany({ where: { username: { startsWith: TAG } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
  });

  it("account HN KHÔNG thấy trang nào của chủ — không tên, không số, không id", async () => {
    const q = await docHn();
    expect(q._accountHnView).toBe(true);
    expect(q.hnSheets, "trường cũ phải biến mất hẳn").toBeUndefined();
    expect(q.sheets).toBeUndefined();
    expect(Array.isArray(q.hnTables)).toBe(true);
    // Chốt thô nhưng đúng chỗ: tên trang của chủ TUYỆT ĐỐI không được có mặt ở bất kỳ đâu trong
    // payload — kể cả lọt qua một trường phụ nào đó thêm về sau.
    expect(JSON.stringify(q)).not.toMatch(/TRANG BÍ MẬT/);
    expect(JSON.stringify(q)).not.toMatch(/Khách BÍ MẬT/);
  });

  it("account HN tự tạo sheet của mình, lưu và đọc lại ĐÚNG y nguyên", async () => {
    const hn = await dangNhap(hnU);
    const q = await docHn();
    const r = await hn.put(`/api/quotes/${quoteId}/hn`).send({
      baseUpdatedAt: q.updatedAt,
      hnTables: [
        { name: "Sheet HN A", templateId, groupSubtotal: true, items: [{ kind: "item", name: "Nhân công HN", quantity: 2, unitPrice: 700 }] },
        { name: "Sheet HN B", templateId, groupSubtotal: false, items: [{ kind: "item", name: "Vận chuyển", quantity: 1, unitPrice: 300 }] },
      ],
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);

    const sau = await docHn();
    expect(sau.hnTables.map((t) => t.name)).toEqual(["Sheet HN A", "Sheet HN B"]);
    expect(sau.hnTables[0].items[0].quantity).toBe(2);
    // `rid` do server sinh — cần có thì kế toán mới tích thanh toán theo hàng được.
    expect(sau.hnTables[0].items[0].rid).toBeTruthy();
  });

  it("TRẢ VỀ ĐÚNG: chủ báo giá thấy y nguyên phần account HN vừa điền", async () => {
    const q = await docChu();
    expect(q.hnTables.map((t) => t.name)).toEqual(["Sheet HN A", "Sheet HN B"]);
    expect(Number(q.hnTables[0].items[0].unitPrice)).toBe(700);
  });

  it("TRẢ VỀ ĐÚNG: tổng HN chảy sang trang Quản lý dự án, dồn vào dòng trang ĐẦU", async () => {
    const chu = await dangNhap(chuU);
    // Trang Quản lý dự án CHỈ liệt kê dự án ĐÃ CHỐT (listProjects lọc status="converted").
    expect((await chu.post(`/api/quotes/${quoteId}/mark-converted`).send({})).status).toBe(200);
    const r = await chu.get("/api/quotes/projects");
    expect(r.status).toBe(200);
    const duAn = r.body.data.find((x) => x.id === quoteId);
    expect(duAn, "báo giá phải có mặt ở Quản lý dự án").toBeTruthy();
    // 2×700 + 1×300 = 1700 — toàn bộ vào dòng trang đầu, dòng sau 0 (cộng cả cột vẫn ra đúng tổng).
    expect(duAn.sheets[0].hanoi).toBe(1700);
    expect(duAn.sheets[1].hanoi).toBe(0);
    expect(duAn.sheets.reduce((a, s) => a + s.hanoi, 0)).toBe(1700);
  });

  it("chủ báo giá bấm Lưu (xoá trang + tạo lại) KHÔNG làm mất phần HN, và account HN lưu tiếp KHÔNG bị 409", async () => {
    // Đây là lỗi (2) và (3) của mô hình cũ, gộp vào một kịch bản.
    const chu = await dangNhap(chuU);
    const q = await docChu();
    const luu = await chu.put(`/api/quotes/${quoteId}`).send({
      ...q, baseUpdatedAt: q.updatedAt,
      sheets: [q.sheets[0]],   // XOÁ hẳn trang 2 — mô hình cũ sẽ cuốn theo bảng HN nằm trên đó
    });
    expect(luu.status, JSON.stringify(luu.body)).toBe(200);

    const sauLuu = await docChu();
    expect(sauLuu.sheets).toHaveLength(1);
    expect(sauLuu.hnTables.map((t) => t.name), "phần HN không dính gì tới trang của chủ").toEqual(["Sheet HN A", "Sheet HN B"]);

    const hn = await dangNhap(hnU);
    const qHn = await docHn();
    const r = await hn.put(`/api/quotes/${quoteId}/hn`).send({
      baseUpdatedAt: qHn.updatedAt,
      hnTables: [...qHn.hnTables, { name: "Sheet HN C", templateId, items: [{ kind: "item", name: "Thêm sau", quantity: 1, unitPrice: 100 }] }],
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect((await docHn()).hnTables).toHaveLength(3);
  });

  it("khoá lạc quan THẬT: mốc cũ → 409 kèm lời nhắc chép lại, không ghi đè im lặng", async () => {
    const hn = await dangNhap(hnU);
    const cu = (await docHn()).updatedAt;
    // Người khác (chủ) ghi xen vào giữa → mốc trong tay account HN thành cũ.
    const chu = await dangNhap(chuU);
    const q = await docChu();
    expect((await chu.put(`/api/quotes/${quoteId}`).send({ ...q, baseUpdatedAt: q.updatedAt, notes: "ghi xen vào" })).status).toBe(200);

    const r = await hn.put(`/api/quotes/${quoteId}/hn`).send({ baseUpdatedAt: cu, hnTables: [] });
    expect(r.status, JSON.stringify(r.body)).toBe(409);
    expect(String(r.body.error || "")).toMatch(/chép lại/i);
    expect((await docHn()).hnTables, "KHÔNG được xoá trắng vì payload rỗng của lượt bị chặn").toHaveLength(3);
  });

  // ── MỐC 409 PHẢI LÀ BẢNG HÀ NỘI, KHÔNG PHẢI `Quote.updatedAt` ──────────────────────────────
  // Màn của account HN KHÔNG có bản nháp cục bộ (khác trình soạn báo giá), nên một lần 409 là
  // mất trắng phần vừa gõ. Chốt bằng `updatedAt` của CẢ báo giá thì chủ bấm Lưu một cái — đổi tên
  // khách, sửa một dòng ở trang 3 — là account HN mất việc, dù không ai đụng vào bảng HN.
  it("chủ sửa phần KHÁC: mốc updatedAt thành cũ nhưng hnRev còn đúng → account HN VẪN lưu được", async () => {
    const hn = await dangNhap(hnU);
    const truoc = await docHn();
    expect(truoc.hnRev, "server phải trả mốc riêng của bảng HN").toMatch(/^[0-9a-f]{32}$/);

    // Chủ ghi xen vào một trường KHÔNG dính gì tới bảng Hà Nội.
    const chu = await dangNhap(chuU);
    const q = await docChu();
    expect((await chu.put(`/api/quotes/${quoteId}`).send({ ...q, baseUpdatedAt: q.updatedAt, notes: "chủ sửa ghi chú" })).status).toBe(200);

    // Mốc updatedAt trong tay account HN nay đã CŨ — bản trước sẽ 409 ở đây.
    const r = await hn.put(`/api/quotes/${quoteId}/hn`).send({
      baseUpdatedAt: truoc.updatedAt,
      baseHnRev: truoc.hnRev,
      hnTables: [...truoc.hnTables, { name: "Sheet HN D", templateId, items: [{ kind: "item", name: "Gõ nửa tiếng", quantity: 1, unitPrice: 777 }] }],
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const sau = await docHn();
    expect(sau.hnTables.map((t) => t.name)).toContain("Sheet HN D");
    expect(sau.hnRev, "bảng HN đổi thì mốc phải đổi theo").not.toBe(truoc.hnRev);
  });

  it("có người sửa THẬT bảng Hà Nội: hnRev cũ → 409, không ghi đè im lặng", async () => {
    const hn = await dangNhap(hnU);
    const truoc = await docHn();

    // Chủ sửa ĐÚNG bảng Hà Nội (đường lưu báo giá, không phải đường /hn).
    const chu = await dangNhap(chuU);
    const q = await docChu();
    const doi = q.hnTables.map((t, i) => (i === 0 ? { ...t, name: "Chủ đổi tên sheet HN" } : t));
    expect((await chu.put(`/api/quotes/${quoteId}`).send({ ...q, baseUpdatedAt: q.updatedAt, hnTables: doi })).status).toBe(200);

    const r = await hn.put(`/api/quotes/${quoteId}/hn`).send({
      baseHnRev: truoc.hnRev,
      hnTables: [],
    });
    expect(r.status, JSON.stringify(r.body)).toBe(409);
    expect(String(r.body.error || "")).toMatch(/Hà Nội|chép lại/i);
    expect((await docHn()).hnTables.length, "payload rỗng của lượt bị chặn KHÔNG được xoá trắng").toBeGreaterThan(0);
  });

  // ── Bốn lỗ do CHÍNH bản vá này đẻ ra, tìm thấy ở vòng soi đối kháng trước khi lên production ──
  it("giá HN đã chốt: chủ bấm Lưu mà KHÔNG sửa gì → 200, không phải 409 giả", async () => {
    // Lỗi cũ: chốt so `JSON.stringify(sanitizeHnTables(...))` hai vế. Payload client KHÔNG BAO GIỜ
    // có `paidProof` (presentQuote cắt) còn CSDL thì có, và hàng thiếu `rid` được sinh UUID MỚI ở
    // mỗi lần sanitize → hai chuỗi luôn khác → 409 VĨNH VIỄN, chủ không lưu nổi báo giá nữa.
    const chu = await dangNhap(chuU);
    await prisma.quote.update({ where: { id: quoteId }, data: {
      status: "draft",   // bài trước đã mark-converted; canEdit chặn theo trạng thái, không phải thứ đang đo
      hnStatus: "approved",
      hnTables: [{ name: "HN đã chốt", templateId, groupSubtotal: true, items: [
        { kind: "item", name: "Có ảnh", quantity: 1, unitPrice: 100, rid: "co-rid", paid: true, paidProof: "data:image/png;base64,AAAA" },
        { kind: "item", name: "Hàng cũ thiếu rid", quantity: 2, unitPrice: 50 },
      ] }],
    } });
    // Tài khoản KHÔNG có quote:hn:manage mới là ca bị gác — chuU là admin nên mượn phuU.
    const phuU = await prisma.user.create({ data: {
      username: `${TAG}-nochot`, displayName: `${TAG} nochot`, role: "manager",
      passwordHash: (await prisma.user.findFirst({ where: { id: chuU.id }, select: { passwordHash: true } })).passwordHash,
      permissions: [P.QUOTE_READ_OWN, P.QUOTE_UPDATE_OWN],
    } });
    expect((await chu.put(`/api/quotes/${quoteId}/members`).send({ members: [{ userId: phuU.id, scopes: ["main", "hcm", "hanoi", "khach"] }] })).status).toBe(200);

    const phu = agentWithCsrf(app);
    expect((await phu.post("/api/auth/login").send({ username: phuU.username, password: PWD })).status).toBe(200);
    const q = (await phu.get(`/api/quotes/${quoteId}`)).body;
    // Round-trip NGUYÊN VẸN những gì client nhận được — đúng thứ trình soạn gửi lên khi bấm Lưu.
    const r = await phu.put(`/api/quotes/${quoteId}`).send({ ...nhuClient(q), hnTables: q.hnTables, baseUpdatedAt: q.updatedAt });
    expect(r.status, JSON.stringify(r.body)).toBe(200);

    await prisma.quote.update({ where: { id: quoteId }, data: { hnStatus: null } });
    await prisma.quoteMember.deleteMany({ where: { userId: phuU.id } });
    await prisma.user.delete({ where: { id: phuU.id } }).catch(() => {});
  });

  it("TẠO báo giá mới kèm phần Hà Nội → không bị cắt mất", async () => {
    const chu = await dangNhap(chuU);
    const r = await chu.post("/api/quotes").send({
      title: `${TAG} bg co HN`, companyId, toCompany: "Khách", vatPercent: 8,
      sheets: [{ name: "T1", order: 0, templateId, items: [{ kind: "item", name: "x", quantity: 1, unitPrice: 1, order: 0 }] }],
      hnTables: [{ name: "HN ngay khi tạo", templateId, items: [{ kind: "item", name: "Nhân công", quantity: 1, unitPrice: 900 }] }],
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const q = (await chu.get(`/api/quotes/${r.body.id}`)).body;
    expect(q.hnTables.map((t) => t.name)).toEqual(["HN ngay khi tạo"]);
  });

  it("NHÂN BẢN mang theo phần Hà Nội, nhưng bỏ cờ đã-duyệt/đã-trả và ảnh chứng từ", async () => {
    const chu = await dangNhap(chuU);
    await prisma.quote.update({ where: { id: quoteId }, data: {
      hnTables: [{ name: "HN gốc", templateId, items: [{ kind: "item", name: "Thuê xe", quantity: 1, unitPrice: 700, rid: "r-dup", paid: true, paidAt: "2026-08-01T00:00:00Z", paidProof: "data:image/png;base64,AAAA", approved: true }] }],
    } });
    const r = await chu.post(`/api/quotes/${quoteId}/duplicate`).send({});
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const ban = await prisma.quote.findFirst({ where: { id: r.body.id }, select: { hnTables: true } });
    expect(ban.hnTables, "bản sao phải có phần HN").toHaveLength(1);
    const hang = ban.hnTables[0].items[0];
    expect(hang.name).toBe("Thuê xe");
    expect(hang.paid, "bản sao là báo giá MỚI — chưa ai trả tiền").toBeFalsy();
    expect(hang.paidProof, "không chép ảnh uỷ nhiệm chi sang báo giá khác").toBeFalsy();
    expect(hang.approved, "chưa ai duyệt").toBeFalsy();
    await prisma.quote.deleteMany({ where: { id: r.body.id }, hardDelete: true }).catch(() => {});
  });

  it("tab CŨ gửi bảng hanoi lồng trong sheets → vẫn lưu được phần chính, bảng lạc bị LOẠI", async () => {
    // Trước khi vá: zod enum bỏ "hanoi" nên CẢ request 400 — người dùng mất luôn phần báo giá
    // chính vừa sửa vì một bảng nội bộ họ không hề đụng tới.
    const chu = await dangNhap(chuU);
    const q = (await chu.get(`/api/quotes/${quoteId}`)).body;
    const sheet = JSON.parse(JSON.stringify(q.sheets[0]));
    sheet.extraTables = [...(sheet.extraTables || []), { category: "hanoi", name: "Bảng lạc của tab cũ", items: [] }];
    const r = await chu.put(`/api/quotes/${quoteId}`).send({ ...nhuClient(q), sheets: [sheet], notes: "tab cu luu duoc", baseUpdatedAt: q.updatedAt });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const sau = (await chu.get(`/api/quotes/${quoteId}`)).body;
    expect(sau.notes).toBe("tab cu luu duoc");
    expect((sau.sheets[0].extraTables || []).some((t) => t.category === "hanoi"), "bảng lạc không được ghi vào trang").toBe(false);
  });

  it("EXPAND-ONLY: bản cũ còn trong trang KHÔNG làm phần HN bị đếm hai lần", async () => {
    // Đây là hình dạng CSDL production ngay sau deploy: migration chép bảng HN sang
    // `Quote.hnTables` nhưng CỐ Ý chưa xoá bản cũ khỏi `QuoteSheet.extraTables` (để lùi ảnh còn an
    // toàn). Mọi chỗ đọc "mọi loại bảng" của trang phải bỏ qua category 'hanoi', nếu không người
    // xem nội bộ thấy phần HN hai lần và số hàng/số tiền nội bộ nhân đôi.
    const chu = await dangNhap(chuU);
    const q0 = await docChu();
    const sheetId = q0.sheets[0].id;
    const banCu = { category: "hanoi", name: "HN bản cũ còn sót", templateId, items: [{ kind: "item", rid: "cu-1", name: "Thuê xe", quantity: 1, unitPrice: 700 }] };
    const ex = Array.isArray(q0.sheets[0].extraTables) ? q0.sheets[0].extraTables : [];
    await prisma.quoteSheet.update({ where: { id: sheetId }, data: { extraTables: [...ex, banCu] } });
    await prisma.quote.update({ where: { id: quoteId }, data: {
      status: "draft", hnStatus: null,
      hnTables: [{ name: "HN bản mới", templateId, items: [{ kind: "item", rid: "moi-1", name: "Thuê xe", quantity: 1, unitPrice: 700 }] }],
    } });

    // Người xem nội bộ: thấy ĐÚNG MỘT bảng Hà Nội.
    const q = await docChu();
    const tuTrang = (q.sheets[0].extraTables || []).filter((t) => t.category === "hanoi");
    expect(tuTrang, "bản cũ vẫn nằm trong CSDL — chủ báo giá đọc bản đầy đủ nên vẫn thấy").toHaveLength(1);
    expect(q.hnTables).toHaveLength(1);

    const { presentQuote, presentQuoteRow } = await import("../src/quoteUtils.js");
    const tho = await prisma.quote.findFirst({ where: { id: quoteId }, include: { sheets: true } });
    const noiBo = presentQuote({ ...tho, hnTables: tho.hnTables }, { internalOnly: true });
    const bangHanoiTrongInternalSheets = (noiBo.internalSheets || []).flatMap((x) => x.tables || []).filter((t) => t?.category === "hanoi");
    expect(bangHanoiTrongInternalSheets, "bản cũ phải bị lược khỏi màn nội bộ").toHaveLength(0);
    expect(noiBo.hnTables, "phần HN đến từ cột mới").toHaveLength(1);

    const dong = presentQuoteRow({ ...tho, hnTables: tho.hnTables, _count: { sheets: tho.sheets.length } }, { internalOnly: true });
    // Báo giá nền có 1 hàng HCM + 1 hàng HN (bản mới) = 2. Nếu bản cũ còn sót bị đếm nữa thì ra 3
    // — đó đúng là thứ bài này canh.
    expect(dong.internalRows, "1 hàng HCM + 1 hàng HN, KHÔNG được thành 3").toBe(2);

    await prisma.quoteSheet.update({ where: { id: sheetId }, data: { extraTables: ex } });
  });

  it("đã gửi duyệt thì account HN không sửa nữa; chủ cũng không ghi đè qua đường lưu báo giá", async () => {
    // Các bài phía trên có đổi hnStatus (approved → null) để đo chốt khác — đưa về "assigned" cho
    // đúng tiền đề của bài này thay vì phụ thuộc thứ tự chạy.
    await prisma.quote.update({ where: { id: quoteId }, data: { hnStatus: "assigned", hnAssigneeId: hnU.id, status: "draft" } });
    const hn = await dangNhap(hnU);
    expect((await hn.post(`/api/quotes/${quoteId}/hn/submit`)).status).toBe(200);

    const qHn = await docHn();
    expect((await hn.put(`/api/quotes/${quoteId}/hn`).send({ baseUpdatedAt: qHn.updatedAt, hnTables: [] })).status).toBe(400);

    // Chủ là admin (có quote:hn:manage) nên VẪN sửa được — đó là người duyệt. Lấy một tài khoản
    // không có quyền đó thì mới là ca bị chặn; ca đó đã được chốt ở tests/quote-member-scopes.
    const chu = await dangNhap(chuU);
    const q = await docChu();
    const r = await chu.put(`/api/quotes/${quoteId}`).send({ ...nhuClient(q), baseUpdatedAt: q.updatedAt, hnTables: [{ name: "Quản lý sửa", items: [] }] });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect((await docChu()).hnTables.map((t) => t.name)).toEqual(["Quản lý sửa"]);
  });
});
