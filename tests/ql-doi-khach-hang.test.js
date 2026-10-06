// ĐỔI KHÁCH HÀNG (danh mục "Mã khách hàng") NGAY TRONG BÁO GIÁ (chủ repo 2026-09-30: "trong báo giá cho chọn đổi khách hàng
// luôn nhé"). Giao diện (màn soạn) chỉ là cái nút; phần phải đúng nằm ở máy chủ:
//   · khách MỚI phải tồn tại (chưa xoá) và người đổi phải ĐỌC được nó — danh mục khách chia theo chủ sở hữu khi ai đó chỉ có
//     `customer:read:own`; thiếu kiểm này thì đoán id là gắn được khách của người khác rồi đọc mã + tên qua chính báo giá;
//   · màn soạn gửi LẠI cả báo giá mỗi lần Lưu, kể cả `customerId` cũ → CHỈ kiểm khi giá trị ĐỔI; người chỉ còn giữ khách cũ (đã
//     chuyển chủ / bị xoá) vẫn phải lưu được như trước — không thì một cú Lưu bình thường bỗng ăn 403;
//   · đổi khách phải TRUY ĐƯỢC trong nhật ký, còn lần Lưu thường giữ nguyên hình dạng nhật ký cũ;
//   · tạo báo giá mới cũng qua cùng cổng (đường tạo từng để lọt id bịa → khoá ngoại → 500).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { agentWithCsrf } from "./helpers/agent.js";
import bcrypt from "bcryptjs";
import { prisma } from "../src/db.js";
import { PERMISSIONS as P } from "../src/permissions.js";
import { normalizeSearch } from "../src/searchText.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "Quote" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");

const TAG = `qldk${Date.now()}`;
const PWD = "Test1234!a";
const PREFIX = `D${`${Date.now()}`.slice(-6)}`;

describe.runIf(dbAvailable)("đổi khách hàng (danh mục) của báo giá — PUT/POST /api/quotes", () => {
  let app, admin, han, companyId, templateId, khHan, khHan2, khAdmin1, khAdmin2, khXoa;
  const dangNhap = async (u) => { const a = agentWithCsrf(app); expect((await a.post("/api/auth/login").send({ username: u.username, password: PWD })).status).toBe(200); return a; };
  const khach = (ten, ownerId, extra = {}) => prisma.customer.create({ data: {
    code: `${TAG}${ten}`, name: `Khách ${ten}`, ownerId, contactName: `Liên hệ ${ten}`, email: `${ten}@example.com`, phone: `09000${ten.length}`, address: `Địa chỉ ${ten}`,
    searchText: normalizeSearch(`Khách ${ten}`, `${TAG}${ten}`), ...extra,
  } });
  const taoBaoGia = (agent, ten, customerId) => agent.post("/api/quotes").send({
    title: `${TAG} ${ten}`, companyId, toCompany: "Khách gõ tay", fromContact: "Người gửi", vatPercent: 8,
    ...(customerId !== undefined ? { customerId } : {}),
    sheets: [{ name: "Trang 1", order: 0, templateId, items: [{ kind: "item", name: "Hạng mục", quantity: 1, unitPrice: 1000, order: 0 }], extraTables: [] }],
  });
  /** Lưu như màn soạn: gửi LẠI cả báo giá vừa đọc + mốc updatedAt, chỉ đổi phần `sua`. */
  const luu = async (agent, id, sua) => {
    const q0 = (await agent.get(`/api/quotes/${id}`)).body;
    // Như màn soạn: bảng nội bộ luôn đi như MẢNG (người không có quyền nội bộ nhận về null/vắng → gửi lại [] chứ không gửi null).
    const sheets = q0.sheets.map((s) => ({ ...s, extraTables: Array.isArray(s.extraTables) ? s.extraTables : [] }));
    return agent.put(`/api/quotes/${id}`).send({ ...q0, sheets, ...sua, baseUpdatedAt: q0.updatedAt });
  };
  const nhatKyCuoi = (id) => prisma.auditEvent.findFirst({ where: { action: "quote.update", resource: "quote", resourceId: String(id) }, orderBy: { id: "desc" } });
  const customerIdTrongDb = async (id) => (await prisma.quote.findFirst({ where: { id }, select: { customerId: true } })).customerId;

  beforeAll(async () => {
    const { createApp } = await import("../src/app.js");
    app = createApp();
    const hash = await bcrypt.hash(PWD, 4);
    admin = await prisma.user.create({ data: { username: `${TAG}-admin`, displayName: `${TAG} admin`, role: "admin", passwordHash: hash } });
    // Người CHỈ đọc được khách của MÌNH (customer:read:own, không :all) — hồ sơ duy nhất mà kiểm phạm vi khách có tác dụng: hai vai
    // mặc định (nhân viên, manager) đều có customer:read:all vì danh bạ khách là danh bạ chung.
    han = await prisma.user.create({ data: {
      username: `${TAG}-han`, displayName: `${TAG} han`, role: "manager", passwordHash: hash,
      permissions: [P.QUOTE_CREATE, P.QUOTE_READ_OWN, P.QUOTE_UPDATE_OWN, P.CUSTOMER_READ_OWN],
    } });
    const co = await prisma.company.create({ data: { code: `${TAG}CO`, name: "Cty thử", address: "1 Thử", quotePrefix: PREFIX } });
    companyId = co.id;
    templateId = (await prisma.quoteTemplate.create({ data: { companyId: co.id, name: "Mẫu thử", code: `${TAG}k`, filePath: "templates/GN_KhongNgay.xlsx" } })).id;
    khHan = await khach("H1", han.id);
    khHan2 = await khach("H2", han.id);
    khAdmin1 = await khach("A1", admin.id);
    khAdmin2 = await khach("A2", admin.id);
    khXoa = await khach("X", admin.id, { deletedAt: new Date() });
  });

  afterAll(async () => {
    await prisma.quote.deleteMany({ where: { title: { startsWith: TAG } }, hardDelete: true, includeDeleted: true }).catch(() => {});
    await prisma.customer.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true, includeDeleted: true }).catch(() => {});
    await prisma.quoteTemplate.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.company.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.quoteCounter.deleteMany({ where: { prefix: PREFIX } }).catch(() => {});
    const ids = [admin, han].filter(Boolean).map((u) => u.id);
    await prisma.auditEvent.deleteMany({ where: { actorId: { in: ids } } }).catch(() => {});
    await prisma.notification.deleteMany({ where: { userId: { in: ids } } }).catch(() => {});
    await prisma.loginAttempt.deleteMany({ where: { username: { startsWith: TAG } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
  });

  // ── ĐỔI KHÁCH TRÊN BÁO GIÁ ĐÃ CÓ ─────────────────────────────────────────────
  it("người đọc được mọi khách (admin) đổi khách: customerId + mã + tên đổi theo ở phản hồi và CSDL; nhật ký ghi khách TRƯỚC/SAU", async () => {
    const a = await dangNhap(admin);
    const r0 = await taoBaoGia(a, "doi-1", khAdmin1.id);
    expect(r0.status, JSON.stringify(r0.body)).toBe(201);
    expect(r0.body.customerCode).toBe(khAdmin1.code);
    const r = await luu(a, r0.body.id, { customerId: khAdmin2.id });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.customerId).toBe(khAdmin2.id);
    expect(r.body.customerCode).toBe(khAdmin2.code);
    expect(r.body.customerName).toBe(khAdmin2.name);
    expect(await customerIdTrongDb(r0.body.id)).toBe(khAdmin2.id);
    const nk = await nhatKyCuoi(r0.body.id);
    expect(nk.before.customerId, "nhật ký phải nói khách CŨ").toBe(khAdmin1.id);
    expect(nk.after.customerId, "…và khách MỚI").toBe(khAdmin2.id);
    // Người đọc trang Nhật ký không đọc được số id → ghi thêm MÃ + TÊN.
    expect(nk.before.khachHang).toBe(`${khAdmin1.code} — ${khAdmin1.name}`);
    expect(nk.after.khachHang).toBe(`${khAdmin2.code} — ${khAdmin2.name}`);
  });

  it("nhật ký vẫn đọc được khi khách CŨ đã bị xoá mềm (tra kèm bản đã xoá), và khi gỡ liên kết thì khách mới là null", async () => {
    const a = await dangNhap(admin);
    const khSapXoa = await khach("S1", admin.id);
    const r0 = await taoBaoGia(a, "nhat-ky-xoa", khSapXoa.id);
    expect(r0.status, JSON.stringify(r0.body)).toBe(201);
    await prisma.customer.update({ where: { id: khSapXoa.id }, data: { deletedAt: new Date() } });
    const r = await luu(a, r0.body.id, { customerId: khAdmin2.id });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const nk = await nhatKyCuoi(r0.body.id);
    expect(nk.before.khachHang, "khách cũ đã xoá mềm vẫn phải hiện mã + tên, không phải '#id'").toBe(`${khSapXoa.code} — ${khSapXoa.name}`);
    const r2 = await luu(a, r0.body.id, { customerId: null });
    expect(r2.status, JSON.stringify(r2.body)).toBe(200);
    const nk2 = await nhatKyCuoi(r0.body.id);
    expect(nk2.after.customerId).toBeNull();
    expect(nk2.after.khachHang).toBeNull();
  });

  it("lần Lưu THƯỜNG (khách không đổi) giữ nguyên hình dạng nhật ký cũ: không có customerId trong before/after", async () => {
    const a = await dangNhap(admin);
    const r0 = await taoBaoGia(a, "thuong-1", khAdmin1.id);
    const r = await luu(a, r0.body.id, { title: `${TAG} thuong-1 sửa tiêu đề` });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const nk = await nhatKyCuoi(r0.body.id);
    expect(Object.keys(nk.before).sort()).toEqual(["status", "total"]);
    expect(Object.keys(nk.after).sort()).toEqual(["reopened", "status", "total"]);
  });

  it("người chỉ có customer:read:own: đổi sang khách của MÌNH → 200; sang khách của NGƯỜI KHÁC → 403 và báo giá không đổi", async () => {
    const a = await dangNhap(han);
    const r0 = await taoBaoGia(a, "han-doi", khHan.id);
    expect(r0.status, JSON.stringify(r0.body)).toBe(201);
    const ok = await luu(a, r0.body.id, { customerId: khHan2.id });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.customerCode).toBe(khHan2.code);
    const chan = await luu(a, r0.body.id, { customerId: khAdmin1.id });
    expect(chan.status, "gắn khách của người khác = đọc trộm mã + tên khách qua phản hồi báo giá").toBe(403);
    expect(chan.body.error).toMatch(/không có quyền/i);
    expect(await customerIdTrongDb(r0.body.id), "bị chặn thì báo giá giữ nguyên khách").toBe(khHan2.id);
  });

  it("khách không tồn tại / đã xoá → 400 tiếng Việt (không phải 500 từ khoá ngoại); giá trị sai kiểu → 400", async () => {
    const a = await dangNhap(admin);
    const r0 = await taoBaoGia(a, "sai-khach", khAdmin1.id);
    for (const [ten, id] of [["id không có thật", 999999999], ["khách đã xoá", khXoa.id]]) {
      const r = await luu(a, r0.body.id, { customerId: id });
      expect(r.status, `${ten}: ${JSON.stringify(r.body)}`).toBe(400);
      expect(r.body.error).toMatch(/không tồn tại|đã bị xóa/);
    }
    for (const xau of ["abc", 0, -3, 1.5]) {
      const r = await luu(a, r0.body.id, { customerId: xau });
      expect(r.status, `customerId=${JSON.stringify(xau)}`).toBe(400);
    }
    expect(await customerIdTrongDb(r0.body.id)).toBe(khAdmin1.id);
  });

  it("KHÔNG đổi khách thì KHÔNG kiểm lại: khách đã chuyển chủ hoặc đã bị xoá, người soạn vẫn Lưu được (màn soạn luôn gửi lại customerId cũ)", async () => {
    const a = await dangNhap(han);
    const khTam = await khach("T1", han.id);   // khách RIÊNG của bài này — sẽ bị chuyển chủ rồi xoá, không đụng khách của các bài khác
    const r0 = await taoBaoGia(a, "giu-khach", khTam.id);
    expect(r0.status, JSON.stringify(r0.body)).toBe(201);
    // Khách chuyển sang chủ khác → người soạn không còn ĐỌC được nó…
    await prisma.customer.update({ where: { id: khTam.id }, data: { ownerId: admin.id } });
    const r = await luu(a, r0.body.id, { title: `${TAG} giu-khach đã sửa` });
    expect(r.status, "Lưu thường không được ăn 403 chỉ vì khách cũ đã ra khỏi phạm vi: " + JSON.stringify(r.body)).toBe(200);
    expect(r.body.customerId).toBe(khTam.id);
    // …cũng như khi khách bị xoá sau khi đã gắn.
    await prisma.customer.update({ where: { id: khTam.id }, data: { deletedAt: new Date() } });
    const r2 = await luu(a, r0.body.id, { title: `${TAG} giu-khach đã sửa lần hai` });
    expect(r2.status, JSON.stringify(r2.body)).toBe(200);
    expect(await customerIdTrongDb(r0.body.id)).toBe(khTam.id);
  });

  it("gỡ liên kết (customerId: null) vẫn được như trước — không cần kiểm quyền vì không lộ gì", async () => {
    const a = await dangNhap(han);
    const r0 = await taoBaoGia(a, "go-lien-ket", khHan.id);
    const r = await luu(a, r0.body.id, { customerId: null });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.customerId).toBeNull();
    expect(await customerIdTrongDb(r0.body.id)).toBeNull();
  });

  // ── TẠO BÁO GIÁ MỚI ──────────────────────────────────────────────────────────
  it("tạo báo giá: khách của mình → 201; khách người khác → 403; id bịa / khách đã xoá → 400; KHÔNG có khách → vẫn 201 (báo giá cũ không gắn)", async () => {
    const a = await dangNhap(han);
    expect((await taoBaoGia(a, "tao-ok", khHan.id)).status).toBe(201);
    const khacNguoi = await taoBaoGia(a, "tao-khac", khAdmin1.id);
    expect(khacNguoi.status, JSON.stringify(khacNguoi.body)).toBe(403);
    expect((await taoBaoGia(a, "tao-bia", 999999999)).status).toBe(400);
    expect((await taoBaoGia(a, "tao-xoa", khXoa.id)).status).toBe(400);
    expect((await taoBaoGia(a, "tao-khong-khach")).status).toBe(201);
    expect((await taoBaoGia(a, "tao-null", null)).status).toBe(201);
    // Bị từ chối thì KHÔNG để lại báo giá nào (kiểm TRƯỚC khi cấp số).
    for (const ten of ["tao-khac", "tao-bia", "tao-xoa"]) {
      expect(await prisma.quote.count({ where: { title: `${TAG} ${ten}` } }), ten).toBe(0);
    }
  });

  it("admin (đọc mọi khách) tạo với khách của người khác → 201", async () => {
    const a = await dangNhap(admin);
    const r = await taoBaoGia(a, "admin-tao", khHan.id);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.customerCode).toBe(khHan.code);
  });
});
