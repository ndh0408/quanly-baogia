// LƯU BÁO GIÁ KHÔNG ĐƯỢC LÀM MẤT KHOẢN CHI CỦA KẾ TOÁN (chủ repo 2026-10-06: "cái thanh toán bên đó là cho kế toán,
// không nằm trong kia nữa"). Việc tích "ĐÃ CHI" + ảnh chứng từ nay nằm ở trang Hóa đơn đầu vào, ghi vào bảng RIÊNG
// InputInvoiceEntry / InputInvoiceProof (src/services/inputInvoiceService.ts). Màn soạn báo giá không còn cột thanh
// toán — tức người soạn KHÔNG nhìn thấy hàng nào đã chi. Bài này khoá phía ĐƯỜNG LƯU của thoả thuận đó:
//
//   KT-2  Bốn cờ cũ `paid/paidAt/paidById/paidProof` trong JSON hàng ĐÓNG BĂNG: payload không đổi được chúng với BẤT
//         KỲ ai (kể cả admin), hàng mới luôn chưa chi — cả lúc TẠO báo giá (lỗ cũ: hnTables giả cờ lúc POST).
//   KT-4  Hàng hiệu lực ĐÃ CHI không biến mất được qua đường Lưu — xoá dòng, xoá bảng, xoá trang, client cũ gửi
//         `extraTables: []`, account phụ, account Hà Nội, người duyệt phần HN — và báo giá chứa nó không xoá mềm được.
//         Vi phạm → 400 (KHÔNG 409: ở màn soạn 409 mở hộp "người khác vừa lưu" và gợi ý tải lại, mất phần đang soạn)
//         kèm câu báo nêu TÊN hàng; CSDL không đổi một byte.
//   KT-3  "Đã chi" là trạng thái HIỆU LỰC: khoản (nếu có) thắng cờ JSON cũ — kế toán bỏ tích thì hàng JSON cũ
//         `paid:true` xoá được, báo giá xoá mềm được; khoản đã tích mà JSON không có cờ thì vẫn khoá.
//   KT-6  rid duy nhất trong (báo giá, phía): payload có hai hàng cùng rid → hàng sau nhận rid MỚI.
//   KT-7  Dọn rác bỏ qua báo giá còn khoản (FK RESTRICT là lưới thứ hai).
//   KT-8  Ghi kế toán không bump Quote.updatedAt — người đang soạn Lưu tiếp không ăn 409.
//
// ── HAI KHỐI ──────────────────────────────────────────────────────────────────────────────────────────
// KHỐI A KHÔNG cần bảng mới: dữ liệu "đã trả" là cờ JSON CŨ (gieo thẳng bằng Prisma, đúng hình dạng dữ liệu
// production trước ngày chuyển). Khối này chạy được trên mã CŨ (commit nền c44ae9a) và ĐỎ ở đó vì đúng lý do: mã cũ
// trả 200 rồi xoá im cờ đã trả (reconcileExtraPayments chỉ kế thừa theo rid hàng CÒN trong payload), tôn trọng cờ
// admin gửi lên (nhánh canPay), giữ nguyên cờ HN giả lúc tạo, không tách rid trùng, và xoá mềm không kiểm gì. Vì
// thế mọi chỗ khối A / afterAll đụng `prisma.inputInvoiceEntry` / `inputInvoiceProof` đều viết phòng thủ (`?.`).
// KHỐI B cần bảng: khoản do kế toán tích qua đúng route của trang Hóa đơn đầu vào.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { agentWithCsrf } from "./helpers/agent.js";
import bcrypt from "bcryptjs";
import { prisma } from "../src/db.js";
import { purgeSoftDeleted } from "../src/services/adminService.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "Quote" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");

const TAG = `hddvluu${Date.now()}`;
const PWD = "Test1234!a";
const PREFIX = `L${`${Date.now()}`.slice(-6)}`;   // bộ đếm số báo giá RIÊNG của lần chạy này (Nhân bản cấp số) — dọn được
// Ảnh PNG 1×1 THẬT: qua regex của zod, giải base64 được và đúng magic bytes (sniffImage).
const ANH = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const PAID_AT = "2026-09-01T03:00:00.000Z";

describe.runIf(dbAvailable)("Lưu báo giá không làm mất khoản chi của kế toán", () => {
  let app, companyId, templateId;
  let adminU, ketoanU, managerU, phuU, phuMainU, hnU;
  let admin, ketoan, manager, phu, phuMain, hn;

  const taoNguoi = (ten, role, permissions) => bcrypt.hash(PWD, 4).then((passwordHash) => prisma.user.create({
    data: { username: `${TAG}-${ten}`, displayName: `${TAG} ${ten}`, role, passwordHash, ...(permissions ? { permissions } : {}) },
  }));
  const dangNhap = async (u) => {
    const a = agentWithCsrf(app);
    expect((await a.post("/api/auth/login").send({ username: u.username, password: PWD })).status).toBe(200);
    return a;
  };

  /** Một hàng bảng nội bộ ĐÃ DUYỆT (khoản chi), chưa chi. */
  const hang = (rid, name, over = {}) => ({
    kind: "item", rid, name, quantity: 1, unitPrice: 1000,
    approved: true, approvedAt: "2026-09-20T03:00:00.000Z", approvedBy: adminU.id,
    paid: false, paidAt: null, paidById: null, paidProof: null, ...over,
  });
  /** Cờ "ĐÃ TRẢ" kiểu JSON CŨ (trước 2026-10-06 route /pay ghi thẳng vào hàng) — kèm ảnh chứng từ base64. */
  const daTraCu = (over = {}) => ({ paid: true, paidAt: PAID_AT, paidById: adminU.id, paidProof: ANH, ...over });
  const bang = (category, items, over = {}) => ({ category, name: category === "khach" ? "Phí khách hàng" : "Chi phí HCM", templateId: null, groupSubtotal: false, items, ...over });
  const bangHn = (items, over = {}) => ({ name: "Giá HN", templateId: null, groupSubtotal: false, items, ...over });

  /** Báo giá dựng THẲNG bằng Prisma — chạy y hệt trên mã cũ và mã mới. `trang` = danh sách `extraTables` từng trang. */
  const taoBaoGia = (ten, { chuId = adminU.id, trang = [[]], hnTables, hnStatus = null, hnAssigneeId = null, members = [], status = "draft" } = {}) =>
    prisma.quote.create({ data: {
      quoteNumber: `${TAG}-${ten}`, projectCode: `${TAG}_${ten}`, title: `${TAG} ${ten}`, searchText: TAG, toCompany: "Khách thử", companyId,
      fromContact: "x", fromAddress: "x", city: "TP. Hồ Chí Minh", quoteDate: new Date(), createdById: chuId, status,
      hnStatus, hnAssigneeId, ...(hnTables ? { hnTables } : {}),
      ...(members.length ? { members: { create: members } } : {}),
      sheets: { create: trang.map((extraTables, i) => ({
        templateId, order: i + 1, name: `Trang ${i + 1}`, codeNo: i + 1, extraTables,
        items: { create: [{ order: 1, kind: "item", name: "Hạng mục", quantity: 1, unitPrice: 10000 }] },
      })) },
    } });

  /** Báo giá như CSDL đang giữ (kể cả đã xoá mềm) — Lưu = xoá trang rồi tạo lại nên phải đọc lại sau mỗi lần Lưu. */
  const tai = (id) => prisma.quote.findFirst({
    where: { id }, includeDeleted: true,
    include: { sheets: { orderBy: [{ order: "asc" }, { id: "asc" }], include: { items: { orderBy: { order: "asc" } } } } },
  });
  /** Thân PUT /:id y như màn soạn gửi: mọi trang (kèm id), lưới chính, bảng nội bộ round-trip, mốc khoá lạc quan. */
  const thanLuu = (q) => ({
    baseUpdatedAt: q.updatedAt.toISOString(),
    sheets: q.sheets.map((s) => ({
      id: s.id, templateId: s.templateId, name: s.name, order: s.order,
      items: s.items.map((it) => ({ kind: it.kind, name: it.name, quantity: Number(it.quantity), unitPrice: Number(it.unitPrice), order: it.order })),
      extraTables: structuredClone(Array.isArray(s.extraTables) ? s.extraTables : []),
    })),
  });
  const bangSheet = (q) => q.sheets.flatMap((s) => (Array.isArray(s.extraTables) ? s.extraTables : []));
  const timHang = (tables, rid) => (Array.isArray(tables) ? tables : []).flatMap((t) => t?.items || []).filter((it) => it?.rid === rid);
  /** Ảnh chụp những gì một lần Lưu bị từ chối KHÔNG được đụng tới. */
  const anhChup = async (id) => {
    const q = await tai(id);
    return {
      updatedAt: q.updatedAt.getTime(), deletedAt: q.deletedAt, hnTables: q.hnTables,
      sheets: q.sheets.map((s) => ({ id: s.id, extraTables: s.extraTables })),
      soPhienBan: await prisma.quoteVersion.count({ where: { quoteId: id } }),
    };
  };
  const tichKhoan = (qid, side, rid, body) => ketoan.put(`/api/quotes/input-invoices/${qid}/${side}/${encodeURIComponent(rid)}`).send(body);
  const khoan = (qid, side, rid) => prisma.inputInvoiceEntry.findUnique({ where: { quoteId_side_rid: { quoteId: qid, side, rid } } });
  const dongDauVao = async (qid, side, rid) => {
    const r = await ketoan.get("/api/quotes/input-invoices");
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return r.body.data.find((d) => d.key === `${qid}:${side}:${rid}`);
  };
  /** 400 đúng hợp đồng KT-4: mã máy đọc được + câu báo nêu tên hàng. */
  const ky400HangDaChi = (r, ...tenHang) => {
    expect(r.status, JSON.stringify(r.body)).toBe(400);
    expect(r.body.code).toBe("hang-da-chi");
    for (const ten of tenHang) expect(r.body.error, "câu báo phải nêu tên hàng đã chi").toContain(ten);
  };

  beforeAll(async () => {
    const { createApp } = await import("../src/app.js");
    app = createApp();
    adminU = await taoNguoi("admin", "admin");
    ketoanU = await taoNguoi("ketoan", "accountant");
    managerU = await taoNguoi("manager", "manager");
    phuU = await taoNguoi("phu", "manager");          // account phụ chỉ được giao "Chi phí HCM"
    phuMainU = await taoNguoi("phumain", "manager");  // account phụ có "Báo giá chính" + "Chi phí HCM", KHÔNG có "Phí KH"
    hnU = await taoNguoi("hn", "account_hn");
    companyId = (await prisma.company.create({ data: { code: `${TAG}CO`, name: "Cty thử", address: "1 Thử", quotePrefix: PREFIX } })).id;
    templateId = (await prisma.quoteTemplate.create({ data: { companyId, name: "Mẫu thử", code: `${TAG}k`, filePath: "templates/GN_KhongNgay.xlsx" } })).id;
    admin = await dangNhap(adminU);
    ketoan = await dangNhap(ketoanU);
    manager = await dangNhap(managerU);
    phu = await dangNhap(phuU);
    phuMain = await dangNhap(phuMainU);
    hn = await dangNhap(hnU);
  });

  afterAll(async () => {
    const qs = await prisma.quote.findMany({ where: { title: { startsWith: TAG } }, select: { id: true }, includeDeleted: true }).catch(() => []);
    const ids = qs.map((q) => q.id);
    // Khoản kế toán RESTRICT báo giá (KT-7): dọn ảnh → khoản TRƯỚC khi xoá cứng báo giá. Phòng thủ: mã cũ không có bảng.
    await prisma.inputInvoiceProof?.deleteMany({ where: { entry: { quoteId: { in: ids } } } }).catch(() => {});
    await prisma.inputInvoiceEntry?.deleteMany({ where: { quoteId: { in: ids } } }).catch(() => {});
    await prisma.quote.deleteMany({ where: { id: { in: ids } }, hardDelete: true, includeDeleted: true }).catch(() => {});
    await prisma.quoteTemplate.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.company.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.quoteCounter.deleteMany({ where: { prefix: PREFIX } }).catch(() => {});
    const uids = [adminU, ketoanU, managerU, phuU, phuMainU, hnU].filter(Boolean).map((u) => u.id);
    await prisma.auditEvent.deleteMany({ where: { actorId: { in: uids } } }).catch(() => {});
    await prisma.loginAttempt.deleteMany({ where: { username: { startsWith: TAG } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
  });

  // ═════════════════════════ KHỐI A — cờ "đã trả" JSON CŨ, không cần bảng mới ═════════════════════════
  describe("Khối A — cờ đã trả JSON cũ (chạy được trên mã cũ)", () => {
    it("xoá DÒNG đã trả qua PUT /:id → 400 'hang-da-chi' nêu tên hàng, CSDL không đổi (mã cũ: 200 và mất cờ)", async () => {
      const q0 = await taoBaoGia("a-xoa-dong", { trang: [[bang("hcm", [hang("giu", "Thuê xe"), hang("tra", "Thuê kho", daTraCu())])]] });
      const q = await tai(q0.id);
      const truoc = await anhChup(q.id);
      const than = thanLuu(q);
      than.sheets[0].extraTables[0].items = than.sheets[0].extraTables[0].items.filter((it) => it.rid !== "tra");
      ky400HangDaChi(await admin.put(`/api/quotes/${q.id}`).send(than), "Thuê kho");
      expect(await anhChup(q.id), "400 ném ra TRƯỚC mọi lệnh ghi — không xoá trang, không bump mốc, không sinh phiên bản").toEqual(truoc);
    });

    it("xoá cả BẢNG chứa hàng đã trả → 400, CSDL không đổi", async () => {
      const q0 = await taoBaoGia("a-xoa-bang", { trang: [[bang("hcm", [hang("tra", "Màn LED", daTraCu())]), bang("khach", [hang("k1", "Phí ship")])]] });
      const q = await tai(q0.id);
      const truoc = await anhChup(q.id);
      const than = thanLuu(q);
      than.sheets[0].extraTables = than.sheets[0].extraTables.filter((t) => t.category !== "hcm");
      ky400HangDaChi(await admin.put(`/api/quotes/${q.id}`).send(than), "Màn LED");
      expect(await anhChup(q.id)).toEqual(truoc);
    });

    it("xoá cả TRANG chứa hàng đã trả → 400, CSDL không đổi (trang còn nguyên, id trang không đổi)", async () => {
      const q0 = await taoBaoGia("a-xoa-trang", { trang: [[bang("hcm", [hang("h1", "In ấn")])], [bang("khach", [hang("tra", "Thuê âm thanh", daTraCu())])]] });
      const q = await tai(q0.id);
      const truoc = await anhChup(q.id);
      const than = thanLuu(q);
      than.sheets = [than.sheets[0]];
      ky400HangDaChi(await admin.put(`/api/quotes/${q.id}`).send(than), "Thuê âm thanh");
      expect(await anhChup(q.id)).toEqual(truoc);
    });

    it("client cũ gửi trang THIẾU khoá extraTables (zod mặc định []) → 400, không xoá trắng bảng nội bộ", async () => {
      const q0 = await taoBaoGia("a-thieu-extra", { trang: [[bang("hcm", [hang("tra", "Thuê sân khấu", daTraCu()), hang("h2", "Nước uống")])]] });
      const q = await tai(q0.id);
      const truoc = await anhChup(q.id);
      const than = thanLuu(q);
      delete than.sheets[0].extraTables;
      ky400HangDaChi(await admin.put(`/api/quotes/${q.id}`).send(than), "Thuê sân khấu");
      expect(await anhChup(q.id)).toEqual(truoc);
    });

    it("account phụ chỉ có vùng 'Chi phí HCM' (đường ghiVungNoiBoDuocGiao) xoá hàng đã trả → 400, CSDL không đổi", async () => {
      const q0 = await taoBaoGia("a-phu", {
        trang: [[bang("hcm", [hang("giu", "Thuê xe"), hang("tra", "Bàn ghế", daTraCu())]), bang("khach", [hang("k1", "Phí ship")])]],
        members: [{ userId: phuU.id, scopes: ["hcm"] }],
      });
      const q = await tai(q0.id);
      const truoc = await anhChup(q.id);
      const than = thanLuu(q);
      than.sheets[0].extraTables = than.sheets[0].extraTables.map((t) => (t.category === "hcm" ? { ...t, items: t.items.filter((it) => it.rid !== "tra") } : t));
      ky400HangDaChi(await phu.put(`/api/quotes/${q.id}`).send(than), "Bàn ghế");
      expect(await anhChup(q.id)).toEqual(truoc);
    });

    it("người duyệt phần HN (manager có quote:hn:manage) xoá hàng HN đã trả qua PUT /:id → 400 — cả khi gửi kèm trang lẫn chỉ gửi hnTables", async () => {
      const q0 = await taoBaoGia("a-hn-manager", {
        chuId: managerU.id, hnStatus: "approved",
        hnTables: [bangHn([hang("hn-giu", "Xe HN"), hang("hn-tra", "Khách sạn HN", daTraCu())])],
      });
      const q = await tai(q0.id);
      const truoc = await anhChup(q.id);
      const hnConLai = [bangHn([hang("hn-giu", "Xe HN")])];
      // (1) Như màn soạn: trang + bảng HN — nhánh có `sheets` của updateQuote.
      ky400HangDaChi(await manager.put(`/api/quotes/${q.id}`).send({ ...thanLuu(q), hnTables: hnConLai }), "Khách sạn HN");
      // (2) Chỉ bảng HN — nhánh không có `sheets`.
      ky400HangDaChi(await manager.put(`/api/quotes/${q.id}`).send({ baseUpdatedAt: q.updatedAt.toISOString(), hnTables: hnConLai }), "Khách sạn HN");
      expect(await anhChup(q.id)).toEqual(truoc);
    });

    it("account Hà Nội được giao xoá hàng HN đã trả qua PUT /:id/hn → 400, CSDL không đổi", async () => {
      // Phần HN đã duyệt + đã trả rồi được GIAO LẠI (assigned) — luồng không bị chặn, nên account HN lại sửa được bảng.
      const q0 = await taoBaoGia("a-hn-account", {
        hnStatus: "assigned", hnAssigneeId: hnU.id, members: [{ userId: hnU.id, scopes: ["hanoi"] }],
        hnTables: [bangHn([hang("hn-giu", "Xe HN"), hang("hn-tra", "Vé máy bay", daTraCu())])],
      });
      const truoc = await anhChup(q0.id);
      ky400HangDaChi(await hn.put(`/api/quotes/${q0.id}/hn`).send({ hnTables: [bangHn([hang("hn-giu", "Xe HN")])] }), "Vé máy bay");
      expect(await anhChup(q0.id)).toEqual(truoc);
    });

    it("admin gửi paid:true cho hàng chưa trả / paid:false cho hàng đã trả / hàng mới mang cờ → cờ JSON KHÔNG đổi (mã cũ tôn trọng payload)", async () => {
      const q0 = await taoBaoGia("a-dong-bang", { trang: [[bang("hcm", [hang("tra", "Đèn", daTraCu()), hang("chua", "Loa")])]] });
      const q = await tai(q0.id);
      const than = thanLuu(q);
      than.sheets[0].extraTables[0].items = [
        { ...hang("tra", "Đèn"), paid: false, paidAt: null, paidById: null },
        { ...hang("chua", "Loa"), paid: true, paidAt: "2026-01-01T00:00:00.000Z", paidById: adminU.id },
        { kind: "item", name: "Hàng mới", quantity: 1, unitPrice: 500, approved: true, paid: true, paidAt: "2026-01-01T00:00:00.000Z", paidById: adminU.id },
      ];
      const r = await admin.put(`/api/quotes/${q.id}`).send(than);
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      const sau = bangSheet(await tai(q.id));
      const [tra] = timHang(sau, "tra");
      expect(tra, "hàng đã trả giữ NGUYÊN cờ + ngày + người + ảnh").toMatchObject({ paid: true, paidAt: PAID_AT, paidById: adminU.id, paidProof: ANH });
      const [chua] = timHang(sau, "chua");
      expect(chua, "payload không tích được 'đã chi' — việc đó của kế toán").toMatchObject({ paid: false, paidAt: null, paidById: null });
      const moi = sau.flatMap((t) => t.items).find((it) => it.name === "Hàng mới");
      expect(moi).toMatchObject({ paid: false, paidAt: null, paidById: null, paidProof: null });
    });

    it("manager TẠO báo giá (POST) với hnTables mang cờ duyệt / đã trả giả → lưu thành CHƯA (mã cũ ghi nguyên trạng)", async () => {
      const r = await manager.post("/api/quotes").send({
        title: `${TAG} a-tao-hn`, companyId, toCompany: "Khách thử", vatPercent: 8,
        sheets: [{ name: "Trang 1", order: 1, templateId, items: [{ kind: "item", name: "Hạng mục", quantity: 1, unitPrice: 10_000, order: 1 }] }],
        hnTables: [bangHn([{ ...hang("hn-gia", "Xe HN tự duyệt"), ...daTraCu({ paidProof: undefined }) }])],
      });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      const q = await tai(r.body.id);
      const [it] = q.hnTables[0].items;
      expect(it, "manager không có quote:internal:approve, không ai đặt được 'đã chi' qua payload").toMatchObject({
        approved: false, approvedAt: null, approvedBy: null, paid: false, paidAt: null, paidById: null, paidProof: null,
      });
    });

    it("chốt chặn: 'Chuyển loại' hcm → khach một bảng có hàng đã trả (giữ rid) → 200, cờ đã trả + duyệt đi theo hàng", async () => {
      const q0 = await taoBaoGia("a-chuyen-loai", { chuId: managerU.id, trang: [[bang("hcm", [hang("tra", "Backdrop", daTraCu()), hang("h2", "Standee")])]] });
      const q = await tai(q0.id);
      const than = thanLuu(q);
      than.sheets[0].extraTables[0].category = "khach";   // đúng thao tác của nút "Chuyển loại" (web ExtraTables): chỉ đổi category
      const r = await manager.put(`/api/quotes/${q.id}`).send(than);
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      const sau = bangSheet(await tai(q.id));
      expect(sau.map((t) => t.category)).toEqual(["khach"]);
      expect(timHang(sau, "tra")[0]).toMatchObject({ paid: true, paidAt: PAID_AT, paidById: adminU.id, paidProof: ANH, approved: true });
    });

    it("payload có HAI hàng cùng rid → hàng SAU nhận rid MỚI (cả phía trang lẫn phía HN); hàng đầu giữ rid và cờ đã trả", async () => {
      const q0 = await taoBaoGia("a-rid-trung", {
        trang: [[bang("hcm", [hang("dup", "Thuê xe", daTraCu())])], [bang("khach", [hang("k1", "Phí ship")])]],
        hnTables: [bangHn([hang("hdup", "Xe HN", daTraCu())])],
      });
      const q = await tai(q0.id);
      const than = thanLuu(q);
      // Bản chép (dán / nhân bản bảng ở client cũ) mang NGUYÊN rid — ở trang KHÁC, bảng KHÁC loại: cùng một phía "sheet".
      than.sheets[1].extraTables[0].items.push({ ...hang("dup", "Thuê xe (bản chép)") });
      than.hnTables = [bangHn([hang("hdup", "Xe HN"), hang("hdup", "Xe HN (bản chép)")])];
      const r = await admin.put(`/api/quotes/${q.id}`).send(than);
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      const sau = await tai(q.id);
      const sheet = bangSheet(sau).flatMap((t) => t.items);
      expect(sheet.filter((it) => it.rid === "dup").map((it) => it.name), "rid duy nhất trong phía 'sheet'").toEqual(["Thuê xe"]);
      const chepSheet = sheet.find((it) => it.name === "Thuê xe (bản chép)");
      expect(chepSheet.rid).toMatch(/\S/);
      expect(chepSheet.rid).not.toBe("dup");
      expect(chepSheet.paid, "bản chép không ăn theo cờ đã trả").toBe(false);
      expect(timHang(bangSheet(sau), "dup")[0]).toMatchObject({ paid: true, paidAt: PAID_AT });
      const hnItems = sau.hnTables.flatMap((t) => t.items);
      expect(hnItems.filter((it) => it.rid === "hdup").map((it) => it.name)).toEqual(["Xe HN"]);
      const chepHn = hnItems.find((it) => it.name === "Xe HN (bản chép)");
      expect(chepHn.rid).toMatch(/\S/);
      expect(chepHn.rid).not.toBe("hdup");
      expect(chepHn.paid).toBe(false);
    });

    it("XOÁ MỀM báo giá có hàng JSON đã trả (trang hoặc HN) → 400 'bao-gia-co-khoan-da-chi', báo giá còn nguyên (mã cũ: 200)", async () => {
      const qSheet = await taoBaoGia("a-xoa-bg-sheet", { trang: [[bang("hcm", [hang("tra", "Thuê xe cẩu", daTraCu())])]] });
      const qHn = await taoBaoGia("a-xoa-bg-hn", { hnStatus: "approved", hnTables: [bangHn([hang("hn-tra", "Khách sạn HN", daTraCu())])] });
      for (const [q, ten] of [[qSheet, "Thuê xe cẩu"], [qHn, "Khách sạn HN"]]) {
        const r = await admin.delete(`/api/quotes/${q.id}`);
        expect(r.status, JSON.stringify(r.body)).toBe(400);
        expect(r.body.code).toBe("bao-gia-co-khoan-da-chi");
        expect(r.body.error).toContain(ten);
        expect((await tai(q.id)).deletedAt, "báo giá không được vào thùng rác (đường tới Dọn rác)").toBeNull();
      }
    });
  });

  // ═════════════════════════ KHỐI B — khoản ở bảng InputInvoiceEntry (kế toán tích qua route) ═════════════════════════
  describe("Khối B — khoản kế toán ở bảng riêng", () => {
    it("hàng có khoản ĐÃ CHI (JSON không có cờ) → xoá hàng 400; khoản và hàng còn nguyên", async () => {
      const q0 = await taoBaoGia("b-xoa-khoan", { trang: [[bang("hcm", [hang("r1", "Thuê nhà bạt"), hang("r2", "Bảo vệ")])]] });
      expect((await tichKhoan(q0.id, "sheet", "r1", { baseVersion: 0, paid: true, paidProof: ANH })).status).toBe(200);
      const e0 = await khoan(q0.id, "sheet", "r1");
      const q = await tai(q0.id);
      expect(timHang(bangSheet(q), "r1")[0].paid, "kế toán ghi bảng riêng — JSON hàng không đổi (KT-1)").toBe(false);
      const truoc = await anhChup(q.id);
      const than = thanLuu(q);
      than.sheets[0].extraTables[0].items = than.sheets[0].extraTables[0].items.filter((it) => it.rid !== "r1");
      ky400HangDaChi(await admin.put(`/api/quotes/${q.id}`).send(than), "Thuê nhà bạt");
      expect(await anhChup(q.id)).toEqual(truoc);
      expect(await khoan(q.id, "sheet", "r1")).toEqual(e0);
    });

    it("kế toán BỎ tích hàng JSON cũ đã trả → xoá hàng 200 VÀ xoá mềm báo giá 200 (khoản thắng cờ JSON đóng băng)", async () => {
      const qa = await taoBaoGia("b-bo-tich-xoa-hang", { trang: [[bang("hcm", [hang("tra", "Thuê xe đưa đón", daTraCu()), hang("h2", "Nước")])]] });
      const qb = await taoBaoGia("b-bo-tich-xoa-bg", { trang: [[bang("hcm", [hang("tra", "Thuê xe đưa đón", daTraCu())])]] });
      for (const q of [qa, qb]) {
        const r = await tichKhoan(q.id, "sheet", "tra", { baseVersion: 0, paid: false });
        expect(r.status, JSON.stringify(r.body)).toBe(200);
        expect(r.body.row.paid).toBe(false);
      }
      // (1) Xoá hàng: cờ JSON `paid:true` vẫn nằm đó (đóng băng) nhưng hàng HIỆU LỰC đã không còn chi.
      const q = await tai(qa.id);
      expect(timHang(bangSheet(q), "tra")[0].paid, "cờ JSON cũ đóng băng, không ai sửa").toBe(true);
      const than = thanLuu(q);
      than.sheets[0].extraTables[0].items = than.sheets[0].extraTables[0].items.filter((it) => it.rid !== "tra");
      const luu = await admin.put(`/api/quotes/${q.id}`).send(than);
      expect(luu.status, JSON.stringify(luu.body)).toBe(200);
      expect(timHang(bangSheet(await tai(q.id)), "tra")).toEqual([]);
      expect(await khoan(q.id, "sheet", "tra"), "đường Lưu không bao giờ xoá khoản (KT-1)").toMatchObject({ paid: false });
      // (2) Xoá mềm báo giá còn nguyên hàng JSON `paid:true`: chốt dùng trạng thái HIỆU LỰC, không dùng `@> paid:true`.
      const xoa = await admin.delete(`/api/quotes/${qb.id}`);
      expect(xoa.status, JSON.stringify(xoa.body)).toBe(200);
      expect((await tai(qb.id)).deletedAt).not.toBeNull();
    });

    it("hàng CHỈ có ghi chú kế toán bị xoá → 200, khoản còn, danh sách hiện dòng 'khong-con-hang' giữ ghi chú", async () => {
      const q0 = await taoBaoGia("b-ghi-chu", { trang: [[bang("hcm", [hang("gc", "Dựng sân khấu"), hang("h2", "Nước")])]] });
      expect((await tichKhoan(q0.id, "sheet", "gc", { baseVersion: 0, accountingNote: "Chờ HĐ đỏ", invoiceDate: "2026-10-05" })).status).toBe(200);
      const q = await tai(q0.id);
      const than = thanLuu(q);
      than.sheets[0].extraTables[0].items = than.sheets[0].extraTables[0].items.filter((it) => it.rid !== "gc");
      const r = await admin.put(`/api/quotes/${q.id}`).send(than);
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(await khoan(q.id, "sheet", "gc")).toMatchObject({ paid: false, accountingNote: "Chờ HĐ đỏ" });
      const d = await dongDauVao(q.id, "sheet", "gc");
      expect(d, "kế toán không mở được báo giá — khoản không được biến khỏi trang của họ").toBeTruthy();
      expect(d).toMatchObject({ trangThaiHang: "khong-con-hang", accountingNote: "Chờ HĐ đỏ", invoiceDate: "2026-10-05", name: "Dựng sân khấu" });
    });

    it("manager đổi tiền hàng HN ĐÃ CHI → 400; admin (có invoice:input:pay) đổi → 200 và danh sách báo tienDoi", async () => {
      // Hàng HN để cô lập đúng chốt TIỀN của khoản: hàng trang đã duyệt còn vướng chốt tiền của DUYỆT (chạy trước).
      const q0 = await taoBaoGia("b-doi-tien", {
        chuId: managerU.id, hnStatus: "approved",
        hnTables: [bangHn([hang("h1", "Thuê xe HN", { quantity: 2, unitPrice: 1500 }), hang("h2", "Ăn trưa HN")])],
      });
      expect((await tichKhoan(q0.id, "hn", "h1", { baseVersion: 0, paid: true })).status).toBe(200);
      const q = await tai(q0.id);
      const doiGia = (gia) => [bangHn([hang("h1", "Thuê xe HN", { quantity: 2, unitPrice: gia }), hang("h2", "Ăn trưa HN")])];
      const truoc = await anhChup(q.id);
      const r = await manager.put(`/api/quotes/${q.id}`).send({ ...thanLuu(q), hnTables: doiGia(9000) });
      expect(r.status, JSON.stringify(r.body)).toBe(400);
      expect(r.body.error).toMatch(/đã chi/);
      expect(r.body.error).toContain("Thuê xe HN");
      expect(await anhChup(q.id)).toEqual(truoc);
      const ok = await admin.put(`/api/quotes/${q.id}`).send({ ...thanLuu(q), hnTables: doiGia(2000) });
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      expect(timHang((await tai(q.id)).hnTables, "h1")[0].unitPrice).toBe(2000);
      expect(await dongDauVao(q.id, "hn", "h1")).toMatchObject({ paid: true, paidAmount: 3000, amount: 4000, tienDoi: true });
    });

    it("người duyệt BỎ duyệt hàng đã chi → 200, danh sách hiện 'chua-duyet'; manager đổi tiền hàng đó → 400 dù JSON không có cờ", async () => {
      const q0 = await taoBaoGia("b-bo-duyet", { chuId: managerU.id, trang: [[bang("hcm", [hang("r1", "Thuê máy phát"), hang("r2", "Xăng")])]] });
      expect((await tichKhoan(q0.id, "sheet", "r1", { baseVersion: 0, paid: true })).status).toBe(200);
      let q = await tai(q0.id);
      let than = thanLuu(q);
      than.sheets[0].extraTables[0].items[0].approved = false;
      const r = await admin.put(`/api/quotes/${q.id}`).send(than);
      expect(r.status, "bỏ duyệt KHÔNG bị chặn — kế toán vẫn thấy khoản ở nhóm 'Cần chú ý'").toBe(200);
      q = await tai(q.id);
      expect(timHang(bangSheet(q), "r1")[0]).toMatchObject({ approved: false, paid: false });
      expect(await khoan(q.id, "sheet", "r1")).toMatchObject({ paid: true });
      expect(await dongDauVao(q.id, "sheet", "r1")).toMatchObject({ trangThaiHang: "chua-duyet", paid: true });
      // Hàng giờ KHÔNG còn duyệt (chốt tiền của duyệt không áp) và JSON không có cờ `paid` — chỉ còn khoản giữ số tiền.
      const truoc = await anhChup(q.id);
      than = thanLuu(q);
      than.sheets[0].extraTables[0].items[0].unitPrice = 7777;
      const doi = await manager.put(`/api/quotes/${q.id}`).send(than);
      expect(doi.status, JSON.stringify(doi.body)).toBe(400);
      expect(doi.body.error).toMatch(/đã chi/);
      expect(await anhChup(q.id)).toEqual(truoc);
    });

    it("Nhân bản và Bản mới → báo giá mới 0 khoản, mọi cờ đã trả / rid cũ bị cắt; khoản của bản gốc nguyên vẹn", async () => {
      const q0 = await taoBaoGia("b-nhan-ban", {
        trang: [[bang("hcm", [hang("r1", "Thuê xe", daTraCu()), hang("r2", "In ấn")])]],
        hnStatus: "approved", hnTables: [bangHn([hang("h1", "Xe HN", daTraCu())])],
      });
      expect((await tichKhoan(q0.id, "sheet", "r2", { baseVersion: 0, paid: true, paidProof: ANH })).status).toBe(200);
      const goc = await prisma.inputInvoiceEntry.findMany({ where: { quoteId: q0.id }, orderBy: { id: "asc" } });
      for (const body of [{}, { sameProject: true }]) {
        const r = await admin.post(`/api/quotes/${q0.id}/duplicate`).send(body);
        expect(r.status, JSON.stringify(r.body)).toBe(201);
        expect(await prisma.inputInvoiceEntry.count({ where: { quoteId: r.body.id } }), "khoản không đi theo bản sao").toBe(0);
        const moi = await tai(r.body.id);
        const hangMoi = [...bangSheet(moi), ...(moi.hnTables || [])].flatMap((t) => t.items);
        expect(hangMoi).toHaveLength(3);
        for (const it of hangMoi) {
          expect(it.paid ?? false, JSON.stringify(it)).toBe(false);
          expect(it.paidProof ?? null).toBeNull();
          expect(["r1", "r2", "h1"]).not.toContain(it.rid);
        }
        const phanHoi = [...r.body.sheets.flatMap((s) => s.extraTables || []), ...(r.body.hnTables || [])].flatMap((t) => t.items);
        expect(phanHoi.every((it) => !it.paid && !it.hasPaidProof), "lớp phủ không mang trạng thái của bản gốc sang").toBe(true);
      }
      expect(await prisma.inputInvoiceEntry.findMany({ where: { quoteId: q0.id }, orderBy: { id: "asc" } })).toEqual(goc);
    });

    it("Dọn rác giữ lại báo giá đã xoá mềm còn khoản kế toán (không P2003 / 409), vẫn xoá báo giá không có khoản", async () => {
      const qCo = await taoBaoGia("b-don-rac-co", { trang: [[bang("hcm", [hang("r1", "Thuê kho")])]] });
      const qKhong = await taoBaoGia("b-don-rac-khong", { trang: [[bang("hcm", [hang("r1", "Thuê kho")])]] });
      // Khoản chỉ có ghi chú (chưa chi) → báo giá XOÁ MỀM được qua API → nằm trong thùng rác cùng khoản của nó.
      expect((await tichKhoan(qCo.id, "sheet", "r1", { baseVersion: 0, accountingNote: "HĐ số 12" })).status).toBe(200);
      for (const q of [qCo, qKhong]) expect((await admin.delete(`/api/quotes/${q.id}`)).status).toBe(200);
      // purgeSoftDeleted quét TOÀN BẢNG, không lọc theo bài test → mốc xoá CỰC XA (1850) và cutoff ≈ 1876, để không chạm
      // hàng xoá mềm của bài khác chạy song song — kể cả cửa sổ năm 1900 của b5-purge-audit-actor / db-purge-an-toan.
      // Gọi thẳng dịch vụ như hai bài đó: route POST /api/admin/purge-soft-deleted chặn days ≤ 3650 (cutoff ≥ 2016),
      // tức luôn quét qua cửa sổ 1900 kia.
      await prisma.$executeRaw`UPDATE "Quote" SET "deletedAt" = '1850-01-01T00:00:00Z' WHERE id IN (${qCo.id}, ${qKhong.id})`;
      const kq = await purgeSoftDeleted({ body: { days: 55_000 }, session: {}, ip: "127.0.0.1", headers: {} });
      expect(kq.result, "FK RESTRICT không được làm hỏng cả lượt dọn (P2003)").toBeTruthy();
      expect(await tai(qKhong.id), "báo giá không có khoản bị xoá cứng như cũ").toBeNull();
      expect(await tai(qCo.id), "báo giá còn khoản nằm lại thùng rác (KT-7)").toBeTruthy();
      expect(await khoan(qCo.id, "sheet", "r1")).toMatchObject({ accountingNote: "HĐ số 12" });
    });

    it("chốt chặn: Lưu nguyên vẹn sau lần tích (mốc màn soạn có TRƯỚC lần tích) → 200, khoản y nguyên; Quote.updatedAt chỉ đổi do chính lần Lưu", async () => {
      const q0 = await taoBaoGia("b-luu-nguyen", { trang: [[bang("hcm", [hang("r1", "Thuê LED"), hang("r2", "Nhân sự")])]] });
      const q = await tai(q0.id);   // màn soạn mở ở đây — mốc khoá lạc quan T0
      const r = await tichKhoan(q.id, "sheet", "r1", { baseVersion: 0, paid: true, paidProof: ANH, accountingNote: "Đã CK", invoiceDate: "2026-10-01" });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      const e0 = await khoan(q.id, "sheet", "r1");
      const soAnh0 = await prisma.inputInvoiceProof.count({ where: { entryId: e0.id } });
      expect((await tai(q.id)).updatedAt.getTime(), "ghi kế toán không bump Quote.updatedAt (KT-8)").toBe(q.updatedAt.getTime());
      const luu = await admin.put(`/api/quotes/${q.id}`).send(thanLuu(q));
      expect(luu.status, "màn soạn mở trước lần tích Lưu tiếp → KHÔNG 409").toBe(200);
      expect(await khoan(q.id, "sheet", "r1"), "đường Lưu chỉ ĐỌC khoản").toEqual(e0);
      expect(await prisma.inputInvoiceProof.count({ where: { entryId: e0.id } })).toBe(soAnh0);
      const sau = await tai(q.id);
      expect(sau.updatedAt.getTime(), "mốc đổi — do chính lần Lưu").toBeGreaterThan(q.updatedAt.getTime());
      expect(timHang(bangSheet(sau), "r1")[0].paid, "JSON hàng vẫn không có cờ — trạng thái nằm ở khoản").toBe(false);
      // Phản hồi của lần Lưu đi qua lớp phủ: màn soạn thấy trạng thái HIỆU LỰC (để chặn sớm xoá bảng / trang).
      const r1 = luu.body.sheets.flatMap((s) => s.extraTables || []).flatMap((t) => t.items).find((it) => it.rid === "r1");
      expect(r1).toMatchObject({ paid: true, hasPaidProof: true });
      expect(JSON.stringify(luu.body)).not.toContain("data:image");
    });

    // Account phụ đọc được rid của MỌI bảng (presentQuote trả đủ), nên chép được rid của một hàng NGOÀI phạm vi của họ sang
    // bảng của mình, đặt ở trang ĐỨNG TRƯỚC. Luật "hàng đầu giữ rid" của tachRidTrung khi đó đổi rid của chính hàng GỐC (mà
    // họ không được đụng) → khoản kế toán (khoá theo rid) dính sang hàng giả, hàng gốc thành "chưa chi" → kế toán chi lần
    // hai. Hai đường của account phụ: không có "Báo giá chính" (ghiVungNoiBoDuocGiao) và có (updateQuote + reconcilePhamViTables).
    for (const [ten, vung, agent] of [
      ["chỉ 'Chi phí HCM' (ghiVungNoiBoDuocGiao)", ["hcm"], () => phu],
      ["'Báo giá chính' + 'Chi phí HCM' (reconcilePhamViTables)", ["main", "hcm"], () => phuMain],
    ]) {
      it(`account phụ ${ten} chép rid của hàng NGOÀI phạm vi đã chi sang bảng của mình → hàng chép nhận rid mới; khoản và duyệt ở lại hàng gốc`, async () => {
        const nguoi = vung.includes("main") ? phuMainU : phuU;
        const q0 = await taoBaoGia(`b-phu-chep-${vung.length}`, {
          trang: [[bang("hcm", [hang("h1", "Thuê xe")])], [bang("khach", [hang("k1", "Phí ship", { unitPrice: 300 })])]],
          members: [{ userId: nguoi.id, scopes: vung }],
        });
        expect((await tichKhoan(q0.id, "sheet", "k1", { baseVersion: 0, paid: true })).status).toBe(200);
        const q = await tai(q0.id);
        const than = thanLuu(q);
        // Hàng chép: CÙNG rid, cùng số tiền (lọt chốt tiền), tự ghi `approved: true` — đặt ở trang 1, trước hàng gốc ở trang 2.
        than.sheets[0].extraTables[0].items.push(hang("k1", "Phí ship (chép)", { unitPrice: 300 }));
        const r = await agent().put(`/api/quotes/${q.id}`).send(than);
        expect(r.status, JSON.stringify(r.body).slice(0, 400)).toBe(200);
        const sau = await tai(q.id);
        const k1 = timHang(bangSheet(sau), "k1");
        expect(k1.map((it) => it.name), "rid 'k1' vẫn là của hàng gốc ngoài phạm vi, và DUY NHẤT trong phía (KT-6)").toEqual(["Phí ship"]);
        expect(k1[0]).toMatchObject({ approved: true, approvedBy: adminU.id });
        const chep = bangSheet(sau).flatMap((t) => t.items).find((it) => it.name === "Phí ship (chép)");
        expect(chep.rid).not.toBe("k1");
        expect(chep, "account phụ không tự duyệt được hàng chép, hàng chép không ăn theo trạng thái nào").toMatchObject({ approved: false, paid: false });
        expect(await dongDauVao(q.id, "sheet", "k1"), "khoản đã chi vẫn trỏ đúng hàng gốc").toMatchObject({ category: "khach", name: "Phí ship", trangThaiHang: "binh-thuong", paid: true });
      });
    }

    it("chốt chặn: hnRev (GET của account HN) KHÔNG đổi khi chỉ dữ liệu kế toán khác — account HN không ăn 409 oan", async () => {
      const q0 = await taoBaoGia("b-hnrev", {
        hnStatus: "approved", hnAssigneeId: hnU.id, members: [{ userId: hnU.id, scopes: ["hanoi"] }],
        hnTables: [bangHn([hang("h1", "Xe HN"), hang("h2", "Khách sạn HN")])],
      });
      const g0 = await hn.get(`/api/quotes/${q0.id}`);
      expect(g0.status, JSON.stringify(g0.body)).toBe(200);
      expect(g0.body.hnRev).toMatch(/^[0-9a-f]{32}$/);
      expect((await tichKhoan(q0.id, "hn", "h1", { baseVersion: 0, paid: true, paidProof: ANH, accountingNote: "CK ngày 5" })).status).toBe(200);
      const g1 = await hn.get(`/api/quotes/${q0.id}`);
      expect(g1.body.hnRev, "mốc 409 của phần HN chỉ tính phần người dùng gõ").toBe(g0.body.hnRev);
      expect(g1.body.updatedAt).toBe(g0.body.updatedAt);
      const h1 = g1.body.hnTables.flatMap((t) => t.items).find((it) => it.rid === "h1");
      expect(h1).toMatchObject({ paid: true, hasPaidProof: true });
      expect(JSON.stringify(g1.body), "account HN không thấy ảnh, không thấy ghi chú kế toán").not.toMatch(/data:image|CK ngày 5/);
    });
  });
});
