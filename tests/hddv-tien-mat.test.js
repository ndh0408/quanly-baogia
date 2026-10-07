// HÌNH THỨC THANH TOÁN của khoản chi (chủ repo 2026-10-07: "cái thanh toán hóa đơn đầu vào có khi là tiền mặt ấy nhen").
//
// ── BÀI NÀY KHOÁ GÌ ──────────────────────────────────────────────────────────────────────────────────────
//   · Luật thuần: hinhThucHieuLuc (chưa chi → null; NULL / lạ → chuyển khoản), DTO + khoanXemTheoRid mang hình thức hiệu lực.
//   · Migration CHỈ THÊM: một ADD COLUMN NULL, lock_timeout, không UPDATE / DELETE / DROP.
//   · PUT khoản chi `paidMethod`: tích + tiền mặt KHÔNG cần ảnh; ảnh phiếu chi vẫn đính được; đổi hình thức sau khi tích (ảnh
//     giữ nguyên, tiền không đổi); bỏ tích xoá hình thức; khoản tích không gửi hình thức (bundle cũ) = NULL = chuyển khoản;
//     giá trị lạ / kèm bỏ tích / khoản chưa chi → 400 và không ghi gì; thiếu invoice:input:pay → 403.
//   · Nhật ký: before/after mang hình thức HIỆU LỰC — đổi hình thức đọc được "chuyen-khoan → tien-mat".
//   · GET /:id/khoan-chi (cột Thanh toán nội bộ) và GET /input-invoices (trang kế toán) trả hình thức.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { agentWithCsrf } from "./helpers/agent.js";
import { prisma } from "../src/db.js";
import { PERMISSIONS as P } from "../src/permissions.js";
import { hinhThucHieuLuc, dtoKhoanChi, khoanXemTheoRid } from "../src/khoanChi.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "Quote" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");

const TAG = `hddvtm${Date.now()}`;
const PWD = "Test1234!a";
const ANH_THAT =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

describe("luật thuần — hình thức chi", () => {
  it("hinhThucHieuLuc: chưa chi → null; NULL / vắng / lạ → chuyển khoản (khoản cũ y như cũ); tiền mặt giữ", () => {
    expect(hinhThucHieuLuc(false, "tien-mat")).toBeNull();
    expect(hinhThucHieuLuc(true, null)).toBe("chuyen-khoan");
    expect(hinhThucHieuLuc(true, undefined)).toBe("chuyen-khoan");
    expect(hinhThucHieuLuc(true, "TM")).toBe("chuyen-khoan");
    expect(hinhThucHieuLuc(true, "tien-mat")).toBe("tien-mat");
  });

  it("dtoKhoanChi + khoanXemTheoRid mang hình thức HIỆU LỰC; cờ JSON cũ (chưa có khoản) = chuyển khoản", () => {
    const e = { id: 1, quoteId: 1, side: "sheet", rid: "a", paid: true, paidAt: new Date(), paidById: 1, paidByName: "KT", paidMethod: "tien-mat",
      paidSnapshot: null, currentProofId: null, invoiceDate: null, accountingNote: null, rowSnapshot: {}, legacySeed: null, source: "trang", version: 1, updatedAt: null, updatedByName: null };
    expect(dtoKhoanChi({ quoteId: 1, side: "sheet", rid: "a", entry: e }).paidMethod).toBe("tien-mat");
    expect(dtoKhoanChi({ quoteId: 1, side: "sheet", rid: "a", entry: { ...e, paid: false } }).paidMethod).toBeNull();
    expect(dtoKhoanChi({ quoteId: 1, side: "sheet", rid: "a", itJson: { paid: true, paidAt: "2026-09-01T00:00:00Z" } }).paidMethod).toBe("chuyen-khoan");
    const bang = [{ category: "hcm", items: [{ kind: "item", rid: "a" }, { kind: "item", rid: "b", paid: true }] }];
    const kq = khoanXemTheoRid("sheet", bang, new Map([["sheet:a", e]]));
    expect(kq.map((h) => [h.rid, h.paidMethod])).toEqual([["a", "tien-mat"], ["b", "chuyen-khoan"]]);
  });
});

describe("migration 20261007090000_input_invoice_paid_method — CHỈ THÊM", () => {
  const sql = readFileSync(fileURLToPath(new URL("../prisma/migrations/20261007090000_input_invoice_paid_method/migration.sql", import.meta.url)), "utf8");
  const lenh = sql.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
  it("một ADD COLUMN NULL (không DEFAULT, không NOT NULL), có lock_timeout, không UPDATE / DELETE / DROP / ALTER TYPE", () => {
    expect(lenh).toMatch(/SET lock_timeout = '10s';/);
    expect(lenh).toMatch(/ALTER TABLE "InputInvoiceEntry" ADD COLUMN "paidMethod" TEXT;/);
    expect(lenh).not.toMatch(/\b(UPDATE|DELETE|DROP|TRUNCATE|DEFAULT|NOT NULL)\b|ALTER\s+COLUMN|TYPE\s/i);
  });
});

describe.runIf(dbAvailable)("hình thức thanh toán của khoản chi — máy chủ", () => {
  let app, companyId, templateId, q;
  let admin, ketoan, ketoanKhongTich;
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
  const hang = (rid, name, chungTu) => ({ kind: "item", rid, name, quantity: 1, unitPrice: 100000, chungTu, approved: true, approvedAt: "2026-09-20T03:00:00.000Z", approvedBy: null });
  const khoan = (rid) => prisma.inputInvoiceEntry.findUnique({ where: { quoteId_side_rid: { quoteId: q.id, side: "sheet", rid } } });
  const ghi = async (rid, body, u = ketoan) => (await dn(u)).put(`/api/quotes/input-invoices/${q.id}/sheet/${rid}`).send(body);
  const ghiOk = async (rid, body) => {
    const e = await khoan(rid);
    const r = await ghi(rid, { baseVersion: e?.version ?? 0, ...body });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return r.body.row;
  };
  const nhatKyCuoi = (action) => prisma.auditEvent.findFirst({ where: { actorId: ketoan.id, action, resource: "quote", resourceId: String(q.id) }, orderBy: { id: "desc" } });
  const noiBo = async (rid) => (await (await dn(admin)).get(`/api/quotes/${q.id}/khoan-chi`)).body.sheet.find((h) => h.rid === rid);

  beforeAll(async () => {
    app = (await import("../src/app.js")).createApp();
    admin = await user("admin", "admin");
    ketoan = await user("ketoan", "accountant");
    ketoanKhongTich = await user("ketoan2", "accountant", [P.INVOICE_PAGE, P.INVOICE_EDIT]);
    companyId = (await prisma.company.create({ data: { code: `${TAG}CO`, name: "Cty thử", address: "1 Thử", quotePrefix: `T${`${Date.now()}`.slice(-6)}` } })).id;
    templateId = (await prisma.quoteTemplate.create({ data: { companyId, name: "Mẫu thử", code: `${TAG}k`, filePath: "templates/GN_KhongNgay.xlsx" } })).id;
    q = await prisma.quote.create({ data: {
      quoteNumber: `${TAG}-q`, projectCode: `${TAG}_q`, title: `${TAG} q`, searchText: TAG, toCompany: "Khách", companyId,
      fromContact: "x", fromAddress: "x", city: "TP. Hồ Chí Minh", quoteDate: new Date(), createdById: admin.id,
      sheets: { create: [{ templateId, order: 1, name: "Trang 1", codeNo: 1, extraTables: [
        { category: "hcm", name: "Chi phí HCM", items: [
          hang("tm", "Nước uống (TM)", "TM"),
          hang("ck", "Thuê xe (VAT)", "VAT"),
          hang("cu", "Băng rôn (bundle cũ)", "HDNS"),
          hang("chua", "Loa (chưa chi)", "VAT"),
        ] },
      ] }] },
    } });
  }, 60_000);

  afterAll(async () => {
    const ids = (await prisma.quote.findMany({ where: { title: { startsWith: TAG } }, includeDeleted: true, select: { id: true } })).map((x) => x.id);
    const userIds = [admin, ketoan, ketoanKhongTich].filter(Boolean).map((u) => u.id);
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

  it("tích ĐÃ CHI + TIỀN MẶT, KHÔNG ảnh → 200; CSDL 'tien-mat'; nhật ký pay mang hình thức; nội bộ + trang kế toán thấy tiền mặt", async () => {
    const row = await ghiOk("tm", { paid: true, paidMethod: "tien-mat" });
    expect(row).toMatchObject({ paid: true, paidMethod: "tien-mat", hasPaidProof: false });
    expect((await khoan("tm")).paidMethod).toBe("tien-mat");
    const ev = await nhatKyCuoi("quote.internal.pay");
    expect(ev?.after).toMatchObject({ rid: "tm", paid: true, paidMethod: "tien-mat" });
    expect(ev?.before).toMatchObject({ paid: false, paidMethod: null });
    expect(await noiBo("tm")).toMatchObject({ paidMethod: "tien-mat", coAnh: false });
    const ds = await (await dn(ketoan)).get("/api/quotes/input-invoices");
    expect(ds.status).toBe(200);
    expect(ds.body.data.find((r) => r.quoteId === q.id && r.rid === "tm")).toMatchObject({ paid: true, paidMethod: "tien-mat", hasPaidProof: false });
    expect(ds.body.data.find((r) => r.quoteId === q.id && r.rid === "chua")).toMatchObject({ paid: false, paidMethod: null });
  });

  it("tiền mặt vẫn đính được ảnh PHIẾU CHI (tuỳ chọn); đổi sang chuyển khoản: ảnh GIỮ NGUYÊN, nhật ký ke-toan 'tien-mat → chuyen-khoan'", async () => {
    await ghiOk("tm", { paidProof: ANH_THAT });
    const e0 = await khoan("tm");
    expect(e0.currentProofId).not.toBeNull();
    const row = await ghiOk("tm", { paidMethod: "chuyen-khoan" });
    expect(row).toMatchObject({ paid: true, paidMethod: "chuyen-khoan", hasPaidProof: true });
    const e1 = await khoan("tm");
    expect(e1).toMatchObject({ paidMethod: "chuyen-khoan", currentProofId: e0.currentProofId, paidAt: e0.paidAt, version: e0.version + 1 });
    expect(e1.paidSnapshot, "đổi hình thức không chụp lại số tiền").toEqual(e0.paidSnapshot);
    expect(await prisma.inputInvoiceProof.count({ where: { entryId: e0.id, retiredAt: { not: null } } }), "không ảnh nào bị rút").toBe(0);
    const ev = await nhatKyCuoi("quote.internal.ke-toan");
    expect(ev?.before).toMatchObject({ paidMethod: "tien-mat" });
    expect(ev?.after).toMatchObject({ paidMethod: "chuyen-khoan" });
    expect(JSON.stringify({ b: ev?.before, a: ev?.after })).not.toContain("base64");
    await ghiOk("tm", { paidMethod: "tien-mat" });
  });

  it("tích KHÔNG gửi hình thức (bundle cũ còn mở) → cột NULL, đọc là chuyển khoản ở cả DTO lẫn nội bộ", async () => {
    const row = await ghiOk("cu", { paid: true });
    expect((await khoan("cu")).paidMethod).toBeNull();
    expect(row.paidMethod).toBe("chuyen-khoan");
    expect(await noiBo("cu")).toMatchObject({ paidMethod: "chuyen-khoan" });
    await ghiOk("ck", { paid: true, paidMethod: "chuyen-khoan" });
    expect((await khoan("ck")).paidMethod).toBe("chuyen-khoan");
  });

  it("bỏ tích → xoá hình thức (như paidAt); nhật ký unpay 'tien-mat → (trống)'", async () => {
    const row = await ghiOk("tm", { paid: false });
    expect(row).toMatchObject({ paid: false, paidMethod: null });
    expect(await khoan("tm")).toMatchObject({ paid: false, paidAt: null, paidMethod: null });
    const ev = await nhatKyCuoi("quote.internal.unpay");
    expect(ev?.before).toMatchObject({ paidMethod: "tien-mat" });
    expect(ev?.after).toMatchObject({ paidMethod: null });
  });

  it("từ chối: giá trị lạ / null → 400; kèm bỏ tích → 400; khoản CHƯA chi → 400 chua-danh-dau; thiếu invoice:input:pay → 403 — không ghi gì", async () => {
    const truoc = await khoan("ck");
    for (const paidMethod of ["tienmat", "TM", "", null, 1]) {
      const r = await ghi("ck", { baseVersion: truoc.version, paidMethod });
      expect(r.status, `paidMethod=${JSON.stringify(paidMethod)}`).toBe(400);
    }
    expect((await ghi("ck", { baseVersion: truoc.version, paid: false, paidMethod: "tien-mat" })).status).toBe(400);
    const r = await ghi("chua", { baseVersion: 0, paidMethod: "tien-mat" });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("chua-danh-dau");
    const r2 = await ghi("ck", { baseVersion: truoc.version, paidMethod: "tien-mat" }, ketoanKhongTich);
    expect(r2.status).toBe(403);
    expect(await khoan("ck")).toMatchObject({ paid: true, paidMethod: "chuyen-khoan", version: truoc.version });
    expect((await khoan("chua"))?.paidMethod ?? null).toBeNull();
  });
});
