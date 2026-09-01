// LỊCH SỬ PHIÊN BẢN rò rỉ TOÀN BỘ báo giá cho người chỉ được xem một phần — chốt hồi quy.
//
// ── LỖI ─────────────────────────────────────────────────────────────────────
// `GET /api/quotes/:id` CÓ lược theo quyền:
//     presentQuote(quote, { hnOnly: can(QUOTE_HN_FILL), internalOnly: can(QUOTE_INTERNAL_VIEW) })
// `presentQuoteForAccountHn` chỉ trả bảng "hanoi"; `presentQuoteForInternal` chỉ trả các bảng nội
// bộ. Cả hai CỐ Ý giấu tên khách, liên hệ, đơn giá bán, subtotal/vat/total.
//
// Nhưng ba endpoint LỊCH SỬ thì không lược gì cả:
//     GET /api/quotes/:id/versions            → listVersions      (kèm `total` từng phiên bản)
//     GET /api/quotes/:id/versions/:v         → getVersion        (trả THẲNG `ver.payload`)
//     GET /api/quotes/:id/versions/:a/diff/:b → diffVersionsService
// Cả ba chỉ gọi `loadAuthorizedQuote(req, "read")`, mà `canOnQuote` cho THÀNH VIÊN đi qua với
// `quote:read:own`. `assignHn` thì `members: { connect: { id: acc.id } }` — account Hà Nội LUÔN là
// thành viên của báo giá được giao.
//
// `snapshotQuoteVersion` (src/quoteVersion.ts) nhét vào payload: toCompany, toContact, toEmail,
// toPhone, toAddress, subtotal, vat, total và toàn bộ sheets[].items[] kèm unitPrice. Nghĩa là
// người "KHÔNG thấy nội dung báo giá khách" chỉ cần đổi URL từ `/quotes/7` sang `/quotes/7/versions/1`
// là đọc được sạch sẽ — giá bán cho khách, thông tin liên hệ khách hàng, tổng tiền.
//
// Cùng lỗ hổng ấy áp cho `quote:internal:view` (vai trò xem CHỈ bảng nội bộ).
//
// ── CÁCH VÁ ─────────────────────────────────────────────────────────────────
// `loadAuthorizedQuote` từ chối thẳng caller có view bị lược. Cả BỐN endpoint dùng helper này đều
// là endpoint lịch sử/duyệt ở mức báo giá — không endpoint nào trong số đó nằm trong luồng của
// account HN (AccountHnView.tsx chỉ gọi getQuote/saveHn/submitHn).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { agentWithCsrf } from "./helpers/agent.js";
import bcrypt from "bcryptjs";
import { prisma } from "../src/db.js";
import { PERMISSIONS as P } from "../src/permissions.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "Quote" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");

const TAG = `verleak${Date.now()}`;
const PWD = "Test1234!a";
const KHACH = "Khách hàng TỐI MẬT";
const GIA_BAN = 987_654;

describe.runIf(dbAvailable)("lịch sử phiên bản không được lách projection", () => {
  let app, adminU, accU, intU, companyId, templateId, quoteId;

  const dangNhap = async (u) => {
    const a = agentWithCsrf(app);
    expect((await a.post("/api/auth/login").send({ username: u.username, password: PWD })).status).toBe(200);
    return a;
  };

  beforeAll(async () => {
    const { createApp } = await import("../src/app.js");
    app = createApp();

    adminU = await prisma.user.create({ data: { username: `${TAG}-admin`, displayName: `${TAG} admin`, role: "admin", passwordHash: await bcrypt.hash(PWD, 4) } });
    accU = await prisma.user.create({ data: { username: `${TAG}-acc`, displayName: `${TAG} acc`, role: "account_hn", passwordHash: await bcrypt.hash(PWD, 4) } });
    // Người CHỈ xem bảng nội bộ: vai trò tối thiểu + hai quyền cấp riêng per-user.
    intU = await prisma.user.create({ data: { username: `${TAG}-int`, displayName: `${TAG} int`, role: "hr", passwordHash: await bcrypt.hash(PWD, 4), permissions: [P.QUOTE_READ_OWN, P.QUOTE_INTERNAL_VIEW] } });

    const co = await prisma.company.create({ data: { code: `${TAG}CO`, name: "Cty thử", address: "1 Thử", quotePrefix: "VL" } });
    companyId = co.id;
    templateId = (await prisma.quoteTemplate.create({ data: { companyId: co.id, name: "Mẫu thử", code: `${TAG}k`, filePath: "templates/GN_KhongNgay.xlsx" } })).id;

    const admin = await dangNhap(adminU);
    const r = await admin.post("/api/quotes").send({
      title: `${TAG} báo giá`, companyId, toCompany: KHACH, toEmail: "vip@khach.example", vatPercent: 8,
      sheets: [{ name: "Trang 1", order: 0, templateId, items: [{ kind: "item", name: "Màn LED", quantity: 1, unitPrice: GIA_BAN, order: 0 }] }],
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    quoteId = r.body.id;
    // Sửa một lần để chắc chắn có ≥2 phiên bản (đủ để test diff).
    const g = await admin.get(`/api/quotes/${quoteId}`);
    await admin.put(`/api/quotes/${quoteId}`).send({
      title: `${TAG} báo giá v2`, companyId, toCompany: KHACH, vatPercent: 10, baseUpdatedAt: g.body.updatedAt,
      sheets: [{ id: g.body.sheets[0].id, name: "Trang 1", order: 0, templateId, items: [{ kind: "item", name: "Màn LED", quantity: 2, unitPrice: GIA_BAN, order: 0 }] }],
    });

    // Giao phần HN cho account → account thành THÀNH VIÊN (đây là điều mở đường cho rò rỉ).
    expect((await admin.post(`/api/quotes/${quoteId}/hn/assign`).send({ accountId: accU.id })).status).toBe(200);
    // Người internal:view cũng phải là thành viên mới với tới được báo giá.
    await prisma.quote.update({ where: { id: quoteId }, data: { members: { connect: { id: intU.id } } } });
  });

  afterAll(async () => {
    await prisma.quote.deleteMany({ where: { title: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.quoteTemplate.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.company.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.loginAttempt.deleteMany({ where: { username: { startsWith: TAG } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
  });

  it("account HN: GET /:id ĐÃ lược đúng (điều kiện nền — nếu cái này hỏng thì test dưới vô nghĩa)", async () => {
    const acc = await dangNhap(accU);
    const r = await acc.get(`/api/quotes/${quoteId}`);
    expect(r.status).toBe(200);
    expect(r.body._accountHnView).toBe(true);
    expect(JSON.stringify(r.body)).not.toContain(KHACH);
    expect(JSON.stringify(r.body)).not.toContain(String(GIA_BAN));
  });

  it("account HN KHÔNG đọc được /versions, /versions/:v, /diff", async () => {
    const acc = await dangNhap(accU);
    for (const url of [`/api/quotes/${quoteId}/versions`, `/api/quotes/${quoteId}/versions/1`, `/api/quotes/${quoteId}/versions/1/diff/2`, `/api/quotes/${quoteId}/approvals`]) {
      const r = await acc.get(url);
      expect(r.status, `${url} phải 403`).toBe(403);   // trước khi vá: 200 kèm giá bán + tên khách
      const s = JSON.stringify(r.body);
      expect(s, `${url} không được lộ tên khách`).not.toContain(KHACH);
      expect(s, `${url} không được lộ giá bán`).not.toContain(String(GIA_BAN));
    }
  });

  it("người chỉ có quote:internal:view cũng KHÔNG đọc được lịch sử", async () => {
    const int = await dangNhap(intU);
    const nen = await int.get(`/api/quotes/${quoteId}`);
    expect(nen.status).toBe(200);
    expect(nen.body._internalView, "điều kiện nền: projection nội bộ đang bật").toBe(true);

    for (const url of [`/api/quotes/${quoteId}/versions`, `/api/quotes/${quoteId}/versions/1`, `/api/quotes/${quoteId}/versions/1/diff/2`]) {
      const r = await int.get(url);
      expect(r.status, `${url} phải 403`).toBe(403);
      expect(JSON.stringify(r.body)).not.toContain(KHACH);
    }
  });

  it("admin vẫn xem lịch sử bình thường (không lỡ tay chặn người có quyền thật)", async () => {
    const admin = await dangNhap(adminU);
    const ds = await admin.get(`/api/quotes/${quoteId}/versions`);
    expect(ds.status).toBe(200);
    expect(ds.body.data.length).toBeGreaterThanOrEqual(2);

    const v1 = await admin.get(`/api/quotes/${quoteId}/versions/1`);
    expect(v1.status).toBe(200);
    expect(v1.body.payload.toCompany).toBe(KHACH);

    const df = await admin.get(`/api/quotes/${quoteId}/versions/1/diff/2`);
    expect(df.status).toBe(200);
    expect(Array.isArray(df.body.changes)).toBe(true);

    expect((await admin.get(`/api/quotes/${quoteId}/approvals`)).status).toBe(200);
  });
});
