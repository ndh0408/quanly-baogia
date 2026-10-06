// KHOẢN CHI của trang Hóa đơn đầu vào — ghi qua `PUT /api/quotes/input-invoices/:quoteId/:side/:rid`, xem ảnh qua
// `GET …/proof` (src/services/inputInvoiceService.ts). Chủ repo 2026-10-06: "cái thanh toán bên đó là cho kế toán,
// không nằm trong kia nữa" — kế toán tích ĐÃ CHI + ảnh chứng từ (`invoice:input:pay`), ghi Ngày hóa đơn + Ghi chú kế
// toán (`invoice:edit`) ngay trên trang Hóa đơn đầu vào, vào bảng RIÊNG InputInvoiceEntry / InputInvoiceProof.
//
// ── BÀI NÀY KHOÁ GÌ (HTTP + CSDL thật) ───────────────────────────────────────────────────────────────
//   · AI ghi được — quyền THEO TRƯỜNG; tài khoản chi phí (từng tích ở màn soạn bằng quote:internal:pay) thôi tích;
//     kế toán vẫn KHÔNG mở được báo giá (phạm vi global chỉ cho đúng phần kế toán của hàng).
//   · Ghi KHÔNG đụng báo giá (KT-8): JSON hàng không đổi một byte, `Quote.updatedAt` (mốc khoá lạc quan của màn soạn)
//     và số QuoteVersion giữ nguyên — tích một ô không được đá văng người đang soạn.
//   · Hàng nào tích được (tập trang: đã duyệt theo hàng / HN đã duyệt cả phần) và MÃ LỖI máy đọc được cho từng ngõ
//     cụt — web dựa vào `code` để chọn câu báo và để nạp lại.
//   · Khoá lạc quan RIÊNG của khoản (`baseVersion` ↔ `version`).
//   · Ảnh CHỈ THÊM (KT-7): thay / gỡ / bỏ tích chỉ rút vào lịch sử; số dòng ảnh không bao giờ giảm.
//   · Phản hồi + nhật ký không bao giờ mang ảnh / tổng tiền / thông tin khách; realtime phát đúng MỘT lần sau commit,
//     không phát khi 4xx (helper `ghi` tự soát cả hai ở MỌI lượt PUT trong tệp).
//   · Lớp phủ (KT-3): màn soạn (admin) và màn chi phí thấy trạng thái theo KHOẢN; "Đã TT x/y" đếm theo khoản.
//   · Gieo khoản từ cờ JSON cũ ở lần ghi đầu; đọc ảnh dự phòng từ JSON cũ khi chưa có khoản.
//
// Đồng thời (FOR SHARE / FOR UPDATE, hai kế toán cùng một khoản chen nhau) ở tests/hddv-dong-thoi.test.js; đường Lưu
// báo giá không làm mất khoản ở tests/hddv-luu-khong-mat-khoan-chi.test.js.
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { createHash } from "node:crypto";
import { agentWithCsrf } from "./helpers/agent.js";
import { prisma } from "../src/db.js";
import { PERMISSIONS as P } from "../src/permissions.js";

// Chặn emitChange để đếm sự kiện realtime. db.ts cũng gọi nó (qua import() động) sau MỌI lần ghi Quote / User… nên chỉ
// đếm thực thể "inputInvoice" — thực thể mà dịch vụ kế toán phát tay một lần sau commit.
const h = vi.hoisted(() => ({ goi: [] }));
vi.mock("../src/sse.js", async (importOriginal) => ({
  ...(await importOriginal()),
  emitChange: (entity, action) => { h.goi.push({ entity, action }); },
}));

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "Quote" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");

const TAG = `hddvghi${Date.now()}`;
const PWD = "Test1234!a";
const PREFIX = `K${`${Date.now()}`.slice(-6)}`;   // bộ đếm số báo giá RIÊNG cho lần chạy này (POST /api/quotes), dọn được
const KHACH_BI_MAT = `${TAG} KHÁCH BÍ MẬT`;        // tên khách — không được lọt vào phản hồi của kế toán
const GHI_CHU_RIENG = `${TAG} ghi chú kế toán riêng`;

// PNG thật 1x1 — ca hợp lệ.
const ANH_THAT =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
// Byte JPEG (magic FF D8 FF) nhưng NHÃN ghi png: dịch vụ phải tin BYTE, không tin nhãn client gửi.
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.from("JFIF-anh-thu-hai")]);
const ANH_JPG_NHAN_PNG = `data:image/png;base64,${JPG.toString("base64")}`;
// Khớp TIỀN TỐ nhưng có đuôi rác thoát thuộc tính — trượt regex toàn chuỗi (400 ở zod).
const ANH_DUOI_RAC = `${ANH_THAT}" onerror="alert(1)`;
// Data-URL đúng cú pháp nhưng nội dung không phải ảnh — chỉ magic bytes mới bắt được (415).
const KHONG_PHAI_ANH = `data:image/png;base64,${Buffer.from("day khong phai anh chung tu").toString("base64")}`;
const byteCua = (dataUrl) => Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
const shaCua = (dataUrl) => createHash("sha256").update(byteCua(dataUrl)).digest("hex");

describe.runIf(dbAvailable)("Khoản chi (Hóa đơn đầu vào): PUT /api/quotes/input-invoices/:quoteId/:side/:rid + GET …/proof", () => {
  let app, companyId, templateId;
  let admin, ketoan, manager, nhanSu, hnU, chiPhi, chiXemDuAn, keToanSua;
  let qChinh, qQuyen, qHnCho, qXoa, qTrung, qBoDuyet, qTienDoi, qPhienBan, qAnh, qGhiChu, qJsonCu, qXemAnh;

  const phien = new Map();
  const dn = async (u) => {
    if (!phien.has(u.id)) {
      const a = agentWithCsrf(app);
      expect((await a.post("/api/auth/login").send({ username: u.username, password: PWD })).status).toBe(200);
      phien.set(u.id, a);
    }
    return phien.get(u.id);
  };
  const user = (ten, role, permissions) => bcrypt.hash(PWD, 4).then((passwordHash) => prisma.user.create({
    data: { username: `${TAG}-${ten}`, displayName: `${TAG} ${ten}`, role, passwordHash, ...(permissions ? { permissions } : {}) },
  }));
  const hang = (rid, name, over = {}) => ({ kind: "item", rid, name, quantity: 1, unitPrice: 100000, approved: true, approvedAt: "2026-09-20T03:00:00.000Z", approvedBy: null, ...over });
  const bangHcm = (...items) => ({ category: "hcm", name: "Chi phí HCM", items });
  /** Báo giá dựng THẲNG bằng Prisma (điều khiển được từng cờ JSON). `trang` = mảng extraTables của từng trang. */
  const baoGia = (ten, { trang = [[]], thanhVien = false, ...extra } = {}) => prisma.quote.create({ data: {
    quoteNumber: `${TAG}-${ten}`, projectCode: `${TAG}_${ten}`, title: `${TAG} ${ten}`, searchText: TAG, toCompany: KHACH_BI_MAT,
    companyId, fromContact: "x", fromAddress: "x", city: "TP. Hồ Chí Minh", quoteDate: new Date(), createdById: admin.id,
    sheets: { create: trang.map((extraTables, i) => ({ templateId, order: i + 1, name: `Trang ${i + 1}`, codeNo: i + 1, extraTables })) },
    ...(thanhVien ? { members: { create: [{ userId: chiPhi.id, scopes: ["main", "hcm", "hanoi", "khach"] }] } } : {}),
    ...extra,
  } });

  const duongDan = (qid, side, rid) => `/api/quotes/input-invoices/${qid}/${side}/${encodeURIComponent(rid)}`;
  const demPhat = () => h.goi.filter((g) => g.entity === "inputInvoice").length;
  /**
   * PUT một khoản. Mỗi lượt tự soát hai bất biến của MỌI phản hồi: realtime 'inputInvoice' phát đúng 1 lần khi 200 và
   * 0 lần khi lỗi (4xx không được làm mọi tab nạp lại); phản hồi 200 không mang ảnh, tổng tiền hay thông tin khách.
   */
  const ghi = async (agent, qid, side, rid, body) => {
    const truoc = demPhat();
    const r = await agent.put(duongDan(qid, side, rid)).send(body);
    const phat = demPhat() - truoc;
    expect(phat, `realtime phát ${phat} lần cho ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`).toBe(r.status === 200 ? 1 : 0);
    if (r.status === 200) {
      const txt = JSON.stringify(r.body);
      expect(txt, "phản hồi mang ảnh chứng từ").not.toContain("data:image");
      expect(txt, "phản hồi mang tiền / khách của báo giá").not.toMatch(/"total"|"subtotal"|"toCompany"|"customer/);
      expect(txt).not.toContain(KHACH_BI_MAT);
    }
    return r;
  };
  const xemAnh = (agent, qid, side, rid, proofId) => {
    const t = agent.get(`${duongDan(qid, side, rid)}/proof`);
    return proofId != null ? t.query({ proofId }) : t;
  };
  const khoan = (qid, side, rid) => prisma.inputInvoiceEntry.findUnique({ where: { quoteId_side_rid: { quoteId: qid, side, rid } } });
  const anhCua = (entryId) => prisma.inputInvoiceProof.findMany({ where: { entryId }, orderBy: { id: "asc" } });
  /** JSON hàng của báo giá (mọi trang + Hà Nội) + mốc khoá lạc quan + số phiên bản — để so "không đổi một byte". */
  const baoGiaTrongDb = async (qid) => {
    const q = await prisma.quote.findFirst({
      where: { id: qid }, includeDeleted: true,
      select: { updatedAt: true, hnTables: true, sheets: { orderBy: { id: "asc" }, select: { id: true, extraTables: true } } },
    });
    return {
      json: JSON.stringify([q.hnTables, q.sheets.map((s) => s.extraTables)]),
      updatedAt: q.updatedAt.getTime(),
      phienBan: await prisma.quoteVersion.count({ where: { quoteId: qid } }),
    };
  };
  /** Sửa JSON hàng trang ĐẦU thẳng ở CSDL (mô phỏng người soạn bỏ duyệt / xoá hàng sau khi khoản đã có). */
  const suaJsonTrangDau = async (qid, sua) => {
    const s = await prisma.quoteSheet.findFirst({ where: { quoteId: qid }, orderBy: { id: "asc" } });
    await prisma.quoteSheet.update({ where: { id: s.id }, data: { extraTables: sua(s.extraTables) } });
  };
  const nhatKyCuoi = (actorId, qid, action) => prisma.auditEvent.findFirst({
    where: { actorId, resource: "quote", resourceId: String(qid), ...(action ? { action } : {}) }, orderBy: { id: "desc" },
  });
  const khongChepAnh = (ev) => expect(JSON.stringify([ev?.before ?? null, ev?.after ?? null]), "nhật ký chép ảnh").not.toContain("data:image");

  beforeAll(async () => {
    app = (await import("../src/app.js")).createApp();
    admin = await user("admin", "admin");
    ketoan = await user("ketoan", "accountant");
    manager = await user("manager", "manager");
    nhanSu = await user("nhansu", "hr");
    hnU = await user("hn", "account_hn");
    // Tài khoản "chi phí" ĐÚNG như cấu hình thật: vai trò tối thiểu + 3 quyền riêng — từng tích được ở màn soạn.
    chiPhi = await user("chiphi", "hr", [P.QUOTE_READ_OWN, P.QUOTE_INTERNAL_VIEW, P.QUOTE_INTERNAL_PAY]);
    chiXemDuAn = await user("duan", "hr", [P.INVOICE_READ]);   // xem Quản lý dự án, KHÔNG phải trang Hoá đơn
    // Vào trang + sửa hoá đơn (ngày HĐ / ghi chú) nhưng KHÔNG có quyền tích ĐÃ CHI.
    keToanSua = await user("ktsua", "hr", [P.INVOICE_PAGE, P.INVOICE_EDIT]);
    companyId = (await prisma.company.create({ data: { code: `${TAG}CO`, name: "Cty thử", address: "1 Thử", quotePrefix: PREFIX } })).id;
    templateId = (await prisma.quoteTemplate.create({ data: { companyId, name: "Mẫu thử", code: `${TAG}k`, filePath: "templates/GN_KhongNgay.xlsx" } })).id;

    qChinh = await baoGia("chinh", {
      thanhVien: true,
      hnStatus: "approved", hnReviewedAt: new Date("2026-09-25T01:00:00Z"), hnReviewerId: admin.id,
      // Cờ duyệt TỪNG HÀNG HN không phải nguồn sự thật — phần HN đã duyệt (hnStatus) là đủ.
      hnTables: [{ name: "Giá HN", items: [hang("hn-1", "Thuê sàn", { quantity: 2, unitPrice: 2500000, approved: false })] }],
      trang: [[
        bangHcm(
          { kind: "section", name: "Nhóm A", quantity: 0, unitPrice: 0 },
          hang("r-hcm", "Thuê xe", { quantity: 2, unitPrice: 500000 }),
          hang("r-chua", "Chưa duyệt", { approved: false }),
          hang("r-info", "Dòng thông tin", { kind: "info" }),
        ),
        { category: "khach", name: "Phí khách hàng", items: [hang("r-kh", "Phí ship", { unitPrice: 300000 }), hang("r-ad", "Phí bốc xếp", { unitPrice: 200000 })] },
      ]],
    });
    qQuyen = await baoGia("quyen", { thanhVien: true, trang: [[bangHcm(hang("q-1", "Hàng quyền 1"), hang("q-2", "Hàng quyền 2"))]] });
    qHnCho = await baoGia("hncho", { hnStatus: "submitted", hnTables: [{ name: "HN chờ", items: [hang("hc-1", "Chờ duyệt HN")] }] });
    qXoa = await baoGia("xoa", { trang: [[bangHcm(hang("x-1", "Báo giá đã xoá"))]] });
    await prisma.quote.delete({ where: { id: qXoa.id } });   // xoá MỀM
    // rid TRÙNG trong phía "sheet" (hai trang) — dữ liệu cũ; cùng rid ở phía "hn" thì KHÔNG phải trùng.
    qTrung = await baoGia("trung", {
      trang: [[bangHcm(hang("dup", "Bản A"))], [bangHcm(hang("dup", "Bản B", { paid: true, paidProof: ANH_THAT }))]],
      hnStatus: "approved", hnTables: [{ name: "HN", items: [hang("dup", "HN cùng mã")] }],
    });
    qBoDuyet = await baoGia("boduyet", { trang: [[bangHcm(hang("bd-1", "Sẽ bỏ duyệt"), hang("mc-1", "Sẽ bị xoá khỏi báo giá", { unitPrice: 250000 }))]] });
    qTienDoi = await baoGia("tiendoi", { trang: [[bangHcm(hang("td-1", "Hàng đổi tiền sau khi chi"))]] });
    qPhienBan = await baoGia("phienban", { trang: [[bangHcm(hang("v-1", "Hàng phiên bản"), hang("v-2", "Hàng mốc sai"))]] });
    qAnh = await baoGia("anh", { trang: [[bangHcm(hang("a-1", "Hàng vòng đời ảnh"), hang("a-loi", "Hàng ảnh hỏng"), hang("a-nhieu", "Hàng đủ 20 ảnh"))]] });
    qGhiChu = await baoGia("ghichu", { trang: [[bangHcm(hang("g-1", "Hàng ghi chú"), hang("g-2", "Hàng ngày HĐ"))]] });
    // Hàng "đã trả" từ TRƯỚC ngày chuyển — cờ + ảnh cũ nằm trong JSON, chưa có khoản.
    qJsonCu = await baoGia("jsoncu", { trang: [[bangHcm(
      hang("j-1", "Đã trả có ảnh", { paid: true, paidAt: "2026-09-15T04:00:00.000Z", paidById: admin.id, paidProof: ANH_THAT }),
      hang("j-2", "Đã trả không ảnh", { paid: true, paidAt: "2026-09-16T04:00:00.000Z", paidById: admin.id }),
    )]] });
    qXemAnh = await baoGia("xemanh", { trang: [[bangHcm(hang("xa-1", "Hàng xem ảnh"))]] });
  }, 60_000);

  afterAll(async () => {
    const ids = (await prisma.quote.findMany({ where: { title: { startsWith: TAG } }, includeDeleted: true, select: { id: true } })).map((q) => q.id);
    const userIds = [admin, ketoan, manager, nhanSu, hnU, chiPhi, chiXemDuAn, keToanSua].filter(Boolean).map((u) => u.id);
    // Khoản kế toán RESTRICT báo giá: dọn ảnh → khoản TRƯỚC khi xoá cứng báo giá.
    await prisma.inputInvoiceProof.deleteMany({ where: { entry: { quoteId: { in: ids } } } }).catch(() => {});
    await prisma.inputInvoiceEntry.deleteMany({ where: { quoteId: { in: ids } } }).catch(() => {});
    await prisma.auditEvent.deleteMany({ where: { OR: [{ actorId: { in: userIds } }, { resource: "quote", resourceId: { in: ids.map(String) } }] } }).catch(() => {});
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } }).catch(() => {});
    await prisma.quote.deleteMany({ where: { id: { in: ids } }, hardDelete: true }).catch(() => {});
    await prisma.quoteTemplate.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.company.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.quoteCounter.deleteMany({ where: { prefix: PREFIX } }).catch(() => {});
    await prisma.loginAttempt.deleteMany({ where: { username: { startsWith: TAG } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
  });

  // ═════════ 1. Kế toán tích ĐÃ CHI — ghi bảng riêng, không đụng báo giá; lớp phủ cho người xem báo giá ═════════
  describe("kế toán tích ĐÃ CHI hàng đã duyệt", () => {
    it("kế toán (KHÔNG có quote:read) tích hàng Chi phí HCM kèm ảnh → 200; khoản đủ dấu; JSON báo giá không đổi một byte; updatedAt + số phiên bản giữ nguyên; nhật ký pay", async () => {
      const kt = await dn(ketoan);
      const truoc = await baoGiaTrongDb(qChinh.id);
      const r = await ghi(kt, qChinh.id, "sheet", "r-hcm", { baseVersion: 0, paid: true, paidProof: ANH_THAT });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      // Đúng hình dạng của route kế toán — không bị một route `/:id…` nào của báo giá nuốt.
      expect(r.body.row).toMatchObject({
        key: `${qChinh.id}:sheet:r-hcm`, quoteId: qChinh.id, side: "sheet", rid: "r-hcm", version: 1,
        paid: true, paidByName: `${TAG} ketoan`, hasPaidProof: true, paidAmount: 1000000, tienDoi: false, nguon: "bang",
      });
      expect(r.body.row.proofs).toHaveLength(1);
      expect(r.body.row.proofs[0]).toMatchObject({ hienTai: true, retiredAt: null, source: "upload", uploadedByName: `${TAG} ketoan` });

      const e = await khoan(qChinh.id, "sheet", "r-hcm");
      expect(e).toMatchObject({ paid: true, paidById: ketoan.id, paidByName: `${TAG} ketoan`, version: 1, source: "trang", updatedById: ketoan.id });
      expect(Math.abs(e.paidAt.getTime() - Date.now()), "paidAt do MÁY CHỦ đóng dấu lúc tích").toBeLessThan(60_000);
      expect(e.paidSnapshot, "bằng chứng 'chi cho cái gì, bao nhiêu'").toMatchObject({ name: "Thuê xe", quantity: 2, unitPrice: 500000, amount: 1000000, category: "hcm", tableName: "Chi phí HCM" });
      const ds = await anhCua(e.id);
      expect(ds).toHaveLength(1);
      expect(e.currentProofId).toBe(ds[0].id);
      expect(ds[0]).toMatchObject({ mime: "image/png", size: byteCua(ANH_THAT).length, sha256: shaCua(ANH_THAT), source: "upload", uploadedById: ketoan.id, retiredAt: null });

      const sau = await baoGiaTrongDb(qChinh.id);
      expect(sau.json, "JSON hàng của báo giá bị đổi").toBe(truoc.json);
      expect(sau.updatedAt, "Quote.updatedAt nhảy — người đang soạn sẽ ăn 409").toBe(truoc.updatedAt);
      expect(sau.phienBan, "ghi kế toán không được sinh QuoteVersion").toBe(truoc.phienBan);

      const ev = await nhatKyCuoi(ketoan.id, qChinh.id, "quote.internal.pay");
      expect(ev, "thiếu nhật ký quote.internal.pay").toBeTruthy();
      expect(ev.before).toMatchObject({ side: "sheet", rid: "r-hcm", ten: "Thuê xe", version: 0, paid: false, proofId: null });
      expect(ev.after).toMatchObject({
        side: "sheet", rid: "r-hcm", ten: "Thuê xe", version: 1, paid: true, paidById: ketoan.id, paidByName: `${TAG} ketoan`,
        proofId: ds[0].id, proofSha256: shaCua(ANH_THAT), nguon: "bang",
      });
      khongChepAnh(ev);
    });

    it("Phí khách hàng (khach) và hàng Hà Nội (phần HN đã duyệt) cũng tích được; ghi chú kế toán; JSON (cả hnTables) vẫn nguyên", async () => {
      const kt = await dn(ketoan);
      const truoc = await baoGiaTrongDb(qChinh.id);
      const kh = await ghi(kt, qChinh.id, "sheet", "r-kh", { baseVersion: 0, paid: true });
      expect(kh.status, JSON.stringify(kh.body)).toBe(200);
      expect(kh.body.row).toMatchObject({ side: "sheet", rid: "r-kh", paid: true, hasPaidProof: false, paidAmount: 300000 });
      const hn = await ghi(kt, qChinh.id, "hn", "hn-1", { baseVersion: 0, paid: true });
      expect(hn.status, JSON.stringify(hn.body)).toBe(200);
      expect(hn.body.row).toMatchObject({ key: `${qChinh.id}:hn:hn-1`, side: "hn", paid: true, paidAmount: 5000000 });
      expect((await khoan(qChinh.id, "hn", "hn-1")).paidSnapshot).toMatchObject({ name: "Thuê sàn", amount: 5000000, category: "hanoi", tableName: "Giá HN" });
      const gc = await ghi(kt, qChinh.id, "sheet", "r-hcm", { baseVersion: 1, accountingNote: GHI_CHU_RIENG });
      expect(gc.status, JSON.stringify(gc.body)).toBe(200);
      expect(gc.body.row).toMatchObject({ version: 2, accountingNote: GHI_CHU_RIENG, paid: true, hasPaidProof: true });
      const sau = await baoGiaTrongDb(qChinh.id);
      expect(sau.json).toBe(truoc.json);
      expect(sau.updatedAt).toBe(truoc.updatedAt);
      expect(sau.phienBan).toBe(truoc.phienBan);
    });

    it("kế toán vẫn KHÔNG mở được báo giá (GET /api/quotes/:id và danh sách → 403) — chỉ chạm phần kế toán của hàng", async () => {
      const kt = await dn(ketoan);
      const r = await kt.get(`/api/quotes/${qChinh.id}`);
      expect(r.status).toBe(403);
      expect(JSON.stringify(r.body)).not.toContain("Thuê xe");
      expect((await kt.get("/api/quotes")).status).toBe(403);
    });

    it("admin (Kế toán + Admin có invoice:input:pay) cũng tích được", async () => {
      const ad = await dn(admin);
      const r = await ghi(ad, qChinh.id, "sheet", "r-ad", { baseVersion: 0, paid: true });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body.row).toMatchObject({ paid: true, paidByName: `${TAG} admin` });
      expect((await khoan(qChinh.id, "sheet", "r-ad")).paidById).toBe(admin.id);
    });

    it("màn soạn (admin GET /api/quotes/:id) thấy paid / hasPaidProof THEO KHOẢN qua lớp phủ — JSON thật vẫn chưa chi; không lộ ghi chú KT / ảnh", async () => {
      const ad = await dn(admin);
      const r = await ad.get(`/api/quotes/${qChinh.id}`);
      expect(r.status).toBe(200);
      const it = (rid) => r.body.sheets.flatMap((s) => s.extraTables).flatMap((t) => t.items).find((x) => x.rid === rid);
      const e = await khoan(qChinh.id, "sheet", "r-hcm");
      expect(it("r-hcm")).toMatchObject({ paid: true, hasPaidProof: true, paidById: ketoan.id, paidAt: e.paidAt.toISOString() });
      expect(it("r-kh")).toMatchObject({ paid: true, hasPaidProof: false });
      expect(it("r-ad")).toMatchObject({ paid: true });
      expect(!!it("r-chua").paid).toBe(false);
      expect(r.body.hnTables[0].items.find((x) => x.rid === "hn-1")).toMatchObject({ paid: true });
      const db = await prisma.quoteSheet.findFirst({ where: { quoteId: qChinh.id } });
      expect(!!db.extraTables[0].items.find((x) => x.rid === "r-hcm").paid, "lớp phủ CHỈ ở phản hồi — không ghi xuống JSON").toBe(false);
      const txt = JSON.stringify(r.body);
      expect(txt).not.toContain(GHI_CHU_RIENG);
      expect(txt).not.toContain("data:image");
    });

    it("tài khoản chi phí (thành viên): màn chỉ xem nội bộ thấy ✓ theo khoản; danh sách đếm 'Đã TT x/y' theo khoản; không thấy ghi chú KT / ảnh", async () => {
      const cp = await dn(chiPhi);
      const r = await cp.get(`/api/quotes/${qChinh.id}`);
      expect(r.status, JSON.stringify(r.body).slice(0, 200)).toBe(200);
      expect(r.body._internalView).toBe(true);
      const items = r.body.internalSheets.flatMap((s) => s.tables).flatMap((t) => t.items);
      expect(items.find((x) => x.rid === "r-hcm")).toMatchObject({ paid: true, hasPaidProof: true });
      expect(items.find((x) => x.rid === "r-kh")).toMatchObject({ paid: true });
      expect(!!items.find((x) => x.rid === "r-chua").paid).toBe(false);
      expect(r.body.hnTables[0].items.find((x) => x.rid === "hn-1")).toMatchObject({ paid: true });
      expect(JSON.stringify(r.body)).not.toContain(GHI_CHU_RIENG);
      expect(JSON.stringify(r.body)).not.toContain("data:image");

      const ds = await cp.get("/api/quotes").query({ size: 50 });
      expect(ds.status).toBe(200);
      // Hàng nội bộ: r-hcm, r-chua, r-kh, r-ad, hn-1 (nhóm + dòng info không tính) — đã chi theo khoản: 4. JSON thì 0.
      expect(ds.body.data.find((x) => x.id === qChinh.id)).toMatchObject({ internalRows: 5, internalPaidRows: 4 });
    });

    it("hàng CHƯA DUYỆT → 409 'hang-chua-duyet' (tích lẫn ghi chú); dòng info → 404; rid lạ / sai phía → 404; báo giá lạ → 404; phía lạ → 400 — không tạo khoản", async () => {
      const kt = await dn(ketoan);
      for (const body of [{ baseVersion: 0, paid: true }, { baseVersion: 0, accountingNote: "chưa duyệt mà ghi" }]) {
        const r = await ghi(kt, qChinh.id, "sheet", "r-chua", body);
        expect(r.status, JSON.stringify(r.body)).toBe(409);
        expect(r.body.code).toBe("hang-chua-duyet");
      }
      expect(await khoan(qChinh.id, "sheet", "r-chua"), "409 mà vẫn tạo khoản").toBeNull();
      for (const [side, rid] of [["sheet", "r-info"], ["sheet", "khong-co-rid-nay"], ["hn", "r-hcm"]]) {
        const r = await ghi(kt, qChinh.id, side, rid, { baseVersion: 0, paid: true });
        expect(r.status, `${side}/${rid}: ${JSON.stringify(r.body)}`).toBe(404);
        expect(r.body.code).toBe("khong-thay-hang");
        expect(await khoan(qChinh.id, side, rid)).toBeNull();
      }
      const la = await ghi(kt, 2147483000, "sheet", "r-hcm", { baseVersion: 0, paid: true });
      expect(la.status).toBe(404);
      expect(la.body.code).toBe("khong-thay-bao-gia");
      expect((await ghi(kt, qChinh.id, "hcm", "r-hcm", { baseVersion: 0, paid: true })).status, "phía chỉ 'sheet' | 'hn'").toBe(400);
    });
  });

  // ═════════ 2. Ai được ghi — quyền THEO TRƯỜNG ═════════
  describe("quyền", () => {
    it("tài khoản CHI PHÍ (thành viên, còn giữ quote:internal:pay cũ) → 403 ở route kế toán (ghi lẫn xem ảnh), 404 ở cả bốn route cũ; CSDL không đổi", async () => {
      const cp = await dn(chiPhi);
      const sheetId = (await prisma.quoteSheet.findFirst({ where: { quoteId: qQuyen.id } })).id;
      const r = await ghi(cp, qQuyen.id, "sheet", "q-1", { baseVersion: 0, paid: true });
      expect(r.status, JSON.stringify(r.body)).toBe(403);
      expect((await xemAnh(cp, qQuyen.id, "sheet", "q-1")).status).toBe(403);
      expect((await cp.post(`/api/quotes/${qQuyen.id}/extra/${sheetId}/q-1/pay`).send({ paid: true })).status).toBe(404);
      expect((await cp.get(`/api/quotes/${qQuyen.id}/extra/${sheetId}/q-1/proof`)).status).toBe(404);
      expect((await cp.post(`/api/quotes/${qQuyen.id}/hn/q-1/pay`).send({ paid: true })).status).toBe(404);
      expect((await cp.get(`/api/quotes/${qQuyen.id}/hn/q-1/proof`)).status).toBe(404);
      expect(await khoan(qQuyen.id, "sheet", "q-1")).toBeNull();
      const s = await prisma.quoteSheet.findFirst({ where: { quoteId: qQuyen.id } });
      expect(!!s.extraTables[0].items[0].paid, "route cũ ghi lén vào JSON").toBe(false);
    });

    it("manager / nhân sự / account HN / người chỉ có invoice:read (Quản lý dự án) → 403 — vào route cần invoice:page", async () => {
      for (const [ten, u] of [["manager", manager], ["nhân sự", nhanSu], ["account HN", hnU], ["xem dự án", chiXemDuAn]]) {
        const a = await dn(u);
        const r = await ghi(a, qQuyen.id, "sheet", "q-1", { baseVersion: 0, paid: true });
        expect(r.status, `${ten}: ${JSON.stringify(r.body)}`).toBe(403);
        expect((await xemAnh(a, qQuyen.id, "sheet", "q-1")).status, ten).toBe(403);
      }
      expect(await khoan(qQuyen.id, "sheet", "q-1")).toBeNull();
    });

    it("invoice:page + invoice:edit mà THIẾU invoice:input:pay: ngày HĐ / ghi chú → 200; tích / gỡ ảnh → 403; gửi lẫn cả hai → 403 và KHÔNG ghi phần nào; xem ảnh → 403", async () => {
      const ks = await dn(keToanSua);
      const ok = await ghi(ks, qQuyen.id, "sheet", "q-1", { baseVersion: 0, accountingNote: "chỉ ghi chú", invoiceDate: "2026-10-01" });
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      expect(ok.body.row).toMatchObject({ version: 1, accountingNote: "chỉ ghi chú", invoiceDate: "2026-10-01", paid: false });
      for (const body of [{ baseVersion: 1, paid: true }, { baseVersion: 1, paidProof: null }, { baseVersion: 1, paid: true, accountingNote: "lẫn tích" }]) {
        const r = await ghi(ks, qQuyen.id, "sheet", "q-1", body);
        expect(r.status, `${JSON.stringify(body)} → ${JSON.stringify(r.body)}`).toBe(403);
      }
      const e = await khoan(qQuyen.id, "sheet", "q-1");
      expect(e).toMatchObject({ version: 1, paid: false, accountingNote: "chỉ ghi chú" });
      expect((await xemAnh(ks, qQuyen.id, "sheet", "q-1")).status, "ảnh ủy nhiệm chi là PII — cần invoice:input:pay").toBe(403);
    });

    it("chưa đăng nhập → 401 (ghi lẫn xem ảnh)", async () => {
      const truoc = demPhat();
      expect((await request(app).put(duongDan(qQuyen.id, "sheet", "q-2")).send({ baseVersion: 0, paid: true })).status).toBe(401);
      expect((await request(app).get(`${duongDan(qQuyen.id, "sheet", "q-2")}/proof`)).status).toBe(401);
      expect(demPhat()).toBe(truoc);
      expect(await khoan(qQuyen.id, "sheet", "q-2")).toBeNull();
    });

    it("thiếu mã CSRF (agent trần — như một trang lạ lừa trình duyệt của kế toán) → 403, không ghi gì", async () => {
      const tran = request.agent(app);
      expect((await tran.post("/api/auth/login").send({ username: ketoan.username, password: PWD })).status).toBe(200);
      const truoc = demPhat();
      const r = await tran.put(duongDan(qQuyen.id, "sheet", "q-2")).send({ baseVersion: 0, paid: true });
      expect(r.status, JSON.stringify(r.body)).toBe(403);
      expect(String(r.body.code)).toMatch(/^csrf/);
      expect(demPhat()).toBe(truoc);
      expect(await khoan(qQuyen.id, "sheet", "q-2")).toBeNull();
    });

    it("đường dẫn /input-invoices/… đi vào ĐÚNG route kế toán: quoteId không phải số → 400 ở KhoanChiParams", async () => {
      const kt = await dn(ketoan);
      const r = await kt.put("/api/quotes/input-invoices/abc/sheet/q-1").send({ baseVersion: 0, paid: true });
      expect(r.status).toBe(400);
      expect((r.body.details || []).map((d) => d.path)).toContain("quoteId");
    });
  });

  // ═════════ 3. Hàng nào ghi được — mã lỗi cho từng ngõ cụt ═════════
  describe("điều kiện hàng", () => {
    it("phần Hà Nội CHƯA duyệt (hnStatus submitted) → 409 'hang-chua-duyet', không tạo khoản", async () => {
      const kt = await dn(ketoan);
      for (const body of [{ baseVersion: 0, paid: true }, { baseVersion: 0, accountingNote: "x" }]) {
        const r = await ghi(kt, qHnCho.id, "hn", "hc-1", body);
        expect(r.status, JSON.stringify(r.body)).toBe(409);
        expect(r.body.code).toBe("hang-chua-duyet");
      }
      expect(await khoan(qHnCho.id, "hn", "hc-1")).toBeNull();
    });

    it("báo giá ĐÃ XOÁ MỀM → 409 'bao-gia-da-xoa', không tạo khoản", async () => {
      const kt = await dn(ketoan);
      const r = await ghi(kt, qXoa.id, "sheet", "x-1", { baseVersion: 0, paid: true });
      expect(r.status, JSON.stringify(r.body)).toBe(409);
      expect(r.body.code).toBe("bao-gia-da-xoa");
      expect(await khoan(qXoa.id, "sheet", "x-1")).toBeNull();
    });

    it("rid TRÙNG trong một phía (dữ liệu cũ) → 409 'hang-trung-ma' cả ghi lẫn xem ảnh dự phòng, không ghi gì; cùng rid ở phía Hà Nội là hàng KHÁC → 200", async () => {
      const kt = await dn(ketoan);
      const truoc = await baoGiaTrongDb(qTrung.id);
      const r = await ghi(kt, qTrung.id, "sheet", "dup", { baseVersion: 0, paid: true });
      expect(r.status, JSON.stringify(r.body)).toBe(409);
      expect(r.body.code).toBe("hang-trung-ma");
      expect(await khoan(qTrung.id, "sheet", "dup")).toBeNull();
      const anh = await xemAnh(kt, qTrung.id, "sheet", "dup");
      expect(anh.status, "ảnh dự phòng của rid trùng: không biết bản nào").toBe(409);
      expect(anh.body.code).toBe("hang-trung-ma");
      const hn = await ghi(kt, qTrung.id, "hn", "dup", { baseVersion: 0, paid: true });
      expect(hn.status, JSON.stringify(hn.body)).toBe(200);
      expect(hn.body.row).toMatchObject({ key: `${qTrung.id}:hn:dup`, side: "hn", paid: true });
      expect((await baoGiaTrongDb(qTrung.id)).json).toBe(truoc.json);
    });

    it("khoản ĐÃ CÓ mà hàng bị BỎ DUYỆT: vẫn sửa ghi chú / gỡ ảnh / bỏ tích được (không ngõ cụt); TÍCH MỚI lại → 409 'hang-chua-duyet'; đính ảnh khi đã bỏ tích → 400 'chua-danh-dau'", async () => {
      const kt = await dn(ketoan);
      expect((await ghi(kt, qBoDuyet.id, "sheet", "bd-1", { baseVersion: 0, paid: true, paidProof: ANH_THAT })).status).toBe(200);
      await suaJsonTrangDau(qBoDuyet.id, (tables) => tables.map((t) => ({ ...t, items: t.items.map((it) => (it.rid === "bd-1" ? { ...it, approved: false, approvedAt: null } : it)) })));
      const gc = await ghi(kt, qBoDuyet.id, "sheet", "bd-1", { baseVersion: 1, accountingNote: "hàng bị bỏ duyệt" });
      expect(gc.status, JSON.stringify(gc.body)).toBe(200);
      const go = await ghi(kt, qBoDuyet.id, "sheet", "bd-1", { baseVersion: 2, paidProof: null });
      expect(go.status, JSON.stringify(go.body)).toBe(200);
      expect(go.body.row).toMatchObject({ paid: true, hasPaidProof: false, version: 3 });
      const bo = await ghi(kt, qBoDuyet.id, "sheet", "bd-1", { baseVersion: 3, paid: false });
      expect(bo.status, JSON.stringify(bo.body)).toBe(200);
      expect(bo.body.row).toMatchObject({ paid: false, hasPaidProof: false, version: 4 });
      const lai = await ghi(kt, qBoDuyet.id, "sheet", "bd-1", { baseVersion: 4, paid: true });
      expect(lai.status, JSON.stringify(lai.body)).toBe(409);
      expect(lai.body.code).toBe("hang-chua-duyet");
      const anh = await ghi(kt, qBoDuyet.id, "sheet", "bd-1", { baseVersion: 4, paidProof: ANH_THAT });
      expect(anh.status, JSON.stringify(anh.body)).toBe(400);
      expect(anh.body.code).toBe("chua-danh-dau");
      const e = await khoan(qBoDuyet.id, "sheet", "bd-1");
      expect(e).toMatchObject({ version: 4, paid: false, accountingNote: "hàng bị bỏ duyệt", currentProofId: null });
      expect((await anhCua(e.id)).map((p) => p.retiredReason), "ảnh gỡ trước khi bỏ tích: rút một lần, lý do 'go-anh'").toEqual(["go-anh"]);
    });

    it("tích lại khoản ĐÃ CHI = 'xác nhận số tiền hiện tại': chụp lại paidSnapshot, GIỮ paidAt / người tích; danh sách hết báo 'Số tiền đã đổi'; nhật ký ke-toan (không phải pay)", async () => {
      const kt = await dn(ketoan);
      const t1 = await ghi(kt, qTienDoi.id, "sheet", "td-1", { baseVersion: 0, paid: true });
      expect(t1.status, JSON.stringify(t1.body)).toBe(200);
      const e1 = await khoan(qTienDoi.id, "sheet", "td-1");
      expect(e1.paidSnapshot).toMatchObject({ quantity: 1, amount: 100000 });
      // Người có quyền tích (admin — được miễn chốt tiền) đổi số lượng hàng đã chi; mô phỏng thẳng ở CSDL.
      await suaJsonTrangDau(qTienDoi.id, (tables) => tables.map((t) => ({ ...t, items: t.items.map((it) => (it.rid === "td-1" ? { ...it, quantity: 3 } : it)) })));
      const dong = async () => (await kt.get("/api/quotes/input-invoices")).body.data.find((x) => x.key === `${qTienDoi.id}:sheet:td-1`);
      expect(await dong()).toMatchObject({ paid: true, paidAmount: 100000, amount: 300000, tienDoi: true });

      const truoc = await baoGiaTrongDb(qTienDoi.id);
      const xn = await ghi(kt, qTienDoi.id, "sheet", "td-1", { baseVersion: 1, paid: true });
      expect(xn.status, JSON.stringify(xn.body)).toBe(200);
      expect(xn.body.row).toMatchObject({ paid: true, paidAmount: 300000, tienDoi: false, version: 2 });
      const e2 = await khoan(qTienDoi.id, "sheet", "td-1");
      expect(e2.paidAt.getTime(), "xác nhận không phải tích mới — giữ ngày chi").toBe(e1.paidAt.getTime());
      expect(e2).toMatchObject({ paidById: ketoan.id, paidByName: `${TAG} ketoan` });
      expect(e2.paidSnapshot).toMatchObject({ quantity: 3, amount: 300000 });
      expect(await dong()).toMatchObject({ paidAmount: 300000, amount: 300000, tienDoi: false });
      expect((await baoGiaTrongDb(qTienDoi.id)).json).toBe(truoc.json);
      const ev = await nhatKyCuoi(ketoan.id, qTienDoi.id);
      expect(ev.action, "trạng thái tích không đổi → không phải pay").toBe("quote.internal.ke-toan");
      expect(ev.before).toMatchObject({ paid: true, version: 1 });
      expect(ev.after).toMatchObject({ paid: true, version: 2 });
    });

    it("khoản MỒ CÔI (hàng đã rời báo giá): ghi chú / bỏ tích → 200; tích / đính ảnh → 409 'hang-khong-con'", async () => {
      const kt = await dn(ketoan);
      expect((await ghi(kt, qBoDuyet.id, "sheet", "mc-1", { baseVersion: 0, paid: true })).status).toBe(200);
      await suaJsonTrangDau(qBoDuyet.id, (tables) => tables.map((t) => ({ ...t, items: t.items.filter((it) => it.rid !== "mc-1") })));
      const gc = await ghi(kt, qBoDuyet.id, "sheet", "mc-1", { baseVersion: 1, accountingNote: "hàng đã bị xoá" });
      expect(gc.status, JSON.stringify(gc.body)).toBe(200);
      expect(gc.body.row).toMatchObject({ paid: true, paidAmount: 250000, tienDoi: false, accountingNote: "hàng đã bị xoá" });
      for (const body of [{ baseVersion: 2, paid: true }, { baseVersion: 2, paidProof: ANH_THAT }]) {
        const r = await ghi(kt, qBoDuyet.id, "sheet", "mc-1", body);
        expect(r.status, `${Object.keys(body)} → ${JSON.stringify(r.body)}`).toBe(409);
        expect(r.body.code).toBe("hang-khong-con");
      }
      const bo = await ghi(kt, qBoDuyet.id, "sheet", "mc-1", { baseVersion: 2, paid: false });
      expect(bo.status, JSON.stringify(bo.body)).toBe(200);
      const e = await khoan(qBoDuyet.id, "sheet", "mc-1");
      expect(e).toMatchObject({ paid: false, version: 3 });
      expect(e.rowSnapshot, "tên / tiền của hàng mồ côi giữ ở ảnh chụp lần ghi có hàng").toMatchObject({ name: "Sẽ bị xoá khỏi báo giá", amount: 250000 });
    });
  });

  // ═════════ 4. Khoá lạc quan riêng của khoản ═════════
  describe("baseVersion / version", () => {
    it("mỗi lần ghi version + 1; baseVersion lệch → 409 'khoan-chi-da-doi' và KHÔNG ghi; Quote.updatedAt + số phiên bản không đổi", async () => {
      const kt = await dn(ketoan);
      const truoc = await baoGiaTrongDb(qPhienBan.id);
      const v1 = await ghi(kt, qPhienBan.id, "sheet", "v-1", { baseVersion: 0, accountingNote: "lần 1" });
      expect(v1.status, JSON.stringify(v1.body)).toBe(200);
      expect(v1.body.row.version).toBe(1);
      const v2 = await ghi(kt, qPhienBan.id, "sheet", "v-1", { baseVersion: 1, invoiceDate: "2026-10-02" });
      expect(v2.body.row.version).toBe(2);
      for (const baseVersion of [1, 0, 7]) {
        const r = await ghi(kt, qPhienBan.id, "sheet", "v-1", { baseVersion, accountingNote: "ghi đè im lặng" });
        expect(r.status, `baseVersion ${baseVersion}: ${JSON.stringify(r.body)}`).toBe(409);
        expect(r.body.code).toBe("khoan-chi-da-doi");
      }
      expect(await khoan(qPhienBan.id, "sheet", "v-1")).toMatchObject({ version: 2, accountingNote: "lần 1" });
      const v3 = await ghi(kt, qPhienBan.id, "sheet", "v-1", { baseVersion: 2, paid: true });
      expect(v3.status).toBe(200);
      expect(v3.body.row).toMatchObject({ version: 3, paid: true, accountingNote: "lần 1", invoiceDate: "2026-10-02" });
      const sau = await baoGiaTrongDb(qPhienBan.id);
      expect(sau.updatedAt).toBe(truoc.updatedAt);
      expect(sau.phienBan).toBe(truoc.phienBan);
      expect(sau.json).toBe(truoc.json);
    });

    it("chưa có khoản mà gửi baseVersion ≠ 0 → 409 và KHÔNG để lại khoản rỗng; thiếu baseVersion / baseVersion chuỗi → 400", async () => {
      const kt = await dn(ketoan);
      const r = await ghi(kt, qPhienBan.id, "sheet", "v-2", { baseVersion: 3, paid: true });
      expect(r.status, JSON.stringify(r.body)).toBe(409);
      expect(r.body.code).toBe("khoan-chi-da-doi");
      expect(await khoan(qPhienBan.id, "sheet", "v-2"), "khoản gieo trong transaction phải cuộn lại theo 409").toBeNull();
      expect((await ghi(kt, qPhienBan.id, "sheet", "v-2", { paid: true })).status).toBe(400);
      expect((await ghi(kt, qPhienBan.id, "sheet", "v-2", { baseVersion: "0", paid: true })).status).toBe(400);
      expect((await ghi(kt, qPhienBan.id, "sheet", "v-2", { baseVersion: 0 })).status, "không có gì để đổi").toBe(400);
      expect((await ghi(kt, qPhienBan.id, "sheet", "v-2", { baseVersion: 0, paid: "true" })).status, "paid chuỗi không được coerce").toBe(400);
      expect(await khoan(qPhienBan.id, "sheet", "v-2")).toBeNull();
    });
  });

  // ═════════ 5. Id trang đổi sau mỗi lần Lưu — khoản định vị bằng (báo giá, phía, rid) ═════════
  it("chủ báo giá Lưu (trang bị TẠO LẠI, id trang đổi) rồi kế toán tích bằng dữ liệu danh sách CŨ → trúng ĐÚNG hàng", async () => {
    const ad = await dn(admin);
    const tao = await ad.post("/api/quotes").send({
      title: `${TAG} luu`, companyId, toCompany: KHACH_BI_MAT, vatPercent: 8,
      sheets: [{
        name: "Trang 1", order: 0, templateId, items: [{ kind: "item", name: "Màn LED", quantity: 1, unitPrice: 1000, order: 0 }],
        // Admin có quote:internal:approve → cờ duyệt trong payload được tôn trọng.
        extraTables: [{ category: "hcm", name: "Chi phí HCM", items: [
          { kind: "item", name: "Hàng thứ nhất", quantity: 1, unitPrice: 100000, rid: "l-1", approved: true },
          { kind: "item", name: "Hàng thứ hai", quantity: 3, unitPrice: 70000, rid: "l-2", approved: true },
        ] }],
      }],
    });
    expect(tao.status, JSON.stringify(tao.body).slice(0, 300)).toBe(201);
    const qid = tao.body.id;
    const kt = await dn(ketoan);
    const cu = (await kt.get("/api/quotes/input-invoices")).body.data.find((r) => r.quoteId === qid && r.rid === "l-2");
    expect(cu, "hàng đã duyệt phải có trong danh sách kế toán").toBeTruthy();
    expect(cu.key).toBe(`${qid}:sheet:l-2`);

    // Chủ Lưu — đổi tên hạng mục chính để chắc chắn trang được ghi lại (kể cả khi bật INCREMENTAL_QUOTE_SAVE).
    const q = (await ad.get(`/api/quotes/${qid}`)).body;
    const luu = await ad.put(`/api/quotes/${qid}`).send({
      ...q,
      sheets: q.sheets.map((s) => ({ ...s, extraTables: Array.isArray(s.extraTables) ? s.extraTables : [], items: s.items.map((it) => ({ ...it, name: `${it.name} (sửa)` })) })),
      baseUpdatedAt: q.updatedAt,
    });
    expect(luu.status, JSON.stringify(luu.body).slice(0, 300)).toBe(200);
    const sheetMoi = (await prisma.quoteSheet.findFirst({ where: { quoteId: qid } })).id;
    expect(sheetMoi, "điều kiện của bài: Lưu phải tạo lại trang").not.toBe(cu.sheetId);

    const r = await ghi(kt, cu.quoteId, cu.side, cu.rid, { baseVersion: cu.version, paid: true });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.row.key).toBe(cu.key);
    expect((await khoan(qid, "sheet", "l-2")).paidSnapshot).toMatchObject({ name: "Hàng thứ hai", quantity: 3, unitPrice: 70000, amount: 210000 });
    const moi = (await kt.get("/api/quotes/input-invoices")).body.data.filter((x) => x.quoteId === qid);
    expect(moi.find((x) => x.key === cu.key)).toMatchObject({ rid: "l-2", sheetId: sheetMoi, paid: true });
    expect(moi.find((x) => x.rid === "l-1")).toMatchObject({ paid: false, version: 0 });
  });

  // ═════════ 6. Ảnh chứng từ — chỉ thêm, không bao giờ xoá ═════════
  describe("ảnh chứng từ", () => {
    it("ảnh hỏng không ghi gì: đuôi rác → 400; base64 không phải ảnh → 415 'khong-phai-anh'; '' (không phải cách gỡ) → 400; bỏ tích kèm ảnh → 400; quá trần ký tự → 400", async () => {
      const kt = await dn(ketoan);
      const quaTran = `data:image/png;base64,${"A".repeat(900_000)}`;
      for (const [body, status, code] of [
        [{ baseVersion: 0, paid: true, paidProof: ANH_DUOI_RAC }, 400],
        [{ baseVersion: 0, paid: true, paidProof: KHONG_PHAI_ANH }, 415, "khong-phai-anh"],
        [{ baseVersion: 0, paid: true, paidProof: "" }, 400],
        [{ baseVersion: 0, paid: false, paidProof: ANH_THAT }, 400],
        [{ baseVersion: 0, paid: true, paidProof: quaTran }, 400],
      ]) {
        const r = await ghi(kt, qAnh.id, "sheet", "a-loi", body);
        expect(r.status, `${String(body.paidProof).slice(0, 40)} → ${JSON.stringify(r.body).slice(0, 200)}`).toBe(status);
        if (code) expect(r.body.code).toBe(code);
      }
      expect(await khoan(qAnh.id, "sheet", "a-loi"), "ảnh hỏng mà vẫn tạo khoản").toBeNull();
    });

    it("vòng đời: đính khi CHƯA tích → 400 'chua-danh-dau'; tích + ảnh (sha256 = byte đã giải); THAY ('thay'); GỠ ('go-anh'); đính lại; BỎ TÍCH ('bo-danh-dau') — số dòng ảnh không bao giờ giảm, ảnh cũ mở lại được bằng ?proofId", async () => {
      const kt = await dn(ketoan);
      const soAnh = () => prisma.inputInvoiceProof.count({ where: { entry: { quoteId: qAnh.id, side: "sheet", rid: "a-1" } } });
      const dem = [];

      let r = await ghi(kt, qAnh.id, "sheet", "a-1", { baseVersion: 0, paidProof: ANH_THAT });
      expect(r.status, JSON.stringify(r.body)).toBe(400);
      expect(r.body.code).toBe("chua-danh-dau");
      expect(await khoan(qAnh.id, "sheet", "a-1")).toBeNull();
      dem.push(await soAnh());

      r = await ghi(kt, qAnh.id, "sheet", "a-1", { baseVersion: 0, paid: true, paidProof: ANH_THAT });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      const e1 = await khoan(qAnh.id, "sheet", "a-1");
      const [p1] = await anhCua(e1.id);
      expect(p1).toMatchObject({ sha256: shaCua(ANH_THAT), size: byteCua(ANH_THAT).length, mime: "image/png", retiredAt: null });
      expect(e1.currentProofId).toBe(p1.id);
      dem.push(await soAnh());

      // THAY: byte JPEG mang nhãn png → lưu theo kiểu THẬT.
      r = await ghi(kt, qAnh.id, "sheet", "a-1", { baseVersion: 1, paidProof: ANH_JPG_NHAN_PNG });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      const e2 = await khoan(qAnh.id, "sheet", "a-1");
      const ds2 = await anhCua(e2.id);
      expect(ds2).toHaveLength(2);
      expect(ds2[0]).toMatchObject({ id: p1.id, retiredReason: "thay", retiredById: ketoan.id, retiredByName: `${TAG} ketoan` });
      expect(ds2[0].retiredAt).not.toBeNull();
      expect(ds2[0].dataUrl, "ảnh cũ không được sửa nội dung").toBe(ANH_THAT);
      expect(ds2[1]).toMatchObject({ mime: "image/jpeg", sha256: createHash("sha256").update(JPG).digest("hex"), retiredAt: null });
      expect(ds2[1].dataUrl.startsWith("data:image/jpeg;base64,"), "nhãn dựng lại theo magic bytes").toBe(true);
      expect(e2.currentProofId).toBe(ds2[1].id);
      expect(r.body.row.proofs.map((p) => [p.id, p.hienTai, p.retiredReason])).toEqual([[ds2[1].id, true, null], [p1.id, false, "thay"]]);
      let x = await xemAnh(kt, qAnh.id, "sheet", "a-1", p1.id);
      expect(x.status, JSON.stringify(x.body).slice(0, 200)).toBe(200);
      expect(x.body).toMatchObject({ paidProof: ANH_THAT, proofId: p1.id, nguon: "bang" });
      expect(x.body.retiredAt).not.toBeNull();
      x = await xemAnh(kt, qAnh.id, "sheet", "a-1");
      expect(x.body).toMatchObject({ paidProof: ds2[1].dataUrl, proofId: ds2[1].id, retiredAt: null });
      dem.push(await soAnh());

      // GỠ ảnh (null) — vẫn đã chi.
      r = await ghi(kt, qAnh.id, "sheet", "a-1", { baseVersion: 2, paidProof: null });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body.row).toMatchObject({ paid: true, hasPaidProof: false, version: 3 });
      const e3 = await khoan(qAnh.id, "sheet", "a-1");
      expect(e3.currentProofId).toBeNull();
      expect((await anhCua(e3.id))[1]).toMatchObject({ retiredReason: "go-anh" });
      x = await xemAnh(kt, qAnh.id, "sheet", "a-1");
      expect(x.body).toMatchObject({ paidProof: null, proofId: null });
      dem.push(await soAnh());

      // Đính lại rồi BỎ TÍCH.
      expect((await ghi(kt, qAnh.id, "sheet", "a-1", { baseVersion: 3, paidProof: ANH_THAT })).status).toBe(200);
      r = await ghi(kt, qAnh.id, "sheet", "a-1", { baseVersion: 4, paid: false });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body.row).toMatchObject({ paid: false, paidAt: null, paidByName: null, hasPaidProof: false, paidAmount: null, version: 5 });
      const e5 = await khoan(qAnh.id, "sheet", "a-1");
      expect(e5).toMatchObject({ paid: false, paidAt: null, paidById: null, paidByName: null, paidSnapshot: null, currentProofId: null });
      const ds5 = await anhCua(e5.id);
      expect(ds5.map((p) => p.retiredReason)).toEqual(["thay", "go-anh", "bo-danh-dau"]);
      expect(ds5.every((p) => p.retiredAt), "mọi ảnh đã rút vào lịch sử").toBe(true);
      dem.push(await soAnh());

      expect(dem).toEqual([0, 1, 2, 2, 3]);
      for (const p of ds5) {
        const y = await xemAnh(kt, qAnh.id, "sheet", "a-1", p.id);
        expect(y.status).toBe(200);
        expect(y.body.paidProof, `ảnh ${p.id} không đọc lại được`).toBe(p.dataUrl);
      }
      // proofId của khoản KHÁC không mở được qua khoản này.
      const khac = await prisma.inputInvoiceProof.findFirst({ where: { entry: { quoteId: qChinh.id } } });
      const lan = await xemAnh(kt, qAnh.id, "sheet", "a-1", khac.id);
      expect(lan.status).toBe(404);
      expect(lan.body.code).toBe("khong-thay-anh");

      const pay = await nhatKyCuoi(ketoan.id, qAnh.id, "quote.internal.unpay");
      expect(pay, "thiếu nhật ký quote.internal.unpay").toBeTruthy();
      expect(pay.before).toMatchObject({ rid: "a-1", paid: true, version: 4 });
      expect(pay.after).toMatchObject({ rid: "a-1", paid: false, proofId: null, version: 5 });
      khongChepAnh(pay);
      khongChepAnh(await nhatKyCuoi(ketoan.id, qAnh.id, "quote.internal.ke-toan"));
    });

    it("> 20 ảnh một khoản (kể cả ảnh đã rút) → 400 'qua-nhieu-anh', không thêm dòng; gỡ ảnh (không thêm dòng) vẫn được", async () => {
      const kt = await dn(ketoan);
      const e = await prisma.inputInvoiceEntry.create({ data: {
        quoteId: qAnh.id, side: "sheet", rid: "a-nhieu", paid: true, paidAt: new Date(), paidById: ketoan.id, paidByName: "seed", rowSnapshot: {}, version: 0,
      } });
      await prisma.inputInvoiceProof.createMany({ data: Array.from({ length: 20 }, (_, i) => ({
        entryId: e.id, dataUrl: ANH_THAT, mime: "image/png", size: byteCua(ANH_THAT).length, sha256: shaCua(ANH_THAT),
        retiredAt: i < 19 ? new Date() : null, retiredReason: i < 19 ? "thay" : null,
      })) });
      const cuoi = await prisma.inputInvoiceProof.findFirst({ where: { entryId: e.id, retiredAt: null } });
      await prisma.inputInvoiceEntry.update({ where: { id: e.id }, data: { currentProofId: cuoi.id } });

      const r = await ghi(kt, qAnh.id, "sheet", "a-nhieu", { baseVersion: 0, paidProof: ANH_THAT });
      expect(r.status, JSON.stringify(r.body)).toBe(400);
      expect(r.body.code).toBe("qua-nhieu-anh");
      expect(await prisma.inputInvoiceProof.count({ where: { entryId: e.id } })).toBe(20);
      expect(await khoan(qAnh.id, "sheet", "a-nhieu")).toMatchObject({ version: 0, currentProofId: cuoi.id });
      const go = await ghi(kt, qAnh.id, "sheet", "a-nhieu", { baseVersion: 0, paidProof: null });
      expect(go.status, JSON.stringify(go.body)).toBe(200);
      expect(await prisma.inputInvoiceProof.count({ where: { entryId: e.id } })).toBe(20);
    });
  });

  // ═════════ 7. Ngày hóa đơn + Ghi chú kế toán ═════════
  describe("ngày hóa đơn + ghi chú kế toán", () => {
    it("ngày HĐ là NGÀY THUẦN: khứ hồi không lệch múi giờ (đầu / cuối năm), qua cả danh sách; ngày không có thật / sai dạng → 400; '' / null = xoá", async () => {
      const kt = await dn(ketoan);
      let v = 0;
      for (const ngay of ["2026-10-05", "2026-01-01", "2026-12-31"]) {
        const r = await ghi(kt, qGhiChu.id, "sheet", "g-2", { baseVersion: v, invoiceDate: ngay });
        expect(r.status, JSON.stringify(r.body)).toBe(200);
        v = r.body.row.version;
        expect(r.body.row.invoiceDate).toBe(ngay);
        expect((await khoan(qGhiChu.id, "sheet", "g-2")).invoiceDate.toISOString().slice(0, 10), `CSDL lệch ngày ${ngay}`).toBe(ngay);
        // Giá trị DATE THÔ trong Postgres — đúng ngày đã nhập bất kể múi giờ của tiến trình (máy verify chạy UTC+7).
        const [{ d }] = await prisma.$queryRaw`SELECT "invoiceDate"::text AS d FROM "InputInvoiceEntry" WHERE "quoteId" = ${qGhiChu.id} AND side = 'sheet' AND rid = 'g-2'`;
        expect(d, `cột @db.Date lưu lệch ngày ${ngay}`).toBe(ngay);
      }
      const ds = (await kt.get("/api/quotes/input-invoices")).body.data;
      expect(ds.find((x) => x.key === `${qGhiChu.id}:sheet:g-2`)).toMatchObject({ invoiceDate: "2026-12-31", version: v });
      for (const sai of ["2026-02-30", "05/10/2026", "2026-1-5", "1999-12-31"]) {
        const r = await ghi(kt, qGhiChu.id, "sheet", "g-2", { baseVersion: v, invoiceDate: sai });
        expect(r.status, sai).toBe(400);
      }
      for (const xoa of ["", null]) {
        const r = await ghi(kt, qGhiChu.id, "sheet", "g-2", { baseVersion: v, invoiceDate: xoa });
        expect(r.status, JSON.stringify(r.body)).toBe(200);
        v = r.body.row.version;
        expect(r.body.row.invoiceDate).toBeNull();
        expect((await khoan(qGhiChu.id, "sheet", "g-2")).invoiceDate).toBeNull();
        expect((await ghi(kt, qGhiChu.id, "sheet", "g-2", { baseVersion: v, invoiceDate: "2026-10-05" })).status).toBe(200);
        v += 1;
      }
    });

    it("ghi chú: 1000 ký tự lưu được, 1001 → 400 (giữ bản cũ); TRIM trước khi đo; '' / chỉ khoảng trắng / null = xoá; trường VẮNG giữ nguyên; nhật ký ke-toan có before/after", async () => {
      const kt = await dn(ketoan);
      const nghin = "g".repeat(1000);
      let r = await ghi(kt, qGhiChu.id, "sheet", "g-1", { baseVersion: 0, accountingNote: nghin, invoiceDate: "2026-09-30" });
      expect(r.status, JSON.stringify(r.body).slice(0, 200)).toBe(200);
      expect(r.body.row.accountingNote).toBe(nghin);
      r = await ghi(kt, qGhiChu.id, "sheet", "g-1", { baseVersion: 1, accountingNote: `${nghin}x` });
      expect(r.status).toBe(400);
      expect((await khoan(qGhiChu.id, "sheet", "g-1")).accountingNote).toBe(nghin);
      r = await ghi(kt, qGhiChu.id, "sheet", "g-1", { baseVersion: 1, accountingNote: `   ${nghin}  ` });
      expect(r.status, "khoảng trắng hai đầu không được làm từ chối oan").toBe(200);
      expect(r.body.row.accountingNote).toBe(nghin);
      r = await ghi(kt, qGhiChu.id, "sheet", "g-1", { baseVersion: 2, accountingNote: "  HĐ đỏ số 0012 — đã nhận bản gốc  " });
      expect(r.body.row.accountingNote).toBe("HĐ đỏ số 0012 — đã nhận bản gốc");

      // Trường vắng giữ nguyên: tích không đụng ngày / ghi chú, đổi ngày không đụng ghi chú.
      r = await ghi(kt, qGhiChu.id, "sheet", "g-1", { baseVersion: 3, paid: true });
      expect(r.body.row).toMatchObject({ paid: true, accountingNote: "HĐ đỏ số 0012 — đã nhận bản gốc", invoiceDate: "2026-09-30" });
      r = await ghi(kt, qGhiChu.id, "sheet", "g-1", { baseVersion: 4, invoiceDate: "2026-10-03" });
      expect(r.body.row).toMatchObject({ paid: true, accountingNote: "HĐ đỏ số 0012 — đã nhận bản gốc", invoiceDate: "2026-10-03" });

      const ev = await nhatKyCuoi(ketoan.id, qGhiChu.id, "quote.internal.ke-toan");
      expect(ev.before).toMatchObject({ rid: "g-1", invoiceDate: "2026-09-30", version: 4 });
      expect(ev.after).toMatchObject({ rid: "g-1", invoiceDate: "2026-10-03", accountingNote: "HĐ đỏ số 0012 — đã nhận bản gốc", version: 5 });
      khongChepAnh(ev);

      for (const xoa of ["", "    ", null]) {
        const e = await khoan(qGhiChu.id, "sheet", "g-1");
        const x = await ghi(kt, qGhiChu.id, "sheet", "g-1", { baseVersion: e.version, accountingNote: xoa });
        expect(x.status, JSON.stringify(xoa)).toBe(200);
        expect(x.body.row.accountingNote).toBeNull();
        expect((await khoan(qGhiChu.id, "sheet", "g-1")).accountingNote).toBeNull();
        await ghi(kt, qGhiChu.id, "sheet", "g-1", { baseVersion: e.version + 1, accountingNote: "khôi phục" });
      }
    });
  });

  // ═════════ 8. Hàng "đã trả" từ JSON cũ: đọc dự phòng + gieo khoản ở lần ghi đầu ═════════
  describe("cờ JSON cũ (trước ngày chuyển)", () => {
    it("chưa có khoản: xem ảnh → ĐỌC DỰ PHÒNG từ JSON cũ (nguon 'json-cu') + nhật ký proof-view; xem KHÔNG tạo khoản", async () => {
      const kt = await dn(ketoan);
      const r = await xemAnh(kt, qJsonCu.id, "sheet", "j-1");
      expect(r.status, JSON.stringify(r.body).slice(0, 200)).toBe(200);
      expect(r.body).toEqual({ paidProof: ANH_THAT, proofId: null, retiredAt: null, nguon: "json-cu", loai: "chi", mime: null });
      expect(await khoan(qJsonCu.id, "sheet", "j-1")).toBeNull();
      const ev = await nhatKyCuoi(ketoan.id, qJsonCu.id, "quote.internal.proof-view");
      expect(ev.after).toMatchObject({ side: "sheet", rid: "j-1", proofId: null, nguon: "json-cu" });
      khongChepAnh(ev);
    });

    it("ghi ghi chú lên hàng JSON cũ đã trả + có ảnh → GIEO khoản: paidAt / người trả / ảnh cũ (json-cu, sha256), legacySeed; JSON không đổi; nhật ký before.nguon 'json-cu'", async () => {
      const kt = await dn(ketoan);
      const truoc = await baoGiaTrongDb(qJsonCu.id);
      const r = await ghi(kt, qJsonCu.id, "sheet", "j-1", { baseVersion: 0, accountingNote: "đối chiếu khoản cũ" });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body.row).toMatchObject({
        version: 1, paid: true, paidAt: "2026-09-15T04:00:00.000Z", paidByName: `${TAG} admin`, hasPaidProof: true,
        paidAmount: null, tienDoi: false, accountingNote: "đối chiếu khoản cũ", nguon: "bang",
      });
      expect(r.body.row.proofs).toHaveLength(1);
      expect(r.body.row.proofs[0]).toMatchObject({ source: "json-cu", hienTai: true, retiredAt: null });

      const e = await khoan(qJsonCu.id, "sheet", "j-1");
      expect(e).toMatchObject({ source: "json-cu", paid: true, paidById: admin.id, paidByName: `${TAG} admin`, paidSnapshot: null, version: 1 });
      expect(e.paidAt.toISOString()).toBe("2026-09-15T04:00:00.000Z");
      expect(e.legacySeed).toEqual({ paid: true, paidAt: "2026-09-15T04:00:00.000Z", paidById: admin.id, hasProof: true });
      const [p] = await anhCua(e.id);
      expect(p).toMatchObject({ source: "json-cu", sha256: shaCua(ANH_THAT), dataUrl: ANH_THAT, retiredAt: null, uploadedById: admin.id });
      expect(e.currentProofId).toBe(p.id);
      expect((await baoGiaTrongDb(qJsonCu.id)).json, "gieo khoản không được đụng một byte JSON").toBe(truoc.json);

      const ev = await nhatKyCuoi(ketoan.id, qJsonCu.id, "quote.internal.ke-toan");
      expect(ev.before).toMatchObject({ rid: "j-1", paid: true, nguon: "json-cu", version: 0, proofId: p.id });
      expect(ev.after).toMatchObject({ rid: "j-1", paid: true, accountingNote: "đối chiếu khoản cũ", nguon: "bang", version: 1 });
      khongChepAnh(ev);

      const anh = await xemAnh(kt, qJsonCu.id, "sheet", "j-1");
      expect(anh.body).toMatchObject({ paidProof: ANH_THAT, proofId: p.id, nguon: "bang" });
    });

    it("bỏ tích hàng JSON cũ đã trả (chưa có khoản) → khoản paid=false THẮNG cờ JSON: màn soạn thấy chưa chi dù JSON vẫn paid:true; nhật ký unpay", async () => {
      const kt = await dn(ketoan);
      const r = await ghi(kt, qJsonCu.id, "sheet", "j-2", { baseVersion: 0, paid: false });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body.row).toMatchObject({ paid: false, paidAt: null, version: 1 });
      const s = await prisma.quoteSheet.findFirst({ where: { quoteId: qJsonCu.id } });
      expect(s.extraTables[0].items.find((x) => x.rid === "j-2").paid, "JSON đóng băng").toBe(true);
      const ad = await dn(admin);
      const q = (await ad.get(`/api/quotes/${qJsonCu.id}`)).body;
      const it = (rid) => q.sheets.flatMap((x) => x.extraTables).flatMap((t) => t.items).find((x) => x.rid === rid);
      expect(it("j-2").paid, "lớp phủ: khoản thắng cờ JSON cũ").toBe(false);
      expect(it("j-1")).toMatchObject({ paid: true, hasPaidProof: true });
      const ev = await nhatKyCuoi(ketoan.id, qJsonCu.id, "quote.internal.unpay");
      expect(ev.before).toMatchObject({ rid: "j-2", paid: true, nguon: "json-cu" });
      expect(ev.after).toMatchObject({ rid: "j-2", paid: false });
    });
  });

  // ═════════ 9. Xem ảnh ủy nhiệm chi (PII bên thứ ba) ═════════
  describe("xem ảnh", () => {
    it("kế toán xem được (200 + nhật ký proof-view chỉ định danh); tài khoản chi phí / manager / account HN → 403", async () => {
      const kt = await dn(ketoan);
      expect((await ghi(kt, qXemAnh.id, "sheet", "xa-1", { baseVersion: 0, paid: true, paidProof: ANH_THAT })).status).toBe(200);
      const r = await xemAnh(kt, qXemAnh.id, "sheet", "xa-1");
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ paidProof: ANH_THAT, nguon: "bang", retiredAt: null });
      const ev = await nhatKyCuoi(ketoan.id, qXemAnh.id, "quote.internal.proof-view");
      expect(ev.after).toMatchObject({ side: "sheet", rid: "xa-1", proofId: r.body.proofId, nguon: "bang" });
      khongChepAnh(ev);
      for (const u of [chiPhi, manager, hnU]) {
        const x = await xemAnh(await dn(u), qXemAnh.id, "sheet", "xa-1");
        expect(x.status, u.username).toBe(403);
        expect(JSON.stringify(x.body)).not.toContain("data:image");
      }
    });

    it("báo giá đã XOÁ MỀM: khoản thành chỉ-đọc (ghi → 409) nhưng ảnh vẫn mở được — bằng chứng tiền đã chi không biến mất", async () => {
      const kt = await dn(ketoan);
      await prisma.quote.delete({ where: { id: qXemAnh.id } });   // xoá MỀM (bản app cũ / dữ liệu cũ)
      const r = await xemAnh(kt, qXemAnh.id, "sheet", "xa-1");
      expect(r.status, JSON.stringify(r.body).slice(0, 200)).toBe(200);
      expect(r.body.paidProof).toBe(ANH_THAT);
      const e = await khoan(qXemAnh.id, "sheet", "xa-1");
      const g = await ghi(kt, qXemAnh.id, "sheet", "xa-1", { baseVersion: e.version, accountingNote: "sau khi xoá" });
      expect(g.status).toBe(409);
      expect(g.body.code).toBe("bao-gia-da-xoa");
      expect((await khoan(qXemAnh.id, "sheet", "xa-1")).version).toBe(e.version);
    });
  });
});
