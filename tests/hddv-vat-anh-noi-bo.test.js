// HÓA ĐƠN VAT + XEM CHỨNG TỪ TỪ BẢNG NỘI BỘ (chủ repo 2026-10-06: "có để kế toán cho hình và hiển thị bên nội bộ chứ, và cũng
// như là nếu có VAT thì cho thêm ô bỏ VAT vào, nếu có VAT mà chỉ mới thanh toán thôi thì bên nội bộ báo là đã thanh toán chưa
// VAT và cho kế toán update vào nhé").
//
// ── BÀI NÀY KHOÁ GÌ ──────────────────────────────────────────────────────────────────────────────────────
//   · Luật thuần: trangThaiVat (3 ca + hàng HĐNS/TM như cũ), khoanXemTheoRid (hàng chưa chi mà có HĐ VAT), kiemTepVat (PDF
//     thật nhận, nhãn giả bị dựng lại từ byte, rác 415).
//   · Migration CHỈ THÊM: hai ADD COLUMN, DEFAULT hằng / NULL, lock_timeout, không UPDATE / DELETE / DROP.
//   · PUT khoản chi `vatProof`: đưa TRƯỚC khi tích, sau khi tích, thay / gỡ chỉ RÚT (không xoá), bỏ tích không rút HĐ VAT,
//     hàng không phải VAT → 409, thiếu invoice:input:pay → 403, nhật ký `quote.internal.vat` không chép tệp.
//   · GET /:id/khoan-chi: 3 trạng thái (đã TT chưa VAT / đã có VAT / có HĐ VAT chưa TT ở `vatChuaChi`), không mang tệp.
//   · GET /:id/khoan-chi/:side/:rid/anh: người xem được hàng → 200 + nhật ký proof-view noiBo; account HN chỉ phía hn; người
//     ngoài / kế toán không có quote:read / chưa đăng nhập bị chặn; rid lạ, khoản mồ côi, ảnh đã rút → 404.
//   · Đường Lưu báo giá không làm mất HĐ VAT (xoá hàng chưa chi có HĐ VAT → khoản + tệp còn nguyên, danh sách hiện dòng).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { agentWithCsrf } from "./helpers/agent.js";
import { prisma } from "../src/db.js";
import { PERMISSIONS as P } from "../src/permissions.js";
import { trangThaiVat, khoanXemTheoRid } from "../src/khoanChi.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "Quote" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");

const TAG = `hddvvat${Date.now()}`;
const PWD = "Test1234!a";
const ANH_THAT =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const PDF_BYTE = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");
const PDF_THAT = `data:application/pdf;base64,${PDF_BYTE.toString("base64")}`;

describe("luật thuần — trạng thái VAT", () => {
  it("trangThaiVat: ba ca của hàng VAT; HĐNS / TM / chưa chọn → null (hiện như cũ)", () => {
    expect(trangThaiVat("VAT", true, false)).toBe("chua-vat");
    expect(trangThaiVat("VAT", true, true)).toBe("da-vat");
    expect(trangThaiVat("VAT", false, true)).toBe("vat-chua-tt");
    expect(trangThaiVat("VAT", false, false)).toBeNull();
    expect(trangThaiVat("TM", true, true)).toBeNull();
    expect(trangThaiVat("HDNS", false, true)).toBeNull();
    expect(trangThaiVat(null, true, false)).toBeNull();
  });

  it("khoanXemTheoRid: hàng CHƯA chi mà có HĐ VAT có mặt (paid=false); hàng chưa chi, không HĐ thì không; chứng từ đổi khỏi VAT vẫn báo cờ", () => {
    const khoan = new Map([
      ["sheet:a", { paid: true, paidAt: new Date("2026-10-06T02:00:00Z"), paidById: 9, paidByName: "KT", currentProofId: 3, currentVatProofId: null }],
      ["sheet:b", { paid: false, paidAt: null, paidById: null, paidByName: null, currentProofId: null, currentVatProofId: 7 }],
      ["sheet:c", { paid: false, paidAt: null, paidById: null, paidByName: null, currentProofId: null, currentVatProofId: null }],
      ["sheet:d", { paid: true, paidAt: new Date("2026-10-06T02:00:00Z"), paidById: 9, paidByName: "KT", currentProofId: null, currentVatProofId: 8 }],
    ]);
    const bang = [{ category: "hcm", items: [
      { kind: "item", rid: "a", chungTu: "VAT" }, { kind: "item", rid: "b", chungTu: "VAT" },
      { kind: "item", rid: "c", chungTu: "VAT" }, { kind: "item", rid: "d", chungTu: "TM" },
    ] }];
    const kq = khoanXemTheoRid("sheet", bang, khoan, new Map([[7, new Date("2026-10-05T01:00:00Z")]]));
    expect(kq.map((h) => [h.rid, h.paid, h.laVat, h.coHdVat])).toEqual([["a", true, true, false], ["b", false, true, true], ["d", true, false, true]]);
    expect(kq.find((h) => h.rid === "b").hdVatLuc).toBe("2026-10-05T01:00:00.000Z");
    expect(kq.find((h) => h.rid === "b").coAnh, "chưa chi thì không có ảnh ủy nhiệm chi").toBe(false);
  });

  it("kiemTepVat: PDF thật nhận; nhãn PDF trên byte PNG → lưu nhãn THẬT; rác → 415", async () => {
    const { kiemTepVat } = await import("../src/services/inputInvoiceService.js");
    expect(kiemTepVat(PDF_THAT)).toMatchObject({ mime: "application/pdf", size: PDF_BYTE.length });
    const gia = `data:application/pdf;base64,${ANH_THAT.split(",")[1]}`;
    const t = kiemTepVat(gia);
    expect(t.mime).toBe("image/png");
    expect(t.dataUrl.startsWith("data:image/png;base64,")).toBe(true);
    expect(() => kiemTepVat(`data:application/pdf;base64,${Buffer.from("not a pdf").toString("base64")}`)).toThrow(/không phải ảnh/);
  });
});

describe("migration 20261006150000_input_invoice_vat — CHỈ THÊM", () => {
  const sql = readFileSync(fileURLToPath(new URL("../prisma/migrations/20261006150000_input_invoice_vat/migration.sql", import.meta.url)), "utf8");
  const lenh = sql.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
  it("hai ADD COLUMN (DEFAULT hằng 'chi' / NULL), có lock_timeout, không UPDATE / DELETE / DROP / ALTER TYPE", () => {
    expect(lenh).toMatch(/SET lock_timeout = '10s';/);
    expect(lenh).toMatch(/ALTER TABLE "InputInvoiceEntry" ADD COLUMN "currentVatProofId" INTEGER;/);
    expect(lenh).toMatch(/ALTER TABLE "InputInvoiceProof" ADD COLUMN "loai" TEXT NOT NULL DEFAULT 'chi';/);
    expect(lenh).not.toMatch(/\b(UPDATE|DELETE|DROP|TRUNCATE)\b|ALTER\s+COLUMN|TYPE\s/i);
  });
});

describe.runIf(dbAvailable)("HĐ VAT của khoản chi + xem chứng từ từ bảng nội bộ", () => {
  let app, companyId, templateId, q;
  let admin, ketoan, ngoai, chiPhi, hnU, ketoanKhongTich, chu, tvHcm, tvMain, xemChung;
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
  const hang = (rid, name, chungTu, over = {}) => ({ kind: "item", rid, name, quantity: 1, unitPrice: 100000, chungTu, approved: true, approvedAt: "2026-09-20T03:00:00.000Z", approvedBy: null, ...over });
  const khoan = (side, rid) => prisma.inputInvoiceEntry.findUnique({ where: { quoteId_side_rid: { quoteId: q.id, side, rid } } });
  const ghi = async (side, rid, body, u = ketoan) => (await dn(u)).put(`/api/quotes/input-invoices/${q.id}/${side}/${rid}`).send(body);
  const ghiOk = async (side, rid, body) => {
    const e = await khoan(side, rid);
    const r = await ghi(side, rid, { baseVersion: e?.version ?? 0, ...body });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return r.body.row;
  };
  const xemDs = async (u) => (await dn(u)).get(`/api/quotes/${q.id}/khoan-chi`);
  const xemAnh = async (u, side, rid, loai) => (await dn(u)).get(`/api/quotes/${q.id}/khoan-chi/${side}/${rid}/anh?loai=${loai}`);
  const nhatKyCuoi = (actorId, action) => prisma.auditEvent.findFirst({ where: { actorId, action, resource: "quote", resourceId: String(q.id) }, orderBy: { id: "desc" } });

  beforeAll(async () => {
    app = (await import("../src/app.js")).createApp();
    admin = await user("admin", "admin");
    ketoan = await user("ketoan", "accountant");
    ketoanKhongTich = await user("ketoan2", "accountant", [P.INVOICE_PAGE, P.INVOICE_EDIT]);
    ngoai = await user("ngoai", "manager");
    chiPhi = await user("chiphi", "hr", [P.QUOTE_READ_OWN, P.QUOTE_INTERNAL_VIEW]);
    // Ma trận quyền XEM CHỨNG TỪ (chủ repo 2026-10-06: "admin, chủ báo giá, và người được thêm vào báo giá khi được cho phép").
    chu = await user("chu", "manager");                                                     // người tạo báo giá (không phải admin)
    tvHcm = await user("tvhcm", "manager");                                                 // thành viên được giao vùng Chi phí HCM
    tvMain = await user("tvmain", "manager");                                               // thành viên chỉ được giao báo giá chính
    xemChung = await user("xemchung", "hr", [P.QUOTE_READ_ALL, P.QUOTE_INTERNAL_VIEW]);       // xem chung mọi báo giá, không thuộc báo giá này
    hnU = await user("hn", "account_hn");
    companyId = (await prisma.company.create({ data: { code: `${TAG}CO`, name: "Cty thử", address: "1 Thử", quotePrefix: `V${`${Date.now()}`.slice(-6)}` } })).id;
    templateId = (await prisma.quoteTemplate.create({ data: { companyId, name: "Mẫu thử", code: `${TAG}k`, filePath: "templates/GN_KhongNgay.xlsx" } })).id;
    q = await prisma.quote.create({ data: {
      quoteNumber: `${TAG}-q`, projectCode: `${TAG}_q`, title: `${TAG} q`, searchText: TAG, toCompany: "Khách", companyId,
      fromContact: "x", fromAddress: "x", city: "TP. Hồ Chí Minh", quoteDate: new Date(), createdById: chu.id,
      hnStatus: "approved", hnReviewedAt: new Date("2026-09-25T01:00:00Z"), hnReviewerId: admin.id,
      hnTables: [{ name: "Giá HN", items: [hang("hn-1", "Thuê sàn HN", "VAT")] }],
      members: { create: [{ userId: chiPhi.id, scopes: [] }, { userId: hnU.id, scopes: ["hanoi"] }, { userId: tvHcm.id, scopes: ["hcm"] }, { userId: tvMain.id, scopes: ["main"] }] },
      sheets: { create: [{ templateId, order: 1, name: "Trang 1", codeNo: 1, extraTables: [
        { category: "hcm", name: "Chi phí HCM", items: [
          hang("v-sau", "Thuê xe (VAT, tích trước)", "VAT"),
          hang("v-truoc", "Thuê loa (VAT, HĐ trước)", "VAT"),
          hang("tm", "Nước uống (TM)", "TM"),
          hang("xoa", "Băng rôn (VAT, sẽ bị xoá)", "VAT"),
        ] },
      ] }] },
    } });
  }, 60_000);

  afterAll(async () => {
    const ids = (await prisma.quote.findMany({ where: { title: { startsWith: TAG } }, includeDeleted: true, select: { id: true } })).map((x) => x.id);
    const userIds = [admin, ketoan, ketoanKhongTich, ngoai, chiPhi, hnU, chu, tvHcm, tvMain, xemChung].filter(Boolean).map((u) => u.id);
    await prisma.inputInvoiceProof.deleteMany({ where: { entry: { quoteId: { in: ids } } } }).catch(() => {});
    await prisma.inputInvoiceEntry.deleteMany({ where: { quoteId: { in: ids } } }).catch(() => {});
    await prisma.auditEvent.deleteMany({ where: { OR: [{ actorId: { in: userIds } }, { resource: "quote", resourceId: { in: ids.map(String) } }] } }).catch(() => {});
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } }).catch(() => {});
    await prisma.quoteVersion.deleteMany({ where: { quoteId: { in: ids } } }).catch(() => {});
    await prisma.quote.deleteMany({ where: { id: { in: ids } }, hardDelete: true }).catch(() => {});
    await prisma.quoteTemplate.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.company.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.loginAttempt.deleteMany({ where: { username: { startsWith: TAG } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
  });

  it("đưa HĐ VAT TRƯỚC khi tích: 200, khoản chưa chi có HĐ (PDF), nhật ký quote.internal.vat không chép tệp; nội bộ thấy 'Có HĐ VAT · chưa TT'", async () => {
    const row = await ghiOk("sheet", "v-truoc", { vatProof: PDF_THAT });
    expect(row).toMatchObject({ paid: false, hasVatProof: true, vatProofByName: `${TAG} ketoan` });
    expect(row.proofs).toEqual([expect.objectContaining({ loai: "vat", mime: "application/pdf", hienTai: true })]);
    const ev = await nhatKyCuoi(ketoan.id, "quote.internal.vat");
    expect(ev?.after).toMatchObject({ rid: "v-truoc", vatProofId: row.proofs[0].id });
    expect(JSON.stringify({ b: ev?.before, a: ev?.after })).not.toContain("base64");
    const ds = (await xemDs(admin)).body;
    expect(ds.sheet.map((h) => h.rid), "chưa chi thì KHÔNG nằm trong danh sách đã chi (bundle cũ coi mọi phần tử là đã chi)").not.toContain("v-truoc");
    expect(ds.vatChuaChi.sheet).toEqual([expect.objectContaining({ rid: "v-truoc", laVat: true, coHdVat: true, coAnh: false, paidAt: null })]);
    expect(trangThaiVat("VAT", false, ds.vatChuaChi.sheet[0].coHdVat)).toBe("vat-chua-tt");
  });

  it("tích ĐÃ CHI + ảnh chưa có HĐ → 'Đã TT · chưa VAT'; đưa HĐ VAT SAU → 'đã có VAT'", async () => {
    await ghiOk("sheet", "v-sau", { paid: true, paidProof: ANH_THAT });
    let h = (await xemDs(admin)).body.sheet.find((x) => x.rid === "v-sau");
    expect(h).toMatchObject({ laVat: true, coHdVat: false, coAnh: true });
    expect(trangThaiVat("VAT", true, h.coHdVat)).toBe("chua-vat");
    await ghiOk("sheet", "v-sau", { vatProof: ANH_THAT });
    h = (await xemDs(admin)).body.sheet.find((x) => x.rid === "v-sau");
    expect(h).toMatchObject({ coHdVat: true });
    expect(Date.parse(h.hdVatLuc)).toBeGreaterThan(Date.now() - 600_000);
    expect(trangThaiVat("VAT", true, h.coHdVat)).toBe("da-vat");
    expect(JSON.stringify((await xemDs(admin)).body)).not.toMatch(/data:|base64/);
  });

  it("hàng TM → 409 khong-phai-vat; thiếu invoice:input:pay → 403; không ghi gì", async () => {
    const r = await ghi("sheet", "tm", { baseVersion: 0, vatProof: ANH_THAT });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("khong-phai-vat");
    const r2 = await ghi("sheet", "v-sau", { baseVersion: (await khoan("sheet", "v-sau")).version, vatProof: null }, ketoanKhongTich);
    expect(r2.status).toBe(403);
    expect((await khoan("sheet", "v-sau")).currentVatProofId).not.toBeNull();
  });

  it("bỏ tích KHÔNG rút HĐ VAT; thay / gỡ HĐ chỉ RÚT (tệp còn nguyên trong CSDL)", async () => {
    const e0 = await khoan("sheet", "v-sau");
    await ghiOk("sheet", "v-sau", { paid: false });
    const e1 = await khoan("sheet", "v-sau");
    expect(e1.currentVatProofId, "HĐ VAT độc lập với đã chi").toBe(e0.currentVatProofId);
    expect(e1.currentProofId).toBeNull();
    await ghiOk("sheet", "v-sau", { vatProof: PDF_THAT });
    const e2 = await khoan("sheet", "v-sau");
    expect(e2.currentVatProofId).not.toBe(e0.currentVatProofId);
    expect(await prisma.inputInvoiceProof.findUnique({ where: { id: e0.currentVatProofId } })).toMatchObject({ loai: "vat", retiredReason: "thay" });
    await ghiOk("sheet", "v-sau", { vatProof: null });
    expect((await khoan("sheet", "v-sau")).currentVatProofId).toBeNull();
    expect(await prisma.inputInvoiceProof.findUnique({ where: { id: e2.currentVatProofId } })).toMatchObject({ retiredReason: "go-anh" });
    expect(await prisma.inputInvoiceProof.count({ where: { entryId: e0.id, loai: "vat" } }), "không tệp nào bị xoá").toBe(2);
    // Đưa lại để các bài sau có HĐ hiện tại.
    await ghiOk("sheet", "v-sau", { paid: true, paidProof: ANH_THAT, vatProof: PDF_THAT });
  });

  it("nội bộ xem chứng từ HIỆN TẠI: admin + thành viên được giao vùng HCM 200 (ảnh / PDF), nhật ký proof-view noiBo", async () => {
    const a = await xemAnh(admin, "sheet", "v-sau", "chi");
    expect(a.status, JSON.stringify(a.body)).toBe(200);
    expect(a.body).toMatchObject({ loai: "chi", mime: "image/png" });
    expect(a.body.dataUrl.startsWith("data:image/png;base64,")).toBe(true);
    const v = await xemAnh(tvHcm, "sheet", "v-sau", "vat");
    expect(v.status, JSON.stringify(v.body)).toBe(200);
    expect(v.body).toMatchObject({ loai: "vat", mime: "application/pdf", uploadedByName: `${TAG} ketoan` });
    expect(v.body.dataUrl).toBe(PDF_THAT);
    const ev = await nhatKyCuoi(tvHcm.id, "quote.internal.proof-view");
    expect(ev?.after).toMatchObject({ side: "sheet", rid: "v-sau", loai: "vat", noiBo: true, proofId: (await khoan("sheet", "v-sau")).currentVatProofId });
    expect(JSON.stringify({ b: ev?.before, a: ev?.after })).not.toContain("base64");
  });

  it("account Hà Nội: phía hn 200, phía sheet 403", async () => {
    await ghiOk("hn", "hn-1", { paid: true, paidProof: ANH_THAT });
    const r = await xemAnh(hnU, "hn", "hn-1", "chi");
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect((await xemAnh(hnU, "sheet", "v-sau", "chi")).status).toBe(403);
    expect((await xemAnh(hnU, "sheet", "v-sau", "vat")).status).toBe(403);
  });

  it("THU HẸP: chủ báo giá 200; kế toán (không quote:read) 200 như ở trang Hóa đơn đầu vào; thành viên chỉ-xem / chỉ 'main' / người xem chung (quote:read:all + internal:view) → 403 + không nhật ký", async () => {
    for (const u of [chu, ketoan]) {
      const r = await xemAnh(u, "sheet", "v-sau", "vat");
      expect(r.status, `${u.username}: ${JSON.stringify(r.body)}`).toBe(200);
    }
    expect((await xemAnh(ketoan, "hn", "hn-1", "chi")).status).toBe(200);
    for (const u of [chiPhi, tvMain, xemChung]) {
      for (const [side, rid, loai] of [["sheet", "v-sau", "chi"], ["sheet", "v-sau", "vat"], ["hn", "hn-1", "chi"]]) {
        const r = await xemAnh(u, side, rid, loai);
        expect(r.status, `${u.username} ${side}/${rid}/${loai}`).toBe(403);
      }
      expect(await nhatKyCuoi(u.id, "quote.internal.proof-view"), `${u.username} không được ghi là đã xem`).toBeNull();
    }
    expect((await xemAnh(tvHcm, "hn", "hn-1", "chi")).status, "thành viên vùng HCM không xem chứng từ hàng Hà Nội").toBe(403);
  });

  it("GET /:id/khoan-chi báo cờ xemChungTu đúng người (để giao diện ẩn 📎 / 🧾); chữ trạng thái vẫn đủ cho người xem chung", async () => {
    const co = async (u) => { const r = await xemDs(u); expect(r.status).toBe(200); return Object.fromEntries([...r.body.sheet, ...r.body.hn].map((h) => [h.rid, h.xemChungTu])); };
    expect(await co(admin)).toMatchObject({ "v-sau": true, "hn-1": true });
    expect(await co(chu)).toMatchObject({ "v-sau": true, "hn-1": true });
    expect(await co(tvHcm)).toMatchObject({ "v-sau": true, "hn-1": false });
    expect(await co(hnU)).toEqual({ "hn-1": true });
    for (const u of [chiPhi, tvMain, xemChung]) expect(await co(u), u.username).toEqual({ "v-sau": false, "hn-1": false });
  });

  it("người ngoài 403, chưa đăng nhập 401 — không ghi nhật ký xem", async () => {
    expect((await xemAnh(ngoai, "sheet", "v-sau", "chi")).status).toBe(403);
    expect((await request(app).get(`/api/quotes/${q.id}/khoan-chi/sheet/v-sau/anh?loai=chi`)).status).toBe(401);
    expect(await nhatKyCuoi(ngoai.id, "quote.internal.proof-view")).toBeNull();
  });

  it("404: rid lạ, hàng chưa có tệp, ảnh ủy nhiệm chi của hàng CHƯA chi (ảnh đã rút), báo giá lạ", async () => {
    expect((await xemAnh(admin, "sheet", "khong-co", "chi")).status).toBe(404);
    expect((await xemAnh(admin, "sheet", "tm", "vat")).status).toBe(404);
    expect((await xemAnh(admin, "sheet", "v-truoc", "chi")).status).toBe(404);
    expect((await (await dn(admin)).get(`/api/quotes/999999999/khoan-chi/sheet/v-sau/anh?loai=chi`)).status).toBe(404);
  });

  it("đường Lưu báo giá xoá hàng CHƯA chi có HĐ VAT: 200, khoản + tệp còn nguyên; nội bộ không còn đường xem (404); kế toán vẫn thấy dòng", async () => {
    const e0 = (await khoan("sheet", "xoa")) ?? { version: 0 };
    await ghiOk("sheet", "xoa", { vatProof: ANH_THAT });
    const e = await khoan("sheet", "xoa");
    expect(e.version).toBeGreaterThan(e0.version ?? -1);
    // Từ 2026-10-06 hàng HCM ĐÃ DUYỆT không ai xoá được (409 'hang-hcm-da-khoa') — người duyệt bỏ tích trước (mô phỏng ở CSDL).
    for (const s of await prisma.quoteSheet.findMany({ where: { quoteId: q.id } })) {
      if (!Array.isArray(s.extraTables)) continue;
      await prisma.quoteSheet.update({ where: { id: s.id }, data: { extraTables: s.extraTables.map((t) => ({ ...t, items: (t.items || []).map((it) => (it.rid === "xoa" ? { ...it, approved: false } : it)) })) } });
    }
    const qq = await prisma.quote.findFirst({ where: { id: q.id }, include: { sheets: { orderBy: [{ order: "asc" }, { id: "asc" }], include: { items: { orderBy: { order: "asc" } } } } } });
    const than = {
      baseUpdatedAt: qq.updatedAt.toISOString(),
      sheets: qq.sheets.map((s) => ({
        id: s.id, templateId: s.templateId, name: s.name, order: s.order,
        items: s.items.map((it) => ({ kind: it.kind, name: it.name, quantity: Number(it.quantity), unitPrice: Number(it.unitPrice), order: it.order })),
        extraTables: structuredClone(s.extraTables).map((t) => ({ ...t, items: t.items.filter((it) => it.rid !== "xoa") })),
      })),
    };
    const luu = await (await dn(admin)).put(`/api/quotes/${q.id}`).send(than);
    expect(luu.status, JSON.stringify(luu.body)).toBe(200);
    const sau = await khoan("sheet", "xoa");
    expect(sau.currentVatProofId, "đường Lưu không ghi bảng khoản (KT-1)").toBe(e.currentVatProofId);
    expect(await prisma.inputInvoiceProof.findUnique({ where: { id: e.currentVatProofId } })).toMatchObject({ retiredAt: null, loai: "vat" });
    expect((await xemAnh(admin, "sheet", "xoa", "vat")).status, "khoản mồ côi: hàng không còn hiện ở bảng nội bộ").toBe(404);
    const ds = await (await dn(ketoan)).get("/api/quotes/input-invoices");
    const d = ds.body.data.find((x) => x.key === `${q.id}:sheet:xoa`);
    expect(d).toMatchObject({ trangThaiHang: "khong-con-hang", hasVatProof: true });
    expect(JSON.stringify(ds.body), "danh sách không mang tệp").not.toMatch(/data:(image|application)/);
  });
});
