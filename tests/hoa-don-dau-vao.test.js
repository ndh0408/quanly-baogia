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
//
// ── PHẦN KẾ TOÁN (2026-10-06) ─────────────────────────────────────────────────────────────────────────
// Kế toán nay GHI ngay trên trang này (đã chi + ảnh, ngày HĐ, ghi chú — bảng InputInvoiceEntry, xem
// tests/hddv-khoan-chi-ghi.test.js). Mỗi dòng mang thêm phần kế toán + KHOÁ ỔN ĐỊNH `quoteId:side:rid` (id trang
// đổi sau mỗi lần Lưu, rid thì bền), và danh sách là HỢP ba nhóm: hàng đủ điều kiện ("binh-thuong") cộng nhóm
// "Cần chú ý" — hàng có dữ liệu kế toán mà nay bỏ duyệt / không còn trong báo giá / báo giá đã xoá — để kế toán
// (không mở được báo giá) không bao giờ gặp ngõ cụt.
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

  // ── Phần kế toán của dòng (2026-10-06) ──
  it("hàng CHƯA có dữ liệu kế toán: phía, trạng thái hàng, ghi được, mốc phiên bản 0, nguồn 'khong', phần kế toán trống", () => {
    const [r] = dung();
    expect(r).toMatchObject({
      key: "5:sheet:r1", side: "sheet", trangThaiHang: "binh-thuong", coTheGhi: true, lyDoKhoa: null,
      version: 0, nguon: "khong", paid: false, paidAt: null, paidByName: null, hasPaidProof: false, proofs: [],
      paidAmount: null, tienDoi: false, invoiceDate: null, accountingNote: null, keToanCapNhatLuc: null, keToanCapNhatBoi: null,
    });
    const [hn] = dung({ sheetTables: [], bangHn: [{ name: "Giá HN", items: [hangDuyet({ rid: "h1" })] }], quote: { ...bg, hnStatus: "approved" } });
    expect(hn).toMatchObject({ key: "5:hn:h1", side: "hn", category: "hanoi", trangThaiHang: "binh-thuong", coTheGhi: true, version: 0 });
  });

  it("KHOÁ ỔN ĐỊNH `quoteId:side:rid`: KHÔNG đổi khi trang được tạo lại (Lưu đổi id trang) hay bảng đổi chỗ; cùng rid ở trang và ở Hà Nội là hai khoá khác nhau", () => {
    const truoc = dung();
    // Sau một lần Lưu: trang mang id mới, bảng Phí KH chen lên trước — hàng vẫn là hàng đó.
    const sau = dung({
      sheets: [{ id: 90, order: 1, name: "Trang A", codeNo: 1 }, { id: 91, order: 2, name: "Trang B", codeNo: 2 }],
      sheetTables: [{ sheetId: 90, tables: [{ category: "khach", name: "Phí KH", items: [] }, { category: "hcm", name: "Chi phí HCM", items: [hangDuyet()] }] }],
    });
    expect(sau[0].sheetId).toBe(90);
    expect(sau[0].key).toBe(truoc[0].key);
    const hai = dung({ sheetTables: [{ sheetId: 50, tables: [{ category: "hcm", items: [hangDuyet()] }] }], bangHn: [{ items: [hangDuyet()] }], quote: { ...bg, hnStatus: "approved" } });
    expect(hai.map((r) => [r.side, r.key, r.coTheGhi])).toEqual([["sheet", "5:sheet:r1", true], ["hn", "5:hn:r1", true]]);
  });

  it("thiếu rid / rid TRÙNG trong cùng phía (kể cả khác trang) → khoá theo VỊ TRÍ gồm cả trang, không ghi được, có lý do", () => {
    const ds = dung({ sheetTables: [
      { sheetId: 50, tables: [{ category: "hcm", items: [hangDuyet({ rid: "trung" }), hangDuyet({ rid: undefined, name: "Không mã" })] }] },
      { sheetId: 51, tables: [{ category: "hcm", items: [hangDuyet({ rid: "trung", name: "Bản 2" })] }] },
    ] });
    expect(ds.map((r) => [r.key, r.coTheGhi])).toEqual([["5:hcm:50:0:0", false], ["5:hcm:50:0:1", false], ["5:hcm:51:0:0", false]]);
    expect(new Set(ds.map((r) => r.key)).size, "khoá vị trí phải duy nhất").toBe(3);
    expect(ds[0].lyDoKhoa).toMatch(/hai dòng cùng mã/);
    expect(ds[1].lyDoKhoa).toMatch(/chưa có mã nội bộ/);
  });

  it("cờ 'đã trả' JSON CŨ (chưa có khoản): nguồn 'json-cu', tên người trả tra từ tenNguoi, ảnh cũ chỉ thành cờ hasPaidProof", () => {
    const [r] = dung({ sheetTables: [{ sheetId: 50, tables: [{ category: "hcm", items: [hangDuyet({ paid: true, paidAt: "2026-09-21T00:00:00.000Z", paidById: 9, paidProof: "data:image/png;base64,AAAA" })] }] }] });
    expect(r).toMatchObject({ paid: true, paidAt: "2026-09-21T00:00:00.000Z", paidByName: "Admin", hasPaidProof: true, nguon: "json-cu", version: 0, paidAmount: null, tienDoi: false });
    expect(JSON.stringify(r)).not.toContain("data:image");
  });

  it("có KHOẢN: khoản THẮNG cờ JSON (kể cả khi khoản đã bỏ tích); mốc phiên bản, ngày HĐ thuần, ghi chú, ảnh (siêu dữ liệu, mới nhất trước), tiền lúc chi / 'đã đổi'", () => {
    const e = {
      id: 7, quoteId: 5, side: "sheet", rid: "r1", paid: true, paidAt: new Date("2026-10-01T02:00:00Z"), paidById: 3, paidByName: "Kế toán A",
      paidSnapshot: { amount: 900000 }, currentProofId: 71, invoiceDate: new Date("2026-10-05T00:00:00Z"), accountingNote: "HĐ số 12",
      rowSnapshot: {}, legacySeed: null, source: "trang", version: 3, updatedAt: new Date("2026-10-02T00:00:00Z"), updatedByName: "Kế toán A",
    };
    const anh = new Map([[7, [
      { id: 70, entryId: 7, uploadedAt: new Date("2026-10-01T02:00:00Z"), uploadedByName: "Kế toán A", retiredAt: new Date("2026-10-01T03:00:00Z"), retiredReason: "thay", source: "upload" },
      { id: 71, entryId: 7, uploadedAt: new Date("2026-10-01T03:00:00Z"), uploadedByName: "Kế toán A", retiredAt: null, retiredReason: null, source: "upload" },
    ]]]);
    const [r] = dung({ khoan: new Map([["sheet:r1", e]]), anh });
    expect(r).toMatchObject({
      key: "5:sheet:r1", paid: true, paidAt: "2026-10-01T02:00:00.000Z", paidByName: "Kế toán A", hasPaidProof: true, version: 3, nguon: "bang",
      invoiceDate: "2026-10-05", accountingNote: "HĐ số 12", amount: 1000000, paidAmount: 900000, tienDoi: true,
      keToanCapNhatLuc: "2026-10-02T00:00:00.000Z", keToanCapNhatBoi: "Kế toán A", trangThaiHang: "binh-thuong", coTheGhi: true,
    });
    expect(r.proofs.map((p) => [p.id, p.hienTai, p.retiredReason])).toEqual([[71, true, null], [70, false, "thay"]]);
    // Khoản đã BỎ tích thắng cờ JSON cũ paid:true + ảnh.
    const boTich = { ...e, paid: false, paidAt: null, paidById: null, paidByName: null, paidSnapshot: null, currentProofId: null };
    const [r2] = dung({ khoan: new Map([["sheet:r1", boTich]]), sheetTables: [{ sheetId: 50, tables: [{ category: "hcm", items: [hangDuyet({ paid: true, paidAt: "2026-09-01T00:00:00Z", paidProof: "data:image/png;base64,AAAA" })] }] }] });
    expect(r2).toMatchObject({ paid: false, paidAt: null, hasPaidProof: false, nguon: "bang", paidAmount: null, tienDoi: false });
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

// ═════════ Nhóm "CẦN CHÚ Ý" (2026-10-06): dữ liệu kế toán đã có mà hàng nay không còn đủ điều kiện ═════════
// Bộ fixture RIÊNG (mã dự án bắt đầu bằng `ccy…`, không phải TAG) để không lẫn vào các bài so tập hàng ở trên. Khoản
// dựng thẳng bằng Prisma — đường ghi đã có bài riêng (tests/hddv-khoan-chi-ghi.test.js).
const TAG_CCY = `ccy${TAG}`;

describe.runIf(dbAvailable)("GET /api/quotes/input-invoices — nhóm 'Cần chú ý'", () => {
  let app, companyId, templateId, ketoan, admin, qCanChuY, qDaXoa;
  const dangNhap = async (u) => {
    const a = agentWithCsrf(app);
    expect((await a.post("/api/auth/login").send({ username: u.username, password: PWD })).status).toBe(200);
    return a;
  };
  const hang = (rid, name, over = {}) => ({ kind: "item", rid, name, quantity: 1, unitPrice: 100000, approved: true, approvedAt: "2026-09-20T03:00:00.000Z", approvedBy: null, ...over });
  const baoGia = (ten, extra = {}) => prisma.quote.create({ data: {
    quoteNumber: `${TAG_CCY}-${ten}`, projectCode: `${TAG_CCY}_${ten}`, title: `${TAG_CCY} ${ten}`, searchText: TAG_CCY, toCompany: "Khách",
    companyId, fromContact: "x", fromAddress: "x", city: "TP. Hồ Chí Minh", quoteDate: new Date(), createdById: admin.id, ...extra,
  } });
  const khoan = (quoteId, side, rid, over = {}) => prisma.inputInvoiceEntry.create({ data: {
    quoteId, side, rid, paid: true, paidAt: new Date("2026-10-01T02:00:00Z"), paidById: ketoan.id, paidByName: `${TAG_CCY} ketoan`,
    paidSnapshot: { amount: 100000 }, rowSnapshot: {}, version: 2, updatedByName: `${TAG_CCY} ketoan`, ...over,
  } });
  const cuaTa = (body) => body.data.filter((r) => String(r.quoteCode).startsWith(TAG_CCY));

  beforeAll(async () => {
    const { createApp } = await import("../src/app.js");
    app = createApp();
    const passwordHash = await bcrypt.hash(PWD, 4);
    admin = await prisma.user.create({ data: { username: `${TAG_CCY}-admin`, displayName: `${TAG_CCY} admin`, role: "admin", passwordHash } });
    ketoan = await prisma.user.create({ data: { username: `${TAG_CCY}-ketoan`, displayName: `${TAG_CCY} ketoan`, role: "accountant", passwordHash } });
    companyId = (await prisma.company.create({ data: { code: `${TAG_CCY}CO`, name: "Cty thử", address: "1 Thử", quotePrefix: `C${`${Date.now()}`.slice(-6)}` } })).id;
    templateId = (await prisma.quoteTemplate.create({ data: { companyId, name: "Mẫu thử", code: `${TAG_CCY}k`, filePath: "templates/GN_KhongNgay.xlsx" } })).id;

    qCanChuY = await baoGia("canchuy", {
      // Phần HN bị TRẢ LẠI sau khi kế toán đã ghi chú một hàng HN.
      hnStatus: "rejected",
      hnTables: [{ name: "Giá HN", items: [hang("cc-hn", "HN bị trả lại"), hang("cc-hn-sach", "HN không dữ liệu")] }],
      sheets: { create: [{ templateId, order: 1, name: "Trang 1", codeNo: 1, extraTables: [{ category: "hcm", name: "Chi phí HCM", items: [
        hang("cc-thuong", "Hàng bình thường"),
        hang("cc-bd", "Bị bỏ duyệt sau khi chi", { approved: false, approvedAt: null }),
        hang("cc-sach", "Chưa duyệt, không dữ liệu", { approved: false, approvedAt: null }),
      ] }] }] },
    });
    await khoan(qCanChuY.id, "sheet", "cc-bd");
    await khoan(qCanChuY.id, "hn", "cc-hn", { paid: false, paidAt: null, paidById: null, paidByName: null, paidSnapshot: null, accountingNote: "chờ HĐ đỏ" });
    // Khoản MỒ CÔI: hàng đã rời báo giá (vd hàng chỉ có ghi chú bị xoá) — dựng lại từ ảnh chụp lần ghi gần nhất.
    await khoan(qCanChuY.id, "sheet", "cc-mc", {
      paid: false, paidAt: null, paidById: null, paidByName: null, paidSnapshot: null, accountingNote: "hàng đã xoá",
      rowSnapshot: { name: "Hàng đã rời báo giá", unit: "gói", quantity: 2, unitPrice: 61500, days: null, amount: 123000, category: "khach", tableName: "Phí KH" },
    });
    // Báo giá có khoản ĐÃ CHI rồi mới bị xoá mềm (dữ liệu cũ / bản app cũ): chỉ xem, ảnh không đi qua dây.
    qDaXoa = await baoGia("daxoa", { sheets: { create: [{ templateId, order: 1, name: "Trang 1", codeNo: 1, extraTables: [{ category: "hcm", name: "Chi phí HCM", items: [hang("cc-xoa", "Trên báo giá đã xoá")] }] }] } });
    const ex = await khoan(qDaXoa.id, "sheet", "cc-xoa", { rowSnapshot: { name: "Trên báo giá đã xoá", quantity: 1, unitPrice: 100000, amount: 100000, category: "hcm", tableName: "Chi phí HCM" } });
    const anh = await prisma.inputInvoiceProof.create({ data: { entryId: ex.id, dataUrl: ANH, mime: "image/png", size: 1500, sha256: null } });
    await prisma.inputInvoiceEntry.update({ where: { id: ex.id }, data: { currentProofId: anh.id } });
    await prisma.quote.delete({ where: { id: qDaXoa.id } });   // xoá MỀM
  });

  afterAll(async () => {
    const ids = (await prisma.quote.findMany({ where: { title: { startsWith: TAG_CCY } }, includeDeleted: true, select: { id: true } })).map((q) => q.id);
    // Khoản kế toán RESTRICT báo giá: dọn ảnh → khoản TRƯỚC khi xoá cứng báo giá.
    await Promise.resolve().then(() => prisma.inputInvoiceProof.deleteMany({ where: { entry: { quoteId: { in: ids } } } })).catch(() => {});
    await Promise.resolve().then(() => prisma.inputInvoiceEntry.deleteMany({ where: { quoteId: { in: ids } } })).catch(() => {});
    await prisma.quote.deleteMany({ where: { id: { in: ids } }, hardDelete: true }).catch(() => {});
    await prisma.quoteTemplate.deleteMany({ where: { code: { startsWith: TAG_CCY } }, hardDelete: true }).catch(() => {});
    await prisma.company.deleteMany({ where: { code: { startsWith: TAG_CCY } }, hardDelete: true }).catch(() => {});
    await prisma.auditEvent.deleteMany({ where: { actorId: { in: [admin, ketoan].filter(Boolean).map((u) => u.id) } } }).catch(() => {});
    await prisma.loginAttempt.deleteMany({ where: { username: { startsWith: TAG_CCY } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG_CCY } }, hardDelete: true }).catch(() => {});
  });

  it("hàng BỎ DUYỆT có khoản → 'chua-duyet'; HN bị trả lại có khoản → 'hn-chua-duyet'; khoản MỒ CÔI → 'khong-con-hang' (từ ảnh chụp); báo giá XOÁ MỀM có khoản → 'bao-gia-da-xoa' chỉ xem — vẫn ghi được trừ báo giá đã xoá", async () => {
    const a = await dangNhap(ketoan);
    const r = await a.get("/api/quotes/input-invoices");
    expect(r.status, JSON.stringify(r.body).slice(0, 200)).toBe(200);
    const d = cuaTa(r.body);
    const theo = Object.fromEntries(d.map((x) => [x.rid, x]));
    expect(theo["cc-thuong"]).toMatchObject({ trangThaiHang: "binh-thuong", coTheGhi: true, nguon: "khong", key: `${qCanChuY.id}:sheet:cc-thuong` });
    expect(theo["cc-bd"]).toMatchObject({
      trangThaiHang: "chua-duyet", side: "sheet", key: `${qCanChuY.id}:sheet:cc-bd`, coTheGhi: true, lyDoKhoa: null,
      paid: true, paidByName: `${TAG_CCY} ketoan`, nguon: "bang", version: 2, approvedAt: null, name: "Bị bỏ duyệt sau khi chi",
    });
    expect(theo["cc-hn"]).toMatchObject({ trangThaiHang: "hn-chua-duyet", side: "hn", category: "hanoi", key: `${qCanChuY.id}:hn:cc-hn`, coTheGhi: true, accountingNote: "chờ HĐ đỏ", paid: false });
    expect(theo["cc-mc"]).toMatchObject({
      trangThaiHang: "khong-con-hang", side: "sheet", key: `${qCanChuY.id}:sheet:cc-mc`, coTheGhi: true, sheetId: null,
      name: "Hàng đã rời báo giá", unit: "gói", quantity: 2, unitPrice: 61500, amount: 123000, category: "khach", tableName: "Phí KH", accountingNote: "hàng đã xoá",
    });
    expect(theo["cc-xoa"]).toMatchObject({
      trangThaiHang: "bao-gia-da-xoa", quoteId: qDaXoa.id, coTheGhi: false, lyDoKhoa: "Báo giá đã xoá — chỉ xem.", paid: true, hasPaidProof: true, name: "Trên báo giá đã xoá",
    });
    // Hàng chưa đủ điều kiện mà KHÔNG có dữ liệu kế toán thì vẫn không vào danh sách.
    for (const rid of ["cc-sach", "cc-hn-sach"]) expect(theo[rid], rid).toBeUndefined();
    expect(d.filter((x) => x.trangThaiHang === "binh-thuong").map((x) => x.rid), "nhóm 'Cần chú ý' không lẫn vào hàng bình thường").toEqual(["cc-thuong"]);
    const txt = JSON.stringify(d);
    expect(txt).not.toContain("paidProof");
    expect(txt, "danh sách không bao giờ mang ảnh").not.toContain("data:image");
  });

  it("admin thấy y hệt kế toán: cùng năm dòng, cùng trạng thái hàng", async () => {
    const ad = await dangNhap(admin);
    const r = await ad.get("/api/quotes/input-invoices");
    expect(cuaTa(r.body).map((x) => `${x.rid}:${x.trangThaiHang}`).sort()).toEqual(
      ["cc-bd:chua-duyet", "cc-hn:hn-chua-duyet", "cc-mc:khong-con-hang", "cc-thuong:binh-thuong", "cc-xoa:bao-gia-da-xoa"],
    );
  });
});
