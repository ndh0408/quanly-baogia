// HÓA ĐƠN ĐẦU VÀO (chủ repo 2026-09-30: "thêm 1 trang hóa đơn đầu vào, trang đó là trang của những cái nào đã
// duyệt ở phần nội bộ"). `GET /api/quotes/input-invoices` liệt kê MỌI hàng bảng nội bộ ĐÃ DUYỆT — mỗi hàng là một
// khoản chi cần hoá đơn đầu vào — cho người có `invoice:page` (kế toán, admin).
//
// "ĐÃ DUYỆT" ở repo này có HAI dạng, và bài này khoá cả hai:
//   · Chi phí HCM / Phí khách hàng: duyệt THEO HÀNG (`item.approved`, do quote:internal:approve đặt, server giữ
//     theo `rid` — reconcileExtraApprovals). Hàng chưa duyệt không cộng vào tổng, nên cũng không đòi hoá đơn.
//   · Báo giá Hà Nội (`Quote.hnTables`): duyệt ở MỨC BÁO GIÁ (`hnStatus = approved`) — cờ `approved*` của từng hàng
//     HN không phải nguồn sự thật (reconcileHnApprovals chỉ bịt ghi lậu, luồng duyệt HN là hnStatus).
// Tiền dùng ĐÚNG `extraTableSum` (làm tròn từng dòng, cờ quantityExact, days theo mẫu) — không dựng lại bằng SQL
// hay JS thứ hai, vì hai nguồn số tiền là cách có hai con số cho cùng một khoản chi.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { agentWithCsrf } from "./helpers/agent.js";
import bcrypt from "bcryptjs";
import { prisma } from "../src/db.js";
import { PERMISSIONS as P } from "../src/permissions.js";
import { hangHoaDonDauVao } from "../src/inputInvoices.js";

// ═════════ Phần THUẦN (không cần CSDL): hàm dựng hàng ═════════
const DS_MAU_NGAY = [{ id: 1, companyId: 7, hasDays: true }];
const DS_MAU_KHONG = [{ id: 1, companyId: 7, hasDays: false }];
const bg = { id: 5, companyId: 7, projectCode: "FP_A26_005", projectVersion: 1, quoteNumber: "GN26005", title: "Sự kiện", shortTitle: null, status: "converted", hnStatus: null, hnReviewedAt: null, hnReviewerId: null, customer: { code: "KH1", name: "Khách 1" }, company: { shortName: "GN", name: "Gia Nguyễn" }, createdBy: { displayName: "Lan" } };
const hangDuyet = (over = {}) => ({ kind: "item", rid: "r1", name: "Thuê xe", quantity: 2, unitPrice: 500000, approved: true, approvedAt: "2026-09-20T03:00:00.000Z", approvedBy: 9, ...over });

describe("hangHoaDonDauVao (thuần) — chọn hàng đã duyệt, tính tiền, gán nhãn", () => {
  const dung = (over = {}) => hangHoaDonDauVao({
    quote: bg, sheets: [{ id: 50, order: 1, name: "Trang A", codeNo: 1 }, { id: 51, order: 2, name: "Trang B", codeNo: 2 }],
    sheetTables: [{ sheetId: 50, tables: [{ category: "hcm", name: "Chi phí HCM", items: [hangDuyet()] }] }], bangHn: [], dsMau: DS_MAU_KHONG,
    tenNguoi: new Map([[9, "Admin"]]), ...over,
  });

  it("một hàng đã duyệt → một dòng đủ trường; mã sheet có hậu tố vì báo giá có nhiều trang", () => {
    const [r] = dung();
    expect(r).toMatchObject({
      quoteId: 5, quoteCode: "FP_A26_005", title: "Sự kiện", status: "converted", customerCode: "KH1", customerName: "Khách 1",
      companyName: "GN", createdByName: "Lan", sheetId: 50, sheetName: "Trang A", sheetCode: "FP_A26_005_01",
      category: "hcm", tableName: "Chi phí HCM", rid: "r1", name: "Thuê xe", quantity: 2, unitPrice: 500000, amount: 1000000,
      approvedAt: "2026-09-20T03:00:00.000Z", approvedByName: "Admin", paid: false, luuKho: false, chungTu: null, ns: null,
    });
  });

  it("CHỈ hàng đã duyệt: hàng chưa duyệt, dòng nhóm/nhóm con/info (kể cả khi mang approved:true) bị loại", () => {
    const hang = dung({ sheetTables: [{ sheetId: 50, tables: [{ category: "hcm", items: [
      { kind: "section", name: "Nhóm A", approved: true },
      hangDuyet({ rid: "da" }),
      hangDuyet({ rid: "chua", approved: false }),
      hangDuyet({ rid: "info", kind: "info" }),
      hangDuyet({ rid: "nhom-con", kind: "subsection" }),
    ] }] }] });
    expect(hang.map((r) => r.rid)).toEqual(["da"]);
  });

  it("dòng CON (kind 'sub', tên trống vì ô gộp) thừa hưởng tên của hạng mục đứng trước nó", () => {
    const hang = dung({ sheetTables: [{ sheetId: 50, tables: [{ category: "hcm", items: [
      hangDuyet({ rid: "cha", name: "Backdrop" }),
      hangDuyet({ rid: "con", kind: "sub", name: "", quantity: 1, unitPrice: 100000 }),
    ] }] }] });
    expect(hang.map((r) => [r.rid, r.name, r.amount])).toEqual([["cha", "Backdrop", 1000000], ["con", "Backdrop", 100000]]);
  });

  it("TIỀN theo mẫu của bảng: mẫu CÓ cột ngày thì nhân days; mẫu không ngày thì BỎ QUA days cũ còn trong CSDL", () => {
    const b = (over) => [{ sheetId: 50, tables: [{ category: "khach", items: [hangDuyet({ quantity: 1, unitPrice: 300000, days: 3, ...over })] }] }];
    expect(dung({ sheetTables: b({}), dsMau: DS_MAU_NGAY })[0]).toMatchObject({ amount: 900000, days: 3 });
    expect(dung({ sheetTables: b({}), dsMau: DS_MAU_KHONG })[0]).toMatchObject({ amount: 300000, days: null });
    // Số lẻ chính xác (quantityExact) và làm tròn từng dòng: đúng luật extraTableSum.
    expect(dung({ sheetTables: b({ quantity: 1.5, days: null }), dsMau: DS_MAU_KHONG })[0].amount).toBe(450000);
  });

  it("bảng Hà Nội: CHỈ khi báo giá hnStatus=approved; mọi hàng vào (cờ approved từng hàng không phải nguồn), duyệt bởi người duyệt HN", () => {
    const bangHn = [{ name: "Giá HN", items: [{ kind: "item", rid: "h1", name: "Thuê sàn", quantity: 1, unitPrice: 2000000, approved: false }, { kind: "section", name: "Nhóm" }] }];
    const chua = dung({ sheetTables: [], bangHn, quote: { ...bg, hnStatus: "submitted" } });
    expect(chua, "HN mới gửi duyệt chưa được coi là đã duyệt").toEqual([]);
    const roi = dung({ sheetTables: [], bangHn, quote: { ...bg, hnStatus: "approved", hnReviewedAt: new Date("2026-09-25T01:00:00Z"), hnReviewerId: 9 } });
    expect(roi).toHaveLength(1);
    expect(roi[0]).toMatchObject({ category: "hanoi", tableName: "Giá HN", sheetId: null, sheetCode: null, sheetName: null, rid: "h1", name: "Thuê sàn", amount: 2000000, approvedAt: "2026-09-25T01:00:00.000Z", approvedByName: "Admin" });
  });

  it("báo giá MỘT trang: mã sheet không có hậu tố (đúng quy tắc sheetCode)", () => {
    const [r] = dung({ sheets: [{ id: 50, order: 1, name: "Trang A", codeNo: 1 }] });
    expect(r.sheetCode).toBe("FP_A26_005");
  });

  it("KHÔNG bao giờ mang ảnh chứng từ; chứng từ / lưu kho / NS / thanh toán đi theo hàng", () => {
    const [r] = dung({ sheetTables: [{ sheetId: 50, tables: [{ category: "hcm", items: [hangDuyet({ chungTu: "VAT", luuKho: true, ns: "Cty Xe Sài Gòn", paid: true, paidAt: "2026-09-21T00:00:00.000Z", paidProof: "data:image/png;base64,AAAA" })] }] }] });
    expect(r).toMatchObject({ chungTu: "VAT", luuKho: true, ns: "Cty Xe Sài Gòn", paid: true, paidAt: "2026-09-21T00:00:00.000Z" });
    expect(JSON.stringify(r)).not.toContain("paidProof");
    expect(JSON.stringify(r)).not.toContain("data:image");
  });

  it("chứng từ lạ trong CSDL → null (chỉ VAT/HDNS/TM); người duyệt đã bị xoá → tên null chứ không vỡ", () => {
    const [r] = dung({ sheetTables: [{ sheetId: 50, tables: [{ category: "hcm", items: [hangDuyet({ chungTu: "XYZ", approvedBy: 404 })] }] }] });
    expect(r.chungTu).toBeNull();
    expect(r.approvedByName).toBeNull();
  });

  it("dữ liệu JSON tự do lệch kiểu (bảng không phải object, items không phải mảng, phần tử null) → bỏ qua, không ném", () => {
    const hang = dung({ sheetTables: [{ sheetId: 50, tables: [null, "x", { category: "hcm", items: "hỏng" }, { category: "hcm", items: [null, 7, hangDuyet({ rid: "ok" })] }] }], bangHn: [null, { items: null }] });
    expect(hang.map((r) => r.rid)).toEqual(["ok"]);
  });

  it("bảng loại lạ (không phải hcm/khach) trong trang bị bỏ — đó là bản cũ của bảng HN còn nằm lại, sẽ đếm hai lần", () => {
    const hang = dung({ sheetTables: [{ sheetId: 50, tables: [{ category: "hanoi", items: [hangDuyet({ rid: "cu" })] }, { category: "hcm", items: [hangDuyet({ rid: "moi" })] }] }] });
    expect(hang.map((r) => r.rid)).toEqual(["moi"]);
  });
});

// ═════════ Phần TÍCH HỢP: endpoint + phân quyền ═════════
const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "Quote" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 nhưng không kiểm tra được Postgres");

const TAG = `hddv${Date.now()}`;
const PWD = "Test1234!a";
const ANH = `data:image/png;base64,${"A".repeat(2000)}`;

describe.runIf(dbAvailable)("GET /api/quotes/input-invoices", () => {
  let app, companyId, templateId, admin, ketoan, manager, nhanSu, hn, chiPhi, chiXemDuAn;
  let qChot, qNhap, qXoa, qKhongDuyet, qHnChoDuyet;
  const dangNhap = async (u) => {
    const a = agentWithCsrf(app);
    expect((await a.post("/api/auth/login").send({ username: u.username, password: PWD })).status).toBe(200);
    return a;
  };
  const user = (ten, role, permissions) => bcrypt.hash(PWD, 4).then((passwordHash) => prisma.user.create({
    data: { username: `${TAG}-${ten}`, displayName: `${TAG} ${ten}`, role, passwordHash, ...(permissions ? { permissions } : {}) },
  }));
  const duyet = (over = {}) => ({ kind: "item", quantity: 1, unitPrice: 1000, approved: true, approvedAt: "2026-09-20T03:00:00.000Z", approvedBy: null, paid: false, paidAt: null, paidProof: null, ...over });
  const baoGia = (ten, extra = {}) => prisma.quote.create({ data: {
    quoteNumber: `${TAG}-${ten}`, projectCode: `${TAG}_${ten}`, title: `${TAG} ${ten}`, searchText: TAG, toCompany: "Khách", companyId, fromContact: "x",
    fromAddress: "x", city: "TP. Hồ Chí Minh", quoteDate: new Date(), createdById: admin.id, ...extra,
  } });
  const trang = (order, name, extraTables) => ({ templateId, order, name, codeNo: order, extraTables });

  beforeAll(async () => {
    const { createApp } = await import("../src/app.js");
    app = createApp();
    admin = await user("admin", "admin");
    ketoan = await user("ketoan", "accountant");
    manager = await user("manager", "manager");
    nhanSu = await user("nhansu", "hr");
    hn = await user("hn", "account_hn");
    chiPhi = await user("chiphi", "hr", [P.QUOTE_READ_OWN, P.QUOTE_INTERNAL_VIEW, P.QUOTE_INTERNAL_PAY]);
    chiXemDuAn = await user("duan", "hr", [P.INVOICE_READ]);   // xem Quản lý dự án, KHÔNG phải trang Hoá đơn
    companyId = (await prisma.company.create({ data: { code: `${TAG}CO`, name: "Cty thử", address: "1 Thử", quotePrefix: `H${`${Date.now()}`.slice(-6)}` } })).id;
    templateId = (await prisma.quoteTemplate.create({ data: { companyId, name: "Mẫu thử", code: `${TAG}k`, filePath: "templates/GN_KhongNgay.xlsx" } })).id;

    qChot = await baoGia("chot", {
      status: "converted", convertedAt: new Date(), hnStatus: "approved", hnReviewedAt: new Date("2026-09-25T01:00:00Z"), hnReviewerId: admin.id,
      hnTables: [{ name: "Giá HN", items: [duyet({ rid: "hn-1", name: "Thuê sàn", quantity: 2, unitPrice: 2500000, approved: false, paidProof: ANH })] }],
      sheets: { create: [
        trang(1, "Trang A", [
          { category: "hcm", name: "Chi phí HCM", templateId: null, items: [
            { kind: "section", name: "Nhóm A", quantity: 0, unitPrice: 0 },
            duyet({ rid: "r-a", name: "Thuê xe", quantity: 2, unitPrice: 500000, approvedBy: admin.id, chungTu: "VAT", luuKho: true, ns: "Cty Xe Sài Gòn", paid: true, paidAt: "2026-09-22T00:00:00.000Z", paidProof: ANH }),
            duyet({ rid: "r-b", name: "Chưa duyệt", approved: false }),
            duyet({ rid: "r-info", kind: "info", name: "Ghi chú" }),
          ] },
          { category: "khach", name: "Phí khách hàng", items: [duyet({ rid: "r-c", name: "Phí ship", unitPrice: 300000 })] },
        ]),
        trang(2, "Trang B", [
          { category: "hcm", items: [duyet({ rid: "r-d", name: "In ấn", unitPrice: 700000 })] },
          // Bản CŨ của bảng HN còn nằm trong trang (migration 20260915140000 là expand-only) — KHÔNG được đếm.
          { category: "hanoi", items: [duyet({ rid: "r-cu", name: "HN cũ", unitPrice: 9999999 })] },
        ]),
      ] },
    });
    qNhap = await baoGia("nhap", { status: "draft", hnStatus: "submitted", hnTables: [{ name: "HN chờ", items: [duyet({ rid: "hn-2", name: "Chưa duyệt HN" })] }], sheets: { create: [trang(1, "Trang 1", [{ category: "hcm", items: [duyet({ rid: "n-1", name: "Duyệt sớm" })] }])] } });
    qXoa = await baoGia("xoa", { sheets: { create: [trang(1, "Trang 1", [{ category: "hcm", items: [duyet({ rid: "x-1", name: "Báo giá đã xoá" })] }])] } });
    await prisma.quote.delete({ where: { id: qXoa.id } });   // xoá MỀM
    qKhongDuyet = await baoGia("khong", { sheets: { create: [trang(1, "Trang 1", [{ category: "hcm", items: [duyet({ rid: "k-1", name: "Không duyệt", approved: false })] }])] } });
    qHnChoDuyet = await baoGia("hnrong", { hnStatus: "approved", hnTables: [], sheets: { create: [trang(1, "Trang 1", [])] } });
  });

  afterAll(async () => {
    await prisma.quote.deleteMany({ where: { title: { startsWith: TAG } }, hardDelete: true, includeDeleted: true }).catch(() => {});
    await prisma.quoteTemplate.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.company.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    const ids = [admin, ketoan, manager, nhanSu, hn, chiPhi, chiXemDuAn].filter(Boolean).map((u) => u.id);
    await prisma.auditEvent.deleteMany({ where: { actorId: { in: ids } } }).catch(() => {});
    await prisma.loginAttempt.deleteMany({ where: { username: { startsWith: TAG } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
  });

  // Dòng của RIÊNG bộ fixture này (CSDL test có thể còn báo giá của bài khác).
  const cuaTa = (body) => body.data.filter((r) => String(r.quoteCode).startsWith(TAG));

  it("kế toán (invoice:page) lấy đúng tập hàng ĐÃ DUYỆT — đủ HCM, Phí KH, HN (báo giá hnStatus=approved) và cả báo giá nháp", async () => {
    const a = await dangNhap(ketoan);
    const r = await a.get("/api/quotes/input-invoices");
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const rid = cuaTa(r.body).map((x) => x.rid).sort();
    expect(rid).toEqual(["hn-1", "n-1", "r-a", "r-c", "r-d"]);
    expect(r.body.meta.truncated).toBe(false);
  });

  it("LOẠI: hàng chưa duyệt, dòng info, bảng HN CŨ trong trang, HN chưa duyệt, báo giá xoá mềm", async () => {
    const a = await dangNhap(ketoan);
    const rid = cuaTa((await a.get("/api/quotes/input-invoices")).body).map((x) => x.rid);
    for (const loai of ["r-b", "r-info", "r-cu", "hn-2", "x-1", "k-1"]) expect(rid, loai).not.toContain(loai);
  });

  it("từng dòng đủ thông tin để đối chiếu hoá đơn: mã dự án, sheet, bảng, tiền, chứng từ, NS, người duyệt, thanh toán", async () => {
    const a = await dangNhap(ketoan);
    const d = cuaTa((await a.get("/api/quotes/input-invoices")).body);
    const xe = d.find((x) => x.rid === "r-a");
    expect(xe).toMatchObject({
      quoteId: qChot.id, quoteCode: `${TAG}_chot`, status: "converted", category: "hcm", tableName: "Chi phí HCM",
      sheetName: "Trang A", sheetCode: `${TAG}_chot_01`, name: "Thuê xe", quantity: 2, unitPrice: 500000, amount: 1000000,
      chungTu: "VAT", luuKho: true, ns: "Cty Xe Sài Gòn", paid: true, approvedByName: `${TAG} admin`,
    });
    expect(xe.approvedAt).toBe("2026-09-20T03:00:00.000Z");
    const hn = d.find((x) => x.rid === "hn-1");
    expect(hn).toMatchObject({ category: "hanoi", tableName: "Giá HN", sheetId: null, sheetCode: null, amount: 5000000, approvedByName: `${TAG} admin` });
    expect(new Date(hn.approvedAt).toISOString()).toBe("2026-09-25T01:00:00.000Z");
    expect(d.find((x) => x.rid === "r-d").sheetCode).toBe(`${TAG}_chot_02`);
    expect(d.find((x) => x.rid === "n-1")).toMatchObject({ status: "draft", sheetCode: `${TAG}_nhap` });   // báo giá MỘT trang: không hậu tố
  });

  it("KHÔNG một byte ảnh chứng từ nào đi qua dây", async () => {
    const a = await dangNhap(ketoan);
    const r = await a.get("/api/quotes/input-invoices");
    const txt = JSON.stringify(r.body);
    expect(txt).not.toContain("paidProof");
    expect(txt).not.toContain("data:image");
  });

  it("admin cũng xem được; kết quả y hệt kế toán", async () => {
    const a = await dangNhap(admin);
    const r = await a.get("/api/quotes/input-invoices");
    expect(r.status).toBe(200);
    expect(cuaTa(r.body).map((x) => x.rid).sort()).toEqual(["hn-1", "n-1", "r-a", "r-c", "r-d"]);
  });

  it("người KHÔNG có invoice:page → 403: quản lý báo giá, nhân sự, account HN, tài khoản chi phí, người chỉ xem Quản lý dự án", async () => {
    for (const [ten, u] of [["manager", manager], ["nhân sự", nhanSu], ["account HN", hn], ["chi phí", chiPhi], ["xem dự án", chiXemDuAn]]) {
      const a = await dangNhap(u);
      const r = await a.get("/api/quotes/input-invoices");
      expect(r.status, `${ten}: ${JSON.stringify(r.body)}`).toBe(403);
      expect(JSON.stringify(r.body), `${ten}: lộ hàng chi phí`).not.toContain("Thuê xe");
    }
  });

  it("chưa đăng nhập → 401", async () => {
    expect((await request(app).get("/api/quotes/input-invoices")).status).toBe(401);
  });

  it("đường dẫn /input-invoices KHÔNG bị `/:id` nuốt (id 'input-invoices' sẽ 400 ở validate)", async () => {
    const a = await dangNhap(ketoan);
    const r = await a.get("/api/quotes/input-invoices");
    expect(r.status).not.toBe(400);
    expect(Array.isArray(r.body.data)).toBe(true);
  });

  it("chỉ ĐỌC: gọi endpoint không làm đổi Quote.updatedAt (khoá lạc quan của người đang soạn)", async () => {
    const truoc = await prisma.quote.findUnique({ where: { id: qChot.id }, select: { updatedAt: true } });
    const a = await dangNhap(ketoan);
    await a.get("/api/quotes/input-invoices");
    const sau = await prisma.quote.findUnique({ where: { id: qChot.id }, select: { updatedAt: true } });
    expect(sau.updatedAt.getTime()).toBe(truoc.updatedAt.getTime());
  });
});
