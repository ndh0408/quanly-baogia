// CỘT "THANH TOÁN" CHỈ XEM ở bảng nội bộ của màn soạn / Account HN — GET /api/quotes/:id/khoan-chi (chủ repo 2026-10-06:
// "cái thanh toán hiện đã thanh toán ở đây ngày như nào chứ, và bên hóa đơn đầu vào là chỗ đó cho kế toán up hình").
//
// ── BÀI NÀY KHOÁ GÌ (HTTP + CSDL thật) ───────────────────────────────────────────────────────────────
//   · Trạng thái HIỆU LỰC (KT-3): khoản kế toán thắng cờ JSON cũ — kể cả khoản đã BỎ tích; hàng chưa có khoản thì cờ JSON
//     cũ (tên người tích tra từ paidById). Trả đúng ngày + tên người tích + cờ có ảnh; hàng chưa chi không có mặt.
//   · QUYỀN = GET /api/quotes/:id: người ngoài 403, kế toán (không có quote:read) 403, id lạ 404, chưa đăng nhập 401;
//     account HN chỉ thấy phía "hn" (đúng phần GET /:id trả cho họ).
//   · Không lộ ảnh chứng từ / ghi chú kế toán / Ngày HĐ cho bất kỳ ai qua đường này.
//   · Khớp lớp phủ của GET /:id (một luật, hai đường đọc).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { agentWithCsrf } from "./helpers/agent.js";
import { prisma } from "../src/db.js";
import { PERMISSIONS as P } from "../src/permissions.js";
import { daChiTheoRid } from "../src/khoanChi.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "Quote" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");

const TAG = `hddvxem${Date.now()}`;
const PWD = "Test1234!a";
const GHI_CHU_RIENG = `${TAG} ghi chú kế toán riêng`;
const ANH_THAT =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

describe("daChiTheoRid — luật thuần", () => {
  const khoan = new Map([["sheet:a", { paid: true, paidAt: new Date("2026-10-06T02:00:00Z"), paidById: 9, paidByName: "Kế toán", currentProofId: 3 }],
    ["sheet:b", { paid: false, paidAt: null, paidById: null, paidByName: null, currentProofId: null }]]);
  const bang = [{ category: "hcm", items: [
    { kind: "section", name: "Nhóm", rid: "s" },
    { kind: "item", rid: "a", name: "A" },
    { kind: "item", rid: "b", name: "B", paid: true, paidAt: "2026-09-01T00:00:00Z" },   // khoản đã BỎ tích thắng cờ cũ
    { kind: "item", rid: "c", name: "C", paid: true, paidAt: "2026-09-02T00:00:00Z", paidById: 5 },   // chỉ cờ JSON cũ
    { kind: "item", rid: "a", name: "A trùng", paid: false },   // rid trùng: chỉ bản đầu
    { kind: "item", name: "Thiếu rid", paid: true },
    { kind: "item", rid: "d", name: "D" },
  ] }, { category: "hanoi", items: [{ kind: "item", rid: "z", paid: true }] }];
  it("khoản thắng cờ JSON cũ; chỉ hàng đã chi; bỏ nhóm / thiếu rid / bản trùng / bảng hanoi cũ trong trang", () => {
    expect(daChiTheoRid("sheet", bang, khoan)).toEqual([
      { rid: "a", paidAt: "2026-10-06T02:00:00.000Z", paidByName: "Kế toán", coAnh: true, paidById: 9, laVat: false, coHdVat: false, hdVatLuc: null },
      { rid: "c", paidAt: "2026-09-02T00:00:00.000Z", paidByName: null, coAnh: false, paidById: 5, laVat: false, coHdVat: false, hdVatLuc: null },
    ]);
  });
});

describe.runIf(dbAvailable)("GET /api/quotes/:id/khoan-chi — đã chi từng hàng, chỉ xem", () => {
  let app, companyId, templateId, q;
  let admin, ketoan, ngoai, chiPhi, hnU;
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
  const ghi = async (side, rid, body) => {
    const kt = await dn(ketoan);
    const r = await kt.put(`/api/quotes/input-invoices/${q.id}/${side}/${rid}`).send(body);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return r;
  };
  const xem = async (u) => (await dn(u)).get(`/api/quotes/${q.id}/khoan-chi`);

  beforeAll(async () => {
    app = (await import("../src/app.js")).createApp();
    admin = await user("admin", "admin");
    ketoan = await user("ketoan", "accountant");
    ngoai = await user("ngoai", "manager");
    chiPhi = await user("chiphi", "hr", [P.QUOTE_READ_OWN, P.QUOTE_INTERNAL_VIEW]);
    hnU = await user("hn", "account_hn");
    companyId = (await prisma.company.create({ data: { code: `${TAG}CO`, name: "Cty thử", address: "1 Thử", quotePrefix: `X${`${Date.now()}`.slice(-6)}` } })).id;
    templateId = (await prisma.quoteTemplate.create({ data: { companyId, name: "Mẫu thử", code: `${TAG}k`, filePath: "templates/GN_KhongNgay.xlsx" } })).id;
    q = await prisma.quote.create({ data: {
      quoteNumber: `${TAG}-q`, projectCode: `${TAG}_q`, title: `${TAG} q`, searchText: TAG, toCompany: "Khách", companyId,
      fromContact: "x", fromAddress: "x", city: "TP. Hồ Chí Minh", quoteDate: new Date(), createdById: admin.id,
      hnStatus: "approved", hnReviewedAt: new Date("2026-09-25T01:00:00Z"), hnReviewerId: admin.id,
      hnTables: [{ name: "Giá HN", items: [hang("hn-1", "Thuê sàn HN"), hang("hn-2", "Chưa chi HN")] }],
      members: { create: [{ userId: chiPhi.id, scopes: [] }, { userId: hnU.id, scopes: ["hanoi"] }] },
      sheets: { create: [{ templateId, order: 1, name: "Trang 1", codeNo: 1, extraTables: [
        { category: "hcm", name: "Chi phí HCM", items: [
          { kind: "section", name: "Nhóm A", quantity: 0, unitPrice: 0 },
          hang("r-tich", "Thuê xe"),
          hang("r-json", "Đã trả từ trước", { paid: true, paidAt: "2026-09-15T04:00:00.000Z", paidById: admin.id, paidProof: ANH_THAT }),
          hang("r-bo", "Đã trả cũ, kế toán bỏ tích", { paid: true, paidAt: "2026-09-16T04:00:00.000Z", paidById: admin.id }),
          hang("r-chua", "Chưa chi"),
        ] },
      ] }] },
    } });
    await ghi("sheet", "r-tich", { baseVersion: 0, paid: true, paidProof: ANH_THAT, accountingNote: GHI_CHU_RIENG, invoiceDate: "2026-10-01" });
    await ghi("sheet", "r-bo", { baseVersion: 0, paid: false });
    await ghi("hn", "hn-1", { baseVersion: 0, paid: true });
  }, 60_000);

  afterAll(async () => {
    const ids = (await prisma.quote.findMany({ where: { title: { startsWith: TAG } }, includeDeleted: true, select: { id: true } })).map((x) => x.id);
    const userIds = [admin, ketoan, ngoai, chiPhi, hnU].filter(Boolean).map((u) => u.id);
    await prisma.inputInvoiceProof.deleteMany({ where: { entry: { quoteId: { in: ids } } } }).catch(() => {});
    await prisma.inputInvoiceEntry.deleteMany({ where: { quoteId: { in: ids } } }).catch(() => {});
    await prisma.auditEvent.deleteMany({ where: { OR: [{ actorId: { in: userIds } }, { resource: "quote", resourceId: { in: ids.map(String) } }] } }).catch(() => {});
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } }).catch(() => {});
    await prisma.quote.deleteMany({ where: { id: { in: ids } }, hardDelete: true }).catch(() => {});
    await prisma.quoteTemplate.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.company.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.loginAttempt.deleteMany({ where: { username: { startsWith: TAG } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
  });

  it("admin: trạng thái HIỆU LỰC — khoản thắng cờ cũ, cờ cũ còn hiện khi chưa có khoản; ngày + tên người tích + cờ ảnh", async () => {
    const r = await xem(admin);
    expect(r.status).toBe(200);
    expect(r.body.quoteId).toBe(q.id);
    const sheet = Object.fromEntries(r.body.sheet.map((x) => [x.rid, x]));
    expect(Object.keys(sheet).sort(), "hàng chưa chi / đã bỏ tích không được hiện là đã chi").toEqual(["r-json", "r-tich"]);
    expect(sheet["r-tich"]).toMatchObject({ paidByName: `${TAG} ketoan`, coAnh: true });
    expect(Date.parse(sheet["r-tich"].paidAt)).toBeGreaterThan(Date.now() - 600_000);
    expect(sheet["r-json"]).toEqual({ rid: "r-json", paidAt: "2026-09-15T04:00:00.000Z", paidByName: `${TAG} admin`, coAnh: true, laVat: false, coHdVat: false, hdVatLuc: null });
    expect(r.body.hn.map((x) => x.rid)).toEqual(["hn-1"]);
    expect(r.body.hn[0]).toMatchObject({ paidByName: `${TAG} ketoan`, coAnh: false });
  });

  it("không mang ảnh, ghi chú kế toán, Ngày HĐ, version, id người", async () => {
    const txt = JSON.stringify((await xem(admin)).body);
    expect(txt).not.toContain("data:image");
    expect(txt).not.toContain(GHI_CHU_RIENG);
    expect(txt).not.toMatch(/invoiceDate|accountingNote|version|paidById|paidProof|2026-10-01/);
  });

  it("khớp lớp phủ của GET /api/quotes/:id (một luật cho hai đường đọc)", async () => {
    const a = await dn(admin);
    const full = (await a.get(`/api/quotes/${q.id}`)).body;
    const daChiGet = full.sheets.flatMap((s) => s.extraTables).flatMap((t) => t.items).filter((it) => it.paid === true).map((it) => it.rid).sort();
    expect(daChiGet).toEqual((await xem(admin)).body.sheet.map((x) => x.rid).sort());
  });

  it("thành viên chỉ xem nội bộ (tài khoản chi phí) đọc được cả hai phía", async () => {
    const r = await xem(chiPhi);
    expect(r.status).toBe(200);
    expect(r.body.sheet.map((x) => x.rid).sort()).toEqual(["r-json", "r-tich"]);
    expect(r.body.hn.map((x) => x.rid)).toEqual(["hn-1"]);
  });

  it("account Hà Nội: chỉ phía hn — đúng phần GET /:id trả cho họ", async () => {
    const r = await xem(hnU);
    expect(r.status).toBe(200);
    expect(r.body.sheet).toEqual([]);
    expect(r.body.hn.map((x) => x.rid)).toEqual(["hn-1"]);
  });

  it("người ngoài báo giá 403, kế toán (không có quote:read) 403, id lạ 404, chưa đăng nhập 401", async () => {
    expect((await xem(ngoai)).status).toBe(403);
    expect((await xem(ketoan)).status).toBe(403);
    expect((await (await dn(admin)).get("/api/quotes/999999999/khoan-chi")).status).toBe(404);
    expect((await request(app).get(`/api/quotes/${q.id}/khoan-chi`)).status).toBe(401);
  });
});
