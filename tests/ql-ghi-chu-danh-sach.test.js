// GHI CHÚ + MÀU ở dòng của DANH SÁCH BÁO GIÁ (yêu cầu chủ repo 2026-09-30: "thêm cuối hàng, trước mấy
// cái nút, thêm cái ghi chú cho họ đánh vào, cho chọn màu… 5 màu chủ đạo, chọn theo kiểu Zalo").
//
// `PUT /api/quotes/:id/list-note` — body `{ note?, color? }`, trường vắng = giữ nguyên.
//
// ── VÌ SAO LÀ BẢNG RIÊNG (`QuoteListNote`), KHÔNG PHẢI CỘT TRÊN `Quote` ─────────────────────────
// `Quote.updatedAt` là mốc KHOÁ LẠC QUAN của màn soạn (client gửi `baseUpdatedAt`; lệch là 409). Ghi
// thẳng lên `Quote` làm mốc đó nhảy — tức một đồng nghiệp gõ ghi chú ở danh sách là ĐÁ VĂNG lần Lưu kế
// của người đang soạn chính báo giá ấy. `markExtraTableRowPayment` từng dính đúng lỗi này (xem
// tests/rbacscope-extra-idor.test.js: "làm Quote.updatedAt nhảy … đá văng khoá lạc quan"). Ghi chú ở
// danh sách là siêu dữ liệu của DÒNG, không phải nội dung báo giá: không được chạm mốc, không sinh
// QuoteVersion, không bị khoá khi đã xuất hoá đơn.
//
// ── AI ĐƯỢC GHI ─────────────────────────────────────────────────────────────────────────────────
// `canOnQuote(update)` + không bị view lược (cùng `loadAuthorizedQuote` với lịch sử/duyệt): chủ báo giá,
// thành viên có ÍT NHẤT MỘT vùng, người có `quote:update:all`. Thành viên CHỈ XEM (scopes rỗng) và
// người chỉ có quote:read:all không được đè ghi chú của chủ. Account HN / tài khoản chi phí (view bị
// lược) không thấy cột này và bị 403 nếu gọi thẳng.
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { agentWithCsrf } from "./helpers/agent.js";
import bcrypt from "bcryptjs";
import { prisma } from "../src/db.js";
import { PERMISSIONS as P } from "../src/permissions.js";

// Chặn emitChange để đếm sự kiện realtime (db.ts gọi nó qua import() ĐỘNG sau mỗi ghi Quote/Customer/User/
// QuoteListNote). Chỉ thay đúng hàm này — phần còn lại của sse.js (attach, broadcast…) vẫn là bản thật.
const h = vi.hoisted(() => ({ goi: [] }));
vi.mock("../src/sse.js", async (importOriginal) => ({
  ...(await importOriginal()),
  emitChange: (entity, action) => { h.goi.push({ entity, action }); },
}));

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "Quote" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 nhưng không kiểm tra được Postgres");

const TAG = `qlgc${Date.now()}`;
const PWD = "Test1234!a";

describe.runIf(dbAvailable)("PUT /api/quotes/:id/list-note — ghi chú + màu ở danh sách báo giá", () => {
  let app, companyId, templateId;
  let admin, chu, la, thanhVienXem, thanhVienSua, xemHet, hn, chiPhi, nhanSu;
  let qChu, qKhac, qXoa, qDaXuatHd;

  const dangNhap = async (u) => {
    const a = agentWithCsrf(app);
    expect((await a.post("/api/auth/login").send({ username: u.username, password: PWD })).status).toBe(200);
    return a;
  };
  const user = (ten, role, permissions) => bcrypt.hash(PWD, 4).then((passwordHash) => prisma.user.create({
    data: { username: `${TAG}-${ten}`, displayName: `${TAG} ${ten}`, role, passwordHash, ...(permissions ? { permissions } : {}) },
  }));
  const baoGia = (chuId, tieuDe, extra = {}) => prisma.quote.create({ data: {
    quoteNumber: `${TAG}-${tieuDe}`, title: `${TAG} ${tieuDe}`, searchText: TAG, toCompany: "Khách", companyId, fromContact: "x",
    fromAddress: "x", city: "TP. Hồ Chí Minh", quoteDate: new Date(), createdById: chuId,
    sheets: { create: [{ templateId, order: 1, name: "Trang 1", extraTables: [] }] }, ...extra,
  } });
  const dong = async (agent, id) => (await agent.get("/api/quotes").query({ q: TAG, size: 50 })).body.data.find((r) => r.id === id);

  beforeAll(async () => {
    const { createApp } = await import("../src/app.js");
    app = createApp();
    admin = await user("admin", "admin");
    chu = await user("chu", "manager");
    la = await user("la", "manager");
    thanhVienXem = await user("tvxem", "manager");
    thanhVienSua = await user("tvsua", "manager");
    // "Xem hết" (trợ lý giám đốc): đọc mọi báo giá nhưng CỐ Ý không có quote:update:*.
    xemHet = await user("xemhet", "hr", [P.QUOTE_READ_ALL]);
    hn = await user("hn", "account_hn");
    chiPhi = await user("chiphi", "hr", [P.QUOTE_READ_OWN, P.QUOTE_INTERNAL_VIEW]);
    nhanSu = await user("nhansu", "hr");

    companyId = (await prisma.company.create({ data: { code: `${TAG}CO`, name: "Cty thử", address: "1 Thử", quotePrefix: `Q${`${Date.now()}`.slice(-6)}` } })).id;
    templateId = (await prisma.quoteTemplate.create({ data: { companyId, name: "Mẫu thử", code: `${TAG}k`, filePath: "templates/GN_KhongNgay.xlsx" } })).id;

    qChu = await baoGia(chu.id, "cua-chu", { members: { create: [
      { userId: thanhVienXem.id, scopes: [] },
      { userId: thanhVienSua.id, scopes: ["main"] },
      { userId: hn.id, scopes: ["hanoi"] },
      { userId: chiPhi.id, scopes: [] },
    ] } });
    qKhac = await baoGia(chu.id, "khac");
    qXoa = await baoGia(chu.id, "da-xoa");
    await prisma.quote.delete({ where: { id: qXoa.id } });   // xoá MỀM
    // Báo giá ĐÃ CHỐT + đã có số hoá đơn → `canEdit` khoá sửa mọi thứ; ghi chú ở danh sách KHÔNG bị khoá.
    qDaXuatHd = await baoGia(chu.id, "da-xuat-hd", { status: "converted", convertedAt: new Date() });
    await prisma.quoteSheet.updateMany({ where: { quoteId: qDaXuatHd.id }, data: { invoiceNo: "HD-001" } });
  });

  afterAll(async () => {
    await prisma.quote.deleteMany({ where: { title: { startsWith: TAG } }, hardDelete: true, includeDeleted: true }).catch(() => {});
    await prisma.quoteTemplate.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.company.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    const ids = [admin, chu, la, thanhVienXem, thanhVienSua, xemHet, hn, chiPhi, nhanSu].filter(Boolean).map((u) => u.id);
    await prisma.auditEvent.deleteMany({ where: { actorId: { in: ids } } }).catch(() => {});
    await prisma.loginAttempt.deleteMany({ where: { username: { startsWith: TAG } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
  });

  it("chủ báo giá ghi chú + chọn màu → 200, và danh sách trả ĐÚNG ghi chú ở dòng đó (dòng khác: null)", async () => {
    const a = await dangNhap(chu);
    const r = await a.put(`/api/quotes/${qChu.id}/list-note`).send({ note: "  Chờ khách\nduyệt  ", color: "orange" });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    // Khoảng trắng thừa bị cắt, xuống dòng → dấu cách (ô một dòng trên bảng).
    expect(r.body).toMatchObject({ quoteId: qChu.id, note: "Chờ khách duyệt", color: "orange", updatedByName: `${TAG} chu` });

    const dsChu = await dong(a, qChu.id), dsKhac = await dong(a, qKhac.id);
    expect(dsChu.listNote).toMatchObject({ note: "Chờ khách duyệt", color: "orange", updatedByName: `${TAG} chu` });
    expect(dsChu.listNote.updatedAt).toBeTruthy();
    expect(dsKhac.listNote, "báo giá chưa có ghi chú").toBeNull();
  });

  it("chỉ gửi màu → giữ nguyên chữ; chỉ gửi chữ → giữ nguyên màu; đổi màu sang cái khác", async () => {
    const a = await dangNhap(chu);
    await a.put(`/api/quotes/${qKhac.id}/list-note`).send({ note: "Gọi lại thứ Hai", color: "blue" });
    const chiMau = await a.put(`/api/quotes/${qKhac.id}/list-note`).send({ color: "purple" });
    expect(chiMau.status).toBe(200);
    expect(chiMau.body).toMatchObject({ note: "Gọi lại thứ Hai", color: "purple" });
    const chiChu = await a.put(`/api/quotes/${qKhac.id}/list-note`).send({ note: "Gọi lại thứ Ba" });
    expect(chiChu.body).toMatchObject({ note: "Gọi lại thứ Ba", color: "purple" });
  });

  it("gỡ màu (color:null) giữ chữ; xoá cả chữ lẫn màu thì HÀNG trong CSDL biến mất (danh sách lại null)", async () => {
    const a = await dangNhap(chu);
    const goMau = await a.put(`/api/quotes/${qKhac.id}/list-note`).send({ color: null });
    expect(goMau.body).toMatchObject({ note: "Gọi lại thứ Ba", color: null });
    expect(await prisma.quoteListNote.count({ where: { quoteId: qKhac.id } })).toBe(1);

    const xoaHet = await a.put(`/api/quotes/${qKhac.id}/list-note`).send({ note: "" });
    expect(xoaHet.status).toBe(200);
    expect(xoaHet.body).toMatchObject({ quoteId: qKhac.id, note: "", color: null });
    expect(await prisma.quoteListNote.count({ where: { quoteId: qKhac.id } }), "hàng rỗng không được nằm lại").toBe(0);
    expect((await dong(a, qKhac.id)).listNote).toBeNull();
  });

  it("bắn realtime 'quoteNote' (để danh sách của người khác tự tươi) và KHÔNG bắn 'quote' (vì không chạm Quote)", async () => {
    await import("../src/sse.js");   // nạp sẵn: db.ts gọi emitChange qua import() động, lần nạp đầu chậm hơn nhịp chờ
    const a = await dangNhap(chu);
    h.goi.length = 0;
    expect((await a.put(`/api/quotes/${qChu.id}/list-note`).send({ note: "realtime", color: "purple" })).status).toBe(200);
    await new Promise((r) => setTimeout(r, 100));
    expect(h.goi).toContainEqual({ entity: "quoteNote", action: "upsert" });
    expect(h.goi.filter((e) => e.entity === "quote"), "ghi chú kéo theo làm tươi cả /quotes/projects + Dashboard").toEqual([]);
  });

  it("KHÔNG chạm khoá lạc quan: Quote.updatedAt, currentVersion và số QuoteVersion giữ nguyên", async () => {
    const truoc = await prisma.quote.findUnique({ where: { id: qChu.id }, select: { updatedAt: true, currentVersion: true } });
    const soBan = await prisma.quoteVersion.count({ where: { quoteId: qChu.id } });
    const a = await dangNhap(chu);
    for (const body of [{ note: "lần 1" }, { color: "red" }, { note: "lần 3", color: "green" }]) {
      expect((await a.put(`/api/quotes/${qChu.id}/list-note`).send(body)).status).toBe(200);
    }
    const sau = await prisma.quote.findUnique({ where: { id: qChu.id }, select: { updatedAt: true, currentVersion: true } });
    expect(sau.updatedAt.getTime(), "ghi chú làm nhảy mốc khoá lạc quan của người đang soạn").toBe(truoc.updatedAt.getTime());
    expect(sau.currentVersion).toBe(truoc.currentVersion);
    expect(await prisma.quoteVersion.count({ where: { quoteId: qChu.id } })).toBe(soBan);
  });

  it("báo giá ĐÃ XUẤT HOÁ ĐƠN (canEdit khoá sửa) vẫn ghi chú được — đây không phải nội dung báo giá", async () => {
    const a = await dangNhap(chu);
    const r = await a.put(`/api/quotes/${qDaXuatHd.id}/list-note`).send({ note: "Đã xuất HĐ, chờ thu", color: "green" });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
  });

  it("admin (quote:update:all) ghi được lên báo giá của người khác", async () => {
    const a = await dangNhap(admin);
    const r = await a.put(`/api/quotes/${qChu.id}/list-note`).send({ note: "Admin nhắc", color: "red" });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.updatedByName).toBe(`${TAG} admin`);
  });

  it("THÀNH VIÊN có vùng được giao ghi được; thành viên CHỈ XEM (scopes rỗng) → 403", async () => {
    const sua = await dangNhap(thanhVienSua);
    expect((await sua.put(`/api/quotes/${qChu.id}/list-note`).send({ note: "Phụ ghi" })).status).toBe(200);
    const xem = await dangNhap(thanhVienXem);
    const r = await xem.put(`/api/quotes/${qChu.id}/list-note`).send({ note: "Phá ghi chú của chủ" });
    expect(r.status, "thành viên chỉ xem không được đè ghi chú").toBe(403);
    expect((await prisma.quoteListNote.findUnique({ where: { quoteId: qChu.id } })).note).toBe("Phụ ghi");
  });

  it("người NGOÀI phạm vi, người chỉ có quote:read:all, tài khoản không có quyền báo giá → 403", async () => {
    for (const [ten, u] of [["ngoài", la], ["xem hết", xemHet], ["nhân sự", nhanSu]]) {
      const a = await dangNhap(u);
      const r = await a.put(`/api/quotes/${qChu.id}/list-note`).send({ note: `${ten} chen vào` });
      expect(r.status, `${ten}: ${JSON.stringify(r.body)}`).toBe(403);
    }
    expect(await prisma.quoteListNote.count({ where: { quoteId: qChu.id, note: { contains: "chen vào" } } })).toBe(0);
  });

  it("view BỊ LƯỢC (account HN, tài khoản chi phí) → 403 dù là thành viên; và danh sách của họ KHÔNG chứa ghi chú", async () => {
    const chuAgent = await dangNhap(chu);
    expect((await chuAgent.put(`/api/quotes/${qChu.id}/list-note`).send({ note: "Bí mật nội bộ của chủ" })).status).toBe(200);
    for (const u of [hn, chiPhi]) {
      const a = await dangNhap(u);
      const r = await a.put(`/api/quotes/${qChu.id}/list-note`).send({ note: "Lén ghi" });
      expect(r.status, JSON.stringify(r.body)).toBe(403);
      const ds = await a.get("/api/quotes").query({ q: TAG, size: 50 });
      expect(ds.status).toBe(200);
      expect(ds.body.data.some((x) => x.id === qChu.id), "điều kiện nền: họ thấy báo giá này").toBe(true);
      expect(JSON.stringify(ds.body), "ghi chú nội bộ của chủ lọt sang view lược").not.toContain("Bí mật nội bộ");
      expect(JSON.stringify(ds.body)).not.toContain("listNote");
    }
  });

  it("báo giá đã xoá mềm → 404; báo giá không tồn tại → 404", async () => {
    const a = await dangNhap(admin);
    // Điều kiện nền: route CÓ tồn tại (báo giá sống → 200). Không có dòng này thì hai 404 dưới xanh ngay cả
    // khi route chưa hề được viết — một bài không bao giờ đỏ được thì không bảo vệ gì.
    expect((await a.put(`/api/quotes/${qKhac.id}/list-note`).send({ note: "sống" })).status).toBe(200);
    expect((await a.put(`/api/quotes/${qXoa.id}/list-note`).send({ note: "x" })).status).toBe(404);
    expect((await a.put(`/api/quotes/2147483000/list-note`).send({ note: "x" })).status).toBe(404);
    expect(await prisma.quoteListNote.count({ where: { quoteId: qXoa.id } }), "báo giá trong thùng rác không được nhận ghi chú").toBe(0);
  });

  it("đầu vào xấu → 400: màu ngoài bảng 5 màu, chữ quá 200 ký tự, thân rỗng, màu sai kiểu", async () => {
    const a = await dangNhap(chu);
    const put = (body) => a.put(`/api/quotes/${qChu.id}/list-note`).send(body);
    expect((await put({ color: "hotpink" })).status).toBe(400);
    expect((await put({ color: 3 })).status).toBe(400);
    expect((await put({ note: "x".repeat(201) })).status).toBe(400);
    expect((await put({ note: 123 })).status).toBe(400);
    expect((await put({})).status, "không có gì để đổi").toBe(400);
    expect((await put({ note: "x".repeat(200) })).status, "đúng 200 ký tự thì được").toBe(200);
    // Tên màu không phân biệt hoa thường KHÔNG được chấp nhận — bảng màu là một tập đóng.
    expect((await put({ color: "RED" })).status).toBe(400);
  });

  it("để lại dấu vết trong nhật ký (kèm chữ + màu, KHÔNG kèm gì khác)", async () => {
    const a = await dangNhap(chu);
    await a.put(`/api/quotes/${qChu.id}/list-note`).send({ note: "Có nhật ký", color: "blue" });
    const ev = await prisma.auditEvent.findFirst({ where: { actorId: chu.id, action: "quote.list-note", resourceId: String(qChu.id) }, orderBy: { id: "desc" } });
    expect(ev, "thiếu bản ghi nhật ký quote.list-note").toBeTruthy();
    expect(ev.after).toMatchObject({ note: "Có nhật ký", color: "blue" });
  });

  it("xoá cứng báo giá kéo theo ghi chú (ON DELETE CASCADE) — không để hàng mồ côi", async () => {
    const tam = await baoGia(chu.id, "xoa-cung");
    const a = await dangNhap(chu);
    expect((await a.put(`/api/quotes/${tam.id}/list-note`).send({ note: "sẽ mất" })).status).toBe(200);
    await prisma.quote.deleteMany({ where: { id: tam.id }, hardDelete: true, includeDeleted: true });
    expect(await prisma.quoteListNote.count({ where: { quoteId: tam.id } })).toBe(0);
  });
});
