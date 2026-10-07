/**
 * KHOÁ HÀNG CHI PHÍ HCM / PHÍ KHÁCH HÀNG ĐÃ DUYỆT (chủ repo 2026-10-06: "khoá HCM như HN" — "cái nào đã duyệt thì không
 * cho sửa"). Trên CSDL thật, qua đúng các đường Lưu:
 *   · hàng đã duyệt KHÔNG AI sửa / xoá được — kể cả admin (người có quyền duyệt) → 409 'hang-hcm-da-khoa', CSDL nguyên;
 *   · bỏ tích Duyệt (người có quyền) trong cùng lần Lưu, hoặc trước đó → sửa / xoá được;
 *   · NS · Chứng từ · Lưu kho (theo dõi sau duyệt) của hàng đã duyệt vẫn cập nhật được bởi chủ báo giá;
 *   · account phụ chỉ có vùng HCM (đường ghiVungNoiBoDuocGiao) cũng bị khoá;
 *   · dữ liệu CŨ đã duyệt (ghi thẳng vào CSDL, không migration) bị khoá như nhau, tiền không đổi.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import { agentWithCsrf } from "./helpers/agent.js";
import { prisma } from "../src/db.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "Quote" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");

const TAG = `hcmk${Date.now()}`;
const PWD = "Test1234!a";

describe.runIf(dbAvailable)("Chi phí HCM / Phí KH — hàng ĐÃ DUYỆT bị khoá ở máy chủ", () => {
  let app, chuU, adminU, phuU, companyId, templateId, quoteId;
  const dangNhap = async (u) => {
    const a = agentWithCsrf(app);
    expect((await a.post("/api/auth/login").send({ username: u.username, password: PWD })).status).toBe(200);
    return a;
  };
  const taoUser = (ten, role) => bcrypt.hash(PWD, 4).then((passwordHash) => prisma.user.create({ data: { username: `${TAG}-${ten}`, displayName: `${TAG} ${ten}`, role, passwordHash } }));
  const hangDb = async (rid) => (await prisma.quoteSheet.findMany({ where: { quoteId } })).flatMap((s) => (s.extraTables || []).flatMap((t) => t.items || [])).find((it) => it.rid === rid);
  const nhuClient = (q) => ({ ...q, sheets: (q.sheets || []).map((s) => ({ ...s, extraTables: Array.isArray(s.extraTables) ? s.extraTables : [] })) });
  /** Lưu báo giá với `sua(items)` áp lên bảng HCM của trang đầu. */
  const luu = async (ag, sua) => {
    const q = nhuClient((await ag.get(`/api/quotes/${quoteId}`)).body);
    const bang = q.sheets[0].extraTables.find((t) => t.category === "hcm");
    sua(bang.items, bang);
    return ag.put(`/api/quotes/${quoteId}`).send({ ...q, baseUpdatedAt: q.updatedAt });
  };
  const tim = (items, rid) => items.find((x) => x.rid === rid);

  beforeAll(async () => {
    app = (await import("../src/app.js")).createApp();
    chuU = await taoUser("chu", "manager");
    adminU = await taoUser("admin", "admin");
    phuU = await taoUser("phu", "manager");
    companyId = (await prisma.company.create({ data: { code: `${TAG}CO`, name: "Cty", address: "1 Thử", quotePrefix: `K${`${Date.now()}`.slice(-6)}` } })).id;
    templateId = (await prisma.quoteTemplate.create({ data: { companyId, name: "Mẫu", code: `${TAG}k`, filePath: "templates/GN_KhongNgay.xlsx" } })).id;
    // DỮ LIỆU CŨ: hàng đã duyệt ghi thẳng vào CSDL (đúng hình dạng production) — không migration nào chạm tới nó.
    const hang = (rid, name, approved) => ({ kind: "item", rid, name, quantity: 1, unitPrice: 1000, days: null, approved, approvedAt: approved ? "2026-09-20T03:00:00.000Z" : null, approvedBy: approved ? 1 : null, paid: false, paidAt: null, paidById: null, paidProof: null, ns: null, luuKho: false, chungTu: null });
    const q = await prisma.quote.create({ data: {
      quoteNumber: `${TAG}-1`, title: `${TAG} bg`, searchText: TAG, toCompany: "Khách", companyId, fromContact: "x", fromAddress: "x",
      city: "TP. Hồ Chí Minh", quoteDate: new Date(), createdById: chuU.id, status: "draft", subtotal: 1000, total: 1000,
      members: { create: [{ userId: chuU.id, scopes: ["main", "hcm", "hanoi", "khach"] }, { userId: phuU.id, scopes: ["hcm"] }] },
      sheets: { create: [{ name: "Trang 1", order: 0, codeNo: 1, templateId,
        items: { create: [{ order: 1, kind: "item", name: "Hạng mục", quantity: 1, unitPrice: 1000 }] },
        extraTables: [{ category: "hcm", name: "HCM", templateId: null, groupSubtotal: false, items: [hang("d1", "Thuê xe", true), hang("d2", "Băng rôn", true), hang("c1", "Nước", false)] }] }] },
    } });
    quoteId = q.id;
  }, 60_000);

  afterAll(async () => {
    const ids = [chuU, adminU, phuU].filter(Boolean).map((u) => u.id);
    await prisma.auditEvent.deleteMany({ where: { actorId: { in: ids } } }).catch(() => {});
    await prisma.notification.deleteMany({ where: { userId: { in: ids } } }).catch(() => {});
    await prisma.quote.deleteMany({ where: { title: { startsWith: TAG } }, hardDelete: true, includeDeleted: true }).catch(() => {});
    await prisma.quoteTemplate.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.company.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.loginAttempt.deleteMany({ where: { username: { startsWith: TAG } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true, includeDeleted: true }).catch(() => {});
  });

  it("chủ (không có quyền duyệt) VÀ admin (có quyền duyệt) sửa tiền / tên hàng đã duyệt → 409 'hang-hcm-da-khoa', CSDL nguyên", async () => {
    for (const u of [chuU, adminU]) {
      const ag = await dangNhap(u);
      for (const sua of [(items) => { tim(items, "d1").unitPrice = 9999; }, (items) => { tim(items, "d1").name = "Thuê xe (đổi)"; }]) {
        const r = await luu(ag, sua);
        expect(r.status, `${u.username}: ${JSON.stringify(r.body).slice(0, 200)}`).toBe(409);
        expect(r.body.code).toBe("hang-hcm-da-khoa");
      }
    }
    expect(await hangDb("d1")).toMatchObject({ unitPrice: 1000, name: "Thuê xe", approved: true });
  });

  it("XOÁ hàng đã duyệt → 409 (kể cả admin); hàng chưa duyệt sửa / xoá tự do", async () => {
    const admin = await dangNhap(adminU);
    const xoa = await luu(admin, (items, bang) => { bang.items = items.filter((x) => x.rid !== "d2"); });
    expect(xoa.status).toBe(409);
    expect(await hangDb("d2")).toBeTruthy();
    const chu = await dangNhap(chuU);
    const ok = await luu(chu, (items) => { tim(items, "c1").unitPrice = 500; });
    expect(ok.status, JSON.stringify(ok.body).slice(0, 200)).toBe(200);
    expect((await hangDb("c1")).unitPrice).toBe(500);
  });

  it("NS · Chứng từ · Lưu kho của hàng đã duyệt: chủ cập nhật được; tiền vẫn khoá", async () => {
    const chu = await dangNhap(chuU);
    const r = await luu(chu, (items) => { Object.assign(tim(items, "d1"), { ns: "Đã hoàn ứng", chungTu: "VAT", luuKho: true }); });
    expect(r.status, JSON.stringify(r.body).slice(0, 200)).toBe(200);
    expect(await hangDb("d1")).toMatchObject({ ns: "Đã hoàn ứng", chungTu: "VAT", luuKho: true, approved: true, unitPrice: 1000 });
  });

  it("account phụ chỉ có vùng HCM (đường ghi riêng) sửa hàng đã duyệt → 409", async () => {
    const phu = await dangNhap(phuU);
    const q = nhuClient((await phu.get(`/api/quotes/${quoteId}`)).body);
    const bang = q.sheets[0].extraTables.find((t) => t.category === "hcm");
    tim(bang.items, "d2").unitPrice = 7;
    const r = await phu.put(`/api/quotes/${quoteId}`).send({ sheets: q.sheets, baseUpdatedAt: q.updatedAt });
    expect(r.status, JSON.stringify(r.body).slice(0, 200)).toBe(409);
    expect(r.body.code).toBe("hang-hcm-da-khoa");
    expect((await hangDb("d2")).unitPrice).toBe(1000);
  });

  it("BỎ DUYỆT (người có quyền) trong cùng lần Lưu → sửa được; lần sau xoá được", async () => {
    const admin = await dangNhap(adminU);
    const r = await luu(admin, (items) => { Object.assign(tim(items, "d1"), { approved: false, unitPrice: 1500 }); });
    expect(r.status, JSON.stringify(r.body).slice(0, 200)).toBe(200);
    expect(await hangDb("d1")).toMatchObject({ approved: false, unitPrice: 1500 });
    const xoa = await luu(admin, (items, bang) => { bang.items = items.filter((x) => x.rid !== "d1"); });
    expect(xoa.status).toBe(200);
    expect(await hangDb("d1")).toBeUndefined();
  });
});
